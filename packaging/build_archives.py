#!/usr/bin/env python3
"""Create the portable Linux tarball, Windows zip and source zip."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import re
import tarfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_tar_file(tar: tarfile.TarFile, arcname: str, data: bytes, mode: int) -> None:
    info = tarfile.TarInfo(arcname)
    info.size = len(data)
    info.mode = mode
    info.uid = 0
    info.gid = 0
    info.uname = "root"
    info.gname = "root"
    info.mtime = 0
    tar.addfile(info, io.BytesIO(data))


def make_tar_gz(files: list[tuple[str, bytes, int]], output: Path) -> None:
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        directories = sorted({str(Path(name).parent).replace("\\", "/") for name, _, _ in files})
        for directory in directories:
            if directory in ("", "."):
                continue
            info = tarfile.TarInfo(directory)
            info.type = tarfile.DIRTYPE
            info.mode = 0o755
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            info.mtime = 0
            tar.addfile(info)
        for name, data, mode in files:
            add_tar_file(tar, name, data, mode)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, mtime=0) as gz:
            gz.write(raw.getvalue())


def add_zip_file(archive: zipfile.ZipFile, arcname: str, data: bytes, mode: int = 0o644) -> None:
    info = zipfile.ZipInfo(arcname)
    info.date_time = (2026, 1, 1, 0, 0, 0)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = (mode & 0xFFFF) << 16
    archive.writestr(info, data)


def build_portable(version: str) -> Path:
    name = f"qrbridge-{version}-linux-amd64"
    payloads = {
        "qrbridge": ((ROOT / "dist/qrbridge-linux-amd64").read_bytes(), 0o755),
        "qrbridge.desktop": ((ROOT / "packaging/qrbridge.desktop").read_bytes(), 0o644),
        "qrbridge.svg": ((ROOT / "app/web/icon.svg").read_bytes(), 0o644),
        "install.sh": ((ROOT / "packaging/install.sh").read_bytes(), 0o755),
        "install-user.sh": ((ROOT / "packaging/install-user.sh").read_bytes(), 0o755),
        "uninstall-user.sh": ((ROOT / "packaging/uninstall-user.sh").read_bytes(), 0o755),
        "sign-uos.sh": ((ROOT / "packaging/sign-uos.sh").read_bytes(), 0o755),
        "run.sh": ((ROOT / "packaging/run.sh").read_bytes(), 0o755),
        "run-safe.sh": ((ROOT / "packaging/run-safe.sh").read_bytes(), 0o755),
        "diagnose.sh": ((ROOT / "packaging/diagnose.sh").read_bytes(), 0o755),
        "README.md": ((ROOT / "README.md").read_bytes(), 0o644),
        "SIGNING.md": ((ROOT / "SIGNING.md").read_bytes(), 0o644),
        "LICENSE": ((ROOT / "LICENSE").read_bytes(), 0o644),
        "LICENSE-AGPL-3.0.txt": ((ROOT / "LICENSE-AGPL-3.0.txt").read_bytes(), 0o644),
        "FOUNTAIN_NOTICE.md": ((ROOT / "FOUNTAIN_NOTICE.md").read_bytes(), 0o644),
        "THIRD_PARTY_NOTICES.md": ((ROOT / "THIRD_PARTY_NOTICES.md").read_bytes(), 0o644),
        "licenses/jsQR-Apache-2.0.txt": ((ROOT / "app/web/vendor/LICENSE-jsQR.txt").read_bytes(), 0o644),
        "licenses/fflate-MIT.txt": ((ROOT / "app/web/vendor/LICENSE-fflate.txt").read_bytes(), 0o644),
        "licenses/MIT.txt": ((ROOT / "LICENSE").read_bytes(), 0o644),
        "licenses/qrcode-generator-NOTICE.txt": ((ROOT / "app/web/vendor/LICENSE-qrcode.txt").read_bytes(), 0o644),
    }
    files = [(f"{name}/{rel}", data, mode) for rel, (data, mode) in payloads.items()]
    output = ROOT / "dist" / f"{name}.tar.gz"
    make_tar_gz(files, output)
    return output


def build_windows_zip(version: str) -> Path:
    name = f"QRBridge-{version}-windows-x64"
    output = ROOT / "dist" / f"{name}.zip"
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        add_zip_file(archive, f"{name}/QRBridge.exe", (ROOT / "dist/QRBridge.exe").read_bytes(), 0o755)
        add_zip_file(archive, f"{name}/README.md", (ROOT / "README.md").read_bytes())
        add_zip_file(archive, f"{name}/SIGNING.md", (ROOT / "SIGNING.md").read_bytes())
        add_zip_file(archive, f"{name}/LICENSE", (ROOT / "LICENSE").read_bytes())
        add_zip_file(archive, f"{name}/LICENSE-AGPL-3.0.txt", (ROOT / "LICENSE-AGPL-3.0.txt").read_bytes())
        add_zip_file(archive, f"{name}/FOUNTAIN_NOTICE.md", (ROOT / "FOUNTAIN_NOTICE.md").read_bytes())
        add_zip_file(archive, f"{name}/THIRD_PARTY_NOTICES.md", (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes())
        add_zip_file(archive, f"{name}/LICENSES/jsQR-Apache-2.0.txt", (ROOT / "app/web/vendor/LICENSE-jsQR.txt").read_bytes())
        add_zip_file(archive, f"{name}/LICENSES/fflate-MIT.txt", (ROOT / "app/web/vendor/LICENSE-fflate.txt").read_bytes())
        add_zip_file(archive, f"{name}/LICENSES/MIT.txt", (ROOT / "LICENSE").read_bytes())
        add_zip_file(
            archive,
            f"{name}/LICENSES/qrcode-generator-NOTICE.txt",
            (ROOT / "app/web/vendor/LICENSE-qrcode.txt").read_bytes(),
        )
    return output


def build_source_zip(version: str) -> Path:
    name = f"QRBridge-{version}-source"
    output = ROOT / "dist" / f"{name}.zip"
    selected: list[tuple[str, Path, int]] = []
    for rel in [
        "README.md",
        "SIGNING.md",
        "LICENSE",
        "LICENSE-AGPL-3.0.txt",
        "FOUNTAIN_NOTICE.md",
        "THIRD_PARTY_NOTICES.md",
        "build.ps1",
    ]:
        selected.append((rel, ROOT / rel, 0o644))

    for directory, mode in [
        ("app", 0o755),
        ("packaging", 0o755),
        ("python-server", 0o755),
        ("android", 0o755),
        ("tests", 0o755),
    ]:
        for path in sorted((ROOT / directory).rglob("*")):
            if path.is_file() and "__pycache__" not in path.parts:
                if "build" in path.parts or path.name.endswith(".keystore"):
                    continue
                exec_mode = 0o755 if path.suffix in (".sh", ".ps1") or path.name == "build.ps1" else 0o644
                selected.append((str(path.relative_to(ROOT)).replace("\\", "/"), path, exec_mode))

    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for rel, path, mode in selected:
            add_zip_file(archive, f"{name}/{rel}", path.read_bytes(), mode)
    return output


def write_checksums() -> Path:
    lines = []
    for path in sorted((ROOT / "dist").iterdir()):
        if not path.is_file() or not re.match(r"^(qrbridge|QRBridge)", path.name):
            continue
        lines.append(f"{sha256(path)}  {path.name}")
    output = ROOT / "dist" / "SHA256SUMS.txt"
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return output


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="2.0.1")
    args = parser.parse_args()

    for required in ["dist/qrbridge-linux-amd64", "dist/QRBridge.exe"]:
        if not (ROOT / required).exists():
            raise SystemExit(f"missing {required}; run the Go build first")

    outputs = [
        build_portable(args.version),
        build_windows_zip(args.version),
        build_source_zip(args.version),
    ]
    checksums = write_checksums()
    for output in outputs:
        print(f"wrote {output} ({output.stat().st_size} bytes, sha256 {sha256(output)})")
    print(f"wrote {checksums}")


if __name__ == "__main__":
    main()
