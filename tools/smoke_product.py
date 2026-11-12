#!/usr/bin/env python3
"""Run the opt-in native integration probe in a brand-new product test profile."""
import argparse
import datetime
import http.server
import threading
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time

from native_overlay import ROOT
from run_product import launch_command, validate_build


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    # Cold component builds on the external workspace can spend minutes in
    # filesystem I/O. Keep a bounded watchdog without changing any assertion.
    parser.add_argument('--timeout-seconds', type=int, choices=range(60, 601), default=300)
    args = parser.parse_args()
    build = validate_build(allow_compiled=True)
    local = ROOT / 'research/local'
    profiles = local / 'browser-profiles'
    profiles.mkdir(parents=True, exist_ok=True)
    profile = Path(tempfile.mkdtemp(prefix='native-smoke-', dir=profiles))
    # --user-data-dir is a root containing Chromium's actual Default profile.
    # The native probe deliberately writes only inside that Profile path.
    default = profile / 'Default'
    default.mkdir()
    # This probe exercises the main window after onboarding. The home smoke
    # separately starts from an empty profile and tests the welcome card.
    space_id = 'native-smoke-space'
    (default / 'SidebarWorkspace.json').write_text(json.dumps({
        'version': 1, 'active': space_id, 'welcome_pending': False,
        'spaces': [{'id': space_id, 'name': 'Personal'}], 'items': [],
    }) + '\n')
    output = default / 'SidebarSmoke.json'

    class ReloadFixture(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.end_headers()
            self.wfile.write(b'<title>TAi cookie reload fixture</title><p>Disposable test page</p>')
        def log_message(self, *_):
            pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), ReloadFixture)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    command = launch_command(profile) + ['--enable-logging=stderr',
        '--vmodule=space_navigation_view=1', '--sidebar-browser-smoke-test',
        '--sidebar-cookie-smoke-url=http://127.0.0.1:' + str(server.server_port) + '/']
    receipt = {'status': 'running', 'profile': str(profile), 'result_path': str(output),
               'revision': build['revision'], 'overlay_sha256': build['overlay_sha256'],
               'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
               'timeout_seconds': args.timeout_seconds}
    record = local / 'native-smoke.json'

    def save():
        record.write_text(json.dumps(receipt, indent=2) + '\n')

    save()
    with (local / 'native-smoke-browser.log').open('w') as log:
        browser = subprocess.Popen(command, stdout=log, stderr=subprocess.STDOUT,
                                   start_new_session=True)
        receipt['pid'] = browser.pid
        save()
        try:
            deadline = time.monotonic() + args.timeout_seconds
            while True:
                if output.exists():
                    try:
                        results = json.loads(output.read_text())
                        break
                    except json.JSONDecodeError:
                        # The browser writes on a worker thread; file creation
                        # alone does not establish a complete JSON result.
                        pass
                if browser.poll() is not None:
                    raise RuntimeError('Browser stopped before native integration results were written')
                if time.monotonic() > deadline:
                    raise RuntimeError(f'Native integration test exceeded {args.timeout_seconds} seconds')
                time.sleep(.5)
            checks = results.get('checks', [])
            receipt['results'] = results
            save()
            if (results.get('passed') is not True or len(checks) < 10 or
                    any(item.get('passed') is not True for item in checks)):
                receipt['results'] = results
                raise RuntimeError('Native integration assertions failed')
            exit_code = browser.wait(timeout=30)
            if exit_code != 0:
                raise RuntimeError('Native integration browser did not exit cleanly')
            receipt.update(status='completed', results=results)
        except Exception as error:
            receipt.update(status='failed', error=str(error))
        finally:
            if browser.poll() is None:
                # Only this newly created process group; never touch an existing
                # Arc/Chrome process or any other user browser window.
                try:
                    os.killpg(browser.pid, signal.SIGTERM)
                except ProcessLookupError:
                    pass
                try:
                    browser.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    try:
                        os.killpg(browser.pid, signal.SIGKILL)
                    except ProcessLookupError:
                        pass
                    browser.wait()
    server.shutdown()
    server.server_close()
    receipt['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    save()
    print(json.dumps(receipt, indent=2))
    return 0 if receipt['status'] == 'completed' else 1


if __name__ == '__main__':
    raise SystemExit(main())
