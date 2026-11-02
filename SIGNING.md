# 关于 UOS 安装包签名

## 结论：无法由第三方生成“统信认可的合法签名”

统信 UOS 的 `.deb` 安装校验不是普通 Debian 的 `debsigs` 或 apt 仓库签名，而是
**deepin/统信自己的包签名机制**：

1. 在 UOS 上通过应用商店安装“证书工具”；
2. 用**统信开发者账号**执行 `cert-tool -username=... -password=...` 生成开发者证书；
3. 用 `deepin-elf-sign-deb` 给 deb 签名；
4. 用 `deepin-deb-verify` 验证，或通过 `deepin-deb-installer` 安装。

官方文档还明确说明：**开发者调试签名仅限签发证书的那台机器安装**。正式对外分发还需要统信工作人员完成最终发布签名。

因此：

- 没有统信签发的证书和私钥，任何个人或第三方都**不能**生成被 UOS 安装器信任的签名；
- 用自签名证书、GPG、`debsigs` 或伪造证书签出来的包，**不会**被 UOS 安装器视为“合法签名”；
- 本项目的构建环境没有、也不应该持有你的统信开发者账号或私钥，所以**不能提供合法的已签名 deb**；
- 通过修改系统策略、关闭校验、替换证书等方式绕过签名限制，不属于本项目的交付范围，也不建议在办公/生产终端上这样做。

## 推荐方案：用户级免安装包（不需要 root，不需要 deb 签名）

使用 `qrbridge-2.0.1-linux-amd64.tar.gz`：

```bash
tar -xzf qrbridge-2.0.1-linux-amd64.tar.gz
cd qrbridge-2.0.1-linux-amd64
sh install-user.sh
```

它会把程序安装到：

```text
~/.local/opt/qrbridge/
~/.local/bin/qrbridge
~/.local/share/applications/qrbridge.desktop
```

不经过包管理器，不修改系统目录，不要求 root，也不需要开发者模式。  
也可以不安装，直接运行：

```bash
sh run.sh
```

如果系统安全策略仍然禁止执行未知二进制，只能由系统管理员放行，或使用统信官方签名渠道。

## 如果你们能拿到统信开发者证书

请在**目标 UOS 机器**上按官方流程操作：

```bash
# 1. 从 UOS 应用商店安装“证书工具”
# 2. 使用统信开发者账号生成证书
cert-tool -username="你的UOS开发者账号" -password="你的UOS开发者密码"

# 3. 安装生成的开发者证书（按弹窗提示）
# 4. 给 deb 签名（也可用便携包里的 sign-uos.sh）
deepin-elf-sign-deb qrbridge_2.0.1_amd64.deb

# 5. 验证并安装
deepin-deb-verify signed_deb/qrbridge_2.0.1_amd64.deb
deepin-deb-installer signed_deb/qrbridge_2.0.1_amd64.deb
```

注意：官方文档说明开发者调试签名**仅限签名的那台机器**使用。若要给多台内网机器安装，需要走统信正式发布签名流程，或逐台用各自的开发者证书签名。

## 未签名 deb 的用途

`qrbridge_2.0.1_amd64.deb` 仍然随包提供，但它**没有统信认可的签名**，只适合：

- 已允许 `dpkg -i` 的环境；
- 测试机、开发机；
- 由管理员自行完成签名/分发流程的环境。

安装命令：

```bash
sudo dpkg -i qrbridge_2.0.1_amd64.deb
```

如果系统策略拦截，请改用上面的用户级安装包，而不是尝试关闭系统安全机制。

## 完整性校验

所有发布文件都可以用 `SHA256SUMS.txt` 校验：

```bash
sha256sum -c SHA256SUMS.txt
```

这只证明文件与发布时一致，**不等于** UOS 安装器认可的代码签名。

## 参考

- [统信/深度开发者文档：开发者调试签名](https://docs.deepin.org/info/%E5%BC%80%E5%8F%91%E8%BF%9B%E9%98%B6/%E5%BA%94%E7%94%A8%E5%95%86%E5%BA%97/%E5%BA%94%E7%94%A8%E5%88%86%E5%8F%91/%E5%BA%94%E7%94%A8%E5%88%86%E5%8F%91/%E5%BC%80%E5%8F%91%E8%80%85%E8%B0%83%E8%AF%95%E7%AD%BE%E5%90%8D)
- [TaylorShi：统信 UOS 下开发者签名指南](https://www.cnblogs.com/taylorshi/p/16223913.html)
