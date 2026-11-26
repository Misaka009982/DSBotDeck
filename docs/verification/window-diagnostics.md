# 主窗口配置变化诊断

## 目的与证据边界

用户反馈 `0.1.5` 退出重开后仍会逐次变大。“默认隐藏创建 → 就绪恢复 → 再记录”和保存去重没有处理原生尺寸读写的非对称。发布的 `0.1.6` 仅加入窗口/配置观测，没有调整恢复公式、最小尺寸或 Vault 格式。

用户安装 `0.1.6` 后已提供完整实机记录，结果见下一节。当前源码已加入恢复校准与用户尺寸冻结，版本暂保留 `0.1.6`；构建结果须核对本提交的 Actions，Windows 实机仍待验证，不能把已发布诊断包或此前 CI 当作新补丁的验证。本机仍没有启动客户端、运行回归、严格类型检查或构建。

## 0.1.6 实机结果与本地修复边界

2026-11-25 只读解析 389 条完整记录、6 次启动。环境为 125% 缩放，工作区 `2752×1152` DIP。用户重新保存半屏 `1376×1152` 后，五次重开表现如下：

| `restore-start.target.width` | `restore-bounds.geometry.outer.width` | 后续保存宽度 |
| --- | --- | --- |
| 1376 | 1378 | 1378 |
| 1378 | 1379 | 1379 |
| 1379 | 1381 | 1381 |
| 1381 | 1383 | 1383 |
| 1383 | 1385 | 1385 |

第一次不一致发生在 `setBounds` 恢复后、窗口显示前。随后 `show` 产生的 `move` 由 `window-state` 写回，下一轮把带偏差的外框再当恢复目标。高度每次目标为工作区的 1152、读回1153；位置因右侧越界随目标左移。配置文件始终 19740 字节，五次正常退出均为 `tracker-write-skipped`；服务器配对与会话选择更新均为 `windowChanged=false`。因此确认的是应用层“原生恢复偏差 → 再保存 → 再恢复”的反馈链，不是文件追加或关闭前检测加尺寸。Windows/Electron内部边框和取整的具体实现不单凭这份日志断言。

当前补丁在隐藏恢复阶段按实际读回外框校准，最多4次设置，必要时第5次恢复最佳观测；不固定减2像素，不改变布局字段或成功写入基线。无法精确表示的DIP或原生最小外框会有限退出并记录 `restore-unmatched`，不能伪装成精准恢复。左右半屏与自定义DIP宽高共用此路径。

用户进一步确认：拖拽也是设定，拖拽中实时更新宽高，停下后冻结；普通移动、原生resize、显示、恢复、关闭和退出只记录位置和最大化标记，下一次仍使用最后用户尺寸。`WindowStateTracker` 分开保存用户宽高与原生观测位置，原生残差不再进入尺寸字段；半屏／自定义记录经过工作区限制的用户目标，无旧值时使用创建默认尺寸。跨屏最小尺寸更新不会主动撑大现有窗口，也不清配置、配对或历史用户尺寸。是否实机稳定仍须包含本轮代码的新包复查。

## 日志位置与获取

新包启动后自动追加 UTF-8 JSONL，每行一个事件：

```text
%APPDATA%\DSBotDeck\diagnostics\window-state.jsonl
```

也可右键托盘，选择 **“打开窗口诊断日志文件夹”**。入口只打开主进程固定的本机目录，不接收路径参数，不向远程页面开放读取接口。

正常生成的每份日志上限为 2 MiB，保留当前文件及两份旧记录：

```text
window-state.jsonl
window-state.jsonl.1
window-state.jsonl.2
```

重开继续追加，以 `session`、`pid` 和时间区分每轮启动，不覆盖上一轮。窗口事件不等待日志写盘；正常退出在 `will-quit` 阶段停止文件/显示器观测并等待最后记录落盘。最多积压 1024 项，超载或写盘失败会计入 `dropped`，不能将缺失记录当作“没有触发”。日志权限、目录或链接异常只提示，不阻止原配置保存，不提权、不清缓存、不重置配对。

## 建议复现步骤

1. 使用包含诊断的新包，保留原配对与配置，不删除 `client.vault.json`。
2. 先将普通窗口手动调整到一个便于辨认的位置和大小，不最大化、不贴靠。
3. 从托盘选择真正退出，再重开；连续至少 3～5 轮，若稳定则延长到 12 轮。第一组不要在中间拖动、切换显示器或修改缩放。
4. 记录每轮肉眼是否变大、使用哪个退出入口，以及显示器缩放比例；问题出现后取三份日志一起查看。
5. 再分别做最大化、还原、半屏贴靠与不同 DPI 显示器的独立组，不把多种操作混入同一轮。
6. 包含当前补丁的新包中，打开窗口分类再拖拽：宽高实时变化；放手后只移动、最小化／还原、切主题或退出，用户宽高应冻结。再用半屏／自定义更新一次并连续重开12轮，核对 `captured` / `persisted` 宽高不随 `geometry.outer` 的原生残差增加。
7. 将日志发回分析即可，**不要发送 `client.vault.json`、整个客户端数据目录或图标缓存目录**。日志含窗口坐标和显示器几何，可在发送前自行检查。

## 字段含义

| 字段 | 含义 |
| --- | --- |
| `schema` / `version` | 诊断格式及客户端版本，不能用旧版 CI 验证诊断新代码 |
| `session` / `pid` / `sequence` / `at` | 启动标识、进程、当前启动内顺序号、UTC 时间 |
| `windowId` / `ready` / `quitting` | 对应的主窗口、是否恢复就绪、是否已进入退出 |
| `saved` | 此时本机 Vault 中的窗口字段；恢复事件明确保留本轮启动读到的值 |
| `target` / `minimum` | 期望的外框矩形、统一最小尺寸；不把校准后的请求冒充期望值 |
| `requested` / `attempt` | 新补丁每次传给 `setBounds` 的矩形与设置次数；同一目标可有多次实测校准 |
| `geometry.outer` | `getBounds()` 返回的外框矩形 |
| `geometry.content` | `getContentBounds()` 返回的内容区矩形 |
| `geometry.normal` | `getNormalBounds()` 返回的还原矩形；最大化保存使用它 |
| `geometry.physical` | `screen.dipToScreenRect` 的物理像素转换；不可用为 `null`，不是独立 Win32 测量 |
| `geometry.display` | 显示器编号、DIP 边界、工作区和 `scaleFactor`；不含显示器名称 |
| `captured` / `persisted` | Tracker 最新有效状态、最近成功保存基线；当前补丁宽高为最后用户设定、位置来自有效原生矩形，不能等同于 `geometry.outer`；跳过与真实写入分开记录 |
| `reason` / `lastEvent` | 本次刷新触发原因、排队时最近事件；`user-resize` / `user-resize-end` 与 `window-layout` 能更新宽高，普通 `resize`、`move`、`close`、`before-quit` 不能 |
| `windowWriteId` / `operationId` | Tracker 写队列项及 Vault 更新序号；用时间、来源和前后窗口值关联 |
| `before` / `after` / `windowChanged` | 更新前后的窗口字段及是否变更；没有其他设置或凭据值 |
| `file` / `previousFile` | 文件状态、字节数、`mtimeMs`、`ctimeMs` 和 `ino`；不含文件内容或完整路径 |
| `errorCode` / `dropped` | 固定允许的错误类别、丢失项数量；不含异常正文或调用栈 |

除 `geometry.physical` 外，Electron 窗口和显示器矩形使用 DIP，不应把 `scaleFactor` 乘回保存值。最小化临时矩形可出现在几何日志，但不成为 Tracker 的有效保存值。`geometry: null` 表示窗口已销毁或观测不可用，不能据此推断真实尺寸为零。

## 怎样定位第一次变大

按同一 `session` 的 `sequence`，对照以下边界：

```text
vault-load-success.saved
  → window-created.target / geometry.outer
  → restore-start.saved / target
  → restore-minimum / restore-bounds / restore-correction / restore-unmatched / restore-maximize / restore-complete
  → window-menu-* / window-icon-* / window-theme-* / window-event
  → tracker-capture / tracker-capture-skipped
  → tracker-write-queued / tracker-write-start / tracker-write-skipped
  → vault-update-start / vault-update-prepared / vault-update-success
  → session-stop
```

- **`target` 已比 `saved` 大**：先查恢复时的工作区和最小尺寸计算，不先怪磁盘保存。
- **`target` 没变，`restore-bounds.geometry.outer` 已变大**：首次不一致在原生 `setBounds` 边界，继续结合内容区、还原矩形与 DPI 排查。
- **恢复后相同，某次菜单、图标、标题栏更新或原生事件后变大**：缩小到首次改变外框/还原矩形的事件，而不是按退出入口猜测。
- **Tracker 的 `captured` 已变大，随后 `vault-update-success` 的 `windowChanged=true`**：保存的是已经变化的有效矩形；回溯前面的采集事件。
- **文件变了，但 `windowChanged=false`**：这是其他设置导致整份加密文件替换，不能当作窗口尺寸被加大的证据。
- **只有 `vault-update-prepared`**：这是计划写入；只有 `vault-update-success` 才表明原子替换成功。`tracker-write-success` 仅表示上层保存回调完成，仍应核对 Vault 的真实结果。

`restore-correction` 表示下一次校准请求，不是实际效果；有新补丁时先看最后一条 `restore-bounds` 与 `restore-complete` 的真实几何，而不是把第一条尚待校准的原生差值直接当失败。`restore-unmatched` 必须保留待实机核对，不能把日志存在当作尺寸已稳定。

`vault-file-observed` 每秒只观察文件元数据，不读取或解密字节，可能合并快速的多次变化。它本身无法判断哪一个进程修改了文件，也不能恢复外部写入的窗口值。若没有对应的客户端写入事件，只能标为“待核对来源”，不能直接断言外部程序篡改。

## 固定写入来源

| `source` | 生产调用来源 |
| --- | --- |
| `window-state` | `ServerManager.saveWindow`，继续看 `reason` 与 Tracker 事件 |
| `pet-position` / `pet-settings` | `ServerManager.setPet` 的位置或其他宠物修改 |
| `appearance-settings` | `ServerManager.setAppearance` |
| `server-paired` / `server-pair` | 配对完成回调或新增/重新配对保存 |
| `server-connect` / `server-disconnect` | 连接自动恢复标记更新 |
| `server-rename` / `server-forget` / `follow` | 别名、移除或关注修改 |
| `selection` / `content-selection` | 本机选择或原聊天页面选择同步 |
| `file-observer` | 文件元数据观测，不代表写入者 |
| `unspecified` | 未标注的调用，需要补查，不能补造来源 |

## 隐私与验证

日志只投影窗口数字、布尔状态、固定来源和文件元数据。不会输出服务器名称/地址、设备 id、密钥、令牌、配对码、聊天正文、背景路径、完整配置、加密正文、调用栈或异常正文。原配置仍保存在原加密 Vault；诊断回调使用副本，不可借修改观测数据影响真正的恢复或保存。

`0.1.6` 发布前的诊断回归新增15项，整套26个文件164项由第11轮 Actions执行。本次本地补丁另外定义原生非对称的多轮恢复、最小/量化外框、校准字段白名单、候选光标/IME/真实上游目录与动作、分类和本机窗口请求契约；本机均未运行。窗口原因来自用户日志，不是测试替身；新补丁效果还没有实际运行证据。

人工静态复核限定本轮文件，检查脱敏、校准上限与最佳回退、窗口请求队列后的归属、菜单与分类焦点、缓存、旧回包和监听清理；没有独立模型审查或客户端运行，不把语法核对称作严格类型检查。

`0.1.6` 初始提交的第 10 轮 Actions 在严格类型阶段发现 Electron 事件重载不接受循环中的联合事件名，回归与打包未执行。发布前修正改为显式字面量绑定，同一回调引用按原事件清理；13 个窗口事件与 3 个显示器事件、顺序及行为不变，不使用 `any`、类型断言或关闭检查。安装包与验证须匹配修正后的源码提交，而不是初始失败轮次。
