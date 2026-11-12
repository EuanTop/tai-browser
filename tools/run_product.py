#!/usr/bin/env python3
"""Launch the built native prototype with its own initially empty profile."""
import json
from pathlib import Path
import subprocess
import shutil

from native_overlay import ROOT, SOURCE, OWN_FILES, own_source, sha

PROFILE = ROOT / 'research/local/browser-profiles/sidebar-product'
BINARY = SOURCE / 'out/SidebarBaseline/Chromium.app/Contents/MacOS/Chromium'


def validate_build(allow_compiled=False):
    receipt_path = ROOT / 'research/local/product-build.json'
    if not receipt_path.exists():
        raise SystemExit('Native product is not built yet; inspect build_product.py')
    receipt = json.loads(receipt_path.read_text())
    lock = json.loads((ROOT / 'chromium.lock.json').read_text())
    installed_path = ROOT / 'research/local/native-overlay-installed.json'
    statuses = ('compiled', 'completed') if allow_compiled else ('completed',)
    if (receipt.get('status') not in statuses or receipt.get('revision') != lock['revision']
            or not installed_path.exists() or not BINARY.is_file()):
        raise SystemExit('Product build is incomplete; inspect product-build.json')
    return validate_artifacts(receipt)


def validate_artifacts(receipt):
    """Verify bytes only. Callers must separately enforce the build status."""
    installed_path = ROOT / 'research/local/native-overlay-installed.json'
    if sha(installed_path.read_bytes()) != receipt['overlay_sha256']:
        raise SystemExit('Installed overlay does not match the completed build')
    installed = json.loads(installed_path.read_text())
    for name, record in installed['files'].items():
        if sha((SOURCE / name).read_bytes()) != record['after']:
            raise SystemExit('Rebuild after changing product source: ' + name)
    for name, digest in installed.get('resource_inputs', {}).items():
        if sha((ROOT / name).read_bytes()) != digest:
            raise SystemExit('Rebuild after changing a component resource: ' + name)
    if sha(BINARY.read_bytes()) != receipt['binary_sha256']:
        raise SystemExit('Browser executable changed after the verified build')
    for name, digest in receipt.get('artifact_sha256', {}).items():
        artifact = BINARY.parents[3] / name
        if not artifact.is_file() or sha(artifact.read_bytes()) != digest:
            raise SystemExit('Browser component changed after the verified build: ' + name)
    for name in OWN_FILES:
        if sha(own_source(name).read_bytes()) != installed['files']['sidebar_browser/' + name]['after']:
            raise SystemExit('Rebuild after changing project source: ' + name)
    return receipt


def launch_command(profile):
    return [str(BINARY), '--sidebar-browser',
            '--user-data-dir=' + str(profile.resolve()), '--no-first-run',
            '--no-default-browser-check', '--use-mock-keychain',
            '--restore-last-session', '--tai-agent-node=' + (shutil.which('node') or ''),
            '--tai-agent-entry=' + str(ROOT / 'modules/agent-tools/native-stdio.mjs')]


def main():
    validate_build()
    first_launch = not PROFILE.exists()
    if first_launch:
        default = PROFILE / 'Default'
        default.mkdir(parents=True)
        (default / 'Preferences').write_text(json.dumps({
            'vertical_tabs': {'enabled': True},
            'session': {'restore_on_startup': 1},
        }) + '\n')
    # No personal Arc/Chrome data is read or imported. The mock keychain is a
    # development-only setting and cannot validate real password persistence.
    log = ROOT / 'research/local/development-browser.log'
    command = launch_command(PROFILE) + [
        '--enable-logging', '--log-file=' + str(log),
        '--vmodule=space_navigation_view=1',
    ]
    if first_launch:
        command.append("chrome://tai/home.html")
    print(f'Launching TAi Browser development build. Log: {log}', flush=True)
    return subprocess.run(command, check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
