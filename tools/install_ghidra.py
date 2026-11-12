#!/usr/bin/env python3
"""Install the REA-compatible, digest-pinned official Ghidra release on the dev disk."""
import hashlib
import json
from pathlib import Path
import subprocess
import urllib.request
import zipfile

from workspace_paths import WORKSPACE as ROOT
NAME = 'ghidra_12.1.4_PUBLIC_20260921.zip'
URL = 'https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/' + NAME
DIGEST = 'ddac49f903da9d5bac833e5cc79395098b9c33cfd3279be5f31bd00387d2d4db'


def main():
    if not ROOT.resolve().is_mount():
        raise SystemExit('Mount the TAi workspace first')
    downloads = ROOT / 'downloads'
    tools = ROOT / 'toolchains'
    downloads.mkdir(exist_ok=True)
    tools.mkdir(exist_ok=True)
    archive = downloads / NAME
    if not archive.exists():
        partial = archive.with_suffix('.zip.partial')
        request = urllib.request.Request(URL, headers={'User-Agent': 'sidebar-browser-research'})
        count = 0
        with urllib.request.urlopen(request, timeout=45) as response, partial.open('wb') as out:
            while chunk := response.read(1024 * 1024):
                count += len(chunk)
                if count > 1024 * 1024 * 1024:
                    raise ValueError('Download exceeds the 1 GiB package budget')
                out.write(chunk)
                if count % (64 * 1024 * 1024) == 0:
                    print(f'Downloaded {count // 1024**2} MiB', flush=True)
        partial.rename(archive)
    with archive.open('rb') as source:
        actual = hashlib.file_digest(source, 'sha256').hexdigest()
    if actual != DIGEST:
        raise SystemExit('Ghidra archive digest mismatch; refusing to extract')
    destination = tools / 'ghidra_12.1.4_PUBLIC'
    if destination.exists():
        raise SystemExit('Installation directory exists; refusing to overwrite')
    with zipfile.ZipFile(archive) as package:
        for info in package.infolist():
            path = Path(info.filename)
            if path.is_absolute() or '..' in path.parts or path.parts[0] != destination.name:
                raise ValueError('Unexpected archive path')
    subprocess.run(['/usr/bin/ditto', '-x', '-k', str(archive), str(tools)], check=True)
    receipt = {'release': '12.1.4', 'url': URL, 'sha256': actual, 'installation': str(destination),
               'scope': 'External development disk only; no global client configuration changed'}
    (tools / 'ghidra-install.json').write_text(json.dumps(receipt, indent=2) + '\n')
    print(json.dumps(receipt, indent=2), flush=True)


if __name__ == '__main__':
    main()
