#!/usr/bin/env python3
"""Recover only empty, unborn repositories left by interrupted gclient fetches."""
import concurrent.futures
import datetime
import fcntl
import json
import os
from pathlib import Path
from workspace_paths import CHROMIUM_LOCK, require_integration_checkout
import subprocess

from audit_chromium_checkout import ROOT, CHECKOUT, audit
from chromium_mirrors import transport_aliases


def main():
    report = audit()
    failures = report['failures']
    if any(item['status'] != 'missing_head' for item in failures):
        raise SystemExit('Repair only admits empty repositories without HEAD; inspect other discrepancies')
    aliases = transport_aliases(CHECKOUT / 'src', json.loads((ROOT / 'chromium.lock.json').read_text())['repository'])
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d-%H%M%S')
    output = ROOT / 'research/local' / ('checkout-repair-' + stamp)
    output.mkdir()
    environment = os.environ.copy()
    environment.update({'GIT_TERMINAL_PROMPT': '0', 'GIT_CONFIG_COUNT': '3',
                        'GIT_CONFIG_KEY_0': 'http.version', 'GIT_CONFIG_VALUE_0': 'HTTP/1.1',
                        'GIT_CONFIG_KEY_1': 'http.lowSpeedLimit', 'GIT_CONFIG_VALUE_1': '1024',
                        'GIT_CONFIG_KEY_2': 'http.lowSpeedTime', 'GIT_CONFIG_VALUE_2': '120'})

    def repair(item):
        path = CHECKOUT / item['path']
        result = dict(item)
        try:
            if not path.resolve().is_relative_to(CHECKOUT.resolve()) or path.is_symlink():
                raise ValueError('Repository path is outside the checkout')
            if not (path / '.git').is_dir() or any(p.name != '.git' for p in path.iterdir()):
                raise ValueError('Repository contains files; preserve and inspect them')
            if subprocess.check_output(['git', '-C', str(path), 'ls-files'], text=True).strip():
                raise ValueError('Repository contains index entries; preserve and inspect them')
            origin = subprocess.check_output(['git', '-C', str(path), 'remote', 'get-url', 'origin'], text=True).strip()
            if origin != item['repository']:
                raise ValueError('Unexpected repository origin')
            url = origin
            for upstream in sorted(aliases, key=len, reverse=True):
                if origin.startswith(upstream):
                    url = aliases[upstream] + origin[len(upstream):]
                    break
            result['transport_url'] = url
            log_path = output / (item['path'].replace('/', '_') + '.log')
            with log_path.open('w') as log:
                available = subprocess.run(['git', '-C', str(path), 'cat-file', '-e',
                                            item['expected_revision'] + '^{commit}'],
                                           stdout=log, stderr=log, env=environment)
                if available.returncode:
                    fetched = subprocess.run(['git', '-C', str(path), 'fetch', '--no-tags', '--depth=1',
                                              url, item['expected_revision']], env=environment,
                                             stdout=log, stderr=log, timeout=240)
                    if fetched.returncode:
                        raise RuntimeError('Pinned dependency fetch failed; inspect ' + str(log_path))
                if any(p.name != '.git' for p in path.iterdir()):
                    raise ValueError('Files appeared during fetch; inspect before checkout')
                checkout = subprocess.run(['git', '-C', str(path), 'checkout', '--detach',
                                           item['expected_revision']], env=environment,
                                          stdout=log, stderr=log, timeout=120)
                if checkout.returncode:
                    raise RuntimeError('Non-forced checkout failed; inspect ' + str(log_path))
            observed = subprocess.check_output(['git', '-C', str(path), 'rev-parse', 'HEAD'], text=True).strip()
            if observed != item['expected_revision']:
                raise ValueError('Unexpected HEAD after checkout')
            result.update(status='recovered', observed_revision=observed)
        except Exception as error:
            result.update(status='failed', error=str(error))
        print(json.dumps(result), flush=True)
        return result

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(repair, failures))
    (output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
    return 0 if all(item['status'] == 'recovered' for item in results) else 1


if __name__ == '__main__':
    require_integration_checkout()
    CHROMIUM_LOCK.parent.mkdir(parents=True, exist_ok=True)
    with (CHROMIUM_LOCK).open('a') as preparation_lock:
        try:
            fcntl.flock(preparation_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Chromium preparation is already running')
        raise SystemExit(main())
