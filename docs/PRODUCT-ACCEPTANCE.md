# Product verification

[Alpha 1 release notes](releases/ALPHA-1.md) describe the first public macOS Apple Silicon build. The accompanying GitHub release records the Chromium revision, checksum, signing status and results for the shipped DMG.

Automated coverage includes startup from a mounted standalone DMG, the native sidebar and Space interactions, English and Simplified Chinese settings, Agent authorization and MCP, and reopening a synthetic Profile across a Chromium update. These checks use disposable browser data.

Physical trackpad and drag-and-drop behavior, compatibility across macOS versions and extensions, real account migration, and independent Agent conversations require additional testing. See the [getting started guide](GETTING-STARTED.md#current-limits) for current product limits and [Contributing](../CONTRIBUTING.md) for development checks.
