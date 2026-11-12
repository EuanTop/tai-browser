# TAi v1 shared boundaries

`v1/types.d.ts` describes the initial DTOs; `v1/index.mjs` provides dependency-free adapter validation. Run `node --test contracts/v1/contracts.test.mjs`. Native enforcement is still required: these JS checks are not a security sandbox or an implemented browser bridge.

- Opaque Profile/Space/Page IDs come from the host. Task bindings never follow foreground navigation. Only the native broker may determine the actual page owner/capability.
- Components implement business logic once. User UI and external Agent adapters consume the same component APIs. AI owns transports/channel delivery, not another Agent loop.
- Migration adapters return a `MigrationPlan`, without writing the browser model. Source IDs identify entries, not URLs; intentional repeated URLs and empty folders survive. Unsupported content produces structured warning codes, without leaking source URLs to logs. Native application handles snapshot/preview/commit/undo later.
- Clip capture receives an authorized snapshot `{url,title,html,selectionHtml?,scope,capturedAt}`; it returns a `ClipDocument`. Library operations use an explicitly selected local root handle/library ID. No raw system path/credential in an Agent tool payload. Persistence/DOM/native adapters remain separately integrated.
- Readers accept `{format:'markdown'|'json',text,baseResourceId?}` and a scoped resource resolver. They never receive arbitrary filesystem privileges.
- Lightweight app packages use the versioned manifest; SDK actions request host operations, never shell/Node/C++ access. Preview, apply and rollback operate on explicit module/version IDs. Native isolation and install validation remain organizer work.
- Settings declarations are module-owned; the shared settings host owns persistence, scope, credential references and application. Existing Chromium settings/history/extension managers remain the upstream implementation.

These are deliberately small first contracts, not a complete platform. Propose contract changes in a focused pull request. Source adapters and tests may import `contracts/v1/index.mjs` relatively without installing a shared runtime. Do not claim a fixture or standalone demo is already integrated into Chromium.

Native host v1 is now available for the scoped page and selected-library subset; see [NATIVE-HOST](../docs/NATIVE-HOST.md). `page.list` and library read/list/immutable put use the same envelope. Inclusion in COMMANDS never grants execution: native task allowlists and actual ownership remain authoritative. Surface calls remain first-party UI operations; they are not available to an external Agent task yet.
