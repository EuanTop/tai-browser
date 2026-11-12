"""Cache identities may only be refreshed for byte-identical relocated files."""
import copy
import hashlib
from pathlib import Path
import sys
import struct
import os
import tempfile
import unittest
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
from relocate_siso_cache import rebase, reconcile_legacy_deps

class RelocationTest(unittest.TestCase):
    def test_only_identical_bytes_refresh_identity(self):
        with tempfile.TemporaryDirectory() as root:
            root=Path(root)
            same=root/'same.o';same.write_bytes(b'compiled')
            changed=root/'changed.o';changed.write_bytes(b'MODIFIED')
            def entry(name):
                return {'name':'/old/'+name,'id':{'mod_time':1},'digest':{'hash':hashlib.sha256(b'compiled').hexdigest(),'size_bytes':8},'cmd_hash':'preserve','edge_hash':'preserve','updated_time':2}
            data={'entries':[entry('same.o'),entry('changed.o'),entry('missing.o'),{'name':'/outside/tool','id':{'mod_time':9}}]}
            original=copy.deepcopy(data)
            result=rebase(data,'/old',root)
            self.assertEqual(result,{'rebased':3,'identical_content_revalidated':1,'changed_or_missing':2,'identical_output_times_restored':0})
            self.assertEqual(data['entries'][0]['id']['mod_time'],same.stat().st_mtime_ns)
            for i in (1,2):self.assertEqual(data['entries'][i]['id'],original['entries'][i]['id'])
            for i in (0,1,2):
                for key in ('digest','cmd_hash','edge_hash','updated_time'):
                    self.assertEqual(data['entries'][i][key],original['entries'][i][key])
            self.assertEqual(data['entries'][3],original['entries'][3])

    def test_restore_generated_time_requires_identical_digest(self):
        with tempfile.TemporaryDirectory() as folder:
            root=Path(folder);file=root/'cached.o';file.write_bytes(b'known')
            data={'entries':[{'name':'/old/cached.o','id':{'mod_time':1000000000},'digest':{'hash':hashlib.sha256(b'known').hexdigest(),'size_bytes':5},'cmd_hash':'known-command'}]}
            counts=rebase(data,'/old',root,restore_output_times=True)
            self.assertEqual(counts['identical_output_times_restored'],1)
            self.assertEqual(file.stat().st_mtime_ns,1000000000)
            self.assertEqual(file.read_bytes(),b'known')

    def test_deps_times_reconciled_only_for_verified_generated_bytes(self):
        with tempfile.TemporaryDirectory() as folder:
            out=Path(folder).resolve();file=out/'cached.o';file.write_bytes(b'known')
            os.utime(file,ns=(1000000000,1000000000))
            def path_record(name,index):
                body=name.encode();body+=b'\0'*((-len(body))%4)
                body+=struct.pack('<I',(~index)&0xffffffff)
                return struct.pack('<I',len(body))+body
            prefix=b'# ninjadeps\n\x04\x00\x00\x00'+path_record('cached.o',0)+path_record('../../input.h',1)
            dep=struct.pack('<IIIII',0x80000010,0,2000000000,0,1)
            log=out/'.siso_deps';log.write_bytes(prefix+dep)
            data={'entries':[{'name':str(file),'id':{'mod_time':1000000000},'digest':{'hash':hashlib.sha256(b'known').hexdigest(),'size_bytes':5},'cmd_hash':'known'}]}
            self.assertEqual(reconcile_legacy_deps(log,out,data),1)
            self.assertEqual(log.read_bytes(),prefix+struct.pack('<IIIII',0x80000010,0,1000000000,0,1))
            file.write_bytes(b'other');log.write_bytes(prefix+dep)
            self.assertEqual(reconcile_legacy_deps(log,out,data),0)
            self.assertEqual(log.read_bytes(),prefix+dep)

if __name__=='__main__':unittest.main()
