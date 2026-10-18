# GalAgent 原生协议与生命周期验收

2026-10-09，北京时间。测试入口：`node tests/e2e/electron-protocol.mjs`。开发版运行前执行 `npm run build`；最终运行包验收设置 `GALAGENT_E2E_EXE` 为 `release/win-unpacked/GalAgent.exe`。

最终六事件 / 显隐版本的实际 Windows 运行包重跑：`@huggingface/transformers 4.3.1`、`onnxruntime-node 1.30.0`、`sharp 0.35.5`。版本从实际安装包读取并写入机器可读结果；长对话对照部分79/77/17请求和4913上下文上限由当前版本重新产生；追加后台恢复场景后的全程请求另列。

这是一套**本地 HTTP 协议 fixture + 真实 Electron 应用**测试。所有服务端可见回应都标注 `[协议验收fixture]`，测试没有连接 Kimi 服务，没有验证真实模型的人格质量、延迟、计费或可用性。

## 执行范围与隔离

- 独立启动本项目实际打包的 GalAgent.exe（Electron 44），断言 renderer 来自 app.asar；renderer → sandboxed preload → 主进程 → CompanionService → localhost HTTP → 结构校验 → SQLite → renderer 为真实路径。
- 每次使用新的 `.cache/e2e-{timestamp}` 数据目录，测试自行取名为「验收星棱」，不进入生产存档或既有 9224 开发实例。
- API Key 为公开固定测试字符串，仅连接临时 `127.0.0.1` HTTP 服务。启动时清除继承的真实 API Key 环境变量。
- 桌面观察保持默认关闭，不采集真实应用标题，不修改系统保护、不锁屏、不休眠。
- Playwright `_electron.launch` 对当前 Electron 44 启动失败，实际采用有明确子进程句柄的 `spawn` + 自建 CDP 9225；结束关闭自己启动的应用及本地服务。最终交付重跑时生产实例已退出，测试结束后再单独启动运行包验收；测试始终只关闭自己的 Electron。

## 通过的验收

| 项目 | 证据与判断 |
|---|---|
| 未配置失败 | renderer 提交后显示真实未配置错误，中文草稿恢复，SQLite 不生成成功会话 |
| CSP 与页面加载 | 实际 app.asar 中生产构建的 JS 生效；CSS 计算布局为 grid；最终 7 / 7 帧立绘差分成功加载 |
| 显隐与进度 | 真实shell hide/show通知renderer暂停/恢复，可见pet保持动画资格；E01/E03事件与札记目标实际preload显示 |
| 原生alpha缓存 | file://生产页面可以读取真实neutral PNG alpha，`data-hit-test="alpha"`断言通过，没有回落矩形 |
| 密钥存储 | `config.save` 通过真实系统保护保存；snapshot 无密钥；保护文件不包含明文测试 Key；localhost 服务收到正确 Authorization |
| 名字与身份 | 模拟模型返回受约束名字，经正式事务进入 ready / S2；同目录重启保持名字和身份 ID |
| 事实来源 | 背景抽取接受「我喜欢在降水的午后安静看书。」原句；拒绝 fixture 返回的非用户原句事实 |
| 真本地语义索引 | 使用项目下载的 E5 本地模型及实际 embedding worker，状态达到 ready；未注入向量或替代嵌入器 |
| 同义检索 | 提问「下雨的时候我爱做什么？」；在 localhost 捕获的真实上下文 retrievalCandidates 中找到上述原句。此项验证检索链路，不验证模型最终回答质量 |
| 取消与晚响应 | 确认服务器已经收到延迟请求，再取消；服务器尝试晚返回后，没有成功会话或晚回复提交 |
| 未知来源 | 服务返回未登记 sourceId，响应整体拒绝，无成功写入 |
| 收回演出 | 关闭胡闹后 doodle 变 idle；安静操作清空气泡并停止动作 |
| 七帧与眨眼 | 通过真实HTTP协议逐一切换七帧并截图；可见pet的natural blink短暂切换后恢复neutral，服务snapshot的expression保持neutral，未注入状态 |
| 长对话上下文 | 65 段无个人信息的虚构长对话触发真实后台 rollup；实际会话超过120条，snapshot恰好保留最近120条；后续请求装配摘要，所有 chat 请求的应用估算上下文不超过 6000 |
| 记忆生命周期 | 真实 IPC 纠正/删除后旧记忆不再出现在 snapshot；同目录重启删除结果仍保留 |
| 后台续接 | 后台抽取请求已被fixture收到但暂不回应时退出；同数据目录重启，只再请求一次，事实不重复且embedding ready；详见后台恢复验收 |
| 重启存档 | 名字、密钥配置状态、会话数量、删除状态均通过同目录关闭重启验证 |

增量摘要检查断言全部 payload 可解析、已折叠来源不重复，以及同一长对话摘要请求不超过 24 次（防止退回逐轮重写）。旧运行 66 次摘要结果保留在 `protocol-pre-incremental-summary.json`；本次 17 次，减少约 74.2%。详见 [增量摘要验收](增量摘要验收.md)。

当前实际运行包长对话对照部分捕获 79 次 chat、77 次 memory、17 次 rollup；追加后台抽取中退出 / 重启续接后，全程捕获 80 次 chat、79 次 memory、18 次 rollup 请求；chat 最大应用估算上下文为 **4913 tokens**。这是项目自身的字符估算值，并非 Kimi tokenizer 实测。最新机器可读结果为 `tests/e2e/evidence/protocol-result.json`，重跑会覆盖该结果。

原生七表情截图位于 `docs/evidence/E2E-expression-{neutral,curious,pleased,flustered,annoyed,softened,blink}.png`。目视对比 neutral / blink / flustered 的整窗截图，服装、身高与脚底锚点一致；没有观察到需要用固定躯干软mask修复的明显错位，因此未增加CSS合成层。自然眨眼的触发与恢复经原生DOM监测验证。静态截图及触发监测不能替代用户实际感受或帧时间性能测量。

## 未由这套 E2E 证明的内容

- 真实 Kimi 的人物表达、取名质量、输出结构遵从率、网络取消及推理延迟。
- 原生文件选择器下导出/导入旧备份及删除账本传播。此项需引用已有 Core 备份恢复测试，不能用本测试的「重启保持删除」替代「恢复旧备份保持删除」。
- 48 小时常驻稳定性、多显示器切换、DPI、真实锁屏/休眠/恢复、GPU/CPU预算。
- 用户主观动画流畅度、长期观看舒适性与帧时间性能；当前七帧截图和短时眨眼监测仅证明本轮可见行为。

截图：`docs/evidence/E2E-native-fixture.png`。该图展示测试 fixture 会话，不能用于宣传真实模型生成效果。测试存档目录仅保留可复现协议证据，不是生产相处记录。

## 透明点击穿透补充

renderer缓存neutral立绘的alpha通道（约1.5 MiB），每次鼠标移动只查缓存，不重复`getImageData`。命中按实际object-fit:contain尺寸与CSS变换的逆映射计算，alpha低于32的区域转为原生点击穿透；人物实体、可见气泡和菜单按钮可交互。拖拽期间保持捕获，释放后恢复当前位置的穿透状态。Electron `forward:true` 的mousemove和常规pointermove均由同一rAF队列处理，IPC按交互状态去重。

`tests/frontend/ui-smoke.mjs` 已使用实际neutral PNG验证：同一人物按钮内的透明/实体切换、旋转15°并平移后的坐标映射、气泡与菜单、拖动跨透明区与释放、移动不增加canvas读取次数。故意使canvas读取失败的测试验证了显式`rectangle-fallback`模式：它保持矩形交互，不能宣称仍有逐像素点击穿透。正常缓存模式标记为`data-hit-test="alpha"`。

E2E所有snapshot等待使用显式循环：await原生bridge的getSnapshot，检查条件，不满足则等待100ms后重试。embedding最终直接断言ready，后台任务必须无queued/running；重启、取消另有直接状态断言。没有将返回Promise的waitForFunction当成ready证据。
