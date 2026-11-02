#!/usr/bin/env python3
"""Build the Python3 compatibility package (no Go runtime)."""

from __future__ import annotations

import argparse
import gzip
import hashlib
import io
import tarfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PY = ROOT / "python-server"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def add_file(tar: tarfile.TarFile, name: str, data: bytes, mode: int) -> None:
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


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--version", default="2.0.1")
    args = parser.parse_args()

    name = f"qrbridge-python-{args.version}"
    files: list[tuple[str, bytes, int]] = [
        (f"{name}/server.py", (PY / "server.py").read_bytes(), 0o644),
        (f"{name}/run.sh", (PY / "run.sh").read_bytes(), 0o755),
        (f"{name}/install-user.sh", (PY / "install-user.sh").read_bytes(), 0o755),
        (f"{name}/uninstall-user.sh", (PY / "uninstall-user.sh").read_bytes(), 0o755),
        (f"{name}/README.md", (PY / "README.md").read_bytes(), 0o644),
        (f"{name}/SIGNING.md", (ROOT / "SIGNING.md").read_bytes(), 0o644),
        (f"{name}/LICENSE", (ROOT / "LICENSE").read_bytes(), 0o644),
        (f"{name}/LICENSE-AGPL-3.0.txt", (ROOT / "LICENSE-AGPL-3.0.txt").read_bytes(), 0o644),
        (f"{name}/FOUNTAIN_NOTICE.md", (ROOT / "FOUNTAIN_NOTICE.md").read_bytes(), 0o644),
        (f"{name}/THIRD_PARTY_NOTICES.md", (ROOT / "THIRD_PARTY_NOTICES.md").read_bytes(), 0o644),
        (f"{name}/qrbridge.svg", (ROOT / "app/web/icon.svg").read_bytes(), 0o644),
        (
            f"{name}/licenses/jsQR-Apache-2.0.txt",
            (ROOT / "app/web/vendor/LICENSE-jsQR.txt").read_bytes(),
            0o644,
        ),
        (
            f"{name}/licenses/fflate-MIT.txt",
            (ROOT / "app/web/vendor/LICENSE-fflate.txt").read_bytes(),
            0o644,
        ),
        (
            f"{name}/licenses/qrcode-generator-NOTICE.txt",
            (ROOT / "app/web/vendor/LICENSE-qrcode.txt").read_bytes(),
            0o644,
        ),
        (
            f"{name}/licenses/zstd-NOTICE.txt",
            (ROOT / "app/web/vendor/LICENSE-zstd.txt").read_bytes(),
            0o644,
        ),
    ]
    for path in sorted((ROOT / "app/web").rglob("*")):
        if path.is_file():
            rel = path.relative_to(ROOT / "app/web").as_posix()
            files.append((f"{name}/web/{rel}", path.read_bytes(), 0o644))

    output = ROOT / "dist" / f"{name}.tar.gz"
    raw = io.BytesIO()
    with tarfile.open(fileobj=raw, mode="w", format=tarfile.USTAR_FORMAT) as tar:
        add_dir(tar, name)
        add_dir(tar, f"{name}/web")
        directories = sorted(
            {str(Path(rel).parent).replace("\\", "/") for rel, _, _ in files if "/" in rel}
        )
        for directory in directories:
            if directory not in (name, f"{name}/web"):
                add_dir(tar, directory)
        for rel, data, mode in files:
            add_file(tar, rel, data, mode)
    with output.open("wb") as handle:
        with gzip.GzipFile(filename="", mode="wb", fileobj=handle, mtime=0) as gz:
            gz.write(raw.getvalue())
    print(f"wrote {output} ({output.stat().st_size} bytes, sha256 {sha256(output)})")


if __name__ == "__main__":
    main()
