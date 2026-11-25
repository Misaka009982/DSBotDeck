# 主窗口配置变化诊断

## 目的与证据边界

用户反馈 `0.1.5` 退出重开后仍会逐次变大。现有“默认隐藏创建 → 就绪恢复 → 再记录”和保存去重未证明解决 Windows 原生尺寸漂移。本轮只加观测，不再改尺寸公式、恢复顺序、最小尺寸或 Vault 格式。

本轮诊断源码标为 `0.1.6`，类型、回归与打包须核对对应新提交的 Actions。**须使用包含诊断的 `0.1.6` 新包才会生成日志；已经安装的 `0.1.5` 不会因源码变更自动获得记录功能。** 本机没有启动客户端、运行回归、严格类型检查或构建，本文不是已取得的实机结论。

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
6. 将日志发回分析即可，**不要发送 `client.vault.json`、整个客户端数据目录或图标缓存目录**。日志含窗口坐标和显示器几何，可在发送前自行检查。

## 字段含义

| 字段 | 含义 |
| --- | --- |
| `schema` / `version` | 诊断格式及客户端版本，不能用旧版 CI 验证诊断新代码 |
| `session` / `pid` / `sequence` / `at` | 启动标识、进程、当前启动内顺序号、UTC 时间 |
| `windowId` / `ready` / `quitting` | 对应的主窗口、是否恢复就绪、是否已进入退出 |
| `saved` | 此时本机 Vault 中的窗口字段；恢复事件明确保留本轮启动读到的值 |
| `target` / `minimum` | 程序请求恢复的矩形或请求设置的最小尺寸 |
| `geometry.outer` | `getBounds()` 返回的外框矩形 |
| `geometry.content` | `getContentBounds()` 返回的内容区矩形 |
| `geometry.normal` | `getNormalBounds()` 返回的还原矩形；最大化保存使用它 |
| `geometry.physical` | `screen.dipToScreenRect` 的物理像素转换；不可用为 `null`，不是独立 Win32 测量 |
| `geometry.display` | 显示器编号、DIP 边界、工作区和 `scaleFactor`；不含显示器名称 |
| `captured` / `persisted` | Tracker 最新有效状态、最近成功保存基线；跳过与真实写入分开记录 |
| `reason` / `lastEvent` | 本次刷新触发原因、排队时最近的原生窗口事件，例如 `resize`、`close`、`before-quit` |
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
  → restore-minimum / restore-bounds / restore-maximize / restore-complete
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

回归定义覆盖白名单与错误脱敏、重复启动追加、轮换/积压预算、非普通文件拒绝、文件元数据、DPI/内容/外框、观测故障隔离、恢复边界、写入原因与跳过、排队快照、真实 Vault 更新及固定托盘/退出接线。新增 15 项定义，项目共 26 个回归文件、164 项定义；没有在本机运行。

本轮仅完成 9 个代码文件的 `node --check` 语法、14 个文本文件的严格 UTF-8 解码和 `git diff --check`。人工审查限定本轮文件，检查脱敏、回调副本、串行写入、轮换/积压预算及监听/退出清理；没有执行独立模型审查、严格类型检查或客户端。必须由对应新提交的 CI 和 Windows 实机分别验证，不能把诊断实现描述为尺寸漂移已修复。
