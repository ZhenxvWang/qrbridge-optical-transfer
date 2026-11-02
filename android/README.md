# 码桥 Android 接收端 2.0.12

只收不发：Android 手机打开摄像头，扫描码桥发送端的 **高速色码（Quantum Grid）**，
在手机本地完成 CBOR 解析、zstd 解压、AES-GCM 解密、SHA-256 校验，然后保存到系统“下载/QRBridge”。

## 目录

```text
android/
  app/src/main/
    AndroidManifest.xml
    java/com/qrbridge/receiver/MainActivity.java
    java/com/qrbridge/receiver/LocalServer.java
    assets/web/                     # android.html / android.js / cim.js / vendor
    res/drawable/ic_launcher.xml
  build.ps1                         # 无 Gradle 的手工构建脚本
```

## 构建

需要：

- JDK 17
- Android SDK Platform 33
- Android Build-Tools 34.0.0

构建脚本默认读取：

```text
.tools/jdk17/bin/javac.exe
.tools/android-sdk/platforms/android-33/android.jar
.tools/android-sdk/build-tools/34.0.0/
```

执行：

```powershell
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

产物：

```text
dist/QRBridgeReceiver-2.0.12.apk
```

APK 使用本地生成的 debug keystore 签名，可直接侧载安装；正式发布应替换为发布证书。

> Windows 上的 AAPT2 可能把 assets 写成 `web\android.html`（反斜杠），
> Android AssetManager 只能按 `web/android.html` 查找，表现为 `not found: web/android.html`。
> 因此构建脚本不再使用 `aapt2 link -A`，而是由 `android/add_assets.py`
> 用 Python zipfile 以正斜杠写入 `assets/web/...`。这是 2.0.12 修复的关键。

## 统一模式栏

标准二维码和 Fountain 高速共用顶部的码桥品牌栏、模式切换胶囊和深色主题；
点击 Fountain 只是切换到同一应用的另一个模式，不再打开 Decimen 独立页头。
Fountain 页仍保留其 AGPL 归因链接。
Fountain 模式按标准二维码页重排：顶部栏尺寸一致，摄像头预览框位于按钮上方，接收设置在按钮下常显。


## 安装与使用

APK 包名为 `com.qrbridge.receiver12`，与旧版 `com.qrbridge.receiver` 独立，可直接并存安装，不需要先卸载旧版。

1. 手机允许“安装未知来源应用”。
2. 安装 APK，授予摄像头权限。
3. **Fountain 高速（推荐）**：PC 发送端打开码桥首页 → 右上角 **Fountain 高速** → 选文件 → 保持默认 4 码/24 fps → 开始播放并全屏；手机打开 **码桥接收端 2.0.12** → 点 **Fountain 高速** → 启动摄像头。
4. **标准二维码**：手机顶部选“标准二维码”，PC 用二维码模式。
5. 收齐后自动保存到：`下载/QRBridge/`。

Fountain 页面使用 Decimen 的 zxing-cpp WASM 解码器，文件上限 64 MB；
标准二维码模式保持原有 8 MB 兼容上限。加密色码模式仍保留，但不再是推荐方案。

## 说明

- Android 端包含：标准二维码接收、Fountain 高速接收、RGB 高速色码（实验）。
- 使用系统 WebView；Android 8.0+（minSdk 26）。
- 页面通过 `https://appassets.androidplatform.net/assets/web/` 由 `shouldInterceptRequest`
  直接从 APK assets 返回，不依赖本地 HTTP 端口；因此不会出现 `127.0.0.1` 的 “not found”。
- 摄像头在 HTTPS 安全上下文中使用；保存通过 `QRBridgeAndroid` JavascriptInterface
  分块写入 `下载/QRBridge/`，不依赖 WebView 的 blob 下载。
- Fountain 页面的 `<a download>` blob 会由 `android-save-bridge.js` 拦截并转存到原生保存桥。
- Fountain 页面来自 Decimen v0.5.3，按 AGPL-3.0-or-later 分发；见根目录 `FOUNTAIN_NOTICE.md`。
