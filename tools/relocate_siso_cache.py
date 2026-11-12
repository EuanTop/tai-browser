#!/usr/bin/env python3
"""Rebase an exported Siso cache after moving this workspace; verify changed bytes.

Does not assert compilation succeeded. Hashes and command/edge signatures remain
unchanged. Mtime identity is refreshed only after matching the recorded SHA256;
optional generated-output restat recovery preserves verified original times.
Use an export from a known pre-move fs state, not a dry-run's state.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import shutil
import struct
import subprocess
from workspace_paths import WORKSPACE, SOURCE, CHROMIUM_LOCK, require_integration_checkout


def rebase(data, old_root, new_root, restore_output_times=False):
    old_prefix=str(old_root).rstrip('/')+'/'
    new_prefix=str(new_root).rstrip('/')+'/'
    counts={'rebased':0,'identical_content_revalidated':0,'changed_or_missing':0,'identical_output_times_restored':0}
    for entry in data['entries']:
        name=entry['name']
        if not name.startswith(old_prefix):continue
        entry['name']=new_prefix+name[len(old_prefix):]
        counts['rebased']+=1
        path=Path(entry['name'])
        try:
            stat=path.stat()
            if stat.st_mtime_ns==entry.get('id',{}).get('mod_time'):continue
            digest=entry.get('digest',{})
            if not path.is_file() or stat.st_size!=digest.get('size_bytes'):
                counts['changed_or_missing']+=1;continue
            with path.open('rb') as stream:
                actual=hashlib.file_digest(stream,'sha256').hexdigest()
            if actual==digest.get('hash'):
                # A relocation rebuild may touch byte-identical generated
                # headers/PCMs and otherwise force every downstream C++ object
                # to rebuild. Restore only a recorded GENERATED file's time,
                # after validating bytes, and never alter source timestamps.
                if restore_output_times and 'cmd_hash' in entry and not path.is_symlink():
                    check=path.stat()
                    if check.st_mtime_ns!=stat.st_mtime_ns or check.st_size!=stat.st_size:
                        raise RuntimeError('File changed during cache verification: '+str(path))
                    os.utime(path,ns=(stat.st_atime_ns,entry['id']['mod_time']))
                    counts['identical_output_times_restored']+=1
                else:
                    entry['id']['mod_time']=stat.st_mtime_ns
                counts['identical_content_revalidated']+=1
            else:counts['changed_or_missing']+=1
        except OSError:counts['changed_or_missing']+=1
    return counts


def reconcile_legacy_deps(path, out, data):
    """Keep Ninja v4 deps times consistent with verified restored outputs.

    Never change dependency IDs/edges. Refuse unknown formats; every adjusted
    output is hashed against the recorded pre-move generated artifact.
    """
    raw=bytearray(path.read_bytes())
    if raw[:16] != b'# ninjadeps\n\x04\x00\x00\x00':
        raise ValueError('Timestamp reconciliation requires legacy Ninja deps v4')
    entries={e['name']:e for e in data['entries'] if 'cmd_hash' in e}
    names=[];pos=16;changed=0;verified={}
    while pos<len(raw):
        if len(raw)-pos<4:raise ValueError('Truncated deps record')
        size=struct.unpack_from('<I',raw,pos)[0];pos+=4
        length=size&0x7fffffff;end=pos+length
        if not length or length%4 or end>len(raw):raise ValueError('Invalid deps record')
        if size&0x80000000:
            if length<12:raise ValueError('Invalid deps output record')
            node,low,high=struct.unpack_from('<III',raw,pos)
            ids=struct.unpack_from('<'+'I'*((length-12)//4),raw,pos+12)
            if node>=len(names) or any(n>=len(names) for n in ids):raise ValueError('Invalid deps node')
            name=str((out/names[node]).resolve())
            entry=entries.get(name)
            if entry and (low|(high<<32)) != entry['id']['mod_time']:
                if name not in verified:
                    file=Path(name);digest=entry.get('digest',{})
                    try:
                        stat=file.stat()
                        if file.is_symlink() or stat.st_size!=digest.get('size_bytes'):
                            verified[name]=False
                        else:
                            with file.open('rb') as stream:
                                verified[name]=hashlib.file_digest(stream,'sha256').hexdigest()==digest.get('hash')
                    except OSError:verified[name]=False
                if verified[name]:
                    timestamp=entry['id']['mod_time']
                    # rebase() already restored times for files it revalidated;
                    # a prior recovery may have restored an identical file too.
                    if Path(name).stat().st_mtime_ns != timestamp:
                        raise ValueError('Deps output timestamp differs from verified cache')
                    struct.pack_into('<II',raw,pos+4,timestamp&0xffffffff,timestamp>>32)
                    changed+=1
        else:
            if length<4 or struct.unpack_from('<I',raw,end-4)[0] != ((~len(names))&0xffffffff):
                raise ValueError('Invalid deps path checksum')
            names.append(bytes(raw[pos:end-4]).rstrip(b'\0').decode('utf-8'))
        pos=end
    if changed:
        temporary=path.with_name(path.name+'.rebase-tmp')
        temporary.write_bytes(raw);temporary.replace(path)
    return changed


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--export',type=Path,required=True)
    parser.add_argument('--old-workspace',required=True)
    parser.add_argument('--backup-dir',type=Path,required=True)
    parser.add_argument('--restore-identical-output-times',action='store_true',help='Restore pre-move timestamps only for byte-identical generated files, keeping normal downstream restat semantics')
    args=parser.parse_args()
    require_integration_checkout()
    out=SOURCE/'out/SidebarBaseline'
    with CHROMIUM_LOCK.open('a') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        args.backup_dir.mkdir(parents=True,exist_ok=False)
        for path in out.iterdir():
            if path.is_file() and (path.name.startswith('.siso') or path.name=='.ninja_log'):
                shutil.copy2(path,args.backup_dir/path.name)
        data=json.loads(args.export.read_text())
        counts=rebase(data,args.old_workspace,WORKSPACE.resolve(),args.restore_identical_output_times)
        if args.restore_identical_output_times:
            counts['deps_timestamps_reconciled']=reconcile_legacy_deps(out/'.siso_deps',out.resolve(),data)
        target=args.backup_dir/'rebased-state.json'
        target.write_text(json.dumps(data))
        with target.open('rb') as stream:
            subprocess.run([str(SOURCE/'third_party/siso/cipd/siso'),'fs','import','-C',str(out),'-format','json'],stdin=stream,cwd=SOURCE,check=True)
        (args.backup_dir/'receipt.json').write_text(json.dumps(counts,indent=2)+'\n')
        print(json.dumps(counts))

if __name__=='__main__':main()
