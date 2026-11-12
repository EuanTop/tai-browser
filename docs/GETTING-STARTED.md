# Getting started with TAi Browser

[简体中文](GETTING-STARTED.zh-CN.md) · [Back to TAi](../README.md)

## Downloads

Alpha 1 targets Apple Silicon Macs. Open the DMG from [GitHub Releases](https://github.com/EuanTop/tai-browser/releases) and drag **TAi Browser** into **Applications**. The release lists the macOS version requirement and provides `SHA256SUMS` for download verification.

**The DMG uses an ad hoc signature and has not been notarized by Apple.** If macOS blocks the first launch because the developer cannot be verified, see Apple's instructions for **Open Anyway** in **System Settings → Privacy & Security**. Use this option for the verified download. [Apple’s guide to opening downloaded apps](https://support.apple.com/en-us/102445)

## Start browsing

In a current development build, the left sidebar organizes folders, pinned pages, temporary tabs and favorite sites. Use the Space controls to switch contexts. **TAi Settings** contains Space names, emoji, colors, appearance, shortcuts and agent connections; ordinary browser controls remain in the native browser settings.

On macOS, **⌘T** opens a tab, **⌘L** focuses the address bar, and the default **⌘S** toggles the sidebar. **⌥⌘N** opens global search while TAi is running with a window available. Shortcuts can be changed in TAi Settings; system conflicts and per-website shortcut priority are explained in [shortcuts and languages](ACCOUNTS-AND-SHORTCUTS.md).

In **TAi Settings → Appearance → Interface language**, choose **Follow system**, **English** or **简体中文** for TAi’s interface. Changes apply immediately. Chromium’s Settings, History and Extensions use the macOS application language. To change those pages, choose a language for **TAi Browser** in **macOS System Settings → General → Language & Region → Applications**, then relaunch TAi. [Apple’s per-app language guide](https://support.apple.com/guide/mac-help/change-the-system-language-mh26684/mac)

## Connect an agent

Use [the connection guide](AGENT-CONNECTION.md) to connect ChatGPT, Claude Code, Pi or another MCP client. Choose a Space and verify a tool request. Enable **Reconnect after updates or restart** to retain the authorization when TAi restores the same window. A saved MCP configuration is not the same as a live client connection. Your existing agent keeps its own conversation, model and approval flow; the browser provides scoped tools. Direct continuation of that conversation inside the right panel is not currently delivered.

## Current limits

- The initial build target is macOS Apple Silicon. Other platform packages are not available.
- Browser account/sign-in/sync and Profile-management entry points are temporarily disabled. Existing local Profile data and website sign-ins are retained. Spaces sharing a Profile also share site sign-ins; same-window cross-Profile switching is still under development.
- The migration card imports Chrome and Safari bookmark exports and Arc saved links. Password CSV import opens Chromium’s password manager. Cookies and login sessions stay in their original browser.
- More trackpad, physical drag-and-drop, cross-Profile and real agent conversation testing remains. The [acceptance record](PRODUCT-ACCEPTANCE.md) distinguishes implemented behavior from verified coverage.
- Development builds use manual updates. A standalone updater is not available.

Built-in clipping/library/reader and the light-app platform are outside the current browser scope. Retained source directories do not indicate active product features; a separate clipping extension has not been released.

## Feedback and contributions

[Report a reproducible issue](https://github.com/EuanTop/tai-browser/issues) with your OS, architecture, TAi/source version, steps, and expected versus actual behavior. Remove private URLs, account details and connection tokens from shared logs and screenshots. Use [private reporting](../SECURITY.md) for security issues. To work on the code, follow [Contributing](../CONTRIBUTING.md).
