# GalAgent 1.0

GalAgent 是住在 Windows 桌面上的 AI 像素伙伴。你可以为 TA 选择性格和外形，接入自己的模型，一起聊天、记下生活里的小事，持续跟进面试、计划和日常进展。TA 会在合适的时候主动问候，把查到的新消息带来，也能在你授权后帮忙处理本机任务；需要安静时，随时让 TA 休息。

![桌宠与主界面](docs/evidence/ui/page-chat.png)

本文介绍当前 `main` 分支。开发中的功能随代码更新，已发布安装包的功能和验证范围请以对应的 [Release 说明](https://github.com/nannnannan/galagent/releases)为准。

## TA 能做什么

- **接着关心同一件事。** 你说过的面试、计划和待办可以成为持续跟进的事项；改期后跟着调整，知道结果后结束追问。事项保留用户原话作为来源。
- **在合适的时候主动出现。** 支持问候、提醒、旧事重提和分享。普通关心会避开全屏、刚切换窗口、刚聊完天或上一句尚未得到回应的时段，并遵守陪伴模式、话题开关、安静时间和频率设置。
- **主动研究你的兴趣。** 告诉 TA 想关注什么，后台助手会搜索并阅读网页，把有正文来源的新发现留待分享。可以追问原文，也可以暂停、恢复或取消关注。
- **看得到研究进展。** 研究页显示整理兴趣、查阅原文、等待对话和整理笔记等阶段，也会说明失败或没有新发现。可以停止本次研究后重试；手动重查不受自动研究的近期冷却限制。
- **保留相处的记录。** 聊天、长期记忆、日记和每日档案保存在本地；较早的聊天用摘要参与后续对话，需要时可回看原文。记忆支持查看、修正和删除。
- **自定义角色与像素小人。** 内置角色卡和 22 个原创像素小人，支持导入、自制与调整。角色的性格、背景、说话方式来自角色卡，搭配眨眼、走路、气泡、心情和桌面互动。
- **帮你做实际的事。** 执行器提供 27 个本地工具，并支持 MCP。可在授权范围内查资料、读写文件、运行命令；任务结果先保存并汇报，长报告的模型摘要在后台补充。
- **按自己的习惯相处。** 支持模型接口配置、定时提醒、语音朗读、观察开关、免打扰和专注模式。

可以这样开始：

> “帮我留意一下摄影展。”
>
> “我下周一下午面试。”
>
> “改到下周三上午了。”
>
> “面试通过了！”
>
> “最近先别聊摄影展。”

持续关心需要模型正确理解对话并返回结构化结果。实际的记忆提取、说话分寸和陪伴体验，会受到所接模型能力影响；项目仍在开发中。

## 安装与连接模型

1. 在 [GitHub Releases](https://github.com/nannnannan/galagent/releases) 下载 Windows x64 安装包，运行安装向导。
2. 从桌面快捷方式启动，右键小人打开聊天，在「连接」中选择「标准 OpenAI 兼容接口」。
3. 填写服务提供的基础地址、模型名称与 API Key，再选择角色和小人开始聊天。

程序支持 OpenAI Chat Completions 兼容接口，会对部分不支持的 JSON 模式、输出 token 参数和流式选项做兼容回退。各服务支持的参数不同，接入后仍需实际发送消息验证。Mira 预设需要另行安装、登录 Mira 并运行兼容的本地反代。

仓库附带 [Mira 反代源码与使用说明](extras/mira-proxy/README.md)，当前适配表支持至 Mira 0.0.771；Release 提供单独的 ZIP。使用自己的 Mira 账号，首次启动生成自己的本地密钥。

安装包不附带模型账号或额度，也不包含个人存档。当前 Windows 安装包未做可信发布者证书签名；升级前建议备份自己的数据目录，卸载默认保留数据。

## 主动观察与权限

新存档默认开启桌面观察，窗口标题默认关闭；截屏、剪贴板有独立开关，已有存档沿用自己的设置。托盘「暂停观察」立即停用观察。截图只留文字摘要，原图不落盘；截屏频率、黑名单应用和锁屏等保护见[主动陪伴设计](docs/主动陪伴与上下文管理-v1.md)。

聊天与观察内容会按功能需要发送给你配置的模型或服务，本地保存不代表完全离线。出站内容经过隐私过滤，支持自定义敏感词；API Key 由 Windows DPAPI 在宿主侧保护。

执行器默认使用「标准」权限：可读取允许访问的位置，只在工作目录内写入，Shell 命令需要确认，也可对本任务统一允许。需要更高权限时，可手动选择并确认「完全放开」；GalAgent 自身密钥与数据目录、用户设置的禁止目录仍受保护。这些是应用内检查，不是操作系统沙箱。

## 存档与自动保存

- 首次启动且没有指定位置时，使用 `%APPDATA%\GalAgent`。选定并记住其他存档后，普通启动继续使用该存档，程序升级与工作目录变化不应改变选择。
- 当前选择保存在 `%APPDATA%\GalAgent-profile.json`。已记住的目录丢失或选择文件损坏时，会提示错误并停止启动，避免误开另一份存档。
- 「连接」页显示当前存档位置，主界面底部显示最近自动保存时间。聊天、记忆及已提交设置会写入本地 SQLite；状态快照使用事务保存，并启用 WAL 与 FULL 同步。
- 已通过隔离测试验证：强制结束进程后重新打开，聊天、记忆、设置及存档 ID 保持一致。未发送的输入框草稿不在这项恢复承诺内。

需要指定新的固定位置时，可以这样启动一次（替换程序路径）：

```powershell
& "程序所在目录\GalAgent.exe" "--profile-directory=E:\GalAgentData\main" --remember-profile
```

之后通过普通快捷方式启动也会使用该位置。`GALAGENT_DATA_DIR` 用于开发和隔离测试，不会改写已记住的选择。启动参数显式指定的目录优先级最高。

源码目录中的 `启动 GalAgent.cmd` 优先打开已安装的程序；开发者可向 `scripts/Start-GalAgent.ps1` 传入 `-PackageDirectory` 指定构建产物。启动器按完整资源指纹复用程序，默认保留当前版本和一个回退版本，跳过运行中的版本。

## 从源码开发

使用 Node.js 24，在项目目录运行：

```powershell
npm ci
npm run typecheck
npm test
npm run build
```

安装包需要本地嵌入模型资源。在 `.cache/models/Xenova/multilingual-e5-small/` 准备 `config.json`、`tokenizer.json`、`tokenizer_config.json` 和 `onnx/model_quantized.onnx`；相关授权见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。随后运行：

```powershell
npm run package:installer
```

Windows 打包测试可复用本地 Electron，避免重新下载：

```powershell
npx electron-builder --win dir --x64 --config.directories.output=release/dual-core --config.electronDist=node_modules/electron/dist
$env:GALAGENT_TEST_EXE = (Resolve-Path 'release/dual-core/win-unpacked/GalAgent.exe').Path
node tests/e2e/dual-core.mjs
node tests/e2e/windows-release.mjs
node tests/e2e/research-companion.mjs
node tests/e2e/care-continuity.mjs
node tests/e2e/profile-save.mjs
```

这些脚本使用隔离数据和模拟接口验证程序行为，不代表所有真实模型服务都已经测试。端到端脚本需要 Playwright；可通过 `PLAYWRIGHT_MODULE` 指向已安装的 Playwright 入口文件。`npm test` 运行单元与集成测试，不包含这些 Windows 打包验收。

小人制作见 [galagent-pixel-pet](skills/galagent-pixel-pet/SKILL.md)，角色卡写法见 [galagent-persona](skills/galagent-persona/SKILL.md)。界面预览可运行 `npm run preview:ui`。

## 主动研究使用 MCP

在「连接 → MCP」添加服务并连接，展开该服务的「主动研究工具」，勾选要用于研究的工具。列表只显示服务声明为只读、且未标记破坏性的工具；请选择自己信任的服务。之后自动研究和「现在研究一下」都会使用这些选择，每轮最多轮换两个 MCP 服务。

网页与 MCP 由不同助手查询。MCP 返回内容标记为资料，并以 `mcp://服务/工具/结果标识` 记录来源；这个标识代表工具结果，不代表已阅读返回内容中的网页链接。模型请求仍共用并发池，MCP 参数与结果经过隐私过滤。

标准权限下，每轮首次使用 MCP 会在「任务」页询问；用户已选择免确认权限时沿用该选择。关闭联网、禁止本地程序或改变相关设置会按现有规则停用相应 MCP；研究页的停止按钮也会取消等待授权或等待工具结果的研究。

## 项目导航

- [NEXT.md](NEXT.md)：当前进度、验收与停止点。
- [CHANGELOG.md](CHANGELOG.md)：版本变化。
- [后端维护边界](docs/后端维护边界.md)：陪伴、研究、任务、设置和数据职责。
- [记忆系统](docs/记忆系统-v2.md)与[活人感设计](docs/活人感-v1.md)：记录如何参与后续相处。
- [执行器设计](docs/执行器强化-v1.md)：工具、权限与任务流程。
- [AGENTS.md](AGENTS.md)：工程约定、开发命令与测试要求。

源码按 `runtime/main/`（桌面宿主）、`runtime/core/`（陪伴与任务）、`runtime/shared/`（类型与角色资源）、`runtime/renderer/`（界面）组织。

## 致谢

感谢 **Gemini4argon、opus5.5、gpt-Astra** 在项目设计、工程实现和视觉打磨中的贡献。
