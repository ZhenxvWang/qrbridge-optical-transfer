#!/bin/sh
# 码桥 Python 兼容版：使用系统自带 python3，不需要 Go 运行时。
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX="${PREFIX:-$HOME/.local}"
APP="$PREFIX/opt/qrbridge-python"

if ! command -v python3 >/dev/null 2>&1; then
  echo "未找到 python3。请先在系统上确认 python3 可用。" >&2
  exit 1
fi
PYTHON=$(command -v python3)

mkdir -p "$APP" "$PREFIX/bin" "$PREFIX/share/applications" \
  "$PREFIX/share/doc/qrbridge-python"

cp -R "$HERE/web" "$APP/web"
install -m644 "$HERE/server.py" "$APP/server.py"
install -m644 "$HERE/qrbridge.svg" "$APP/qrbridge.svg"
install -m644 "$HERE/README.md" "$PREFIX/share/doc/qrbridge-python/README.md" 2>/dev/null || true
install -m644 "$HERE/LICENSE" "$PREFIX/share/doc/qrbridge-python/LICENSE" 2>/dev/null || true
install -m644 "$HERE/THIRD_PARTY_NOTICES.md" "$PREFIX/share/doc/qrbridge-python/THIRD_PARTY_NOTICES.md" 2>/dev/null || true
install -m644 "$HERE/LICENSE-AGPL-3.0.txt" "$PREFIX/share/doc/qrbridge-python/LICENSE-AGPL-3.0.txt" 2>/dev/null || true
install -m644 "$HERE/FOUNTAIN_NOTICE.md" "$PREFIX/share/doc/qrbridge-python/FOUNTAIN_NOTICE.md" 2>/dev/null || true
install -m644 "$HERE/SIGNING.md" "$PREFIX/share/doc/qrbridge-python/SIGNING.md" 2>/dev/null || true
if [ -d "$HERE/licenses" ]; then
  mkdir -p "$PREFIX/share/doc/qrbridge-python/licenses"
  cp -R "$HERE/licenses/." "$PREFIX/share/doc/qrbridge-python/licenses/"
fi

cat > "$PREFIX/bin/qrbridge-python" <<EOF
#!/bin/sh
exec "$PYTHON" "$APP/server.py" "\$@"
EOF
chmod 755 "$PREFIX/bin/qrbridge-python"

cat > "$PREFIX/share/applications/qrbridge-python.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=码桥（Python 兼容版）
Name[en_US]=QR Bridge (Python)
Comment=离线二维码文件传输，使用系统 Python3
Comment[en_US]=Offline QR file transfer using system Python3
Exec="$PYTHON" "$APP/server.py"
TryExec=$PYTHON
Icon=$APP/qrbridge.svg
Terminal=false
Categories=Utility;FileTools;
Keywords=QR;二维码;文件传输;offline;airgap;
StartupNotify=true
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi

echo "安装完成（Python 兼容版，无需 root）。"
echo "  程序：$APP/server.py"
echo "  命令：$PREFIX/bin/qrbridge-python"
echo "  启动器：$PREFIX/share/applications/qrbridge-python.desktop"
echo
echo "运行：$PREFIX/bin/qrbridge-python"
