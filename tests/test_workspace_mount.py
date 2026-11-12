"""Mount helper must preserve occupied paths and verify owned volume identity."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import mount_workspace

class MountGuardTest(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name).resolve();self.home=self.root/'home';self.home.mkdir()
        self.parent=self.root/'TAi';(self.parent/'records').mkdir(parents=True)
        (self.parent/'records/统一目录记录.json').write_text(json.dumps({'workspace_id':'owned'}))
        self.native=self.home/'.cache/tai-volume/workspace'
        p=patch.object(mount_workspace,'native_mount',return_value=self.native);p.start();self.addCleanup(p.stop)
        p=patch.object(Path,'home',return_value=self.home);p.start();self.addCleanup(p.stop)

    def test_occupied_native_directory_is_not_hidden_or_mounted_over(self):
        self.native.mkdir(parents=True);file=self.native/'keep';file.write_text('preserve')
        with patch.object(mount_workspace.subprocess,'run') as command:
            with self.assertRaisesRegex(RuntimeError,'占用'):mount_workspace.mount(self.parent)
            command.assert_not_called()
        self.assertEqual(file.read_text(),'preserve')

    def test_unknown_legacy_volume_is_not_unmounted(self):
        workspace=self.parent/'workspace';workspace.mkdir();(workspace/'.tai-workspace-id').write_text('other')
        with patch.object(Path,'is_mount',lambda p:p==workspace),patch.object(mount_workspace.subprocess,'run') as command:
            with self.assertRaisesRegex(RuntimeError,'不是本项目'):mount_workspace.mount(self.parent,relocate=True)
            command.assert_not_called()

    def test_unknown_broken_parent_link_is_preserved_even_with_relocate(self):
        workspace=self.parent/'workspace';other=self.root/'unavailable';workspace.symlink_to(other)
        with patch.object(mount_workspace.subprocess,'run') as command:
            with self.assertRaisesRegex(RuntimeError,'其他位置'):mount_workspace.mount(self.parent,relocate=True)
            command.assert_not_called()
        self.assertTrue(workspace.is_symlink())
        self.assertEqual(workspace.readlink(),other)

    def test_existing_owned_mount_reuses_one_parent_entry(self):
        self.native.mkdir(parents=True);(self.native/'.tai-workspace-id').write_text('owned')
        workspace=self.parent/'workspace';workspace.symlink_to(self.native,target_is_directory=True)
        with patch.object(Path,'is_mount',lambda p:p.resolve()==self.native),patch.object(mount_workspace.subprocess,'run') as command:
            mount_workspace.mount(self.parent)
            command.assert_not_called()
        self.assertEqual(workspace.resolve(),self.native)
        self.assertEqual((self.home/'.cache/tai-workspace').resolve(),self.native)
        self.assertEqual(json.loads((self.parent/'records/统一目录记录.json').read_text())['native_mount'],str(self.native))

if __name__=='__main__':unittest.main()
