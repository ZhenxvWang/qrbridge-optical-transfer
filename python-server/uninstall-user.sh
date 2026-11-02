#!/bin/sh
# 移除用户级安装的 Python 兼容版。
set -eu
PREFIX="${PREFIX:-$HOME/.local}"
rm -rf "$PREFIX/opt/qrbridge-python"
rm -f "$PREFIX/bin/qrbridge-python"
rm -f "$PREFIX/share/applications/qrbridge-python.desktop"
rm -rf "$PREFIX/share/doc/qrbridge-python"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi
echo "已移除 Python 兼容版。"
