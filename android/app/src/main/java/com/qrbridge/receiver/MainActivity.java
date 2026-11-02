package com.qrbridge.receiver;

import android.Manifest;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Bundle;
import android.util.Base64;
import android.view.WindowManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

public final class MainActivity extends Activity {
    private static final int REQ_CAMERA = 41;
    private static final String ASSET_ORIGIN = "https://appassets.androidplatform.net";
    private static final String START_URL = ASSET_ORIGIN + "/assets/web/android.html";
    private WebView webView;
    private FileSaver saver;
    private String startPage = "android.html";

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        saver = new FileSaver(this);
        if (getIntent() != null && Intent.ACTION_VIEW.equals(getIntent().getAction()) &&
                getIntent().getDataString() != null &&
                getIntent().getDataString().startsWith("qrbridge://fountain")) {
            startPage = "fountain-receive.html";
        }
        webView = new WebView(this);
        WebView.setWebContentsDebuggingEnabled(true);
        webView.setBackgroundColor(0xff07111c);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setUserAgentString(settings.getUserAgentString() + " QRBridgeAndroid/2.0.12");

        webView.addJavascriptInterface(new AndroidBridge(), "QRBridgeAndroid");
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(android.webkit.ConsoleMessage message) {
                android.util.Log.i("QRBridgeJS", message.message() + " @" + message.lineNumber());
                return true;
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(() -> {
                    boolean wantsVideo = false;
                    for (String resource : request.getResources()) {
                        if (PermissionRequest.RESOURCE_VIDEO_CAPTURE.equals(resource)) wantsVideo = true;
                    }
                    if (wantsVideo && checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                        request.grant(new String[]{PermissionRequest.RESOURCE_VIDEO_CAPTURE});
                    } else {
                        request.deny();
                        if (checkSelfPermission(Manifest.permission.CAMERA) != PackageManager.PERMISSION_GRANTED) {
                            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
                        }
                    }
                });
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return !request.getUrl().toString().startsWith(ASSET_ORIGIN);
            }

            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return interceptAsset(request);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                injectSaveBridge();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, android.webkit.WebResourceError error) {
                if (request.isForMainFrame()) {
                    Toast.makeText(MainActivity.this,
                            "页面加载失败：" + error.getErrorCode() + " " + error.getDescription(),
                            Toast.LENGTH_LONG).show();
                }
            }
        });

        setContentView(webView);
        if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
            loadApp();
        } else {
            requestPermissions(new String[]{Manifest.permission.CAMERA}, REQ_CAMERA);
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        String data = intent == null ? null : intent.getDataString();
        String page = data != null && Intent.ACTION_VIEW.equals(intent.getAction()) &&
                data.startsWith("qrbridge://fountain")
                ? "fountain-receive.html" : "android.html";
        startPage = page;
        if (webView != null) {
            webView.loadUrl(ASSET_ORIGIN + "/assets/web/" + page);
        }
    }

    private void loadApp() {
        webView.loadUrl(ASSET_ORIGIN + "/assets/web/" + startPage);
    }

    private void injectSaveBridge() {
        try {
            InputStream in = getAssets().open("web/android-save-bridge.js");
            byte[] buffer = new byte[in.available()];
            int read = in.read(buffer);
            in.close();
            if (read > 0) {
                String js = new String(buffer, 0, read, StandardCharsets.UTF_8);
                webView.evaluateJavascript(js, null);
            }
        } catch (IOException ignored) {
        }
    }

    private WebResourceResponse interceptAsset(WebResourceRequest request) {
        String url = request.getUrl().toString();
        if (!url.startsWith(ASSET_ORIGIN + "/assets/")) return null;
        String path = request.getUrl().getPath();
        if (path == null || !path.startsWith("/assets/")) return null;
        String asset = path.substring("/assets/".length());
        if (asset.contains("..")) return null;
        String[] candidates = new String[]{asset, "assets/" + asset, "web/" + asset, asset.replaceFirst("^web/", "")};
        IOException lastError = null;
        for (String candidate : candidates) {
            try {
                InputStream in = getAssets().open(candidate);
                String mime = mime(candidate);
                WebResourceResponse response = new WebResourceResponse(mime, encoding(mime), in);
                Map<String, String> headers = new HashMap<>();
                headers.put("Cache-Control", "no-store, max-age=0");
                headers.put("X-Content-Type-Options", "nosniff");
                headers.put("Referrer-Policy", "no-referrer");
                headers.put("Content-Security-Policy",
                        "default-src 'self'; script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'; " +
                        "style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
                        "media-src 'self' blob: mediastream:; connect-src 'self' blob: data:; " +
                        "worker-src 'self' blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
                response.setResponseHeaders(headers);
                return response;
            } catch (IOException e) {
                lastError = e;
            }
        }
        StringBuilder detail = new StringBuilder("not found: " + asset);
        detail.append("\ntried:");
        for (String candidate : candidates) detail.append(" ").append(candidate);
        if (lastError != null) detail.append("\n").append(lastError.getMessage());
        detail.append("\nassets root: ").append(assetList(""));
        detail.append("\nassets web: ").append(assetList("web"));
        WebResourceResponse missing = new WebResourceResponse("text/plain", "UTF-8",
                new ByteArrayInputStream(detail.toString().getBytes(StandardCharsets.UTF_8)));
        missing.setStatusCodeAndReasonPhrase(404, "Not Found");
        return missing;
    }

    private String assetList(String path) {
        try {
            return join(getAssets().list(path));
        } catch (IOException e) {
            return "ERR " + e.getMessage();
        }
    }

    private static String join(String[] values) {
        if (values == null) return "-";
        StringBuilder out = new StringBuilder();
        for (String value : values) out.append(value).append(' ');
        return out.toString();
    }

    private static String mime(String path) {
        String p = path.toLowerCase(Locale.US);
        if (p.endsWith(".html")) return "text/html";
        if (p.endsWith(".js")) return "text/javascript";
        if (p.endsWith(".css")) return "text/css";
        if (p.endsWith(".wasm")) return "application/wasm";
        if (p.endsWith(".json")) return "application/json";
        if (p.endsWith(".svg")) return "image/svg+xml";
        if (p.endsWith(".png")) return "image/png";
        return "application/octet-stream";
    }

    private static String encoding(String mime) {
        if (mime.startsWith("text/") || mime.equals("application/json") || mime.equals("image/svg+xml")) {
            return "UTF-8";
        }
        return null;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode == REQ_CAMERA) {
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                loadApp();
            } else {
                Toast.makeText(this, "需要摄像头权限才能接收文件", Toast.LENGTH_LONG).show();
            }
        }
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        if (saver != null) saver.abort();
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }

    private final class AndroidBridge {
        @JavascriptInterface
        public String platform() {
            return "android";
        }

        @JavascriptInterface
        public String version() {
            return "2.0.12";
        }

        @JavascriptInterface
        public void beginSave(String name, long size) {
            try {
                saver.begin(name, size);
            } catch (IOException e) {
                throw new RuntimeException(e.getMessage(), e);
            }
        }

        @JavascriptInterface
        public void appendSave(String base64) {
            try {
                saver.append(Base64.decode(base64, Base64.DEFAULT));
            } catch (Exception e) {
                throw new RuntimeException(e.getMessage(), e);
            }
        }

        @JavascriptInterface
        public String finishSave() {
            try {
                return saver.finish();
            } catch (IOException e) {
                throw new RuntimeException(e.getMessage(), e);
            }
        }

        @JavascriptInterface
        public void abortSave() {
            saver.abort();
        }

        @JavascriptInterface
        public void toast(String text) {
            runOnUiThread(() -> Toast.makeText(MainActivity.this, text, Toast.LENGTH_LONG).show());
        }
    }
}
