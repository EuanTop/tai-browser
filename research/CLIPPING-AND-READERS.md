# 剪藏与文档阅读：候选与工程边界

调查日期：2026-10-18。候选仓库元数据、README 与 LICENSE 已检查；下表修订是本次调查位置，尚不是正式依赖锁。尚未引入、编译或验收这些候选的产品集成。正式采用前固定发行版本及传递依赖并保留完整许可材料。

## 候选比较

| 项目 / 调查修订 | 能力 | 许可与处理建议 |
| --- | --- | --- |
| [Obsidian Web Clipper](https://github.com/obsidianmd/obsidian-clipper) `6d56d618b00bd970aa738d6a7a61edee27783e81` | 浏览器剪藏、模板和 Obsidian 衔接 | [MIT](https://github.com/obsidianmd/obsidian-clipper/blob/6d56d618b00bd970aa738d6a7a61edee27783e81/LICENSE)，优先做复用原型；不代表 Obsidian 桌面应用本身开源 |
| [Defuddle](https://github.com/kepano/defuddle) `556d74e8c8fd68c49912d4b11a4ae9ec04d7b2b5` | HTML 正文提取、Markdown 输出能力 | [MIT](https://github.com/kepano/defuddle/blob/556d74e8c8fd68c49912d4b11a4ae9ec04d7b2b5/LICENSE)，优先评估独立解析层 |
| [Mozilla Readability](https://github.com/mozilla/readability) `ab4027a8b37669745016869a37a504727992b2ba` | 阅读正文提取 | [Apache-2.0](https://github.com/mozilla/readability/blob/ab4027a8b37669745016869a37a504727992b2ba/LICENSE.md)，可比较提取质量，不自动引入第二套解析器 |
| [Web Clipper](https://github.com/webclipper/web-clipper) `c8be915332f282103f25bfd9e03cf70eadcc1f84` | 多渠道剪藏，含 Notion 等适配思路 | [原文为 GPL v2 or later](https://github.com/webclipper/web-clipper/blob/c8be915332f282103f25bfd9e03cf70eadcc1f84/LICENSE)；GitHub 元数据 NOASSERTION 不等于没有许可。暂不作为本项目默认捆绑代码，渠道按官方 API 适配并验证 |
| [SingleFile](https://github.com/gildas-lormeau/SingleFile) `30cc1391282f60553d043ade382f74423bcb4ad2` | 完整页面 HTML 存档 | [AGPL-3.0](https://github.com/gildas-lormeau/SingleFile/blob/30cc1391282f60553d043ade382f74423bcb4ad2/LICENSE)，暂不作为默认捆绑依赖；未来若提供需另审集成方式及义务 |
| [Marked](https://github.com/markedjs/marked) `6dd5b3c892d5dd06046b8a52c1cefb3335613fea` | Markdown 转 HTML | [LICENSE](https://github.com/markedjs/marked/blob/6dd5b3c892d5dd06046b8a52c1cefb3335613fea/LICENSE) 含 Marked MIT、Markdown 历史声明等，不应只抄 GitHub NOASSERTION；候选渲染器，输出还需净化 |
| [DOMPurify](https://github.com/cure53/DOMPurify) `cde95990b2190338cfd7c00b768f3d81d3219d61` | HTML 净化 | 本次检查 [LICENSE](https://github.com/cure53/DOMPurify/blob/cde95990b2190338cfd7c00b768f3d81d3219d61/LICENSE) 为 Apache-2.0；固定正式版本后再核验完整许可，不把解析器当作净化器 |

建议先做 Obsidian Web Clipper / Defuddle 的本地闭环，不从零重写正文提取。其现有扩展 UI 不直接等于浏览器原生体验：需要产品内按钮、目标配置、受限原生文件桥接、托管与升级策略。对已授权可读页面操作，提取失败时提供选区/保留链接，不绕过登录和付费限制。

Notion 采用[官方 API 授权与集成](https://www.notion.com/help/create-integrations-with-the-notion-api)，而不是导出浏览器 Cookie。Obsidian 先采用 vault 文件夹写入。坚果云等工具负责同步用户选定的可移植文件；TAi Browser 必须处理冲突与版本，不直接让同步软件同步活动 Profile 或 SQLite。

## 锁定 Chromium 的实际能力

核对版本：`0e66b94549a8bd85f03fbdf189b752d6e7b63c32`，以源码为证据；本次没有额外运行网络 MIME 组合的 UI 测试。

- [json_document.cc](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/html/json_document.cc)：已有 PrettyPrintJSONListener 和 Pretty print 复选框。它处理文本排版，不是完整树状编辑、路径复制或查询工具。
- [document_init.cc](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/renderer/core/dom/document_init.cc)：JSON 类型进入 JSONDocument，普通文本进入 TextDocument。
- [net/base/mime_util.cc](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/net/base/mime_util.cc)：存在 `text/markdown` / `md` 映射；仅 MIME 识别不能证明存在 Markdown 排版器。
- [Blink MIME 支持](https://chromium.googlesource.com/chromium/src/+/0e66b94549a8bd85f03fbdf189b752d6e7b63c32/third_party/blink/common/mime_util/mime_util.cc)：文本 MIME 支持也不代表 Markdown 语法渲染。具体网页显示/下载行为须结合 Content-Type、Content-Disposition 验证。

因此先保留原生 JSON/PDF，再在产品层实现可复用的 Markdown 阅读器与增强 JSON 视图。输入视作不可信文档：净化 HTML、限制本地附件访问和远程加载；大文件避免阻塞界面。无需为排版体验修改 Blink。

## 开发验收样本

剪藏包含普通文章、选区、动态页面、中文/公式/代码、附件失败、重复保存、离线与目的地失败；记录来源及提取状态，不以少数漂亮页面代表全部网站。同步覆盖双设备编辑、删除、旧版本重现与冲突副本。阅读覆盖本地 md/json、不同响应头、原始源码切换、大文件、恶意 HTML 和已存在 JSON/PDF 行为。

当前产品范围见 [产品方向](../docs/PRODUCT-FOCUS.md)。

## 产品接线：虚拟 DOM 与 Markdown 转换

固定使用 Defuddle 0.19.5 提取正文、LinkeDOM 0.18.13 的无浏览上下文文档。实际原生窗口发现 `defuddle/full` 的 Markdown 字符串转换依赖全局 document，可能触发 WebUI Trusted Types 或在 Node 中返回“Partial conversion…”错误文本；不能把包含正文的回退 HTML 当作 Markdown 成功。

产品改为 Defuddle 的 HTML 提取 + [Turndown](https://github.com/mixmark-io/turndown) 7.2.4 的 DOM-node 输入 + [GFM 插件](https://github.com/mixmark-io/turndown-plugin-gfm) 1.0.2。后两者均 MIT，固定依赖及原文在 `modules/clipping/package-lock.json`、`third-party/`。只在 LinkeDOM 节点上转换，不给第一方 WebUI 的 Trusted Types 增加接受任意 HTML 的策略，也不重写正文提取或 Markdown 解析器。GFM 对虚拟表格的 rows getter 所需补齐仅作用于 LinkeDOM 类；不修改原生 DOM 原型。

新增生产 browser adapter 的代码块/列表/表格/选区检查；原生资料库与 MCP 检查拒绝上游错误回退及段落 HTML。普通 UI 与 MCP 均使用 `createNativeLibrary` 的同一保存/索引/读回逻辑。尚未实现附件下载、Notion 上传、资料库编辑删除与持久事件投递；这些仍按开发计划推进。
