# Agent 接入与轻量模型调用

更新：2026-10-18。产品边界：TAi Browser 负责浏览器功能、页面/Space 控制和连接体验；复杂任务的规划、工具循环、记忆与调度沿用用户连接的 Agent。以下仓库与文档已作源码/接口调查，尚未运行渠道兼容测试或引入生产依赖。

## 三个入口与两条通信方向

| 用户入口 | 用途 | 执行方 |
| --- | --- | --- |
| 快捷模型功能 | Tab 短标题、分类建议等短请求 | 用户单独配置的 API/本地模型；只做有界请求和结构校验 |
| 原来的 Agent 对话 | “给 TAi 加番茄钟”“明早整理资料”等复杂任务 | 用户原有 Codex / Claude Code / Pi / Hermes 等，连接 TAi 工具；继续使用它自己的逻辑 |
| 固定右侧对话栏 | 在浏览器内查看/续接已连接渠道的会话 | 同一渠道的会话客户端；不替用户换一个 Agent，也不要求使用此入口 |

Agent → TAi：产品提供按任务 Profile/Space 路由的 MCP/浏览器控制、剪藏和前端模块预览工具。TAi → Agent：使用渠道已有的会话协议/桥接发送消息、接收事件、转交批准与取消。MCP 本身不自动解决后一个方向；模型 API Key 也不自动提供现成 Agent 的会话、记忆或调度。

截图是固定右侧面板的布局参考。计划让其跨网页保持打开，支持收起、调整宽度、选择渠道/会话，显示任务绑定 Space；聊天流、工具状态和批准请求来自后端 Agent。网页内容默认不自动附加，用户或获准工具按需提供上下文。

## 候选工程及复用位置

| 工程与调查修订 | 可复用能力 | 处理方向 |
| --- | --- | --- |
| [chenhg5/cc-connect](https://github.com/chenhg5/cc-connect/blob/2dec7173bdd44ec598c3c7e5c7ff00407acfdedf/core/interfaces.go) `2dec7173bdd44ec598c3c7e5c7ff00407acfdedf` | Go；多 Agent/消息渠道桥接、会话列表/恢复、Web 配置与聊天 | 优先评估复用桥接/适配边界；README 声明 MIT，但本次完整树未找到 LICENSE/COPYING，GitHub license 为 null。正式捆绑前补齐明确许可材料。 |
| [slopus/happy](https://github.com/slopus/happy/blob/84effee51bdaa0b069d1e871e570f7fb7aeed1da/docs/cli-architecture.md) `84effee51bdaa0b069d1e871e570f7fb7aeed1da` | TypeScript；原始 CLI 包装、会话同步、加密中继、远端交互 | MIT；原始 CLI 与新的 Happy Harness 分开评估，不引入另一套规划器作为用户已连接 Agent 的替身。 |
| [earendil-works/pi](https://github.com/earendil-works/pi/blob/482c1381a00d8d00bc81697e4a980c593db6803e/packages/coding-agent/docs/rpc.md) `482c1381a00d8d00bc81697e4a980c593db6803e` | TypeScript；Pi RPC/SDK 与独立多供应商模型层 | MIT；badlogic/pi-mono 已重定向到该仓库。RPC 供 Pi 会话接入；pi-ai 供短请求，不引入 agent-core 来重新实现规划循环。 |
| [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent/blob/bb834a2cb329b27d67958036039d3e4fe9749a54/website/docs/user-guide/features/cron.md) `bb834a2cb329b27d67958036039d3e4fe9749a54` | Python；现成 Agent、ACP 入口、API server、定时与事件触发能力 | MIT；用户选 Hermes 时复用其运行、记忆和调度。API 的对话状态/恢复和 ACP 的能力须分别验证。 |

cc-connect 的 README 对 Pi 有不准确的括注；本次检查 `agent/pi/pi.go` 与 `session.go` 确认使用 `pi --mode rpc/json`，因此以实际 CLI/协议版本为准。调查到可用接口，不表示所有当前版本已经彼此兼容。

Happy 当前仓库区分原始 CLI 与 Happy Agent/Harness，不能把“使用同一家模型/同一订阅”当成“沿用同一个 Agent”。本项目重点采用会话包装、连接、事件显示和接管经验；不默认接管用户的规划器或增加中继账号。只有用户选择现有远程渠道时才需要相应服务配置。

## 接入顺序

1. **Codex：** 优先验证[官方 App Server](https://developers.openai.com/codex/app-server)的会话、流式事件、暂停/批准能力，结合 cc-connect 的 appserver_session 和 Happy 原始 CLI 作实现对照。先在原入口通过 TAi MCP 完成前端小应用，再验证右侧栏续接。支持版本和进程/会话所有权必须实测。
2. **Claude Code：** 使用[官方 Agent SDK/CLI 接口](https://code.claude.com/docs/en/agent-sdk/overview)及成熟桥接；SDK 本身运行 Claude Code 的能力，不自写工具循环。核对会话恢复、项目配置/Skills/工具加载及批准响应，不以同模型调用冒充 Claude Code 会话。
3. **Pi：** 复用[长驻 RPC / 官方客户端](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/rpc.md)，固定所支持的命令与扩展 UI 能力；工作目录、用户扩展及会话身份保持可追踪。
4. **Hermes / 其他：** 先探测已有 ACP/API/渠道桥接的实际能力。支持 ACP 的 Agent 可优先评估标准客户端与现有库；[ACP](https://agentclientprotocol.com/get-started/introduction)面向 Agent 与客户端，不替代浏览器侧的工具权限控制。

这些是原型优先次序，正式捆绑版本在许可和兼容测试后锁定。TAi 只安装自己需要的桥接运行组件；用户所选 Agent 仍须可用并完成其自身授权。已安装渠道尽量复用，不要求用户为了 TAi 重装整套 Agent，也不能承诺没有运行后端时仅填名字就能使用。

## 会话一致性是单独验收项

记录 channel ID、provider session/thread ID、运行位置和 TAi task/Profile/Space ID，不复制第二套“看起来相同”的聊天历史。恢复历史不自动等于附着正在运行的终端/桌面会话；某些接口会启动新进程，能否同写和同步须实测。

- 能共享同一运行会话的渠道：验证原入口 → 右侧栏 → 原入口能看到前文及同一工具结果，消息/批准/中止不重复执行。
- 只能恢复的渠道：明确显示接管/恢复状态，同一时刻保留一个执行入口；不让两个进程同时写同一会话。
- 无可靠会话接口时：保留原入口 + TAi MCP 的完整工作路径，右侧栏显示能力限制；不能偷偷新开不同 Agent 代替。
- 用户在其他 Space 操作时任务不漂移；右侧面板的会话选择也不自动改绑正在执行的任务 Space。

## 快捷 API 层

优先评估 Pi 的独立[pi-ai 模型层](https://github.com/earendil-works/pi/blob/main/packages/ai/README.md)，固定版本、只引入需要的供应商能力，替代从零编写每家 HTTP/流式适配。API 设置使用用户明确选择的 endpoint/model/credential，密钥保存在宿主安全存储，不进入网页或生成的小应用，不自动扫描复制其他 Agent 的认证文件。

Tab 标题/分类等使用本地信息优先、最少必要输入、有界调用、输出 schema、超时取消和撤销。API 失败保留原状态；用户自定义名称不自动覆盖。此层不运行长任务、定时任务和自主编程循环。Agent 的登录/订阅与快捷 API 的凭据分别显示，不能假定它们可互换。

## 调度与创作的责任

在原 Agent 里创建任务和修改轻应用；TAi 提供事件、可读资料、模块 manifest/预览/应用/回滚工具。定时器由支持该能力的 Agent/既有渠道托管，如 Hermes 的 cron、cc-connect 的现成定时机制；TAi 保留投递队列、确认记录及任务链接，不自写通用 cron/规划器。

仅能对话的渠道不能自动获得调度能力；其能力缺失时在入口显示尚不支持，允许用户选择有该能力的连接。后台运行、休眠与 TAi 关闭后的行为按具体执行端说明；不能由“已连接 Codex”推导出所有 Codex 入口都存在可调用的定时接口。

首个创作验收：在原 Codex/Claude Code/Pi 对话提出番茄钟 → Agent 调用 TAi 模块工具 → 浏览器隔离预览 → 应用/修改/回滚；用户无需 C++ 编译，也无需到 TAi 重述需求。右侧栏是同一工作流的可选入口。

## 开始实现前的检查

按 [复用规则](../docs/REUSE-POLICY.md)留下候选、精确版本、许可、直接采用/适配边界、失败验收。先验证一个渠道及双向闭环，再扩大支持列表。本文没有启用任何本机 Agent 服务、修改现有认证、创建定时任务或导入个人数据。
