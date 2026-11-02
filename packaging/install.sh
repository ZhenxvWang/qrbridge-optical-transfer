#!/bin/sh
# 码桥 QR Bridge 便携版安装脚本（统信 UOS / Debian 系）
set -eu

if [ "$(id -u)" -ne 0 ]; then
  echo "请使用 root 权限安装："
  echo "  sudo sh install.sh"
  exit 1
fi

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

install -Dm755 "$HERE/qrbridge" /usr/bin/qrbridge
install -Dm644 "$HERE/qrbridge.desktop" /usr/share/applications/qrbridge.desktop
install -Dm644 "$HERE/qrbridge.svg" /usr/share/icons/hicolor/scalable/apps/qrbridge.svg
install -d /usr/share/doc/qrbridge
install -m644 "$HERE/README.md" /usr/share/doc/qrbridge/README.md
install -m644 "$HERE/SIGNING.md" /usr/share/doc/qrbridge/SIGNING.md
install -m644 "$HERE/LICENSE" /usr/share/doc/qrbridge/LICENSE
install -m644 "$HERE/THIRD_PARTY_NOTICES.md" /usr/share/doc/qrbridge/THIRD_PARTY_NOTICES.md
if [ -d "$HERE/licenses" ]; then
  install -d /usr/share/doc/qrbridge/licenses
  cp -R "$HERE/licenses/." /usr/share/doc/qrbridge/licenses/
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database /usr/share/applications >/dev/null 2>&1 || true
fi

echo "安装完成。请在应用菜单中打开“码桥”，或在终端运行："
echo "  qrbridge"
echo "卸载：sudo rm -f /usr/bin/qrbridge /usr/share/applications/qrbridge.desktop"
