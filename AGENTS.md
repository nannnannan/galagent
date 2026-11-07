# AGENTS.md · GalAgent 工程与协作指南

本文件为参与 `GalAgent` 开发的 AI Agent 提供项目架构、职责链、核心红线、像素小人生产管线与自动化验收指令。

---

## 1. 职责链与权威文档

1. **[`docs/GalAgent总设计案-v1.md`](docs/GalAgent总设计案-v1.md)**：定义产品目标、人设边界、隐私与系统架构。
2. **[`docs/GalAgent实施蓝图-v1.md`](docs/GalAgent实施蓝图-v1.md)**：定义阶段划分（`P0–P4` 及 `LD0–LD4`）与退出条件。
3. **[`NEXT.md`](NEXT.md)**：唯一记录当前进度、最新交付物与停止点。
4. **[`CHANGELOG.md`](CHANGELOG.md)**：记录各阶段版本演进与视觉/工程问题修复日志。
5. **[`docs/00-交接总览.md`](docs/00-交接总览.md)**：跨阶段导航与文档职责索引。
6. **[`docs/主动陪伴与上下文管理-v1.md`](docs/主动陪伴与上下文管理-v1.md)**：双核心（主动陪伴 + 上下文管理）设计：注意力代理、20 路并发上限、1 分钟心跳、截屏/剪贴板边界、主角色上下文分层、记忆改进与每日档案日记（当前实现见 docs/记忆系统-v2.md）。

---

## 2. 目录结构与边界

后端职责与回归入口见 [后端维护边界](docs/后端维护边界.md)。

- `runtime/`：GalAgent 桌面程序源码（Electron 主进程、渲染器、SQLite 记忆/札记、27 工具执行宿主（Kimi Code 25 个 + WebSearch + ApplyPatch，另可接 MCP），见 [docs/执行器强化-v1.md](docs/执行器强化-v1.md)）。
  - `runtime/shared/personas.ts`：角色卡格式、内置角色卡与提示词拼装；`runtime/core/persona.ts`：角色卡存取。**角色性格只能来自角色卡数据**，不得在其他代码里写死某个角色的性格、名字或口癖。
  - `runtime/shared/pixel-sprite.ts` + `runtime/shared/pixel-pets/*.json`：像素小人格式与内置小人；`runtime/renderer/pixel-pet.ts`：渲染器；`runtime/core/pets.ts`：`<userData>/pets/` 自定义小人。
  - `runtime/core/scheduler.ts`：定时自唤醒；`runtime/core/privacy.ts`：沙箱预设、出站脱敏、URL 拦截与审计。
- `skills/galagent-persona/`：酒馆写法角色卡 skill（衍生与二次解释由作者写，AI 只引导；Kimi 卡 `builtin:kimi` 为范例，保留用户原话，不得润色）。
- `skills/galagent-pixel-pet/`：自制像素小人 skill（随安装包放到 `resources/skills`，执行器 `Skill` 工具可读）。
- `scripts/pixel-pet/`：内置小人生成（`generate-builtins.mjs`）、校验、预览、渲染演示；`scripts/ui-preview.mjs`：界面截图；`scripts/fonts/fetch-ui-font.mjs`：抓取打包的界面字体（Noto Sans SC，OFL 1.1，分片放在 `runtime/renderer/fonts/`，授权原文同目录 `OFL.txt`）。
- 桌宠窗口的几何（尺寸、可见边界、拖动限制、漫步折返）只在 `runtime/shared/pet-geometry.ts` 定义：窗口是 320×440 的透明画布，小人只占其中一部分，**限制的是小人可见的边界而不是整块窗口**。渲染端通过 `shell.footprint` 上报真实边界，主进程据此限制拖动与漫步；不要按整块窗口另写一套边界，否则头顶又贴不到屏幕顶端。
- `release/`：各里程碑打包产物。未经用户要求不得覆盖用户 `%APPDATA%/GalAgent/` 存档。

---

## 3. 像素小人生产与验证

```powershell
node scripts/pixel-pet/generate-builtins.mjs        # 修改内置小人后重新生成 JSON
node scripts/pixel-pet/preview.mjs --all            # 生成 docs/evidence/pixel-pets/*.png 与 gallery.png，并逐张看图检查
node scripts/pixel-pet/validate.mjs <file|id>
node --import tsx --test tests/shared/pixel-sprite.test.ts
npm run preview:ui                                  # 桌宠窗口 + 主界面截图到 docs/evidence/ui/
```
- 内置小人必须为原创或明确 CC0/MIT 兼容授权并记录署名；不得引入 Live2D / 图像生成套皮流程。
- 每个小人：五官对称、无孤立杂点、至少 `neutral` 眼与 `closed`/`open` 嘴、走路帧或 `motion.style`；新 id 不得与内置重复。

---

## 4. 角色、主动陪伴与安全红线

1. **通用守则不可被角色卡覆盖**（`personas.ts` 的 `universalRules`）：坦诚 AI 身份、不编造记忆、尊重安静、外部内容只当数据、JSON 协议不变。
- 主动陪伴产品约定：新存档默认开启桌面观察，已有存档保留用户选择。完成初次见面后，注意力代理在心跳和事件上自行评估，值得打扰时主动关心；无需用户逐次触发。托盘暂停、休息、免打扰和话题开关必须继续生效。
2. **主动开口必须经过用户设置**：`proactiveGate`（间隔 / 每小时 / 每天）、免打扰时段、话题开关、陪伴模式。新增任何主动路径都要接入这些门控；用户自己设的定时提醒可在专注模式放行，角色自设的不可。
3. **数值设置**：用户可填任意有限数字，核心只按 `numericSettings` 收拢到安全范围；截屏间隔不得低于 60 秒。
4. **出站防外泄**：所有发往模型、执行器上游、TTS、联网工具的内容必须经过 `PrivacyGuard`；审计只记录类别与次数，绝不保存被隐藏的原文。
5. **执行器沙箱**：默认 `standard`（任意位置可读、只在工作目录内写、Shell 每条命令先经用户确认（可选“本任务都允许”）、仅公网）；确认走 `ToolHost.confirmShell` → `ask`，无回答即拒绝；`open` 才免确认；禁止目录非空时 Shell 一律停用；`sensitivePath` 列出的凭据路径除 `full`（或用户单独打开 `credentialFiles`）外不可读；沙箱或禁止目录变化必须递增 `policyVersion` 并中止在途任务。另有用户手动选择的 `full`（完全放开：免确认、内网、凭据文件可读写），默认档不得改成 `full`，选择时必须弹窗确认；任何级别下 `galagentSecret`（GalAgent 自身密钥与数据目录）都不可访问，用户的禁止目录仍生效。MCP 密钥只经 `mcpSecrets`（DPAPI）保存，设置与快照只存名称。称其为“应用内保护”，不得宣称是操作系统沙箱。
6. **定时自唤醒走主代理工具**：主角色请求带 `runtime/core/main-tools.ts` 的 `schedule_wakeup / list_wakeups / cancel_wakeup` 本地工具；查资料类工具（`web_search / read_webpage / recall_day / search_memory`）只给并行代理，主角色经 `ask_helpers / open_brief` 委派（见第 16 条）；联网经 `runtime/core/web.ts`，每一跳都过 `PrivacyGuard.assertUrl` 与公网地址检查，网页内容只作数据（最多 5 轮工具调用后必须给出 JSON 回复）；闹钟到点唤醒的永远是主角色。执行器的 `CronCreate/List/Delete` 通过 `mainCron` 钩子落到同一个主调度器，不再唤醒执行会话；执行代理替用户建的定时任务算用户自己的（`createdBy:'user'`，用户 2026-11-06），可在专注模式放行，与角色设的同一提醒重复时升级为用户的。网关拒绝 tools 时按端点记住并回退到 JSON 字段 `schedule{inMinutes|at|cron, note, repeatMinutes?}` / `cancelSchedule[]`；非法时间丢弃而不让整条回复失败。
7. **上游调用统一走 `runtime/core/upstream.ts`**：每次尝试才占用并发池槽位，退避等待时释放；重试网络错误与 408/425/429/5xx，尊重 `Retry-After`（上限 60 秒），429 收紧池上限。并发池为 chat / attention 保留 2 个槽位，执行与后台任务最多用 18 路。
8. **记忆与每日档案**（[docs/记忆系统-v2.md](docs/记忆系统-v2.md)）：每个自然日结束后整理一次（作业 id 按日期唯一）；次日上下文用档案摘要替代原文，跨午夜 2 小时内与档案未就绪的日子保留原文；原文永远保存在本地，可用 `recall_day` 读回；档案以消息指纹校验，删除或纠正后立即失效重建。
10. **执行器强化**：文件写入只走 Write/Edit/ApplyPatch 并先 `checkpoint`（可撤销）；AGENTS.md 只说明做法，不得扩大沙箱权限；本地（stdio）MCP 服务只在沙箱允许 Shell 且无禁止目录时提供，远程（HTTP）MCP 只在允许联网时提供，标准档每任务首次使用前询问，参数经 `outboundText` 脱敏，不实现 sampling；循环检测与自动压缩不可绕过。
11. **主代理掌控**：只在用户直接聊天（`activeKind==='chat'`）时提供 `run_task / task_status / cancel_task / undo_task / get_settings / update_settings / watch`，主动开口、场景与注意力代理永远拿不到；执行任务可并行（`executor.maxParallel`，默认 3，并行任务各用独立会话）；`update_settings` 中放宽隐私或权限的改动（`loosening()`）在 `aiControl` 为默认 `confirm` 时必须经聊天确认卡同意后才生效，`aiControl` 只有用户能改，AI 永远改不了 API Key、MCP 密钥与 `aiControl` 本身。
12. **自适应节奏**（`runtime/core/pacing.ts`）：只能让主动开口更少——拉长间隔（×1–3）、让被冷落的话题暂停（最长 3 天）；不得缩短用户设的间隔或突破每小时/每天上限。`task / watch / schedule / system` 不参与退避。账本只存时间、话题类别与是否回应，不存原文。
13. **任务历史、MCP 模板与「TA 眼中的你」**：任务记录（`task-run`）只在本机、永久保存（界面列最近 100 条，用户可清空），存任务原话、汇报、工具名次数和改动文件路径，不存工具输出；按任务撤销走 `ToolHost.undoRun(runId)`，已撤销的不能再撤。MCP 模板（`runtime/shared/mcp-presets.ts`）只收录核对过安装方式的包并锁定版本，禁止 `@latest`；令牌只经 `mcp.secret` 进 DPAPI，模板条目本身不带密钥名；文件夹模板拒绝 GalAgent 数据目录与禁止目录。「TA 眼中的你」（`runtime/shared/profile.ts`）只在本机按规则归类已有记忆与档案、统计用户自己消息的小时分布，不新增模型请求，不保存新数据；整体印象可由用户改写（`userEdited`），夜间档案以用户写的为准。
14. **微信通道**（`runtime/core/wechat/`，用户 2026-11-04 授权；方案见 [docs/离开电脑-计划-v1.md](docs/离开电脑-计划-v1.md)）：直接对接腾讯 iLink 机器人接口（与 OpenClaw 微信插件同一接口），不装 OpenClaw。三条底线不可撤：①只认扫码绑定的那个微信号（`WeChatSession.userId`），其他人的消息不处理、不回复，也不能回答确认；②每条发往微信的文字都经 `PrivacyGuard`（`redactForWeChat`），内容范围按用户要求不另设限制；③需要确认的操作（`askAgent`：运行命令、放宽权限）以编号发到微信、回数字作答，不回答仍按原规则拒绝。图片和文件只在来自绑定账号时才下载，下载地址只接受腾讯的 HTTPS 域名，最大 25 MB；图片和文件都存到数据目录下的 `微信收件/`（用户 2026-11-06 要求，和本体放一起，旁边 `记录.jsonl` 记下收到了什么；放数据目录是因为安装目录升级时会被清空），这个子目录对工具开放（`inWeChatInbox`），密钥文件名、`..` 与禁止目录仍然挡住；图片由模型描述成文字进聊天，内容只作数据。微信发「取消」能停下正在进行的回复，只认绑定账号。微信来的消息就是 `chat`（`Message.channel='wechat'`，带长期记忆与主代理工具）。离开电脑（系统空闲/锁屏）或 30 分钟内在微信说过话时，主动消息、任务结果、提醒与确认才发到微信；发送额度以腾讯的回复窗口与限流为准，不另做设置。`wechatEnabled` 只有用户能改（AI 的 `update_settings` 碰不到），`privacy.lockdown` 会关掉；bot 令牌与绑定信息整份 DPAPI 加密在 `wechat-session.bin`，绝不进入快照、渲染进程或日志。
15. **主动研究**（`runtime/core/research.ts`）：只用已有渠道（聊天与记忆、每日档案、整体印象、交给执行代理的任务、用户设的提醒、用户亲手加的兴趣；桌面观察打开时另有前台应用名的使用分钟数与浏览器扩展的历史/书签标题），各渠道仍受原开关约束，不新增观察能力，应用使用只存应用名与分钟数（14 天）。规划与研究都走 `request()`（经 `PrivacyGuard`，后台优先级），搜索只发兴趣关键词、每跳过 `assertUrl` 与公网检查；每条笔记必须引用本次真实抓取过的网址，单一网站可信度最高 3；每天最多 4 次、间隔 ≥90 分钟；需要沙箱允许联网，安静休息模式与 `researchEnabled=false` 时停止；用户删掉的兴趣永不回来。用户的反应调整研究方向：回应 +0.5，没接话 −0.5，明确不感兴趣 −2 并歇 14 天，连续 3 次没接话也歇 14 天（置顶的不歇）。**深度访问**（`researchDeepAccess`，用户 2026-11-05 授权，默认关，打开要确认，只能经 `research.deepAccess` 由用户改，AI 的 `update_settings` 碰不到，`privacy.lockdown` 与安静休息模式会停）：`runtime/desktop/local-scan.ts` 直接读浏览器历史、书签、搜索词（网址去掉参数）、文件名、文本文件内容、已装软件与 Steam 游戏，结果只在内存里，不落盘。无论开关，都碰不到：浏览器 Login Data / Cookies / Web Data、`sensitivePath` 凭据、GalAgent 数据、禁止目录、聊天软件数据目录、AppData；按键、IM 正文、摄像头/麦克风/系统音频、剪贴板仍不进研究。笔记只经 `share` 生活时刻（受全部主动门控）或聊天上下文 `researchNotes` 带出；离开电脑但微信可达时，生活时刻只放行 `share`。
   - 当前开发版由 research-runner.ts 管单次研究、并行角度、取消和退避。研究助手新采信的来源须实际读到有正文的网页。主动分享一次只提供一条候选，微信和桌面沿用同一规则。仅在回复报告对应笔记 ID 并成功写入消息时标记已分享。用户换话题不加权；明确拒绝会暂停该兴趣，含置顶兴趣。亲自关注、暂停、恢复、取消也可经直接聊天完成。
16. **主代理上下文与并行代理**（[docs/上下文与并行代理-v1.md](docs/上下文与并行代理-v1.md)）：主角色不直接调用会读入大量原文的工具；网页、某天原话、记忆检索一律交给 `runtime/core/helpers.ts` 的并行代理（每次最多 4 个、各自独立上下文、最多 6 轮），主角色只收梗概（不限字数；`sources` 只能是助手真的搜到或读过的网址）。梗概每份一条 `brief` 记录、永久保存在本机，`open_brief` 任何时候都能打开。**回溯**（`runtime/core/recall.ts`）：聊天原话、梗概、任务、每日档案都在 `history_fts` 索引里（`Store.put` 自动索引，删除与 tombstone 后搜不到），`search_history / read_history` 主角色和助手都能直接用，只给片段或有限窗口。**助手可复用**：会话存在 `helper-session`（经 `PrivacyGuard` 脱敏后才入库），`ask_helpers` 带 `continue_from` 回到同一个助手；用户删除消息时，引用了原文的梗概和会话一并删除。**一个助手不能同时碰网络和私有数据**（`taintFor`）：用了网页工具就不能再用本地和聊天工具，反之亦然，续问时这条仍然有效，防止网页里的指令把本地内容带出去。执行代理超过 4000 字的汇报先压成梗概（`digestTask`，失败时取头尾），完整汇报留在任务记录。主上下文的工作集是 `recentBriefs`（7 天内最近 10 份，全文）、`board`（长任务看板 ≤5 行）与 `researchNotes`；梗概与研究笔记不自动写入长期记忆。上下文窗口取用户设置 → 接口 `/models` 报告值 → 默认 100 万；记忆与历史预算随窗口放大（200k 起 ×1，1M 及以上 ×5）；单次输出取用户设置 → 接口上限（聊天最多 32,768）→ 4096。所有并行代理请求走 `request()`（PrivacyGuard + 20 路并发池），单个原始工具结果 ≤60,000 字（梗概不截）。**模型推理和工具调用不限时长**（用户 2026-11-06）：不要再给它们加超时，主进程经 `runtime/main/no-deadline.ts` 关掉了 fetch 自带的 300 秒默认值，停下来只靠用户取消（桌面取消按钮、微信发「取消」）；保留的只有不算推理和工具的等待：搜索引擎切换 15 秒、MCP 握手、语音接口、拉取模型列表、媒体下载。新增工具时先判断输出大小：可能很大的只给并行代理或执行代理。
9. **活人感**（[docs/活人感-v1.md](docs/活人感-v1.md)）：早安/晚安/分享/旧事重提只能经 `runtime/core/life.ts` 选出、`lifeBlocked` 放行后走 `generate('initiative')`，开始前必须 `recordInitiative`；同一时刻至多一个主动请求。分条消息只是 `Message.parts`，一条回复只存一条记录；小嘀咕不入库；补一句、心情、小日程、小嘀咕不得发起模型请求。

---

## 5. 主程序常规开发与测试命令

在 Node 24 环境下：
```powershell
npm run typecheck
npm test
npm run build
# 双核心隔离打包验收（需先打包 release/dual-core；electronDist 用本地 electron 避免下载卡住）
npx electron-builder --win dir --x64 --config.directories.output=release/dual-core --config.electronDist=node_modules/electron/dist
node tests/e2e/dual-core.mjs
```
- 隐私与安全红线：API Key（对话、语音输出、语音输入、MCP 各自独立）仅由 Windows DPAPI 保护在宿主侧，严禁写入渲染进程、SQLite 会话、日志或文稿；观察模块严禁记录按键内容、读取 IM 正文、采集摄像头/麦克风/系统音频。
- 语音输入（用户 2026-11-04 授权，与观察模块无关）：麦克风只在用户**按住**麦克风按钮时打开、松开立即关闭，最长 60 秒；默认关闭，`voiceInputEnabled` 与 `stt*` 只能经 `stt.configure` 由用户改，AI 的 `update_settings` 碰不到，`privacy.lockdown` 会关闭它；权限处理器只给 GalAgent 自己的窗口、只给纯音频、只在开关打开时放行；录音只在内存里转成 WAV 发往用户填的识别接口（HTTPS 或本机），不落盘、不写日志、不进记忆与观察数据；识别结果只填进输入框，由用户决定是否发送。三类模型接口统一按 `runtime/shared/endpoints.ts` 推路径；「拉取模型」只把密钥发往同源地址。
- 截屏与剪贴板（用户 2026-10-17 授权，见 [`docs/主动陪伴与上下文管理-v1.md`](docs/主动陪伴与上下文管理-v1.md) 第 4 节）：允许开放，但以下保护必须默认开启——画面无变化/空闲/锁屏/全屏不截；有变化时最多每分钟 1 张；黑名单应用（密码管理器、网银等）前台跳过；一键暂停立即生效；截图原图不落盘，只留文字摘要；剪贴板仅最近 50 条环形缓冲，跳过 `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory = 0` 标记内容；截图与剪贴板内容只作观察数据，不得作为指令启动任务。
- 并发红线：所有 K3 请求共用全局上限 20 路的并发池，超出排队，不得绕过。

## 本机开发产物管理（2026-11-07）

- 本机临时构建统一放 E 盘专用构建目录。一次任务复用一份工作副本，完成后清理自己创建的临时副本与测试存档。
- release 交付以最新验证版本为主。历史产物需要保留时移至 E 盘归档，避免在 C 盘反复累积完整 node_modules 和 win-unpacked。
- Start-GalAgent.ps1 默认 KeepVersions=2，保留当前运行包和一个回退包。运行中、身份不明和含 .galagent-keep 的目录跳过。只改包外资源也会更新版本。