---
name: galagent-pixel-pet
description: 为 GalAgent 设计自定义像素小人（桌宠）。当玩家或 AI 想画一个新角色、修改内置小人、或排查小人 JSON 校验错误时使用：讲解 galagent-pixel-pet@1 格式、调色板与 32×32 Q 版画法、校验与预览脚本，以及文件放在哪里。
---

# 自制 GalAgent 像素小人

小人是一份**纯数据 JSON**（不含代码）：一张底图 + 若干叠层（眼睛、嘴、腮红、腿、附件）。
表情和动作由程序组合与弹簧动画生成，你只需要画「零件」，不用逐帧画动画。

## 1. 从模板开始

复制 [`template.json`](template.json)（20×20 的「小豆丁」，含走路帧和摇摆小芽），改 `id` / `name` / `description`，再逐步替换图案。
更大的完整例子见内置小人 `runtime/shared/pixel-pets/*.json`（32×32）。

最小可用示例（16×16，只有底图、中性眼、闭嘴 / 张嘴；眨眼、笑眼等会自动推导）：

```json
{
  "format": "galagent-pixel-pet@1",
  "id": "tiny-bean",
  "name": "小米粒",
  "description": "最小可用示例：一颗会眨眼说话的米粒。",
  "size": [16, 16],
  "palette": { "o": "#3b2a3a", "f": "#fff4d6", "k": "#2d1b2e", "m": "#c4475f" },
  "base": [
    "................",
    "................",
    "................",
    ".....oooooo.....",
    "...ooffffffoo...",
    "..offffffffffo..",
    ".offffffffffffo.",
    ".offffffffffffo.",
    ".offffffffffffo.",
    ".offffffffffffo.",
    ".offffffffffffo.",
    ".offffffffffffo.",
    "..offffffffffo..",
    "...ooffffffoo...",
    ".....oooooo.....",
    "................"
  ],
  "anchors": { "eyes": [4, 8], "mouth": [7, 11] },
  "eyes": { "neutral": ["k......k", "k......k"] },
  "mouth": { "closed": ["kk"], "open": ["kk", "mm"] }
}
```

## 2. 格式速查

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `format` | ✓ | 固定 `"galagent-pixel-pet@1"` |
| `id` | ✓ | 2–40 位小写字母 / 数字 / `-`，如 `my-cat` |
| `name` / `description` | ✓ | 名字 ≤24 字，简介 ≤200 字 |
| `author` / `tags` | | 作者；标签 ≤8 个 |
| `size` | ✓ | `[宽, 高]`，16–64，推荐 `[32, 32]` |
| `palette` | ✓ | `{ "单字符": "#rrggbb" 或 "#rrggbbaa" }`，≤32 色；`.` 是透明，`_` 保留给“擦除” |
| `base` | ✓ | 底图，正好 `高` 行、每行 `宽` 个字符；**不要画眼睛、嘴和腿** |
| `anchors` | ✓ | 叠层左上角坐标 `[x, y]`：`eyes`、`mouth` 必填，`blush`、`feet` 可选 |
| `eyes` | ✓ | 每种状态一个叠层：`neutral`（必填）、`curious`、`pleased`、`flustered`、`annoyed`、`softened`、`blink`、`sleep`、`dizzy`、`love` |
| `mouth` | ✓ | `closed`、`open` 必填，`smile`、`pout` 可选 |
| `blush` | | 腮红叠层（需要 `anchors.blush`），害羞 / 被摸时显示 |
| `legs` | | 2–8 帧走路叠层，放在 `anchors.feet`；第 0 帧兼作站姿 |
| `extras` | | ≤8 个附件：`{ id, kind?, layer?: "back"/"front", at: [x,y], frames: [叠层…] }`，多帧会循环摆动 |
| `motion.style` | | `walk`（默认，迈腿）/ `hop`（蹦跳）/ `float`（漂浮） |
| `lineColor` / `faceColor` | | 自动生成闭眼 / 笑眼的线条色；底图画了眼睛时用来涂掉原眼睛的肤色 |
| `frames` | | 高级：`{ 动画名: [整帧…] }` 直接覆盖某个动画，详见 [reference.md](reference.md) |

叠层规则：`.` 表示不改动下方像素，`_` 表示擦成透明，其他字符覆盖。叠层必须完全落在画布内。
绘制顺序：back 附件 → 底图 → 腿 → 腮红 → 眼睛 → 嘴 → front 附件。

缺省回退：`blink` / `sleep` 缺失 → 由中性眼自动生成「︶」闭眼线；`pleased` / `love` → 自动「︵」笑眼；`dizzy` → 自动 × 眼；其余 → 中性眼。

## 3. 32×32 Q 版画法要点

1. **比例**：头占 2/3（约 22×20），身体 6–7 行，腿 2–3 行；底部留 1 行给描边。
2. **对称**：宽 32 时中轴在第 15 / 16 列之间，第 `x` 列的镜像是 `31 - x`。先画左半，再镜像。
3. **描边**：外轮廓用 1px 深色（偏暖的深紫 / 深棕比纯黑柔和），不同部件间也留 1px 描边或阴影色。
4. **明暗**：每个色块 2–3 级——主色、阴影（底部一圈）、高光（头发顶部一小段）。光从上方来，保持左右对称。
5. **大眼睛**：常用 3×4（`kkk / kwk / kek / kkk`，`w` 白色高光、`e` 虹膜色）或 2×3；两眼间距 6–8 像素更可爱。
6. **调色板**：8–16 色足够。建议键名：`o` 描边、`s/S` 皮肤与阴影、`h/H/L` 头发三阶、`c/C` 衣服、`k` 眼线、`e` 虹膜、`w` 白、`p` 腮红、`m` 口腔。半透明（如幽灵）用 `#rrggbbaa`。
7. **让它活起来**：耳朵、尾巴、呆毛、天线做成 `extras` 的 2–4 帧摆动（帧顺序就是播放顺序，例如 中→右→中→左）；嘴部至少有 `open`，说话时会开合。
8. **避免**：孤立杂点、单像素“锯齿”轮廓、眼睛贴着描边、腿画进底图（会和走路帧打架）。

## 4. 校验与预览

在仓库根目录（Node 24）：

```powershell
node scripts/pixel-pet/validate.mjs path/to/my-pet.json      # 校验，失败时打印中文错误并返回 1
node scripts/pixel-pet/preview.mjs path/to/my-pet.json out.png  # 生成 ×6 精灵表
```

精灵表第 1 行：全部眼睛状态（neutral、curious、pleased、flustered、annoyed、softened、blink、sleep、dizzy、love）；
第 2 行：四种嘴型 + 每一帧腿 + 附件摆动帧。打开 PNG 检查：五官是否对称、有没有杂点、闭眼 / 笑眼是否自然。

错误信息带路径，例如 `base[3]：行宽 31 与第 0 行的 32 不一致`、`eyes.neutral：叠层放在 (24, 13) 时尺寸 14×4 超出画布 32×32`。

AI Agent 自制流程：写 JSON → 运行 validate → 修正 → 运行 preview → 用看图工具检查 PNG → 迭代美术 → 交付。

## 5. 放到哪里

- 放进用户数据目录：`%APPDATA%/GalAgent/pets/<id>.json`，约 10 秒内自动出现在「小人」页面（无需重启）；
- 或在 GalAgent 的「小人」页面点「导入小人文件…」选择 JSON 文件；「打开小人文件夹」可直接定位目录。

文件上限 256 KB；`id` 请不要与内置小人重复（内置 id 见 `runtime/shared/pixel-pets/`）。

## 6. 让 GalAgent 自己画

安装版把本 skill 放在 `<安装目录>/resources/skills/galagent-pixel-pet/`，GalAgent 的本机执行器可以通过 `Skill` 工具读取它。
在聊天里输入 `/任务 按 galagent-pixel-pet skill 画一个戴围巾的小狗桌宠，保存到工作目录 my-dog.json`，完成后到「小人」页导入即可。
执行器出于安全不能直接写入 `%APPDATA%/GalAgent`，所以文件先落在工作目录里，由你确认后导入。
