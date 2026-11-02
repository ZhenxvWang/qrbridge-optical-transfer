#!/usr/bin/env python3
"""Validate release artifacts without dpkg or a Linux host."""

from __future__ import annotations

import hashlib
import io
import struct
import sys
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DIST = ROOT / "dist"
VERSION = "2.0.1"
ERRORS: list[str] = []


def check(condition: bool, message: str) -> None:
    if not condition:
        ERRORS.append(message)
        print("FAIL", message)
    else:
        print("PASS", message)


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_ar(path: Path) -> dict[str, bytes]:
    data = path.read_bytes()
    check(data.startswith(b"!<arch>\n"), "deb has ar magic")
    offset = 8
    members: dict[str, bytes] = {}
    while offset < len(data):
        header = data[offset:offset + 60]
        check(len(header) == 60, "ar member header is complete")
        name = header[0:16].decode("ascii").strip()
        size = int(header[48:58].decode("ascii").strip())
        mode = header[40:48].decode("ascii").strip()
        check(mode == "100644", f"ar member {name} mode is 100644")
        body = data[offset + 60:offset + 60 + size]
        check(len(body) == size, f"ar member {name} body size")
        members[name] = body
        offset += 60 + size
        if size % 2:
            check(data[offset:offset + 1] == b"\n", f"ar member {name} padding")
            offset += 1
    return members


def validate_deb() -> None:
    deb = DIST / f"qrbridge_{VERSION}_amd64.deb"
    check(deb.exists(), "deb exists")
    members = parse_ar(deb)
    check(list(members.keys()) == ["debian-binary", "control.tar.gz", "data.tar.gz"], "deb ar member order and names")
    check(members["debian-binary"] == b"2.0\n", "debian-binary version 2.0")

    control_tar = tarfile.open(fileobj=io.BytesIO(members["control.tar.gz"]), mode="r:gz")
    control_names = control_tar.getnames()
    check("./control" in control_names, "control.tar.gz contains ./control")
    check("./md5sums" in control_names, "control.tar.gz contains ./md5sums")
    control = control_tar.extractfile("./control").read().decode("utf-8")
    check("Package: qrbridge" in control, "control Package")
    check(f"Version: {VERSION}" in control, "control Version")
    check("Architecture: amd64" in control, "control Architecture")
    check("Description: 码桥" in control, "control Chinese description")
    check("Depends:" not in control, "control has no runtime Depends")
    check("Installed-Size:" in control, "control Installed-Size")
    md5sums = control_tar.extractfile("./md5sums").read().decode("utf-8").splitlines()
    check(len(md5sums) >= 12, "md5sums lists data files")

    data_tar = tarfile.open(fileobj=io.BytesIO(members["data.tar.gz"]), mode="r:gz")
    names = data_tar.getnames()
    expected = {
        "./usr/bin/qrbridge",
        "./usr/share/applications/qrbridge.desktop",
        "./usr/share/icons/hicolor/scalable/apps/qrbridge.svg",
        "./usr/share/doc/qrbridge/README.md",
        "./usr/share/doc/qrbridge/SIGNING.md",
        "./usr/share/doc/qrbridge/LICENSE",
        "./usr/share/doc/qrbridge/copyright",
        "./usr/share/doc/qrbridge/THIRD_PARTY_NOTICES.md",
        "./usr/share/doc/qrbridge/licenses/jsQR-Apache-2.0.txt",
        "./usr/share/doc/qrbridge/licenses/fflate-MIT.txt",
    }
    check(expected.issubset(set(names)), "deb data tree contains required files")
    for name in names:
        check(not name.startswith("/"), f"data path not absolute: {name}")
        check(".." not in Path(name).parts, f"data path has no traversal: {name}")
    binary = data_tar.extractfile("./usr/bin/qrbridge").read()
    check(binary[:4] == b"\x7fELF", "installed binary is ELF")
    check(data_tar.getmember("./usr/bin/qrbridge").mode == 0o755, "installed binary is executable")
    desktop = data_tar.extractfile("./usr/share/applications/qrbridge.desktop").read().decode("utf-8")
    check("Exec=/usr/bin/qrbridge" in desktop, "desktop Exec")
    check("Type=Application" in desktop, "desktop Type")
    check("Icon=/usr/share/icons/hicolor/scalable/apps/qrbridge.svg" in desktop, "desktop absolute icon")
    svg = data_tar.extractfile("./usr/share/icons/hicolor/scalable/apps/qrbridge.svg").read()
    check(svg.lstrip().startswith(b"<svg"), "desktop icon is SVG")

    for line in md5sums:
        digest, name = line.split("  ", 1)
        content = data_tar.extractfile("./" + name).read()
        check(hashlib.md5(content).hexdigest() == digest, f"md5sum matches {name}")


def validate_elf() -> None:
    path = DIST / "qrbridge-linux-amd64"
    data = path.read_bytes()
    check(data[:4] == b"\x7fELF", "linux binary ELF magic")
    check(data[4] == 2 and data[5] == 1, "linux binary ELF64 little-endian")
    e_type, e_machine = struct.unpack_from("<HH", data, 16)
    check(e_type == 2, "linux binary is ET_EXEC")
    check(e_machine == 0x3E, "linux binary is x86-64")
    e_phoff = struct.unpack_from("<Q", data, 32)[0]
    e_phentsize, e_phnum = struct.unpack_from("<HH", data, 54)
    segments = []
    for index in range(e_phnum):
        offset = e_phoff + index * e_phentsize
        p_type = struct.unpack_from("<I", data, offset)[0]
        segments.append(p_type)
    check(3 not in segments, "linux binary has no PT_INTERP (statically linked)")
    check(2 not in segments, "linux binary has no PT_DYNAMIC")
    check(1 in segments, "linux binary has a loadable segment")
    check(b"go1." in data, "linux binary reports Go runtime")


def validate_pe() -> None:
    path = DIST / "QRBridge.exe"
    data = path.read_bytes()
    check(data[:2] == b"MZ", "windows binary MZ header")
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    check(data[pe_offset:pe_offset + 4] == b"PE\0\0", "windows binary PE signature")
    machine = struct.unpack_from("<H", data, pe_offset + 4)[0]
    check(machine == 0x8664, "windows binary x86-64")
    optional_offset = pe_offset + 24
    magic = struct.unpack_from("<H", data, optional_offset)[0]
    check(magic == 0x20B, "windows binary PE32+")
    subsystem = struct.unpack_from("<H", data, optional_offset + 68)[0]
    check(subsystem == 2, "windows binary is GUI subsystem (no console window)")


def validate_archives() -> None:
    tar_path = DIST / f"qrbridge-{VERSION}-linux-amd64.tar.gz"
    with tarfile.open(tar_path, "r:gz") as tar:
        names = tar.getnames()
        prefix = f"qrbridge-{VERSION}-linux-amd64/"
        for rel, mode in [
            ("qrbridge", 0o755),
            ("install.sh", 0o755),
            ("install-user.sh", 0o755),
            ("uninstall-user.sh", 0o755),
            ("sign-uos.sh", 0o755),
            ("run.sh", 0o755),
            ("run-safe.sh", 0o755),
            ("diagnose.sh", 0o755),
            ("README.md", 0o644),
            ("SIGNING.md", 0o644),
        ]:
            check(prefix + rel in names, f"portable tar contains {rel}")
            check(tar.getmember(prefix + rel).mode == mode, f"portable tar mode {rel}")

    win_zip = DIST / f"QRBridge-{VERSION}-windows-x64.zip"
    with zipfile.ZipFile(win_zip) as archive:
        names = archive.namelist()
        prefix = f"QRBridge-{VERSION}-windows-x64/"
        check(prefix + "QRBridge.exe" in names, "windows zip contains exe")
        check(prefix + "README.md" in names, "windows zip contains README")
        check(prefix + "SIGNING.md" in names, "windows zip contains SIGNING")
        check(prefix + "LICENSES/fflate-MIT.txt" in names, "windows zip contains fflate license")
        check(archive.read(prefix + "QRBridge.exe")[:2] == b"MZ", "zip exe is PE")

    source_zip = DIST / f"QRBridge-{VERSION}-source.zip"
    with zipfile.ZipFile(source_zip) as archive:
        names = set(archive.namelist())
        prefix = f"QRBridge-{VERSION}-source/"
        for rel in [
            "app/main.go",
            "app/go.mod",
            "app/web/index.html",
            "app/web/app.js",
            "app/web/core.js",
            "app/web/vendor/qrcode.js",
            "app/web/vendor/jsQR.min.js",
            "app/web/vendor/fflate.min.js",
            "packaging/build_deb.py",
            "packaging/build_archives.py",
            "packaging/install-user.sh",
            "packaging/sign-uos.sh",
            "packaging/build_python_portable.py",
            "python-server/server.py",
            "tests/selftest.html",
            "tests/e2e.js",
            "tests/camera_e2e.js",
            "tests/make_camera_fixture.js",
            "build.ps1",
            "README.md",
            "SIGNING.md",
        ]:
            check(prefix + rel in names, f"source zip contains {rel}")


def validate_checksums() -> None:
    path = DIST / "SHA256SUMS.txt"
    check(path.exists(), "SHA256SUMS exists")
    lines = path.read_text(encoding="utf-8").splitlines()
    check(len(lines) >= 5, "SHA256SUMS has at least five entries")
    for line in lines:
        digest, name = line.split("  ", 1)
        check(sha256((DIST / name).read_bytes()) == digest, f"sha256 matches {name}")


def validate_extra_packages() -> None:
    python_tar = DIST / f"qrbridge-python-{VERSION}.tar.gz"
    with tarfile.open(python_tar, "r:gz") as tar:
        names = tar.getnames()
        prefix = f"qrbridge-python-{VERSION}/"
        for rel, mode in [
            ("server.py", 0o644),
            ("run.sh", 0o755),
            ("install-user.sh", 0o755),
            ("web/index.html", 0o644),
            ("web/app.js", 0o644),
        ]:
            check(prefix + rel in names, f"python package contains {rel}")
            check(tar.getmember(prefix + rel).mode == mode, f"python package mode {rel}")

    diag_tar = DIST / f"qrbridge-diag-{VERSION}.tar.gz"
    with tarfile.open(diag_tar, "r:gz") as tar:
        names = tar.getnames()
        prefix = f"qrbridge-diag-{VERSION}/"
        for rel in ["run.sh", "README.txt", "hello-go122", "hello-go122-pie", "qrbridge-pie"]:
            check(prefix + rel in names, f"diagnostic package contains {rel}")


def validate_no_remote_runtime() -> None:
    for rel in ["app/web/index.html", "app/web/app.js", "app/web/core.js", "app/web/style.css"]:
        text = (ROOT / rel).read_text(encoding="utf-8")
        for needle in ["http://", "https://", "cdn.", "unpkg", "cdnjs"]:
            check(needle not in text, f"{rel} has no {needle}")


def validate_protocol_notes() -> None:
    core = (ROOT / "app/web/core.js").read_text(encoding="utf-8")
    check("QFT2" in core, "core uses QFT2 protocol")
    check("bytesToBase32" in core, "core has Base32")
    check("gzipBytes" in core, "core has gzip")
    check("DEFAULT_CHANNELS = 4" in core, "core defaults to four channels")
    readme = (ROOT / "README.md").read_text(encoding="utf-8")
    check("4 路" in readme, "README documents four channels")
    check("SIGNING.md" in readme, "README links signing note")


def main() -> None:
    validate_deb()
    validate_elf()
    validate_pe()
    validate_archives()
    validate_checksums()
    validate_extra_packages()
    validate_no_remote_runtime()
    validate_protocol_notes()
    if ERRORS:
        print(f"\n{len(ERRORS)} validation failure(s)")
        sys.exit(1)
    print("\nALL ARTIFACT CHECKS PASSED")


if __name__ == "__main__":
    main()
