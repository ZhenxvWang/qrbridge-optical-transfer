#!/bin/sh
# 移除用户级安装的码桥。不会删除用户下载的文件。
set -eu
PREFIX="${PREFIX:-$HOME/.local}"
rm -rf "$PREFIX/opt/qrbridge"
rm -f "$PREFIX/bin/qrbridge"
rm -f "$PREFIX/share/applications/qrbridge.desktop"
rm -rf "$PREFIX/share/doc/qrbridge"
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi
echo "已移除用户级安装：$PREFIX/opt/qrbridge"
