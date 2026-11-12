# Chrome、Arc 与 Safari 数据迁移

## 首版欢迎页

新 Profile 首次启动时只显示无标题栏的欢迎卡，点「开始浏览」后才显示浏览器窗口。可从「TAi 设置 → 浏览器 → 从其他浏览器导入」再次打开。旧欢迎标签页恢复时回到浏览器设置，前台入口会打开同一张卡。选择来源后，卡片显示可用格式和导入范围。「选择文件并导入」打开该来源的原生文件选择器。选中文件后自动导入当前 TAi Profile 的新 Space。

| 来源 | 首版入口 |
| --- | --- |
| Chrome | 使用书签管理器导出的 HTML，保留文件夹和链接。也识别已选中的 `Bookmarks` JSON。 |
| Arc | 使用「设置 → 高级 → 导出数据」的 Markdown。顶级标题成为 Space，分节和列表作为文件夹保存网页链接。选择 `StorableSidebar.json` 时，按源 Space 添加保存项，常用网站和未固定标签以收藏保留。 |
| Safari | 使用书签 HTML 导入 TAi Space。也可打开 Chromium 原生导入设置，选择系统能读取的 Safari 来源，原生结果进入 Chromium 书签。新版 Safari 可能先导出 ZIP，只选其中的书签 HTML。 |

导入完成后显示链接数和新建 Space 数。单次支持 10,000 个链接和文件夹、256 个 Space；文件、条目与层级超限分别提示。首版迁移范围为 HTTP(S) 书签和可保存的网页链接，Arc Profile 的登录状态不会迁移。重复选择同一批次会提示已导入。欢迎页另有可选的密码 CSV 入口，直接交给 Chromium 原生密码管理器；欢迎页不读取密码文件。移动或重新打开来源、映射到已有 Space、批次撤销和其他数据类别属于下文的后续阶段。

### 复用证据

- 参考 Zen 1.24b（`f75390aa2b797ddc3524ff9ed52ceb32a839f9fa`，MPL-2.0）的离线欢迎、来源选择和 Arc Space 导入体验。TAi 采用现有 Chromium 和自有迁移模块。 [Zen 欢迎页](https://github.com/zen-browser/desktop/blob/f75390aa2b797ddc3524ff9ed52ceb32a839f9fa/src/zen/welcome/ZenWelcome.mjs) · [Zen Arc 导入](https://github.com/zen-browser/desktop/blob/f75390aa2b797ddc3524ff9ed52ceb32a839f9fa/src/zen/migration/ZenProfileMigrators.sys.mjs)
- Chrome/Arc JSON 和书签 HTML 复用现有 `modules/migration` 解析器。Arc 官方 Markdown 导出使用仓库已有的 Marked 18.1.1（MIT）词法解析器，仅提取标题和链接。原始声明见 [Marked LICENSE](../modules/readers/third-party/marked@18.1.1/LICENSE)。 [Arc 导出说明](https://resources.arc.net/hc/en-us/articles/25583851606039-How-Do-I-Export-My-Data-from-Arc)
- Safari 直接导入入口复用锁定 Chromium `0e66b94549a8bd85f03fbdf189b752d6e7b63c32` 的 Settings 和 macOS Safari 书签导入器（BSD-3-Clause）。HTML 文件走 TAi 的侧栏导入流程。 [Safari 导出说明](https://support.apple.com/guide/safari/export-browsing-data-ibrwebf10132/mac)
- 欢迎卡复用该修订的 Chromium Views `ShowWebDialogWithParams`、`BrowserView` 窗口显示入口和 `ui::SelectFileDialog`。TAi 负责首启窗口顺序、卡片动效、来源对应的扩展名和选择文件后的单次导入。首次启动时可预约在进入浏览器后打开密码或 Safari 原生导入。

## 后续迁移范围

## 用户流程

首次使用和设置内均提供“从其他浏览器导入”：选择 Chrome/Arc 和来源 Profile/文件 → 展示可读取的数据种类、数量与无法支持项 → 选择合并或新建 Space → 预览 → 导入 → 查看结果/撤销。能可靠定位时减少手工找文件，权限或版本不匹配时提供文件选择/标准书签 HTML 回退。迁移可跳过，之后再次进入。

读取来源的只读一致副本，不更改源浏览器。来源正在写文件时使用合适快照策略或引导关闭，不能把不完整快照当完整结果。记录批次、来源 ID 与映射，重复导入不重复创建；撤销只处理该批次新增/修改的 TAi 数据，不能覆盖导入之后用户的独立编辑。

## 现成能力与候选

| 来源 | 已检查实现 | 在 TAi 的使用方式 |
| --- | --- | --- |
| Chromium 标准书签 HTML | 当前锁定源码 `chrome/utility/importer/bookmarks_file_importer.cc`、`components/user_data_importer/` | 优先复用解析与桥接；普通书签导入后还需映射到自有收藏树，不能只写 Chrome 书签后声称侧栏迁移完成 |
| Chrome Bookmarks JSON | 当前锁定源码 `components/bookmarks/browser/bookmark_codec.*` | 优先复用既有树/编码能力，另做只读来源选择与目标 Space 映射；当前 importer_type / importer_creator 没有完整 Chrome/Arc 专用迁移入口 |
| Arcmark | MIT；`18e1b4b731f9f60d493e8d55b9d67b6be0c5ce51`；[ArcImportService](https://github.com/Geek-1001/arcmark/blob/18e1b4b731f9f60d493e8d55b9d67b6be0c5ce51/Sources/ArcmarkCore/ArcImportService.swift)、ChromeImportService 及各自测试 | 可参考 Space、收藏、嵌套结构映射与 fixture。其 ChromeImportService 处理书签 HTML，不是整套 Chrome Profile 迁移 |
| arcaeologist | MIT；`e0988674716e2f5b54c583fbe0bfd5d4caf0a1c3`；[parser.js](https://github.com/plainspace/arcaeologist/blob/e0988674716e2f5b54c583fbe0bfd5d4caf0a1c3/src/parser.js) | 独立纯 JS 解析器，处理 sidebar/可选 archive 与 profile 常用项，优先评估复用；其去重、丢空文件夹、过滤手动关闭等策略需改为本产品明确策略，避免无声丢资料 |
| Arcsider | MIT；`533b8e1497965a2098ed88b5b34b9a9d8f93e23f`；[项目](https://github.com/jparrill/arcsider/tree/533b8e1497965a2098ed88b5b34b9a9d8f93e23f) | 可参考侧栏扩展导入/导出交互，不为迁移改用 Chrome 分组模型 |

许可文件已核对；上述是候选调查，不代表已经将代码移植进 TAi。Arc 数据格式是私有版本相关格式，候选对某些数据有效不等于跨版本全覆盖。Zen 社区存在 Arc 迁移讨论，但本轮尚未确认可直接采用的内置迁移器；该讨论不作为完整支持的证据。

## 分阶段覆盖

**M1 优先交付可用迁移：** Chrome 书签及层级；Arc Space、收藏/文件夹、常用网站及可恢复 URL。名称、顺序、空文件夹和同网址的不同组织位置尽量保留；去重按来源身份/批次，不能全局按 URL 丢弃用户的有意重复。颜色/图标有可靠字段时转换，不支持字段进入报告。

Arc 的 `StorableSidebar.json` 可提供侧栏组织，但不保证包含准确完整的活跃临时会话。可用未固定项导入临时标签，先懒加载，不能一次打开几百页；窗口/会话文件或 Chromium Sessions 的补充解析单独验证。自动归档可作为可选记录导入，不自动混入当前临时区。暂不能映射的拆分视图/多页项目保留原始关系摘要并显示限制。

**M2 扩展数据：** 历史、开放标签/窗口恢复、扩展清单与重新安装、设置映射、密码导入。每类独立测试并标注可用范围；复用 Chromium 已有历史/密码导入组件。密码优先受支持的系统/导入流程，可能需要系统授权或用户导出文件；不直接复制加密数据库后假称可用。密码导出文件作为敏感本地文件处理，不进入资料库同步、仓库或普通日志。

**登录状态单独验证：** Cookie、站点存储、通行密钥和扩展内部状态不以“同为 Chromium”保证无损复制。优先官方/系统支持的授权路径，无法支持时说明需重新登录；不将其与共享当前 TAi Profile 的 Agent 登录复用混淆。普通用户的快速入口保持统一，内部逐类处理能力。

## 数据映射与验收

导入结果经 F0 自有操作层写入，重用 TAi 的组织/持久化规则，不直接改当前 Profile 中的底层数据库。导入器先输出中间树和批次报告，确认后原子提交；合成 fixture 留在仓库，真实来源副本留在本机用户选定位置，Agent 默认不获取密码/Cookie 或全部迁移原件。

验收覆盖：多 Profile/多 Space、深层和空文件夹、中文/emoji、自定义名字、重复 URL、失效引用、循环/损坏/未知版本、部分文件缺失、大量标签、导入取消、重复批次、重启恢复和撤销冲突。报告分别列出成功、跳过、不支持、失败与可重试项；源文件校验值/内容保持不变。后续由用户自选真实来源做端到端验收，不用个人数据完成早期自动测试。

Chromium 证据修订：`0e66b94549a8bd85f03fbdf189b752d6e7b63c32`；[Importer 类型](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/components/user_data_importer/common/importer_type.h)、[书签导入](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/chrome/utility/importer/bookmarks_file_importer.cc)、[BookmarkCodec](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/components/bookmarks/browser/bookmark_codec.h)。任务拆分见开发计划 M。
