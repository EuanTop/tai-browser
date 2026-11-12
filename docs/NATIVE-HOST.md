# TAi 原生宿主接入基线

本阶段为开发联调接口，不是发行版完整功能。运行结果以 `research/local/native-host-smoke.json` 和产品构建记录为准；无头合成站点检查不替代触控板、真实账号、视频/画布/原生弹窗或全网站兼容验收。

## 当前浏览器控制边界（2026-11-09）

以 [产品方向](PRODUCT-FOCUS.md) 为准。当前原生可授权工具仅有 `page.list/open/read/act`；默认仅阅读，打开/操作需明确勾选。旧 `library.*` 与 `modules.*` 业务请求拒绝执行，旧资料库选择器和组件授权退出，旧 WebUI 地址显示停止提供提示，不运行原组件脚本。浏览器宿主不再读取或改写 `TAiComponentData.json`、`TAiLibraries.json` 作为启动条件，损坏的历史数据也不应阻断页面工具。

当前右栏只加载浏览器授权视图；设置由 `webui/settings-agent.js` 接入同一视图，不再导入组件父桥。保留原生 IPC、固定 Profile/Space/Page、页面修订、撤销与隔离设施。历史模块源码与数据仍保留，尚未完成按依赖去除全部无调用资源，不能把退出入口等同于发行体积已经优化。

右栏与扩展共用 Chromium 原生 SidePanelRegistry、SidePanelHeader 和关闭入口；TAi 不再在工具栏左侧添加独立右栏按钮。标题与内容合入同一张圆角卡片，统一在右侧显示。Mac 左栏开关由窗口框架提供一个固定位置的按钮，保留原折叠命令和快捷键；上游原按钮隐藏，避免切换时出现两种图标或位置。

连接注册元信息从当前 Profile 的私有 `TAiHostConnections/` 目录读取，限定文件数量、大小、所属用户、权限及协议字段；历史业务权限不恢复。目录读取不加载令牌为有效授权。新运行中必须经用户操作，以原 Space 和原权限重新授权，才会轮换令牌并更新原配置路径。MCP SDK 初始化/关闭与限时心跳报告客户端状态，工具使用状态独立；自报名称不作为身份认证。详见 [连接说明](AGENT-CONNECTION.md)。

下文组件、文件与隔离渲染部分为此前实现记录；当前启用范围由本节和 [产品方向](PRODUCT-FOCUS.md) 覆盖。

## 代码在哪里

- `src/chromium/host/`：C++，实际 Profile、页面授权、文件授权、组件存储及本地连接服务。
- `src/host/files/`：C++，基于目录描述符的相对路径存储。
- `src/chromium/webui/host-panel.js`：JavaScript，可信第一方面板和隔离组件的父端桥。
- `src/host/web/`：JavaScript，共享组件入口与子端 SDK 桥；阅读器、番茄钟业务直接复用 `modules/`。
- `src/host/client/native-client.mjs`：Node JavaScript，原 Agent/MCP 进程使用的连接客户端。不是 Agent runtime，也不是 MCP 协议的另一份实现。

自有主本都在产品 Git 仓库内。Chromium 的 `sidebar_browser/` 是生成副本。本轮复用原生 SidePanelRegistry/SidePanelUI 与 WebView，增加 TAi entry/action 和工具栏入口；总计十四处上游接线（包括浏览器嵌入层的组件 P2P/网络提示接口限制），不修改 Blink、V8、网络或沙箱核心源码。

## 权限、连接与页面

在 `chrome://tai/#agent` 的 Agent 设置中选择目标 Space，通过用户操作授权文件夹或创建连接。默认页面只读；打开/点击/填写、资料库读取和新增文件分别勾选。Agent 任务权限只在本次浏览器运行有效，可随时断开；资料库授权会持久保存并在重启后核验目录身份。创建连接返回本机私有配置文件位置，界面不会显示令牌；配置文件不能提交、上传或写入普通日志。

配置文件由原生宿主写入当前 Profile 的 `TAiHostConnections/`，文件 0600、目录 0700。客户端只连接本机同用户 Unix socket，无 TCP/CDP 端口。最多 16 个任务、32 个并发连接，一连接一请求，30 秒超时。实际 Agent 的 MCP 安装配置由用户选择的渠道适配器负责，本阶段不写用户全局 Agent 配置。

```js
import {connectNativeHost} from './src/host/client/native-client.mjs';
const host = await connectNativeHost(explicitConnectionFile);
const result = await host.execute({
  protocol: 'tai.v1', id: crypto.randomUUID(), command: 'page.list',
  scope: host.binding, payload: {},
});
```

客户端还返回冻结的 `commands/libraries` 授权元数据（缺失时为空），供 MCP 仅注册已授予工具；不会返回令牌。连接固定真实 `profileId + spaceId + taskId`。这些字符串只能核对权限，不能把页面换到别的 BrowserContext。用户切换前台不会重绑任务。跨 Profile 同一窗口托管仍属于后续 organizer 工作。

| 命令 | payload | 结果与边界 |
| --- | --- | --- |
| `page.list` | `{}` | 当前绑定 Space 内 HTTP(S) 活页面的 `pageId,pageRevision,url,title` |
| `page.open` | `{url}` | 在绑定窗口后台打开 HTTP(S)；返回 `pending:true`，须重新列出页面、等待已提交的新版本后再操作 |
| `page.read` | `{format?:'text'\|'snapshot'}` | scope 必须带列出的 pageId/pageRevision；文本上限 100000 UTF-16 单元，快照 HTML 上限 1000000；结果带宿主核验 scope、时间 |
| `page.act` | `{action:'click'\|'fill',selector,value?}` | 固定动作，无任意 JS；填写拒绝密码字段。页面版本、所属 Space 和 document 生命周期再次核验 |
| `library.read` | `{libraryId,resourceId}` | 读取已授权目录下 UTF-8 相对资源 |
| `library.list` | `{libraryId,prefix}` | 相对路径列表；根前缀用空字符串 |
| `library.putIfAbsent` | `{libraryId,resourceId,text}` | 仅新增，已有相同字节可确认成功，不同内容返回 IMMUTABLE_CONFLICT |

每条命令同时受原生 allowlist 限制。库 ID 还须在任务的授权集合中。取消发送后、超时或断线返回 `OUTCOME_UNKNOWN`；不自动重试，不声称已经回滚。文档导航/移动/撤销发生在异步操作期间会产生 `OPERATION_OBSOLETE`；已发送到 renderer 或已发布的文件不能承诺撤销。网页内容、标题和模型输出都是不可信数据。

AI 适配器从工具参数提取 pageId/pageRevision，放进原生请求 scope；其余 Profile/Space/task 字段始终来自 host.binding，不能接受模型覆盖。原生仍检查真实所有权。禁止暴露完整 CDP、任意脚本、系统路径、Profile 数据库或通用原生命令。

## 每窗口固定右栏

工具栏的 TAi 图标打开 `chrome://tai/panel.html` 原生右栏，不新建普通标签；使用 Chromium 既有侧栏布局，内容区实际让出宽度。只设置 `kTai` 的右侧对齐覆盖，保留 Chromium 原有侧栏/全局左右偏好。关闭入口只关闭当前 TAi entry，不关闭其他原生面板。

`src/chromium/host/native_panel.*` 在每个窗口的 registry entry 中保留自己的 WebContents。上游销毁临时 WebView 时解除视图连接，重开接回原文档，因此阅读草稿、组件 frame 和存储通道在收起/重开后保留；关闭原生窗口则销毁文档并释放原生 surface。保留到本次窗口生命周期，不等于跨重启安装恢复，也不承诺系统休眠期间定时回调持续执行。没有改变上游所有侧栏的缓存策略。

面板从 embedding context 获取真实窗口；账号环境来自该窗口实际 Profile，初始 Space 来自该窗口自己的左侧栏。组件选择器只决定新组件范围；切换时释放旧 surface，不改绑既有 Agent 任务。不同窗口的面板和可见状态独立。设置意图只在所属窗口打开管理页。

第一方消息：`taiGetPanelState()` 返回 `available/embedded/showing/windowId/tabCount/profileId/activeSpaceId`；`taiSetPanelVisible(boolean)` 和 `taiOpenSettings()` 需要用户激活。普通标签打开 panel.html 不会获得 embedded 标记。外部 Agent 和不可信组件不能调用这些管理接口。

当前右栏可运行共享番茄钟、阅读器并查看/撤销 Profile 内任务授权；Agent 会话尚未接通，明确显示未连接，不伪造聊天记录。AI 组 `createAgentPanelModule` 已交付，实际会话 controller/独占写租约和原会话连续性仍需原生接入。

## 原 Agent 的 MCP 页面链路

The [Agent connection guide](AGENT-CONNECTION.md) describes the scoped local MCP entry point. TAi requires an explicit grant and provides only the operations enabled for that connection.

organizer 已通过官方 MCP Client → stdio adapter → Unix 原生服务 → 真实测试页面的完整链路，覆盖后台打开、读取、填写/点击、另一 Space 焦点/输入不受影响、越界/过期/撤销和诊断不泄露连接材料。这是 MCP 浏览器工具链路；没有调用模型推理或验收原 Codex 会话接管。

## 文件与来源

用户选择的根文件夹会先解析为真实目录，再打开并持有目录描述符。之后每一层使用 no-follow 的相对 openat；拒绝点路径、绝对路径、反斜杠、百分号、控制字符、符号链接和多硬链接文件。每文件 4 MiB、路径 16 层/512 字节，列表有条目和扫描上限。写入临时文件后同步，通过同目录不可覆盖发布并同步目录，失败不谎报保存成功；重试相同字节会再次同步。未验证断电故障或恶意同系统用户持续替换目录项，不宣称这是对本机其他应用的隔离。

来源选择使用原生文件选择器，返回 `{sourceId,name,text,sha256,bytes}` 的只读内存快照；不是实时文件句柄。单文件 4 MiB，最多四份。本阶段不读取个人 Chrome/Arc Profile，也没有原生迁移提交/撤销 API。M 组处理已授权快照，提供预览；原子容器/收藏提交仍由 organizer 实现。

## 组件预览与 SDK

第一方 `hostCommand(binding,command,payload)` 调用原生宿主；`createSurfaceHost(container,binding)` 管理预览生命周期。两者从第一方 `chrome://tai/host-panel.js` 导出，不给用户网页或自定义组件导入。

```js
const surfaceHost = createSurfaceHost(container, {profileId, spaceId});
const preview = await surfaceHost.preview({kind:'pomodoro'});
await surfaceHost.apply(preview);
// 或 cancel() 放弃预览，保留先前已应用 surface。
await surfaceHost.dispose();
```

`preview` 支持 `reader`、`pomodoro`、`custom`：

- reader 的 input 为 `{format:'markdown'|'json',text}`，上限 2 MiB，复用 Marked/DOMPurify 和 JSON 共享阅读器；远程图片与附件默认不加载。尚未接入原生文档文件类型或附件资源解析。
- custom 为 `{kind,manifest,script,markup,style}`；manifest 沿用 v1，当前仅 panel、entry `index.html`。script 必须是已打包的浏览器 ESM（相对模块导入不支持），上限 2 MiB；markup 256 KiB、style 128 KiB。自定义组件不能用保留的 `tai.*` ID。用户传入前端包不触发 C++ 编译。
- 生成器只为开发者打包第一方静态资源，采用 Chromium 锁定工具 esbuild 0.28.2，依赖业务代码保持同一份；没有重复实现剪藏或阅读器。

组件在无原生消息绑定的 `chrome-untrusted://tai-content/` 子 frame 中运行。iframe sandbox 只允许脚本，响应 CSP 限制资源与连接，文档为 opaque origin；没有同源存储、父页 DOM、网络、worker、子 frame、弹窗、表单提交或顶层导航权限。组件专属的浏览器嵌入 binder 拒绝 P2P 与 DNS 预解析/预连接接口，普通网站保留原能力；决策与本机正反向检查见 [隔离复核](../research/COMPONENT-ISOLATION.md)。保留 Trusted Types；不开 unsafe-eval。预览就绪等待模块及其顶层 await 初始化完成，不能用脚本 load 事件代替。父端同时核对 WindowProxy、opaque origin、实例和 nonce 后转移一次 MessagePort，handle/Space 由父端闭包绑定；子组件不能指定原生 handle 或账号环境。端口有大小、并发和序号限制。

自定义原生 SDK 仅实现声明过的 `storage.get/set`。命名空间由实际 Profile、Space 与组件 ID 确定；同一组件在另一 Space 不继承数据。内置番茄钟沿用 Profile 级数据。value 64 KiB，代码版本与数据共用 4 MiB 原生存储上限；写入串行、原子保存后才确认。损坏存储保留原文并转只读。系统通知、组件内 clips 通道仍返回 `CAPABILITY_UNAVAILABLE`；第一方资料库及 MCP 剪藏工具复用同一保存层。阅读器路径复制是仅限内置组件且需要用户操作的特例。

预览使用私有数据副本；应用时比较旧数据及注册表版本，发生并发修改则拒绝覆盖。代码与预览数据在 `TAiComponentData.json` 中一次原子保存。每个 Space/组件保留最近三个代码版本；回滚不倒退用户数据，停用不删除代码与数据。已应用清单跨重启保存，用户从轻应用列表重新打开；不会在启动时自动执行全部用户代码。旧 frame 退役、导航或父页卸载后释放原生 handle。完整使用入口与包格式见 [前端轻应用](FRONTEND-APPS.md)。

## 复用与验证入口

上游本地参考：DrivePicker 的可信/不可信 WebUI 注册和 data source、UntrustedWebUIController 无 bindings、Glic 的内部 isolated world 页面操作、UnixDomainServerSocket 同用户校验，以及 Chromium 文件选择器/ImportantFileWriter。TAi 增加范围校验与生命周期适配，不复制一套浏览器网络、渲染或账号系统。许可沿用 Chromium BSD-style；第三方业务依赖许可仍位于各模块的 THIRD_PARTY/licenses 中，分发前需汇总完整 notices。

检查入口：`tools/check_native_sources.py`、`tools/smoke_native_host.mjs`、`tools/smoke_native_panel.mjs`、`tools/smoke_native_mcp.mjs`、`tests/host/secure_directory_test.cc`、`tests/host/native-client.test.mjs`。`--test-type=tai-host` 的夹具只接受进程启动时显式指定的合成测试路径，普通运行不提供该授权捷径；Agent 协议没有路径授权命令。
