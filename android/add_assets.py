#!/usr/bin/env python3
"""Inject APK assets with forward-slash ZIP names.

AAPT2 on Windows may store asset paths with backslashes (for example
`assets\web\android.html`), which Android AssetManager cannot open as
`web/android.html`. Adding the assets with Python's zipfile guarantees
portable `/` separators.
"""
import sys
import zipfile
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit("usage: add_assets.py <apk> <assets-dir>")

apk = Path(sys.argv[1])
assets = Path(sys.argv[2])
with zipfile.ZipFile(apk, "a", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
    existing = set(archive.namelist())
    for path in sorted(assets.rglob("*")):
        if not path.is_file():
            continue
        relative = path.relative_to(assets).as_posix()
        name = "assets/" + relative
        if name in existing:
            continue
        archive.write(path, name)
        existing.add(name)
        print("asset", name)
