# 前端组件网络边界复核

锁定 Chromium 修订：`0e66b94549a8bd85f03fbdf189b752d6e7b63c32`。这份记录解释接入决策，不代表通用浏览器安全审计。

CSP `connect-src 'none'` 不能独自证明 WebRTC 不联网。锁定源码 `third_party/blink/renderer/modules/peerconnection/rtc_peer_connection.cc` 的构造器对 CSP 只记录使用计数；阻止 ICE 的实现读取 Connection-Allowlist。合成本机 STUN 监听器实际收到隔离组件发出的 4 个数据包，确认存在缺口。W3C CSP 的 [RTC 集成草案](https://w3c.github.io/webappsec-csp/#should-block-rtc-connection) 与 [WICG Connection Allowlists](https://github.com/WICG/connection-allowlists) 可供上游跟进；当前不依赖实验性 iframe 属性或添加全局启用参数。

采用 Chromium 已有的 `ContentBrowserClient::RegisterBrowserInterfaceBindersForFrame` 嵌入覆盖点。`tools/native_overlay.py` 在 `chrome/browser/chrome_browser_interface_binders.cc` 只对 `chrome-untrusted://tai-content` 的隔离 WebUI principal 覆盖 P2PSocketManager binder，关闭该请求；注册时还没有首次提交，不能依赖空的 last-committed URL。其他网页沿用原始 binder。

同一文件中的 NetworkHintsHandler 也拒绝 TAi 组件的 DNS 预解析/预连接请求，避免把资源提示当作可用网络通道。响应 CSP 继续限制常规请求、图片、worker、frame、表单和脚本；opaque iframe、MessagePort 范围检查和原生能力校验保持独立。没有修改 Blink、V8、network service、通用沙箱或 RTC 实现。

运行检查在 `tools/smoke_native_host.mjs`：隔离组件真实构造 PeerConnection、创建 data channel/offer、启动 ICE；本机 STUN 接收数为零。同时普通合成 HTTP 网页运行相同连接，能向同一监听器发送数据，证明没有关闭正常网站 WebRTC。所有数据与目标都在测试进程本机，不使用外部 STUN 或个人浏览器资料。第一次额外测试误用了尚未应用的预览句柄，后续已调整测试生命周期；未放宽原断言。

该策略随锁定版本升级重新验证；不能仅靠页面删掉 RTCPeerConnection 全局变量、正则扫描代码或文案宣称隔离。当前包能力仍仅开放组件私有 storage。网络、文件、Cookie、系统通知与任意浏览器控制不是可申请能力。
