# Mira 本地反代（Windows）

GalAgent 附带的可选独立适配器，将本机已登录的 Mira 连接为 OpenAI Chat Completions 兼容接口。当前适配表最新支持 **Mira 0.0.771**，默认模型为 `kimi-k3`，服务仅监听 `127.0.0.1`。这是社区适配代码，不是 Mira 官方组件。

## 使用

1. 准备 Node.js 24，在同一 Windows 用户下安装并登录 Mira。
2. 将本目录解压到可写目录，用 PowerShell 运行 `./start.ps1`。
3. 首次启动自动生成 `.local-api-key`。在 GalAgent「连接」中选择 Mira 模式，基础地址填写 `http://127.0.0.1:18890/v1`，模型填写 `kimi-k3`，Key 使用该文件中的本机密钥。
4. 停止服务时运行 `./stop.ps1`。修改文件或升级适配器之前先停止旧进程。

也可以运行 `node proxy.cjs`，在当前终端观察启动情况。该目录没有额外 npm 依赖。GalAgent 自动查找反代的功能依赖约定安装位置；解压到其他位置时，请先手动启动反代。

可通过 `MIRA_PROXY_PORT` 更换端口。默认读取 Mira 正式安装目录；需要选择保留在 `.mirasim/app/` 下的特定版本时，可设置 `MIRA_BUNDLE_VERSION`。只支持代码中列出的文件 SHA-256，未知版本会拒绝启动，需要重新适配。

## 数据与兼容范围

- 每位使用者需要自己的 Mira 登录态和可用额度。适配器读取本机登录材料，在内存中完成认证，不附带其他人的账号。
- 分发目录只含源码、说明和离线测试，不含密钥、登录材料、日志、备份或 Mira 安装文件。
- 支持 `/health`、`/v1/models`、`/v1/chat/completions`，需要本地 Bearer Key；普通 JSON、SSE 和工具协议透传。工具由调用方执行，反代不执行模型工具调用。
- `kimi-code/k3`、`kimi-k3`、`k3` 映射到 K3；代码保留 K3.1 别名，是否可用取决于服务端与账号。
- 0.0.771 的历史本机验证覆盖真实普通回复、未授权 401 和未知模型 400；不代表所有模型、工具、长上下文和并发组合都已验证。Mira 后续更新可能使适配失效。

离线测试：`node --test proxy.test.cjs`。测试模拟 Mira 认证与上游服务，不读取真实登录数据、不消耗额度。

`.local-api-key`、日志及 `runtime-selection.json` 都是本机文件，请勿提交或转发。
