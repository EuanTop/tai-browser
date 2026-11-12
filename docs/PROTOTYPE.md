# Build a local development browser

Use macOS on Apple Silicon with Xcode and its command-line tools, Python 3, Node.js 22 or later, Git, and ample free space on APFS. Keep the full build path free of spaces. The [Chromium build documentation](https://chromium.googlesource.com/chromium/src/+/main/docs/mac_build_instructions.md) describes the upstream requirements.

Clone the product repository into a dedicated workspace. The scripts place the pinned Chromium checkout, depot_tools and caches beside the product checkout. See [workspace layout](WORKSPACE-LAYOUT.md) for an optional configuration file.

Run these commands from the product checkout. Each stage writes a local receipt and logs under `research/local/`.

```sh
npm ci --prefix modules/migration --ignore-scripts
python3 tools/prepare_chromium.py --stage sync
python3 tools/prepare_chromium.py --stage bootstrap
python3 tools/prepare_chromium.py --stage hooks
python3 tools/prepare_chromium.py --stage gen
python3 tools/prepare_chromium.py --stage build
python3 tools/build_product.py --jobs 6
python3 tools/run_product.py
```

The development runner uses separate browser data and the build output directory. The release DMG is self-contained. See the [release guide](REPOSITORY-AND-RELEASE.md) for packaging.
