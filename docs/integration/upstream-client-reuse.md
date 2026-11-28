# 固定上游客户端复用对照

基线：DS-Bot `v0.4.0` / `7963e66a74f40d23daa288a76cdca72b34e39561`。只读引用原版源码，在构建内存导出少量内部组件；不复制增补工作树UI，不启用服务器本机执行协议。

规则：功能与用户要求一致时采用上游；不一致时只保留必要适配。下表记录本轮核对的已有功能，避免后续升级重新实现已经可复用的部分。

| Deck已有功能 | 上游复用位置 | 保留的差异及原因 |
| --- | --- | --- |
| 聊天消息、Markdown、代码、问答、加载状态 | `client/cells.js`、`questions.js`、`app/ui/primitives.js` | `remote/chat.js`与`chat-read.js`承接远程分页和事件；原整页Chat需要本机session-page/follow |
| 聊天消息时间 | 原`EarlierUser`、`Bubbles`、`SpeakerHead`与`messageClock/clockLabel` | 开启`clock`的已读取聊天接上用户和Bot时间，群聊沿用原名称旁时间；待发送与流式不补造最终时间，连续Bot消息仍按原块显示，语言切换同步重绘时间 |
| 输入框加号、语音、模型菜单 | `client/composer.js`、`model-menu.js` | 绑定真实远程会话与发送回执；不装配Classic Agent输入协议 |
| @与斜杠候选 | **本轮复用** `app/ui/composer-menus.js`的`ComposerMenu`；目录仍来自原`mentionRows`和`commandEntries` | 保留输入法、含空格Bot名、代码段不误触发、当前会话复核及私聊/goal要求；补活跃项id和焦点语义 |
| 待发送附件、历史普通附件 | **本轮复用** 原`ComposerAttachments`和`client/user-message.js`的`Attachments` | 文件来自本机File；图片预览用临时blob并释放；上传、纯附件、未知结果和草稿沿用已核对协议 |
| 工具单项与参数/输出 | **本轮复用** `ToolCardShell`、`CodeSection` | 外层总数分组、callSeq身份、真实标题、未知状态及128Ki字符预算保留；按用户要求展开单项即显示参数/输出；复制经实时读取门禁 |
| 历史工具修改与保存差异 | **本轮复用** `computeLineDiff`和`DiffFileView` | 只比较服务器成功结果中的前后文本；缺旧文本不当新增文件；片段行号明确为相对行号，原样复制入口仍保留 |
| 子Agent委派 | **本轮复用** `SubagentLineageBar`、`SubagentReadOnlyBar` | 使用原返回与父子导航；目录、状态来源和事件仍取增补只读DTO；原SessionTranscript依赖本机日志且数据不等价 |
| 文件树、预览、终端侧栏 | 第25轮已复用`BotPanel`、`PanelStrip`、`TreeBranch`、`FilePreview`及`readXtermTheme` | 服务器根句柄、目录分页、终端字节/控制序号和未知回执保留；本机workspace/terminal接口不开放 |
| 文件编辑保存 | 原版仅有文件预览，缺少等价远程编辑回执界面 | 保留WorkspaceEditor、版本比较、冲突和内存草稿；本轮保存结果改用原差异组件 |
| 工具审批、学习提案 | 已复用`ApprovalCard`、`ProposalCard` | 仅允许一次/拒绝；学习审批逐设备授权和历史时间位置保留，不借原本机审批快捷键扩大权限 |
| 连续失败与重试、协作提示 | 协作已复用原`EventLine` | 用户要求连续失败默认计数折叠；原FailureCell依赖本机轮次节点且没有等价分组，保留真实诊断记录，不猜失败代码 |
| 私聊持续目标 | 原`goal.js`面向群目标/本机Agent，语义不同 | 保留/goal进入Bot设置、仅有效steer可运行、手动恢复及原目标回执；不恢复置顶目标条 |
| 模型高级设置与手动添加 | 原`SettingsDialog`导航、`ProvidersPage`、`SelectMenu`与设置样式 | Deck的`ModelSettings`只适配已有`providers/provider-models-save`，填名称/上下文/输出/输入类型；保留其他模型与未编辑字段，手机配对才可写。不接DSH宿主slot或engine-*；旧接口不回显高级参数、不编辑思考档位 |
| Bot、群聊、服务器设置与详情 | 已复用原`Overlays`、设置、详情、任务面板 | 只隐藏明确排除的电脑/浏览器接管；顶部名称快捷设置、头像详情保留用户要求 |
| 主题、语言、Bot图标 | 已复用原`ThemeCard`、词典、`createLocale`、`BotMark`/`CharacterGrid` | **本轮修复** `createDeckLocale`禁用原网页语言存储，三个Deck窗口采用本机统一选择，默认自动跟随设备语言且手动选择优先，语言列表也直接复用原LANGUAGE_OPTIONS；不修改服务器prefs或Bot回复语言 |
| 多服务器树、隧道更换、配对图像、宠物、窗口与背景设置 | 上游单Host客户端没有等价实现；图标和主题素材已复用 | 保留用户确认的多服务器身份隔离、五类本机设置、窗口尺寸冻结、全窗口背景和宠物规则 |

## 构建边界

`scripts/paint-components.mjs`集中提取候选菜单、附件栏、工具代码块和差异组件，锚点缺失或重复即拒绝构建。`paint-source.mjs`继续管理其他固定接线。复制回调、长正文不二次折叠和候选焦点是小范围内存适配，原目录源码不写回。

`scripts/ui-resolver.mjs`统一正式构建与CI回归的模块解析，返回Vite规范化路径；Windows反斜杠别名与正斜杠相对导入必须共享词典等状态模块。构建遇到同一模块的重复路径身份即失败，语言回归验证实际打包后的跨入口调用。

权限拒绝时清除正文并阻止迟到回包，切换目标不串用资源；本轮未新增网络端点、安装依赖或改变配对身份。真实构建与回归由CI执行，实际视觉、中文设置和远程联动仍需Windows现场核对。
