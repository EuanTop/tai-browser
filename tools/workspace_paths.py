"""Resolve one shared workspace for the integration checkout and its worktrees.

TAI_WORKSPACE_CONFIG may name a local JSON file with an absolute workspace_root
and optional integration_root (relative to it). No machine config is committed.
Build tools use the existing space-free alias without copying project data.
"""
import json
import os
from pathlib import Path
import subprocess


def product_root(real_root: Path, build_alias: Path) -> Path:
    real_root = real_root.resolve()
    if (build_alias.is_symlink() and
            build_alias.resolve() == real_root.parent and
            ' ' not in str(build_alias)):
        return build_alias / real_root.name
    return real_root


def resolve_workspace(real_root: Path, *, config_path=None, alias=None):
    real_root = real_root.resolve()
    if config_path:
        config_file = Path(config_path).expanduser().resolve(strict=True)
        config = json.loads(config_file.read_text())
        workspace = Path(config['workspace_root']).expanduser()
        if not workspace.is_absolute():
            raise ValueError('workspace_root must be absolute')
        workspace = workspace.resolve(strict=True)
        integration = Path(config.get('integration_root', 'sidebar-browser'))
        if not integration.is_absolute():
            integration = workspace / integration
        integration = integration.resolve(strict=True)
    else:
        # git-common-dir points to the integration .git even from a worktree.
        try:
            common = subprocess.check_output(
                ['git', '-C', str(real_root), 'rev-parse', '--path-format=absolute',
                 '--git-common-dir'], stderr=subprocess.DEVNULL, text=True).strip()
            integration = Path(common).resolve().parent
            if not (integration / 'chromium.lock.json').is_file():
                raise ValueError('Not a TAi integration checkout')
        except (subprocess.CalledProcessError, OSError, ValueError):
            integration = real_root
        workspace = integration.parent
    if not integration.is_relative_to(workspace):
        raise ValueError('integration_root must be inside workspace_root')
    if not real_root.is_relative_to(workspace):
        raise ValueError('Product checkout must be inside the shared workspace')
    build_workspace = workspace
    if alias is not None:
        alias = Path(alias).expanduser()
        if alias.is_symlink() and alias.resolve() == workspace and ' ' not in str(alias):
            build_workspace = alias
    return (build_workspace / real_root.relative_to(workspace), build_workspace,
            build_workspace / integration.relative_to(workspace))


REAL_ROOT = Path(__file__).resolve().parents[1]
ROOT, WORKSPACE, INTEGRATION_ROOT = resolve_workspace(
    REAL_ROOT, config_path=os.environ.get('TAI_WORKSPACE_CONFIG'),
    alias=Path.home() / '.cache/tai-workspace')
SOURCE = WORKSPACE / 'chromium/src'
CHROMIUM_LOCK = WORKSPACE / 'build-cache/locks/chromium.lock'


def require_integration_checkout():
    if ROOT.resolve() != INTEGRATION_ROOT.resolve():
        raise SystemExit('Shared Chromium mutations are integration-only; '
                         'use module tests in this worktree and return a commit.')
