#!/usr/bin/env python3
"""Install a Finder-launchable local TAi app; not a portable release package.

Snapshots Chromium's component libraries beside the installed app. Each
installation has its own launcher, identity, icon and Agent adapter.
"""
import argparse
import fcntl
import datetime
import os
import hashlib
import json
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import tempfile

from run_product import validate_artifacts, validate_build
from workspace_paths import ROOT, SOURCE, CHROMIUM_LOCK, require_integration_checkout

OUT = SOURCE / 'out/SidebarBaseline'
SOURCE_APP = OUT / 'Chromium.app'
ICON = ROOT / 'brand/atrium/editions/standard-icon-transparent.png'
INSTALLATIONS = OUT / 'tai-installations'


def run(command):
    try:
        subprocess.run([str(part) for part in command], check=True,
                       stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr.decode('utf-8', errors='replace')) from error


def make_icon(output, temporary):
    # Asset packaging only: resize the approved original without redrawing it.
    iconset = temporary / 'TAi.iconset'
    iconset.mkdir()
    for points in (16, 32, 128, 256, 512):
        for scale in (1, 2):
            pixels = points * scale
            name = f'icon_{points}x{points}' + ('@2x' if scale == 2 else '') + '.png'
            run(['/usr/bin/sips', '-z', pixels, pixels, ICON, '--out', iconset / name])
    run(['/usr/bin/iconutil', '-c', 'icns', iconset, '-o', output])


def validate_install_build(qa_candidate):
    if not qa_candidate:
        return validate_build()
    receipt = json.loads((ROOT / 'research/local/product-build.json').read_text())
    test_phases = {'smoke', 'webui_smoke', 'settings_brand_smoke', 'host_smoke',
                   'panel_smoke', 'home_smoke', 'mcp_smoke'}
    revision = json.loads((ROOT / 'chromium.lock.json').read_text())['revision']
    if (receipt.get('status') == 'failed' and receipt.get('phase') in test_phases
            and receipt.get('revision') == revision
            and receipt.get('artifact_sha256') and receipt.get('binary_sha256')):
        return validate_artifacts(receipt)
    return validate_build(allow_compiled=True)


def install(destination, profile, bundle_id, replace=False, qa_candidate=False):
    require_integration_checkout()
    destination = destination.expanduser().absolute()
    profile = profile.expanduser().absolute()
    if qa_candidate and (replace or profile.exists() or profile.is_symlink() or
                         bundle_id == 'org.tai.browser.development' or
                         destination == Path('/Applications/TAi Browser.app')):
        raise ValueError('QA requires a new app, fresh Profile and separate bundle identifier')
    if destination.suffix != '.app' or not destination.parent.is_dir():
        raise ValueError('Destination must be a new .app in an existing folder')
    if not re.fullmatch(r'[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)+', bundle_id):
        raise ValueError('Invalid bundle identifier')
    previous = None
    if destination.exists() or destination.is_symlink():
        if not replace or not destination.is_symlink():
            raise ValueError('Existing app requires an owned TAi link and explicit --replace')
        previous = destination.resolve()
        receipt_path = previous / 'Contents/Resources/tai-local-install.json'
        owned_parent = (previous.parent == OUT.resolve() or
                        previous.parent.parent == INSTALLATIONS.resolve())
        if not owned_parent or not receipt_path.is_file():
            raise ValueError('Refusing to replace an unrelated app')
        previous_receipt = json.loads(receipt_path.read_text())
        if previous_receipt.get('bundleId') != bundle_id or previous_receipt.get('profile') != str(profile):
            raise ValueError('Existing installation identity or profile differs')
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%d%H%M%S%f')
    installation = INSTALLATIONS / stamp
    bundle = installation / destination.name
    if installation.exists():
        raise ValueError('Versioned app already exists')
    node = shutil.which('node')
    source_entry = ROOT / 'modules/agent-tools/native-stdio.mjs'
    entry = installation / 'agent-runtime/modules/agent-tools/native-stdio.mjs'
    if (not node or not source_entry.is_file() or
            not (source_entry.parent / 'pi-extension.mjs').is_file() or
            not (source_entry.parent / 'node_modules').is_dir()):
        raise ValueError('Node and TAi connection components are required')
    node = str(Path(node).resolve())
    run([node, '-e', "if(Number(process.versions.node.split('.')[0])<22)process.exit(1)"])

    with CHROMIUM_LOCK.open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        build = validate_install_build(qa_candidate)
        original = plistlib.loads((SOURCE_APP / 'Contents/Info.plist').read_bytes())
        INSTALLATIONS.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='.tai-local-app-', dir=INSTALLATIONS) as name:
            temporary = Path(name)
            payload = temporary / 'installation'
            payload.mkdir()
            staged = payload / destination.name
            # The framework's @rpath looks beside the .app. APFS clones keep
            # build outputs and installed copies on separate inodes.
            run(['/bin/cp', '-c', '-p', *sorted(OUT.glob('*.dylib')), payload])
            run(['/bin/cp', '-c', '-p', '-R', '-P', SOURCE_APP, staged])
            runtime = payload / 'agent-runtime'
            runtime_files = [
                'modules/agent-tools/native-stdio.mjs',
                'modules/agent-tools/native-tools.mjs',
                'modules/agent-tools/native-presence.mjs',
                'modules/agent-tools/pi-extension.mjs',
                'modules/agent-tools/bridge.mjs',
                'src/host/client/native-client.mjs',
                'contracts/v1/index.mjs',
            ]
            for name in runtime_files:
                target = runtime / name
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(ROOT / name, target)
            shutil.copytree(source_entry.parent / 'node_modules',
                            runtime / 'modules/agent-tools/node_modules')
            for name, digest in build['artifact_sha256'].items():
                with (payload / name).open('rb') as artifact:
                    if hashlib.file_digest(artifact, 'sha256').hexdigest() != digest:
                        raise ValueError('Installed component does not match the build: ' + name)
            plist = staged / 'Contents/Info.plist'
            info = dict(original)
            info.update(CFBundleIdentifier=bundle_id, CFBundleName='TAi Browser',
                        CFBundleDisplayName='TAi Browser', CFBundleExecutable='TAiLauncher',
                        CFBundleIconFile='tai.icns', NSHumanReadableCopyright='TAi Browser · Chromium contributors')
            # Chromium's catalog name otherwise overrides CFBundleIconFile.
            for key in ('CFBundleIconName', 'CFBundleIcons', 'CFBundleIcons~ipad'):
                info.pop(key, None)
            plist.write_bytes(plistlib.dumps(info))
            resources = staged / 'Contents/Resources'
            make_icon(resources / 'tai.icns', temporary)
            shutil.copyfile(resources / 'tai.icns', resources / 'app.icns')
            for helper in staged.rglob('*.app'):
                helper_plist = helper / 'Contents/Info.plist'
                metadata = plistlib.loads(helper_plist.read_bytes())
                metadata.pop('CFBundleIconName', None)
                icon_name = metadata.get('CFBundleIconFile', 'app.icns')
                if not icon_name.endswith('.icns'): icon_name += '.icns'
                icon_path = helper / 'Contents/Resources' / icon_name
                icon_path.parent.mkdir(exist_ok=True)
                shutil.copyfile(resources / 'tai.icns', icon_path)
                helper_plist.write_bytes(plistlib.dumps(metadata))
            config = temporary / 'tai_local_config.h'
            config.write_text('#define TAI_COMPONENT_LIBRARY ' + json.dumps(str(installation / 'libchrome_dll.dylib')) + '\n'
                              '#define TAI_PROFILE_ARGUMENT ' + json.dumps('--user-data-dir=' + str(profile)) + '\n'
                              '#define TAI_AGENT_NODE_ARGUMENT ' + json.dumps('--tai-agent-node=' + node) + '\n'
                              '#define TAI_AGENT_ENTRY_ARGUMENT ' + json.dumps('--tai-agent-entry=' + str(entry)) + '\n'
                              '#define TAI_QA_CANDIDATE ' + str(int(qa_candidate)) + '\n')
            run(['/usr/bin/xcrun', 'clang', '-arch', 'arm64', '-mmacosx-version-min=13.0',
                 '-Wall', '-Wextra', '-Werror', '-I', temporary,
                 ROOT / 'tools/local_app_launcher.c', '-framework', 'CoreFoundation',
                 '-o', staged / 'Contents/MacOS/TAiLauncher'])
            receipt = {'product': 'TAi Browser', 'developmentOnly': True,
                       'runtimeDirectory': str(installation), 'bundleId': bundle_id,
                       'qaCandidate': qa_candidate,
                       'profile': str(profile), 'usesMockKeychain': qa_candidate,
                       'chromiumVersion': original['CFBundleShortVersionString'],
                       'chromiumRevision': build['revision'],
                       'overlaySha256': build['overlay_sha256'],
                       'binarySha256': build['binary_sha256'],
                       'iconSha256': hashlib.sha256(ICON.read_bytes()).hexdigest(),
                       'previousBundle': str(previous) if previous else None,
                       'agentNode': node, 'agentEntry': str(entry)}
            (resources / 'tai-local-install.json').write_text(json.dumps(receipt, indent=2) + '\n')
            # Local ad-hoc signing follows the upstream macOS inside-out order.
            # No external symlink may cause signing to touch the build inputs.
            for path in staged.rglob('*'):
                if path.is_symlink() and not path.resolve().is_relative_to(staged.resolve()):
                    raise ValueError('Unexpected external symlink in Chromium app')
            for helper in sorted(staged.rglob('*.app'), key=lambda value: len(value.parts), reverse=True):
                run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none',
                     '--preserve-metadata=entitlements,flags', helper])
            for framework in staged.rglob('*.framework'):
                run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', framework])
            run(['/usr/bin/codesign', '--force', '--sign', '-', '--timestamp=none', staged])
            run(['/usr/bin/codesign', '--verify', '--deep', '--strict', staged])
            # The verified source and its component files must remain untouched.
            validate_install_build(qa_candidate)
            payload.rename(installation)
        try:
            # The running old version and the user's profile remain intact.
            temporary_link = destination.parent / ('.tai-install-' + stamp)
            temporary_link.symlink_to(bundle, target_is_directory=True)
            os.replace(temporary_link, destination)
        except BaseException:
            # Preserve the built app for recovery; never erase another app.
            raise RuntimeError('App built at ' + str(bundle) + '; Applications link was not installed')
    return {'application': str(destination), 'bundle': str(bundle), **receipt}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--destination', type=Path, default=Path('/Applications/TAi Browser.app'))
    parser.add_argument('--profile', type=Path, default=Path.home() / 'Library/Application Support/TAi Browser/Development')
    parser.add_argument('--bundle-id', default='org.tai.browser.development')
    parser.add_argument('--replace', action='store_true', help='Atomically update an owned local installation; preserve previous app and profile')
    parser.add_argument('--qa-candidate', action='store_true',
                        help='Install verified compiled bytes for QA with a fresh Profile')
    args = parser.parse_args()
    result = install(args.destination, args.profile, args.bundle_id, args.replace, args.qa_candidate)
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
