#!/usr/bin/env python3
"""Run the project-pinned REA CLI, using external-disk native analysis tools if installed."""
import os
from pathlib import Path
import subprocess
import sys

from workspace_paths import ROOT, WORKSPACE
REA = ROOT / 'tools/rea/node_modules/.bin/rea'
GHIDRA = WORKSPACE / 'toolchains/ghidra_12.1.4_PUBLIC'


def main():
    if not REA.is_file():
        raise SystemExit('The project-pinned REA executable is missing')
    environment = os.environ.copy()
    if GHIDRA.is_dir():
        environment['GHIDRA_INSTALL_DIR'] = str(GHIDRA)
    temporary = WORKSPACE / 'tmp'
    temporary.mkdir(exist_ok=True)
    environment['TMPDIR'] = str(temporary)
    return subprocess.run([str(REA), *sys.argv[1:]], env=environment, check=False).returncode


if __name__ == '__main__':
    raise SystemExit(main())
