#!/usr/bin/env python3
"""Mount the external TAi image at a space-free path; keep one parent entry.

A copy lives beside the disk image so it also works while the repo is offline.
"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import subprocess

APFS_VOLUME = '41504653-0000-11AA-AA11-00306543ECAC'


def native_mount():
    return Path('/Users/Shared') / ('.tai-volume-' + str(os.getuid())) / 'workspace'


def mount(parent, relocate=False):
    parent = parent.resolve()
    config = json.loads((parent / 'records/统一目录记录.json').read_text())
    image = parent / 'storage/workspace.sparsebundle'
    workspace = parent / 'workspace'
    # The bytes live in the image under TAi/storage. This is only a mountpoint,
    # not an internal-disk copy. Symlinks alone cannot hide spaces from getcwd().
    native = native_mount()
    if ' ' in str(native):
        raise RuntimeError('本机账户路径含空格，需单独配置构建挂载点。')
    native.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if native.parent.stat().st_uid != os.getuid():
        raise RuntimeError('构建挂载目录不属于当前用户，已停止。')
    if native.is_symlink() or (native.exists() and not native.is_mount() and any(native.iterdir())):
        raise RuntimeError('构建挂载点被其他内容占用，已保留。')
    native.mkdir(exist_ok=True)
    previous_native = workspace.resolve()
    relocated = False
    if previous_native.is_mount() and previous_native != native:
        if (workspace / '.tai-workspace-id').read_text().strip() != config['workspace_id']:
            raise RuntimeError('旧挂载不是本项目工作区，已停止。')
        if not relocate:
            raise RuntimeError('旧挂载路径含空格；退出构建后用 --relocate-mount 迁移挂载点。')
        subprocess.run(['/usr/sbin/diskutil', 'unmount', str(previous_native)], check=True)
        relocated = True
    if not workspace.is_symlink():
        # Refuse to hide any real directory contents.
        if workspace.exists():
            workspace.rmdir()
        workspace.symlink_to(native, target_is_directory=True)
    elif workspace.resolve() != native:
        if not relocated:
            raise RuntimeError('工作区入口指向其他位置，已保留。')
        workspace.unlink()
        workspace.symlink_to(native, target_is_directory=True)
    identity = native / '.tai-workspace-id'
    if not identity.is_file():
        inventory = plistlib.loads(subprocess.check_output(
            ['/usr/bin/hdiutil', 'info', '-plist']))
        attached = [entry for entry in inventory.get('images', [])
                    if Path(entry.get('image-path', '/')).resolve() == image]
        if len(attached) > 1:
            raise RuntimeError('发现重复挂载记录，已停止，请检查工作区。')
        if attached:
            entities = attached[0].get('system-entities', [])
            if any(entry.get('mount-point') for entry in entities):
                raise RuntimeError('映像已挂载在其他位置，请先正常退出并卸载。')
        else:
            info = plistlib.loads(subprocess.check_output([
                '/usr/bin/hdiutil', 'attach', '-nomount', '-nobrowse',
                '-plist', str(image)]))
            entities = info.get('system-entities', [])
        volumes = [entry['dev-entry'] for entry in entities
                   if entry.get('content-hint') == APFS_VOLUME]
        if len(volumes) != 1:
            raise RuntimeError('未找到唯一的 APFS 工作区卷，已停止。')
        # hdiutil's automatic mount rejects this external mountpoint. Disk
        # Arbitration supports explicitly mounting the owned volume here.
        subprocess.run(['/usr/sbin/diskutil', 'mount', 'nobrowse', '-mountPoint',
                        str(native), volumes[0]], check=True)
    if identity.read_text().strip() != config['workspace_id']:
        raise RuntimeError('工作区身份不匹配，已停止。')
    if not native.is_mount():
        raise RuntimeError('工作区没有正确挂载，已停止。')
    alias = Path.home() / '.cache/tai-workspace'
    alias.parent.mkdir(exist_ok=True)
    if alias.is_symlink():
        if alias.resolve() != native:
            raise RuntimeError('构建快捷路径指向其他位置，已保留，请检查。')
    elif alias.exists():
        raise RuntimeError('构建快捷路径被其他文件占用，已保留，请检查。')
    else:
        alias.symlink_to(workspace, target_is_directory=True)
    config['native_mount'] = str(native)
    config['mount_method'] = 'space-free mountpoint with one TAi/workspace symlink; image remains under TAi/storage'
    (parent / 'records/统一目录记录.json').write_text(json.dumps(config, ensure_ascii=False, indent=2)+'\n')
    print('TAi 工作区已就绪：' + str(workspace), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--parent', type=Path, required=True)
    parser.add_argument('--relocate-mount', action='store_true', help='Normally unmount legacy workspace and remount at the fixed build path; refuses busy volumes')
    args = parser.parse_args()
    try:
        mount(args.parent, args.relocate_mount)
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit('挂载失败：' + str(error)) from error


if __name__ == '__main__':
    main()
