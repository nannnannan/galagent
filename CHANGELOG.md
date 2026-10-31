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
