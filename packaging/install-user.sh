#!/bin/sh
# 码桥 QR Bridge 用户级安装（无需 root、无需 .deb 签名）
set -eu

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PREFIX="${PREFIX:-$HOME/.local}"
APP="$PREFIX/opt/qrbridge"

mkdir -p "$APP" "$PREFIX/bin" "$PREFIX/share/applications" \
  "$PREFIX/share/doc/qrbridge" "$PREFIX/share/icons/hicolor/scalable/apps"

install -m755 "$HERE/qrbridge" "$APP/qrbridge"
install -m644 "$HERE/qrbridge.svg" "$APP/qrbridge.svg"
for extra in run-safe.sh diagnose.sh; do
  [ -f "$HERE/$extra" ] && install -m755 "$HERE/$extra" "$APP/$extra"
done
ln -sf "$APP/qrbridge" "$PREFIX/bin/qrbridge"

if [ -f "$HERE/qrbridge.desktop" ]; then
  sed \
    -e "s#/usr/bin/qrbridge#$APP/qrbridge#g" \
    -e "s#/usr/share/icons/hicolor/scalable/apps/qrbridge.svg#$APP/qrbridge.svg#g" \
    "$HERE/qrbridge.desktop" > "$PREFIX/share/applications/qrbridge.desktop"
fi

for doc in README.md LICENSE THIRD_PARTY_NOTICES.md SIGNING.md; do
  [ -f "$HERE/$doc" ] && install -m644 "$HERE/$doc" "$PREFIX/share/doc/qrbridge/$doc"
done
if [ -d "$HERE/licenses" ]; then
  mkdir -p "$PREFIX/share/doc/qrbridge/licenses"
  cp -R "$HERE/licenses/." "$PREFIX/share/doc/qrbridge/licenses/"
fi

if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database "$PREFIX/share/applications" >/dev/null 2>&1 || true
fi

echo "安装完成（用户级，无需 root）。"
echo "  程序：$APP/qrbridge"
echo "  命令：$PREFIX/bin/qrbridge"
echo "  启动器：$PREFIX/share/applications/qrbridge.desktop"
echo
echo "现在可以运行："
echo "  $APP/qrbridge"
echo
echo "如果启动器没有立即出现，注销并重新登录，或在终端运行上面的程序。"
