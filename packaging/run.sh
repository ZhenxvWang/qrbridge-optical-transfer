#!/bin/sh
# 直接从解压目录运行码桥，不安装。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
[ -x "$HERE/qrbridge" ] || chmod +x "$HERE/qrbridge"
exec "$HERE/qrbridge" "$@"
