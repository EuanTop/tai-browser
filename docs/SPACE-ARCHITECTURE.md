# 独立 Space 与侧栏结构

Space 的身份、文件夹及收藏项由自有 `WorkspaceModel` 管理，不再以 Chromium 标签组表示。每个窗口只展示当前 Space；顶部常用网站按 Profile 共享，收藏文件夹/页面属于 Space，分隔线下展示该 Space 的临时标签。关闭收藏页只关闭其网页，收藏入口保留；关闭临时页则从列表消失。空 Space 仍存在。

底部空间数超出可用宽度时，当前 Space 保留图标，相邻 Space 缩成圆点。悬停或键盘聚焦会显示对应图标，点空间总数可打开按原顺序排列的完整列表。折叠侧栏时可点当前图标进入列表。界面沿用锁定 Chromium 修订的 Views 弹窗、滚动容器和 `gfx::SlideAnimation`，尊重系统的减少动态效果偏好。[Zen 工作区](https://docs.zen-browser.app/user-manual/workspaces) · [Arc 图标切换动效](https://resources.arc.net/hc/en-us/articles/20498377604887-Arc-for-macOS-2023-Release-Notes)

真实网页仍由 `TabStripModel`、`WebContents`、Chromium 导航与会话恢复机制管理。自有侧栏记录稳定的 Space ID、收藏项 ID 与临时空白占位标记。上游会话附加数据保存归属，恢复时先附回网页再交给侧栏读取。标签切换快捷键仅遍历当前 Space 和常用网站；扩展主动激活另一 Space 的标签时，侧栏跟随其归属。

每个 Profile 一个共享组织仓库，各窗口独立记录当前 Space，避免多窗口互相切换。组织信息保存到该产品 Profile 内的 `SidebarWorkspace.json`，通过 Chromium 的原子写入工具写盘；加载失败时保留原文件、停止覆盖并提示本次更改暂不保存。隐身 Profile 的组织数据仅存在内存中。

上游接入集中在八个构建/浏览器界面/会话/WebUI 注册文件：构建列表、竖向标签区域、竖向状态控制、标签命令入口、网页会话恢复入口、关闭标签附加数据入口、工具栏恢复按钮入口，以及 TAi WebUI 注册入口。自有实现维护在 `src/chromium/` 与 `src/sidebar/`。没有改动 Blink、V8、网络栈或沙箱。版本升级仍需检查这八个接入文件、重新编译并验收，不能直接复用 Google Chrome 的二进制更新包。

同窗口跨 Profile/账号的 Space 尚未实现，不能以独立 Space 的元数据字段替代真实账号隔离。拖动排序和拖入文件夹已接入，物理拖放验收、归档及 Arc 完整窗口视觉仍需后续迭代。此文描述实现边界；实际测试状态以 `docs/PROTOTYPE.md` 与本地构建记录为准。

## UX-03：拖放与颜色

Space 的颜色是自有元数据（ARGB，零表示默认），序列化为可选 `#RRGGBB`；旧版没有颜色字段的文件继续可读。非法颜色拒绝写入，整个组织文件损坏时仍保留原件。颜色只改变侧栏表面、文字和操作图标，不改变网页渲染、网络或账号状态。

原生拖放使用 Views DragController 和系统 OSExchangeData。载荷仅包含本进程生成的随机 nonce；来源由本进程保存的弱引用定位，目标再次核对同一 Profile，不能通过外部载荷指定任意指针或 TabHandle。合法的延迟 drop 回调保留其 nonce/来源快照，源拖动循环完成后仍能完成回调，来源窗口销毁则失效。

收藏、临时标签、常用网站和底部 Space 是不同放置区域。行中点决定前后顺序，文件夹中部接收子项。Space 悬停 750 毫秒切换目标，再继续寻找具体位置。组织移动先在候选快照验证，拒绝文件夹循环及不合法的目标。跨同一 Profile 的窗口使用 Chromium 自身的 DetachTabAtForInsertion/InsertDetachedTabAt 转交同一个 TabModel/WebContents；跨 Profile 移动不在本轮范围。移到新窗口提供显式菜单入口；拖到桌面自由撕出新窗口尚未实现。

## UX-04：完全隐藏与 Space 动画

产品模式下折叠宽度改为 0，隐藏原生区域内的所有侧栏内容，不保留 Chromium 的 56 pt 图标栏。上游折叠状态和展开/收起的尺寸动画继续使用；一个自有工具栏按钮在侧栏收起时出现，沿用同一控制器展开，快捷键仍可使用。为避免零宽度状态套用原版的图标栏悬停逻辑，产品模式关闭那一路原生 expand-on-hover；鼠标靠近边缘临时展开的 Arc 浮层行为仍是单独待办。

Space 过渡只作用于名称、收藏树、临时标签组成的原生视图，常用网站和底部 Space 入口保持静止。旧侧栏内容保留绘制图层，新视图从相邻方向进入，260 ms 缓动，结束后释放旧图层。切换不重建 WebContents；快速再次切换会结束旧过渡并开始新过渡。系统“减少动态效果”启用时跳过动画。

手势使用原生 scroll phase 区分一次触控板动作，一次动作只切换一个 Space，惯性滚动不继续翻页；循环到首尾 Space 时保留手势方向。无 phase 的鼠标滚轮保留阈值与冷却。

此轮增加工具栏按钮的单一接入点；本段对应设置页接入前的七份上游文件/十份检查单元；新增设置页后为八份上游接入文件、十三份检查单元，见 [原生设置](NATIVE-SETTINGS.md)。页面内核与网络、安全策略继续沿用 Chromium。实际窗口与运行检查结果以最新构建记录、原生 smoke 及 `design-qa.md` 为准。

## Profile 与全局 Space 导览的目标（尚未实现）

一个 Space 绑定一个真实 Chromium Profile，多个 Space 可以共用该 Profile。同 Profile 的登录、常用网站等按环境共享，不同 Profile 可在同一鉴权网站同时保持不同账号。创建 Space 提供选择/新建 Profile，Profile 改绑有登录环境变化提示。这个产品语义与 [Arc 官方 Profile 说明](https://resources.arc.net/hc/en-us/articles/19227964556183-Profiles-Separate-Work-Personal-Browsing)一致。

当前 WorkspaceState 按 Profile 分仓，侧栏取所属 Browser 的 Profile；WorkspaceSpace.profile_key 是元数据，现有“current-profile”标签不等于已经实现多 Profile。后续全局导览只聚合身份/顺序，真实页面仍属于原 BrowserContext，不能直接换 Browser 的 Profile 指针。跨 Profile 同窗口托管、扩展/地址栏/会话和重启恢复由 organizer 统一实现，不能由某个 UI 模块单独完成。

Agent 任务绑定目标 Profile + Space + Page，默认复用该 Space 所属 Profile 的登录，不随用户当前所见的账号环境切换。跨 Profile 转移需要在目标环境重新打开页面，不视为同 Profile 活页面无损转移。资料库是统一剪藏模块，文件访问按 libraryId/授权处理，不由 Profile 字段自动提供文件隔离。
