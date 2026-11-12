# 前端轻应用

历史实现说明：用户已于 2026-11-07 取消轻应用产品方向，见 [当前产品方向](PRODUCT-FOCUS.md)。不继续建设 Studio、番茄钟、SDK、商店或预览/安装平台。以下保留当时实现及验证记录；源码和已安装开发版的旧入口仍待下线，现有用户数据保留，不能把历史能力当作当前开发目标。

TAi 提供受限的前端运行面，不维护另一套 Agent 逻辑。用户可以在原 Codex、Claude Code 等入口描述番茄钟或自定义工具，Agent 通过 TAi 的 MCP 提交候选；也可导入 `.tai.json`。用户预览后自行应用，无需编译 Chromium/C++。

## 用户流程

1. 在 Agent 设置中指定 Space，显式勾选“允许提交轻应用预览”。沿用现有 MCP 连接方式，不扫描个人 Agent 设置/会话。
2. Agent 调用 `tai_app_preview` 提交已打包的前端代码。它只收到候选 ID、组件 ID、Space 和 `awaiting-review`，不会取得渲染 URL、nonce 或本地数据。
3. 在固定右栏或 `chrome://tai/components.html` 查看待确认候选。提交本身不执行代码，也不安装。
4. 预览在隔离 frame 中运行，使用现有数据的私有副本。检查后应用或取消；运行失败会保留原组件。
5. 已应用的轻应用保存在本机。重启后从列表重新打开，可更新、回滚代码或停用；停用与回滚都保留用户数据。

断开 Agent 连接会清理未批准候选，已应用轻应用继续归用户管理。连接当前仅本次浏览器运行有效；尚未实现同一原 Agent 会话的聊天接管。

## 包格式与复用

直接复用 `modules/studio/package.mjs` 的清单/包验证与编译器，以及 `createSurfaceHost` 的隔离生命周期；不复制一个前端 Studio。持久注册表和权限的最终权威在 C++ 原生宿主。

可直接导入的 `.tai.json`：

```json
{
  "kind": "custom",
  "manifest": {
    "apiVersion": 1,
    "id": "example.focus",
    "version": "1.0.0",
    "title": "专注时钟",
    "entry": "index.html",
    "surfaces": ["panel"],
    "capabilities": ["storage"]
  },
  "markup": "<main><h1>准备专注</h1></main>",
  "style": "body { font-family: system-ui; }",
  "script": "const state = await taiComponentSDK.storage.get('state');"
}
```

`script` 为已打包的浏览器 ESM，不支持外部导入、Node 或任意原生接口。MCP 输入使用相同字段但不含 `kind`；适配器固定为 custom。`tai.*` ID 留给内置组件。开发者可用已有 `modules/studio/compile-package.mjs` 打包源文件；普通用户不承担编译。

## 数据与版本

注册表在实际 Profile 下 `TAiComponentData.json` 的 `_tai.modules` 中，以 Space/组件组合定位；自定义数据同样按 Space/组件隔离。代码、最多三个保留版本与数据共用 4 MiB 上限，单个数据值上限 64 KiB。内置番茄钟保留 Profile 级共享行为。

预览期间写入内存副本。应用时比较数据与注册表基线，任何另一窗口修改都会返回冲突，用户需重新预览；不静默覆盖。成功后代码与数据一次原子提交。回滚只选择保留的代码，不回滚用户数据；代码启动逻辑仍可能按自己的设计更新数据。

## 验证与限制

`tools/smoke_native_components.mjs` 验证真实浏览器中的取消、失败恢复、并发冲突、原子发布、旧实例退役、回滚、停用、重启和 Space 数据隔离。`smoke_native_mcp.mjs` 验证官方 MCP → 原生候选 → 正式管理页 → 用户应用，以及撤销前后的候选/已安装行为。全部使用合成数据，没有调用真实模型。

自定义组件当前只提供 storage SDK；网络、文件、Cookie、系统通知和任意浏览器操作不是可申请的能力。尚无包市场、签名发布或自动安装渠道。跨版本数据迁移由组件代码承担，不保证任意第三方代码都正确。
