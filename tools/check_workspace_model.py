#!/usr/bin/env python3
"""Exercise persistent workspace hierarchy with memory and UB checks."""
from pathlib import Path
import subprocess
from workspace_paths import ROOT
out = ROOT / 'research/local/workspace-model-check'
out.mkdir(parents=True, exist_ok=True)
binary = out / 'workspace_model_test'
subprocess.run(['xcrun', 'clang++', '-std=c++20', '-Wall', '-Wextra', '-Werror',
                '-fno-exceptions', '-fno-rtti', '-fsanitize=address,undefined',
                '-g', '-I', str(ROOT / 'src'), str(ROOT / 'src/sidebar/workspace_model.cc'),
                str(ROOT / 'tests/workspace_model_test.cc'), '-o', str(binary)], check=True)
subprocess.run([str(binary)], check=True)
