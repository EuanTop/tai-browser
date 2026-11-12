#!/usr/bin/env python3
"""Build and smoke-test the native sidebar overlay using baseline artifacts.

Finite local pipeline, not a scheduler. Use a completed baseline, or a verified
intentional handoff from a partial baseline build, then compile incrementally.
"""
import argparse
import datetime
import fcntl
import hashlib
import json
import os
from pathlib import Path
from workspace_paths import CHROMIUM_LOCK, require_integration_checkout
from workspace_paths import WORKSPACE
import shutil
import subprocess
import sys
import time

from native_overlay import ROOT, SOURCE, STAGE, OWN_FILES, apply, own_source, sha, stage

LOCAL = ROOT / 'research/local'
OUT = SOURCE / 'out/SidebarBaseline'
DEPOT = WORKSPACE / 'toolchains/depot_tools'
BINARY = OUT / 'Chromium.app/Contents/MacOS/Chromium'


def now():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def read_json(path):
    # Existing preparation writes can briefly truncate its receipt.
    for _ in range(5):
        try:
            return json.loads(path.read_text())
        except json.JSONDecodeError:
            time.sleep(.2)
    raise RuntimeError('Receipt remained incomplete: ' + str(path))


def run():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--wait-for-baseline', action='store_true')
    parser.add_argument('--reuse-partial-baseline', action='store_true',
                        help='Reuse a deliberately interrupted, recorded clean baseline build')
    parser.add_argument('--jobs', type=int, choices=range(1, 7), default=4)
    parser.add_argument('--incremental-existing-build', action='store_true',
                        help='Require existing browser/dylibs and reserve 7 GiB for an incremental UI rebuild; default reserve remains 20 GiB')
    parser.add_argument('--qa-candidate', action='store_true',
                        help='Compile and verify artifacts for isolated QA without marking the product validated')
    args = parser.parse_args()
    lock = read_json(ROOT / 'chromium.lock.json')
    state = {'status': 'running', 'phase': 'checking_baseline', 'pid': os.getpid(),
             'revision': lock['revision'], 'started_at': now()}
    receipt = LOCAL / 'product-build.json'

    def save():
        temporary = receipt.with_suffix('.tmp')
        temporary.write_text(json.dumps(state, indent=2) + '\n')
        temporary.replace(receipt)
        print(json.dumps(state), flush=True)

    def require(condition, message):
        if not condition:
            raise RuntimeError(message)

    def execute(phase, command, env=None, cwd=SOURCE):
        state['phase'] = phase
        state['command'] = command
        save()
        with (LOCAL / ('product-' + phase + '.log')).open('a') as log:
            log.write('\nAttempt: ' + now() + '\n')
            log.flush()
            result = subprocess.run(command, cwd=cwd, env=env,
                                    stdout=log, stderr=subprocess.STDOUT)
        require(result.returncode == 0,
                phase + ' failed; inspect product-' + phase + '.log')

    save()
    try:
        deadline = time.monotonic() + 4 * 60 * 60
        # Acquire the same lock used by dependency preparation and baseline
        # compilation. No source/GN mutations while that build is running.
        with CHROMIUM_LOCK.open('a') as preparation:
            announced = False
            while True:
                try:
                    fcntl.flock(preparation.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
                    break
                except BlockingIOError:
                    require(args.wait_for_baseline,
                            'Baseline/preparation is active; use --wait-for-baseline')
                    require(time.monotonic() < deadline, 'Baseline wait exceeded four hours')
                    if not announced:
                        state['phase'] = 'waiting_for_baseline'
                        save()
                        announced = True
                    time.sleep(5)
            baseline = read_json(LOCAL / 'chromium-build.json')
            partial = args.reuse_partial_baseline
            if partial:
                handoff = read_json(LOCAL / 'baseline-product-handoff.json')
                require(handoff.get('status') == 'ready' and
                        handoff.get('revision') == lock['revision'] and
                        handoff.get('baseline_started_at') == baseline.get('started_at') and
                        baseline.get('status') == 'failed',
                        'Partial build needs a verified intentional handoff record')
                for previous in ('hooks', 'gen'):
                    confirmation = read_json(LOCAL / ('chromium-' + previous + '.json'))
                    require(confirmation.get('status') == 'completed' and
                            confirmation.get('observed_revision') == lock['revision'],
                            'Partial reuse requires successful baseline tools and GN')
                require((OUT / 'build.ninja').is_file(), 'Partial build graph is missing')
                state['baseline_status'] = 'partial_artifacts_reused'
            else:
                require(baseline.get('status') == 'completed' and
                        baseline.get('observed_revision') == lock['revision'],
                        'The locked unmodified baseline must finish successfully first')
                require(BINARY.is_file(), 'Baseline browser executable is missing')
            require(WORKSPACE.resolve().is_mount(), 'External development disk is not mounted')
            reserve_gib = 20
            if args.incremental_existing_build:
                require(all(path.is_file() for path in (BINARY, OUT / 'libchrome_dll.dylib', OUT / 'libbrowser_ui_views.dylib')),
                        'Incremental reserve requires an existing compiled browser and UI libraries')
                # Repeated pinned UI rebuilds relink a ~162 MiB component in
                # 5–28 steps. Seven GiB retains substantial incremental headroom;
                # unrelated source changes are still rejected before compiling.
                reserve_gib = 7
            state['required_free_gib'] = reserve_gib
            require(shutil.disk_usage(WORKSPACE).free >= reserve_gib * 1024**3,
                    f'Less than {reserve_gib} GiB remains; inspect disk before compiling')
            depot_revision = subprocess.check_output(
                ['git', 'rev-parse', 'HEAD'], cwd=DEPOT, text=True).strip()
            require(depot_revision == lock['depot_tools_revision'],
                    'Build tools differ from the pinned version')
            expected = stage()
            # A completed baseline provides every generated header for prechecks.
            # Partial reuse defers this full check until compilation generates
            # the remaining prerequisites; missing headers never count as a pass.
            if not partial and not args.qa_candidate:
                execute('typecheck', [sys.executable,
                        str(ROOT / 'tools/check_native_sources.py')], cwd=ROOT)
            manifest_bytes = (STAGE / 'manifest.json').read_bytes()
            manifest = json.loads(manifest_bytes)
            require(manifest == expected, 'Overlay changed during review checks')
            state['overlay_sha256'] = hashlib.sha256(manifest_bytes).hexdigest()
            state['baseline_finished_at'] = baseline['finished_at']
            state['phase'] = 'applying_overlay'
            save()
            # All tracked files must be either the exact baseline bytes or our
            # exact staged bytes. Reject unrelated changes anywhere in src.
            changed = subprocess.check_output(
                ['git', 'diff', '--name-only', 'HEAD'], cwd=SOURCE, text=True).splitlines()
            require(set(changed).issubset(manifest['files']),
                    'Unrelated Chromium edits need review before product build')
            apply()
            env = os.environ.copy()
            env.update({'PATH': str(DEPOT) + os.pathsep + env.get('PATH', ''),
                        'DEPOT_TOOLS_UPDATE': '0', 'DEPOT_TOOLS_METRICS': '0',
                        'CIPD_CACHE_DIR': str(WORKSPACE / 'build-cache/cipd'),
                        'VPYTHON_VIRTUALENV_ROOT': str(WORKSPACE / 'build-cache/vpython'),
                        'TMPDIR': str(WORKSPACE / 'tmp')})
            execute('gen', [str(SOURCE / 'buildtools/mac/gn'), 'gen', str(OUT),
                            '--root=' + str(SOURCE),
                            '--fail-on-unused-args', '--args=' +
                            (ROOT / 'config/mac-arm64-dev.gn').read_text()], env)
            execute('compile', [str(DEPOT / 'autoninja'), '-C', str(OUT),
                                '-j' + str(args.jobs), 'chrome'], env)
            if partial and not args.qa_candidate:
                execute('typecheck', [sys.executable,
                        str(ROOT / 'tools/check_native_sources.py')], cwd=ROOT)
            for name, record in manifest['files'].items():
                require(sha((SOURCE / name).read_bytes()) == record['after'],
                        'Source changed while compiling: ' + name)
            for name in OWN_FILES:
                require(sha(own_source(name).read_bytes()) == manifest['files']['sidebar_browser/' + name]['after'],
                        'Project source changed while compiling: ' + name)
            for name, digest in manifest.get('resource_inputs', {}).items():
                require(sha((ROOT / name).read_bytes()) == digest, 'Resource input changed while compiling: ' + name)
            require(BINARY.is_file(), 'Build succeeded without expected executable')
            state.update(status='compiled', phase='compiled', binary=str(BINARY),
                         binary_sha256=sha(BINARY.read_bytes()),
                         scope='Spaces, settings and browser-only scoped local host compiled; runtime checks pending',
                         artifact_sha256={name: sha((OUT / name).read_bytes()) for name in
                                          ('libchrome_dll.dylib', 'libbrowser_ui_views.dylib')})
            save()
            if not args.qa_candidate:
                execute('smoke', [sys.executable, str(ROOT / 'tools/smoke_product.py')], cwd=ROOT)
                execute('webui_smoke', ['node', str(ROOT / 'tools/smoke_tai_ui.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                execute('settings_brand_smoke', ['node', str(ROOT / 'tools/smoke_native_settings.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                execute('host_smoke', ['node', str(ROOT / 'tools/smoke_native_host.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                execute('panel_smoke', ['node', str(ROOT / 'tools/smoke_native_panel.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                execute('home_smoke', ['node', str(ROOT / 'tools/smoke_native_home.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                execute('mcp_smoke', ['node', str(ROOT / 'tools/smoke_native_mcp.mjs'), str(BINARY), str(ROOT)], cwd=ROOT)
                state.update(status='completed', phase='native_smoke_passed',
                             scope='Spaces, settings, retired feature denial/data preservation, per-window Agent panel, scoped Unix IPC, official MCP transport and background DOM tested with synthetic data; '
                                   'full browsing-session, physical interaction and extension acceptance pending')
    except Exception as error:
        state.update(status='failed', error=str(error))
    state['finished_at'] = now()
    save()
    succeeded = state['status'] == ('compiled' if args.qa_candidate else 'completed')
    return 0 if succeeded else 1


if __name__ == '__main__':
    require_integration_checkout()
    CHROMIUM_LOCK.parent.mkdir(parents=True, exist_ok=True)
    LOCAL.mkdir(parents=True, exist_ok=True)
    with (LOCAL / 'product-pipeline.lock').open('a') as pipeline:
        try:
            fcntl.flock(pipeline.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Product pipeline is already running')
        raise SystemExit(run())
