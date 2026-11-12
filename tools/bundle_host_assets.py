#!/usr/bin/env python3
"""Bundle existing component business code with Chromium's pinned esbuild.

No user dependency installation and no C++ compilation for app previews.
This tool is the product developer's static first-party resource build.
"""
import hashlib
import json
from pathlib import Path
import subprocess
from workspace_paths import ROOT,SOURCE

ENTRIES = {
    name: Path('src/host/web') / entry for name, entry in {
        'reader': 'reader-entry.mjs',
        'pomodoro': 'pomodoro-entry.mjs',
        'bootstrap': 'surface-bootstrap.mjs',
        'library': 'library-entry.mjs',
        'components': 'studio-entry.mjs',
    }.items()
}
ENTRIES['welcome-import'] = Path('modules/migration/src/welcome.mjs')

def bundle():
    tool=SOURCE/'third_party/devtools-frontend/src/third_party/esbuild/esbuild'
    if not tool.is_file():raise RuntimeError('Pinned Chromium esbuild is unavailable')
    output=ROOT/'research/local/host-bundles';output.mkdir(parents=True,exist_ok=True)
    result={}
    fingerprints={}
    for name,entry in ENTRIES.items():
        target=output/(name+'.js');meta=output/(name+'.meta.json')
        subprocess.run([str(tool),str(ROOT / entry),'--bundle','--format='+('iife' if name=='bootstrap' else 'esm'),'--platform=browser','--external:chrome://*','--legal-comments=inline','--charset=utf8','--outfile='+str(target),'--metafile='+str(meta),'--log-level=error'],cwd=ROOT,check=True)
        for relative in json.loads(meta.read_text())['inputs']:
            path=(ROOT/relative).resolve()
            if not path.is_relative_to(ROOT.resolve()):raise RuntimeError('Bundle escaped product checkout')
            fingerprints[relative]=hashlib.sha256(path.read_bytes()).hexdigest()
        result[name]=target.read_text()
    manifest={'toolVersion':subprocess.check_output([str(tool),'--version'],text=True).strip(),'inputs':fingerprints}
    (output/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
    return result

if __name__=='__main__':
    bundle();print('First-party host bundles ready')
