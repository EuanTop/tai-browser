#!/usr/bin/env python3
"""Type-check staged native UI sources using the pinned Chromium compiler flags.

This does not modify the active baseline or produce/link a product browser.
"""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import shlex
import subprocess

from native_overlay import ROOT, SOURCE, STAGE, OMNIBOX, OMNIBOX_INPUT, SCHEME_CLASSIFIER, LOCATION_IDENTITY, FOCUS, BINDERS, REGION, STATE, COMMANDS, RESTORE, CONTEXT, TOOLBAR, LOCATION, WIDGET, BROWSER_VIEW, PAGES, COMMAND_CONTROLLER, KEY_DISPATCH, MULTI_CONTENTS, RELOAD, WEBUI_RELOAD, WEBUI, UNTRUSTED, PANEL_ID_IMPL, OWN_FILES, stage
from settings_overlay import NATIVE_FILES


def compiler_flags(build, source, object_file):
    recipe = subprocess.check_output([
        str(SOURCE / 'third_party/ninja/ninja'), '-C', str(build),
        '-t', 'commands', '-s', object_file,
    ], text=True)
    original = shlex.split(recipe.splitlines()[-1])
    if 'clang++' not in original[0] or original[-4:] != [
            '-c', '../../' + source, '-o', object_file]:
        raise ValueError('Unexpected Chromium compiler recipe for ' + source)
    command = [original[0], '-I', str(STAGE)]
    skip = False
    for arg in original[1:-4]:
        if skip:
            skip = False
        elif arg == '-MF':
            skip = True
        elif arg != '-MMD':
            command.append(arg)
    return command + ['-fsyntax-only']


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--out', type=Path, default=SOURCE / 'out/SidebarBaseline')
    args = parser.parse_args()
    manifest = stage()
    output = ROOT / 'research/local/native-source-check'
    output.mkdir(parents=True, exist_ok=True)
    build = args.out.resolve()
    command = compiler_flags(
        build, REGION,
        'obj/chrome/browser/ui/views/frame/vertical_tab_strip_region_view/vertical_tab_strip_region_view.o')
    objc_command = compiler_flags(
        build, KEY_DISPATCH,
        'obj/chrome/browser/ui/cocoa/cocoa/chrome_command_dispatcher_delegate.o')
    results = []
    for name in tuple('sidebar_browser/' + name for name in OWN_FILES if name.endswith(('.cc', '.mm'))) + NATIVE_FILES + (OMNIBOX, OMNIBOX_INPUT, SCHEME_CLASSIFIER, LOCATION_IDENTITY, FOCUS, BINDERS, PANEL_ID_IMPL, WEBUI, UNTRUSTED, REGION, STATE, COMMANDS, RESTORE, CONTEXT, TOOLBAR, LOCATION, WIDGET, BROWSER_VIEW, PAGES, COMMAND_CONTROLLER, KEY_DISPATCH, MULTI_CONTENTS, RELOAD, WEBUI_RELOAD):
        log = output / (Path(name).stem + '.log')
        with log.open('w') as stream:
            flags = objc_command if name.endswith('.mm') else command
            result = subprocess.run(flags + [str(STAGE / name)], cwd=build,
                                    stdout=stream, stderr=subprocess.STDOUT)
        results.append({'source': name, 'exit_code': result.returncode,
                        'log': str(log)})
        print(name, 'PASS' if result.returncode == 0 else 'FAIL', flush=True)
        if result.returncode:
            print(log.read_text()[-12000:], flush=True)
    receipt = {'revision': manifest['revision'], 'checks': results,
               'manifest_sha256': hashlib.sha256(
                   (STAGE / 'manifest.json').read_bytes()).hexdigest(),
               'passed': all(r['exit_code'] == 0 for r in results),
               'scope': 'syntax/type checking only; no linking or runtime validation',
               'finished_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    (output / 'result.json').write_text(json.dumps(receipt, indent=2) + '\n')
    return 0 if receipt['passed'] else 1


if __name__ == '__main__':
    raise SystemExit(main())
