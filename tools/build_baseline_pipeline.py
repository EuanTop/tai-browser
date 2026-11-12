#!/usr/bin/env python3
"""Continue the current successful sync through hooks, GN, and baseline build."""
import datetime
import argparse
import fcntl
import json
import os
from pathlib import Path
from workspace_paths import CHROMIUM_LOCK, require_integration_checkout
import subprocess
import sys
import time

from workspace_paths import ROOT, WORKSPACE
LOCAL = ROOT / 'research/local'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--resume-build', action='store_true',
                        help='Reuse successful hooks/GN receipts and prepare Python before retrying the build')
    parser.add_argument('--wait-for-metal', action='store_true',
                        help='Follow the current Apple Metal component download, validate it, then resume')
    args = parser.parse_args()
    lock = json.loads((ROOT / 'chromium.lock.json').read_text())
    receipt = LOCAL / 'chromium-sync.json'
    state = {'status': 'running', 'phase': 'waiting_for_sync', 'pid': os.getpid(),
             'revision': lock['revision'], 'started_at': now()}
    state_path = LOCAL / 'baseline-pipeline.json'

    def save():
        temporary = state_path.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, ensure_ascii=False, indent=2) + '\n')
        temporary.replace(state_path)
        print(json.dumps(state, ensure_ascii=False), flush=True)

    save()
    try:
        deadline = time.monotonic() + 4 * 60 * 60
        # A sync's initial validation can precede its receipt update. Wait for
        # the owner to release the same lock before selecting its final receipt.
        with CHROMIUM_LOCK.open('a') as preparation_lock:
            while True:
                try:
                    fcntl.flock(preparation_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    if time.monotonic() > deadline:
                        raise RuntimeError('Current Chromium preparation exceeded the waiting deadline')
                    time.sleep(2)
            sync = json.loads(receipt.read_text())
        identity = (sync.get('started_at'), sync.get('pid'))
        if sync.get('revision') != lock['revision']:
            raise RuntimeError('The current sync belongs to a different baseline')
        state['sync_started_at'] = sync.get('started_at')
        save()
        while True:
            # The prep process writes a small receipt in place; tolerate only
            # a transient partial write while it is alive.
            try:
                sync = json.loads(receipt.read_text())
            except json.JSONDecodeError:
                if time.monotonic() > deadline:
                    raise RuntimeError('Dependency sync receipt remained incomplete')
                os.kill(identity[1], 0)
                time.sleep(1)
                continue
            if (sync.get('started_at'), sync.get('pid')) != identity:
                raise RuntimeError('Sync identity changed; inspect the replacement run')
            if sync.get('status') == 'completed':
                break
            if sync.get('status') != 'running':
                raise RuntimeError('Dependency sync failed; inspect chromium-sync.log')
            if time.monotonic() > deadline:
                raise RuntimeError('Waiting for dependency sync exceeded four hours')
            try:
                os.kill(sync['pid'], 0)
            except ProcessLookupError:
                raise RuntimeError('Sync process stopped without a completion receipt')
            time.sleep(10)
        if args.wait_for_metal:
            state['phase'] = 'waiting_for_metal_toolchain'
            save()
            component_path = LOCAL / 'metal-component-install.json'
            component = json.loads(component_path.read_text())
            component_identity = component['started_at']
            component_deadline = time.monotonic() + 2 * 60 * 60
            while component.get('status') == 'running':
                if time.monotonic() > component_deadline:
                    raise RuntimeError('Metal component download exceeded two hours')
                time.sleep(5)
                try:
                    component = json.loads(component_path.read_text())
                except json.JSONDecodeError:
                    continue
                if component.get('started_at') != component_identity:
                    raise RuntimeError('Metal component download identity changed')
            if component.get('status') != 'completed':
                raise RuntimeError('Apple Metal component download failed; inspect its log')
            state['phase'] = 'validating_metal_toolchain'
            save()
            with (LOCAL / 'metal-component-validation.log').open('a') as log:
                probe = subprocess.run(['xcrun', 'metal', '--version'], stdout=log, stderr=log, timeout=30)
                if probe.returncode:
                    bundles = list(Path(component['export_path']).glob('*.exportedBundle'))
                    if len(bundles) != 1:
                        raise RuntimeError('Expected one exported Apple Metal component bundle')
                    imported = subprocess.run(['xcodebuild', '-importComponent', 'MetalToolchain',
                                               '-importPath', str(bundles[0])],
                                              stdout=log, stderr=log, timeout=600)
                    if imported.returncode:
                        raise RuntimeError('Apple Metal component import failed; inspect validation log')
                    probe = subprocess.run(['xcrun', 'metal', '--version'], stdout=log, stderr=log, timeout=30)
                    if probe.returncode:
                        raise RuntimeError('Metal compiler is still unavailable after import')
                failed_rule = WORKSPACE / 'chromium/src/out/SidebarBaseline/siso_failed_commands.sh'
                if failed_rule.is_file():
                    checked = subprocess.run(['/bin/sh', str(failed_rule)], stdout=log, stderr=log, timeout=120)
                    if checked.returncode:
                        raise RuntimeError('Previously failed Metal build action still fails')
            state['metal_validation_passed'] = True
        stages = ('bootstrap', 'hooks', 'gen', 'build')
        if args.resume_build:
            for previous in ('hooks', 'gen'):
                confirmation = json.loads((LOCAL / f'chromium-{previous}.json').read_text())
                if confirmation.get('status') != 'completed' or confirmation.get('observed_revision') != lock['revision']:
                    raise RuntimeError('Cannot resume before successful hooks and GN for this baseline')
            stages = ('bootstrap', 'build')
        for stage in stages:
            state['phase'] = stage
            save()
            result = subprocess.run([
                sys.executable, str(ROOT / 'tools/prepare_chromium.py'),
                '--stage', stage, '--source-mirror', sync.get('source_mirror', 'canonical'),
                '--checkout-configuration', sync.get('checkout_configuration', 'small'),
            ], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE, text=True)
            if result.returncode:
                raise RuntimeError(f'{stage} failed (exit {result.returncode}); ' +
                                   result.stderr[-2000:] + f'; inspect chromium-{stage}.log')
        binary = WORKSPACE / 'chromium/src/out/SidebarBaseline/Chromium.app/Contents/MacOS/Chromium'
        if not binary.is_file():
            raise RuntimeError('Build returned success but the expected browser is missing')
        state.update(status='completed', phase='built', binary=str(binary))
    except Exception as error:
        state.update(status='failed', error=str(error))
    state['finished_at'] = now()
    save()
    return 0 if state['status'] == 'completed' else 1


if __name__ == '__main__':
    require_integration_checkout()
    CHROMIUM_LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / 'baseline-pipeline.lock').open('a') as pipeline_lock:
        try:
            fcntl.flock(pipeline_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('A baseline build pipeline is already running')
        raise SystemExit(main())
