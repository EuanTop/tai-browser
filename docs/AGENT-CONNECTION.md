# 在 Agent 中使用 TAi

MCP 连接只提供授权范围内的浏览器工具。控件引用与操作结果见[浏览器交互与通信](AGENT-BROWSER-INTERACTION.md)。使用 `format:interactive` 获取页面状态，再用返回的 `snapshotId/ref` 操作。引用失效时先重读页面。

TAi 右栏和「设置 → Agent 连接」共用连接向导。在「新建连接」中选择 Space 和 ChatGPT、Claude Code、Pi 或其他 MCP 客户端，再选择「授权」。默认只允许阅读该 Space 的网页，额外权限由用户选择。设置页同时列出当前 Profile 的所有授权，包括 Agent、Space 和权限。可为不同 Space 创建独立连接。

生成后，对应的授权行显示接入说明和复制命令按钮，可展开查看命令。

- **ChatGPT**：用 Codex CLI 命令新增一个命名独立的 MCP 配置，再在 ChatGPT 中重新加载 MCP。Codex CLI 可用 `/mcp` 查看工具。
- **Claude Code**：在原项目目录中运行命令，采用 local scope，再在 `/mcp` 中连接。
- **Pi**：以扩展方式启动，已有会话通过 Pi 自身的 `/resume` 选择。使用 Pi 原来的模型、工具循环和批准流程。
- **其他 MCP 客户端**：复制生成的 JSON，合并到所选客户端配置中。

命令不会由浏览器偷偷执行，也不自动改写个人 Agent 配置或读取认证文件。它只引用私有连接文件的路径，不包含文件内的授权令牌。连接固定 Profile 与 Space，切换右栏 Space 不会改绑已有连接。当前 main 只有 open 使用创建窗口；枚举/读写仍涵盖同 Profile、同 Space 的其他窗口，不能宣称已固定窗口。统一窗口校验在候选分支实现，仍需原生验收。

在原 Agent 中发送「请调用 tai_page_list，列出 TAi 中授权 Space 的网页」。客户端完成 MCP 初始化后，TAi 显示「已连接」；通过授权检查的页面工具请求另显示「工具已使用」。添加配置、客户端连接和工具调用是三个不同状态。客户端断开或心跳过期后，在线状态会清除；客户端名称为协议自报信息，不是身份认证。可在向导中检查状态或撤销授权。

默认授权在浏览器退出后到期。勾选「更新或重启后自动连接」，或在旧连接上选择「重新授权并记住」，会记住同一个 Profile、Space、原窗口和权限。只在 Chromium 恢复原窗口时自动连接，已经暂停的连接仍暂停。旧连接首次启用时复用原来的配置文件路径并轮换令牌，客户端需要重新加载一次。之后自动连接会复用令牌，已运行的 MCP 适配器会读取新的本机连接地址。撤销会删除对应连接文件并停止访问。

截取网页需要单独授权。截图工具同时返回 MCP 图像和一份私有临时 PNG 附件。Agent 可把返回的 `attachmentMarkdown` 放在回复里显示截图。

ChatGPT 桌面端和 Codex CLI 是不同的入口，不能将 CLI 的「已添加」当作桌面会话已经加载。相同 Codex host 使用其共享配置；桌面端可在 Settings → MCP servers 保存并重启连接，具体入口随版本不同。TAi 不通过扫描个人配置来伪造在线状态。[官方桌面端 MCP 说明](https://learn.chatgpt.com/docs/extend/mcp?surface=app)。

**右栏直接续接 Agent 聊天尚未接通。** 当前提供的路径是原 Agent 对话 → TAi 工具；不能将工具授权称为同会话聊天、后台调度或模型 API 配置完成。

## 复用与验证边界

Codex 配置遵循[官方 MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，Claude Code 遵循[官方 MCP 文档](https://code.claude.com/docs/en/mcp)。Pi 适配使用[官方扩展 API](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/extensions.md)注册工具；没有复制其 Agent 实现或认证逻辑。

现有 MCP SDK 1.32.1（MIT）同时承担 stdio 协议和 Pi 扩展内部的内存传输；Pi 工具通过同一套工具描述、schema 校验、权限和 native client 路由，避免再维护一套浏览器工具。没有新增运行依赖。

连接状态直接复用 SDK 的初始化、关闭和客户端信息接口；增加限时心跳，仅同步连接生命周期。没有复制 Happy/cc-connect 的远程中继或 Agent 会话实现，也不宣称已经提供它们的聊天功能。原生右栏复用当前固定版本 Chromium 的 SidePanelRegistry、SidePanelHeader 和扩展面板容器；TAi 与扩展共用一个面板及关闭入口。

自动检查覆盖实际 Chromium 的向导、三种渠道命令生成、首次工具请求状态、权限与 Space 固定、Pi 注册/调用与非法参数拒绝；另通过本机 Pi 0.85.1 的真实扩展加载器与 RPC 指令调用合成浏览器工具，未触发模型推理。渠道 CLI 的文档和本机帮助已核对；不等于已经使用个人账号完成实际模型对话。测试不调用收费推理、不写个人渠道配置、不读取个人会话和认证。
