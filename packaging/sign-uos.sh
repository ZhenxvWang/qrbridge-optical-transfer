#!/bin/sh
# 在已安装统信开发者证书的目标 UOS 机器上给 deb 签名。
# 需要：cert-tool 生成的 /usr/share/ca-certificates/deepin/private/priv.{crt,key}
# 以及 deepin-elf-sign-deb 命令。
set -eu

DEB="${1:-}"
if [ -z "$DEB" ] || [ ! -f "$DEB" ]; then
  echo "用法：sh sign-uos.sh qrbridge_2.0.1_amd64.deb"
  exit 2
fi

if ! command -v deepin-elf-sign-deb >/dev/null 2>&1; then
  echo "未找到 deepin-elf-sign-deb。"
  echo "请先在目标 UOS 机器上安装统信证书工具/签名工具，并使用开发者账号生成证书。"
  exit 3
fi

if [ ! -f /usr/share/ca-certificates/deepin/private/priv.crt ] || \
   [ ! -f /usr/share/ca-certificates/deepin/private/priv.key ]; then
  echo "未找到统信开发者证书："
  echo "  /usr/share/ca-certificates/deepin/private/priv.crt"
  echo "  /usr/share/ca-certificates/deepin/private/priv.key"
  echo "请先执行：cert-tool -username=\"UOS账号\" -password=\"UOS密码\""
  exit 4
fi

deepin-elf-sign-deb "$DEB"

echo
echo "签名完成。已签名包通常位于：$(dirname "$DEB")/signed_deb/"
echo "验证：deepin-deb-verify $(dirname "$DEB")/signed_deb/$(basename "$DEB")"
echo "安装：deepin-deb-installer $(dirname "$DEB")/signed_deb/$(basename "$DEB")"
echo
echo "注意：统信开发者调试签名通常只适用于签名的那台机器；多机分发需要统信正式发布签名。"
