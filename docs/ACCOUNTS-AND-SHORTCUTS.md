# 账号、语言与快捷键

本轮依据 Chromium 155.0.8059.85（锁文件修订）、Arc 官方帮助与用户提供的 macOS 快捷键截图核对。设置页和底层按键必须一致；配置保存并不等于物理键盘验收。

## 本地 Profile 与 Google 账号

保留 Chromium 的真实本地 Profile：它负责 Cookie、网站账号、密码及扩展等浏览环境隔离。Space 是同一环境里的组织，不能替代 Profile。上游 Your Chromium / Add Chromium Profile 原为本地环境菜单，不证明 Chrome Sync 可以使用。根据用户 2026-11-10 的新决定，TAi 暂时关闭原生浏览器账号入口：右上角头像、账户/同步/Profile 管理界面及其产品命令退出；现有本地 Profile、Cookie、密码与扩展数据保留，网站自身登录不受此 UI 开关影响。

TAi 不把 Google 浏览器登录或 Chrome Sync 作为产品账号系统，也不新增 TAi 云账号服务。网页里的 Google 登录与浏览器同步不同，正常的网站鉴权继续按 Chromium 执行。本轮不删除 Profile、密码、扩展。原设置页仅做有产品开关的界面接入：账户分组收敛为“常规”，保留导入和非账户服务，其他设置继续使用上游实现。

依据 [Chromium 官方 API Keys](https://new.chromium.org/developers/how-tos/api-keys/)及 [私有 API 限制公告](https://blog.chromium.org/2021/01/limiting-private-api-availability-in.html)：第三方 Chromium 浏览器不能据自建 API Key 就声称获得 Chrome Sync 权限；不可复制其他浏览器的私有访问配置。TAi 不提供这类绕过方案。官方说明也指出，第三方 Chromium 中默认 `chrome.identity.getAuthToken` 不能使用 Chrome 私有接口；能安装 Chrome 商店扩展不代表所有 Google 私有鉴权能力等同于 Chrome。TAi 暂时移除浏览器账号菜单；自有设置明确使用“本地账号环境”一词，不能将仍保留的 Profile 数据解释为已提供账号管理入口。

## 界面语言

TAi 自有设置、首页、Agent 授权面板和侧栏/菜单文案支持 `en`、`zh-CN`。默认「跟随系统」，根据 Chromium 当前应用语言选择。也可以在 TAi 设置 → 外观 → 界面语言指定英文或简体中文，按 Profile 保存，立即生效。现有 Space、收藏、网页标题及用户输入不会被翻译或重命名。

Chromium 原生设置、历史、扩展管理等页面在启动时根据 macOS 为该应用选择的语言加载资源。可在 macOS「系统设置 → 通用 → 语言与地区 → 应用程序」为 TAi 指定语言，重启后生效。中英文与独立偏好的验证矩阵见[开源前核对](OPEN-SOURCE-REVIEW.md#interface-language-check)。TAi 语言选择不更改网站语言、`Accept-Language`、网页内容或操作系统语言。历史退出的组件页面不纳入当前产品国际化承诺。

## macOS 菜单与导入

TAi 应用菜单集中关于、设置和跨浏览器导入。清除浏览数据放在历史记录，查看菜单提供侧栏显隐。Spaces 菜单列出当前窗口所属 Profile 的 Spaces，并标记当前 Space，选择时使用侧栏原有的切换和新建逻辑。打开「当前 Space 的菜单图标」可为它选择单色 macOS 图标。每个 Space 分别保存选择，新建和旧有 Space 默认显示名称。

应用菜单和两处设置入口复用同一张 TAi 迁移卡片，直接显示 Chrome、Arc 和 Safari。首次启动继续从欢迎卡片进入。选择 Safari 直导或密码 CSV 时，复用对应的 Chromium 导入页面。

菜单继续复用锁定 Chromium 修订 `0e66b94549a8bd85f03fbdf189b752d6e7b63c32` 的 macOS 菜单构建、HistoryMenuBridge、命令验证、AppKit 系统动作及原生设置 WebUI，保留 Chromium BSD 许可。Spaces 菜单按活跃窗口加载，应用层新增入口通过产品模式启用。

## 快捷键模型与实现

复用 Chromium `ui::Accelerator`、`ui::Command::StringToAccelerator`、原生命令、Mac 既有 responder 分发和菜单等价键机制。普通快捷键不使用系统范围的原始按键监听，也不另建浏览器命令系统；全局搜索单独复用上游系统热键注册，见下节。最近使用次序按真实标签选择事件维护，仅保存当前窗口仍打开的 TabHandle；WebContents 可见时间只作初始回退，避免布局刷新改变访问顺序。切换周期复用 Chromium 的仅在目标窗口激活期间存在的 EventMonitor，解决跨渲染器后 KeyUp 可能被抑制的问题；释放、窗口失活或销毁即移除，不消费原始事件。配置在同一 Profile 的 `SidebarWorkspace.json` 中，与组织模型一起原子保存；不读取 Codex 或其他应用的配置。

快捷键设置提供搜索、录入、取消绑定、单项/全部恢复默认和网站/浏览器优先。修改时校验整个有效表及别名，拒绝重复绑定、保留系统/文字编辑键和未纳入管理的浏览器命令。修改或取消绑定后，旧默认键不会误触发另一个原生操作。网页优先在页面未处理时才执行浏览器动作。扩展已有的高优先级快捷键沿用 Chromium 的优先级；显式系统级全局搜索键是例外，在 TAi 前台同样优先于原生分屏及局部扩展键，避免前后台动作不同。

录入只对当前受信任设置文档生效，有限时且导航后失效；不能关闭其他窗口快捷键。后端再次校验修订与真实 Profile，错误不能部分保存。

| 已有操作 | macOS 默认 |
| --- | --- |
| 显示/隐藏侧栏 | ⌘S |
| TAi 设置 | ⌘, |
| 全局搜索浮层（macOS） | ⌥⌘N |
| 最近使用的标签；反向切换 | ⌃Tab；⌃⇧Tab |
| 搜索/输入网址；新标签 | ⌘L；⌘T |
| 关闭；恢复最近关闭标签 | ⌘W；⇧⌘T |
| 当前 Space 可见页条目第 1–8 个；最后一个 | ⌘1–8；⌘9 |
| 前往第 1–9 个 Space | ⌃1–9 |
| 复制 URL；Markdown 链接 | ⇧⌘C；⌥⇧⌘C |
| 清理当前 Space 临时标签 | ⇧⌘K |
| 普通；忽略缓存刷新 | ⌘R；⇧⌘R |
| 历史；下载 | ⌘Y；⇧⌘J |
| 开发者工具；网页源代码 | ⌥⌘I / F12；⌥⌘U |
| 网页另存为 | ⇧⌘S（TAi 选择，为侧栏释放 ⌘S） |

其余当前支持的查找、缩放、窗口、收藏和顺序切换动作以设置页有效表为准。未实现的 Arc Library、Easel、Split View 不放占位快捷键；TAi 的关闭/恢复不冒称 Arc 的归档体系。Arc ⌘T 打开全功能 Command Bar；TAi 当前保留原生新标签和地址栏输入，不宣称同等命令栏。

用户截图中的 `⌥⌘Y` 出现在 **Customized Shortcuts**，不是默认恢复键。此前 TAi 沿用的 `⇧⌘L` 是上游折叠绑定，与 Arc Library 冲突，本轮退出该绑定。Arc 原生帮助也明确 `⌃Tab` 按最近使用次序切换；TAi 将其与按侧栏顺序切换的替代绑定区分。

主要依据：[Arc Command Bar actions](https://start.arc.net/command-bar-actions)、[Arc multitasking / Ctrl-Tab / custom shortcuts](https://start.arc.net/master-multitasking)、[Arc 2022 remapping and ⌘9 options](https://resources.arc.net/hc/en-us/articles/20498417809815-Arc-for-macOS-2022-Release-Notes)。截图作为用户本地默认/自定义分区证据，不把某一用户配置称为跨平台通用默认。

## 全局搜索浮层

`⌥⌘N` 是系统级快捷键：TAi 保持运行并至少保留一个产品窗口时，从其他应用前台唤起圆角浮层；Esc、关闭或失焦收起。网址或查询复用 Chromium 自动补全及用户选择的默认搜索引擎，方向键选择、回车在唤起时的窗口/Space 新标签打开。搜索建议在本地计算；不额外请求在线补全服务。当前没有安装常驻后台助手，完全退出或关闭全部窗口后不承诺唤起。

复用 `ui::GlobalAcceleratorListener` 的 macOS 系统热键实现，不扫描全局输入，不申请辅助功能监听权限。设置 → 快捷键 → 全局搜索浮层可改键或取消绑定；它不适用“网站优先”。若 Arc 或其他应用已注册同一组合，显示占用冲突，不能以保存成功冒称系统注册成功。改用未占用组合，或由用户在占用应用中释放对应快捷键。

真实窗口已验证 TAi 内的唤起、筛选、方向键、打开及 Esc；用户另已确认跨应用实际键盘唤起，返回原应用仍待确认，见 [产品记录](PRODUCT-ACCEPTANCE.md)。

结果固定到打开浮层时的窗口、Profile 与 Space；目标失效或切换 Space 后拒绝把旧建议静默送到另一个环境。输入只允许普通网页与受支持浏览器管理地址，不执行 `javascript:`、`data:` 或自动补全中的操作回调。该浮层与外部 Agent 会话无关。

## 内部地址与产品名称

用户希望把 `chrome://settings/` 显示和输入为 `tai://settings/`。适合采用 **品牌显示/输入别名**：真实内部 URL、WebUI origin、权限和资源加载继续使用 Chromium 的机制，不全局替换协议常量、不新增一个可被网页继承权限的 scheme。原 `chrome://` 入口应继续兼容；品牌显示与设置页文案覆盖需独立验证，不能把应用的 Finder 名称已更换当作所有 Chromium 文案已替换。

参考 [Brave 2026-03-19 合并的显示别名调整](https://github.com/brave/brave-core/pull/34610)及其 [问题说明](https://github.com/brave/brave-browser/issues/53508)。实现限定在地址栏与全局搜索的用户输入和地址栏显示：`tai://settings/` 对应原设置页，`tai://preferences/` 对应自有设置。真实文档 URL、origin、导航记录及资源加载始终保留 `chrome://`。没有注册新的操作系统协议、网络协议或 renderer/WebUI 权限；从网页链接或其他应用唤起 `tai://` 不在本版支持范围。含账号、端口或不完整结构的别名拒绝处理；普通网页的显示不改写。地址栏内部页身份标签改为 TAi；本轮补充替换设置页产品图标、About TAI 标题、地址身份图标及其内部页提示；版本号、Chromium 归属和 credits 保留。不称为全浏览器所有内部页的完整资源换牌。验收以产品记录为准，没有复制该工程代码或引入其 MPL 文件。
