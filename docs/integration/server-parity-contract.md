# Deck 与服务端全交互接线契约核对

## 当前基线（v0.4.0）

本轮迁移正式 `v0.4.0` / `7963e66a74f40d23daa288a76cdca72b34e39561`；服务端增补清单为 `1.3.0` / `0.4.0-addons.1`。下文旧提交、旧包与早期门禁记录仅为历史证据。Deck 构建只读使用这个原版提交，服务端保留增补，二者不混用 UI 源码。

学习审批新增 `extras.learningApproval: { schema: 1, allowed: boolean }`，设备开关与完整消息开关相邻但独立，绑定设备 ID、公钥、配对时间。手机与浏览器获授权后均只可调用原 `learning-answer({ id, approve })`；未授权、撤销、只读或未知协议拒绝，旧版无声明时保留原手机权限行为。Deck 卡片与主进程同时核对，结果未知不重发。

新版原始 `session-*`、`workspace-*`、`terminal-*` 等本机接口不用于远程接线；工作区与终端继续按本页 `extra-*` 契约独立授权。新版会话创建保留 `agentPreset`，工具角色过滤和隐藏协作隔离采用 v0.4.0 上游实现。实际部署、回归和安装效果以本轮提交 CI 与实机验收为准。

## 早期证据边界

本页是接线核对与服务端回传清单，不是已经上线的 API 声明。

- 提交前只读确认相邻 `DS-Bot` 工作树干净，HEAD 与远端 `main` 均为 `53967c00`；此前授权的资源修复、私聊目标和工具折叠已包含在服务端提交中，本轮不重复修改或生成服务端文件。
- `5d1f1d6b` 起具备委派、真实用户 PTY、工作区文件与工具 diff，`b64637df` 补了重复脱敏等问题。本轮接完 Deck 终端／编辑保存，并修复服务端调用关联、可验证互聊来源、只读预览回执、终端关闭与恢复归属。
- `addons/manifest.json` 保留原版 `0.3.10` / `d104d9ca18d69a35460f14e15dff4d553181433a`，当前增补为 `1.2.0` / 包 `0.3.10-addons.3`。旧1.1.0服务包不包含后续修复和私聊目标；实际服务器是否安装仍必须看部署响应。
- Deck UI 构建固定读取原版 `d104d9ca`，终端另声明标准 `@xterm/xterm@5.5.0` 与 `@xterm/addon-fit@0.10.0`；未在代理本机安装依赖，不导入服务端增补才有的 UI，也不更换身份绕过浏览器权限。
- 后续实机工作区 `bot/stale` 已定位为 Cordis 代理引用比较问题，修复包版本为增补 `1.2.1` / `0.3.10-addons.4`：通过公共 `symbols.original` 比较原服务身份，实际调用仍走上下文代理。工作区与用户 PTY 都保留真实服务更换、目录／会话变化及授权失效检查；需更新服务端并在实际后端验收，见 [验收记录](../verification/remote-client.md)。
- 本会话没有探测用户服务器或运行程序／测试／构建。用户已接受文件现有版本检查、内容复核与单次回执的保证范围；这不证明强 CAS 或用户那次重试故障已经恢复。
- 实施单元与约束见 [DSH Web 对齐计划](../plans/2026-11-25-001-feat-dsh-web-parity-plan.md)。本页不修改计划决策，不给未确认接口起可调用名称。

## 已核对的读取契约（C1）

Deck 只放行本页逐项核对的固定端点；资源写入有单独有限清单，未知 `extra-*` 仍拒绝：

| 端点 | 真实用途 | Deck 当前范围 |
| --- | --- | --- |
| `extra-status` | `schema:1`、基线与设备完整消息授权状态 | 按版本声明判断兼容，不能从客户端名称推导权限 |
| `extra-messages` | Bot／群聊增强页，保留原分页与投影 | 主聊天／群聊；不将 `agentId` 当作委派目录 |
| `extra-task-read` | DS-Bot 后台任务增强页 | 原 TaskReaderView；不是 DSH 子 Agent 委派 |
| `extra-tool-list` | 会话中的稳定调用列表 | 已核对只读名称，不注册任意 Agent／Session 读取 |
| `extra-tool-detail` | 单次调用的脱敏参数或输出 | 逐次展开、按 `offset` / `digest` 分段，不执行命令 |
| `extra-todos` | 真实工具待办投影 | 只读声明；待办不是委派生命周期或终端句柄 |
| `extra-delegation-list` / `extra-delegation-read` | 受限父子目录与过程分页 | Bot／群聊／后台入口；根会话、子路径和切面固定，历史结算不覆盖真实运行 |
| `extra-workspace-open` / `extra-workspace-list` / `extra-workspace-read` | 当前获授权工作区的根、目录和完整文本 | 仅相对路径；支持 `readOnlyPreview:true` 时预览不分配编辑回执，显式编辑另行领取 |
| `extra-workspace-save-status` / `extra-workspace-change` | 查询原保存和读取实际修改 | 固定根／回执／请求，未知结果不重新提交 |
| `extra-terminal-list` / `extra-terminal-read` | 用户 PTY 目录、原始字节与控制回执 | xterm.js 增量消费字节；只读不创建、输入或调整尺寸 |
| `extra-tool-change` | 单次工具成功结果中的修改片段 | 必须有 callSeq，旧基线缺失与部分应用如实显示；当前文件另外通过根句柄读取 |

完整消息权限在 `host/extras/access.js` 按已配对 `deviceId`、`identityKey`、`pairedAt` 绑定；`exchange` / `exchange-text` 与 `fullMessages:true` 仍由服务器逐次验权。权限变更等待保存期间，服务器可先下调远程状态，因此 Deck 在原 `createTeam.pull` 的同 revision 早退前同步 `extras`。

兼容策略：

1. 无 `extras.schema` 声明直接走原 `chat` / `room-chat` / `bot-task-read`，不先探测旧浏览器白名单外的端点。
2. `schema:1` 才使用已经核对的有限增补；未知版本显示不兼容。
3. 只有 `bot/not-found` 且消息精确指明本次端点不存在，才允许非完整消息读取回退；原服务端存在 `Unknown endpoint <endpoint>` 的格式，不能只认带冒号形式，也不能用包含端点名作为判断。
4. 请求完整消息、授权拒绝、锁定、网络错误、其他对象不存在或损坏回包不降级，不把失败替换成空历史。重连后旧缺失回包也不能触发新连接读取。

## 新增服务端模块（5d1f1d6b）

| 模块能力 | 已实现的固定端点 | 读取／操作边界 |
| --- | --- | --- |
| `delegations.schema:1` | `extra-delegation-list`、`extra-delegation-read` | 完整消息授权；固定 scope、rootSessionId、childPath；真实父子目录与生命周期，固定切面分页，不加载或控制 Agent |
| `terminals.schema:1` | `extra-terminal-list`、`extra-terminal-read`、`extra-terminal-create`、`extra-terminal-input`、`extra-terminal-resize`、`extra-terminal-close` | 独立 terminalRead／terminalWrite；仅插件新建的用户 PTY，同范围可只读观察，写操作仅设备自有终端；序号去重与未知结果不重放 |
| `workspace.schema:1` | `extra-workspace-open`、`extra-workspace-list`、`extra-workspace-read`、`extra-workspace-save`、`extra-workspace-save-status`、`extra-workspace-change` | 独立 filesRead／filesWrite；服务端根、相对路径、10分钟句柄、完整 UTF-8、版本前置条件和单次保存回执；脱敏内容不可编辑 |
| `toolChanges.schema:1` | `extra-tool-change` | 完整消息授权；sessionId／callId／callSeq 定位成功结果中的 meta.diffs，逐 hunk 读取；缺旧文本、部分应用和超预算不伪造完整结果 |

详细 DTO 以服务端 [委派协议](../../../DS-Bot/addons/delegations.md) 和 [资源协议](../../../DS-Bot/addons/resources.md) 为准。四项资源授权在服务器「连接 → 手机」逐设备设置；完整消息授权不代替资源授权，资源开关变化轮换授权代次并作废旧句柄。新能力缺失时不探测端点，不以旧附件／后台任务接口替代。

已只读核对固定 `0.2.2-rc.1` 的公开声明：[Subprocess](https://unpkg.com/@deepseek-ai/dsh-subprocess@0.2.2-rc.1/lib/types/index.d.ts) 及 [PTY 类型](https://unpkg.com/@deepseek-ai/dsh-subprocess@0.2.2-rc.1/lib/types/types.d.ts)、[FileSystem](https://unpkg.com/@deepseek-ai/dsh-fs@0.2.2-rc.1/lib/types/index.d.ts)、[SessionQuery / 观察切面](https://unpkg.com/dsh-session-query@0.2.2-rc.1/)、[Subagent](https://unpkg.com/@deepseek-ai/dsh-subagent@0.2.2-rc.1/lib/types/index.d.ts) 及 [目录投影](https://unpkg.com/@deepseek-ai/dsh-subagent@0.2.2-rc.1/lib/types/projection-types.d.ts)。调用形状和生命周期字段有公开依据；没有下载／安装 SDK 或调用真实服务。

## 私聊目标与工具显示接入（增补1.2.0）

服务端 `addons/private-goal.md` 与 `addons/tool-display.md` 已按实际实现核对，提交前复核到 `53967c00`；本轮只修改 Deck，不修改相邻源码。构建仍固定原版 `d104d9ca`，不直接导入服务端增补 UI。当前服务包是否包含新功能必须由部署后的能力响应确认。

- `extras.privateGoal.schema:1` 与顶层 `extras.schema:1` 同时成立时，当前 Bot 私聊通过 `/goal` 按需打开原 Bot 设置里的目标卡片，聊天顶部不放目标状态条。读取 `bot.extras.goal` 的 `schema/id/revision/status/objective/acceptance/progress/evidence/reason/rounds/emptyTurns/updatedAt`，忽略服务端内部执行标识，损坏 DTO 不显示成已完成。
- `extra-goal-control` 仅支持 `start/revise/pause/resume/stop`，请求固定到 Bot、当前私聊、原目标与 revision。Bot 独立指定或继承基础的有效 `steer` 才允许启动／恢复；`queue` 与 DSH 默认不允许，切离保留目标并暂停，切回须手动恢复。服务器仍按有效消息方式及原配对身份最终校验；完整消息和文件／终端授权不代替目标操作权限。暂停／终止只停止后续自动推进，当前工作使用原停止按钮；目标开启不直接点亮绿色工作灯。
- Bot 设置与私聊裸 `/goal` 指向同一管理入口，群 `/goal` 不变。历史段、群和后台任务不借 Bot 别名冒充当前私聊。重复打开管理入口仍共享每 Bot 操作锁，断线／换段／关闭后不自动重发；显式查询完整 `state` 后核对再操作。新完整读取被较新回包淘汰、收到 `unchanged:true` 或版本落后时拒绝确认；写回执和重读目标也按编号／revision关联。
- 工具模型增加可选 `filePath`；标题采用“读取／编辑／运行命令 · 真实路径或说明”。仅已知 Bot `workDir` 可缩短目录内路径，外部路径或遍历形式原样显示，不作为文件访问授权。单项打开直接呈现参数或命令和输出，两者仍按原 offset/digest、并发和128Ki字符预算读取；读取常规参数紧凑显示、命令原样复制，其他参数不丢弃。授权拒绝或坏 DTO 卸载整组详情，历史修改入口保留。
- 固定原版 BotSettingsForm 在内存中注入 Deck 目标 Card，团队动作增加显式全量刷新；工具沿用 Deck 既有分组。没有把服务端和 Deck 的两套 `ToolSteps`／`MessageNote` 混挂，也没有修改构建仓库、SHA或依赖。

运行与静态证据见 [验收记录](../verification/remote-client.md) 的本轮接入节。新代码未构建、安装或实机运行，旧1.1.0服务包与旧Deck安装包不会自动取得这些功能。

## 接线门禁当前状态

| 门禁／单元 | 当前源码证据 | 后续条件 |
| --- | --- | --- |
| C2 / U3、U4：说明与互聊来源 | 服务端从真实参数脱敏投影短说明；internal 行仅在原账本核实非私密 Bot 对后附加 exchange，Deck 校验当前目录后打开原交换组件 | 本地源码完成，旧服务器／失效关联仍只读；部署与真实协作页待联调 |
| C3 / U5：真实委派 | 受限目录和过程已接 Deck，支持主聊天、群聊、后台及已登记历史父会话；状态、结算和轮次分别显示 | 本地源码与静态核对完成，实际版本、冷历史、跨范围和撤销联调待验证 |
| C4 / U6：PTY | 标准 xterm.js 已接真实 spawnTerminal 协议，支持创建、只读观察、输入、resize、尾部输出与本设备明确关闭；输出副作用禁用 | 源码完成，依赖只声明；真实 shell、终端序列、中文输入和窗口尺寸待运行验收 |
| C5 / U7、U8：工作区 | 目录、预览、编辑、版本冲突比较、单次保存、未知结果查询及本次实际修改均已接；最多八份内存编辑，切服保留、退出提示 | 按用户确认的现有后端保证启用；跨进程强 CAS 不成立，真实文件与失联路径待验收 |
| C6 / U7：真实修改 | Deck 与服务端均按 callSeq 保留每次调用，服务端按调用区间关联结果；工具修改与当前文件／本次保存分别读取 | F1 源码已修，回归只定义；真实两次同编号修改待运行确认 |
| C7 / U9：重试 | 新阻塞绑定 sessionId／turn／seq；同会话后续正常完成且提供方一致才清理，并保留 bot.recovery 的失败／完成关联；旧完成不清较新失败 | 本地已知归属缺陷已修；无关联旧阻塞保持保守，用户原实例的完整生命周期和发布状态仍待验证 |

文件保证上限详见服务端 [接线核对](../../../DS-Bot/addons/resource-audit.md)：版本前置条件不等于跨所有外部写入的原子比较交换，规范化路径检查也不等于内核级目录隔离。源码契约就绪不等于这些运行门禁已经通过。Deck 仍逐模块绑定固定端点，不创建本机执行器或通用 RPC 代理。

### 静态复核发现 F1：同编号调用的列表身份（源码已修）

- 原服务端按 callId 去重并取最后结果，同页两次调用会少一条、前次状态也可能串到后次。Deck 先前已补 callSeq，本轮服务端列表同步按实际事件序号保留每次调用。
- 结果只关联此前最近的对应调用，隐藏／跳过的调用也重置关联边界；重复事件不重复计数。跨页缺结果仍显示未确认，不把另一调用的结果补到此处。
- 新增同页／跨页、失败后成功、重复事件和隐藏边界定义；原两次真实 diff 读取断言保留并补上列表计数。源码及定义已核对，尚未运行或部署。

## 重试残留红灯的核对链（C7）

已读取的 `host/turns.js` 中：

1. `blockBot` 保存 Bot 的明确阻塞事实，错误正文不写入 `blocked`。
2. `turn/end` 会先清理当前活动；`steerCut`、`suppressedSubagent`、切段等路径可提前结束处理，不能把这些情况一律当正常完成。
3. `reason.kind === 'completed'` 的分支仍处理恢复，但本轮新增归属判断：必须是已观察到的同一会话、不早于失败的轮次、较新事件和同提供方。`bot.recovery` 记录 `failedTurn/failedSeq/completedTurn/completedSeq`；缺归属的旧阻塞不猜测，原凭据／登录／模型修复入口保持。`store.js` 排队保存推进 revision，`feed.js` 在保存成功后发布 revision；路径存在不证明用户原轮次实际走到。`pause_bot`／`new_bot_session` 不算重试成功，回执仍为 `recovery_verified:false`。
4. 后台任务按独立状态结算。前台回复正常且 `blocked` 已删除时，另一条 `task.status === 'failed'` 仍可使汇总状态为红；应显示后台失败来源，不能借前台成功清掉它。
5. Deck 只按有效完整快照撤销当前阻塞投影；普通回复通知、部分流式、取消或 `{ok:true}` 的损坏 DTO 都不是正常完成证明。同 revision／旧连接回包不能恢复旧阻塞。若并发的较新增量先应用，旧完整快照继续丢弃，并重读完整状态；已有较新的完整快照时不重复核对。显式请求完整状态却收到 `unchanged:true` 时保留缓存，按原轮询重试。

服务端维护者请按以下边界提供一组脱敏记录：

- 起始失败：Bot、当前会话、轮次／事件序号、错误码、阻塞是否存在。
- 重试开始：对应的会话／尝试关联、当前工作状态；与另一 Bot／后台任务区分。
- 重试结束：`turn/end` 的 `reason.kind`、是否走提前返回分支、会话归属解析结果。
- 状态撤销：成功分支是否删除阻塞、保存是否成功、随后公开 state 的 revision 和 blocked 是否存在。
- 若仍红：同时提供同一快照中后台任务的稳定编号、状态、结束／更新时间，确认是否为独立故障。

只回传白名单编号、版本、事件类型、结果类别、错误码与布尔状态；不要提供密钥、完整配置、完整模型错误正文、调用栈、命令或文件正文。没有这组证据不宣称用户实例根因已解决，也不让客户端强删服务器 `blocked`。

## 服务端回传格式

每个模块的源码契约已按上表核对；正式联调与启用前仍需补充：

1. Git 提交／包版本、实际部署 DSH 与 DS-Bot 版本，以及该模块的公开 schema。
2. 最终操作名和请求／响应 DTO，含分页、预算、完整性、错误类别与权限不足样例；不是概念草案。
3. 服务端如何按设备身份和实际对象验权、读／写如何分开、授权撤销与重配如何使旧句柄失效。
4. 已允许的正常与失败脱敏样例；生命周期类资源另给跨 Bot／群／历史会话及断线竞争样例。
5. 已完成的服务端静态／回归证据，以及哪些真实联调仍未完成。

Deck 接线时逐模块绑定固定端点和稳定对象；不从能力响应读取任意 RPC 名称执行，不靠隐藏按钮替代服务器鉴权。

## 当前推进结果与下一步

- U1–U8 的本地源码接线已完成：原入口、紧凑工具、可验证协作、委派、真实用户 PTY、历史修改及工作区编辑保存，按服务端声明和独立设备授权启用。
- U9 包含 Deck 全量状态乱序后的重新核对，以及本轮服务端阻塞／恢复归属修复；颜色策略和独立后台失败保留。用户原实例根因仍不能从静态源码断定。
- U10 补了模型、固定门禁、真实 scheme／连接链路与服务端回归定义，文档、接入锚点和第三方许可同步。静态核对范围见 [验收记录](../verification/remote-client.md)，测试定义未执行。
- 未完成的是外部运行验收：严格类型、测试、构建、真实服务器／PTY／文件操作及同次故障生命周期。源码提交不代表发布或实机验收；须按 Deck 本提交核对 CI，不复用先前客户端的结果。
- 本轮没有独立多模型审查通道，采用逐路径静态复核；xterm 依赖只声明，文件按现有后端保证范围启用，不宣称更强隔离。
