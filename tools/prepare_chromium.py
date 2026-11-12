#!/usr/bin/env python3
"""Sync the pinned, unmodified Chromium baseline on the external development disk."""
import argparse
import datetime
import fcntl
import json
import os
from pathlib import Path
from workspace_paths import CHROMIUM_LOCK, require_integration_checkout
import shutil
import subprocess

from chromium_mirrors import transport_aliases
from audit_chromium_checkout import audit

from workspace_paths import ROOT, WORKSPACE
VOLUME = WORKSPACE
CHECKOUT = VOLUME / 'chromium'
DEPOT = VOLUME / 'toolchains/depot_tools'
LOCK = ROOT / 'chromium.lock.json'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage', choices=('sync', 'bootstrap', 'hooks', 'gen', 'build'), default='sync')
    parser.add_argument('--source-mirror', choices=('canonical', 'github'), default='canonical')
    parser.add_argument('--checkout-configuration', choices=('small', 'default'), default='small')
    args = parser.parse_args()
    lock = json.loads(LOCK.read_text())
    if not VOLUME.resolve().is_mount() or ' ' in str(CHECKOUT):
        parser.error('The external development volume must be mounted with a space-free path')
    if not (DEPOT / 'gclient').is_file():
        parser.error('The external depot_tools installation is missing')
    observed = subprocess.check_output(['git', '-C', str(DEPOT), 'rev-parse', 'HEAD'], text=True).strip()
    if observed != lock['depot_tools_revision']:
        parser.error('depot_tools differs from chromium.lock.json; review the new revision first')
    if shutil.disk_usage(VOLUME).free < 20 * 1024**3:
        parser.error('Less than the 20 GiB stop threshold remains; inspect storage before continuing')
    CHECKOUT.mkdir(exist_ok=True)
    solution = {'name': 'src', 'url': lock['repository'], 'managed': False,
                'custom_deps': {}, 'custom_vars': {'checkout_pgo_profiles': False}}
    legacy_config = 'solutions = ' + repr([solution]) + '\ntarget_os = []\n'
    solution['custom_vars']['checkout_configuration'] = args.checkout_configuration
    config = 'solutions = ' + repr([solution]) + '\ntarget_os = []\n'
    config_path = CHECKOUT / '.gclient'
    if config_path.exists() and config_path.read_text() not in (config, legacy_config):
        parser.error('Existing .gclient differs; preserve it and review before changing')
    source = CHECKOUT / 'src'
    if source.exists():
        # Never let dependency sync overwrite product work or an unrelated tree.
        if not (source / '.git').exists():
            parser.error('Existing src is not the expected Git checkout')
        actual = subprocess.check_output(['git', '-C', str(source), 'remote', 'get-url', 'origin'], text=True).strip()
        if actual != lock['repository']:
            parser.error('Existing src has an unexpected origin')
        dirty = subprocess.check_output(['git', '-C', str(source), 'status', '--porcelain'], text=True)
        if dirty.strip():
            parser.error('src contains changes; review them before syncing')
    if args.stage != 'sync':
        if not source.exists():
            parser.error('Sync the source first')
        revision = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        if revision != lock['revision']:
            parser.error('Source revision does not match the baseline')
        dependencies = audit()
        if not dependencies['passed']:
            parser.error('Git dependency audit failed; inspect chromium-checkout-audit.json')
    config_path.write_text(config)
    cache = VOLUME / 'build-cache'
    cache.mkdir(exist_ok=True)
    temporary = VOLUME / 'tmp'
    temporary.mkdir(exist_ok=True)
    env = os.environ.copy()
    env.update({
        'PATH': str(DEPOT) + os.pathsep + env.get('PATH', ''),
        'DEPOT_TOOLS_UPDATE': '0',
        'DEPOT_TOOLS_METRICS': '0',
        'CIPD_CACHE_DIR': str(cache / 'cipd'),
        'VPYTHON_VIRTUALENV_ROOT': str(cache / 'vpython'),
        'UV_CACHE_DIR': str(cache / 'uv'),
        'TMPDIR': str(temporary),
        'GIT_TERMINAL_PROMPT': '0',
        'GIT_CONFIG_COUNT': '3',
        'GIT_CONFIG_KEY_0': 'http.version', 'GIT_CONFIG_VALUE_0': 'HTTP/1.1',
        'GIT_CONFIG_KEY_1': 'http.lowSpeedLimit', 'GIT_CONFIG_VALUE_1': '1024',
        'GIT_CONFIG_KEY_2': 'http.lowSpeedTime', 'GIT_CONFIG_VALUE_2': '120',
    })
    if args.source_mirror == 'github':
        # Transport-only rewrite: the recorded upstream and locked commit stay
        # canonical. This does not write a global or repository Git setting.
        aliases = transport_aliases(source, lock['repository'])
        for index, (upstream, mirror) in enumerate(aliases.items(), start=3):
            env[f'GIT_CONFIG_KEY_{index}'] = f'url.{mirror}.insteadOf'
            env[f'GIT_CONFIG_VALUE_{index}'] = upstream
        env['GIT_CONFIG_COUNT'] = str(3 + len(aliases))
    command_cwd = CHECKOUT
    command = [str(DEPOT / 'gclient')]
    if args.stage == 'sync':
        command += ['sync', '--no-history', '--nohooks', '--jobs=4',
                    '--revision', 'src@' + lock['revision']]
    elif args.stage == 'hooks':
        command += ['runhooks']
    elif args.stage == 'bootstrap':
        # Use the pinned upstream bootstrap function without updating the repo
        # or installing ensure_bootstrap's unrelated lint tool bundles.
        command = ['/bin/bash', '-e', '-c', 'source "$1"; bootstrap_python3',
                   'chromium-python-bootstrap', str(DEPOT / 'bootstrap_python3')]
        command_cwd = DEPOT
    elif args.stage == 'gen':
        gn = source / 'buildtools/mac/gn'
        if not gn.is_file():
            parser.error('GN is missing; complete dependency sync and hooks first')
        command = [str(gn), 'gen', str(source / 'out/SidebarBaseline'),
                   '--root=' + str(source), '--fail-on-unused-args',
                   '--args=' + (ROOT / 'config/mac-arm64-dev.gn').read_text()]
        command_cwd = source
    else:
        if not (DEPOT / 'python3_bin_reldir.txt').is_file():
            parser.error('Initialize the pinned build helper Python with --stage bootstrap first')
        if not (source / 'out/SidebarBaseline/build.ninja').is_file():
            parser.error('Generate out/SidebarBaseline before building')
        command = [str(DEPOT / 'autoninja'), '-C', 'out/SidebarBaseline', '-j4', 'chrome']
        command_cwd = source
    local = ROOT / 'research/local'
    local.mkdir(parents=True, exist_ok=True)
    log_path = local / ('chromium-' + args.stage + '.log')
    record_path = local / ('chromium-' + args.stage + '.json')
    record = {'stage': args.stage, 'command': command, 'checkout': str(CHECKOUT),
              'revision': lock['revision'], 'status': 'running', 'pid': os.getpid(),
              'source_mirror': args.source_mirror,
              'checkout_configuration': args.checkout_configuration,
              'transport_aliases': aliases if args.source_mirror == 'github' else {},
              'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
              'log': str(log_path)}
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2), flush=True)
    with log_path.open('a') as log:
        log.write('\nPreparation attempt: ' + record['started_at'] +
                  ' mirror=' + args.source_mirror + '\n')
        log.flush()
        result = subprocess.run(command, cwd=command_cwd, env=env,
                                stdout=log, stderr=subprocess.STDOUT, check=False)
    exit_code = result.returncode
    if exit_code == 0:
        observed_revision = subprocess.check_output(
            ['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
        record['observed_revision'] = observed_revision
        if observed_revision != lock['revision']:
            exit_code = 2
            record['error'] = 'Completed command left an unexpected source revision'
        elif args.stage == 'sync':
            dependencies = audit()
            record['git_dependencies_checked'] = dependencies['checked']
            record['git_dependencies_verified'] = dependencies['verified']
            if not dependencies['passed']:
                exit_code = 2
                record['error'] = 'gclient exited successfully but Git dependencies are incomplete'
    record.update(status='completed' if exit_code == 0 else 'failed',
                  exit_code=exit_code,
                  finished_at=datetime.datetime.now(datetime.timezone.utc).isoformat())
    record_path.write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps(record, indent=2))
    return exit_code


if __name__ == '__main__':
    require_integration_checkout()
    CHROMIUM_LOCK.parent.mkdir(parents=True, exist_ok=True)
    lock_path = CHROMIUM_LOCK
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open('a') as preparation_lock:
        try:
            fcntl.flock(preparation_lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise SystemExit('Another Chromium preparation is already running')
        raise SystemExit(main())
