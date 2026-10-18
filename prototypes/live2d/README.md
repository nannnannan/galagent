# Kimi 专属 Live2D 模型 · 独立透明窗口查看器与验收

已验证：星月魔女 Kimi 专属定制 Live2D 真模型（`assets/kimi/kimi.moc3`）在独立 Electron 透明大视窗中完整加载与高清实时渲染：

- **可编辑源工程与 20 层中轴扶正拆层资产**：
  - 20 层 `1024×1536` 几何对齐、面部中轴扶正（`x = 500.2`）、2x 超采样星空紫虹膜、遮挡补画及后发透明轮廓门控拆层 PNG：`art/live2d/layers/*-v02.png`
  - 无损多图层 PSD：`art/live2d/kimi-layered-source-v02.psd`（`7.71 MB`）
  - 官方 Live2D Cubism Editor 5.3.04 可编辑模型工程：`art/live2d/kimi.cmo3`（含 `Warp_Body`、`Warp_Head` 层级弯曲变形器、20 个高密度网格部件、虹膜 Clipping Mask 遮罩、3 组物理摆）
- **运行时导出资产（`art/live2d/export/` & `prototypes/live2d/assets/kimi/`）**：
  - 模型二进制：`kimi.moc3`（`136,768 bytes`，27 活动参数，20 绘制部件）
  - 纹理图集：`kimi.2048/texture_00.png`（`2048×2048`）
  - 物理配置：`kimi.physics3.json`（前发 `HairFront`、侧发 `HairSide`、后发与裙摆挂饰 `HairBack` 3 组真实多重摆物理）
  - 角色表情：`expressions/*.exp3.json`（`neutral` 平静、`curious` 好奇、`pleased` 欣喜、`flustered` 害羞、`annoyed` 嗔怪、`softened` 温柔）
  - 模型索引：`kimi.model3.json` & `kimi.cdi3.json`
- **立绘级视觉精修完成项（2026-10-17）**：
  - 面部中轴线扶正（`-7.9° -> 0°` 水平对齐至 `x = 500.2`），消除原图倾斜感。
  - 原画 2x 超采样星空紫瞳与温润立体眼窝肤色，消除眼窝浅白擦除块、外眼角竖条及左内眼角白印。
  - 闭眼自然向下弯折（`︶` `︶`）并收拢上眼睑折痕，笑眼向上弯成月牙弧度（`︵` `︵`）。
  - 闭口/张口图层不透明度互斥（`open > 0.05` 时 `mouth-closed` 隐藏为 `0`），彻底消除张口时上唇悬空阴影条及闭口下方歪斜阴影块。
  - 侧发在腮红高度（`y <= 204`）锁死摆动权重（`w = 0`），转头时腮红不穿帮。
  - 后发内部底色严格受 `ma > 0` 轮廓透明度门控，深色/紫色桌面壁纸下发丝外缘零白边。

## 快速体验与自动化验收

- **一键体验**：双击项目根目录的「`体验 Live2D 技术样例.cmd`」。默认 `1120×920` 高清视窗（启用 `>= 2.0x` 超采样、三线性 Mipmap 与各向异性过滤），支持右上角一键「**全屏**」、底部「**特写 / 近景 / 全身**」三档景别切换、鼠标视线追踪、姿态切换（自动/左转/右转/闭眼/笑脸/说话）以及 6 种专属表情实时切换。
- **重生成图层与 PSD**：`node scripts/build-aligned-live2d-layers.mjs && node scripts/prepare-live2d-source.mjs && node scripts/write-layered-psd.mjs art/live2d/kimi-layered-source-v02.json`
- **构建前端探针**：`node prototypes/live2d/build.mjs`
- **同步导出资产**：`node scripts/sync-live2d-export.mjs`
- **自动化原生验收**：`node prototypes/live2d/verify.mjs`（产出 `docs/evidence/live2d/LD0-runtime.json` 及全套姿态/表情验证截图 `docs/evidence/live2d/kimi-*.png`、`sample-window.png`）

## SDK 与编辑器版本

- 官方 SDK：Cubism 5 SDK for Web R5（Core 版本整数 `100663297`）
- 官方编辑器：Live2D Cubism Editor 5.3.04（FREE 模式合规保存与导出，全 15 项限制检查通过）
- 授权说明：保留 SDK 内 `LICENSE.md` 及各组件版权头；Kimi 美术与分层工程为本项目专属原创角色资产。
