# GalAgent · 星图札记

Windows 透明动态 Live2D AI 陪伴桌宠与本地多模态 Agent 宿主。

## 核心特性

1. **星月魔女 Kimi 专属 Live2D 模型（`LD0–LD4` 正式合入）**：
   - 基于 `1024×1536` 母版精修拆分的 20 层无损图层与 Live2D Cubism 5.3.04 模型（`kimi.moc3`，27 参数、20 绘制部件、3 组发丝/裙摆物理摆、6 套 `.exp3.json` 表情）。
   - 支持鼠标视线跟随、点击摸头互动、拖拽摆放、**桌面左右来回小跑（`action: 'run'`）** 以及 **60Hz Web Audio 实时音量包络口型同步**。
2. **统一人设与长期陪伴记忆**：
   - 统一角色性格基线（热爱弹钢琴、亲近、娇多傲极少、有活力），移除旧版机械分段冷淡期。
   - 本地 SQLite 事实记忆（`ADD / UPDATE / DELETE` + 历史有效期区间）+ 本地 `Xenova/multilingual-e5-small` 语义向量检索 + FTS5 分词检索。
   - 每满 10 轮真实互动（10 次输入 + 10 次回复）自动以第一人称撰写内心日记（`journal`）。
3. **双核心架构：主动陪伴 + 上下文管理**：
   - **独立注意力代理（`AttentionLoop`）**：1 分钟心跳 + 事件驱动，独立于主角色上下文评估桌面观察、任务结果、持久关注事项（Watchlist）与浏览器感知，仅在有话可说时唤醒主角色开口。
   - **安全感知边界**：支持画面变化采样截屏（仅文字摘要入库，像素绝不落盘，默认过滤 KeePass/1Password/Bitwarden 等黑名单应用，空闲/锁屏/全屏自动跳过）、剪贴板 50 条环形缓冲（自动跳过 Windows 隐私标记格式）与 Edge 配套扩展 Native Messaging 桥接。
   - **全局 20 路并发池（`RequestPool`）**：严格按 `chat > attention > execution > background` 优先级排队。
4. **OpenAI-Kimi 25 工具本地执行宿主与原生多模态**：
   - 完整实现 25 个 Kimi Code 原生工具（`Read`、`Write`、`Edit`、`Glob`、`Grep`、`Bash`、`TaskList/Output/Stop`、`ReadMediaFile`、`FetchURL`、`Skill`、`TodoList`、`SetGoal/UpdateGoal`、`EnterPlanMode/ExitPlanMode`、`AskUserQuestion`、`Agent`、`AgentSwarm`、`CronCreate/List/Delete`）。
   - 支持 **Kimi 原生多模态图像与视频输入**（`image_url` 与 `video_url`，支持 `ms://` 上传与内联 `data:video/*` `keep_parts`）。
   - 支持 **可选禁止访问文件夹（`forbiddenPaths`）**：通过 `realpathSync.native` 最终路径检查与多硬链接保守拒绝，执行应用内目录检查。启用后任意 Bash 不可用，多硬链接文件被拒绝，搜索先检查文件再读取；不等同操作系统沙箱。修改即刻递增 `policyVersion` 并使在途旧任务失效。
5. **TTS 语音合成接口（原生支持小米 `mimo-v2.5-tts` 导演模式）与反代自启动**：
   - 原生支持小米官方 `mimo-v2.5-tts`（`/v1/chat/completions` 音频输出、`冰糖`/`茉莉` 等预设音色 + 随实时表情动态变化的导演演绎指令），同时兼容 OpenAI `/v1/audio/speech` 及 Windows SAPI / Web Speech 保底。
   - 启动时自动检测本机 Mira 反代（`127.0.0.1:18890` / `127.0.0.1:8787`），未启动时自动后台拉起。
   - API Key 与 TTS Key 均由 Windows DPAPI（Electron `safeStorage`）独立加密保存在本地 `%APPDATA%/GalAgent/`，严禁写入渲染进程、SQLite 或仓库。

---

## 陪伴改进版（2026-10-23）

新增日常、专注、休息模式，主动回应反馈和停止朗读。专用入口为 **[启动 GalAgent 陪伴改进版.cmd](启动%20GalAgent%20陪伴改进版.cmd)**，旧入口保留。当前执行宿主存在 Electron 普通启动限制，隔离原生验收使用临时诊断参数；正常入口没有关闭沙箱，详见 [本轮验收与限制](docs/evidence/陪伴体验改进-20261023.md)。

## 快速启动

- **日常启动**：双击根目录 **[`启动 GalAgent.cmd`](启动%20GalAgent.cmd)**（自动检查拉起本地反代并启动 `release/dual-core/win-unpacked/GalAgent.exe`）。
- **独立 Live2D 预览器**：双击 **[`体验 Live2D 技术样例.cmd`](体验%20Live2D%20技术样例.cmd)**。

---

## 开发、构建与打包验收

在 Node 24 环境下，`npm install` 后执行：

```powershell
npm run typecheck
npm test
npm run build
# 打包桌面端运行目录
npx electron-builder --win dir --x64 --config.directories.output=release/dual-core --config.electronDist=node_modules/electron/dist
# 运行隔离数据目录端到端验收
node tests/e2e/dual-core.mjs
```

更多工程架构、职责链与 Live2D 生产管线详见 [AGENTS.md](AGENTS.md)、[CHANGELOG.md](CHANGELOG.md) 与 [NEXT.md](NEXT.md)。

---

## 致谢 (Acknowledgments)

特别鸣谢以下伙伴与模型在项目设计、工程实现、视觉打磨与多模态架构中的重要贡献：

- **Gemini4argon**
- **opus5.5**
- **gpt-Astra**

