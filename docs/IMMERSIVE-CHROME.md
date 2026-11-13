# 网页与顶栏的连续画布

TAi 的浏览区域从工具栏延续到网页内容。闲置地址栏不再用独立的浅色胶囊分割这个区域；悬停只提供轻微定位反馈，普通页面聚焦或编辑时恢复原生 Chromium 输入表面；TAi 新标签页的空地址栏保留画布，开始输入后恢复编辑表面。左侧 Space 保留自己的颜色和图标。

## 实现边界

- 可见的 HTTP(S) 页面顶部有横贯视口、颜色一致且与文档背景不同的色带时，使用色带颜色。普通画布、非纯色边缘和读取失败沿用 `WebContents::GetThemeColor()` 与 `GetBackgroundColor()`。半透明主题色与背景合成。
- 每个窗口仅观察活动 WebContents。页面首绘、加载、宽度变化、显示及交互触发合并后的取样，使用 Chromium `RenderWidgetHostView::CopyFromSurfaceSecure` 读取 2 DIP 高的色带，缩到 128 × 1 像素。忽略滚动条区域，至少九成像素接近中值才采用。像素只在内存中归约为颜色，切换文档或标签时丢弃旧结果。内部页、隐身窗口及高对比模式使用原有路径。
- 工具栏沿用 `CustomCornersBackground` / `ThemedBackground` 的原生几何。地址栏调整闲置且没有进行中输入时的填充（TAi 新标签页的默认空白聚焦也属于此状态）；编辑、建议、权限、安全提示、危险站点标记沿用原有逻辑。
- 原生控件通过 ColorProvider 的 InitializerSupplier 复制 Chromium 已有的浅/深色工具栏与地址栏配色；保留 Widget 原来的 color_mode，因此不改变网页的 `prefers-color-scheme`。不写入用户 Profile 主题偏好，也不修改网页首选配色设置。Space 背景保留自己的配色；固定侧栏按钮展开时按 Space 底色、隐藏时按网页底色计算对比度，保持原图形与位置。
- TAi 新标签页及自有设置页同样衔接页面画布。新标签页空地址栏在默认聚焦时保持低存在感，输入内容后恢复原生编辑背景；Chromium 原设置、历史和扩展管理页、隐身窗口及高对比模式保留原有处理。没有可用页面颜色时，顶栏使用 Chromium 原生工具栏背景。

网页滚动或交互后按可见上沿重新取样，固定页眉仍可提供颜色。渐变和多色边缘由网站主题色或文档背景提供颜色。

## 复用与检查

复用修订 `0e66b94549a8bd85f03fbdf189b752d6e7b63c32` 的 WebContentsObserver、ColorProvider 的 InitializerSupplier 与原生浅/深色配色、原生地址栏和工具栏绘制；继续保留 Chromium BSD 及其第三方许可。自有逻辑在 `src/chromium/space_navigation_view.*`，生成的上游接点在 `tools/native_overlay.py`。新增的上游 UI 接点仅为 `location_bar_view.cc` 的 idle 背景分支、`browser_widget.cc` 的控件配色接点及 `browser_view.cc` / `multi_contents_view.cc` 的普通/全屏顶栏下沿背景接点，不改 Blink、V8、网络或安全核心。

原生合成导航覆盖显式主题色优先、CSS 回退、后台导航、标签切换、动态主题色、地址栏聚焦/失焦和内部页回退。真实窗口的视觉验收与这些逻辑检查分别记录；合成检查不能代替不同网站的实际观感。

配色只使用两个长生命周期 initializer（浅/深），不按网站创建新主题；原有 PWA initializer 不覆盖。颜色 ID 来自锁定 Chromium 的宏表，仅复制 Toolbar/Omnibox/LocationBar 三组控件颜色，包括编辑、悬停、禁用及安全状态，其他 UI/网页的系统颜色保持原样。

独立渲染器回归：`node tools/smoke_page_chrome.mjs <已编译的 Chromium 可执行文件>`。它仅创建测试 Profile 和回环 HTTP 服务，检查浅/深及动态配色下网页媒体查询不变，并在结束时关闭测试浏览器和服务。

顶栏与网页之间原生的一像素分隔区域也绘制为当前页面色；仅替换顶栏下沿的背景，保留分隔区域布局与其他分屏边界。Chromium 原管理页/高对比回退时仍使用原生分隔色。


新标签页补充（2026-11-10）：Pride 自有页面移除额外的页面底色渐变，顶栏、下沿和页面使用同一 canvas；Pride 建筑图与左栏配色保留。左下 Space 按钮组左侧内边距增至 16 DIP，右侧 8 DIP，可见按钮数量同步按剩余宽度计算。

补充验收：本轮原生主干共 64 项通过（新增首页连色、空白聚焦、输入恢复三项），Pride 明暗 canvas 两项首页回归、原有设置/宿主/面板/MCP 及 7 项安装检查通过；最终安装版已实际核对空地址栏、输入/退出和底部三枚 Space 图标留白，并恢复原用户状态。

## 窗口缩放诊断

侧栏的滚动区按窗口可用高度布局，收藏列表长度不参与窗口最小高度计算。原生 smoke 用溢出内容检查最小高度和滚动条，并验证窗口尺寸变化打断 Space 动画后，侧栏恢复到完整状态。

使用仓库的 `启动浏览器.command` 或 `python3 tools/run_product.py` 启动开发版，日志写入 `research/local/development-browser.log`。其中的 TAi 窗口诊断记录侧栏尺寸变化打断动画、Space 切换是否走相邻切换路径（横向手势和相邻切换快捷键共用）、慢侧栏重绘和顶栏色源。TAi 新增的这些事件只包含状态、数量、尺寸和耗时。原生 smoke 同样采集这些事件到 `research/local/native-smoke-browser.log`。

排查更细的卡顿时，用 Chromium Tracing 的 `browser` 类别查看 `TAi.SidebarResize`、`TAi.ActivateSpace` 和 `TAi.RenderSidebar`，并对照 Chromium 原生窗口的 `NSWindow::sendEvent`。继续使用锁定版本自带的 AppKit 标题栏双击处理和 Chromium 日志、跟踪能力。
