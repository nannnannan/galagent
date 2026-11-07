## v1.0.1 · 主动研究反馈修复 · 2026-11-07

- 主动研究复用已配置 MCP；用户可在连接页选择只读研究工具。每轮最多两个 MCP 服务，笔记保留 MCP 调用来源。
- MCP 查询与网页查询分开，MCP 资料不进入网页助手的后续查询上下文；参数校验、脱敏、权限复核和取消覆盖研究路径。
- 修复研究错误被吞掉、无结果时不通知界面的问题，显示研究阶段与失败原因。
- 无说明或工具参数格式错误的 HTTP 400 不再让端点永久退化为无工具模式，研究重试和 MCP 保持可用。
- 增加停止本次研究，等待未响应的请求或扫描时也可取消；迟到结果不落入后续任务。
- 手动研究允许重查近期兴趣，不再无提示地受 12 小时冷却限制；用户暂停的兴趣仍不研究。
- 缩短单轮兴趣规划，减少结构化结果超过输出预算的机会。

## v1.0.0 · 2026-11-07

- 整合近期后端维护、主动研究与持续关心、任务收尾、接口兼容和存档自动保存修复。
- 同步项目介绍、使用方法与开发验收说明。
- 附带支持 Mira 0.0.771 的可选本地反代源码与独立分发包；不含登录数据、本机密钥或日志。

## v0.99.0 · 存档与自动保存维护 · 2026-11-07

- 统一普通快捷方式、显式目录和源码启动器的存档选择；记住的目录丢失或配置损坏时停止启动并提示，避免误开其他存档。
- 启动器优先使用已安装的程序；显式指定构建目录时保留开发包启动方式。
- 主界面显示自动保存时间，「连接」页显示当前数据目录。状态以 SQLite 事务保存，并启用 FULL 同步。
- 343 项测试中 342 通过、1 项跳过；Windows 隔离验收验证强制退出后恢复聊天、记忆、设置和存档 ID。
- 更新 README 的主动陪伴、研究、权限、模型接入、存档和开发验收说明。

## v0.99.0 · 持续关心与接口维护版 · 2026-11-07

- 跟进同一件事的时间与结果，保留用户原话证据。改期会替换旧时机，已问过的版本不重复问，结束与暂停状态跨重启保留。
- 普通主动关心避开全屏、刚切窗、刚结束的聊天和上一句尚未得到回应的时段。对话回应不再同时给多条旧主动消息加权。
- 同轮研究合并重复搜索与网页请求；用户聊天期间延后综合步骤。
- 直连接口增加有界参数兼容、SSE 读取、可中断响应与明确报错。接口切换后排队中的旧请求停止发送。

## v0.99.0 · 任务收尾修复 · 2026-11-07

- 完成状态与主动汇报不再等待长报告摘要。后台摘要就绪后只更新原消息，失败或取消时继续使用已有摘录。
- 摘要关联原任务；新任务完成、清空历史、权限取消和关闭程序的情况下均避免迟到结果干扰。任务事件保留报告头尾，包含最后的结果位置。
- 新增停滞摘要、正常退出、两个任务先后完成及清空历史后的回归；已通过故意挂起摘要接口的 Windows 打包验收。

## v0.99.0 本地主动研究与陪伴版

- 用户可直接在聊天里指定、暂缓、恢复或取消兴趣。一次最多主动分享一条；优先与用户真实原话或亲自关注的兴趣接续，不合适可保持安静。
- 新研究来源要求实际打开网页并取得正文。研究时带上已有进展，去除同批重复和同事实改标题的结果。取消或移除兴趣后丢弃迟到的研究结果。
- 追问刚才分享的来源可跨重启接续；普通换话题不计正反馈，明确拒绝会暂停置顶兴趣。
- 工具入口保留统一预检，分离会话工具和宿主操作。父任务取消会结束后台提问，即使表单尚未返回。

## v0.99.0 本地主动陪伴维护版

- 新存档默认主动观察，保留已有存档的开关。角色可在真实事件出现时主动关心、提出帮助。
- 统一设置变化引发的清理和取消，清除已撤回的观察事件，阻止过期的本机扫描结果重新填回缓存。
- 统一主动开口检查，用户提醒在专注模式可用，遇到安静时段仍等待。抽出工具轮次的预检、并发与结果回填。

## v0.99.0 · 对话与执行器维护版

- 分离对话上下文的来源筛选、历史排序、预算和系统消息构造，保留主服务读取本轮实时状态的入口。
- 每轮回复独立持有渠道、取消信号和延后动作。模型请求与写回分开，已取消的请求无法执行迟到的工具调用。
- 分离执行器进程生命周期和文件检查点，串行保存检查点及撤销操作；用户修改与无法验证的旧文件会报冲突。
- 新增桌面取消与微信回复重叠、取消后的工具返回、并发文件写入及两个真实 Shell 独立取消的回归。

## v0.99.0 · 后台队列维护版

- 将持久化作业状态、排队去重、退避、取消和关闭等待移入独立队列。索引和抽取处理器在写回前复核来源，并在同一事务内保存结果和完成标记。
- 补充异常中断后重复唤醒的回归测试，以及档案重建失败、退避后成功的集成测试；检查日记 ID 与来源均保持一致。

## v0.99.0 本地后端维护版 · 2026-11-06

- 将模型传输和助手会话从主服务拆出。请求绑定开始时的模型与端点，在读取凭据期间切换配置会终止该次请求。
- 将设置归一化、权限判断、存档校验、日历史、用量及任务历史交回各自模块；保留主服务统一提交状态、通知界面。
- 执行器文件策略、网络检查和媒体读取可独立维护。本机浏览器读取与 Electron 密钥存储分离。
- 补上端点切换回归，旧梗概恢复测试改走真实 open_brief 工具入口。更新协作指南里的日记说明。

## v0.99.0 本地维护包 · 2026-11-06

- 提取执行器提醒的创建、列表和取消接线，沿用主调度器及原有提醒归属，增加回归测试。
- Windows 烟雾测试支持模型列表请求；双核心测试使用前一天的模拟消息验证每日档案、日记来源和任务完成唤醒。

## v0.99.0 · 回溯检索、可复用助手、深度访问、不限时长 · 2026-11-06

- **模型推理和工具调用不限时长**：去掉了聊天、助手、研究、整理等所有模型请求的超时，以及网页读取、Bash、MCP 工具调用的时限。同时关掉了 fetch 自带的 300 秒默认超时，否则模型想超过 5 分钟照样会断。停下来靠用户取消，微信发「取消」也能停。
- **微信收件放到本体旁边**：图片和文件都存到 `%APPDATA%/GalAgent/微信收件/`，旁边的 `记录.jsonl` 记下收到了什么。图片现在也保存，并由模型描述成文字进对话；文本类文件把开头内容带进对话（视频还不支持）。执行代理和助手能读这个目录。
- **入口整理**：只留一个 `启动 GalAgent.cmd`，指向 `release/win-unpacked`；删掉内容相同的「双核心版」和「陪伴改进版」。便携包文件名跟随版本号。

- **回溯检索**：聊天原话（含微信）、助手查过的资料、任务、每日档案都能搜。主代理记不清时直接用 `search_history` / `read_history`，不用派人。「记忆」页新增「翻翻以前」，你也能搜。任务记录改为永久保存。
- **助手可复用**：`ask_helpers` 带 `continue_from` 就回到同一个助手接着问，它读过的网页和记录都还在，重启后也能接上。会话脱敏后存在本机，太长时先省略最早的工具结果。
- **深度访问**（默认关，打开时弹窗确认）：不用装扩展，直接读 Chrome、Edge、Brave、Firefox 的历史、书签和搜索词，还有文件名、文本文件内容、已装软件和 Steam 游戏。助手可以用 `browser_history` / `search_local_files` / `read_local_file`。
  - 始终碰不到：已存密码和登录状态、密钥文件、聊天软件数据、AppData、禁止目录；按键、摄像头、麦克风、系统音频和剪贴板也不开放给研究。
  - 网址只留路径，去掉参数。一个助手不能同时碰网络和私有数据，防止网页里的指令把本地内容带出去。
- **研究看反馈**：回应、没接话、说不感兴趣都会调整兴趣权重，连续没接话或明确拒绝就歇两周，规划时也参考这些反馈。
- **用量页**：「连接」页按聊天、主动开口、并行助手、主动研究、执行任务、记忆整理显示 token 数和最近 7 天。
- 修复：
  - 全量代码审计后的修复。复核时发现并改正了审计修复引入的回归：
    - 每日档案指纹改版后，旧档案仍能识别，升级不会把它们删掉。
    - 后台心跳不再整体加锁，一个卡住的请求不会挡住提醒和档案。
    - 已保存的 TTS 地址不合规时，不再阻断其他设置和一键锁定。
    - NAT64 / 6to4 / Teredo 地址按内嵌的 IPv4 判断，纯 IPv6 网络能正常联网。
    - 执行器命令结束时，不再弄死用户用 `&` 留在后台的进程。
    - 注意力唤醒失败最多重试两次。
    - 删除消息后，旧消息不会被重新推到微信；「补一句」跟随原回复的渠道。
    - 改写整体印象后能立即看到新内容。
    - 新增 `tests/core/audit-fixes.test.ts`。
  - 一次回复的 60 秒时限把助手的时间也算进去，查得久会被取消。现在模型推理和工具调用都不再限时（见本节第一条）。
  - 工具不可读名单漏了 `stt-key.bin` 和 `wechat-session.bin`。
- 验证：类型检查、构建通过，299 项测试（295 通过、4 项 Windows 专用跳过）。新增 `tests/core/recall.test.ts` 和微信媒体测试。真实 Windows 浏览器文件、腾讯 CDN 下载、模型看图都还没实测。

## v0.7.0 · 微信里找 TA、主动研究、并行代理、上下文窗口设置 · 2026-11-04

以下三节是本版的三部分，最后写的排在最前。

### 上下文窗口设置 + 梗概不限长

- 「连接 → 对话模型」新增「上下文窗口」和「单次输出上限」。留空就按接口自动：
  - 保存连接和启动时，会去读接口 `/models` 里报告的上下文长度和最大输出。能识别 OpenRouter、vLLM、Groq、Gemini、LiteLLM 等常见字段名。
  - 接口没报时，窗口默认 100 万，输出默认 4096（以前固定 900）。
  - 接口报告的输出上限很大时，聊天一句话最多取 32,768。
- 记忆和最近对话的预算随窗口放大：1M 窗口下是以前的 5 倍，200k 窗口和以前一样。执行代理在用同一个模型时，自动压缩阈值改成窗口的 60%。
- 梗概不再限字数和条数，每份永久保存在本机，`open_brief` 任何时候都能打开。上下文里带最近 7 天、最多 10 份的全文。执行汇报超过 4000 字才压缩，压缩后也不限字数。
- 验证：290 项测试（286 通过、4 项 Windows 专用跳过）、类型检查、构建通过。新增 `/models` 字段解析、窗口与输出上限生效、梗概跨重启保留等测试。原来写死 `max_tokens 900` 和 6500 token 上限的测试已按新规则更新，在 200k 窗口下仍断言 ≤6500。

### 主代理上下文瘦身：并行代理 + 梗概

本节里的字数和时长（梗概 ≤300 字、3 小时最多 3 条、汇报 500 字起压缩、工具结果 8000 字）是当时的值，已被上一节取代；分工不变。

- **查资料交给并行代理**：主代理（陪伴角色本人）不再自己调 `web_search` / `read_webpage` / `recall_day`，改用 `ask_helpers` 一次派最多 4 个并行助手。助手各自有独立的上下文和工具轮次，读网页、翻某天原话、查旧记忆（新增 `search_memory`），只交回梗概：结论 ≤300 字、要点 ≤5 条、来源只能是它真读过的网址。梗概不够时用 `open_brief` 看细节。网页正文和原始聊天不再进主上下文。
- **执行代理的汇报压成梗概**：超过 500 字的汇报先压成 ≤250 字，用于聊天消息、`lastResult` 和 `task_status`，完整汇报仍在「任务」页。
- **主上下文新增工作集**：
  - `recentBriefs`：3 小时内最多 3 条梗概，接着问同一件事不用重查。
  - `board`：长任务看板，在跑的执行任务、在查的助手、主动研究的状态，每项一行。
  - 这两样连同研究笔记合计约 1000 字以内。梗概和研究笔记不会自动写进长期记忆。
- **主动研究改为并行**：每个角度一个助手去读网页，汇总员只看各角度的要点和来源，写成笔记。
- **同一轮的多个工具调用并行执行**，单个工具结果上限 8000 字。助手在查时，状态会显示「派了 N 个助手去查…」。
- 设计见 `docs/上下文与并行代理-v1.md`；AGENTS.md 新增第 16 条，并改写第 6 条。
- Gmail MCP 暂缓，记在 `docs/备忘录.md` 和 NEXT.md。
- 验证：类型检查、288 项测试（284 通过、4 项 Windows 专用跳过）。新增 `tests/core/helpers.test.ts`；`web.test.ts` 和 `research.test.ts` 按新架构改写。

### 微信里找 TA（R1）+ 主动研究（R2）

- **微信通道（R1）**：直接对接腾讯官方的 iLink 机器人接口（就是 OpenClaw 微信插件用的那个），不装 OpenClaw。「连接」页打开开关、扫码绑定，你的微信里就多了一个 TA。
  - **只认你一个人**：扫码的那个微信号就是唯一能和 TA 说话的人。别人发来的消息不处理、不回复，也回答不了确认。
  - **在微信里和 TA 聊，就是和桌面上的 TA 聊**：同一段对话、同一份长期记忆，也能派任务、改设置。桌面聊天里这些消息带「微信」标记。只能聊文字和语音（用微信自带的转写）。
  - **离开电脑时推到微信**：系统空闲或锁屏，或者你 30 分钟内在微信说过话，这时 TA 的主动消息、任务结果、提醒，以及需要你确认的事都会发到微信。确认以编号发来，回数字就行；不回复就不执行。
  - 发送额度按腾讯自己的限制来，没有另加设置。你在微信发一句，回复窗口就续上；「连接」页会显示窗口到几点。
  - **出微信的每句话仍然脱敏**（API Key、密码等）。绑定信息整份用 DPAPI 加密在 `wechat-session.bin`。「一键隐私锁定」会关掉微信通道。AI 改不了这个开关。
- **主动研究（R2）**：TA 会从多个渠道了解你的日常，整理出兴趣，再从多个角度、多个网站去研究。
  - **渠道**：聊天与记忆、每日档案和整体印象、交给 TA 的任务、你设的提醒、你亲手加的兴趣；打开桌面观察后还有常用应用的使用时长（只记应用名和分钟数）和浏览器扩展的历史与书签。每个渠道仍受原来的开关约束，没有新增任何观察。
  - **怎么研究**：大约每天整理一次兴趣画像和日常理解，每个兴趣带几种研究角度：新动态、活动与日程、深度解读、实用技巧、社区讨论、入门与推荐。之后每天最多研究 4 次，每次挑一个兴趣、轮换 2 个角度搜索，同一网站只取一条，读正文后写成带来源的笔记。
  - **可信度**：笔记必须引用这次真的读过的网址，只有一个网站支持的最高 3 星，多个网站互相印证才能到 5 星。
  - **怎么用到**：聊天时 TA 会自然提起；「分享新鲜事」优先用研究笔记；你不在电脑前时，会把 1–3 条合成一份小报发到微信。
  - **你能管**：「记忆 → TA 在研究你喜欢的东西」能看到各渠道的数据量、TA 理解的你的日常、兴趣清单（可置顶、删除、手动添加，删掉的不会再回来）、研究到的笔记（👍/👎 会调整兴趣权重）、「现在研究一下」按钮和总开关。
- 验证：类型检查、285 项测试（281 通过、4 项 Windows 专用跳过）、生产构建通过。新增 `tests/core/ilink.test.ts`（协议客户端，子代理按腾讯插件 2.4.10 源码实现）、`wechat-bridge.test.ts`、`research.test.ts`（含模拟搜索与模型的端到端研究）。截图新增 `page-memory-full.png`、`page-config-wechat.png`。**未在真实微信上验证**：扫码、收发消息、回复窗口与限流的实际表现，需要你在 Windows 上扫码试一次。

## v0.6.0 · TA 眼中的你、按住说话、三类模型接口统一 · 2026-11-04

- **TA 眼中的你**：「记忆」页最上面新增一张画像卡，分三块：
  - TA 对你的整体印象：每晚整理档案时更新，可以「改写」或「清除」；改写过的，之后的夜间整理会以你写的为准。
  - 最近一周在忙：从每日档案的话题和还没聊完的事里整理出来。
  - 你常在什么时候找 TA：近 30 天你自己发出的消息按小时统计成柱状图，标出最常聊天的时段和深夜次数。只统计条数，不读内容。
- 记忆按「喜好与习惯 / 作息 / 在忙的事 / 身边的人和小动物 / 我们之间 / 其他 / TA 自己的感受」分组显示，每条都可以看「来源」（当时你说的原话或来自哪天的档案）、纠正或删除。归类全部在本机按规则完成，不额外调用模型。
- **按住说话**：聊天框和桌宠快捷输入框旁边新增麦克风按钮。按住录音，松开后交给你配置的语音识别接口转成文字，填进输入框，确认后再发送。
  - 按下才开麦，松开立刻关；最长 60 秒；录音不保存。
  - 默认关闭，只能你自己在「连接 → 语音输入」里打开，打开时会提示录音会发到哪个地址。AI 改不了这个开关和地址，「一键隐私锁定」会把它关掉。
- **三类模型接口统一**（`runtime/shared/endpoints.ts`）：对话、语音输出、语音输入都按「OpenAI 兼容基础地址 + Bearer 密钥 + 模型 + 请求格式」配置，路径由种类和格式推出。
  - 语音输出可以明确选择「OpenAI /audio/speech」或「小米 MiMo」，也可以按地址自动判断。
  - 语音输入支持两种格式：`/audio/transcriptions`（Whisper、SenseVoice 等），以及多模态对话的 `input_audio`。提供 OpenAI、硅基流动、Groq、本机 Whisper 服务的快速填入。
  - 三处都有「拉取模型」按钮，读接口的 `/models`，按用途把可能的模型排在前面。密钥只发往同源地址。
  - 语音输入密钥单独用 DPAPI 加密保存在 `stt-key.bin`；地址和语音输出或对话模型同源时，可以借用它们的密钥。
- 改动方向：原计划在本机识别语音，试过 Whisper base（约 77MB，单段识别要 24 秒，中文效果差）后，按用户要求改为调用接口。
- 第 7 项（离开电脑后还能找到 TA）出了实施计划，见 `docs/离开电脑-计划-v1.md`，本版本没有实现。
- 验证：类型检查、生产构建通过；全部测试通过（Windows 专用的 4 项跳过）。新增 `tests/shared/profile.test.ts`、`tests/main/stt.test.ts`，主代理测试补了「AI 打不开语音输入」。截图已重新生成。未在 Windows 实机验证：麦克风权限弹窗、真实识别接口、录音转码。

## v0.5.0 · 自适应节奏、任务历史、MCP 一键模板 · 2026-11-04

- **主动开口自己学分寸**（`runtime/core/pacing.ts`）：TA 主动说的话 45 分钟内没人回应，记为“冷落”。同一类话题连着 2 次被冷落就先歇一阵（2 小时起，每多一次翻倍，最长 3 天）；最近有结论的主动开口里一半以上没回应时，最短间隔拉长到 2 倍，四分之三以上拉长到 3 倍。只会更安静：用户设的间隔与每小时/每天上限仍是硬上限。用户一说话、或点「这种挺好」，相关话题立刻恢复。任务结果、关注事项、定时提醒、连接状态是用户要的，不参与退避。「陪伴」页新增「自动学分寸」开关，正在歇的话题会列出来并可一键恢复（`pacing.reset`）。账本只记时间、话题类别和有没有回应，不存消息原文。
- **任务页**：侧栏新增「任务」。正在跑的任务可逐个取消；做过的事本机保存最多 100 件，点开能看到交代的原话、执行代理的汇报、用到的工具次数、改过的文件、工作目录和耗时，可「撤销这次的改动」（按任务单独撤销，不再只能撤最近一次；已撤销的不能再撤）、「再做一次」、「复制汇报」。记录可清空。主角色的 `task_status` 也改读这份历史。
- **MCP 一键模板**（`runtime/shared/mcp-presets.ts`）：「连接」页的 MCP 区新增 8 个常用服务卡片——本地文件夹、Obsidian/Markdown 笔记库、Notion、Todoist、Google 日历、Outlook 日历与待办、GitHub、Playwright 浏览器。点开选文件夹或粘贴令牌即可添加。安装方式均按各包 npm 说明核对，版本锁定，不用 `@latest`。令牌经 `mcp.addPreset` → `mcp.secret` 直接进 DPAPI 加密存储，设置与快照只记名称；文件夹不能选 GalAgent 自己的数据目录或用户的禁止目录。主角色 `get_settings` 能看到模板清单，可以替用户把服务加上（仍按「AI 管理权限」确认），但看不到也填不了密钥。
- 验证：类型检查、256 项测试（252 通过、4 项 Windows 专用跳过）、生产构建通过；新增 `tests/core/pacing.test.ts`、`history-pacing.test.ts`、`mcp-presets.test.ts`；新截图 `page-tasks.png`、`page-tasks-open.png`，其余界面截图已重新生成。未在 Windows 实机验证：模板服务真实连接（需要用户自己的令牌/账户）、自适应节奏在真实使用中的手感。

## 未发布 · 界面重绘 v2「像素手账」（分支 feat/ui-redesign）· 2026-11-02

- 窗口右上角：去掉深蓝色的系统按钮底色，Windows 最小化/最大化/关闭按钮改为与界面同色（浅色/深色随系统主题实时切换，`nativeTheme` → `setTitleBarOverlay`）；应用自己的 44px 标题栏承载页面标题与工具，右侧为系统按钮留位，滚动时出现分隔线。
- 设计系统 v2：新的色板与圆角、更轻的阴影、方角按钮、自绘下拉箭头与开关；页面背景加淡点阵（手账纸感）；内容区最宽 920px 居中。
- 侧栏重排：伙伴卡片（小人 2× 像素清晰显示 + 名字 + 状态 + 心情 + 羁绊进度）合为一张；导航分组且 800px 高度下不再滚动；侧栏与标题栏文字不可被误选中。
- 统一图标：新增 `runtime/renderer/icons.ts` 自绘 SVG 图标（约 50 个），导航、命令面板、统计、提示、MCP、发送/复制按钮全部换掉 emoji；成就徽章保留 emoji 作为收藏内容。
- 聊天：气泡、输入框、底部按钮重绘。
- 工作目录可以点「选择文件夹…」用 Windows 资源管理器选择。
- 主代理掌控 GalAgent：聊天里的角色本人新增 7 个工具——`run_task`（派发执行任务，多件可并行、异步回报）、`task_status`、`cancel_task`、`undo_task`、`get_settings`、`update_settings`（陪伴节奏、话题、监听/桌面观察、沙箱、执行器、MCP、工作目录、角色等全部设置）、`watch`（管理留意事项）。执行器支持最多 N 个任务同时运行（默认 3）。放宽隐私或权限的改动默认需要在聊天里点「同意」；「隐私与沙箱」新增「AI 管理权限」，用户可改成「完全控制」免确认；AI 不能改这个开关，也碰不到密钥。只在直接聊天时提供，主动开口与注意力代理拿不到这些工具。
- 验证：类型检查、235 项测试（231 通过）、生产构建通过；全部 48 张界面截图已重新生成（`docs/evidence/ui/`）。2026-11-04 用户在 Windows 实机确认无问题。

### 界面重绘 v2.1 · 字体、角色头像与桌宠边界 · 2026-11-02

- **自带界面字体**：打包 Noto Sans SC（SIL OFL 1.1，101 个 unicode-range 分片共 4.3 MB，放 `runtime/renderer/fonts/`，按需加载），不再依赖系统里的雅黑/PingFang。`scripts/fonts/fetch-ui-font.mjs` 可重新抓取；授权原文 `runtime/renderer/fonts/OFL.txt`。
- **角色卡头像换成像素小人**：角色页每张卡显示该角色自己的小人（站姿静止，鼠标移上去挥手），不再是一个紫色方块加一个汉字。没有对应小人时仍回退到单字块。
- **桌宠可以贴到屏幕顶端**：窗口是 320×440 的透明画布，小人只占下半部分。原来按整块窗口限制位置，所以头顶永远离屏幕上边差两百多像素、左右各差 61px。现在渲染端把小人真实可见的边界（`shell.footprint`）上报给主进程，主进程按这个边界限制拖动、漫步折返与"回到角落"，窗口的空白部分可以伸出屏幕外。几何算法独立在 `runtime/shared/pet-geometry.ts`，含 8 项测试。
- **晃动与特效不再被裁掉**：画布改为铺满整个窗口，小人通过 `PixelPet` 的 zone 参数定位在原处，所以左右晃、碎屑、星星、爱心都有地方画。季节粒子（雪/花瓣/萤火/落叶）的遮罩从"中间一个椭圆"改成上下渐隐，整屏可见。小人贴到屏幕顶端时，对话气泡自动翻到头部下方。
- 验证：类型检查、243 项测试（239 通过、4 项 Windows 专用跳过）、生产构建通过；全部界面截图已重新生成。2026-11-04 用户在 Windows 实机确认：系统按钮颜色、选择文件夹、小人拖到屏幕顶端与气泡翻转、新字体均正常。

## v0.4.0 · P2 Windows 发布 · 2026-11-02

- 拉取 main 的 P2 合并提交 092f8ed（执行器增强、MCP、联网搜索、思考词条与新增人形小人）。保留 K3.1 适配、主角色百万上下文预算、NSIS 保留存档配置。
- Windows 适配：MCP 测试关闭子进程后，目录清理允许有限重试，避免异步退出导致 EBUSY；未改变生产 MCP 权限或执行行为。
- 验证：typecheck、232/232 测试、build 通过；新增 tests/e2e/windows-release.mjs 在独立存档和本地模拟上游下验证打包版聊天、K3.1 请求、执行器 Read 往返与上下文预算，结果见 docs/evidence/windows/v0.4.0-smoke.json。
- 旧 dual-core.mjs 仍断言“十轮日记”，与现有每日档案设计不符，本次由上述打包验收替代，未声称旧探针通过。真实 Mira 聊天、外部 MCP、安装/卸载完整流程未验收。
- 发布 v0.4.0；启动前备份原存档，再使用普通入口启动，不清空存档。上游自带的设置迁移仍可能在程序启动时运行。

## 未发布 · 执行器强化（分支 feat/agent-power）· 2026-10-31

- 对标 Codex CLI / Kimi Code / DeepSeek Harness（设计见 `docs/执行器强化-v1.md`）：新增第 27 个工具 `ApplyPatch`（多文件原子补丁）；读取项目 AGENTS.md 与 `~/.galagent/AGENTS.md`；系统提示加入工作区概况与工作方法；历史超 48k 自动压缩为交接摘要；连续相同工具调用 3 轮提醒、5 轮停止；Write/Edit/ApplyPatch 改动按任务快照，「连接」页可一键撤销（之后被改过的文件不动）；stdio MCP 客户端，「连接」页可添加服务；长工具输出保留头尾。
- 全面放开（见 `docs/执行器强化-v1.md` v1.1）：沙箱新增「完全放开」档（免确认、内网、凭据文件，GalAgent 自身密钥始终保护，选择时弹窗确认）；MCP 支持远程 HTTP 与加密保存的环境变量/请求头，宽松以上免询问；执行器可单独指定模型、输出上限（默认 8192）与回合上限（默认 200）。修复：Bash 超时超限时先报错，不再先让用户确认一条注定失败的命令。
- 验证：类型检查、232 项测试（228 通过、4 项 Windows 专用跳过）、生产构建通过；新增 `tests/core/agent-power.test.ts`（含真实子进程 MCP 服务、模拟远程 MCP）。未用真实模型跑长任务验收。

## 未发布 · 思考词条与更多互动 · 2026-10-31

- 思考词条（类似 Claude Code 思考时的橘色字）：回复中在小人头顶、主界面头像和输入框旁轮换显示，每 2.8 秒换一个并计时（「琢磨中… 12s」）；通用 68 个思考词、30 个执行任务词、10 个主动开口词。关闭「趣味小词条」后恢复为普通“思考中…”。
- 角色卡新增可选字段 `thinkingLines`（思考小词条，≤20 条，每条 ≤16 字，末尾的“…”会自动去掉），编辑器与 AI 起草支持；7 张内置卡各 4 条，Kimi 卡保持用户原样未加。
- 新互动：挠脚心、鼠标停在小人身上 4 秒（盯——）、鼠标绕小人两圈（转晕）、甩飞撞到屏幕边、按住 6 秒不放、离开回来时迎接、25 分钟没理时偶尔求关注；聊天关键词（生日快乐 / 新年快乐 / 我爱你 / 抱抱 / 谢谢 / 晚安 / 早安 / 哈哈哈 / 加油 / 好累）触发本地粒子与小反应，不额外调用模型。
- 词条扩充：发呆 10→40 条，节日 10→27 个，新增下午、傍晚、深夜、周末时段词条与幸运数字；摸头、戳戳台词增加。
- 新成就 4 个（挠痒痒、深情对视、转圈圈、心有灵犀），共 25 个。
- 新增 7 个人形像素小人（内置共 22 个，人形 12 个）：程序员「阿码」（大耳机、连帽卫衣）、宇航员「星航」（头盔面窗、天线灯）、小厨师「阿勺」（高厨师帽、深肤色）、侦探「小探」（格纹帽、放大镜）、古风少女「青禾」（发髻金簪、流苏、交领襦裙）、老爷爷「福爷爷」（秃顶、白胡子、开衫）、运动少年「阿跑」（歪檐棒球帽、7 号球衣）。均为原创，由 `generate-builtins.mjs` 配方生成，精灵表见 `docs/evidence/pixel-pets/`。
- 联网搜索：新增免 Key 的 `runtime/core/web.ts`（必应为主、DuckDuckGo 兜底，识别反爬验证页；按 charset / meta 解码，GBK 站点正常；正文提取优先 article/main，去导航脚注；重定向最多 5 跳且每跳重查）。执行器新增第 26 个工具 `WebSearch`，`FetchURL` 改用同一模块；主角色新增 `web_search` / `read_webpage` 两个工具（仅沙箱允许联网时提供），聊天中即可查资料。所有网址经 `PrivacyGuard.assertUrl`（域名白名单、URL 中的密钥与敏感词）与公网地址检查。
- 沙箱放宽：新增文件范围「任意位置可读，只在工作目录写」与开关「运行命令前问我」。标准档改为：全盘可读（凭据与禁止目录除外）、工作目录内写、Shell 每条命令先在聊天页确认（允许这一次 / 本任务都允许 / 拒绝）、仅公网；宽松档免确认；严格档不变。旧版未改动过的标准档设置启动时一次性迁移，改过的保留。执行器等待确认时小人头顶显示“等你确认一下”。
- 活人感九项（设计与共存方案见 `docs/活人感-v1.md`）：分几条发、偶尔补一句、心情与精力、自己的小日程（角色卡可写 `routine`）、头顶小嘀咕、早安（可查天气并接昨天待续）、晚安后入睡、主动分享新鲜事、旧事重提与事后回访（含每日档案待续的下午回访）。新增模型调用只有生活时刻与回访，全部计入用户的主动额度、走 attention 优先级并发池、同一时刻至多一个；其余六项零模型调用。新话题开关：早安与晚安、分享新鲜事、旧事重提。陪伴页新增「像真人一样」设置区，头像下显示心情。
- 验证：类型检查、219 项测试（215 通过、4 项 Windows 专用跳过）；在本机对真实必应做了搜索 + 读页 + GBK 中文站解码冒烟、生产构建通过；新增截图 `pet-thinking(-dark).png`、`chat-thinking.png`。未在 Windows 实机验证手势。

## v0.3.0 · 2026-10-31

- 合并 5f1f307：可选 Kimi 卡与像素小人、结构化角色编辑器、统一界面与桌宠菜单交互。
- 保留 Mira K3.1 Pro 适配、五分钟默认节流、安全启动和 NSIS 安装配置。
- 主角色上下文预算调整为 1,000,000 tokens；界面同步显示。这是应用侧预算，不保证上游接受百万上下文；单条输入长度等独立限制不变。
- 发布包 v0.3.0，沿用默认存档；未做存档重置或迁移。
- 验证：187/187 测试、类型检查、生产构建通过；百万上下文未做真实上游请求验收。

## v0.2.0 · Windows 安装版 · 2026-10-30

- 合并通用角色卡、像素桌宠、主代理工具和每日记忆档案，接回 Mira K3.1 Pro 与安全启动改进。
- 增加 NSIS x64 安装程序，可选择安装目录、创建桌面和开始菜单快捷方式；卸载保留用户数据，仍使用 GalAgent 原有存档目录。
- 验证：类型检查通过、183/183 测试通过、生产构建通过。安装包没有代码签名证书；在线聊天端到端验收尚未完成。

## 本地合并 · 2026-10-30

- 已合入 origin/feat/universal-companion（5beedb5），保留新版通用角色、像素桌宠和安全架构。
- 接回本地 K3.1 Pro 适配、空 SSE 结束标记兼容、五分钟默认主动间隔与注意力节流、安全启动脚本及独立新档入口；新版数值设置范围保留。
- 合并前版本：backup/pre-universal-20261030；完整本地修改（含未跟踪文件）：Git stash，说明 backup before universal merge 20261030。备份未删除。
- 修复 Windows 测试的 SQLite 关闭及 CRLF 示例解析问题。类型检查、构建通过；183 项测试中原先 178 项通过，修复后相关 15 项全部通过。未执行新版桌面实机或在线模型验收，未重新打包 EXE。

# GalAgent 更新日志 (CHANGELOG)

## [2026-10-31] Kimi 角色卡与小人、酒馆写法角色卡、界面统一（TAVERN-KIMI-20261031）

- **Kimi 可选**：内置角色卡 `builtin:kimi`（按《Kimi 娘人设总册 v1.3》用酒馆写法整理，衍生与作者原话原样保留；不是默认角色）与像素小人 `kimi-star`（白发淡紫发尾、木耳边发箍、彩虹棱镜发饰、星空披肩 + K 胸针）。
- **酒馆写法角色卡**：`PersonaProfile.card` 新增基本信息 / 外貌 / 性格调色盘与衍生 / 语料 / 三面性 / 二次解释 / 多阶段（按相处天数切换）/ NPC；提示词按酒馆格式渲染，`<user>` 替换为对用户的称呼。新增写卡 skill `skills/galagent-persona`（含参考文档）。「AI 起草」只写骨架并给出引导问题，衍生与二次解释留给作者。
- 上下文预算 16000 → 28000 tokens，结构化角色卡上限约 12000 字。
- **界面统一**：统一设计令牌（间距 / 圆角 / 字号 / 阴影 / 语义色）与组件（卡片、按钮、标签、列表行、空状态、提示条），emoji 只出现在圆角图标里；角色卡编辑器新增「简单写法 / 酒馆写法」双模式与写卡指南。
- **桌宠菜单按钮**：离开小人后停留约 2.5 秒再淡出，跟随小人右下角，点击区 36px，可见期间不会穿透。
- 类型检查、构建与 177 项测试通过。

## [2026-10-29] 主代理工具、并发与重试、每日档案、彩蛋与成就（AGENT-MEMORY-20261029）

- **主代理工具调用**：主角色请求带 `schedule_wakeup / list_wakeups / cancel_wakeup / recall_day` 工具，模型理解语义后自己设闹钟（支持相对分钟、时刻、cron、重复），用户明确要求的提醒标为用户提醒；到点唤醒主角色。执行器的 Cron 工具改为唤醒主角色。网关不支持 tools 时自动回退 JSON 字段。
- **并发与 API 调用**：新增 `upstream.ts` 统一重试（网络错误、429、5xx，退避 + 抖动 + Retry-After，等待期间释放槽位）；执行代理去掉与全局池重复的本地限流，流式请求超时放宽到 5 分钟；并发池为对话与注意力保留 2 路余量，避免并行子代理把用户聊天堵住。
- **记忆系统 v2**：日记改为每天 0 点整理前一天，生成每日档案（摘要 / 日记 / 话题 / 高光 / 待续）与用户画像；次日上下文以档案替代原文，原文本地保留并可被 `recall_day` 召回；按日期去重、指纹校验、删除即失效、误点重复整理无效；记忆加入遗忘曲线（被引用会强化）。参考 MemoryBank、Letta、mem0。
- **彩蛋与交互**：摸头、甩飞、蓄力跳、连戳、零点、每日首次问候、整点报时、四季粒子、Logo 七连击、Konami；21 个成就徽章与羁绊卡（陪伴天数 / 连续天数）；Ctrl+K 命令面板、页面快捷键、聊天 Markdown 与复制、札记页每日档案卡片。
- 类型检查、构建与全部测试通过。

## [2026-10-29] 普适化升级：角色卡、像素小人、定时自唤醒、沙箱防外泄（UNIVERSAL-20261029）

- **人设普适化**：删除写死的 Kimi 娘人设、吃醋场景与“自己取名”流程；新增角色卡系统（7 张内置 + 自定义 / 复制修改 / 导入导出 / AI 起草），通用守则与角色卡分离；TTS 导演提示改为读取角色卡的声音风格；旧角色的历史台词保留并标注说话者。
- **视觉替换**：移除 Live2D 运行时、Cubism 依赖、Kimi 立绘与 Live2D 生产管线（`art/live2d`、`prototypes/live2d` 及相关脚本，可从 git 历史 `871e94d` 找回）；新增 Canvas 像素小人渲染器与 14 个原创内置小人、`galagent-pixel-pet@1` 格式、校验 / 预览 / 生成脚本和 `skills/galagent-pixel-pet` 自制技能；自定义小人放入 `%APPDATA%/GalAgent/pets/` 自动识别。
- **定时自唤醒**：模型 JSON 新增 `schedule` / `cancelSchedule` 字段，到点以 `wake` 事件叫醒角色；「定时」页可手动增删，支持重复、专注模式放行用户提醒、免打扰顺延、过期 12 小时丢弃。
- **主动陪伴可配置**：间隔、每小时 / 每天上限改为任意数值并在注意力代理路径上真正生效；新增心跳、久未回应、重逢、打盹、气泡停留、漫步速度、截屏间隔（≥60 秒）、免打扰时段、话题开关。
- **沙箱与防外泄**：执行器三档沙箱（文件范围、Shell、联网、域名白名单），凭据文件永久不可读；发往模型 / 执行器 / TTS 的内容自动隐藏密钥与可选个人信息、自定义敏感词；带敏感内容的网址拦截；防护审计只记类别与次数；一键隐私锁定。
- **界面**：渲染器重写为桌宠窗口 + 9 页主界面，圆润浅 / 深色主题、头顶状态标签、打字机气泡、小词条与彩蛋；新增 `npm run preview:ui` 截图脚本。
- 类型检查、构建与 153 项测试通过；界面截图见 `docs/evidence/ui/`，小人图鉴见 `docs/evidence/pixel-pets/`。尚未在 Windows 实机打包验收。

## [2026-10-23] 陪伴体验与控制完善（COMPANION-QUALITY-20261023）

- 修复 TTS 关闭后迟到播放、返回乱序与解码后复活；加入宿主取消、播放代次和显式停止。
- 加固应用内禁止目录：关闭任意 Bash，保守拒绝多硬链接文件，搜索改为先检查后读取。
- 增加日常/专注/休息模式及有来源的主动互动反馈，支持持久化、重置和新偏好存档迁移。
- 129 项测试、类型检查和构建通过；隔离桌面流程通过，但测试宿主需临时关闭 Electron 沙箱。正式包未加此选项，普通启动待正常桌面验证。
- 交付独立 `release/companion-quality` 和专用启动入口；详见 [验收记录](docs/evidence/陪伴体验改进-20261023.md)。


本文件记录 GalAgent 的重要版本演进、问题修复与验收节点。2026-10-29 之前的条目描述的是已移除的 Kimi 人设与 Live2D 形象，仅作历史保留。

---

## [2026-10-18] 反代自检拉起、Live2D 桌面来回小跑、TTS 语音接口与本地存档人设清洗（ROAM-TTS-PROXY-ARCHIVE-20261018）

按用户要求完成开机/启动自动检查并拉起 Mira 反代服务、Live2D 桌宠桌面来回跑动特效、TTS 语音合成接口，并清洗升级用户 `%APPDATA%\GalAgent\companion.sqlite` 存档至最新统一人设。

### 新增与更新 (Added & Changed)
- **启动自动检查并拉起本地 Mira 反代服务**（[`runtime/main/proxy-autostart.ts`](runtime/main/proxy-autostart.ts)、[`runtime/main/index.ts`](runtime/main/index.ts)、[`启动 GalAgent.cmd`](启动%20GalAgent.cmd)、[`启动 GalAgent 双核心版.cmd`](启动%20GalAgent%20双核心版.cmd)）：
  - 自动检测 `127.0.0.1:18890`（`Desktop\mira反代\kimi-api\start.ps1`）与 `127.0.0.1:8787`（`Desktop\mira反代\start.ps1`）健康状态，未启动时自动后台拉起并同步本地 API Key；统一两个 `.cmd` 启动入口至最新 `release\dual-core\win-unpacked\GalAgent.exe`。
- **Live2D 桌面来回跑动特效动作**（[`runtime/main/index.ts`](runtime/main/index.ts)、[`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)、[`runtime/renderer/kimi-live2d.ts`](runtime/renderer/kimi-live2d.ts)、[`runtime/renderer/living-character.css`](runtime/renderer/living-character.css)）：
  - 新增 `PetAction: 'run'`、`pet.roam` 指令与 `roamingEnabled` 设置；主进程在桌面工作区驱动窗口左右来回小跑（悬停/拖拽/输入/安静时自动暂停），渲染器同步驱动 Live2D 步伐弹跳、朝向倾角、发丝裙摆物理摆动与脚下星光拖尾。
- **TTS 语音合成接口（原生接入小米官方 `mimo-v2.5-tts`）与实时口型同步**（[`runtime/main/tts.ts`](runtime/main/tts.ts)、[`runtime/main/index.ts`](runtime/main/index.ts)、[`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)）：
  - 原生支持小米官方 `mimo-v2.5-tts`（`POST https://api.xiaomimimo.com/v1/chat/completions`、`audio: { format: 'wav', voice: '冰糖' }` + 随可黎实时表情变化的导演指令 `buildMimoStyleInstruction`），兼容 OpenAI `/v1/audio/speech`、`/tts`（API Key 由 DPAPI `tts-key.bin` 独立加密）及 Windows 原生 `System.Speech` 内存 WAV 流与 Web Speech 保底；通过 `AudioContext` 60Hz RMS 音量包络实时驱动 Kimi Live2D `ParamMouthOpenY` 口型；已为用户正式存档配置好 `mimo-v2.5-tts` 与 `冰糖` 音色。
- **旧存档统一人设平滑迁移**：
  - 清除旧 S0（`adapting`）阶段在 `records` 与 `transport:*` `reasoning_content` 中的冷淡期残留及机械场景播报，升级为最新统一人设基线（爱弹钢琴、亲近、娇多傲极少、有活力）。
- **双 API 接入模式与致谢名单**（[`runtime/core/openai-agent.ts`](runtime/core/openai-agent.ts)、[`runtime/core/companion.ts`](runtime/core/companion.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)、[`README.md`](README.md)）：
  - 支持 `mira-proxy`（Mira 本地反代 K3 适配）与 `native-api`（官方/原生无工具 API，由 GalAgent 在本机类比 Kimi Code 直接绑定并提供全部 25 个本地工具）两种模式切换及一键预设；新增致谢名单（`Gemini4argon`、`opus5.5`、`gpt-Astra`）。

### 验证 (Verified)
- `npm run typecheck` 通过、`npm test` **120/120** 全绿、`npm run build` 通过。
- 重新打包 `release/dual-core/win-unpacked/GalAgent.exe` 并运行 `node tests/e2e/dual-core.mjs` 通过（[`docs/evidence/双核心原生验收.json`](docs/evidence/双核心原生验收.json)，`passed: true`）。

---

## [2026-10-18] 实施蓝图全量收官：LD4 正式合入主程序、禁止目录隔离与 Edge Native Messaging 桥接（FULL-BLUEPRINT-20261018）

按用户「continue 把蓝图所有内容实现了吧」指令，完成实施蓝图与总设计案中剩余的全部功能模块，并完成 `release/dual-core/win-unpacked/GalAgent.exe` 打包端到端验收。

### 新增 (Added)
- **`LD4` · Kimi 专属 Live2D 正式合入主程序 `runtime/`**（[`runtime/renderer/kimi-live2d.ts`](runtime/renderer/kimi-live2d.ts)、[`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)、[`scripts/build.mjs`](scripts/build.mjs)）：
  - 将 Cubism 5 SDK for Web R5 封装至 `runtime/renderer/vendor/cubism-framework.js`，在正式桌宠窗口加载 `art/live2d/export/kimi.model3.json`、`kimi.moc3`（27 参数、20 绘制部件）、`kimi.physics3.json`（3 组物理摆）、`kimi.2048/texture_00.png` 与 6 套 `.exp3.json` 表情。
  - 新增 `galagent:live2d-asset` IPC 二进制读取接口（含 Preload 到 Main World 的跨 Realm `ArrayBuffer` 拷贝），并在无 Live2D 资产时自动回退二维 WebGL 变形网格。
- **总设计案 9.3 · 可选禁止访问文件夹（`forbiddenPaths`）与权限版本（`policyVersion`）**（[`runtime/core/tool-host.ts`](runtime/core/tool-host.ts)、[`runtime/core/openai-agent.ts`](runtime/core/openai-agent.ts)、[`runtime/core/companion.ts`](runtime/core/companion.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)）：
  - 默认完整访问（`full-access`），配置 `forbiddenPaths` 时切换为 `directory-guarded`；修改禁止目录时自动递增 `policyVersion` 并立即中止旧权限版本下的在途任务。
  - 通过 `realpathSync.native` 祖先链解析与 NTFS `bigint` `(dev, ino)` 硬链接核对，在 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ReadMediaFile`、`Skill`、`Agent`、`AgentSwarm`、`Bash` 全工具链拦截相对路径穿越、符号链接/目录联接（Junction）及 NTFS 硬链接别名越界。
  - 前端「相处」页新增「禁止访问的文件夹」配置项，「连接」页展示当前目录保护模式与权限版本号。
- **总设计案 9.1 · Edge 配套扩展 Native Messaging 本地桥接与一键注册脚本**（[`extensions/edge-companion/native-host.mjs`](extensions/edge-companion/native-host.mjs)、[`scripts/register-edge-companion.mjs`](scripts/register-edge-companion.mjs)、[`runtime/main/index.ts`](runtime/main/index.ts)）：
  - 实现 `writeBrowserBridgeReport` 原子写入 `%APPDATA%/GalAgent/browser-bridge.json` 及主进程 3 秒定时轮询桥接；提供 `scripts/register-edge-companion.mjs` 一键生成 Native Messaging 清单并注册 Windows `HKCU` Edge/Chrome 注册表项。

### 验证 (Verified)
- `npm run typecheck` 通过、`npm test` **119/119** 全绿、`npm run build` 通过。
- 重新打包 `release/dual-core/win-unpacked/GalAgent.exe` 并运行 `node tests/e2e/dual-core.mjs` 通过（[`docs/evidence/双核心原生验收.json`](docs/evidence/双核心原生验收.json)，`passed: true`）。

---

## [2026-10-17] 主动陪伴完整补齐与 Kimi 原生多模态/视频输入（ACTIVE-VIDEO-20261017）

按用户要求补齐实施蓝图第 7 节主动陪伴剩余模块，并按 Kimi Code 0.29.2 原生多模态协议实现视频输入。

### 新增 (Added)
- **浏览器感知模块与 Edge 配套扩展**（[`runtime/desktop/browser.ts`](runtime/desktop/browser.ts)、[`extensions/edge-companion/`](extensions/edge-companion/manifest.json)）：
  - 实现四类元数据感知（当前标签页 `activeTab`、全部打开标签页 `openTabs`、带关键词/时间检索的历史记录 `queryHistory()`、收藏夹 `bookmarks` 与增删改事件 `bookmarkChange`）。
  - 独立实现当前活动标签页正文 `pageContent` 通道：导航/切页立即失效，拒绝后台标签页、历史记录或收藏夹伪装正文，自动跳过 `captureBlocklist` 黑名单域名与应用。
- **持久关注列表（Watchlist）前后端闭环**（[`runtime/core/companion.ts`](runtime/core/companion.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)）：
  - 新增 `watch.add`、`watch.dismiss`、`browser.report`、`browser.disconnect` 命令；主角色回复 JSON 支持携带 `watch: { title, condition }` 自动注册持久关注事项。
  - 前端「相处」页新增「她在留意的事项」列表、添加表单、一键移除按钮及「浏览器感知」连接状态展示。
- **窗口标题变更、异常退出重逢与断网恢复事件**：
  - `windowTitlesEnabled` 开启时，同一应用内窗口标题切换即时触发观察与注意力事件；新增 SQLite `session-lifecycle` 异常退出重逢（`crash-reunion`）与断网恢复（`online-recovery`）系统事件。
- **Kimi 原生多模态与视频输入协议**（[`runtime/core/tool-host.ts`](runtime/core/tool-host.ts)、[`runtime/core/openai-agent.ts`](runtime/core/openai-agent.ts)）：
  - 对齐 Kimi Code 0.29.2 内嵌源码（`readMediaFileTool.ts`、`videoUpload.ts`、`kimi-files.ts`、`openai-common.ts`）：支持 `.mp4`、`.mpeg`/`.mpg`、`.mov`、`.webm`、`.mkv`、`.avi`、`.flv`、`.3gp` 共 8 种视频格式（上限 100MB）。
  - `ReadMediaFile` 优先通过 `videoUploader`（`POST /v1/files`，`purpose="video"`）上传并生成 `{ type: "video_url", video_url: { url: "ms://<file_id>", id: "<file_id>" } }`，在无 `/v1/files` 通道时自动回退至内联 `{ type: "video_url", video_url: { url: "data:video/<ext>;base64,..." } }`，包裹 `<video path="...">` 与 `<system>` 标签，并通过 `role: "tool"` 消息的 `keep_parts` 数组原样发送给模型。

### 验证 (Verified)
- `npm run typecheck` 通过、`npm test` **117/117** 全绿、`npm run build` 通过（见 [`tests/core/tool-adapter.test.ts`](tests/core/tool-adapter.test.ts) 与 [`tests/core/dual-core.test.ts`](tests/core/dual-core.test.ts)）。

---

## [2026-10-17] 双核心：主动陪伴 + 上下文管理（DUAL-CORE-20261017）

按用户确认的双核心方案实现 DC1–DC5（设计与证据见 [`docs/主动陪伴与上下文管理-v1.md`](docs/主动陪伴与上下文管理-v1.md)）。运行包 `release/dual-core`，入口「`启动 GalAgent 双核心版.cmd`」；默认入口未切换。

### 新增 (Added)
- **全局并发池** [`runtime/core/pool.ts`](runtime/core/pool.ts)：所有 K3 请求共用上限 20（上限非配额），优先级 用户对话 > 注意力 > 执行 > 记忆/日记，超出排队不报错，429 时临时减半；执行器接入同一池。
- **注意力代理** [`runtime/core/attention.ts`](runtime/core/attention.ts)：独立上下文判断 `silent/observe/schedule/wake`；重要事件即时判断，其余随 1 分钟心跳，无变化不调用模型；single-flight、证据 ID 校验、持久关注列表与预约检查、叫醒在主角色忙碌时延后且 10 分钟过期、用户输入/安静/暂停使在途结论作废、失败指数退避。
- **感知** [`runtime/desktop/perception.ts`](runtime/desktop/perception.ts)：截屏（主进程内存生成、变化时≤1张/分钟、空闲/锁屏/全屏/黑名单/暂停不截、原图不落盘只存文字摘要）；剪贴板最近 50 条，由固定观察助手先检查 `ExcludeClipboardContentFromMonitorProcessing`、`Clipboard Viewer Ignore`、`CanIncludeInClipboardHistory=0` 再读正文。按键内容不采集。
- **记忆** [`runtime/core/memory-plus.ts`](runtime/core/memory-plus.ts)：事实抽取改为 ADD/UPDATE/DELETE/NOOP（UPDATE/DELETE 保留历史区间）、重要度 1–5、检索轻量混合重要度与新近度、核心记忆常驻；每 10 次互动（10 输入 + 10 输出）由她写一篇第一人称日记，可检索、不晋升为用户事实。
- **闭环**：后台任务结束 → 注意力代理判断 → 主角色只收事件结论并以人设口吻汇报；执行代理接收简报包（摘要 + 相关记忆），不复制完整对话。
- **界面**：截屏/剪贴板开关、截屏黑名单编辑、并发/注意力/日记状态、日记卡片；托盘「暂停观察」立即停止截屏与剪贴板。

### 验证 (Verified)
- `npm test` **115/115**（新增 [`tests/core/dual-core.test.ts`](tests/core/dual-core.test.ts) 20 项）；隔离打包原生验收 [`docs/evidence/双核心原生验收.json`](docs/evidence/双核心原生验收.json)（`passed: true`）；真机剪贴板敏感格式探针通过。
- **真实 Mira 0.0.479 平台 K3 端到端验收** [`docs/evidence/双核心真实K3验收.json`](docs/evidence/双核心真实K3验收.json)（`passed: true`，[`tests/e2e/dual-core-live.mjs`](tests/e2e/dual-core-live.mjs)）：10 轮真实 K3 对话、饮品偏好更正走 `UPDATE` 替换旧记忆、满 10 轮自动生成第一人称角色日记《把阿黄轻轻放进星图》、真实 `agent.run` 调用 `Read` 工具统计 `README.md` 二级章节、注意力代理独立上下文返回 `wake` 并唤醒主角色主动汇报结果、并发峰值 `2 ≤ 20`。

---

## [2026-10-17] Kimi 专属 Live2D 模型完整交付与立绘级精修定稿

按「独立做好专属 Live2D 模型并通过透明窗口真机验收，暂不改动正式 GalAgent 主运行包」的目标，完成星月魔女 Kimi 专属 20 层 PSD 拆层补画、Cubism Editor 5.3.04 官方绑定导出、高分屏抗锯齿查看器及多轮立绘级面部/发丝精修。

### 新增 (Added)
- **专属 20 层无损 PSD 与遮挡补画管线**（[`scripts/build-aligned-live2d-layers.mjs`](scripts/build-aligned-live2d-layers.mjs)、[`scripts/prepare-live2d-source.mjs`](scripts/prepare-live2d-source.mjs)、[`scripts/write-layered-psd.mjs`](scripts/write-layered-psd.mjs)）：
  - 基于 `1024×1536` 母版 [`art/live2d/front-master-v02.png`](art/live2d/front-master-v02.png) 与三视图/角色设定图，自动拆分并补画 20 个独立图层 [`art/live2d/layers/*-v02.png`](art/live2d/layers/)（含后发 `back-hair`、衣裙躯干 `body-and-skirt`、左右手臂 `arm-left/right`、腰部挂饰与长笛丝带 `waist-accessories`、无五官立体肤色脸底 `face-base`、左右眼白 `eye-white-left/right`、2x 超采样手绘虹膜 `iris-left/right`、上眼睑睫毛 `eyelash-left/right`、闭口唇线 `mouth-closed`、张口粉润内腔 `mouth-interior`、左右侧发 `side-hair-left/right`、前发刘海 `bangs`、双眉 `eyebrow-left/right`、女仆发带与棱镜彩虹蝴蝶结 `head-accessories`）。
  - 封装无损分层 [`art/live2d/kimi-layered-source-v02.psd`](art/live2d/kimi-layered-source-v02.psd)（20 图层）。
- **Live2D Cubism Editor 5.3.04（FREE 模式合规）全自动绑定与导出**：
  - 建立 `Warp_Body` 与 `Warp_Head` 层级弯曲变形器、20 个高密度网格部件、左右眼白对左右虹膜的 Clipping Mask 遮罩。
  - 绑定 27 个有效参数：头部三轴（`ParamAngleX/Y/Z`）、身体三轴（`ParamBodyAngleX/Y/Z`）、呼吸（`ParamBreath`）、双眼开合与笑眼（`ParamEyeLOpen/ROpen/LSmile/RSmile`）、视线追踪（`ParamEyeBallX/Y`）、双眉高低与角度（`ParamBrowLY/RY/LAngle/RAngle`）、嘴形与开合（`ParamMouthForm/OpenY`）、脸颊红晕（`ParamCheek`）及 3 组多重摆物理（`ParamHairFront/Side/Back`）。
  - 导出 [`art/live2d/kimi.cmo3`](art/live2d/kimi.cmo3)、[`art/live2d/export/kimi.moc3`](art/live2d/export/kimi.moc3)（`136,768 bytes`）、[`art/live2d/export/kimi.2048/texture_00.png`](art/live2d/export/kimi.2048/texture_00.png)（`2048×2048` 纹理图集）、[`art/live2d/export/kimi.physics3.json`](art/live2d/export/kimi.physics3.json) 及 6 种角色表情 [`art/live2d/export/expressions/*.exp3.json`](art/live2d/export/expressions/)（`neutral`、`curious`、`pleased`、`flustered`、`annoyed`、`softened`）。
- **高清抗锯齿大视窗与全屏/景别控制**（[`prototypes/live2d/`](prototypes/live2d/)）：
  - 预览窗口升级为 `1120×920`，新增「**全屏**」一键切换按钮及「**特写 / 近景 / 全身**」三档景别按钮。
  - 启用 `>= 2.0x` 超采样渲染分辨率、WebGL 三线性 Mipmap 过滤（`gl.LINEAR_MIPMAP_LINEAR`）与各向异性过滤（Anisotropic Filtering），彻底消除小窗口像素压缩感。

### 修复与视觉精修 (Fixed)
- **面部中轴线扶正与五官对称校准**：
  - 修复原图母版头部自带 `-7.9°` 倾斜及下巴右偏导致的「脸歪」问题，通过 `srcFromStraightHead` 将双眼、鼻梁、鼻尖、嘴唇与下巴统一对齐至垂直中心线 `x = 500.2`（双眼水平位于 `(463.2, 160.3)` 与 `(536.8, 160.3)`）。
- **原画级 2x 超采样星空紫瞳与立体鼻梁/面中过渡**：
  - 从高清立绘原图双线性超采样提取手绘星空紫虹膜纹理，移除生硬的程序化纯白圆点反光；完整保留原画师手绘的柔光鼻梁高光、暖杏色鼻尖点、额头刘海投影与面中立体过渡。
- **嘴部造型重绘与张口唇线阴影修复**：
  - 在扶正后的水平坐标系 `(500.2, 201.2)` 重绘柔和闭口唇线 `mouth-closed` 与粉润张口内腔 `mouth-interior`，去除闭口下方挂着的歪斜 U 型阴影块。
  - 修复张口时 `mouth-closed` 未隐藏且向上位移导致的「上唇悬空阴影条」问题：为 `ParamMouthOpenY` 配置 `{0, 0.12, 0.5, 1.0}` 关键帧，当 `open > 0.05` 时将 `mouth-closed` 不透明度设为 `0.0`，张口时仅显示干净饱满的粉色口腔。
- **闭眼与笑眼眼部瑕疵及弧度修复**：
  - 消除 `face-base` 眼窝区域的浅白矩形块、外眼角 `x = 444 / 553` 竖向深色条纹以及左眼内角 `x = 479` 与刘海交界处的竖白印；清除 `bangs` 在 `(479, 158)` 的原图深色睫毛残点。
  - 修正闭眼变形公式：使**闭眼/眨眼**自然向下柔和弯折（`︶` `︶`），**笑脸/欣喜**向上弯起成月牙笑眼（`︵` `︵`），并在闭眼时将上眼睑折痕收拢（`scaleClose = 0.42f`），消除闭眼睫毛上方的深色双线阴影。
- **转头时腮红穿帮修复**：
  - 将左右侧发 `side-hair-left/right` 在 `y <= 204`（太阳穴与脸颊红晕高度）的水平摆动权重锁死为 `w = 0`，使侧发在转头时与脸颊 100% 同步运动，不再滑过腮红或露出脸颊硬边。
- **左侧头发外延深色背景白边修复**：
  - 修复 `back-hair` 生成逻辑中内部防穿帮椭圆遮罩 `mCore` 在 `ma === 0`（角色轮廓外纯透明区域）仍绘制 `RGB(220, 214, 236)` 半透明像素的问题，增加 `if (ma === 0) continue;` 门控并收紧内核半轴至 `rx = 128`，在深紫色/深色桌面壁纸下发丝边缘 100% 干净锐利。

---

## [2026-10-10] 全时期统一人设接入与 OpenAI-Kimi 25 工具正式适配

### 新增与变更 (Added & Changed)
- **全时期统一人设运行接入 (`UNIFIED-PERSONA-20261010`)**：
  - [`runtime/core/persona.ts`](runtime/core/persona.ts) 接入 [`docs/人设总册-v1.md`](docs/人设总册-v1.md) v1.3 统一人设（爱弹钢琴、亲近、娇多傲极少、有活力、吃醋胡闹但很好哄），取消变量驱动的分阶段性格切换，全时期统一口吻与动作上限。
  - 产出正式运行包 `release/unified-persona/win-unpacked/GalAgent.exe`。
- **OpenAI 兼容反代 25 工具正式适配 (`OPENAI-KIMI-TOOLS-20261010`)**：
  - 新增 `tool-protocol.ts`、`tool-host.ts`、`openai-agent.ts`，通过本地 OpenAI 兼容反代（`http://127.0.0.1:18890/v1`、`kimi-code/k3`）原生支持 25 个 Kimi Code 工具定义、本地执行与 `tool_call_id` 闭环回传。
  - 详见 [`docs/OpenAI-Kimi工具正式适配.md`](docs/OpenAI-Kimi工具正式适配.md)。

---

## [2026-10-09] 人物变量系统与动态桌宠首版交付

### 新增 (Added)
- **人物变量系统 (`VARIABLES-20261009`)**：实现关系四轴、衰减情绪、场景面、真实时间 1:1 及 SQLite 持久化与隐私删除账本（[`docs/人物变量系统-v1.md`](docs/人物变量系统-v1.md)）。
- **透明动态桌宠首版 (`living-pet`)**：实现 Windows 透明桌面窗口、双击贴身短输入、SQLite 记忆/札记管线、`multilingual-e5-small` 本地语义检索与 RRF 融合。
