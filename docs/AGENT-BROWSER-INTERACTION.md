# 人与 Agent 共用 TAi

更新于 2026-11-12。范围见[产品方向](PRODUCT-FOCUS.md)。上游修订、许可与复用范围见[来源调查](../research/AGENT-BROWSER-REFERENCE-2026-11.md)。

## 一个浏览器，两种使用方式

人使用完整 Chromium 网页、扩展、下载和原生界面；Agent 获得受限操作面。二者使用同一真实网页与目标 Profile 登录，不额外启动 Lightpanda、第二套 Chromium、模型循环或网页副本。Space 是组织与授权范围，不自动等于 Cookie 隔离。

当前通路：原 Agent MCP 客户端 → 官方 MCP SDK/TAi Node 适配器 → 同用户私有 Unix socket → 原生宿主 → 固定窗口/Profile/Space/Page。Agent 不获得全浏览器 CDP、任意脚本、Cookie 值或系统全局输入入口。TAi 维护浏览器执行，不重写 Agent。页面读写/枚举与 open 统一限制在授权创建窗口，窗口关闭返回 `WINDOW_CLOSED`；同 Profile/Space 的另一个窗口也不自动获得授权。

正式 MCP 工厂只加载浏览器描述符，不再静态导入退役剪藏/轻应用树；旧配置里即使声明这些 grant，也不能注册对应工具。模块保留供历史资料复用，但不会成为浏览器工具启动的隐式依赖。干净环境只安装 `modules/agent-tools` 声明依赖后，初始化/调用的 22 项检查已通过。

## 原生集成优先级

BrowserSkill 的有界观察、元素引用和操作后等待适合复用到 TAi 的 MCP 交互。Chrome 扩展也可以操作标签、读取授权页面，并在取得相应权限后使用调试协议。TAi 的差异来自浏览器本身掌握的 Space 归属、文档生命周期、输入焦点与原生 UI，能够在派发动作前用同一份状态判断授权和目标。 [BrowserSkill MCP](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/docs/mcp.md) · [Chrome Tabs](https://developer.chrome.com/docs/extensions/reference/api/tabs) · [Chrome content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts) · [Chrome debugger](https://developer.chrome.com/docs/extensions/reference/api/debugger)

| 优先级 | 用到的原生能力 | 用户可验证的结果 |
| --- | --- | --- |
| 1 · 后台执行与接管 | 复用 `WebContents`、窗口/Profile/Space 归属、文档修订、页面输入通知和宿主写入保护。由浏览器为任务衍生的新标签记录来源、验证归属，页面移出授权范围时结束该目标的控制。Space/标签旁显示 Agent 状态，暂停或接管后拒绝新的写入。 | 用户在 Space A 连续打字时，Agent 在 Space B 操作，页面、窗口与焦点保持正确。两个 Agent 同时写同页时只有一项能派发。用户开始操作目标页后，Agent 等待恢复。 |
| 2 · 操作后返回精简结果 | 在已有 `page.read` 上加作用域、条数与截断信息。一次已授权操作后，原生宿主在限定时间内观察目标条件，复用浏览器的导航、加载和文档身份事件，对局部 DOM 只读需要的结果。 | 点击后同一次调用返回命中结果、超时或未知结果。跨文档跳转只在目标仍获授权时继续观察。后台列表无关区域更新时，能统计是否导致无效的重复读取。 |
| 3 · 局部画面与原生交接 | 获授权后通过 Chromium 合成画面截取当前视口或页尾的一屏，以补足 Canvas 等视觉内容。截图以有界 PNG 返回，挂起、导航或撤销导致图像不可用时返回错误。浏览器识别权限弹窗、文件选择器等需要用户处理的界面，将原因和接管入口显示在目标 Space。 | Canvas 场景只返回目标区域，用户的其他标签与窗口不进入结果。系统弹窗交还用户，用户可以从目标 Space 继续。 |

原生生命周期让等待和失效判断更直接。操作结果仍分为已派发、条件已观察、超时与结果未知。暂停或撤销后停止派发后续动作，已经派发的动作可能已产生副作用。截图和观察沿用目标授权范围。 [锁定 Chromium 的 `WebContentsObserver`](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/content/public/browser/web_contents_observer.h) · [页面合成表面读取](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/content/public/browser/render_widget_host_view.h)

第一轮用本地合成站点复现同页竞争、跨 Space 并行和触发新标签的操作，同时核对焦点、输入内容、目标归属与派发次数。第二轮再用同模型、同任务、同成功判据比较文本和截图 token、往返数、完成率与耗时。调用次数或返回字节减少只作诊断指标，模型用量按每个成功任务单独统计。

## 第一段：减少选择器猜测

保留现有四个工具、授权与配置格式。`tai_page_list` 增加 `loading`；open 的 pending 返回不能当已提交文档。

1. `tai_page_list` 获取 `pageId`、`pageRevision`。
2. `tai_page_read({pageId,pageRevision,format:"interactive"})` 返回 `snapshotId` 及有界 `controls`：`ref`、角色、名称、不可用/敏感标记。不返回输入值、HTML 或全篇正文；正文另选 `text`。
3. `tai_page_act({pageId,pageRevision,snapshotId,ref,action:"click"})`，或 fill 加 `value`。ref 和 CSS selector 不能混用；旧 selector 入口保留兼容，推荐新路径。
4. 重新读取检查网页结果。`performed:true` 仅表示动作已派发，不代表提交、付款、下载或外部业务成功。导航使回调文档过期时可能返回 `OPERATION_OBSOLETE`；先观察，不能盲目重复写入。

引用保存在 Chromium 隔离世界，按原生 task ID 分开，模型不能指定 owner。每个 task/文档只保留最新快照、每页最多八份；最多扫描 20,000 个主文档元素、返回 200 个控件，截断明确标记。DOM/输入变更、目标文档 pointerdown/keydown、30 秒到期、同任务新的 interactive 读取或一次动作派发后失效；失效同时释放监听、定时器与节点引用。普通正文读取不替换快照。旧引用不会自动重新匹配相似按钮。导航、页面移出 Space、关闭和撤销继续走原生身份/修订/权限检查。引用失效是局部保护，不等于完整的用户接管/写入租约。

这是保守的 DOM 控件清单，**不是完整可访问性树或 Playwright 替代实现**。名称使用 aria/label/文字回退；iframe、shadow root、Canvas 未覆盖。频繁 DOM 更新的网站可能反复要求重新观察。click/fill 为后台程序化 DOM 动作，不等于可信鼠标/键盘事件；需要真实用户手势的网站可能拒绝。密码不填，文件选择器返回 `HUMAN_REQUIRED`。没有普遍自动等待、图像定位、滚动或业务结果验证。

引用路径检查可见/禁用/编辑类型，尚无像素遮挡命中测试或完整 accessible-name 算法。字段值不直接序列化，不代表页面自己显示在正文/标签里的敏感内容也会自动识别并脱敏。

## 双方通信：当前与下一段

现有请求有 request ID、固定 task scope、原生错误及结果。MCP 初始化/关闭和有界心跳区分“已配置 / 客户端在线 / 已调用工具”。MCP 是浏览器工具通道，不能续接原 Agent 对话历史，也不保证通知会让外部 Agent 自动开始推理。原 Agent 会话与浏览器执行通道分别维护。

现有 MCP SDK 已提供任务状态查询和状态资源订阅，浏览器宿主记录事件。以下列出该状态在 Agent 和浏览器界面的对应关系，用户界面仍按场景验收。

| 状态/事件 | Agent | 用户 |
| --- | --- | --- |
| 连接在线 | 握手成功不等于任务完成 | 渠道与授权 Space |
| 目标变化 | Page/文档修订、加载、引用失效 | 不抢焦点、不弹无关提醒 |
| 操作执行 | request ID、已派发/未派发/结果未知 | 窗口工具栏胶囊显示 Agent、操作、Space 与页面标题 |
| 需要人工 | 明确原因、暂停该页写入 | 登录/权限/原生对话框接管 |
| 接管/暂停/撤销 | 拒绝新写入，恢复需用户操作 | 一处暂停/恢复/撤销入口 |

页面打开、读取、写入和截图触发目标窗口的工具栏胶囊。胶囊按不同页面计数，同一页的连续操作合并。点击单页胶囊激活原标签，点击多页胶囊展开列表，显示页面标题、Space、Agent 和操作。操作结束后在前台保留 5 秒，后台保留 30 秒。在此期间切回窗口会再显示 5 秒。

MCP 工具 `tai_page_screenshot` 需要连接单独获得截图许可，通过页面 ID 和文档修订限定目标。默认截取当前视口，`position: "bottom"` 截取页尾的一屏。截图直接作为 PNG 图像返回，最大 1600 × 1200 像素。该操作可用于后台标签。

事件需递增游标、有限缓存和合并节流；游标过期需重查。无消费者不扫描 DOM 或生成快照。重连查询实际状态，不重放副作用操作。状态查询不得暴露其他 Space 或扩大授权。

## 人机并行的下一段

Agent 不切换当前活动 Space/Tab，不注入全局输入。用户在另一 Space 浏览；进入目标页可看结果，显式接管与实际编辑需原生协调暂停 Agent 写入。多 Agent 读可并行；同页写由原生排队或明确 `PAGE_BUSY`，不能靠各适配器自己的锁。目标关闭不能转去当前活动页。

还需专项验证网页动作衍生的新 Tab、popup、下载与对话框：不能仅凭 `page.open` 的后台行为，推断任意网站脚本触发的新窗口也会留在任务 Space 或不抢焦点。衍生页面的归属与焦点控制是原生协作层的后续工作。

源码已有同页在途写入保护，竞争请求返回 `PAGE_BUSY`。绑定窗口中获得输入焦点的页面收到键鼠或触摸输入时，只保护该页的后续写入。其他已授权页面仍可打开和操作。切走时，旧页面的接管状态解除。手动暂停及需要用户处理的交接保留整条连接的暂停。宿主在操作前检测页面模态对话框，遇到文件字段也可进入人工处理状态。衍生页面与弹窗的完整原生交接、两 Agent 写入竞争与真实窗口焦点仍需要专项验收。 [写入检查](../src/chromium/host/native_pages.cc) · [输入与暂停](../src/chromium/host/native_host.cc) · [MCP 订阅](../modules/agent-tools/native-tools.mjs)

## 性能与体验验收

在同一 Chromium、同页面集、同扩展环境比较无 Agent、空闲连接、单任务、两任务的 CPU/RSS、延迟、返回字节与往返。先减少整页 HTML、截图和轮询，再决定休眠策略；不能中断活动任务、音频、下载或用户编辑。

记录构建类型、硬件、磁盘位置和冷/热启动条件：当前外接盘上的 component 开发构建与正式发行构建不能混作同一性能样本。编译/检查耗时也不是浏览器任务延迟。先区分启动与 I/O、网页自身负载、扩展、Agent 观察开销，再确定优化位置。

比较浏览器运行成本时使用独立安装包，核对包内的浏览器运行时和 Agent 适配依赖属于同一构建。

Lightpanda 官方爬取基准与 TAi 完整可视浏览器条件不同，不作为 TAi 性能数字。语义工具不自动改善动画帧率；动效、真实拖放与接管须独立窗口验收。实际检查见 [PRODUCT-ACCEPTANCE](PRODUCT-ACCEPTANCE.md)。

开发时可先运行 `node tools/smoke_page_controls.mjs <明确指定的 Chromium 兼容浏览器二进制>`，在一次性 Profile/本地合成站点验证同一隔离世界脚本，尽早发现字段值提取和引用问题。它不包含 TAi 原生权限、窗口或 MCP，不能替代主干完整门禁；所选浏览器版本会记录在收据中。临时 Profile 位于系统临时目录，检查收据仍在忽略的 `research/local/`。
