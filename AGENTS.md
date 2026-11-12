# TAi Browser contributor instructions

- Follow [Contributing](CONTRIBUTING.md) and the relevant design and acceptance documentation.
- Keep TAi source in this repository. The generated Chromium overlay belongs in the pinned checkout and must be regenerated from the TAi source.
- Serialize builds and overlay application in the integration checkout. Use separate worktrees for independent module checks.
- Keep browsing data, browser profiles, private credentials, downloads, logs, and generated build output outside source control. Use synthetic fixtures in tests.
- Preserve third-party copyright, license and attribution notices. Report the checks actually performed and any remaining validation gaps.
