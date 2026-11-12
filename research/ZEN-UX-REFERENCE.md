# Zen interaction reference — 2026-10-18

Source: https://github.com/zen-browser/desktop at `82722a84450eede9f19319ed02868f53ee497fd9` (shallow source checkout only; Firefox engine and personal browser data are not accessed).

- Official workspace documentation: https://docs.zen-browser.app/user-manual/workspaces — workspace selection lives at the bottom of the sidebar. Workspaces organize tabs; account containers are a separate concern.
- `src/zen/drag-and-drop/ZenDragAndDrop.js`: before/after tab insertion, folder targets, an explicit drop indicator, delayed switching when hovering a Space.
- `src/zen/tabs/ZenPinnedTabManager.mjs`: distinct essential, pinned and normal tab destinations. Dropping changes organization as well as order.
- `src/zen/tabs/zen-tabs/vertical-tabs.css`: essential website icons use centered grid cells.

Our Chromium implementation uses Chromium Views/OS drag data and existing TabModel/WebContents ownership. It does not copy Firefox's tab/window internals. Same-Profile windows may transfer a live TabModel. Cross-Profile moves and Arc/Zen's full desktop tear-off gesture are separate work; an explicit “移到新窗口” command is supplied.

Review focus for this iteration: continuous sidebar surface, equal centered Favorite cells, reorder/save/unpin/folder/Space drop destinations, delayed Space hover switching, per-Space colors with a custom hex entry and persistent storage. A physical Zen installation was not available; the reference review uses official source and the user's Arc screenshots.
