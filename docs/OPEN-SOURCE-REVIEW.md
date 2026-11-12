# Release review

[Alpha 1](releases/ALPHA-1.md) is the first public alpha. Its macOS DMG uses ad hoc signing and carries no Apple notarization ticket.

- Review the source snapshot for private material, credentials, asset provenance and third-party notices.
- Check the pinned Chromium revision against the current upstream security release before packaging.
- Verify the final app and DMG. Check the app name, architecture, minimum macOS version, standalone startup, Profile upgrade and Agent runtime.
- Record checks performed with synthetic Profiles and any separate clean Mac or manual interaction testing. The installer guide describes the first-launch approval applicable to this alpha.
- Match the release tag and build metadata to the reviewed source. Verify the SHA-256 of each final asset and attach the notices and Chromium credits.

See the [release guide](REPOSITORY-AND-RELEASE.md) and [Apple's guide to opening downloaded apps](https://support.apple.com/en-us/102445).
