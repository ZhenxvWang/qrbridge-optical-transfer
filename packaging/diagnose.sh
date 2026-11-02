#!/bin/sh
# 码桥兼容性诊断。把完整输出发给维护者即可定位启动问题。
set -u
BIN="${1:-$HOME/.local/opt/qrbridge/qrbridge}"

echo "===== 码桥诊断 $(date) ====="
echo "--- uname ---"
uname -a
echo "--- os-release ---"
cat /etc/os-release 2>/dev/null || true
echo "--- CPU ---"
lscpu 2>/dev/null | sed -n '1,35p' || true
echo "--- 二进制 ---"
ls -l "$BIN" 2>/dev/null || true
file "$BIN" 2>/dev/null || true
sha256sum "$BIN" 2>/dev/null || true
echo "--- ELF 头/段 ---"
if command -v readelf >/dev/null 2>&1; then
  readelf -h "$BIN" 2>/dev/null | sed -n '1,20p' || true
  readelf -l "$BIN" 2>/dev/null | grep -E 'INTERP|DYNAMIC|LOAD' || true
fi
echo "--- 直接运行 --version ---"
"$BIN" --version
echo "exit=$?"
echo "--- 安全模式尝试（关闭异步抢占）---"
GODEBUG=asyncpreemptoff=1 "$BIN" --version
echo "exit=$?"
echo "--- core/dmesg 提示 ---"
echo "如果仍段错误，请在终端执行：dmesg | tail -30"
echo "===== 诊断结束 ====="
