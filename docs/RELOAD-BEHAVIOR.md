# 刷新按钮与网站 Cookie

TAi 复用 Chromium 原生刷新按钮。短按保持普通刷新；右键或长按打开菜单：普通刷新、忽略缓存刷新、分隔线、清除此网站 Cookie 并刷新。⌘R / ⇧⌘R 继续走上游命令，加载中的停止按钮行为保持原样。菜单不依赖开发者工具。WebUI 工具栏直接使用所属 BrowserWindowInterface；每次打开重建原生菜单 runner，避免初始化时缓存的禁用状态滞留。普通 Chromium 模式沿用原菜单。

清 Cookie 刷新先显示原生 tab-modal 确认框，展示实际站点及重新登录影响，取消为默认按钮。内部页、扩展页、文件和空标签禁用该项；仅 HTTP/HTTPS 网站可用。

## 范围与并发

- 站点为当前 URL 的可注册域名（包含 private registry 边界），IP/内网主机回退为当前主机。比如 `a.example.com` 清 `example.com` 站点及子域的 Cookie，`a.github.io` 不清其他 GitHub Pages 站点。
- 只调用发起文档实际 StoragePartition 的 CookieManager，不访问其他 Profile。一个 Profile 内共享的站点登录仍会影响其他 Space/窗口，所以确认框明确说明。
- 所有路径的普通、HttpOnly、Secure 及匹配该站点的分区 Cookie 都在范围内。不会清理浏览历史、密码、localStorage、IndexedDB、缓存或其他站点的 Cookie；此功能不叫“清除全部网站数据”。
- 请求在确认框出现前绑定 WebContents、WeakDocumentPtr 和站点，确认时再验证文档；已经导航/关闭的文档不执行。清理完成后只刷新仍匹配的原文档，不读取当前活动标签来重定向。清理请求已发送后若发生导航，不刷新新文档；已获确认的原站点清理仍可完成。
- 等待 Chromium 异步清理回调后普通刷新。网络服务断开而无完成回调时不冒充清理成功或刷新；用户可重新发起。页面可以在刷新响应中重新设置 Cookie，因此清理不等于永久禁止 Cookie。
- 没有新增 MCP、网页 JS 或通用执行命令，也不会向 Agent 提供 Cookie 读取/清除能力。

## 复用与验证入口

上游修订：`0e66b94549a8bd85f03fbdf189b752d6e7b63c32`。复用路径为 `chrome/browser/ui/views/toolbar/{reload_button,webui_reload_control}.cc`、`ui/base/models/dialog_model.h`、`components/constrained_window/constrained_window_views.h`、`services/network/public/mojom/cookie_manager.mojom` 和 `net/base/registry_controlled_domains/registry_controlled_domain.h`；版权及原 BSD/第三方许可证保留。只适配两处 UI 文件，不改变引擎或 Cookie 过滤算法。

自有逻辑在 `src/chromium/reload_menu.*`，上游适配由 `tools/native_overlay.py` 生成。现有 `tools/smoke_product.py` 在一次性 Profile 中启动回环 HTTP fixture，检查刷新、过期文档、站点及 Profile 作用域；测试 Cookie 为合成内容，不使用个人 Profile。原生菜单的右键、长按、禁用和确认/取消另需实际窗口验证，不能由类型检查代替。

## 本轮验证（2026-11-10）

34 项原生类型检查、78 项原生行为检查及原有设置/宿主/面板/首页/MCP 回归通过。新增检查使用 `tai_reload_` 前缀的合成 Cookie，逐项核对普通刷新、忽略缓存、捕获请求不删除、过期文档拒绝、全路径/HttpOnly/Secure、其他网站、独立 Profile 的 Cookie 保留，以及工具栏在网页/内部页之间的启用状态；不把 Chromium 自行产生的背景 Cookie 混入夹具总数。

本机独立测试 Profile 实际操作通过：右键/长按打开三项菜单；取消确认后 Cookie 与请求次数不变；忽略缓存刷新后 Cookie 保留；确认后自动刷新，页面显示 Cookie 已清除且 localStorage 保留；导航至 TAi 首页后菜单项禁用。真实窗口使用当前编译组件，最终安装入口另运行安装检查。没有清理或迁移用户的真实网站 Cookie，也未将测试 Cookie 等同于所有身份服务的登录验收。
