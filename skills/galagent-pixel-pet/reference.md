# galagent-pixel-pet@1 格式参考

权威实现：`runtime/shared/pixel-sprite.ts`（`validatePixelPet` / `parsePixelPet` / `composeGrid` / `composeFrame`）。

## 校验规则

| 项目 | 规则 |
| --- | --- |
| 文件 | UTF-8 JSON，≤256 KB，允许 BOM；未知顶层字段一律拒绝 |
| `id` | `^[a-z0-9][a-z0-9-]{1,39}$` |
| `size` | 两个 16–64 的整数 |
| `palette` | 1–32 项；键为单个非空白字符，不能是 `.` 或 `_`；值 `#rrggbb` / `#rrggbbaa` |
| `base` | 行数 = 高，每行字符数 = 宽；只能用调色板字符和 `.` |
| 叠层 | 非空、各行等宽；可用调色板字符、`.`（不改动）、`_`（擦除）；放到锚点后不得超出画布 |
| `legs` | 2–8 帧；无 `anchors.feet` 时贴底对齐、x = 0 |
| `extras` | ≤8 个；`id` 为 1–24 位小写字母数字连字符且不重复；`frames` 1–8 帧；`layer` 默认 `front` |
| `frames` | 键为动画名；每个动画 1–16 整帧，每帧尺寸与 `size` 相同，不允许 `_` |
| `lineColor` / `faceColor` | 必须是调色板里的键 |

## 组合状态（`composeGrid(spec, state)`）

```ts
{
  expression?: 'neutral'|'curious'|'pleased'|'flustered'|'annoyed'|'softened'|'blink'|'sleep'|'dizzy'|'love';
  mouth?: 'closed'|'open'|'smile'|'pout';
  legFrame?: number;      // 取模
  blush?: boolean;
  extrasPhase?: number;   // 0..1，附件第 floor(phase × 帧数) 帧
  look?: [dx, dy];        // -1..1：眼睛整体平移，嘴水平平移（看向指针）
  animation?: string;     // 若 frames[animation] 存在则直接返回整帧
  frame?: number;
}
```

纯函数、确定性：同一输入永远得到同一网格；`composeFrame` 再按调色板转成 RGBA（`宽×高×4`）。

## 渲染器动作

渲染器（`runtime/renderer/pixel-pet.ts`）在组合帧之上叠加弹簧姿态与像素粒子：

| 动作 | 表现 | `frames` 覆盖名 |
| --- | --- | --- |
| `idle` | 呼吸、随机眨眼、偶尔东张西望 / 伸懒腰 / 小跳 / 歪头 | `idle` |
| `nod` / `sway` / `peek` / `sulk` / `wave` | 点头、摇摆、探头偷看、闹别扭（转开 + 叹气云）、挥手（音符） | 同名 |
| `celebrate` / `sparkle` / `love` | 连跳 + 星星、环绕闪光、爱心眼 + 飘心 | 同名 |
| `doodle` | 低头涂鸦 + 笔画粒子 | `doodle` |
| `run` | 循环走路（按 `motion.style` 迈腿 / 蹦跳 / 漂浮） | `run`；漫步时为 `walk` |
| `sleep` | 循环：闭眼、慢呼吸、飘 z | `sleep` |
| `think` | 循环：看向上方、头顶「…」 | `think` |
| `dizzy` | 晕眩眼 + 头顶转圈星星（被甩动后自动触发） | `dizzy` |
| 被拎起 | 以头顶为支点晃荡、腿乱蹬，松手落地挤压 | `drag` |

整帧覆盖仅在你想要完全手绘某个动画时使用；通常只画零件即可。
