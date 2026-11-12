# TAi 原生设置：首个主干接入点

## 实际入口与范围

产品模式（`--sidebar-browser`）在普通 Chromium Profile 注册 `chrome://tai/`，侧栏底部齿轮进入并选中当前 Space。无痕模式和未启用产品模式不开放该 WebUI。

设置部分提供实际接通的 Space 名称、emoji 图标、自定义颜色、恢复默认颜色，以及当前 Profile 的标准/Pride 配色。Chromium 设置、历史、扩展、下载仍导航到原有管理页。Agent 分类提供当前 Space 的浏览器工具授权，见 [NATIVE-HOST](NATIVE-HOST.md)；跨 Profile 同窗口仍待接入。历史组件/文件业务入口已退出当前产品范围。

原生入口在 `src/chromium/tai_ui.*`，前端主本在 `src/chromium/webui/`；`tools/native_overlay.py` 生成不可变资源头并按哈希安装，不在 Chromium 检出内直接开发。沿用锁定上游的 WebUIConfig/WebUIDataSource/WebUIMessageHandler 与 ImportantFileWriter，不新增第三方 UI 运行时。

## 设置页交互

设置采用紧凑分类导航与统一内容区，四个分类使用同一字号、控件、分隔线和状态体系。Space 图标在原位弹出选择，支持键盘关闭、外部点击关闭及短窗口向上展开；名称和颜色草稿即时显示在预览中，尚未保存时才启用保存/取消。颜色可从色板或原生自定义颜色选择器设置，点击色板会退出“跟随外观”。外观以标准/Pride 建筑图展示真实选项；浏览器管理仍导航到原 Chromium 管理页。

保存状态使用不占文档流的固定反馈，不推动表单上下跳动。字段无效时保留输入草稿并定位对应控件；多窗口版本冲突仍阻止覆盖，需重新加载。设置流程与 [设计复核](SETTINGS-DESIGN.md) 中的合成截图和边界对应。

## 原生身份与写入

- Profile 身份由当前 WebUI 的真实 BrowserContext 获取。工作区文件新增稳定 UUID；旧版本文件在成功读入后补入身份，不重建收藏或 Space。
- 启动和每次工作区提交生成新的 revision。它是进程内的不透明版本，不作为持久序号；旧页面、其他窗口或重启前的写入不能直接覆盖当前版本。
- `taiGetState` 返回 `tai.settings.v1`，包括 ready/readOnly、profileId、revision、edition 和当前 Profile 的 Space 列表。无密钥、Cookie、机器目录或其他 Profile 数据。
- `taiCommand` 接收 `tai.v1` 请求。仅开放 `settings.describe` 和 `settings.patch`；后者需要 profileId、有效 spaceId、当前 revision 与限定字段 changes。先验证整个 patch，再修改模型。
- 名称限制为去除首尾空白后的 1–80 个 UTF-16 单位；颜色沿用组织模型格式，空字符串恢复默认；edition 仅 standard/pride。额外字段、错误类型、其他 Profile、过期版本、未知 Space 均拒绝。
- `icon` 是独立于名称和颜色的 emoji 字符串，最多 64 UTF-8 字节。原生边界使用固定 Chromium 内置 ICU 的 `u_stringHasBinaryProperty(..., UCHAR_RGI_EMOJI)` 校验一个完整 emoji，支持肤色、旗帜及 ZWJ 组合；不自行维护 Unicode 表或引入图标字体/图片包。非 emoji、多 emoji、错误类型和过长输入与其他字段一起原子拒绝，返回 `INVALID_ICON`。
- 旧工作区缺少 icon 时按 Space 顺序分配默认 emoji，不改名、不重建身份；模型中保留默认值，之后沿原工作区写入器保存。新 Space 同样分配默认图标。设置可从常用 emoji 选择，或在图标输入框粘贴其他 emoji；标题、底部切换按钮和 Space 选择器使用同一字段。仅选择图标不会自动应用其他未保存草稿，仍通过统一保存按钮提交。
- 保存成功表示原生模型已应用、已提交给既有文件写入器；不把异步磁盘操作宣称为同步耐久事务。损坏或不可读取的组织文件进入只读模式并保留原字节。

## 信任边界

这是内置、第一方可信 WebUI。`taiCommand` 仍只处理设置；新增 `taiHost` 供第一方开发面板调用原生宿主，外部 Agent 则使用独立同用户 IPC 和限定任务租约。Profile ID 本身不是权限凭证，不能把设置消息处理器直接转发给 Agent。

资源只来自固定的 HTML/CSS/JS 字节表，未知路径不读取文件或转发网络；connect-src 禁止网络连接，frame-src 仅允许隔离的 `chrome-untrusted://tai-content`。网页 HTML、Markdown 渲染和用户小应用不进入可信源 DOM，放在 opaque sandbox 子 frame，具体生命周期/SDK 边界见原生宿主说明。

## 检查方式

`tools/smoke_tai_ui.mjs` 启动自己创建的临时 Chromium Profile，验证真实页面、表单、原生命令、通知草稿保护、磁盘保存、重启恢复、Profile 身份拒绝、损坏文件保护及非产品模式不可访问。测试通过本次独立浏览器的临时调试端口操作，不附着用户浏览器，不读取个人资料。

2026-10-18 首阶段本机完整增量构建、十三份 C++ 检查、原有三十六项侧栏及新增二十三项设置页运行检查通过，并检查实际页面截图。尚未验收真实鼠标/触控板或外部 Agent。最近一次实际结果以 `research/local/tai-ui-smoke.json` 和产品构建记录为准；该目录不进入 Git。语法检查、模块 fixture 和产品运行检查分别报告。

emoji 扩展检查覆盖旧数据默认值、组合 emoji、输入拒绝的原子性、设置草稿保护、真实选择与表单提交、重启保存。窗口工具栏位置直接取 Chromium ToolbarView 的实际垂直中心，代替推测系统窗口控制按钮的位置；原生侧栏检查另外核对开关中心及收起前后的相同屏幕坐标。
