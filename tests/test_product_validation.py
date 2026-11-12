"""A failed check or unapplied source edit must never become an installable app."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import run_product

def digest(data): return hashlib.sha256(data).hexdigest()

class ProductValidationTest(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'product'; self.source = Path(self.temp.name) / 'chromium/src'
        self.binary = self.source / 'out/SidebarBaseline/Chromium.app/Contents/MacOS/Chromium'
        self.own = self.root / 'src/chromium/webui/panel.css'
        self.generated = self.source / 'sidebar_browser/webui/panel.css'
        self.resource = self.root / 'module.js'
        for path, data in [(self.binary, b'browser'), (self.own, b'css'), (self.generated, b'css'), (self.resource, b'module')]:
            path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        installed = {'files': {'sidebar_browser/webui/panel.css': {'after': digest(b'css')}}, 'resource_inputs': {'module.js': digest(b'module')}}
        self.local = self.root / 'research/local'; self.local.mkdir(parents=True)
        self.overlay = self.local / 'native-overlay-installed.json'; self.overlay.write_text(json.dumps(installed))
        (self.root / 'chromium.lock.json').write_text('{"revision":"locked"}')
        self.receipt = dict(status='completed', revision='locked', overlay_sha256=digest(self.overlay.read_bytes()), binary_sha256=digest(b'browser'), artifact_sha256={})
        self.receipt_path = self.local / 'product-build.json'; self.receipt_path.write_text(json.dumps(self.receipt))
        for name, value in dict(ROOT=self.root, SOURCE=self.source, BINARY=self.binary, OWN_FILES=['webui/panel.css'], own_source=lambda _: self.own).items():
            mock = patch.object(run_product, name, value); mock.start(); self.addCleanup(mock.stop)

    def test_completed_receipt_requires_matching_source_resource_and_binary(self):
        self.assertEqual(run_product.validate_build()['status'], 'completed')
        for path in [self.own, self.generated, self.resource, self.binary]:
            before = path.read_bytes(); path.write_bytes(b'unverified edit')
            with self.assertRaises(SystemExit): run_product.validate_build()
            path.write_bytes(before)

    def test_failed_runtime_receipt_still_blocks_launch_and_install(self):
        self.receipt.update(status='failed', phase='panel_smoke')
        self.receipt_path.write_text(json.dumps(self.receipt))
        with self.assertRaises(SystemExit): run_product.validate_build()
        with self.assertRaises(SystemExit): run_product.validate_build(allow_compiled=True)
        # The resume tool checks status/phase/type-check receipt separately.
        self.assertEqual(run_product.validate_artifacts(self.receipt)['status'], 'failed')

if __name__ == '__main__': unittest.main()
