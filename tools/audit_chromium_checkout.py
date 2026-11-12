#!/usr/bin/env python3
"""Check actual Git dependency HEADs against the successful gclient inventory."""
import ast
import concurrent.futures
import json
from pathlib import Path
import re
import subprocess

from workspace_paths import ROOT, WORKSPACE
CHECKOUT = WORKSPACE / 'chromium'


def audit():
    inventory = CHECKOUT / '.gclient_entries'
    tree = ast.parse(inventory.read_text(), filename=str(inventory))
    entries = None
    for statement in tree.body:
        if isinstance(statement, ast.Assign) and any(isinstance(t, ast.Name) and t.id == 'entries' for t in statement.targets):
            entries = ast.literal_eval(statement.value)
    if not isinstance(entries, dict):
        raise ValueError('No literal gclient entries inventory found')
    selected = []
    for relative, url in entries.items():
        if not isinstance(url, str) or not url.startswith('https://'):
            continue
        repository, _, revision = url.rpartition('@')
        if not re.fullmatch(r'[a-f0-9]{40}', revision):
            continue
        # Inventory paths must stay under this owned checkout.
        path = CHECKOUT / relative
        if '..' in Path(relative).parts or Path(relative).is_absolute():
            raise ValueError('Unexpected inventory path')
        selected.append((relative, repository, revision, path))

    def inspect(item):
        relative, repository, revision, path = item
        result = {'path': relative, 'repository': repository, 'expected_revision': revision}
        if not (path / '.git').exists():
            return dict(result, status='missing_repository')
        actual = subprocess.run(['git', '--no-optional-locks', '-C', str(path),
                                 'rev-parse', '--verify', 'HEAD'],
                                capture_output=True, text=True, timeout=30)
        if actual.returncode:
            return dict(result, status='missing_head')
        observed = actual.stdout.strip()
        return dict(result, status='verified' if observed == revision else 'revision_mismatch',
                    observed_revision=observed)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        repositories = list(pool.map(inspect, selected))
    failures = [r for r in repositories if r['status'] != 'verified']
    report = {'scope': 'Actual Git HEAD identities only; not a working-tree-content or CIPD audit',
              'repositories': repositories, 'checked': len(repositories),
              'verified': len(repositories) - len(failures), 'failures': failures,
              'passed': bool(repositories) and not failures}
    output = ROOT / 'research/local/chromium-checkout-audit.json'
    output.write_text(json.dumps(report, indent=2) + '\n')
    return report


if __name__ == '__main__':
    result = audit()
    print(json.dumps({k: result[k] for k in ('checked', 'verified', 'failures', 'passed')}, indent=2))
    raise SystemExit(0 if result['passed'] else 1)
