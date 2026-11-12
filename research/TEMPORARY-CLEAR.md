# 临时标签清理与恢复

使用 Chromium 锁定修订 `0e66b94549a8bd85f03fbdf189b752d6e7b63c32` 自带的 `TabRestoreService`，许可沿用 Chromium BSD 及原发行声明；没有引入新的依赖或复制会话序列化逻辑。

调查入口：`components/sessions/core/tab_restore_service.h`、`tab_restore_service_helper.h/.cc`、`chrome/browser/ui/tabs/tab_strip_model_observer.h`、`chrome/browser/ui/browser_live_tab_context.h`。上游保留最近 25 个关闭条目，`RemovedTab.session_id` 标识实际成功关闭产生的条目，`RestoreEntryById` 可恢复导航栈。TAi 既有的 session extra data 接入保留原 Space 和收藏身份。

产品适配：每次最多清理当前窗口、当前 Space 的前 20 个临时页面，按钮显示本次数量；用户可继续分批清理。收藏、常用网站、其他 Space 和占位新标签不参与。页面的 beforeunload 仍由 Chromium 处理；取消关闭后显示保留数量。原生 UI 只保留最近一批的会话 ID 与原相对顺序，不另存 URL 或网页状态，也不建立 Google 标签组。

恢复前逐个核对当前 Chromium 条目、类型与 Space，不调用全局“恢复最近关闭”。恢复后的页面按原批次顺序追加，保留 Chromium 能恢复的前后导航；原页面运行中的 JS、未持久化表单和所有网站现场无法承诺完整恢复。用户已在新页面工作时不主动替换它；只有占位空页面会让位给恢复页。

记录被其他关闭操作淘汰或由历史管理移除时，可恢复数量以剩余条目为准，不兜底恢复无关页面。无痕窗口明确提示无法恢复；窗口关闭后批次入口不持久化，普通窗口仍可通过 Chromium 最近关闭记录恢复。第二次清理会替换当前 Space 的上一批快捷恢复入口，上次条目仍受 Chromium 的正常保留策略管理。

原生自动检查覆盖实际提交的合成导航、原 Space/其他 Space/收藏边界、逐 ID 恢复、相对顺序、后退历史和条目被删除后的部分恢复，直接调用原生绘制记录来覆盖透明层文字路径。真实窗口检查已经通过：在带 textarea/onbeforeunload 的合成本地站点输入草稿，取消清理后保留原文并显示保留数量，重新清理并确认后显示恢复入口，实际点击恢复重新打开原 Space 页面。没有把编译或静态检查当作这些鼠标流程的证据；站点现场和表单完整恢复仍受前述 Chromium 边界约束。

真实绘制曾发现普通 Label 的 LCD 子像素渲染要求不透明祖先，与 Space 动画的透明 layer 不符。提示文字改用普通抗锯齿，保持上游 DCHECK，不跳过检查。实际取消关闭还确认 `TabStripModelObserver::OnTabCloseCancelled` 只覆盖标签不可关闭的过滤分支，不能覆盖用户在 beforeunload 弹窗里取消；现通过每个待关闭 WebContents 的 observer 监听取消事件，在消息队列中结束该页面的待关闭状态，避免在 observer 分发途中销毁自身。没有改动 Chromium 的关闭/弹窗算法。
