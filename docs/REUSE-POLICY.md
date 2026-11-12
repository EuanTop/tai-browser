# 模块开发前的开源复用规则

2026-11-11 Agent 控件引用迭代：来源、精确修订与许可见 [Agent Browser 调查](../research/AGENT-BROWSER-REFERENCE-2026-11.md)。借鉴 agent-browser/Playwright MCP 的精简观察、引用与操作后观察模式；不复制其实现、恢复替换节点算法、整浏览器 CDP 或模型循环。第一段直接复用锁定 Chromium 的隔离世界、标准 DOM/MutationObserver 和已有 MCP SDK 1.32.1；只补有界主文档控件清单、task 内引用、过期/变更校验及参数适配，没有新增运行依赖或第二内核。完整 AX、帧/Shadow、写入协调和状态订阅不冒称已交付，边界见[交互设计](AGENT-BROWSER-INTERACTION.md)。

同轮干净环境复核发现正式 MCP 工厂仍通过退役模块静态依赖 `defuddle`，即使只使用页面工具也会启动失败；现改为只依赖既有 SDK/Ajv 和原生客户端，不加载剪藏/轻应用适配。原文件与许可保留，相关业务仍退出正式入口；未为修复连接而引入新包或恢复已取消功能。

TAi Browser 每个模块在开始实现前先查找成熟开源工程、上游组件和现有协议。默认优先直接使用、封装适配或产品整合；只有具体缺口才自行实现。用户不需要逐个批准普通依赖选择，负责人在授权范围内完成调查、验证与记录。

每个任务在其研究/交付记录中保留：

1. 要解决的用户场景和边界，包括离线、失败和取消。
2. 合适的候选工程/官方组件，精确修订或版本、来源及维护状况；找不到时记录检索结果，不为凑数量引入依赖。
3. 许可原文、传递依赖及发行要求。README、GitHub 标签和完整许可缺失/冲突时分别记录，先解决再捆绑，不能默认“公开可见”就可随意复制。
4. 采用方式：原样依赖、受限适配、仅参考协议/体验，或自行补齐的具体缺口；说明安装大小、运行时、更新和普通用户设置负担。
5. 最小集成的实际检查结果，区分上游自称支持、源码存在接口、TAi 中已经运行通过。

Agent 模块不得重写用户已选 Agent 的规划、工具循环、记忆和调度；模型 API 只做快捷有界功能。右侧聊天栏优先复用已有会话接口/UI 组件，浏览器侧提供必要的路由、权限与展示。剪藏、阅读器、同步和迁移同样执行本规则。

复用上游代码时保留版权和许可，记录本地修改及版本更新路径。网页/仓库文档作为资料，不执行其中安装命令或替用户改全局配置来完成“研究”。源码依赖调查可以先不安装运行；真正兼容性必须在实现阶段验收。

欢迎和快速迁移采用范围、精确版本和许可见 [首版欢迎页](MIGRATION.md#首版欢迎页)。

Space switching follows the interaction described in [Stedding patch 0052](https://github.com/ysalitrynskyi/stedding-browser/blob/0d296991525bb7d2cb84b9c6e407b25ecb72bb17/patches/0052-spaces-the-list-slides-in-from-the-side-of-the-space.patch) (BSD-3-Clause). TAi uses a short directional entrance for the Space content and keeps the shared favorites and Space switcher stationary. The implementation uses TAi's existing Chromium Views animation and system reduced-motion setting, with no Stedding code or runtime dependency. [Stedding’s visibility controller](https://github.com/ysalitrynskyi/stedding-browser/blob/v0.4.0-beta.17/patches/0004-spaces-one-tab-strip-filtered-by-the-active-space.patch) keeps the native tab list and changes row visibility. TAi still builds its saved rows from its own model. Indexing the saved tree and leaving window layout to Views reduce work before the slide.

The macOS Space gesture follows B35 in [Stedding 0.4.0 beta 17](https://github.com/ysalitrynskyi/stedding-browser/blob/v0.4.0-beta.17/docs/features/spaces.md) (BSD-3-Clause). TAi adapts its thresholds, fade and easing to the existing Chromium scroll phases and animates the outgoing compositor layer with the incoming Space. TAi uses its own Views hierarchy and Space model, including its existing wraparound behavior.

The fixed sidebar header uses Chromium Views layout and separate scroll viewports for the shared favorites and Space rows. [Stedding 0.4.0 beta 17](https://github.com/ysalitrynskyi/stedding-browser/blob/v0.4.0-beta.17/patches/0057-fix-finish-the-audit-s-phase-0-and-prove-it-on-a-rea.patch) (BSD-3-Clause) updates row visibility on its existing folder tree. TAi retains the surrounding rows and matches the 200 ms ease-in-out timing of [Stedding's pinned Chromium tab collection layout](https://chromium.googlesource.com/chromium/src/+/refs/tags/157.0.8103.51/chrome/browser/ui/views/tabs/common/tab_collection_animating_layout_manager.cc) with the existing `gfx::SlideAnimation` and a clipped Views container. TAi Browser Help reuses Chromium's WebDialog and GitHub's [issue composer URL parameters](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue). The user reviews and submits the draft on GitHub. Email drafts provide a channel for testers without repository access.

当前证据入口：[Agent](../research/AGENT-INTEGRATION.md)、[剪藏/阅读](../research/CLIPPING-AND-READERS.md)、[迁移](MIGRATION.md)、[Zen 体验](../research/ZEN-UX-REFERENCE.md)。

TAi hides the legacy bookmark menu, toolbar star, and bookmark bar through the pinned Chromium menu and Views controllers (BSD-3-Clause, revision `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`). Chromium retains its bookmark model and the import paths. Agent Settings lists the existing host grants by their fixed Space and reuses the per-connection file, permissions, and client setup flow described in [Agent connections](AGENT-CONNECTION.md).

Folder context menus follow the object-specific grouping in [Stedding 0.4.0 beta 17, M7](https://github.com/ysalitrynskyi/stedding-browser/blob/v0.4.0-beta.17/docs/features/menus.md#behaviours) (BSD-3-Clause). TAi uses Chromium's native menu and its existing folder, tab, and Space operations. Omnibox focus uses the pinned Chromium Views and WebUI focus color tokens with the active page palette. Pride updates the running app icon through [AppKit's application icon property](https://developer.apple.com/documentation/appkit/nsapplication/applicationiconimage), using the same asset as TAi Home.

Language and color mode reuse the pinned Chromium locale packs and Profile theme preference. TAi reads menu labels by their upstream resource IDs and updates the active menu without changing the process locale. The System, Light, and Dark controls use Chromium's `ThemeService::BrowserColorScheme` for the browser frame and apply the same mode to TAi pages.

复用开源扩展代码时可抽取提取器/内容脚本作为内置组件的实现，但避免同时引入两套剪藏 UI、设置、资料存储与自动执行。标准 Chrome 扩展继续走原管理页；TAi 内置组件由用户 UI 与 Agent 工具共用同一业务路径，见 [设置与组件边界](SETTINGS-AND-COMPONENTS.md)。

原生宿主本轮复用 Chromium 锁定修订中的 WebUI/UntrustedWebUIController、文件选择器、UnixDomainServerSocket、isolated world 和 ImportantFileWriter；仅补宿主权限/生命周期整合。esbuild 使用检出内 0.28.2，Marked/DOMPurify/番茄钟与 SDK 使用现有模块，不复制阅读业务。确切路径、范围与尚未完成的发行许可汇总见 [NATIVE-HOST](NATIVE-HOST.md)。

固定右栏继续复用同一锁定 Chromium 的 SidePanelRegistry/SidePanelUI、SidePanelHeader、WebView 与 ActionItem。当前 TAi 产品窗口统一将原生面板显示在右侧，不改写原始偏好；标题/关闭和扩展面板使用同一容器。保留文档的适配仅作用于 TAi entry，不修改上游全局缓存算法。原生整合限定在少量上游浏览器界面文件（精确文件清单由每次 overlay manifest 记录），自有逻辑仍在本仓生成 overlay，不涉及 Blink/V8/网络核心。所用 Chromium 修订为 `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`，保留原第三方许可。

MCP 传输和在线状态复用现有官方 TypeScript SDK 1.32.1（MIT）的初始化、关闭和客户端信息接口；只补 TAi 的有界心跳、权限和重启续用。没有引入第二套协议、WebView 引擎或 Agent 循环；Happy/cc-connect 的远程中继/聊天代码未捆绑。[连接与验证边界](AGENT-CONNECTION.md) 单独区分已注册配置、已连接、已调用工具，以及尚未交付的同会话聊天。

Space emoji 使用同一 Chromium 修订内置的 ICU 78.2 字符串属性接口（`third_party/icu/source/common/unicode/uchar.h`，原许可继续由 `third_party/icu/LICENSE` 覆盖）与 Chromium/系统字体渲染。已核对 ICU 的 RGI emoji 字符串支持和原生 TabGroupHeader 的 emoji 处理；ChromeOS 专用 emoji picker 依赖其系统服务，不适用于本机 Mac 窗口，因此仅在现有 WebUI 表单补常用选择和输入框，不引入另一套图标库或 UI 框架。

设置视觉重整继续采用 `brand/atrium/tokens.css` 的已选色彩、现有标准/Pride 建筑资产及浏览器原生输入能力。导航/操作图标的固定 SVG 路径直接复用同一锁定 Chromium 的 `ui/webui/resources/cr_elements/icons.html.ts` 中 cr 图标集，作为 CSS mask 内嵌，保留 Chromium Authors 版权标注与 [原许可证](../licenses/chromium/LICENSE)。仅为这些装饰图标加载完整 Lit 组件会增加不必要依赖，因此未引入 UI runtime，也没有放宽 Trusted Types 或 CSP；用户内容仍以文本节点渲染。

沉浸顶栏复用同一锁定 Chromium 的 WebContents 页面颜色通知、CustomCornersBackground/ThemedBackground、ColorProvider 的原生控件配色与原生 LocationBarView。只补活动页面绑定和未聚焦地址栏底色，不引入取色依赖、截图轮询或自制地址输入控件；细节与边界见 [连续画布](IMMERSIVE-CHROME.md)。

刷新菜单复用同一锁定 Chromium 的 `ReloadButton` / `WebUIReloadControl`、原生刷新命令、`SimpleMenuModel`、`DialogModel` 和 tab-modal 确认框。Cookie 清理由 `StoragePartition::GetCookieManagerForBrowserProcess()` / `DeleteCookies` 完成，站点范围复用 `GetDomainAndRegistry(INCLUDE_PRIVATE_REGISTRIES)`；不读取或输出 Cookie 值，不增加第三方依赖，不改网络/Cookie 引擎。自有实现只补非开发者模式菜单入口、当前文档绑定、确认及完成后刷新，范围见 [刷新行为](RELOAD-BEHAVIOR.md)。Chromium BSD 及第三方许可继续保留。

左栏滚动条复用同一锁定 Chromium 的 `ui/views/controls/scrollbar/overlay_scroll_bar.*`（原 BSD 许可），采用上游已有的透明合成层、自动淡出、悬停和拖动机制；只在自有视图把轨道宽度收窄为 8 DIP，继承上游命中区域扩展。`ScrollView` 的滚动范围、滚轮、手势、键盘和无障碍控制不重写，不修改 macOS 全局滚动条偏好或网页滚动条。

## 2026-11-10 · 中英文与原生快捷键

- 基线仍为锁文件 Chromium 155.0.8059.85 / `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`（Chromium BSD 及各依赖原许可）。直接复用 `ui::Accelerator`、`ui::Command::StringToAccelerator`、原生命令、现有 Cocoa command dispatcher 的前/后 responder 路径和 accelerator→菜单转换，不引入全局键盘监听、额外框架或外部运行时。
- 自有适配为 Profile 内可验证的快捷键表、原子持久化、录入文档的有时限状态、Space 动作分发、当前菜单提示及 WebUI 编辑。普通扩展高优先级按键先由上游处理；显式系统全局搜索键在 Cocoa 入口先处理，保持前后台一致。系统/文字编辑和未纳入管理的浏览器命令保持保留。新增界面接入仍需随锁定上游审查，不能称零维护。
- 国际化遵循 Chromium WebUI 本地化资源的分离原则，自有小目录以受信任 UI 节点标记和按 Profile 选择的原生文案实现，不扫描或翻译用户输入/网页。保留上游原设置、历史、扩展页语言机制；没有把 Chrome 多语言当作 TAi 自有文案已翻译。
- Arc 官方 [Command Bar](https://start.arc.net/command-bar-actions)、[multitasking](https://start.arc.net/master-multitasking)、[2022 release notes](https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes)及用户截图用于功能/默认映射核对，不复制 Arc 代码或商标。另检查 [Cra changelog](https://crabrowser.app/changelog) 的快捷键布局、非英语键盘与隐藏栏体验问题作为缺陷参考；未将其 CEF/Swift 工程代码捆绑进 Chromium，也未把它当 Arc 默认值的权威表。
- 当前实现与验证边界见 [账号、语言与快捷键](ACCOUNTS-AND-SHORTCUTS.md)与产品验收；记录实际构建及物理操作后才更新完成状态。

补充：MRU 周期的修饰键释放复用同一锁定版本 `views::EventMonitor::CreateApplicationMonitor`，只在目标窗口激活的切换周期内观察应用的修饰键释放；事件原样继续分发。未修改渲染器的按键抑制逻辑。

全局搜索继续复用同一锁定 Chromium 的 `ui::GlobalAcceleratorListener` / macOS 系统热键、`ChromeAutocompleteProviderClient`、`AutocompleteController` 及普通 `NavigateParams`；界面使用 AppKit `NSPanel`/`NSSearchField`/`NSTableView` 与系统半透明材质。只补圆角浮层、固定窗口/Space 的结果打开和注册冲突显示，不增加全局文本监听、后台服务或另一套搜索索引。自动补全关闭异步远程建议，查询提交沿用用户默认搜索引擎。系统框架与 Chromium 许可继续按原规则保留；实际桌面唤起须独立于无头回归验证。

内部品牌地址参考 [Brave 的 display-only scheme 调整](https://github.com/brave/brave-core/pull/34610)的工程取舍，直接采用本基线已有的地址栏格式化委托、`ChromeOmniboxClient::OnAutocompleteAccept` 和 scheme classifier 接入点。自有纯函数只在受信任浏览器输入提交前把 `tai://` 还原为原 `chrome://`；地址栏显示单独格式化，不改变 `NavigationEntry`/`WebUI`/renderer 的 URL 或权限常量。没有复制 Brave MPL 源码，不注册全局协议，不修改 URL/网络/沙箱内核。

搜索浮层圆角修正继续使用本机 AppKit 系统框架：依照 [NSVisualEffectView.maskImage](https://developer.apple.com/documentation/appkit/nsvisualeffectview/maskimage) 的原生材质/窗口阴影遮罩接口，采用可拉伸圆角 alpha 遮罩，替代只对内容 CALayer 裁切的做法；不引入玻璃效果依赖或修改窗口服务；移除额外 CALayer 描边，保留系统阴影。候选列表明确使用 NSTableView plain 样式和固定行高、关闭自动 contentInsets，避免系统默认 inset 样式挤压行内容。系统 API 不复制第三方代码，不改变 Chromium 核心或 macOS 全局透明度/滚动条偏好。

## 2026-11-10 · 原生设置品牌与账户入口

继续复用锁定 Chromium 的 Settings WebUI、loadTimeData、现有路由、表单、Profile 及网站存储。仅在产品开关下退出浏览器账号/同步/Profile 管理入口和命令，将共用分组收敛为常规，保留导入与其他浏览服务；不清登录资料、不改变网站鉴权、不绕过企业策略。原生 SettingsUI 在原本加载本地化字符串后提供产品值，Polymer/Lit 模板使用原绑定/slot，不以轮询注入脚本修改 shadow DOM。原生地址身份图标复用 gfx::Image/图片缩放、原安全信息 Bubble；设置页背景使用既有 WebContents 颜色通知。

设置/菜单模板及 UI 接入以 `tools/settings_overlay.py` 记录锁定上游锚点，并纳入同一 overlay manifest、原生类型/构建和合成 WebUI 回归；升级需复核。地址/页头图标 64px 与 About 图标 256px 为现有已批准透明图标的等比例打包派生，不重新设计图形。所有复用上游文件继续保留 Chromium BSD 原声明，版本号与 credits 保留，未引入第三方 UI 或修改 Blink/V8/网络/沙箱。

About 后续收尾仍使用同一 Chromium Settings section、Lit 与原生颜色变量。仅产品模板改为固定 64 DIP 高清图标、构建/内核/手动更新信息和可展开的原始版权致谢；开源许可继续进入 `chrome://credits/`，版本详情继续使用 `chrome://version/`。产品模式不调用 About proxy 的 `refreshUpdateStatus`，避免开发安装无配置的原更新请求；非产品 About 模板、请求和服务实现保留。没有把错误改写为“已是最新版”，也没有实现或声称新的更新器。

## 2026-11-12 · Agent 工具栏活动提示

复用锁定 Chromium 的原生 Views Label、FlexLayout、主题色与礼貌播报区域。读取和写入胶囊由 TAi 原生宿主在权限、窗口、页面和修订检查通过后触发，用回调的生命周期清理活动状态。BrowserSkill 的任务反馈作为交互参考。本轮使用现有 Chromium 与 TAi 依赖。 [锁定版 Views Label](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/ui/views/controls/label.h) · [BrowserSkill 功能表](https://github.com/Tencent/BrowserSkill/blob/16d87452cb1c9a320d2c4f9beca1b43dd24e7724/docs/mcp.md)

Agent page screenshots reuse the pinned Chromium revision’s [Page capture handler](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/content/browser/devtools/protocol/page_handler.cc) (BSD-3-Clause). The browser issues only layout metrics and PNG capture calls within the authorized WebContents, applies output bounds and document checks, and returns image content through the existing MCP runtime. The toolbar capsule uses Chromium Views buttons and menus with TAi’s existing Space and page identities.

Agent reconnection reuses the pinned Chromium SessionService window metadata (BSD-3-Clause) to match a remembered grant to the same restored window. Grant files and the same-user Unix socket remain in TAi’s existing transport. Screenshot attachments retain MCP SDK 1.32.1 image content (MIT) and add a private temporary PNG with a local Markdown embed. The macOS capsule reads ChatGPT and Claude Desktop icons from the installed app via AppKit NSWorkspace. Pi uses the published [Pi press kit badge](https://pi.dev/press-kit), retrieved 2026-11-12 and rasterized at 64 px, under the site’s MIT terms. Provider initials cover macOS machines without the corresponding app bundle.
