#!/usr/bin/env python3
"""Resume a failed runtime phase only while all compiled source bytes match.

Keeps the completed compiler/type checks and earlier successful runtime phases;
never permits installation until every remaining runtime phase succeeds.
"""
import datetime
import fcntl
import json
import os
from pathlib import Path
import subprocess
import sys
from workspace_paths import ROOT, SOURCE, CHROMIUM_LOCK, require_integration_checkout
from run_product import BINARY, validate_artifacts

PHASES = [('smoke', 'smoke_product.py'), ('webui_smoke', 'smoke_tai_ui.mjs'),
          ('settings_brand_smoke', 'smoke_native_settings.mjs'),
          ('host_smoke', 'smoke_native_host.mjs'), ('panel_smoke', 'smoke_native_panel.mjs'),
          ('home_smoke', 'smoke_native_home.mjs'), ('mcp_smoke', 'smoke_native_mcp.mjs')]

def now(): return datetime.datetime.now(datetime.timezone.utc).isoformat()

def main():
    require_integration_checkout()
    local = ROOT / 'research/local'
    receipt = local / 'product-build.json'
    with (local / 'product-pipeline.lock').open('a') as pipeline, CHROMIUM_LOCK.open('a') as lock:
        fcntl.flock(pipeline, fcntl.LOCK_EX | fcntl.LOCK_NB)
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        state = json.loads(receipt.read_text())
        phases = [name for name, _ in PHASES]
        if state.get('status') != 'failed' or state.get('phase') not in phases:
            raise SystemExit('Only a failed runtime phase can be resumed')
        pinned = json.loads((ROOT / 'chromium.lock.json').read_text())
        types = json.loads((local / 'native-source-check/result.json').read_text())
        if (state.get('revision') != pinned['revision'] or not types.get('passed') or
                types.get('manifest_sha256') != state.get('overlay_sha256')):
            raise SystemExit('Verified compiler/type-check receipt does not match; rebuild required')
        validate_artifacts(state)
        start = phases.index(state['phase'])
        state.update(status='compiled', pid=os.getpid(), resumed_at=now(), resumed_from_phase=state['phase'])
        state.pop('error', None)
        def save():
            temporary = receipt.with_suffix('.tmp')
            temporary.write_text(json.dumps(state, indent=2) + '\n'); temporary.replace(receipt)
        try:
            for phase, file in PHASES[start:]:
                state['phase'] = phase; save()
                command = [sys.executable, str(ROOT / 'tools' / file)] if file.endswith('.py') else ['node', str(ROOT / 'tools' / file), str(BINARY), str(ROOT)]
                print('Checking ' + phase, flush=True)
                with (local / ('product-' + phase + '.log')).open('a') as stream:
                    stream.write('\nResumed attempt: ' + now() + '\n'); stream.flush()
                    result = subprocess.run(command, cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT)
                if result.returncode: raise RuntimeError(phase + ' failed; installation remains blocked')
            validate_artifacts(state)
            state.update(status='completed', phase='native_smoke_passed',
                         scope='All native runtime phases passed with verified compiler/type checks and byte-identical source/artifacts; physical UI acceptance is separate')
        except (Exception, SystemExit) as error:
            state.update(status='failed', error=str(error))
        state['finished_at'] = now(); save()
        print(state['status'], flush=True)
        return 0 if state['status'] == 'completed' else 1

if __name__ == '__main__': raise SystemExit(main())
