#!/bin/sh
# 兼容模式启动：关闭 Go 异步抢占，遇到极老 CPU/内核时可尝试。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
GODEBUG="${GODEBUG:-asyncpreemptoff=1}" exec "$HERE/qrbridge" "$@"
