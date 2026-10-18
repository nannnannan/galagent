# Kimi K3 接口合同核验

2026-10-09。直接读取当前 Moonshot 官方文档，没有调用账户 API。

本轮纠正初版通用 Chat Completions 参数：K3 始终思考，使用请求顶层 `reasoning_effort: low`；输出预算使用 `max_completion_tokens`，本版设置 4096；固定采样参数不再显式传入。JSON Mode 的 `json_object` 有官方 K3 示例支持。

K3 的多轮消息合同要求保留完整原始 assistant message。程序现在将它作为私有传输记录保存，后续按同一提供方的完整问答对重放，并把整个原始对象计入 6k 应用估算预算。原始推理与 opaque 字段不显示在人像对话，不作为事实、不送入事实抽取；普通导出不包含私有模型历史。

恢复普通存档后没有原始模型传输记录时，程序使用有来源、有限长度的可见历史数据续接，不从可见台词伪造“原始 assistant”。删除来源、回复及引用它们的后续私有缓存也一起清理。

17 项核心测试已包含 K3 参数、完整原消息重放、长推理整对裁剪、导出隔离、删除传播、恢复续接、非 K3 参数分支及截断失败提示。测试使用合成响应；它们不能证明本机账户具有 K3 权限或真实表达质量。

来源：

- [Kimi K3 快速开始](https://platform.moonshot.cn/docs/guide/kimi-k3-quickstart)
- [思考模型与保留式思考](https://platform.moonshot.cn/docs/guide/use-thinking-models)
- [Kimi JSON Mode](https://platform.moonshot.cn/docs/guide/use-json-mode-feature-of-kimi-api)

当前仍缺本项目可用 API Key。账户调用、真实延迟、JSON 遵从率与人物相处体验保留待验，不能用 localhost fixture 覆盖。
