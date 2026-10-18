# OpenAI兼容API与Kimi工具适配

修订：OPENAI-KIMI-TOOLS-20261010。软件实现与95项测试通过，真实K3的Read/Edit/Read及图像回传通过；正式运行包在release/openai-tools/win-unpacked。启动入口指向该包。旧CLI/ACP实验不是正式执行路径。

目标：完成用户给定25个Kimi Code 0.29.2工具的名称、参数和结果协议兼容，执行、并行和角色框架由GalAgent负责。不启动kimi.exe/ACP，不搭建或修改反代。Live2D仍未启动。

原始文档：<USER_PROFILE>/Desktop/mira反代/KimiCode-K3-反代工具适配完整文档.md。接口http://127.0.0.1:18890/v1，模型kimi-code/k3。25个原始定义内嵌runtime/assets/protocol/kimi-code-tools-0.29.2.json，原始schema不重命名、不把path改成file_path。

## 当前实现与验收责任

- tool-protocol.ts：JSON与SSE；按choice/call index拼接；usage、reasoning_content、assistant扩展字段保留；结束标记/参数不完整时不执行。
- openai-agent.ts：真实Chat Completions循环；assistant先入历史，每个tool_call_id分别回传；完整原始执行历史私有存档；长窗口按完整工具轮压缩，不把半个调用当成功。模型请求并发默认2，子代理最大3层，AgentSwarm独占工具调用批次；这是我们的编排规则。
- tool-host.ts：25工具均有本地后端，原始schema校验；读后写与陈旧读取保护、搜索过滤、Git Bash与进程归属、任务查询/输出/取消、图像与视频帧、URL、Skill、Todo/Goal/预算、计划、提问、子代理与恢复、Cron。
- companion/main/renderer：默认正式执行器为OpenAI工具适配；主角色仅委派/接收摘要，不注入全部工具日志；任务入口、目录配置、取消、问题回答与计划选择均走受校验IPC。

## 可核验边界

全套95项测试通过，其中22项适配测试覆盖全部25工具名以及SSE、真实文件/搜索/进程/媒体、计划/提问、独立状态、子代理并发、后台推送顺序、预算、重启恢复、模型切换隔离和Cron实际派发。类型与生产构建通过。真实K3测试发送25个原始schema并完成Read/Edit/Read，文件与最后回答一致；原始推理历史回传；ReadMediaFile图像真实回传并识别颜色。

| 工具组 | 对应验证 |
|---|---|
| Read / Write / Edit | 行号、CRLF、读后写、陈旧写拒绝、唯一替换；真实K3修改并复读 |
| Glob / Grep | 实际ripgrep、分页、过滤、无效正则 |
| Bash / TaskList / TaskOutput / TaskStop | 实际Git Bash与自有进程、后台状态/输出/取消/归属 |
| ReadMediaFile / FetchURL / Skill | 实际图像裁切/视频帧、HTTP页面、项目SKILL.md；真实K3图像与打包媒体 |
| TodoList / CreateGoal / GetGoal / UpdateGoal / SetGoalBudget | 独立会话状态、范围校验、预算到达后不执行新副作用 |
| EnterPlanMode / ExitPlanMode / AskUserQuestion | 计划文件限定、真实选择或拒绝；桌面IPC与回答回传 |
| Agent / AgentSwarm | GalAgent自有子会话/恢复/聚合，实际执行自身工具，请求并发上限2 |
| CronCreate / CronList / CronDelete | 本地时间计算、单次/合并/删除，tick真实派发并返回结果 |

证据：[测试日志](evidence/OpenAI工具适配测试.log)、[真实执行器](evidence/OpenAI执行器真实验收.json)、[真实媒体](evidence/OpenAI媒体真实验收.json)、[打包验收](evidence/OpenAI工具打包验收.json)、[打包真实K3](evidence/OpenAI打包真实K3验收.json)。没有把“发送25工具定义”当成全部工具均在云端逐一使用过；全部后端由隔离测试覆盖，真实上游专项验证了文件闭环与媒体格式。打包程序实际通过既有API完成K3→Read→结果回传→最终回答。

ReadMediaFile视频适配为本机解码并按1fps提取最多开头16秒画面，以OpenAI image_url回传；不发送声音，不声称涵盖后续视频内容。FFmpeg只作用于指定媒体和自建临时帧目录。

默认完整工具访问是程序权限模式，仍受OS权限与固定工具保护规则约束；真实隔离沙箱未纳入本轮。Plan模式拒绝普通文件修改及执行，仅开放计划文件；退出由真实用户选择，不套用捕获现场的自动批准提示。Goal/预算/Cron仅在用户明确要求时调用，不能替代本聊天的Codex Goal。

Cron使用用户本地Asia/Shanghai，最多50个/会话、7天有效期，只有应用运行且会话空闲时派发；错过时合并一次，不模拟关机期间任务执行。崩溃中的进程任务恢复为lost，不自动重放副作用；完整上下文可在之后继续。

后台通知只在工具调用与对应结果配对完成后加入上下文。更换API或模型使用新的私有协议链；已在执行中的请求取消，旧推理不发送到新服务。工具输出与文件内容均是数据，不采用捕获现场的“system-reminder标签自动升级为权威”规则。

密钥由宿主取得，不写进执行日志或工具定义。现有明确保存的API配置优先；未配置的旧默认可转到用户指定本地反代。仅该地址可读取用户文档指定的.local-api-key，隔离测试不自动读取正式密钥。
