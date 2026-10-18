# 动画 CPU 隔离实验

2026-10-09。使用旧稳定运行包、独立 .cache 数据目录、CDP9231；不开模型、不采集标题、不移动系统鼠标。测量只包含自建根 PID8024 的家族，不合并相同 EXE 路径下的生产实例。完整数据在 animation-perf.json，脚本为 scripts/probe-animation.mjs。

| 120秒阶段 | 整机CPU | PID家族 |
|---|---:|---|
| A1 正常人物位移动画 | 2.118% | 出现一个短命 GPU 子进程，存在遗漏尾部CPU的缺口 |
| B 只暂停 pet 位移动画 | 0.723% | 稳定 |
| A2 恢复原动画 | 2.004% | 稳定 |

B→A2 差1.281个百分点，主要来自 GPU 进程约0.152%→1.185%。这支持连续透明人物动画是主要开销候选；A1存在PID变化，所以结果文件 causalEvidenceUsable=false，不能宣称完整无缺口因果实验或最终10分钟资源门通过。

所有阶段 native IsWindowVisible 确认 chat 隐藏，但 renderer document.hidden=false、not-visible=false、呼吸仍 running。该状态本身不证明隐藏窗口持续 GPU 重绘；后续可专门修窗口显隐通知，使隐藏人物暂停、可见人物照常动画。

光标始终在人物窗口内且位置不变，原生轮询 / 命中成本保留；不能把结果等同于光标在外的静置预算。显示器240Hz是父代理通过 Win32_VideoController 读取的本机值，原脚本字段 displayRefreshHzUserReported 是标签名称，并非用户口述。

实验保持七差分、眨眼、点击穿透和主进程逻辑不变，仅临时样式暂停 / 恢复人物位移动画。自建根进程已exit0，残留直接子进程0。未改变当前产品动画或生产应用；默认仍优先人物表达与流畅度，用户已有减弱动态选项。
