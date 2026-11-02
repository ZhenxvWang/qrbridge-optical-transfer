#!/usr/bin/env python3
"""Build a dependency-free Debian package for QR Bridge.

The target binary is a static linux/amd64 Go executable.  This script only uses
the Python standard library so it can run on the Windows development machine.
"""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_file(tar: tarfile.TarFile, name: str, data: bytes, mode: int = 0o644) -> None:
    info = tarfile.TarInfo(name)
    info.size = len(data)
    info.mode = mode
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = 0
    tar.addfile(info, io.BytesIO(data))


def add_dir(tar: tarfile.TarFile, name: str) -> None:
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    info.mode = 0o755
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = 0
    tar.addfile(info)


def make_tar_gz(entries: list[tuple[str, bytes, int]]) -> bytes:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        for name, data, mode in entries:
            add_file(tar, name, data, mode)
    packed = io.BytesIO()
    with gzip.GzipFile(filename="", mode="wb", fileobj=packed, mtime=0) as gz:
        gz.write(raw.getvalue())
    return packed.getvalue()


def ar_member(name: str, data: bytes) -> bytes:
    header = (
        f"{name:<16}"
        f"{0:<12}"
        f"{0:<6}"
        f"{0:<6}"
        f"{0o100644:<8o}"
        f"{len(data):<10}"
        "`\n"
    ).encode("ascii")
    padding = b"\n" if len(data) % 2 else b""
    return header + data + padding


def make_ar(members: list[tuple[str, bytes]]) -> bytes:
    out = bytearray(b"!<arch>\n")
    for name, data in members:
        out += ar_member(name, data)
    return bytes(out)


def control_text(version: str, installed_kb: int) -> str:
    return f"""Package: qrbridge
Version: {version}
Section: utils
Priority: optional
Architecture: amd64
Maintainer: QR Bridge <qrbridge@example.com>
Installed-Size: {installed_kb}
Description: 码桥 - 离线二维码文件传输
 码桥通过 gzip 压缩、4 路并行二维码和摄像头，在物理隔离的电脑之间传输文件。
 程序为单文件静态二进制，无第三方运行库依赖；界面、文件切片、压缩、
 二维码识别和 SHA-256 校验全部在本机浏览器内完成。
 .
 本 deb 未包含统信开发者签名；受签名策略限制的机器请使用便携包中的
 install-user.sh 进行用户级安装。
"""


def copyright_text(version: str) -> str:
    return f"""Format: https://www.debian.org/doc/packaging-manuals/copyright-format/1.0/
Upstream-Name: qrbridge
Upstream-Contact: QR Bridge contributors
Source: local build

Files: *
Copyright: 2026 QR Bridge contributors
License: MIT

Files: usr/share/doc/qrbridge/licenses/jsQR-Apache-2.0.txt
Copyright: 2016 Cozmo
License: Apache-2.0

Files: usr/share/doc/qrbridge/licenses/fflate-MIT.txt
Copyright: 2023 Arjun Barrett
License: MIT

Files: usr/share/doc/qrbridge/licenses/MIT.txt
Copyright: 2009 Kazuhiko Arase (qrcode-generator)
           2026 QR Bridge contributors
License: MIT

Files: usr/share/doc/qrbridge/licenses/Go-BSD-3-Clause.txt
Copyright: 2009 The Go Authors
License: BSD-3-Clause

Version: {version}
"""


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--binary", default=str(ROOT / "dist" / "qrbridge-linux-amd64"))
    parser.add_argument("--version", default="2.0.1")
    parser.add_argument("--output", default="")
    args = parser.parse_args()

    binary = Path(args.binary)
    if not binary.exists():
        raise SystemExit(f"binary not found: {binary}")
    payload = binary.read_bytes()
    if len(payload) < 1_000_000 or payload[:4] != b"\x7fELF":
        raise SystemExit("not a valid linux ELF binary")
    if payload[4] != 2 or payload[5] != 1:
        raise SystemExit("expected 64-bit little-endian ELF")

    docs = {
        "README.md": (ROOT / "README.md").read_bytes(),
        "LICENSE": (ROOT / "LICENSE").read_bytes(),
        "THIRD_PARTY_NOTICES.md": (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes(),
        "SIGNING.md": (ROOT / "SIGNING.md").read_bytes(),
        "copyright": copyright_text(args.version).encode("utf-8"),
        "licenses/jsQR-Apache-2.0.txt": (ROOT / "app/web/vendor/LICENSE-jsQR.txt").read_bytes(),
        "licenses/fflate-MIT.txt": (ROOT / "app/web/vendor/LICENSE-fflate.txt").read_bytes(),
        "licenses/MIT.txt": (ROOT / "LICENSE").read_bytes(),
        "licenses/qrcode-generator-NOTICE.txt": (ROOT / "app/web/vendor/LICENSE-qrcode.txt").read_bytes(),
        "licenses/Go-BSD-3-Clause.txt": (
            "Copyright 2009 The Go Authors. All rights reserved.\n\n"
            "Redistribution and use in source and binary forms, with or without\n"
            "modification, are permitted provided that the following conditions are met:\n\n"
            "   * Redistributions of source code must retain the above copyright notice,\n"
            "     this list of conditions and the following disclaimer.\n"
            "   * Redistributions in binary form must reproduce the above copyright notice,\n"
            "     this list of conditions and the following disclaimer in the documentation\n"
            "     and/or other materials provided with the distribution.\n"
            "   * Neither the name of Google Inc. nor the names of its contributors may be\n"
            "     used to endorse or promote products derived from this software without\n"
            "     specific prior written permission.\n\n"
            "THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS \"AS IS\"\n"
            "AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE\n"
            "IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE\n"
            "DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE\n"
            "FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL\n"
            "DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR\n"
            "SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER\n"
            "CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,\n"
            "OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE\n"
            "OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.\n"
        ).encode("utf-8"),
    }

    entries: list[tuple[str, bytes, int]] = [
        ("./usr/bin/qrbridge", payload, 0o755),
        ("./usr/share/applications/qrbridge.desktop", (ROOT / "packaging/qrbridge.desktop").read_bytes(), 0o644),
        ("./usr/share/icons/hicolor/scalable/apps/qrbridge.svg", (ROOT / "app/web/icon.svg").read_bytes(), 0o644),
    ]
    for name, data in docs.items():
        entries.append((f"./usr/share/doc/qrbridge/{name}", data, 0o644))

    installed_kb = (sum(len(data) for _, data, _ in entries) + 1023) // 1024
    md5_lines = []
    for name, data, _ in entries:
        rel = name[2:] if name.startswith("./") else name
        md5_lines.append(f"{hashlib.md5(data).hexdigest()}  {rel}")
    md5sums = ("\n".join(md5_lines) + "\n").encode("utf-8")

    control_tar = make_tar_gz([
        ("./control", control_text(args.version, installed_kb).encode("utf-8"), 0o644),
        ("./md5sums", md5sums, 0o644),
    ])
    data_tar = make_tar_gz(entries)
    deb = make_ar([
        ("debian-binary", b"2.0\n"),
        ("control.tar.gz", control_tar),
        ("data.tar.gz", data_tar),
    ])

    output = Path(args.output) if args.output else ROOT / "dist" / f"qrbridge_{args.version}_amd64.deb"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_bytes(deb)
    print(f"wrote {output}")
    print(f"size {len(deb)} bytes, sha256 {sha256(output)}")
    print(f"installed-size {installed_kb} KiB")


if __name__ == "__main__":
    main()
