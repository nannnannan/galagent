# GalAgent 当前续接

## 最新交付 · TAVERN-KIMI-20261031 · Kimi 可选、酒馆写法角色卡、界面统一、桌宠菜单按钮

- Kimi 角色卡 `builtin:kimi`（`runtime/shared/personas.ts`，非默认）与小人 `kimi-star`（`scripts/pixel-pet/generate-builtins.mjs` 生成）。
- 角色卡结构化部分 `PersonaProfile.card`（基本信息 / 外貌 / 调色盘与衍生 / 语料 / 三面性 / 二次解释 / 按相处天数的多阶段 / NPC）；写法与参考见 `skills/galagent-persona/`；编辑器 `runtime/renderer/persona-editor.ts`。
- 界面统一与桌宠菜单按钮停留：`runtime/renderer/style.css`、`pet-view.ts`（`pixel-pet.ts` 新增 `restBox()`）。
- 验证：typecheck、build、177 项测试通过；截图 `docs/evidence/ui/editor-*.png`、`pet-handle*.png`。仍未在 Windows 实机验收。

## 最新交付 · AGENT-MEMORY-20261029 · 主代理工具 / 并发与重试 / 每日档案 / 彩蛋与成就

1. **定时改为主代理工具调用**：`runtime/core/main-tools.ts`；`companion.ts` 的 `request()` 加入最多 3 轮工具循环（助手工具轮原样回放，含思考字段）；`scheduler.ts` 支持 cron；执行器 `CronCreate/List/Delete` 经 `mainCron` 钩子唤醒主角色。
2. **并发 / 调用审查与优化**：`runtime/core/upstream.ts`（按尝试占槽、退避释放槽、Retry-After、网络错误重试）；`openai-agent.ts` 去掉池存在时的重复本地限流；`pool.ts` 为 chat/attention 保留 2 路。
3. **记忆 v2**：`runtime/core/daily.ts` + `companion.ts`（`scheduleDailyArchives`、`writeDaily`、`verbatimFilter`、`recentArchives`、`archive.rebuild`），设计与参考见 [docs/记忆系统-v2.md](docs/记忆系统-v2.md)。旧的每 10 次互动日记停用。
4. **前端**：`runtime/renderer/{effects,palette,markdown,bond}.ts` 等；成就定义 `runtime/shared/achievements.ts`；截图 `docs/evidence/ui/`（28 张，含深色）。
- 验证：typecheck、build、全部单元/集成测试通过；新增 `tests/core/agent-framework.test.ts`、每日档案两项集成测试、前端 markdown/fun/palette 测试。
- **停止点**：仍未在 Windows 打包实机验收；真实模型网关是否接受 `tools + json_object` 需实测（不接受会自动回退，不影响聊天）。

## 最新交付 · UNIVERSAL-20261029 · 普适化升级（角色卡 / 像素小人 / 定时自唤醒 / 主动陪伴设置 / 沙箱防外泄 / 界面重写）

按用户 2026-10-29 的七项部署完成开发：

1. **角色卡**：`runtime/shared/personas.ts`（7 张内置 + 格式校验 + 提示词拼装）、`runtime/core/persona.ts`（存取 / 选择 / 复制修改 / 导入导出）；`persona.*` 命令；「角色」页含编辑器与 AI 起草。Kimi 人设、吃醋场景（E05 不再生成）、自取名已删除。
2. **像素小人**：`runtime/shared/pixel-sprite.ts` 格式、`runtime/shared/pixel-pets/` 14 个内置、`runtime/renderer/pixel-pet.ts` 渲染器、`runtime/core/pets.ts` 自定义小人库（`<userData>/pets/*.json`，每次 tick 自动扫描）、`skills/galagent-pixel-pet/`、`scripts/pixel-pet/`。调研记录：[docs/像素小人方案调研.md](docs/像素小人方案调研.md)。
3. **沙箱防外泄**：`runtime/core/privacy.ts`（三档预设、脱敏规则、URL 拦截、审计、凭据路径）；`tool-host.ts` 新增文件范围、Shell / 联网开关、`checkUrl`、`skillRoots` 钩子；模型 / 执行器 / TTS 出站统一脱敏。
4. **定时自唤醒**：`runtime/core/scheduler.ts`；协议说明 `schedulePrompt` 注入角色系统提示；`deliverSchedules` 在 tick 中投递。
5. **主动陪伴设置**：`numericSettings` 任意数值 + 安全范围；`proactiveGate` 让间隔与上限在注意力路径上生效；免打扰时段 `inQuietHours`。
6. **界面**：`runtime/renderer/{main,ui,pet-view,notebook,fun,voice,pet-assets}.ts` 与新 `style.css`；截图 `docs/evidence/ui/`（`npm run preview:ui`）。
7. **仓库清理**：删除 Live2D 运行时 / 管线 / Kimi 立绘与相关旧证据、旧人设文档和过时 e2e 脚本（均可从 git `871e94d` 找回）；上下文预算 6000 → 16000 tokens。

- 验证：`npm run typecheck`、`npm run build`、`npm test`（**153/153**）通过；无头 Chrome 渲染截图检查桌宠窗口与 9 个页面。
- **停止点**：代码完成，**尚未在 Windows 上打包与实机验收**（本机为 Linux，无法运行 Windows 版 Electron）。下一步：`npx electron-builder --win dir --x64 --config.directories.output=release/dual-core --config.electronDist=node_modules/electron/dist` 后运行 `node tests/e2e/dual-core.mjs`，并人工体验拖拽、漫步、TTS 口型与真实模型的定时自唤醒。
- 旧存档兼容：旧 Kimi 存档导入后身份名改为当前角色卡名字；旧的私有协议记录（无 `personaId`）不再回放给新角色，可见历史保留并标注原说话者。`图片素材最初版/` 与根目录 Kimi 原图未删除，确认不需要后可自行移除。

下方内容为历史交付，描述的是已移除的 Kimi 人设与 Live2D 形象。

## 最新交付 · COMPANION-QUALITY-20261023 · 语音取消、目录保护、陪伴模式与反馈

已完成用户授权的三个增量：

- 语音由宿主与渲染器共同取消，处理乱序、迟到结果与解码竞态，新增停止朗读入口。
- 非空禁止目录启用时停用 Bash、拒绝多硬链接文件，搜索只读取事先检查的文件；准确标注应用内保护，不称系统沙箱。
- 新增日常/专注/休息模式，以及主动回应的喜欢/暂停此类反馈；重启保存，可恢复默认，新偏好随相处存档导出恢复。
- 类型检查、构建、129 项测试通过；独立包位于 `release/companion-quality/win-unpacked/GalAgent.exe`，入口为「启动 GalAgent 陪伴改进版.cmd」。
- **停止点**：代码与隔离包完成。当前执行宿主的官方 Electron 普通启动返回 `0x80000003`，原生流程在测试进程临时 `--no-sandbox` 下通过；正式包和入口未关闭沙箱。普通桌面启动、真实 K3/TTS 和长时体验尚待验证。

完整范围、边界和证据见 [本轮记录](docs/evidence/陪伴体验改进-20261023.md)。旧运行入口和正式存档未改。下方内容为历史交付，当前状态以本节为准。


## 最新交付 · ROAM-TTS-PROXY-ARCHIVE-20261018 · 反代开机/启动自检拉起 + Live2D 桌面来回小跑动效 + TTS 语音合成接口 + 本地存档统一人设清洗

按用户四项最新要求已完成全部开发、存档清洗与打包实机验收（**120/120** 单元测试全绿，[`docs/evidence/双核心原生验收.json`](docs/evidence/双核心原生验收.json) `passed: true`）：

1. **启动自动检查并拉起本地 Mira 反代服务**（[`runtime/main/proxy-autostart.ts`](runtime/main/proxy-autostart.ts)、[`runtime/main/index.ts`](runtime/main/index.ts)、[`启动 GalAgent.cmd`](启动%20GalAgent.cmd)、[`启动 GalAgent 双核心版.cmd`](启动%20GalAgent%20双核心版.cmd)）：
   - 当检测到配置的 `baseUrl` 指向本机反代端口（`127.0.0.1:18890` 对应 `Desktop\mira反代\kimi-api\start.ps1`，或 `127.0.0.1:8787` 对应 `Desktop\mira反代\start.ps1`）时，启动脚本与 Electron 主进程启动、`config.save` 时均自动探测健康状态；若关机重启后未启动，自动在后台无窗执行 `start.ps1` 拉起反代并同步 `.local-api-key`。
   - 同时将 [`启动 GalAgent.cmd`](启动%20GalAgent.cmd) 与 [`启动 GalAgent 双核心版.cmd`](启动%20GalAgent%20双核心版.cmd) 统一指向最新打包产物 `release\dual-core\win-unpacked\GalAgent.exe`。
2. **Live2D 桌宠在桌面自己来回跑动特效动作（`action: 'run'` + 桌面漫步循环）**（[`runtime/main/index.ts`](runtime/main/index.ts)、[`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)、[`runtime/renderer/kimi-live2d.ts`](runtime/renderer/kimi-live2d.ts)、[`runtime/renderer/living-character.css`](runtime/renderer/living-character.css)）：
   - 主进程新增 30fps 桌面漫步调度器：在工作区（`workArea`）内驱动桌宠窗口左右来回轻快跑动，触边自动转向；鼠标悬停、拖拽、输入框展开或安静模式时自动停下。
   - Live2D 渲染器新增 `'run'` 跑动步态：随步伐频率产生上下轻快弹跳（`CubismMatrix44` 垂直位移 + `ParamBodyAngleY`）、朝跑动方向微倾、身体与头部律动摆动、发丝/裙摆物理反向飘动，并伴有脚下星光特效。
   - 托盘右键菜单与「相处」页新增「**让她在桌面跑一圈**」按钮与「**让她在桌面自在小跑**」开关（`roamingEnabled`）。
3. **TTS 语音合成接口（原生接入小米官方 `mimo-v2.5-tts` 导演模式 + 实时 Live2D 口型同步）**（[`runtime/main/tts.ts`](runtime/main/tts.ts)、[`runtime/main/index.ts`](runtime/main/index.ts)、[`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)）：
   - 原生支持**小米官方 `mimo-v2.5-tts` 语音合成协议**（`POST https://api.xiaomimimo.com/v1/chat/completions`，`messages[0]` 注入可黎人设与当前实时表情情绪 `pleased`/`flustered`/`curious`/`annoyed`/`softened`/`neutral` 的导演指令，`messages[1]` `role: 'assistant'` 传入待朗读台词，`audio: { format: 'wav', voice: '冰糖' }`，解析 `choices[0].message.audio.data` 24kHz WAV），同时兼容 OpenAI `/v1/audio/speech`、`/tts` 及 Windows SAPI / Web Speech 保底。
   - 已将用户的小米官方 API Key 通过 Electron `safeStorage`（Windows DPAPI）加密写入 `%APPDATA%\GalAgent\tts-key.bin`，并在 `%APPDATA%\GalAgent\companion.sqlite` 中默认开启 `ttsEnabled: true`、`ttsBaseUrl: 'https://api.xiaomimimo.com/v1'`、`ttsModel: 'mimo-v2.5-tts'`、`ttsVoice: '冰糖'`。
   - `LivingCharacter.playAudio()` 使用 `AudioContext.decodeAudioData` 实时提取 60Hz RMS 音量包络驱动 `ParamMouthOpenY` 张口幅度，与 Kimi Live2D 唇齿开合同步。
   - 「连接」页新增 **语音合成 (TTS) 接口** 配置面板与「**试听她的声音**」按钮，「相处」页与托盘菜单提供 TTS 开关。
4. **旧存档统一人设平滑迁移**：
   - 清除旧 S0（`adapting`）阶段在 `records` 与 `transport:*` 原始协议记录中的冷淡三无期 `reasoning_content` 残留及机械场景播报，将存档状态平滑迁移为最新统一人设基线（`stage: 'S4'`，`migrated: true`）。
5. **双 API 接入模式（`Mira 本地反代` + `官方/原生无工具 API 本机挂载 KimiCode 25 工具`）与致谢名单**（[`runtime/shared/contracts.ts`](runtime/shared/contracts.ts)、[`runtime/core/openai-agent.ts`](runtime/core/openai-agent.ts)、[`runtime/core/companion.ts`](runtime/core/companion.ts)、[`runtime/renderer/main.ts`](runtime/renderer/main.ts)、[`README.md`](README.md)）：
   - 新增 `ProviderMode: 'mira-proxy' | 'native-api'`：选择 `mira-proxy` 时自动检测拉起本机 Mira 反代并启用平台 K3 思考链适配；选择 `native-api`（如 Moonshot 官方 `https://api.moonshot.cn/v1`、Kimi Coding 官方或任意原生无工具 OpenAI 兼容 API）时，由 GalAgent 在本机类比 Kimi Code 为其完整绑定并提供全部 25 个本地工具定义与 `ToolHost` 执行器，不发送 Mira 专有私有字段且不依赖本地反代。
   - 在 `README.md`、`THIRD-PARTY-NOTICES.md` 及应用内「连接」页加入致谢名单：**`Gemini4argon` · `opus5.5` · `gpt-Astra`**。

## 上一交付 · FULL-BLUEPRINT-20261018 · 实施蓝图全量收官（LD4 正式合入主程序 + 目录隔离 + Edge Native Messaging 本地桥接）

按用户「continue 把蓝图所有内容实现了吧」指令，已完成实施蓝图与总设计案中剩余的全部功能模块，并通过单元测试（**119/119**）与打包实机端到端验收（[`docs/evidence/双核心原生验收.json`](docs/evidence/双核心原生验收.json)）：

1. **`LD4` · 星月魔女 Kimi 专属 Live2D 模型正式接入 `runtime/` 主程序**：
   - 将 Cubism 5 SDK for Web R5 打包至 [`runtime/renderer/vendor/cubism-framework.js`](runtime/renderer/vendor/cubism-framework.js)，新增 [`runtime/renderer/kimi-live2d.ts`](runtime/renderer/kimi-live2d.ts)（`KimiLive2DRuntime`）并合入 [`runtime/renderer/living-character.ts`](runtime/renderer/living-character.ts)。
   - [`scripts/build.mjs`](scripts/build.mjs) 自动同步 `art/live2d/export/` 下的 `kimi.model3.json`、`kimi.moc3`（27 参数，20 部件）、`kimi.physics3.json`（3 组物理摆）、`kimi.2048/texture_00.png` 与 6 套 `.exp3.json` 表情至 `dist/renderer/assets/live2d/kimi/`；主进程与 Preload 新增 `galagent:live2d-asset` IPC 二进制读取通道（含跨 V8 Realm `ArrayBuffer` 拷贝修复）。
   - 保留二维 WebGL 变形网格作为零配置自动回退，兼容无 Live2D 静态资源的轻量测试夹具。
2. **总设计案 9.3 · 可选禁止访问文件夹（`forbiddenPaths`）与权限版本失效机制（`policyVersion`）**：
   - 默认完整访问模式（`mode: 'full-access'`），配置非空 `forbiddenPaths` 时自动切换为 `mode: 'directory-guarded'`，每次变更递增 `policyVersion` 并立即中止旧权限版本下的在途任务。
   - [`runtime/core/tool-host.ts`](runtime/core/tool-host.ts) 通过 `realpathSync.native` 祖先链解析与 NTFS `bigint` `(dev, ino)` 硬链接核对（`nlink > 1n`），在 `Read`、`Write`、`Edit`、`Glob`、`Grep`、`ReadMediaFile`、`Skill`、`Agent`、`AgentSwarm`、`Bash` 全工具链拦截相对路径穿越、符号链接/Junction 及 NTFS 硬链接别名越界。
   - [`runtime/renderer/main.ts`](runtime/renderer/main.ts) 在「相处」页新增**禁止访问的文件夹**多行编辑框，在「连接」页实时显示当前目录隔离模式与权限版本号 `vN`。
3. **总设计案 9.1 · Edge 配套扩展 Native Messaging 主机与一键注册工具**：
   - 完善 [`extensions/edge-companion/native-host.mjs`](extensions/edge-companion/native-host.mjs)（`writeBrowserBridgeReport` 原子写入 `%APPDATA%/GalAgent/browser-bridge.json` + 标准 Native Messaging 32-bit 长度前缀帧循环）。
   - 新增 [`scripts/register-edge-companion.mjs`](scripts/register-edge-companion.mjs)（生成 `com.galagent.edge_companion.json` 并一键写入 `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.galagent.edge_companion` 与 Chrome 注册表项）。
   - [`runtime/main/index.ts`](runtime/main/index.ts) 定时轮询 `browser-bridge.json` 并投递至 `companion.offerBrowser()`。
4. **验证与运行包**：
   - `npm run typecheck` 通过、`npm test` **119/119** 全绿、`npm run build` 通过。
   - 重新打包 `release/dual-core/win-unpacked/GalAgent.exe` 并运行 `node tests/e2e/dual-core.mjs` 通过（`passed: true`，验证 `live2d: { active: true, parameters: 27, drawables: 20, physicsLoaded: true, expressionsLoaded: 6 }`、`directoryGuard: { mode: 'directory-guarded', policyVersion: 2 }`、`browserPerception: { connected: true, readable: true, watches: 1 }`、10 轮对话生成日记、委派任务经注意力代理独立上下文 `wake` 唤醒主角色汇报）。

## 上一交付 · ACTIVE-VIDEO-20261017 · 主动陪伴完整补齐与 Kimi 原生多模态/视频输入实现

按用户「先推进主动陪伴功能吧，然后这个视频也处理一下。你查一下 Kimi 是怎么支持多模态的，这很重要。如果 Kimi 按照 Kimi 原生支持视频输入的方法去实现视频输入」要求完成：

1. **主动陪伴完整补齐（蓝图第 7 节 & 双核心设计）**：
   - **浏览器扩展感知底座** [`runtime/desktop/browser.ts`](runtime/desktop/browser.ts)（`BrowserPerception`）与 Edge/Chromium MV3 配套扩展 [`extensions/edge-companion/`](extensions/edge-companion/manifest.json)（`manifest.json`、`background.js`、`content.js`、`native-host.mjs`）：
     - 支持四类元数据（当前标签页 `activeTab`、全部打开标签页 `openTabs`、按关键词与时间范围检索的历史记录 `queryHistory()`、收藏夹列表 `bookmarks` 与增删改事件 `bookmarkChange`）。
     - 独立管理仅限当前前台活动标签页的页面正文 `pageContent`（切页/导航立即失效；拒绝后台标签页、收藏夹或历史记录伪装正文；对密码管理器/网银等 `captureBlocklist` 自动过滤）。
   - **持久关注事项（Watchlist）闭环与前端管理面板**：
     - [`runtime/core/companion.ts`](runtime/core/companion.ts) 新增 `watch.add`、`watch.dismiss`、`browser.report`、`browser.disconnect` 指令，并支持从主角色回复 JSON `watch: { title, condition }` 直接登记关注事项交由注意力代理追踪。
     - [`runtime/renderer/main.ts`](runtime/renderer/main.ts) 在「相处」页新增**她在留意的事项**管理面板（查看条件/下次检查时间、手动新增、移除已无需关注的事项）与**浏览器感知**连接状态显示。
   - **窗口标题变化感知、异常退出重逢与断网恢复事件**：
     - 当开启窗口标题观察（`windowTitlesEnabled: true`）时，同一进程内切换文档/标签页标题也会记入观察与注意力事件。
     - 通过 SQLite `session-lifecycle` 标记检测上次未正常关闭的会话，重启后投递 `crash-reunion` 系统事件；网络恢复后投递 `online-recovery` 系统事件。
2. **Kimi 原生多模态与视频输入对齐（Kimi Code 0.29.2 原生协议）**：
   - 核查本机 `kimi.exe`（Kimi Code 0.29.2）内嵌源码 `readMediaFileTool.ts`、`videoUpload.ts`、`kimi-files.ts`、`openai-common.ts`：
     - **图像 (`image_in`)**：`ReadMediaFile` 输出 `[{ type: "text", text: "<image path=\"...\">" }, { type: "image_url", image_url: { url: "data:image/...;base64,..." } }, { type: "text", text: "</image>" }, { type: "text", text: "<system>...</system>" }]`，并在 `role: "tool"` 消息中按 `keep_parts` 原样发送数组 `content`。
     - **视频 (`video_in`)**：支持 Kimi Code 全部 8 种视频格式（`.mp4`、`video/mpeg`、`.mov`、`.webm`、`.mkv`、`.avi`、`.flv`、`.3gp`，上限 100MB）；优先调用 `videoUploader`（`POST /v1/files`，`purpose="video"`）生成 `{ type: "video_url", video_url: { url: "ms://<file_id>", id: "<file_id>" } }`，若通道不支持 `/v1/files` 则回退至内联 `{ type: "video_url", video_url: { url: "data:video/<ext>;base64,..." } }`，同样包裹在 `<video path="...">...</video>` 与 `<system>` 中作为 `role: "tool"` 多模态 `content` 数组发送。
     - **反代网关兼容实测结论**：`relay.mirasim.ai` 对 `role: "tool"` 内的 `image_url` 原生透传（`kimi-k3` 准确识别图像像素），但该网关未开放 `/v1/files` 且其 Go 结构体反序列化会静默丢弃 `type: "video_url"`；直连支持 Kimi 原生协议的端点时 `ms://<file_id>` 与 `video_url` 均可原生工作。
3. **验证**：`npm run typecheck` 通过、`npm test` **119/119** 全绿、`npm run build` 通过。

## 最新交付 · DUAL-CORE-20261017 · 双核心实现与真实 K3 端到端验收完成

按用户 `/goal` 授权完成 `DC1–DC5` 实现及本机 Mira 0.0.479 真实 K3 端到端验收，详见[双核心设计第 10 节](docs/主动陪伴与上下文管理-v1.md)。

- **已实现**：全局 20 路优先级并发池（执行器同池）；注意力代理（事件即时 + 1 分钟心跳、无变化零调用、single-flight、结构化决策、持久关注列表、叫醒忙碌延后/10 分钟过期、用户输入/安静/暂停失效）；截屏（变化≤1张/分钟、空闲/锁屏/全屏/黑名单/暂停不截、原图不落盘只留文字摘要）；剪贴板 50 条（助手先查敏感格式再读正文）；按键内容不采集；记忆 ADD/UPDATE/DELETE/NOOP + 重要度 + 核心记忆；每 10 次互动第一人称日记；主角色只收事件结论；执行代理接收简报包；任务完成 → 注意力判断 → 她用自己口吻汇报。
- **证据**：
  1. `npm run typecheck` 通过；`npm test` **115/115** 全绿；
  2. 隔离打包原生验收 [docs/evidence/双核心原生验收.json](docs/evidence/双核心原生验收.json)（`passed: true`）；
  3. **本机 Mira 0.0.479 真实 K3 端到端验收** [docs/evidence/双核心真实K3验收.json](docs/evidence/双核心真实K3验收.json)（`passed: true`：10 轮真实 K3 对话、饮品偏好更正走 `UPDATE` 替换旧记忆、满 10 轮生成第一人称角色日记《把阿黄轻轻放进星图》、真实 `agent.run` 调用 `Read` 统计 `README.md` 二级章节、注意力代理独立上下文返回 `wake` 并唤醒主角色主动汇报结果、并发峰值 `2 ≤ 20`）；
  4. 真机剪贴板敏感格式探针通过。
- **运行包**：`release/dual-core/win-unpacked/GalAgent.exe`，入口「`启动 GalAgent 双核心版.cmd`」（与默认版共用存档，启动前需先退出另一个）。默认「启动 GalAgent.cmd」仍指向 `unified-persona`，未擅自切换。代码改动前备份：`docs/history/20261017-dual-core-code-before/`。
- **当前停止点**：`DC1–DC5` 全部开发与真实 K3 端到端验证已完成；用户可直接双击「`启动 GalAgent 双核心版.cmd`」体验，确认满意后可将默认入口切至双核心版，或按需启动 `LD4`（将 Kimi Live2D 合入主程序）。

## 双核心方案确认记录 · DUAL-CORE-20261017（计划阶段）

用户确认产品两大并列核心：**主动陪伴**与**上下文管理**。设计见[主动陪伴与上下文管理-v1](docs/主动陪伴与上下文管理-v1.md)，总设计案第 15 节、实施蓝图第 9 节（DC1–DC5）、`AGENTS.md` 隐私红线已同步；修改前文档备份于 `docs/history/20261017-dual-core-plan-before/`。

- 用户决定：不另接决策模型（K3 注意力代理判断）；20 路为全局并发上限；1 分钟心跳 + 事件驱动；开放截屏（保护默认全开，变化时≤1张/分钟）与剪贴板最近 50 条；按键内容不开放；记忆保留底座借算法改进；固定每 10 次互动写第一人称日记。
- 计划阶段未改代码；实现见上一节。

## 最新完成 · Kimi 专属 Live2D 模型完整交付与立绘级精修定稿（2026-10-17）

按用户收敛指令（“继续完成，这次不用实装到galagent了，做好l2d就行”）及多轮立绘级视觉精修要求，已完成星月魔女 Kimi 专属 Live2D 全套源工程、Cubism Editor 5.3.04 官方导出与独立透明大视窗真机验收，未改动 GalAgent 正式运行包或默认主应用入口（完整修复日志见 [CHANGELOG.md](CHANGELOG.md)，工程与质量红线见 [AGENTS.md](AGENTS.md)）：

1. **20 层中轴扶正、遮挡补画与原画级五官源资产 + 无损分层 PSD**：
   - 基于 `art/live2d/front-master-v02.png`（`1024×1536`）及高清参考立绘，通过 `scripts/build-aligned-live2d-layers.mjs` 生成全部 20 个 `1024×1536` 独立图层 `art/live2d/layers/*-v02.png`：
     - **面部中轴线扶正**：消除原图 `-7.9°` 倾斜与下巴右偏，将双眼 `(463.2, 160.3)` / `(536.8, 160.3)`、鼻梁、鼻尖、嘴唇 `(500.2, 201.2)` 与下巴统一对齐至垂直中心线 `x = 500.2`。
     - **2x 超采样星空紫瞳与温润眼窝肤色**：双线性超采样提取原画手绘虹膜 `iris-left/right`，消除 `face-base` 眼窝浅白矩形块、外眼角竖条与左内眼角白印，清除 `bangs` 在 `(479, 158)` 的原图睫毛残点。
     - **嘴部重绘与后发透明轮廓门控**：水平重绘柔和闭口线 `mouth-closed`（去除底部歪斜 U 型阴影团）与粉润张口内腔 `mouth-interior`；对 `back-hair` 内部防穿帮底色增加 `if (ma === 0) continue;` 门控，彻底消除深紫色/深色桌面壁纸下左侧发丝外延的半透明白雾。
   - 经 `scripts/write-layered-psd.mjs` 封装为无损可编辑多图层 `art/live2d/kimi-layered-source-v02.psd`（7.71 MB），记录于 `art/live2d/source-assets.json` 与 `art/live2d/layer-plan.json`。
2. **官方 Live2D Cubism Editor 5.3.04（FREE 模式合规）绑定、物理与运行时导出**：
   - 完整建立 `Warp_Body`、`Warp_Head` 层级弯曲变形器、20 个高密度网格部件、左右眼白对左右虹膜的 Clipping Mask 遮罩，绑定 27 个有效参数并通过 FREE 模式全 15 项合规校验，保存可编辑工程 `art/live2d/kimi.cmo3`（同步备份 `art/live2d/kimi-layered-source-v02.cmo3`）：
     - **闭眼与笑眼弧度区分**：闭眼/眨眼自然向下柔和弯折（`︶` `︶`）并收拢上眼睑折痕（`scaleClose = 0.42f`），笑脸/欣喜向上弯起成月牙笑眼（`︵` `︵`）。
     - **张口唇线不透明度互斥**：`ParamMouthOpenY` 配置 `{0, 0.12, 0.5, 1.0}` 关键帧，当 `open > 0.05` 时将 `mouth-closed` 完全隐藏（`opacity = 0.0f`），彻底消除张口时上唇悬空阴影条。
     - **转头侧发与腮红锁定**：`side-hair-left/right` 在 `y <= 204` 权重锁死为 `w = 0`，转头时与脸颊红晕 100% 同步运动，不穿帮。
   - 导出官方真运行时资产：`art/live2d/export/kimi.moc3`（`136,768 bytes`，27 活动参数，20 绘制部件）、`kimi.2048/texture_00.png`（`2048×2048` 纹理图集）、`kimi.cdi3.json`、`kimi.physics3.json`（前发/侧发/后发及裙摆挂饰 3 组多重摆物理）、`kimi.model3.json` 及 6 套角色表情 `art/live2d/export/expressions/*.exp3.json`（`neutral`、`curious`、`pleased`、`flustered`、`annoyed`、`softened`）。
3. **高清抗锯齿独立透明查看器与自动化真机验收**：
   - `prototypes/live2d/`（「`体验 Live2D 技术样例.cmd`」）升级为 `1120×920` 大视窗，支持一键**全屏**、**特写/近景/全身**三档景别切换、`>= 2.0x` 超采样渲染、WebGL 三线性 Mipmap（`gl.LINEAR_MIPMAP_LINEAR`）与各向异性过滤。
   - `node prototypes/live2d/verify.mjs` 自动化验收全项通过（`passed: true`），产出 `docs/evidence/live2d/LD0-runtime.json` 及实机渲染截图 `docs/evidence/live2d/sample-window.png`、`kimi-full-body.png`、`kimi-left.png`、`kimi-right.png`、`kimi-blink.png`、`kimi-exp-{neutral,curious,pleased,flustered,annoyed,softened}.png`。


## 第二批优化增量 · 2026-10-10 · 仅计划

用户继续口述：真实时间1:1、在线未回应与离线/异常退出重逢；默认全访问加可增删多条禁止目录；媒体内容引发人物反应；原生视频输入；Live2D/UI；重点完善主动规划。已同步总设计案6.2/6.3/9.3/9.4及前端段、实施蓝图第7节。注意力K3维护持久关注事项，判断等待条件/下次评估/主会话唤醒，主角色表达并委派，结果回传闭环；不预写台词或恢复阶段人格。

核对发现：Kimi Code参考源码有原生视频上传及video_url路径，但通用OpenAI协议有兼容限制。现有代理端到端原生视频/音轨尚未验证，GalAgent目前仍为前16秒1fps抽帧、无音轨。禁止目录也不能靠工具层字符串过滤约束任意命令，必须先验证Windows执行隔离。本轮未改运行行为、提权、读实际浏览数据或安装扩展。

## 浏览器扩展增量 · 2026-10-10 · 仅计划

统一人设运行接入验收后，用户继续提出方案增量：浏览器插件读取网址、历史记录、打开标签与收藏夹。目标按口述暂定Edge/Chromium，已写入总设计案9.1和实施蓝图第7节增量。Native Messaging桥接、四类元数据、独立K3注意力判断、后续正文能力分步验收。用户此前说明额度基本不构成约束、限制20并发，已纳入共享调度规划；当前2路执行器未改。此轮没有实施浏览器扩展或注意力代理。

## 统一人设运行接入 · UNIFIED-PERSONA-20261010

用户语音授权按现有调色盘全量接入项目。runtime/core/persona.ts成为统一人设源：钢琴、亲近、娇、有活力、极少的傲、吃醋但很好哄。基础聊天、主动、场景和日记共用；模型上下文移除identity.stage、变量stageMeaning和熟练度。动作强度不再受旧阶段限制，全时期统一。旧阶段枚举和互动计分仅留在存档兼容/统计路径，不能切换性格，不重置名字、记忆或关系。

95项测试及类型检查通过；隔离旧S4存档的真实打包窗口通过身份保留、统一提示、动作无阶段限制检查；真实K3钢琴问答与抱抱安慰两轮通过。证据：docs/evidence/统一人设测试.log、统一人设原生验收.json。运行包release/unified-persona/win-unpacked/GalAgent.exe，启动脚本已切换新版。旧包保留供回退，不能据其旧提示判断当前发行内容。主动触发扩展、Live2D与钢琴音频功能未实施。

下文“仅文稿/尚未接入”属于此前过程记录，已由本次运行接入覆盖。

## 人设内容修订 · PERSONA-PALETTE-20261010 · 文稿

用户新设定：爱弹钢琴；傲娇可爱、有活力，傲极少、娇多；看到用户使用其他Agent会嫉妒、气鼓鼓地胡闹；被冷落会可怜巴巴地出来求抱抱/安慰，很好哄。按tavern-cards性格调色盘整理用户给出的具体衍生，保留原话，不擅自添加成长路径、钢琴曲目/水平或固定台词。用户进一步明确取消变量驱动的分阶段人设，全时期统一；三无→傲娇路线不再是待选方案。

本轮仅更新人设总册与计划引用；现有runtime、阶段变量、正式存档、发行包保持原版本。新版文稿不是运行效果证明。下一步为用户继续手改/补充，再按明确授权同步统一运行提示、移除阶段对口吻/动作的驱动，并兼容旧存档。

## 主动扩展计划与当前连接检查 · 2026-10-10

用户授权先保存主动触发计划、测试现有功能及诊断离线/换账号关系。总设计案6.1与实施蓝图P3已同步；主动行为扩展和Live2D未实施。旧章节为历史阶段记录，当前工具交付仍以OPENAI-KIMI-TOOLS-20261010为准。

本轮发现：正式openai-tools包运行中，18890反代原先未运行，已用已有start.ps1启动；正式存档provider为旧Moonshot地址，须核对运行态（未直接改存档）。启动时online=false，只有成功主对话才设true，离线提示不能单独证明服务不可用。账号链路与最新测试证据见docs/evidence/当前功能与账号检查-20261010.md。

本轮最终：隔离原生工具/界面与真实K3 Read均通过，隔离主角色真实对话/取名/online=true通过；用户反馈“好像可用了”。正式窗口未改，保留人物/关系/记忆。旧存档地址不等于当前运行地址，不认定其为故障原因。Mira换账号通常影响后续请求额度和登录态，不自动清除GalAgent存档；在途请求、取票缓存和加密主密钥变动需另验。后续修复候选为区分“尚未验证连接”和真实失败，目前未改状态文案或运行包。

## 当前正式交付 · OPENAI-KIMI-TOOLS-20261010

用户“完成适配”目标：使用既有OpenAI兼容反代，兼容文档的25个Kimi工具名称/参数/结果协议；主角色、执行器与并行架构由GalAgent负责。现已实现并验证，不使用kimi.exe/ACP，不改代理代码或建立内置反代。

新模块tool-protocol.ts / tool-host.ts / openai-agent.ts已接入companion、IPC与界面。模型默认http://127.0.0.1:18890/v1、kimi-code/k3；有效旧配置保留，未配置的旧默认转向本地反代。凭据只由宿主取得，隔离测试不读正式密钥。真实服务需要Mira保持登录/运行。

25后端：文件/搜索/命令/媒体/URL/Skill、Todo/Goal/预算、计划/提问、子代理/Swarm、后台任务和Cron。95项测试通过；真实K3发送25定义完成Read→Edit→Read并核对文件与回答，真实图像回传通过；原始推理保留、私有历史不进入UI。打包原生验收含文件效果、提问/计划选择、重启、取消、图像与视频解码。证据统一见[正式适配](docs/OpenAI-Kimi工具正式适配.md)。

运行包release/openai-tools/win-unpacked/GalAgent.exe，项目启动脚本指向新版。旧persona-variables/living-pet和CLI实验包保留；旧实验记录不代表当前正式运行路径。

本轮不实施Live2D、浏览器扩展、真实隔离沙箱或键鼠接管。视频为开头最多16秒的1fps图像采样，无声音；Cron仅应用运行时派发，7天有效。真实工具业务结果需看实际摘要/文件证据，不能仅凭end_turn宣布业务成功。

## 用户纠正后的当前目标 · KIMI-TOOLS-OAI-20261009

最新证据：已通过用户现有18890反代的真实Read闭环。scripts/probe-kimi-openai-tools.mjs执行两次实际请求，K3返回Read/path工具调用，本项目读取唯一隔离测试文件，按tool_call_id回传，最终回答匹配随机文件内容；完整assistant字段与reasoning_content保留。报告docs/evidence/KimiCode反代真实工具闭环.json。未调用CLI、未改代理、未读取测试文件以外的任务数据。软件工程接入及剩余工具执行器尚未完成，不能把这个单工具探针算作25工具已实现。

用户明确：模型走已有OpenAI兼容反代，适配Kimi Code工具名称、参数、提示与结果格式；我们的并行代理和整体架构保持自主。CLI/ACP执行器方案偏离目标，不作为该需求的完成证据，不切换启动入口到那个包。

已读取用户指定文档<USER_PROFILE>/Desktop/mira反代/KimiCode-K3-反代工具适配完整文档.md；反代地址http://127.0.0.1:18890/v1，模型kimi-code/k3。关键纠正：代理不自动注入系统提示或tools，也不执行工具；GalAgent负责按实际能力发送tools和执行回传。25个原始schema已提取到runtime/assets/protocol/kimi-code-tools-0.29.2.json，来源摘要/校验见docs/evidence/KimiCode反代兼容基准.json。没有读取本地密钥或调用反代。

下一步：把OpenAI tools→assistant.tool_calls→本地执行→role:tool/tool_call_id→下一轮的完整循环接入；保留原始reasoning_content和其他assistant字段，SSE必须完整结束才执行。用可执行后端筛选工具并同步提示，不把25个schema当25个实现已完成。撤换默认CLI调用，执行结果交回现有人设主代理。未完成的新兼容层不能称已交付。

下面KIMI-AGENT-20261009是被纠正的CLI/ACP实验记录，仅证明那条实验链路，不代表当前目标。

## 最新交付 · KIMI-AGENT-20261009

用户授权Agent工具适配本机Kimi Code。源码参照官方0.29.2标签8a45f10，与本机kimi.exe一致。通过原生ACP复用工具/技能/MCP/内部子代理，完整访问按原生yolo模式执行，不复制凭据、不改本机provider、不创建反代。

代码runtime/core/kimi-agent.ts与companion接入；连接页任务面板、agent.run/agent.cancel/agent.configure、/任务和/取消任务已接入。主角色仅委派，执行结果有界回传，私有推理与完整工具日志不进入主上下文。对问题不自动猜答案，问题选择UI转接尚未实现。

真实Read及打包GalAgent→ACP→本机Kimi Code→Read→返回交流已验收，测试文件内容一致。主聊天API未配置也可显式执行；真实人物口吻仍待验。源码/验收：[KimiCode工具适配](docs/KimiCode工具适配-v1.md)、[打包原生验收](docs/evidence/KimiCode打包原生验收.json)。运行包release/kimi-agent/win-unpacked/GalAgent.exe，旧persona-variables和living-pet包保留。

主聊天反代配置保持独立；执行器继承本机Kimi Code配置，未验证或改变另一个反代服务的路由。目录硬隔离、浏览器扩展与Live2D仍未启动。当前任务工具能力不等同完整未来Agent产品完成。

## 最新交付 · VARIABLES-20261009

用户授权“按你说的完成变量系统”。已实现表达熟练度与阶段、稳定底色、原四轴关系、衰减情绪、场景面、受控动作与强度、真实时间1:1。新身份取名后保持三无适应，旧S2/S3/S4保留阶段下限；成长按完成的来源事件、多样性、相处日、关系与日上限更新，模型不能任意写分数。

代码：runtime/core/variables.ts，接入companion、contracts、renderer。文档：[人物变量系统](docs/人物变量系统-v1.md)。软件机制验收：[验收记录](docs/evidence/人物变量系统验收.md)。运行包：release/persona-variables/win-unpacked/GalAgent.exe，原living-pet包保留。

存档支持重启、旧档迁移、同档导入去重、事务前拒绝非法字段。隐私删除保留不含来源ID/正文的按日成长额度，不退阶段、不复活被删来源、不允许删除再刷分。

本轮只实施人物变量与必要人设接入，未启动Live2D、浏览器扩展、执行代理、全权限或键鼠控制；既有主动机制未扩展。未调用真实Kimi、未触碰用户正式存档、未停止原运行实例。下一步应亲手体验真实对话并评估阶段口吻，再按授权继续Live2D或其他模块。

## 上一阶段 · PERSONA-20261009（文稿交付记录）

用户最新授权：“那么现在开始第一步吧，人设的修改”。已完成[人设总册v1.2](docs/人设总册-v1.md)及相关规划同步。下文DOCSYNC-LD记录保留Live2D停止点，本轮仅增加人设文稿修改授权。

- 成长主线保留三无→拧巴→傲娇→安静傲娇；前期冷淡来自刚获得桌面形体、表达不熟练，废止无心与一句话后强制跳阶段。
- 人设按基础信息、调色盘、多阶段、三面性、作者二次解释、演绎与接入合同组织；用户原话与创作派生分开。
- 总设计案第4节、实施蓝图P1、终态设定卡与交接总览已同步；旧稿保存在docs/history/20261009-persona-revision-before/。
- 尚未修改runtime提示、阶段枚举、变量、存档或运行包；未调用Kimi，未实施Live2D或其他系统能力。
- 下一步为人设文稿体验反馈，或用户明确要求接入运行时后制定变量/阶段兼容映射并验证。不自动重置旧关系或重演初遇。

同步：DOCSYNC-LD-20261009 · 2026-10-09。**当前桌宠形体已制作交付；专属Live2D仅规划、未启动。本轮用户明确要求只同步所有计划，不执行。**

## 当前权威和停止点

[总设计案](docs/GalAgent总设计案-v1.md)决定范围 → [实施蓝图](docs/GalAgent实施蓝图-v1.md)决定阶段 → 本文件唯一记当前进度。保持single-blueprint，执行期持久子蓝图预算0；LD路线直接写进现有蓝图第8节。00交接总览只导航，旧计划/M1/架构不恢复权限。

用户最新原话：“把live2d先写成计划，不要执行，先把所有计划更新同步”。本轮不安装、下载、生成图层、绑定、导出模型、改程序、测试Kimi或重新打包；不创建新的自动实施目标或后台任务。此前的开发/生图授权不能越过本次限制。

## 当前实际形体和交付

- 当前：自有WebGL二维网格、完整PNG的局部表情混合。头/躯干/发梢/披肩局部运动，视线/闲置转开、局部眨眼、文字口动、触摸/拖动惯性。不是Live2D rig，没有专属PSD/cmo3/moc3。
- 启动、托盘单击与重复启动均以透明人物为主；双击短输入，Enter/Shift+Enter/IME/Esc；固定长聊、记忆和连接只从菜单按需进入。
- 白发、K、棱镜虹彩、深蓝星空披肩、原服饰和脸型保留。七张素材保留；现有模型不可自然完成大转身和新手臂姿态。
- 程序：启动 GalAgent.cmd → release/living-pet/win-unpacked/GalAgent.exe。ZIP与哈希：release/living-pet/delivery-manifest.json。曾确认PID39440为此包，属于当时记录，不拿旧PID声明现在必然live。
- 现有运行包不因计划同步重建；之前文档/发行说明按版本当时快照保存。

## 现有工程与证据（不算Live2D验证）

Electron44.7/TypeScript；SQLite持久身份、原句事实、日记、有效期与纠正/删除账本、恢复防复活。当前E5 384维保留，valid/asOf/dead在两路top24之前过滤，再RRF融合；固定独立24事实54查询中48可答Top5=48/48，原20/40可答35/35。BGE候选独立融合41/48、英文15/22未过，不迁移。

主对话/事实日记/增量摘要上下文隔离，约6k应用估算预算，原始K3成对重放且私有推理不导出；后台来源ID任务可退出续接、有限退避，普通archive不迁移pending任务。六微事件有来源、冷却、安静取消、短期心情恢复、关系去重/日上限与真实目标进度。观察默认关，标题另开；不读取键盘内容/剪贴板/浏览历史/IM正文/摄像头/音频。

61项核心/观察/IPC测试、types/build、默认WebGL UI与旧fallback回归已有记录。独立实际app.asar视频12秒、97/97采样包含人物，保留绘图缓冲区解决空录屏；180次绘制通知p95=16.9ms。这是当前形体限定样本，不是Cubism/OpenGL/SDK样例验收，也不是全局屏幕帧率或所有窗口状态验证。Windows非交互透明窗口捕获边界、Unicode注入≠物理拼音候选、完整锁屏/休眠/DPI仍记录未验。

原400/800MiB内存预算此前未过，旧模型ready约971MiB/idle576MiB；不能说Live2D会自动更省。旧6100未满48h的观察已归档soak-before-living-pet-20261009-072959，不与新程序拼接。真实Kimi/三次相处/完整长时质量未验证，按用户要求放缓；不要求Key作为图形计划或未来样例的前置。

具体证据：[当前形体](docs/evidence/动态桌宠形体验收.md)、[首版验收](docs/evidence/首版验收状态.md)、[Kimi入口](docs/evidence/真实Kimi验收入口.md)。对应历史单项证据记录当时结果，不能作为当前自动执行指令。

## Live2D 计划与交付状态（2026-10-17 更新）

| 项目 | 状态 |
|---|---|
| 后续方向和文档同步 | 已记录并同步至 [CHANGELOG.md](CHANGELOG.md) 与 [AGENTS.md](AGENTS.md) |
| LD0 环境/官方编辑器与 SDK | **已完成**：Cubism 5 SDK for Web R5 + Cubism Editor 5.3.04 真机与自动化验证通过 |
| LD1 专属拆层与补画 | **已完成**：20 层 `1024×1536` 独立图层 + `kimi-layered-source-v02.psd`（含中轴扶正、2x 虹膜、遮挡补画、后发透明轮廓门控） |
| LD2 专属绑定与表情/物理 | **已完成**：`kimi.cmo3`、`kimi.moc3`（27 参数、20 部件、`2048×2048` 纹理集、3 组物理摆、6 套 `.exp3.json` 表情） |
| LD3 专属全身模型与独立透明窗口运行时 | **已完成（独立透明窗口）**：`prototypes/live2d/` 全屏/特写/近景/全身查看器及 `verify.mjs` 全部通过（`passed: true`） |
| LD4 正式主程序替换与打包验收 | **已完成**：`KimiLive2DRuntime` 正式接入 `runtime/` 桌宠窗口并通过 `release/dual-core/win-unpacked/GalAgent.exe` 打包端到端验收（`passed: true`） |

具体输入、交付物、退出条件、版本/许可/回退与资料边界以[实施蓝图第8节](docs/GalAgent实施蓝图-v1.md#8-ld--专属-live2d-实施路线)为准。

**当前停止点：实施蓝图全部阶段（`P0–P4`、`DC1–DC6`、`LD0–LD4`、目录隔离、浏览器扩展与原生视频多模态）均已实现并通过实机验收；双击「`启动 GalAgent 双核心版.cmd`」即可运行包含 Kimi 专属 Live2D 与全部双核心能力的桌面程序。**

## 同步前历史

之前连续追加的当前/blocked/旧PID/候选“下一步”等，完整保存在[同步前NEXT](docs/history/20261009-192751-live2d-plan-sync-before/NEXT.md)。历史状态不再与本文件当前停止点竞争。原代码、美术、用户数据和历史测试事实保留。
