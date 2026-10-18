# Kimi Code 执行器适配

当前正式实现已交付：[OpenAI兼容Kimi工具适配](OpenAI-Kimi工具正式适配.md)。本文件下文是被用户纠正的CLI/ACP实验记录，保留对照，不再是默认执行路径，也不把其中“尚未接入”当作当前状态。

## 当前用户纠正（优先于下方实验）

可行性实证：现有OpenAI兼容反代上的真实Read往返已通过，详见[反代真实工具闭环](evidence/KimiCode反代真实工具闭环.json)。这次没有调用CLI，是本项目解析tool_calls并执行受限测试Read。正式运行循环及25工具执行后端仍需完成。

用户要的是现有OpenAI兼容反代与Kimi Code工具协议的兼容，不是调用Kimi Code CLI/ACP，也不是照搬其代理编排。用户指定完整捕获文档：<USER_PROFILE>/Desktop/mira反代/KimiCode-K3-反代工具适配完整文档.md。工具原始schema已提取，传输和执行兼容层尚未完成，实际进度见NEXT文首。下方为之前接偏的实验，不能作为当前需求完成声明。

状态：KIMI-AGENT-20261009。ACP执行器已接入、真实Read与打包链路已通过，新版目录release/kimi-agent/win-unpacked。

用户要求：Agent工具默认参照本机Kimi Code源码，现有反代继续作为模型接入方式。采用Kimi Code原生ACP执行器，不复制一份Bash/Read/Write/Agent/Skill实现。

已定位本机kimi.exe 0.29.2，并检出官方对应标签 `@moonshot-ai/kimi-code@0.29.2`，提交8a45f10eddbb35c317047e82e567cdb59a220b4f，MIT许可。参考路径.cache/reference/kimi-code，不运行或修改下载的源码。

协议依据：apps/kimi-code/src/cli/sub/acp.ts，packages/acp-adapter/src/server.ts、session.ts、modes.ts、approval.ts、events-map.ts。通过initialize→session/new→session/set_mode(yolo)→session/prompt执行。默认完整工具访问依照Kimi Code原生yolo模式；操作系统权限仍由本机进程身份决定。

GalAgent主角色只提供一个委派入口，实际工具、技能发现、MCP与原生子代理由Kimi Code处理，继承它已有的provider配置及认证，不导出或复制订阅令牌。主角色现有反代地址/模型配置独立保留。不会自动创建反代、转换订阅认证或改变本机Kimi Code配置。

主对话输入“/任务 任务内容”直接执行；普通对话模型可提出delegate.task请求，仅用户聊天能委派，观察和主动场景不能启动执行。工作目录默认GalAgent启动目录，可显式配置。只有一个执行队列，主聊天可继续，取消独立；任务结果按完成/失败/取消、工具计数和有界最终摘要回传。主上下文不接收Kimi Code私有推理或完整工具日志。

原生工具目录以运行时实际提供为准，源码工具名仅为参考，不声称所有搜索、MCP、浏览器或系统控制服务均可用。禁止目录/真实沙箱尚未接入，不能拿提示词假冒硬隔离；当前只实现用户指定的默认完整访问模式。

当前交互式问题不会代替用户选择；遇到这类请求返回需要补充信息、标记未完成。原生AskUserQuestion选项的界面转接尚未实现。异常、取消、没有最终摘要或非end_turn结果都不能冒充成功；只有有界最终摘要进入主上下文。

状态done表示执行回合正常结束并有最终摘要，不能单靠end_turn证明业务目标达成；具体完成、改动、失败和待决事项以结果证据为准。

连接页提供工作目录、任务输入、开始/取消与状态；普通主聊天也可以通过delegate.task委派。常规工具权限按完整访问策略执行，语义选择不自动猜答案。用户当前Kimi Code配置默认模型为moonshot-cn/kimi-k3；未更换或导出其认证，不能据此声称每个执行请求已经经过用户另一个反代地址。

验收：隔离模拟ACP覆盖协议、分帧、权限、摘要、取消与退出；本机真实ACP握手/模式协商验证版本兼容；真实读写工具任务限于自建测试目录，记录实际结果，不冒充所有插件验收。
