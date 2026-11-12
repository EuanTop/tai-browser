# Agent 浏览器操作与通信参考 · 2026-11-11

## 范围与结论

### Zen 的对外表述核对

2026-11-11 核对 [官网首页](https://zen-browser.app/)、[About](https://zen-browser.app/about/)与官方仓库 dev 分支 README（公开 API 当时 HEAD [`7511ea84f1374d9e5ac2846cda1067cf7cfdd2f2`](https://github.com/zen-browser/desktop/blob/7511ea84f1374d9e5ac2846cda1067cf7cfdd2f2/README.md)）。这些当前介绍没有使用 “inspired by Arc” 定位。官方文档域名定向检索也未找到对应表述，但这不能证明所有历史页面/讨论从未提到 Arc；第三方介绍和社区主题不当作官方声明。按用户的条件，TAi 中英文 README 移除 Arc-inspired/Arc 风格的定位，实际交互研究和必要致谢仍如实保留在工程记录。

本轮检查下列工程的官方源码、README、操作文档和许可证。仅做来源核对与设计参考，**未安装或执行这些工程，未验证它们直接连接 TAi，未测量 TAi 性能**。TAi 继续使用锁定 Chromium；保持扩展与日常浏览，不引入第二内核、外部工程的 Agent 规划器或模型循环。

最值得借鉴的是「精简观察 → 明确目标操作 → 验证变化」以及会话/页面的稳定绑定。轻量首先减少观察输出、无效往返与空闲活动；不能把无图形引擎的爬取基准等同于完整浏览器。

## 精确来源与复用边界

以下修订均由 GitHub 公开 API 在研究时读取默认分支 HEAD；它们是源码快照，不代表所发布软件包版本。许可证原文已核对；本轮不复制源码或引入运行依赖，后续实际捆绑需另查传递依赖与发行要求。

| 工程 | 源码修订 | 许可证原文 | 本轮采用方式 |
| --- | --- | --- | --- |
| Lightpanda | [`2bb333c63b6287f4c154134d79fc6dad55e7ecdc`](https://github.com/lightpanda-io/browser/tree/2bb333c63b6287f4c154134d79fc6dad55e7ecdc) | [AGPL-3.0](https://github.com/lightpanda-io/browser/blob/2bb333c63b6287f4c154134d79fc6dad55e7ecdc/LICENSE) | 参考有界输出、会话与协议设计，不替换或捆绑引擎 |
| agent-browser | [`f423bb090ccdcadd0de587dd77eed3430d93a306`](https://github.com/vercel-labs/agent-browser/tree/f423bb090ccdcadd0de587dd77eed3430d93a306) | [Apache-2.0](https://github.com/vercel-labs/agent-browser/blob/f423bb090ccdcadd0de587dd77eed3430d93a306/LICENSE) | 参考语义观察、元素引用、固定页面及明确失败 |
| Browser Use | [`693ddd2069d50b41baa3dd48335c9a2265379db8`](https://github.com/browser-use/browser-use/tree/693ddd2069d50b41baa3dd48335c9a2265379db8) | [MIT](https://github.com/browser-use/browser-use/blob/693ddd2069d50b41baa3dd48335c9a2265379db8/LICENSE) | 参考浏览器/Agent 分层及连接生命周期；不引入模型循环 |
| Browser Harness | [`65c174a097cbcca483e967f5c4aa3a7b730b797d`](https://github.com/browser-use/browser-harness/tree/65c174a097cbcca483e967f5c4aa3a7b730b797d) | [MIT](https://github.com/browser-use/browser-harness/blob/65c174a097cbcca483e967f5c4aa3a7b730b797d/LICENSE) | 作为 Browser Use 当前辅助层核对，不直接开放全浏览器 CDP |
| Playwright MCP | [`8aa18a55a7fd4cde2d06d7d5156bd5866ed774f7`](https://github.com/microsoft/playwright-mcp/tree/8aa18a55a7fd4cde2d06d7d5156bd5866ed774f7) | [Apache-2.0](https://github.com/microsoft/playwright-mcp/blob/8aa18a55a7fd4cde2d06d7d5156bd5866ed774f7/LICENSE) | 参考可访问性观察和不激活用户窗口的控制选项 |

## 具体发现

### Lightpanda：去掉图形渲染的效率不能直接搬到 TAi

官方说明其为 Zig 编写的新浏览器、没有图形渲染引擎；提供 DOM/Markdown 输出、点击/填表、CDP 与 WebDriver BiDi。README 的约 16 倍内存/9 倍时间优势来自作者公布的 AWS 爬取基准，不是人和 Agent 共用完整 Chromium 的实测。Zig 语言本身不决定 Chrome 扩展兼容性；本轮资料没有证明存在完整 Chrome 扩展运行环境。TAi 不采用它作为可视浏览器内核。[固定修订 README](https://github.com/lightpanda-io/browser/blob/2bb333c63b6287f4c154134d79fc6dad55e7ecdc/README.md)

当前官方 MCP 不仅有 stdio，也有 HTTP：初始化分配 `Mcp-Session-Id`，不同会话分别持有页面和存储，共用 ID 则共享上下文。值得借鉴会话标识与生命周期；TAi 的 Space 与 Profile 必须另外表达，**协议会话不自动等于登录隔离**。不采用其任意脚本运行入口作为 TAi 默认接口。[MCP 说明](https://github.com/lightpanda-io/browser/blob/2bb333c63b6287f4c154134d79fc6dad55e7ecdc/README.md#http-transport-and-independent-sessions)

### agent-browser：小观察面与固定页面，比不断猜 CSS 更适合 Agent

CLI 经常驻进程控制浏览器。操作入口是精简可访问性快照和元素引用，也提供区域/深度/交互元素过滤。引用跟踪存活节点；导航或文档替换使相关引用失效，替换节点的恢复只允许唯一 role/name 匹配。TAi 可借鉴输出和失败语义，但未确定采用这种自动恢复：敏感或有副作用操作应优先要求重新观察。[README](https://github.com/vercel-labs/agent-browser/blob/f423bb090ccdcadd0de587dd77eed3430d93a306/README.md)、[快照与引用](https://github.com/vercel-labs/agent-browser/blob/f423bb090ccdcadd0de587dd77eed3430d93a306/docs/content/docs/snapshots.mdx)

共享一个 Chrome 的 CDP 会话仅靠目标 Tab 分开，不提供完整账号隔离。`--pin-tab` 在目标关闭时返回 `tab_gone`，而非悄悄换页；竞争中的页面返回 `tab_locked`。TAi 应保留固定 Profile/Space/Page，页面移动、关闭或撤销后明确失效，不重新解析为当前活动页。[会话与固定 Tab](https://github.com/vercel-labs/agent-browser/blob/f423bb090ccdcadd0de587dd77eed3430d93a306/docs/content/docs/sessions.mdx#sharing-a-chrome-browser)

### Browser Use：原 Agent 负责推理，TAi 负责执行与状态

当前 README 是持久 Python REPL、Browser Harness 与 CDP 架构，不能照搬旧版 BrowserSession/watchdog/event-bus 的介绍。其原 Agent 循环属于另一层产品；TAi 不接管。Browser Harness 暴露已登录浏览器的广泛 CDP 能力，不等于符合 TAi 的单 Space 授权。[当前 README](https://github.com/browser-use/browser-use/blob/693ddd2069d50b41baa3dd48335c9a2265379db8/README.md)、[Harness README](https://github.com/browser-use/browser-harness/blob/65c174a097cbcca483e967f5c4aa3a7b730b797d/README.md)

源码为不同实例使用不同 daemon 名称，检查本机通信目录的所有权，并对连接丢失/重连给出状态；REPL 重连说明要求检查页面再重试。TAi 应借鉴明确生命周期，继续使用原有受限本地 IPC，不为适配客户端而暴露整个 Profile 的调试端口。[browser.py](https://github.com/browser-use/browser-use/blob/693ddd2069d50b41baa3dd48335c9a2265379db8/browser_use/browser/browser.py)、[session.py](https://github.com/browser-use/browser-use/blob/693ddd2069d50b41baa3dd48335c9a2265379db8/browser_use/repl/session.py)

### Playwright MCP：语义优先，后台操作必须显式设计

提供结构化可访问性快照；`--background` 在扩展连接时避免激活受控 Tab/浏览器窗口，`--shared-browser-context` 是显式共享选项。说明「连上浏览器」与「不抢用户焦点」是不同能力。TAi 应分别验收后台 DOM 操作、窗口焦点、原生弹窗和用户接管，不能仅凭无头测试宣布真实并行已完成。[固定修订 README 与参数](https://github.com/microsoft/playwright-mcp/blob/8aa18a55a7fd4cde2d06d7d5156bd5866ed774f7/README.md)

## 对 TAi 的建议顺序（设计建议，尚非全部已实现）

1. **先补可靠观察。** 沿用 MCP/原有本地 IPC，提供有界语义快照与可验证引用；包含页面/文档身份、截断与加载状态。操作前检查唯一目标、可见/可操作状态，操作结果与业务成功分开；导航、DOM 替换及页面移动后不静默重定向。
2. **再补双方通信。** 固定授权连接、请求 ID、原生 Page/文档修订；区分请求已接受、操作已派发、结果已观察。断线/取消不是回滚，不能自动重放有副作用操作。使用官方 SDK 能力；仅在客户端协商支持时发通知，始终保留可按需查询的真实状态。MCP 通知也不保证外部 Agent 会自动开启新推理回合。
3. **明确人机协作。** 用户在另一 Space 时 Agent 不切换活动页、不注入系统全局输入。用户进入目标页，显示精简活动状态和接管；写入竞争优先停止 Agent，需主动恢复。原生登录/权限/文件对话框属于显式交接，不能在后台擅自切前台或绕过审批。多个 Agent 共用页面时需原生写入协调，不能只在各适配器内锁定。
4. **最后用测量决定资源策略。** 合成站点比较无 Agent/空闲连接/单任务/并发任务的 RSS、CPU、响应延迟、观察字节与往返次数；同一页面集、同一 Chromium、同一扩展与资源加载条件。优先按需快照、事件合并、无消费者时停止工作；休眠不能中断活动 Agent、音频/下载和必要网页行为。美观与动效应由本机窗口验证，不以禁用安全隔离或网站功能换基准成绩。

第一轮最小验收应是：Agent 从原对话获得目标页、读到有限可操作信息、对唯一目标操作并观察结果；用户同时在另一 Space 输入不被抢焦点；页面导航/关闭/移出授权范围、连接撤销或取消均有明确失败且不误操作。帧、shadow DOM、Canvas、文件/原生对话框应分别记录实际支持范围，不能由主文档 DOM 路径推断全部可用。

## 2026-11-12 · Lightpanda、Stedding 与 BrowserSkill

这一轮核对三个项目的官方文档、许可证和默认分支源码。结论来自阅读源码和文档，运行兼容性与 TAi 的 token 对照仍待实测。版本列记录核对当时的源码快照。

| 工程与版本 | Agent 如何接入 | 与 TAi 相关的设计 |
| --- | --- | --- |
| Lightpanda [`a34d699`](https://github.com/lightpanda-io/browser/tree/a34d6993e3517505c525f962361f1be170aa28d0) · [AGPL-3.0](https://github.com/lightpanda-io/browser/blob/a34d6993e3517505c525f962361f1be170aa28d0/LICENSE) | 独立的无头浏览器。官方提供原生 MCP、CDP 和 WebDriver。MCP 本地走 stdio，HTTP 可按会话区分或明确共享浏览上下文。 | 浏览器可返回 Markdown、裁剪过的语义树、交互元素、结构化字段和范围内的内容。它还提供根据文本布局生成的示意 PNG，真实 Chromium 像素与原生 UI 需要另行测量。 [固定版 README](https://github.com/lightpanda-io/browser/blob/a34d6993e3517505c525f962361f1be170aa28d0/README.md) · [工具说明](https://lightpanda.io/docs/reference/browser-tools) · [架构](https://lightpanda.io/docs/core-concepts/architecture-overview) |
| Stedding [`646de70`](https://github.com/ysalitrynskyi/stedding-browser/tree/646de701bff5d4b2bfcd007e3ec07a0dbe3ae8da) · [BSD-3-Clause](https://github.com/ysalitrynskyi/stedding-browser/blob/646de701bff5d4b2bfcd007e3ec07a0dbe3ae8da/LICENSE) | 在所查公开产品文档、特性目录与版本记录里未确认内置 Agent 浏览器接口。仓库的 `AGENT-LOOP.md` 讲贡献者如何开发、构建和验收 Stedding。 | 可参考 Space、用户会话、焦点和按对象提供操作的菜单。独立 Space 可单独保存站点登录，扩展、历史和密码仍由 Profile 共享。文件夹菜单以文件夹动作和条件式目标子菜单为主。 [产品 README](https://github.com/ysalitrynskyi/stedding-browser/blob/646de701bff5d4b2bfcd007e3ec07a0dbe3ae8da/README.md) · [贡献流程](https://github.com/ysalitrynskyi/stedding-browser/blob/646de701bff5d4b2bfcd007e3ec07a0dbe3ae8da/docs/AGENT-LOOP.md) · [v0.4.0-beta.17 菜单 M7](https://github.com/ysalitrynskyi/stedding-browser/blob/v0.4.0-beta.17/docs/features/menus.md#behaviours) |
| Tencent BrowserSkill [`16d8745`](https://github.com/Tencent/BrowserSkill/tree/16d87452cb1c9a320d2c4f9beca1b43dd24e7724) · [MIT](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/LICENSE) | Agent 通过 CLI 或 stdio MCP，经本地 daemon 和浏览器扩展使用已登录的浏览器。还有 DeepSeek Harness 插件。官方支持 Chrome 和 Edge，TAi 扩展兼容性待验证。 | 会话绑定选定浏览器实例，默认在后台 Agent Window 工作，用户可暂停、接管或按提示处理对话框。产品还提供任务预览、调试时间线、审计和录制。部分能力只在 CLI 或扩展中开放。 [固定版 README](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/README.md) · [MCP 功能表](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/docs/mcp.md) · [接管规则](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/skill/references/cooperation.md) |

### Token 和 Computer Use

- **减少每次返回的内容。** Lightpanda 将正文 Markdown 和交互树拆开，可单独读节点或字段。BrowserSkill 的默认工作流以 VOM 文本和元素引用表示页面，CLI 还能按树深与估算 token 预算限制输出。其估算器按 o200k 近似计算，实际账单还取决于模型、上下文、缓存和工具响应。 [Lightpanda 读取工具](https://lightpanda.io/docs/reference/browser-tools#reading-the-page) · [BrowserSkill 观察选项](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/src/cli/observe.rs) · [VOM 估算源码](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/packages/vom/src/tokens.ts)
- **减少重复观察和模型回合。** BrowserSkill 支持在文档和控制归属仍有效时复用语义引用，针对操作目标和必要事实做检查。旧观察可分段查看，保持历史只读属性。一次操作后等待目标条件并返回有界结果，可减少模型再发一轮读请求。文档替换、用户介入或证据失效时重新观察，未知结果的写操作先核实。 [控制与事实条件](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/skill/references/cooperation.md) · [动作、等待与观察缓存](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/skill/references/step-and-cache.md)
- **语义优先，视觉补足。** 普通表单、链接和列表先读语义信息。Canvas、图表、覆盖层或纯视觉定位可按需返回目标区域截图。Computer Use 用画面确认状态并操作坐标，模型用量取决于截图尺寸、模型和往返次数。BrowserSkill 为 Canvas 提供区域截图，视觉操作有单独的截图时效与目标约束。 [BrowserSkill 截图与 Canvas](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/skill/references/screenshots-and-canvas.md) · [Computer Use 状态与截图](https://developers.openai.com/api/docs/guides/tools-computer-use)

Lightpanda 公布了爬取耗时与峰值内存，也发布了特定模型、任务集及自身 Agent 循环的模型成本和任务成功率。BrowserSkill 的官方材料证实了减少输出和往返的机制。所查资料没有给出这三款与 TAi 在同一有图形浏览器任务、同一模型、同一账号条件下的 token 横评，节省比例仍待实测。 [Lightpanda 基准说明](https://lightpanda.io/docs/core-concepts/benchmarks) · [任务数据与运行配置](https://github.com/lightpanda-io/agent-benchmarks#current-results) · [BrowserSkill 的测量口径](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/crates/bsk-cli/skill/references/step-and-cache.md)

### TAi 现状与验证顺序

当前源码已有固定窗口、Profile、Space 和页面的独立授权，MCP 提供主文档交互控件的精简输出与短期引用，并可查询任务状态或订阅 MCP 状态资源。精简输出最多返回 200 个控件，省略输入值。普通 DOM 变更会使引用失效，现有覆盖范围限于主文档。可见像素、Canvas 和跨框架内容需要专项工作。安装验收脚本已覆盖两个 Space 的授权并存及分别列出各自页面。 [原生页面范围](../src/chromium/host/native_pages.cc) · [交互快照](../src/chromium/host/page_interaction.js) · [MCP 工具及状态资源](../modules/agent-tools/native-tools.mjs) · [安装验收](../tools/smoke_installed_app.mjs)

1. 先为现有 `page.read` 增加按区域、角色或字段的有界读取，明确覆盖、截断与结果有效期。记录只因无关动态内容失效的次数，再评估能否把失效细化到目标及依赖状态。
2. 再考虑单个已授权操作后附带一次有界观察，保持操作派发与结果验证分别可见。用户编辑或打开原生对话框时，通过现有暂停与接管入口交给用户。
3. 用只含合成数据的表单、动态列表和 Canvas 对比语义、视觉和混合方式。固定模型、任务、成功判据与缓存条件，报告每个成功任务的文字和图像 token、调用数、回合、成功率、延迟以及人工接管次数。把返回字节、浏览器 CPU/RSS 和实际模型用量分开。
4. 语义路径验证后，再评估单页区域截图和用户可见的操作回顾。以已有 Profile/Space 授权作为边界，截图范围限于该次授权的网页内容。
