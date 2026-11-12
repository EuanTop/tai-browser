# Development workspace

Put the product checkout and the pinned Chromium checkout on an APFS volume with a path free of spaces. The default workspace is the parent of the integration checkout. To select another workspace, set `TAI_WORKSPACE_CONFIG` to a local JSON file using [the example configuration](../config/workspace.example.json).

```text
workspace/
  sidebar-browser/     TAi integration checkout
  chromium/src/        pinned Chromium checkout
  toolchains/          depot_tools and build tools
  build-cache/         dependency caches and shared build lock
  worktrees/           optional TAi feature worktrees
```

Run shared Chromium preparation, overlay application and native builds from the integration checkout. Feature worktrees can run independent tests. Build logs and synthetic profiles are generated under `research/local/` and are ignored by Git. See [the development build guide](PROTOTYPE.md).
