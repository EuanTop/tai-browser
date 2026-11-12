# TAi Browser Alpha 1

The first public TAi Browser alpha brings Spaces and scoped Agent connections to a native Chromium browser for Apple Silicon Macs.

**This build is ad hoc signed and has not been notarized by Apple.** macOS may block the first launch.

## Highlights

- Organize tabs, pinned pages, folders and favorites with Spaces.
- Import Chrome or Safari bookmark exports and saved pages exported from Arc. Import password CSV files through the browser password manager.
- Connect ChatGPT, Claude Code, Pi or another MCP client to a Space. Control browsing interactions and screenshots separately, and see which pages the agent accesses.
- Choose Atrium or Pride, follow the system appearance, and use TAi in English or Simplified Chinese.

## Install

1. Download the macOS arm64 DMG and compare its SHA-256 with the release's `SHA256SUMS`.
2. Open the DMG and drag **TAi Browser** into **Applications**.
3. Open TAi Browser from Applications. If macOS blocks it because the developer cannot be verified, check Apple’s guidance for the per-app **Open Anyway** option in **System Settings → Privacy & Security**. [Apple’s guide to opening downloaded apps](https://support.apple.com/en-us/102445)

See `build-info.json` for the macOS version requirement, the exact Chromium revision and the source commit.

## Known limits

Website sessions stay in the source browser during import. Multi-Profile management and automatic app updates are still in development. The Agent connection requires a compatible MCP client.
