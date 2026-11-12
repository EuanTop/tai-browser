# Contributing to TAi Browser / 参与开发

Contributions should improve a concrete browsing or agent-control workflow. Start with the [README](README.md) ([中文](README.zh-CN.md)) and [current product focus](docs/PRODUCT-FOCUS.md); use [Issues](https://github.com/EuanTop/tai-browser/issues) for a reproducible bug or a focused proposal. This guide is for contributors. For installation and everyday use, see [Getting started](docs/GETTING-STARTED.md).

Before changing code, read [AGENTS.md](AGENTS.md) and the relevant [acceptance boundaries](docs/PRODUCT-ACCEPTANCE.md). Keep changes focused, preserve user data, and describe what you actually verified.

当前主线是独立 Chromium 浏览器的配置、组织、交互及外部 Agent 控制。内置剪藏/资料库/阅读与轻应用路线已退出，既有源码、worktree 和用户数据保留；不为完成旧计划而恢复入口。

## Reuse before building / 先复用，再开发

Follow the [reuse policy](docs/REUSE-POLICY.md): inspect mature upstream capabilities and open-source projects before implementing a module. Record the version, source, license, adopted part, remaining gap and actual validation. Do not confuse an interface found in source with a feature proven to work in TAi.

自有浏览器 UI 与组织逻辑保存在本仓库。Chromium 使用 [`chromium.lock.json`](chromium.lock.json) 的精确修订；不修改 Blink、V8、网络栈或沙箱。不要在 Chromium 中生成的 `sidebar_browser/` 副本开发。

## Workspace and Git / 工作区与分支

Keep everything under one TAi project parent, with separate directories for the integration repository, pinned Chromium, toolchains, worktrees and cache. See [workspace layout](docs/WORKSPACE-LAYOUT.md) and [repository/release management](docs/REPOSITORY-AND-RELEASE.md). The historical repository directory name `sidebar-browser` remains for tool compatibility; the product name is TAi Browser.

新贡献者先按[原型说明](docs/PROTOTYPE.md)准备完整 Chromium 工作区；克隆产品仓库不等于获得完整编译环境。可使用 `TAI_WORKSPACE_CONFIG` 指向本机 JSON，格式见 [`config/workspace.example.json`](config/workspace.example.json)。目前没有跨机器完整一键安装器。

- Start a focused `feat/<task>` or `fix/<task>` branch from reviewed `main`. Use a separate worktree when parallel work is actually arranged; keep it under `workspace/worktrees/`, outside the integration repository.
- Define file ownership and acceptance criteria before parallel edits. Preserve existing historical worktrees and branches; do not reset, delete or overwrite another contributor's work.
- Review the diff and required checks before merging a change into `main`.
- Keep product changes separate from unrelated documentation or tooling changes when that makes them easier to review. Never rewrite published history to hide a failed iteration.

**共享 Chromium 只能由 `workspace/sidebar-browser/` 集成 checkout 串行操作。** prepare、repair、overlay apply、原生 build 与运行检查共用 `workspace/build-cache/locks/chromium.lock`，工具会拒绝在功能 worktree 执行。其他 worktree 只运行不改共享上游的独立模块检查。构建期间冻结产品源码，避免生成副本与收据不一致。

## Checks and evidence / 检查与证据

Run checks appropriate to the changed behavior:

```sh
python3 tools/check_workspace_model.py
python3 tools/check_space_model.py
python3 -m unittest discover -s tests -p test_chromium_mirrors.py
git diff --check
```

模型检查在 macOS 使用 Xcode 命令行编译器及 ASan/UBSan。`test_native_overlay.py` 需要锁定的 Chromium 文件创建 fixture，不是无依赖 CI。原生代码还需类型检查、构建、运行检查和相关真实窗口验证；文档修改不要求重编 Chromium。独立模块使用其自身声明的测试入口。

已存在完整浏览器和 UI 动态库时，`build_product.py --incremental-existing-build` 允许使用较小的增量空间预留，并仍执行全部产品门禁。它不是首次构建或大范围重建的捷径；`--reuse-partial-baseline` 仅用于工具认可的已有交接记录，不能随意添加。先检查工具的 `--help` 和实际资源条件。

For an isolated QA loop, `build_product.py --qa-candidate --jobs 1` stops after verifying the compiled artifacts. Install them with `install_local_app.py --qa-candidate` and a new app path, bundle ID and Profile. Candidate receipts keep the `compiled` status while runtime checks are pending.

If a runtime phase fails while source and compiled artifacts remain unchanged, `tools/resume_product_checks.py` can resume the remaining checks after verifying revisions and hashes. A source change or compile failure requires the normal build path. Do not disable a failing check to produce a passing receipt.

报告区分模块测试、原生运行检查和物理交互验收。截图不能证明触控板、拖放或焦点行为；MCP 配置已注册不能证明客户端已连接，合成客户端通过也不能冒称真实 Agent 模型对话成功。具体边界记录在[产品验收](docs/PRODUCT-ACCEPTANCE.md)。

For README preview assets, run `node tools/capture_readme.mjs` from the integration checkout after a validated native build. It captures the compiled new-tab page using a synthetic Profile and records provenance in `docs/images/readme/capture.json`. Do not use personal browsing screenshots or old concepts depicting retired features as current product screenshots. Documentation-only changes need appropriate link, rendering and diff checks, not a Chromium rebuild.

## Data and dependencies / 数据与依赖

- Use synthetic fixtures for browser and migration tests. Read personal Chrome/Arc data only when a user explicitly selects an import source; source data remains read-only.
- Preserve TAi Profiles, site data and historical feature files during updates. Test artifacts and logs go to ignored local directories, not source control.
- Do not commit credentials, `.env`, cookies, Profiles, private research captures, downloaded application binaries, `node_modules`, Chromium checkouts or build products. Inspect the staged file list and diff before committing; `.gitignore` is not a review.
- The welcome page uses the pinned migration module parser dependencies. Install them for native resource staging with `npm ci --prefix modules/migration --ignore-scripts`.
- Pin dependency versions and keep original copyright/license notices. The root BSD license applies to TAi-authored work, not all dependencies. A complete binary notice inventory is a separate release requirement.


## Release / 发行

Review the source and verify the standalone app, identity, notices, signature and installation without the development disk before publishing. Alpha releases document their signature and notarization status. See the [release gates](docs/REPOSITORY-AND-RELEASE.md). Review the [open-source checklist](docs/OPEN-SOURCE-REVIEW.md) before publishing. Use [private security reporting](SECURITY.md) for vulnerabilities.

界面增量模式 `--incremental-existing-build` 需已有完整浏览器和 UI 动态库，预留 7 GiB；默认仍预留 20 GiB。当前锁定基线多轮 5–28 步 UI 增量编译的新增占用低于 1 GiB，7 GiB 仍保留额外余量。增加依赖、全量/非组件发行构建不应使用此模式；类型、运行、安装检查不因此省略。
