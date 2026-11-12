#!/usr/bin/env python3
"""Verify a default Space is saved without any organization actions.

Only uses a fresh disposable product profile. This checks initial persistence;
normal shutdown/session restoration is a separate native/UI acceptance test.
"""
import datetime
import json
from pathlib import Path
import subprocess
import tempfile
import time
import uuid

from native_overlay import ROOT
from run_product import launch_command, validate_build


def main():
    build = validate_build()
    local = ROOT / 'research/local'
    profile = Path(tempfile.mkdtemp(prefix='default-space-check-',
                                   dir=local / 'browser-profiles'))
    state_file = profile / 'Default/SidebarWorkspace.json'
    result = {'passed': False, 'profile': str(profile),
              'overlay_sha256': build['overlay_sha256'],
              'scope': 'default Space written before any organization action',
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    with (local / 'default-space-check-browser.log').open('w') as log:
        browser = subprocess.Popen(launch_command(profile), stdout=log, stderr=log)
        try:
            deadline = time.monotonic() + 20
            snapshot = None
            while time.monotonic() < deadline:
                if browser.poll() is not None:
                    raise RuntimeError('Browser exited before initial persistence')
                if state_file.exists():
                    snapshot = json.loads(state_file.read_text())
                    break
                time.sleep(.1)
            if snapshot is None:
                raise RuntimeError('No default organization file before user actions')
            spaces = snapshot.get('spaces', [])
            if (snapshot.get('version') != 1 or len(spaces) != 1 or
                    snapshot.get('active') != spaces[0].get('id') or
                    snapshot.get('items') != []):
                raise RuntimeError('Initial default workspace is inconsistent')
            uuid.UUID(spaces[0]['id'])
            result.update(passed=True, default_space_id=spaces[0]['id'])
        except Exception as error:
            result['error'] = str(error)
        finally:
            # This process belongs exclusively to the fresh disposable profile.
            # Do not find/stop any existing user browser or process group.
            if browser.poll() is None:
                browser.terminate()
                try:
                    browser.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    browser.kill()
                    browser.wait()
            result['test_process_exit_code'] = browser.returncode
    result['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    (local / 'default-space-check.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))
    return 0 if result['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
