"""A worktree must never mistake its parent for the Chromium workspace."""
import fcntl
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from workspace_paths import resolve_workspace


class WorkspacePathsTest(unittest.TestCase):
    def test_real_worktree_resolves_shared_source_and_alias(self):
        with tempfile.TemporaryDirectory() as tmp:
            base = Path(tmp).resolve()
            workspace = base / 'external drive'
            integration = workspace / 'sidebar-browser'
            integration.mkdir(parents=True)
            (integration / 'chromium.lock.json').write_text('{}')
            subprocess.run(['git', 'init', '-q', str(integration)], check=True)
            subprocess.run(['git', '-C', str(integration), 'add', '.'], check=True)
            subprocess.run(['git', '-C', str(integration), '-c', 'user.name=Fixture',
                            '-c', 'user.email=fixture@example.invalid', 'commit',
                            '-qm', 'fixture'], check=True)
            tree = workspace / 'worktrees/feature'
            subprocess.run(['git', '-C', str(integration), 'worktree', 'add',
                            '-q', '-b', 'feature', str(tree)], check=True)
            alias = base / 'alias'
            alias.symlink_to(workspace)
            product, shared, main = resolve_workspace(tree, alias=alias)
            self.assertEqual(shared, alias)
            self.assertEqual(product, alias / 'worktrees/feature')
            self.assertEqual(main, alias / 'sidebar-browser')
            self.assertEqual((shared / 'chromium/src').resolve(),
                             (workspace / 'chromium/src').resolve())

    def test_config_rejects_escape_and_relative_workspace(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            product = root / 'product'; product.mkdir()
            config = root / 'config.json'
            config.write_text(json.dumps({'workspace_root': 'relative'}))
            with self.assertRaises(ValueError):
                resolve_workspace(product, config_path=config)
            config.write_text(json.dumps({'workspace_root': str(root),
                                          'integration_root': '/'}))
            with self.assertRaises(ValueError):
                resolve_workspace(product, config_path=config)

    def test_shared_lock_rejects_second_process(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'chromium.lock'
            with path.open('a') as first:
                fcntl.flock(first, fcntl.LOCK_EX | fcntl.LOCK_NB)
                code = ('import fcntl,sys; f=open(sys.argv[1],"a"); '
                        'fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)')
                result = subprocess.run([sys.executable, '-c', code, str(path)],
                                        capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b'BlockingIOError', result.stderr)
            result = subprocess.run([sys.executable, '-c', code, str(path)],
                                    capture_output=True)
            self.assertEqual(result.returncode, 0)


if __name__ == '__main__':
    unittest.main()
