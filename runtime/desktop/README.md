# Windows 桌面观察助手

`DesktopObserver` 只管理固定 `observer.ps1` 的生命周期。使用方式：

```ts
const observer = new DesktopObserver({
  scriptPath, // 主进程决定的固定本地资源路径
  enabled: false,
  includeTitles: false,
  onObservation: sample => runtime.acceptObservation(sample),
});
observer.start();
observer.setOptions({ enabled: true }); // 用户显式开启观察
observer.setOptions({ includeTitles: true }); // 单独的标题授权
observer.stop(); // 应用退出
```

一个 helper 常驻，每 2 秒推送 JSONL。使用 `powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File`，`windowsHide:true`；没有 shell command 拼接、stdin 执行通道或动态脚本输入。标题变更/禁用先终止旧进程，等 `close` 后才启动新进程，避免并存。意外退出仅退避 1 / 2 / 4 秒重试，共 3 次；耗尽后用户切换观察设置可恢复。退出取消所有计时器。

可读内容为进程名、输入空闲时长、前台窗口与所在显示器边界的全屏判断、UTC 采样时间，以及单独开启后的最多 256 字标题。输入空闲来自 `GetLastInputInfo`，没有捕获输入内容。没有剪贴板、IM 内容、历史、截图、命令历史或文件读取。默认不采集标题，stderr 直接排空而不记录。

通过 `OpenInputDesktop` + `GetUserObjectInformation` 确认输入桌面为 `Default` 才输出 unlocked。权限不足或桌面名查询失败输出 unknown (`available:false`)，其他输入桌面输出 locked。超过 10 秒采样间隔为 `suspended:true` 的恢复缺口，下一次新鲜采样再恢复可用；这不能单独证明机器发生过系统休眠。超过 10 秒没有有效推送，wrapper 发出 `observation-stale`。主动调度必须要求 `available`，不能把未知状态当作未锁屏。

边界解析拒绝超过 8 KiB 行、超过 10 秒新鲜度、非法进程名与无效 JSON，只转发合同中声明的字段。不能确认 unlocked / 恢复缺口时过滤应用和标题。未知字段丢弃；标题关闭立即丢弃旧进程的晚到数据。数据仅通过回调进入内存，不建立日志文件。

## 实测与剩余验证

2026-10-08 本机非管理员环境：固定 helper 与 TS wrapper 各完成 3 次连续采样，间隔约 2 秒；`available:true`、进程 `QQ`、全屏 false、locked false、没有标题字段。没有读取聊天正文。仅终止本次启动的进程。

独立 5 秒冷启动探针：helper 工作集 84.5 MiB，累计 CPU 0.875 秒（含 PowerShell 和 Add-Type 启动），得到 3 次采样。这不是十分钟静置性能结论。

`node --import tsx --test tests/desktop/observer.test.ts` 5 项通过：schema/新鲜度/标题过滤、默认关闭及隐藏固定命令、单进程与标题重启、超长分段行恢复、有限退避和停止清理。项目 typecheck 时本模块无错误；当前 renderer 的 composition 属性有独立错误，已交给主代理。

真实锁屏、安全桌面、休眠恢复、真正全屏窗口和多屏切换尚未实测；没有为验证而锁屏、休眠或修改用户当前窗口。这些项目需要后续场景验收，现有单测不能替代。全屏为窗口边界几何判断，可能把覆盖整个显示器的普通窗口判断为全屏；主动隐藏采取保守策略。
