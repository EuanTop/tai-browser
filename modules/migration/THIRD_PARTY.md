# Reuse and third-party notices

The shared M1 parser now runs in browsers as well as Node 20+. M2 adds adapters, not another parser. Exact npm tarball integrity values and every transitive dependency are in package-lock.json. No install scripts are run. Full shipped runtime licenses are retained below; TAi's own license does not replace them.

## M2 browser compatibility and check tools

- Platform Web Crypto `SubtleCrypto.digest('SHA-256', bytes)` authenticates the selected native text inside the worker. `TextEncoder`, dedicated module `Worker` and `terminate()` are platform APIs with no vendored implementation. Web Crypto is async, so it cannot replace thousands of synchronous identity calls without changing every public parser/batch API. We assessed that change and instead reuse the existing compatible library below for those calls.
- `@noble/hashes` **1.8.0**, https://github.com/paulmillr/noble-hashes/tree/1.8.0, MIT. Direct unchanged `sha256`, UTF-8 and hex utilities keep every M1 identity stable while eliminating `node:crypto`/Buffer assumptions. No native addon, filesystem access, network or parser copy. Full [license](third-party/npm/noble-hashes-1.8.0.LICENSE). No runtime transitive dependencies. Follow upstream fixes with a pinned update and the Node SHA-256 identity compatibility check.
- `esbuild` **0.28.2**, https://github.com/evanw/esbuild/tree/v0.28.2, MIT, [license](third-party/npm/esbuild-0.28.2.LICENSE). Development dependency only, matching organizer's existing version. Its pinned optional platform binaries also use MIT. Produces three static browser ESM bundles; not included as a product runtime/compiler.
- `linkedom` **0.18.12**, https://github.com/WebReflection/linkedom/tree/v0.18.12, ISC, [license](third-party/npm/linkedom-0.18.12.LICENSE). Development-only real DOM implementation for mapping controls/tree checks; not a product renderer. Extra pinned development transitives: boolbase 1.0.0 (ISC), css-select 5.2.2 (BSD-2-Clause), css-what 6.2.2 (BSD-2-Clause), cssom 0.5.0 (MIT), html-escaper 3.0.3 (MIT), nth-check 2.1.1 (BSD-2-Clause), uhyphen 0.2.0 (ISC). htmlparser2/DOM dependencies below are shared with runtime. Full dependency licenses remain in installed development packages; these additional test packages are not shipped in bundles.
- Real browser smoke uses an explicitly selected existing Puppeteer Core **25.3.0** (Apache-2.0, https://github.com/puppeteer/puppeteer/tree/puppeteer-core-v25.3.0) and Google Chrome with a fresh temporary Profile/offline mode. Neither is vendored, downloaded by the test, linked into product bundles or included in this package. Test tools must be installed separately; their distribution licenses remain with their distributions. The test uses local file modules, so native WebUI CSP/loading remains unverified.

No runtime user setup/compiler/daemon is added. Plain parser and HTML/Arc fixture checks, browser bundling, actual worker cancellation/races and DOM checks are run locally; exact counts and native gaps are in INTEGRATION.md/README.md.

## Welcome import

- Marked **18.1.1**, MIT, [upstream](https://github.com/markedjs/marked/tree/v18.1.1), [retained license](../readers/third-party/marked@18.1.1/LICENSE). The first-party welcome bundle uses the lexer to extract headings and links from Arc's Markdown export. It never renders Markdown as HTML.

## Direct Arc reuse

- Source: https://github.com/plainspace/arcaeologist/blob/e0988674716e2f5b54c583fbe0bfd5d4caf0a1c3/src/parser.js
- Exact revision: `e0988674716e2f5b54c583fbe0bfd5d4caf0a1c3`; MIT, Copyright (c) 2026 Jared Volpe. [Full license](third-party/arcaeologist/LICENSE).
- Directly adapted into third-party/arcaeologist/helpers.mjs: alternating pair mapping, Space container labels, Profile tag structure, title and URL extraction. No global variable registration or I/O retained.
- Local adaptations: ESM exports, structured diagnostics, duplicate and odd-pair checks, null for unresolved Profile tags, preserved title whitespace, traversal budget checks. TAi's wrapper replaces URL deduplication, dropping empty folders, replicating favorites per Space, and archive filtering with explicit product rules. The original parser was inspected before implementation; it is not a runtime download.
- Upgrade path: compare the pinned parser helpers and synthetic fixtures, preserve attribution, rerun contract and module tests; do not blindly replace the wrapper with upstream export policy.

## HTML parsing

- `htmlparser2` 10.0.0 (https://github.com/fb55/htmlparser2/tree/v10.0.0), MIT. Direct npm dependency, tokenizer/entities reused unchanged; our adapter interprets Netscape bookmark H3/DL/A structure. This handles compact/multiline markup and entity decoding without an ad-hoc regex tokenizer.
- All runtime dependencies are pinned transitively by package-lock.json. The HTML graph has seven package instances (including two entities versions), plus M2's noble dependency. The tokenizer is used directly; bundlers may remove unused DOM utilities, but distribution must retain all notices for shipped packages. Development-only tools are listed separately above.

| Package | Version | License | Full text |
| --- | --- | --- | --- |
| `dom-serializer` | `2.0.0` | MIT | [license](third-party/npm/dom-serializer-2.0.0.LICENSE) |
| `entities` | `4.5.0` | BSD-2-Clause | [license](third-party/npm/entities-4.5.0.LICENSE) |
| `domelementtype` | `2.3.0` | BSD-2-Clause | [license](third-party/npm/domelementtype-2.3.0.LICENSE) |
| `domhandler` | `5.0.3` | BSD-2-Clause | [license](third-party/npm/domhandler-5.0.3.LICENSE) |
| `domutils` | `3.2.2` | BSD-2-Clause | [license](third-party/npm/domutils-3.2.2.LICENSE) |
| `entities` | `6.0.1` | BSD-2-Clause | [license](third-party/npm/entities-6.0.1.LICENSE) |
| `htmlparser2` | `10.0.0` | MIT | [license](third-party/npm/htmlparser2-10.0.0.LICENSE) |

## Assessed, not copied

- Arcmark `18e1b4b731f9f60d493e8d55b9d67b6be0c5ce51`, https://github.com/Geek-1001/arcmark/tree/18e1b4b731f9f60d493e8d55b9d67b6be0c5ce51 ; MIT. Reviewed ArcImportService/ChromeImportService and public synthetic tests. The absent-container parentID fallback and precedence of canonical childrenIds were informed by this source. Swift runtime/parser code and upstream test fixtures are not bundled. Its line-oriented HTML parsing and dropping empty folders do not meet our preservation requirements. [Full license](third-party/arcmark/LICENSE).
- Chromium `0e66b94549a8bd85f03fbdf189b752d6e7b63c32`: BookmarksFileImporter and BookmarkCodec remain the preferred native integration candidates. No Chromium files copied into this module: native C++ decoding/bridge is unavailable to this independent Node module. Organizer should compare native importer output against these preservation tests before replacing the adapter. Chromium distribution notices remain organizer-owned.

Only public source snapshots were consulted; fixtures in test/fixtures are newly authored synthetic example.com data. No real browser Profile or credentials were read.
