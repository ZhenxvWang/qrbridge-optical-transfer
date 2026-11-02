# 码桥 QR Bridge 2.0.1 — Python 兼容版

## 这个版本解决什么问题

在你的统信 UOS 20 / 兆芯 KX-6640MA 机器上，Go 静态二进制即使换成 Go 1.22 仍然在启动时
`Segmentation fault`。这说明问题不一定在 Go 版本，而可能是该内核/CPU 组合下 Go 运行时
与系统环境不兼容。

这个兼容版**不再使用 Go 运行时**，而是用 UOS 自带的 **Python 3** 启动一个本地静态文件服务。
二维码生成、gzip/zstd 压缩、四宫格识别、SHA-256 校验仍然全部在浏览器里完成，传输能力与 Go 版一致。

2.0.1 还包含一个实验性的 **高速色码（Quantum Grid）** 页面：128×128 灰度单元、4 角锚点、
透视校正、CBOR、zstd 领域字典、可选 AES-GCM、RA-LDPC 纠错；分片号 32 位，不再有 8 MB 限制。
它是实验模式，建议正对屏幕使用；标准二维码模式仍作为稳定回退。

它不需要：

- pip / 任何 Python 第三方包
- root
- 开发者模式
- deb 签名
- 联网

它只需要系统自带 `python3`。UOS 20 默认包含 Python 3；请先确认：

```bash
python3 --version
```

## 安装

```bash
tar -xzf qrbridge-2.0.1-python.tar.gz
cd qrbridge-python-2.0.1
sh install-user.sh
```

然后运行：

```bash
~/.local/bin/qrbridge-python
```

或在启动器中搜索 **“码桥（Python 兼容版）”**。

启动后点右上角 **“高速色码（实验）”** 可进入大文件/高密度模式；二维码模式保留为稳定回退。

也可以不安装：

```bash
sh run.sh
```

## 使用

1. 发送端选择文件、档位、4 路并行，点“开始播放二维码”并全屏。
2. 接收端打开摄像头，把整个四宫格放入取景框。
3. 收齐后自动 gzip 解压、SHA-256 校验，保存文件。
4. 漏片时可“复制缺失分片”，发送端“补帧”粘贴编号。

其他功能与 Go 版相同：图片识别、单码兼容、补帧。标准二维码模式保留 8 MB 兼容上限；大文件请使用右上角的 **高速色码（实验）**，它使用 32 位分片号，支持到 512 MB（受浏览器内存限制）。

## 命令行参数

```bash
python3 server.py --no-browser --port 8787 --print-url
```

- `--no-browser`：不自动打开浏览器
- `--port`：固定端口，0 为随机
- `--print-url`：只把访问地址输出到 stdout
- `--log`：日志路径

默认日志：

```text
~/.cache/qrbridge/qrbridge.log
```

## 移除

```bash
sh uninstall-user.sh
```

## 安全

- 只监听 `127.0.0.1`
- 随机访问口令
- 严格 CSP，不加载外部脚本
- 文件只在浏览器内存中处理
- 不经过任何在线服务

这个版本不包含统信数字签名，也不经过 deb 安装器；它安装在自己的家目录中。
