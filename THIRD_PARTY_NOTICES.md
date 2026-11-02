# 第三方组件与许可

码桥（QR Bridge）自身代码采用 MIT 许可证。程序内嵌了以下开源浏览器端组件，
它们随程序一起分发，运行时不需要联网加载。

## qrcode-generator 1.4.4

- 用途：在浏览器本地生成二维码矩阵。
- 项目：https://github.com/kazuhikoarase/qrcode-generator
- 版权：Copyright (c) 2009 Kazuhiko Arase
- 许可证：MIT
- 文件：`app/web/vendor/qrcode.js`
- 该文件头部保留了原始版权与 MIT 许可声明。

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## jsQR 1.4.0

- 用途：在浏览器本地识别摄像头画面或图片中的二维码。
- 项目：https://github.com/cozmo/jsQR
- 版权：Copyright 2016 Cozmo
- 许可证：Apache License 2.0
- 文件：`app/web/vendor/jsQR.min.js`
- 完整许可证文本：`app/web/vendor/LICENSE-jsQR.txt`

## fflate 0.8.2

- 用途：在浏览器本地进行 gzip 压缩与解压。
- 项目：https://github.com/101arrowz/fflate
- 版权：Copyright (c) 2023 Arjun Barrett
- 许可证：MIT
- 文件：`app/web/vendor/fflate.min.js`
- 完整许可证文本：`app/web/vendor/LICENSE-fflate.txt`

## zstd-wasm 0.0.27

- 用途：高速色码的 zstd 压缩/解压，使用 4 KB 领域字典。
- 项目：https://github.com/bokuweb/zstd-wasm
- 版权：zstd-wasm TypeScript glue, MIT；Zstandard, Facebook/Meta BSD 3-Clause。
- 文件：`app/web/vendor/zstd/`
- 完整许可证文本：`app/web/vendor/LICENSE-zstd.txt`

## Decimen Optical Transfer（Fountain 高速模式）

- 用途：Fountain 高速模式使用其独立发送/接收页面。
- 项目：https://github.com/bashalarmistalt/decimen-optical-transfer
- 版本：v0.5.3
- 许可证：AGPL-3.0-or-later
- 文件：`app/web/fountain-send.html`、`app/web/fountain-receive.html`
- 完整文本：`LICENSE-AGPL-3.0.txt`
- 说明：`FOUNTAIN_NOTICE.md`

## Go 标准库

- 用途：构建单文件本地 HTTP 服务。
- 许可证：BSD 3-Clause
- 项目：https://go.dev/
