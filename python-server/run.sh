#!/bin/sh
# 直接从解压目录运行 Python 兼容版，不安装。
set -eu
HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec python3 "$HERE/server.py" "$@"
