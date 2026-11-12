# Repository and release workflow

The TAi repository contains the product source, build overlay, assets, tests and documentation. The Chromium and depot_tools checkouts use the revisions in [chromium.lock.json](../chromium.lock.json). Build outputs and browser profiles belong in the local workspace.

## macOS releases

1. Review the exact source snapshot and Git history. Check dependencies, licenses, attribution and the pinned Chromium security release.
2. Build for Apple Silicon with `config/mac-arm64-release.gn`. The standalone app includes the browser, native launcher, Node and locked Agent runtime dependencies. It uses the same product bundle identity and Profile location across updates.
3. Verify the app signature, runtime dependencies, DMG integrity, launch, Profile upgrade, browser settings and Agent tools. Run verification with synthetic data. Document the platforms and checks covered.
4. Attach the DMG, SHA-256 checksums, build metadata and third-party notices to an English GitHub release. The tag identifies the source snapshot used to build the app. Alpha 1 uses ad hoc signing and carries no Apple notarization ticket.

See the [release checklist](OPEN-SOURCE-REVIEW.md), [Alpha 1 notes](releases/ALPHA-1.md) and [GitHub Releases documentation](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases).
