#!/usr/bin/env python3
"""Verify the REA native decompiler on our own tiny fixture, not on a browser."""
import json
from pathlib import Path
import subprocess
import sys

from workspace_paths import ROOT
OUTPUT = ROOT / 'research/local/toolchain-preflight'


def main():
    OUTPUT.mkdir(parents=True, exist_ok=True)
    source = OUTPUT / 'probe.c'
    binary = OUTPUT / 'probe'
    evidence = OUTPUT / 'decompile.json'
    if evidence.exists():
        raise SystemExit('A preflight result already exists; inspect it before repeating the analysis')
    source.write_text('int sidebar_probe(int spaces, int tabs) { return spaces * 100 + tabs; }\n'
                      'int main(void) { return sidebar_probe(2, 3) == 203 ? 0 : 1; }\n')
    subprocess.run(['xcrun', 'clang', '-O0', '-g', str(source), '-o', str(binary)], check=True)
    command = [sys.executable, str(ROOT / 'tools/run_rea.py'), 'decompile', str(binary),
               '_sidebar_probe', '--provider', 'ghidra', '--json']
    try:
        with evidence.open('w') as out, (OUTPUT / 'decompile.stderr.txt').open('w') as err:
            run = subprocess.run(command, stdout=out, stderr=err, timeout=240, check=False)
        result = json.loads(evidence.read_text())
        passed = run.returncode == 0 and bool(result.get('evidence_id')) and 'error' not in result
        report = {'scope': 'Toolchain verification on an original synthetic fixture, not browser behavior',
                  'passed': passed, 'exit_code': run.returncode, 'evidence_id': result.get('evidence_id'),
                  'message': result.get('message'), 'command': command}
    except (subprocess.TimeoutExpired, json.JSONDecodeError) as error:
        report = {'scope': 'Toolchain verification only', 'passed': False, 'error': str(error)}
    (OUTPUT / 'result.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2), flush=True)
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
