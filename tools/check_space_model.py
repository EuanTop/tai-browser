#!/usr/bin/env python3
"""Compile and exercise the organization model without a Chromium checkout."""
from pathlib import Path
import subprocess

from workspace_paths import ROOT


def main():
    output = ROOT / 'research/local/space-model-check'
    output.mkdir(parents=True, exist_ok=True)
    binary = output / 'space_model_test'
    command = ['xcrun', 'clang++', '-std=c++20', '-Wall', '-Wextra', '-Werror',
               '-fno-exceptions', '-fno-rtti', '-fsanitize=address,undefined',
               '-g', '-I', str(ROOT / 'src'),
               str(ROOT / 'src/sidebar/space_model.cc'),
               str(ROOT / 'tests/space_model_test.cc'), '-o', str(binary)]
    subprocess.run(command, check=True)
    subprocess.run([str(binary)], check=True)


if __name__ == '__main__':
    main()
