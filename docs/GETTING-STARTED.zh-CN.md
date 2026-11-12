# 开始使用 TAi Browser

[English](GETTING-STARTED.md) · [返回 TAi](../README.zh-CN.md)

## 下载

Alpha 1 面向 Apple Silicon Mac。从 [GitHub Releases](https://github.com/EuanTop/tai-browser/releases) 下载 DMG，打开后把 **TAi Browser** 拖入「应用程序」。发行页面会列出支持的 macOS 版本，并提供 `SHA256SUMS` 用于核对下载文件。

**DMG 使用临时签名，尚未经过 Apple 公证。** 如果 macOS 因无法验证开发者而拦截首次启动，请先核对下载文件，再按 Apple 指引在「系统设置 → 隐私与安全性」中对该应用选择「仍要打开」。[Apple 安全打开应用指南](https://support.apple.com/zh-cn/102445)

## 开始浏览

当前开发版本的左侧栏用于组织文件夹、固定页面、临时标签和常用网站，通过 Space 控件切换事务。**TAi 设置**管理 Space 名称、emoji、颜色、外观、快捷键和 Agent 连接；普通浏览器选项继续使用原生设置。

macOS 下，**⌘T** 新建标签、**⌘L** 聚焦地址栏，默认 **⌘S** 切换侧栏。应用运行并保留窗口时，**⌥⌘N** 唤起全局搜索。快捷键可以在 TAi 设置中修改；系统冲突和网站优先规则见[快捷键与语言](ACCOUNTS-AND-SHORTCUTS.md)。

在 **TAi 设置 → 外观 → 界面语言**中选择「跟随系统」「简体中文」或「English」，TAi 自有界面会立即切换。Chromium 原生设置、历史记录和扩展程序页面使用 macOS 分配给 TAi 的应用语言。要把这些页面切成简体中文，请在 **macOS 系统设置 → 通用 → 语言与地区 → 应用程序**中为 **TAi Browser** 选「简体中文」，然后重启 TAi。[Apple 的按应用设置语言说明](https://support.apple.com/zh-cn/guide/mac-help/mh26684/mac)

## 连接 Agent

按照[连接指南](AGENT-CONNECTION.md)连接 ChatGPT、Claude Code、Pi 或其他 MCP 客户端，选择 Space 并验证工具请求。启用「更新或重启后自动连接」后，TAi 恢复原窗口时可以续用授权。保存了 MCP 配置不等于客户端已经连上。原 Agent 继续负责自己的对话、模型和批准流程，浏览器提供有范围的工具；右侧栏内直接续接原对话尚未交付。

## 当前边界

- 首个构建目标为 macOS Apple Silicon，其他平台安装包目前不可用。
- 浏览器账户、登录/同步及 Profile 管理入口暂时关闭，已有本地 Profile 数据和网站登录保留。同一 Profile 下的 Space 共享站点登录；同窗口跨 Profile 切换仍在开发。
- 迁移卡片可导入 Chrome 和 Safari 导出的书签，以及 Arc 收藏。密码 CSV 通过 Chromium 密码管理器导入。Cookie 和登录会话留在原浏览器。
- 触控板、物理拖放、跨 Profile 和真实 Agent 对话仍需更广验证。[验收记录](PRODUCT-ACCEPTANCE.md)区分已实现行为和实际验证范围。
- 开发版本使用手动更新，尚无独立自动更新器。

内置剪藏/资料库/阅读器与轻应用平台已退出当前浏览器路线。历史源码目录不代表仍是产品功能，独立剪藏扩展也尚未发布。

## 反馈与贡献

欢迎[提交可复现的 Issue](https://github.com/EuanTop/tai-browser/issues)，附系统、架构、TAi/源码版本、操作步骤、预期和实际结果。分享日志和截图前，去除私有网址、账户信息和连接令牌。安全问题请走[私下报告渠道](../SECURITY.md)。参与代码开发请阅读[贡献指南](../CONTRIBUTING.md)。
