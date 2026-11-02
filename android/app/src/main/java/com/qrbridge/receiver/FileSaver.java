package com.qrbridge.receiver;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;

/** 通过 JavascriptInterface 分块接收文件，避免 WebView 的 blob 下载限制。 */
final class FileSaver {
    private final Context context;
    private OutputStream output;
    private Uri pendingUri;
    private String displayName;
    private String path;
    private long expected = -1;
    private long written;
    private boolean active;

    FileSaver(Context context) {
        this.context = context.getApplicationContext();
    }

    synchronized void begin(String name, long size) throws IOException {
        abort();
        displayName = safeName(name);
        expected = size;
        written = 0;
        if (Build.VERSION.SDK_INT >= 29) {
            beginMediaStore();
        } else {
            beginAppFile();
        }
        active = true;
    }

    private void beginMediaStore() throws IOException {
        try {
            ContentValues values = new ContentValues();
            values.put(MediaStore.MediaColumns.DISPLAY_NAME, displayName);
            values.put(MediaStore.MediaColumns.MIME_TYPE, "application/octet-stream");
            values.put("relative_path", Environment.DIRECTORY_DOWNLOADS + "/QRBridge");
            values.put("is_pending", 1);
            Class<?> downloads = Class.forName("android.provider.MediaStore$Downloads");
            Uri collection = (Uri) downloads.getField("EXTERNAL_CONTENT_URI").get(null);
            ContentResolver resolver = context.getContentResolver();
            pendingUri = resolver.insert(collection, values);
            if (pendingUri == null) throw new IOException("MediaStore insert failed");
            output = resolver.openOutputStream(pendingUri);
            if (output == null) throw new IOException("openOutputStream failed");
            path = "下载/QRBridge/" + displayName;
        } catch (IOException e) {
            throw e;
        } catch (Exception e) {
            throw new IOException(e);
        }
    }

    private void beginAppFile() throws IOException {
        File dir = context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS);
        if (dir == null) dir = context.getFilesDir();
        if (!dir.exists() && !dir.mkdirs()) throw new IOException("mkdir failed");
        File file = new File(dir, displayName);
        output = new FileOutputStream(file);
        path = file.getAbsolutePath();
    }

    synchronized void append(byte[] data) throws IOException {
        if (!active || output == null) throw new IOException("no active file");
        output.write(data);
        written += data.length;
    }

    synchronized String finish() throws IOException {
        if (!active || output == null) throw new IOException("no active file");
        output.flush();
        output.close();
        output = null;
        if (pendingUri != null) {
            ContentValues values = new ContentValues();
            values.put("is_pending", 0);
            context.getContentResolver().update(pendingUri, values, null, null);
        }
        active = false;
        if (expected >= 0 && written != expected) {
            abort();
            throw new IOException("size mismatch: " + written + "/" + expected);
        }
        return path;
    }

    synchronized void abort() {
        try {
            if (output != null) output.close();
        } catch (IOException ignored) {
        }
        output = null;
        if (pendingUri != null) {
            try {
                context.getContentResolver().delete(pendingUri, null, null);
            } catch (Exception ignored) {
            }
        }
        pendingUri = null;
        active = false;
    }

    private static String safeName(String name) {
        if (name == null || name.trim().isEmpty()) return "qrbridge.bin";
        name = name.replace('\\', '/');
        int slash = name.lastIndexOf('/');
        if (slash >= 0) name = name.substring(slash + 1);
        name = name.replaceAll("[\\r\\n\\t\\u0000]", "_");
        if (name.length() > 180) {
            String ext = "";
            int dot = name.lastIndexOf('.');
            if (dot > 0 && name.length() - dot < 12) ext = name.substring(dot);
            name = name.substring(0, 160) + ext;
        }
        return name.isEmpty() ? "qrbridge.bin" : name;
    }
}
