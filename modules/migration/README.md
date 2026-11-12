# TAi migration — authorized snapshot preview

M2 adds a browser controller, dedicated worker and DOM panel around the existing M1 Chrome JSON/HTML, Arc and batch parsers. Source contents remain local, read-only and in memory. It does not discover files, read personal Profiles, import authentication, or write browser data.

```sh
npm ci --ignore-scripts --no-audit --no-fund
npm test
npm run build:browser
```

`npm test` includes the original 14 tests, real worker-thread execution of the production worker, browser platform bundling and actual DOM controls. `build:browser` produces three independent ESM entries in ignored `.context/browser/`. It does not register native resources or deploy to TAi.

The trusted organizer panel supplies the picker, current destination catalog and native ledger/history. Do not export these capabilities to websites, Agents or custom component frames.

```js
import { createMigrationPreview } from '@tai/migration/browser';
import { mountMigrationPanel } from '@tai/migration/panel';

const controller = createMigrationPreview({
  selectSources: async () => [await organizerPickSource()],
  catalog: organizerTargetCatalog,
  ledgers: organizerLedgersBySourceId,
  history: organizerCommittedSourceDigests,
});
const panel = mountMigrationPanel(container, { controller, catalog: organizerTargetCatalog });
// panel.dispose() terminates work and drops the local preview.
```

The current native picker is `sendWithPromise('taiPickSource')` in the trusted host. Its envelope is `{ok,value}` / `{ok:false,error}`; unwrap it before returning the snapshot array. Each `{sourceId,name,text,sha256,bytes}` is checked for shape, 4 MiB UTF-8 budget and native SHA-256 (both hex cases supported), with at most four snapshots. No method accepts a path or externally supplied snapshot. The picker callback itself is a trusted host capability, not proof of authorization if exposed elsewhere.

`controller.select()` invalidates the previous generation before awaiting native selection. `cancel()`, another selection, changed mappings and disposal terminate the old worker. Stale picker completions and queued worker responses cannot overwrite the latest preview. Worker failure never falls back to parsing on the UI thread.

Mapping is explicit: a source Profile selects one catalog `profileId` or the module-local sentinel `'new'`; each source Space selects one of that Profile's catalog `spaceId`s or `'new'`. New containers remain plans. Profiles are distinct even for identical URLs. Blank/invalid/colliding mappings block intent generation. Empty Spaces, empty/nested folders, favorites, saved and temporary areas are visible; long trees render 100 rows at a time. URLs are inert text. Source names never mean a logged-in account.

`createCommitIntent()` produces the review-only DTO. It performs no writes. The import button is always disabled because the native commit/undo API does not exist at this baseline. `createUndoIntent()` only wraps a future native receipt; it cannot authorize or perform undo. No in-memory ledger mutation is presented as import success.

Native source IDs change on every pick. `history: [{sha256,batchId}]` lets the organizer flag an exact previously committed snapshot despite a new source ID. Omitted history is visibly unavailable; an empty array means the host checked and found none. A same-digest history hit or duplicate selected snapshot blocks a repeat intent. Changed-source lineage across new picks still requires organizer's stable lineage/ledger design. Names/URLs cannot establish lineage.

The existing synchronous API remains exported at `@tai/migration`: `parseChromeBookmarks`, `parseBookmarksHTML`, `parseArcSidebar`, `combineMigrationPlans`, `previewBatch`, `previewUndo`, `MigrationError`. The browser controller calls these same implementations inside the worker. SHA-256 source/item/revision IDs remain compatible with M1. Parsing accepts pre-cancellation, item and depth limits; synchronous direct calls cannot process a new abort event mid-traversal, so browser consumers must use the worker adapter.

For a real browser check, supply an explicitly installed Puppeteer Core module entry (validated here with 25.3.0) and Chrome executable:

```sh
TAI_PUPPETEER_MODULE=/absolute/developer/puppeteer-core/lib/puppeteer/puppeteer-core.js \
TAI_CHROME_BIN=/absolute/developer/chrome npm run test:browser
```

This runs 10 assertions using actual browser Web Workers and DOM in a disposable offline Profile. It uses local file modules with a test-only file-access flag, not the TAi WebUI resource/CSP setup. It fails when tools are absent; it does not silently skip. No shared native build or real-account verification occurs.

See THIRD_PARTY.md for reuse and licenses. Arc sidebar recovery remains partial: no complete sessions, split-view relationship recovery, cookies, passwords or extensions.