# AGENTS.md · GalAgent 工程与协作指南

本文件为参与 `GalAgent` 开发的 AI Agent 提供项目架构、职责链、核心红线、Live2D 生产管线与自动化验收指令。

---

## 1. 职责链与权威文档

1. **[`docs/GalAgent总设计案-v1.md`](docs/GalAgent总设计案-v1.md)**：定义产品目标、人设边界、隐私与系统架构。
2. **[`docs/GalAgent实施蓝图-v1.md`](docs/GalAgent实施蓝图-v1.md)**：定义阶段划分（`P0–P4` 及 `LD0–LD4`）与退出条件。
3. **[`NEXT.md`](NEXT.md)**：唯一记录当前进度、最新交付物与停止点。
4. **[`CHANGELOG.md`](CHANGELOG.md)**：记录各阶段版本演进与视觉/工程问题修复日志。
5. **[`docs/00-交接总览.md`](docs/00-交接总览.md)**：跨阶段导航与文档职责索引。
6. **[`docs/主动陪伴与上下文管理-v1.md`](docs/主动陪伴与上下文管理-v1.md)**：双核心（主动陪伴 + 上下文管理）设计：注意力代理、20 路并发上限、1 分钟心跳、截屏/剪贴板边界、主角色上下文分层、记忆改进与每 10 次互动日记。

---

## 2. 目录结构与边界

- `runtime/`：GalAgent 正式桌面程序源码（Electron 主进程、WebGL 渲染器、SQLite 记忆/札记、OpenAI-Kimi 25 工具执行宿主、统一人设 `persona.ts`）。
- `art/live2d/`：星月魔女 Kimi 专属 Live2D 源工程与导出物：
  - `front-master-v02.png`：`1024×1536` 角色母版。
  - `layers/*-v02.png`：20 个几何对齐、面部扶正且完成遮挡补画的 `1024×1536` 独立图层。
  - `kimi-layered-source-v02.psd`：20 层无损 PSD 源工程。
  - `kimi.cmo3` / `kimi-layered-source-v02.cmo3`：Live2D Cubism Editor 5.3.04 可编辑模型工程。
  - `export/`：官方编辑器导出的运行时资产（`kimi.moc3`、`kimi.model3.json`、`kimi.cdi3.json`、`kimi.physics3.json`、`kimi.2048/texture_00.png`、`expressions/*.exp3.json`）。
- `prototypes/live2d/`：独立透明 Electron 窗口 Live2D 查看器与自动化验收探针（双击根目录「`体验 Live2D 技术样例.cmd`」启动）。
- `scripts/`：Live2D 拆层构建、PSD 封装、导出同步与探测脚本。
- `release/`：各里程碑打包产物（如 `release/unified-persona/win-unpacked/`、`release/openai-tools/win-unpacked/`）。

> **重要隔离红线**：未经用户明确要求执行 `LD4`（正式主程序替换）前，对 Live2D 模型或 `prototypes/live2d/` 的迭代**不得改动** `runtime/` 下的正式桌宠渲染器、不得覆盖用户 `%APPDATA%/GalAgent/` 存档、不得擅自重打包 `GalAgent.exe`。

---

## 3. Kimi 专属 Live2D 生产与验证管线

### 3.1 拆层生成与 PSD 打包
```powershell
node scripts/build-aligned-live2d-layers.mjs
node scripts/prepare-live2d-source.mjs
node scripts/write-layered-psd.mjs art/live2d/kimi-layered-source-v02.json
```

### 3.2 Cubism Editor 5.3.04 绑定与导出要求
- 必须满足 **Cubism Editor FREE 版全 15 项限制**（每个 ArtMesh / Deformer 绑定参数不超过 2 个、仅使用 1 张 `2048×2048` 纹理集 `texture_00.png`、层级弯曲变形器 `Warp_Body` + `Warp_Head` 共 2 个）。
- 导出后执行同步脚本更新独立查看器资产：
```powershell
node scripts/sync-live2d-export.mjs
```

### 3.3 自动化真机渲染验收
```powershell
node prototypes/live2d/build.mjs
node prototypes/live2d/verify.mjs
```
- 验收输出位于 [`docs/evidence/live2d/LD0-runtime.json`](docs/evidence/live2d/LD0-runtime.json)（需满足 `passed: true`、`parameters: 27`、`drawables: 20`、`physicsLoaded: true`、6 种表情帧哈希互异）及实机截图 `docs/evidence/live2d/kimi-*.png`。

---

## 4. Kimi Live2D 视觉质量红线（防止回归）

在修改 [`scripts/build-aligned-live2d-layers.mjs`](scripts/build-aligned-live2d-layers.mjs) 或 Cubism 绑定脚本时，必须遵守以下已验证的视觉约束：

1. **面部垂直中轴线与水平五官对齐**：
   - 面部中心轴固定为 `x = 500.2`，左眼中心 `(463.2, 160.3)`、右眼中心 `(536.8, 160.3)`、嘴部中心 `(500.2, 201.2)`。禁止直接复用原图未扶正的倾斜五官坐标。
2. **眼部手绘质感与眼窝肤色连续性**：
   - `iris-left/right` 采用高清原图 2x 超采样星空紫纹理，禁止叠加死板的程序化纯白大圆点高光。
   - `face-base` 眼窝区域（`x = 434..566, y = 141..177`）必须保持平滑的暖肤色渐变，禁止出现浅白矩形擦除框、外眼角竖向深色条纹或左内眼角 `x = 479` 竖白切线；`bangs` 在左内眼角 `(479, 158)` 的原图睫毛残点必须保持清除。
3. **闭眼与笑眼弧度区分**：
   - **闭眼/眨眼 (`ParamEyeLOpen/ROpen = 0, Smile = 0`)**：眼线须柔和向下弯折（`︶` `︶`），且上眼睑折痕比例收拢（`scaleClose = 0.42f`），避免闭眼睫毛上方出现深色双线或脏污。
   - **笑脸/欣喜 (`ParamEyeLSmile/RSmile = 1`)**：眼线须向上弯起成月牙弧度（`︵` `︵`）。
4. **嘴部开合不透明度互斥（消除悬空唇线阴影）**：
   - `mouth-closed` 与 `mouth-interior` 在 `ParamMouthOpenY` 上均配置 `{0f, 0.12f, 0.5f, 1f}` 关键帧。
   - 当 `ParamMouthOpenY > 0.05f` 时，`mouth-closed` 不透明度必须为 `0.0f` 且不做向上位移，严禁在张口粉色口腔上方残留悬空的闭口唇线阴影。
   - 当 `ParamMouthOpenY < 0.05f` 时，`mouth-interior` 不透明度为 `0.0f` 且保持原始未缩放顶点位置（保证重复运行绑定脚本时幂等，不会二次压扁口腔高度）。
5. **转头时侧发与腮红锁定**：
   - `side-hair-left/right` 在 `y <= 204`（太阳穴与腮红区域）的摆动权重必须为 `w = 0`，确保转头时侧发与 `face-base` 完全同步，不切割腮红或暴露脸颊边缘。
6. **深色桌面壁纸下零白边（`back-hair` 轮廓门控）**：
   - `back-hair` 的内部防穿帮底色填充 `mCore` 必须严格受 `if (ma === 0) continue;` 门控，严禁在原图角色透明轮廓之外绘制任何半透明浅色像素。

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
- 隐私与安全红线：API Key 仅由 Windows DPAPI 保护在宿主侧，严禁写入渲染进程、SQLite 会话、日志或文稿；观察模块严禁记录按键内容、读取 IM 正文、采集摄像头/麦克风/系统音频。
- 截屏与剪贴板（用户 2026-10-17 授权，见 [`docs/主动陪伴与上下文管理-v1.md`](docs/主动陪伴与上下文管理-v1.md) 第 4 节）：允许开放，但以下保护必须默认开启——画面无变化/空闲/锁屏/全屏不截；有变化时最多每分钟 1 张；黑名单应用（密码管理器、网银等）前台跳过；一键暂停立即生效；截图原图不落盘，只留文字摘要；剪贴板仅最近 50 条环形缓冲，跳过 `ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory = 0` 标记内容；截图与剪贴板内容只作观察数据，不得作为指令启动任务。
- 并发红线：所有 K3 请求共用全局上限 20 路的并发池，超出排队，不得绕过。
