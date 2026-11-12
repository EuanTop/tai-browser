#!/usr/bin/env python3
"""Start the compiled baseline with a separate test profile on the external disk."""
import json
from pathlib import Path
import subprocess

from workspace_paths import ROOT, WORKSPACE
SOURCE = WORKSPACE / 'chromium/src'
BINARY = SOURCE / 'out/SidebarBaseline/Chromium.app/Contents/MacOS/Chromium'
PROFILE = ROOT / 'research/local/browser-profiles/baseline'


def main():
    if not BINARY.is_file():
        raise SystemExit('The baseline browser has not been built yet')
    receipt = ROOT / 'research/local/chromium-build.json'
    if not receipt.exists():
        raise SystemExit('No successful baseline build receipt; inspect the build first')
    built = json.loads(receipt.read_text())
    lock = json.loads((ROOT / 'chromium.lock.json').read_text())
    if built.get('status') != 'completed' or built.get('observed_revision') != lock['revision']:
        raise SystemExit('Build receipt does not confirm the locked baseline')
    if (ROOT / 'research/local/native-overlay-installed.json').exists():
        raise SystemExit('This build directory now contains the product overlay; use tools/run_product.py')
    if subprocess.run(['git', 'diff', '--quiet', 'HEAD', '--',
                       'chrome/browser/ui/BUILD.gn',
                       'chrome/browser/ui/views/frame/vertical_tab_strip_region_view.cc',
                       'chrome/browser/ui/tabs/vertical_tab_strip_state_controller.cc'],
                      cwd=SOURCE).returncode:
        raise SystemExit('Native sources differ from the baseline; review before launching')
    if not PROFILE.exists():
        default = PROFILE / 'Default'
        default.mkdir(parents=True)
        # Seed only a brand-new test profile; never rewrite an existing profile.
        (default / 'Preferences').write_text(json.dumps({
            'vertical_tabs': {'enabled': True},
        }) + '\n')
    command = [str(BINARY), '--user-data-dir=' + str(PROFILE),
               '--no-first-run', '--no-default-browser-check',
               '--use-mock-keychain', 'about:blank']
    print('Launching isolated Chromium baseline:', BINARY, flush=True)
    return subprocess.run(command, check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
