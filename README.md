# 码桥 QR Bridge

> **源码仓库说明**：本仓库只包含源代码、页面资源和构建脚本，不包含 `dist/` 下的构建产物，也不包含 UOS 端的安装包/可执行程序。Android APK、UOS 安装包和 Windows 可执行文件请通过其他受控渠道分发。
>
> 本项目包含两个模式：标准多路二维码和 Fountain 高速二维码。所有传输都在本机屏幕与摄像头之间完成，不经过网络。

**不联网、不插 U 盘、不装运行库，用屏幕上的多路二维码和另一台电脑的摄像头传文件。**

码桥把文件压缩、切片，用 **4 路并行的二维码**同时播放；接收端用摄像头读取四宫格，自动拼回文件，并用 SHA-256 校验。所有处理都在本机浏览器内存中完成，文件不会上传到任何服务器。

2.0 参考了 [libcimbar](https://github.com/sz3/libcimbar) 的“高密度多符号 + 压缩 +  fountain/纠错”思路，但在本项目中采用更适合浏览器、无需 OpenCV/WASM 的实现：

- **gzip 压缩**：文本、JSON、日志、CSV 通常能压到原来的 1/3–1/20；
- **4 路并行二维码**：一屏同时显示 4 个码，吞吐量约为单码的 4 倍；
- **Base32 + 二维码 Alphanumeric 模式**：比 Base64 + Byte 模式多装约 35% 的数据；
- **四宫格自动分区识别**：接收端自动尝试多个缩放比例，不需要手工裁剪；
- **SHA-256 + 文件长度校验**：压缩包损坏、缺片、解压失败都会明确提示。

### Fountain 高速（推荐，基于 Decimen Optical Transfer）

标准二维码模式保持不变。另加一个独立的 **Fountain 高速** 模式，思路完全借鉴
[Decimen Optical Transfer](https://github.com/bashalarmistalt/decimen-optical-transfer)：

- 标准 QR（不是自绘色码）+ **Luby fountain / systematic carousel**；
- 一屏可同时显示 **1/2/4/6 个 QR**，默认 4 个；
- QR 可使用 V40、ECC L，单帧最高约 2953 字节；
- 接收端收集任意约 K×1.15 个不同帧即可恢复，丢帧只损失时间，不影响正确性；
- 使用 Decimen 自带的 **zxing-cpp WASM 解码器**，不是 jsQR；
- 上游实测 **418.5 KB/s**（desktop→iPhone 17 Pro Max，1 MB/2.5 s，4 码），
  phone→phone 约 199 KB/s；实际速度取决于屏幕刷新率、摄像头和光线；
- 文件上限 **64 MB**；SHA-256 校验；文件名/类型保留；
- 不含加密；发送画面可被任何摄像头读取。

使用：

1. PC 发送端打开码桥首页，点右上角 **Fountain 高速**；
2. 选择文件，保持默认 4 码 / 24 fps / 1465 B 每帧，开始播放并全屏；
3. 手机打开 **码桥接收端 2.0.12**，点 **Fountain 高速**，启动摄像头；
4. 对准四宫格，收齐后保存到系统“下载/QRBridge”。

标准二维码模式完全未改动，仍可继续用于兼容传输。

### 统一界面

桌面端和 Android 端都把两种模式放进同一套界面：

- 顶部统一品牌栏：码桥图标、名称、`二维码 / Fountain 高速` 模式切换；
- 二维码模式与 Fountain 模式共用同一个外壳，Fountain 页不再显示 Decimen 原生的独立页头/页脚；
- 桌面端使用浅色主题，Android 端使用深色主题，但两种模式的头部、按钮和状态区风格一致；
- 切换模式只切换页面内容，不会启动第二个应用，也不会自动改变屏幕方向。
- Android 的 Fountain 模式与标准二维码模式共用同一套摄像头预览框、按钮尺寸和模式栏；接收设置改为按钮下常显，不再折叠。



> Fountain 页面来自 Decimen v0.5.3，按其 **AGPL-3.0-or-later** 许可分发；
> 详见 `FOUNTAIN_NOTICE.md` 和 `LICENSE-AGPL-3.0.txt`。
> 旧的 RGB 高速色码页仍保留为实验入口，但不再是推荐方案。

> **重要：关于 UOS 数字签名**  
> 统信 UOS 的 deb 签名使用统信开发者证书（`cert-tool` + `deepin-elf-sign-deb`），没有统信签发的证书和私钥，第三方**无法生成被 UOS 安装器信任的“合法签名”**；自签名/GPG/debsigs 都不能替代。  
> 因此本项目提供**无需 root、无需签名的用户级安装包**作为 UOS 推荐安装方式，同时保留未签名 deb 供允许 `dpkg -i` 的环境使用。详见 [SIGNING.md](SIGNING.md)。

---

## 一、交付文件

| 文件 | 用途 |
| --- | --- |
| `qrbridge-python-2.1.0.tar.gz` | **当前机器推荐**：Python3 兼容版，绕过 Go 运行时段错误 |
| `qrbridge-2.1.0-linux-amd64.tar.gz` | Go 1.22 用户级安装包，适用于 Go 能正常启动的机器 |
| `qrbridge_2.1.0_amd64.deb` | 未签名 deb，仅适合允许 `dpkg -i` 的环境 |
| `QRBridge-2.1.0-windows-x64.zip` | Windows 10/11 x64，解压后运行 |
| `QRBridgeReceiver-2.0.12.apk` | Android 接收端：标准二维码 / Fountain 双模式，独立包名 |
| `qrbridge-linux-amd64` | Linux 单文件二进制，可直接运行排查 |
| `QRBridge.exe` | Windows 单文件二进制 |
| `QRBridge-2.1.0-source.zip` | 完整源码、构建脚本和测试 |
| `SHA256SUMS.txt` | 发布文件 SHA-256 校验值 |
| `SIGNING.md` | UOS 签名限制、官方签名流程和替代方案 |

程序主体是静态编译的单文件；Python 兼容版只使用系统自带 Python3。**Go 版**运行时不需要 Python、Java、Node.js、Electron、OpenCV 或任何第三方库；Fountain 页的解码器是内嵌 WASM，不联网、不装包。

---

## 二、Android 接收端

`QRBridgeReceiver-2.0.12.apk` 是只接收的 Android 应用（独立包名 `com.qrbridge.receiver12`，可与旧版并存）：

- 顶部切换 **标准二维码** 或 **Fountain 高速**；
- Fountain 文件在手机本地完成校验与 SHA-256 校验；
- 文件保存到系统 **下载/QRBridge/**；
- 不含发送功能；
- Android 8.0+，使用系统 WebView。

安装时允许“未知来源”，首次打开授予摄像头权限。发送端选文件并全屏播放；手机顶部选择对应模式后对准屏幕即可。

构建源码和手动构建说明见 [android/README.md](android/README.md)。

---

## 三、统信 UOS 20 安装（推荐：用户级，无需签名）

适用：UOS 20 专业版 1043 / amd64 / 内核 4.19 / ZHAOXIN KX-6640MA。

```bash
tar -xzf qrbridge-2.1.0-linux-amd64.tar.gz
cd qrbridge-2.1.0-linux-amd64
sh install-user.sh
```

安装到当前用户目录，不需要 root、不经过包管理器：

```text
~/.local/opt/qrbridge/qrbridge
~/.local/opt/qrbridge/run-safe.sh
~/.local/opt/qrbridge/diagnose.sh
~/.local/bin/qrbridge
~/.local/share/applications/qrbridge.desktop
```

启动方式：

- 在启动器中搜索 **“码桥”**；
- 或终端运行：

```bash
~/.local/bin/qrbridge
```

如果 2.0.0/2.0.1 的 Go 版在你的 UOS 机器上出现 `Segmentation fault`，请使用 **Python3 兼容版**（绕过 Go 运行时）：

```bash
tar -xzf qrbridge-python-2.1.0.tar.gz
cd qrbridge-python-2.1.0
sh install-user.sh
~/.local/bin/qrbridge-python
```

它只使用 UOS 自带的 Python3，无需 pip、root 或开发者模式。二维码、gzip、四宫格识别仍全部在浏览器中完成。启动后在顶部切换 **Fountain 高速** 可进入大文件/高密度模式。

如果你在另一台 UOS 机器上使用 Go 版，2.1.0 已改用 **Go 1.22.12** 编译，避开 Go 1.27 新运行时/Green Tea GC 在较老内核和 CPU 上的兼容风险。安装后检查：

```bash
~/.local/opt/qrbridge/qrbridge --version
```

应显示 `2.1.0 ... go1.22.12`。如果仍段错误，运行：

```bash
cd qrbridge-2.1.0-linux-amd64
sh diagnose.sh
```

并把输出发给维护者；也可以先试 `sh run-safe.sh`（关闭 Go 异步抢占）。

也可以完全不安装，直接运行：

```bash
sh run.sh
```

卸载：

```bash
sh uninstall-user.sh
```

> 为什么不用 deb？因为 UOS 安装器要求统信开发者签名，而开发者证书只能由统信开发者账号生成，且官方说明调试签名仅限签名机器使用。详见 [SIGNING.md](SIGNING.md)。

### 如果系统允许 `dpkg -i`

```bash
sudo dpkg -i qrbridge_2.1.0_amd64.deb
qrbridge
```

该 deb **没有统信认可的签名**，只适合测试机或已允许 `dpkg` 的环境。不要为了安装它去关闭系统安全校验。

---

## 四、Windows 10/11 使用

1. 解压 `QRBridge-2.1.0-windows-x64.zip`。
2. 双击 `QRBridge.exe`。
3. 如果 SmartScreen 提示“已保护你的电脑”，点击“更多信息 → 仍要运行”。程序未做商业代码签名，这是正常提示。
4. 浏览器自动打开码桥页面。

Windows 不需要安装任何运行库。日志在：

```text
%LOCALAPPDATA%\QRBridge\qrbridge.log
```

---

## 五、传输步骤

### 4.1 发送端

1. 打开码桥 → “发送文件” → 选择文件。
2. 选择档位：
   - **稳定**：220 B/码，v10 / 57×57，适合远距离、旧摄像头；
   - **均衡**：440 B/码，v15 / 77×77，推荐默认；
   - **快速**：745 B/码，v20 / 97×97，需要清晰对焦和较近的距离。
3. 并行路数保持 **4 路高速**（默认）。如果接收端很难识别，改成“单码”兜底。
4. 帧率默认 5 帧/秒。清晰环境可提到 6–8；识别不稳降到 3–4。
5. 点击“开始播放二维码”。开始后设置面板会自动收起，二维码占满工作区。
6. 点击“全屏”，把四宫格完整显示在屏幕上。
7. 接收端漏片时，可以点“补帧”只循环指定分片；接收端可先点“复制缺失分片”。

### 4.2 接收端

1. 切到“接收文件”。
2. 点击“开启摄像头扫描”，允许浏览器使用摄像头。
3. 把发送端的**整个四宫格**放入取景框；让四宫格尽量占满画面。
4. 识别到第一帧后，右侧会显示文件名、压缩前后大小、分片矩阵和进度。
5. 收齐后自动 gzip 解压、校验 SHA-256；通过后点击“保存文件”。

如果没有摄像头，可以：

- 点“从图片识别”，选择包含四宫格的截图；
- 把截图拖到摄像头取景框；
- 在接收页按 `Ctrl+V` 粘贴截图。

图片识别会自动尝试整图和四宫格多个缩放比例。

### 4.3 快捷键

- `空格`：发送页暂停/继续。
- `Esc`：退出全屏。
- 页面切到后台时，发送会自动暂停。

---

## 六、速度与压缩

以下为 **4 路、5 帧/秒、理想不丢帧** 的估算。实际速度取决于摄像头、对焦、屏幕亮度和环境光。

| 档位 | 单码 | 4 路理论吞吐 | 100 KB | 1 MB | 8 MB |
| --- | ---: | ---: | ---: | ---: | ---: |
| 稳定 | 220 B | 4.4 KB/s | 约 23 秒 | 约 4 分钟 | 约 31 分钟 |
| 均衡 | 440 B | 8.8 KB/s | 约 12 秒 | 约 2 分钟 | 约 16 分钟 |
| 快速 | 745 B | 14.9 KB/s | 约 7 秒 | 约 1.2 分钟 | 约 9 分钟 |

压缩会进一步缩短时间：

- JSON、日志、CSV、源代码、Markdown：常见 3–20 倍压缩；
- docx、xlsx、pdf、zip、jpg/png：本身已压缩，通常不再压缩，按原始大小传输；
- 压缩后如果反而更大，程序会自动使用原始数据。

默认上限 **8 MB** 只适用于标准二维码兼容模式。二维码是低速视觉通道，建议优先传文档、配置、日志、密钥等小文件。

**高速色码（实验）** 每帧可携带约 2.5 KB，6 fps 时理论约 15 KB/s（未计压缩收益），并且分片号是 32 位、不再有 8 MB 限制；建议单文件不超过 512 MB。实际吞吐受摄像头识别率影响，通常明显高于 4 路二维码。

---

## 七、提高识别率

1. 发送端屏幕亮度最高，关闭夜间模式、护眼模式、自动亮度。
2. **必须让四宫格整体入镜**，不要只拍其中一两个码。
3. 尽量全屏；四宫格占画面高度的 60%–90%，镜头与屏幕垂直。
4. 先试“均衡 + 4 路 + 5 帧/秒”。识别慢就降到“稳定”或“单码”。
5. 摄像头选 720p 或更高；关闭会议软件、相机等占用摄像头的程序。
6. 避免屏幕反光和摩尔纹；环境光太暗时适当补光。
7. 关闭系统自动锁屏/息屏。程序会申请屏幕常亮，但部分旧浏览器不支持。

---

## 八、常见问题

**Q：UOS 提示“没有有效的数字签名”，无法安装 deb？**

这是统信安装器的签名策略，不是程序缺依赖。没有统信签发的开发者证书，无法生成合法签名。请使用：

```bash
tar -xzf qrbridge-2.1.0-linux-amd64.tar.gz
cd qrbridge-2.1.0-linux-amd64
sh install-user.sh
```

不需要 root、不需要开发者模式，也不经过 deb 安装器。详见 [SIGNING.md](SIGNING.md)。

**Q：能否用自签名/GPG 给 deb 签名？**

不能替代统信签名。UOS 安装器校验的是统信证书链，不是任意 GPG 签名。自签名的包仍会被拒绝。

**Q：浏览器没有弹出摄像头授权？**

点地址栏左侧权限图标，把摄像头改为“允许”，刷新页面。UOS 还要在“控制中心 → 隐私 → 摄像头”中确认浏览器有权限。

**Q：一直卡在 99%？**

发送端会循环播放；通常再等一轮即可补齐。接收端点“复制缺失分片”，发送端点“补帧”粘贴编号（如 `3,7,12-15`），只补这些帧会快很多。

**Q：压缩后为什么文件没有变小？**

docx/xlsx/pdf/zip/jpg/png 等本身已压缩，gzip 基本无效，程序会自动按原始大小传输。对文本、JSON、日志效果最明显。

**Q：四个码只识别到一两个？**

把四宫格放大、全屏、正对镜头；改成“均衡”或“稳定”档；降低帧率；确保四个码都在取景框内。接收端会自动尝试 100%、90%、80%、70% 等缩放区域。

**Q：文件校验失败？**

至少一个分片内容不正确，通常是反光、失焦或摄像头压缩导致。点“继续接收”重扫，不要直接保存损坏文件。

**Q：程序需要联网吗？**

不需要。页面、二维码库、压缩库、识别库全部内嵌在程序里。程序只监听 `127.0.0.1`，不发起外部网络请求。

**Q：安全吗？**

文件只在内存中处理，不上传。接收完成用 SHA-256 校验。二维码在物理空间可见，请勿在公共场所传输敏感文件。

---

## 九、技术细节

### 8.1 协议 QFT2

二维码内容全部使用大写字母、数字和 `:`，从而启用二维码 **Alphanumeric 模式**；二进制数据用 Base32（无填充）编码。

数据帧：

```text
QFT2:D:<传输ID>:<总片数5位>:<片大小4位>:<序号5位>:<路数>:<Base32数据>
```

信息帧：

```text
QFT2:M:<传输ID>:<总片数5位>:<片大小4位>:<文件名Base32>:<原始大小>:<传输大小>:<SHA-256>:<flags>
```

- `flags` 位 0：gzip 压缩；位 1：4 路模式。
- 数据分片固定填充到片大小，最后一帧按传输大小截断。
- 信息帧每个周期和每约 24 组重复一次；接收端中途开始也能拿到文件名和校验值。
- 接收端按序号重组，重复帧自动忽略，收齐后 gzip 解压并校验原始文件的 SHA-256。

### 8.2 二维码参数

| 档位 | 片大小 | QR 版本 | 模块数 | 纠错 | 模式 |
| --- | ---: | ---: | ---: | --- | --- |
| 稳定 | 220 B | 10 | 57×57 | L | Alphanumeric |
| 均衡 | 440 B | 15 | 77×77 | L | Alphanumeric |
| 快速 | 745 B | 20 | 97×97 | L | Alphanumeric |

4 路模式把 1280×720 画布分成 2×2 四个区域，每区一个二维码，中间留白。接收端会：

1. 先尝试整帧识别信息帧/单码；
2. 再按 16:9 中心区域按 100%、90%、80%、70% 等比例切成四个象限；
3. 对每个象限调用 jsQR；
4. 记住最近成功的缩放比例，下一次优先使用。

### 8.3 本地服务

- Go 标准库 HTTP 服务，仅绑定 `127.0.0.1`。
- 每次启动生成随机路径口令，例如 `/s/<18字节随机值>/`。
- 严格 CSP：不允许外部脚本、样式、连接和 iframe。
- 页面无外部字体、无 CDN、无统计代码。
- 浏览器关闭后，若 10 分钟没有心跳，程序自动退出；也可以点页面右上角“退出”。

### 8.4 验证范围

- Windows 10/11 + Chrome：发送端压缩/4 路二维码、接收端解压/校验/下载、四宫格图片导入、补帧、模拟四宫格摄像头识别，均已通过端到端测试。
- Linux 侧：静态 ELF 无 `PT_INTERP`、无 `PT_DYNAMIC`，不依赖 glibc；`GOAMD64=v1`，兼容 x86-64 基线 CPU。
- 未在真实统信 UOS 20 机器上插摄像头实测；UOS 上浏览器/摄像头行为需以实际机器为准。程序只调用 `xdg-open` 打开默认浏览器，不依赖特定桌面环境。

---

## 十、从源码构建

要求：Go 1.20+，Python 3（仅打包用）。

```bash
cd app

CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
  go build -trimpath \
  -ldflags "-s -w -X main.version=2.1.0" \
  -o ../dist/qrbridge-linux-amd64 .

CGO_ENABLED=0 GOOS=windows GOARCH=amd64 \
  go build -trimpath \
  -ldflags "-s -w -H windowsgui -X main.version=2.1.0" \
  -o ../dist/QRBridge.exe .

cd ..
python packaging/build_deb.py --binary dist/qrbridge-linux-amd64 --version 2.1.0
python packaging/build_archives.py --version 2.1.0
```

Windows 开发机可以直接运行 `build.ps1`。

测试：

```bash
# 浏览器内协议、Base32、gzip、单码/四宫格二维码测试
# 用静态服务器打开 tests/selftest.html

# 端到端
node tests/e2e.js http://127.0.0.1:8787/s/<口令>/

# 四宫格模拟摄像头
node tests/make_camera_fixture.js .run/qr-camera.y4m
node tests/camera_e2e.js http://127.0.0.1:8787/s/<口令>/ .run/qr-camera.y4m
```

---

## 十一、目录结构

```text
app/
  main.go                 Go 本地 HTTP 服务与浏览器启动
  web/
    index.html
    style.css
    app.js                发送/接收/多宫格/补帧
    core.js               QFT2、Base32、gzip、分片、SHA-256
    highspeed.html/css/js 高速色码发送/接收实验页
    cim.js                Quantum Grid 编解码、锚点、LDPC、CBOR
    vendor/
      qrcode.js           qrcode-generator 1.4.4（MIT）
      jsQR.min.js         jsQR 1.4.0（Apache-2.0）
      fflate.min.js       fflate 0.8.2（MIT）
      zstd/               zstd-wasm（MIT/BSD，内嵌 WASM）
android/
  app/src/main/           Android 接收端（Java + WebView + assets 拦截）
  build.ps1               无 Gradle 的手工 APK 构建
python-server/
  server.py               Python3 兼容本地服务
  web/                    兼容版内置页面
packaging/
  build_deb.py            纯 Python 生成 .deb
  build_archives.py       便携包、Windows zip、源码 zip
  build_python_portable.py Python 兼容包
  install.sh              系统级安装（root）
  install-user.sh         用户级安装（无需 root/签名）
  run.sh                  免安装运行
  uninstall-user.sh       用户级卸载
  sign-uos.sh             已获得统信证书后的本机签名辅助脚本
  run-safe.sh             兼容模式启动（关闭异步抢占）
  diagnose.sh             启动失败诊断脚本
tests/
  selftest.html           QFT2/二维码/压缩测试
  e2e.js                  浏览器端到端测试
  make_camera_fixture.js  生成四宫格 Y4M 测试视频
  camera_e2e.js           模拟摄像头识别测试
build.ps1
```

---

## 十二、许可

- 本项目代码：MIT，见 `LICENSE`。
- qrcode-generator：MIT，Copyright (c) 2009 Kazuhiko Arase。
- jsQR：Apache-2.0，Copyright 2016 Cozmo。
- fflate：MIT，Copyright (c) 2023 Arjun Barrett。
- Go 标准库：BSD 3-Clause。

完整第三方声明见 `THIRD_PARTY_NOTICES.md`。

## 致谢

特别感谢 **大肥鱼** 在项目开发、测试和体验反馈中的帮助。
