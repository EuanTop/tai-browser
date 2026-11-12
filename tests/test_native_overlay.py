"""The overlay must preserve unrelated work and remain reproducible."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
import native_overlay as overlay
from settings_overlay import UPSTREAM_FILES


class OverlayOwnershipTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.originals = {name: overlay.upstream(name)
                         for name in (overlay.OMNIBOX, overlay.OMNIBOX_INPUT, overlay.SCHEME_CLASSIFIER, overlay.LOCATION_IDENTITY, overlay.FOCUS, overlay.BINDERS, overlay.BUILD, overlay.REGION, overlay.STATE,
                                      overlay.COMMANDS, overlay.RESTORE, overlay.SESSION_RESTORE, overlay.SESSION_SERVICE, overlay.CONTEXT, overlay.TOOLBAR, overlay.LOCATION, overlay.WIDGET, overlay.BROWSER_VIEW, overlay.PAGES, overlay.COMMAND_CONTROLLER, overlay.KEY_DISPATCH, overlay.MULTI_CONTENTS, overlay.RELOAD, overlay.WEBUI_RELOAD, overlay.WEBUI, overlay.UNTRUSTED, overlay.PANEL_IDS, overlay.PANEL_ID_IMPL,
                                      'chrome/browser/ui/views/frame/themed_background.cc',
                                      'chrome/browser/ui/views/frame/main_background_region_view.cc',
                                      'chrome/browser/ui/views/frame/browser_frame_view_mac.mm',
                                      'chrome/browser/ui/views/side_panel/side_panel.cc',
                                      'chrome/browser/ui/views/extensions/extensions_toolbar_desktop.cc')}
        cls.owned = {name: overlay.own_source(name).read_bytes()
                     for name in overlay.OWN_FILES}
        cls.originals.update({name: overlay.upstream(name) for name in UPSTREAM_FILES})

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        root = Path(self.temporary.name)
        self.source = root / 'chromium/src'
        self.project = root / 'product'
        self.source.mkdir(parents=True)
        (self.project / 'src/chromium').mkdir(parents=True)
        for name, data in self.originals.items():
            target = self.source / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        for name, data in self.owned.items():
            target = self.project / ('src/host/files/' + name[len('host-files/'):] if name.startswith('host-files/') else 'src/sidebar/' + name[6:] if name.startswith('model/') else 'src/chromium/' + name)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        subprocess.run(['git', 'init', '-q'], cwd=self.source, check=True)
        subprocess.run(['git', 'add', '.'], cwd=self.source, check=True)
        subprocess.run(['git', '-c', 'user.name=Overlay Test',
                        '-c', 'user.email=overlay-test@example.invalid',
                        'commit', '-qm', 'temporary baseline fixture'],
                       cwd=self.source, check=True)
        revision = subprocess.check_output(
            ['git', 'rev-parse', 'HEAD'], cwd=self.source, text=True).strip()
        (self.project / 'chromium.lock.json').write_text(json.dumps({'revision': revision}))
        for name in overlay.BRAND_ASSETS.values():
            target = self.project / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(b'synthetic immutable image fixture')
        def fake_bundles():
            folder = self.project / 'research/local/host-bundles'
            folder.mkdir(parents=True, exist_ok=True)
            (folder / 'manifest.json').write_text('{"inputs":{}}')
            return dict(reader='/* reader */', pomodoro='/* timer */', bootstrap='/* bridge */',
                        library='/* library */', components='/* components */',
                        **{'welcome-import': '/* welcome import */'})
        replacement = patch.object(overlay, 'bundle_host_assets', fake_bundles)
        replacement.start(); self.addCleanup(replacement.stop)
        for key, value in {'ROOT': self.project, 'SOURCE': self.source,
                           'STAGE': self.project / 'research/local/native-overlay'}.items():
            replacement = patch.object(overlay, key, value)
            replacement.start()
            self.addCleanup(replacement.stop)

    def test_stage_does_not_modify_checkout_and_apply_is_idempotent(self):
        staged = overlay.stage()
        for name, original in self.originals.items():
            self.assertEqual((self.source / name).read_bytes(), original)
        self.assertFalse((self.source / 'sidebar_browser').exists())
        applied = overlay.apply()
        self.assertEqual(staged, applied)
        timestamps = {name: (self.source / name).stat().st_mtime_ns
                      for name in applied['files']}
        self.assertEqual(overlay.apply(), applied)
        for name, record in applied['files'].items():
            self.assertEqual(overlay.sha((self.source / name).read_bytes()), record['after'])
            self.assertEqual((self.source / name).stat().st_mtime_ns, timestamps[name])

    def test_refuse_unrelated_upstream_edit_without_overwriting_it(self):
        path = self.source / overlay.REGION
        changed = path.read_bytes() + b'\n// unrelated work\n'
        path.write_bytes(changed)
        with self.assertRaisesRegex(ValueError, 'unrelated edits'):
            overlay.apply()
        self.assertEqual(path.read_bytes(), changed)
        self.assertEqual((self.source / overlay.STATE).read_bytes(), self.originals[overlay.STATE])

    def test_refuse_unowned_file_collision(self):
        directory = self.source / 'sidebar_browser'
        directory.mkdir()
        target = directory / 'space_navigation_view.cc'
        target.write_bytes(b'// somebody else owns this file\n')
        with self.assertRaisesRegex(ValueError, 'unrelated overlay'):
            overlay.apply()
        self.assertEqual(target.read_bytes(), b'// somebody else owns this file\n')

    def test_owned_update_allowed_but_local_checkout_edits_preserved(self):
        overlay.apply()
        own = self.project / 'src/chromium/space_navigation_view.cc'
        own.write_bytes(own.read_bytes() + b'\n// reviewed product update\n')
        overlay.apply()
        live = self.source / 'sidebar_browser/space_navigation_view.cc'
        self.assertEqual(live.read_bytes(), own.read_bytes())
        unrelated = live.read_bytes() + b'\n// unreviewed checkout change\n'
        live.write_bytes(unrelated)
        with self.assertRaisesRegex(ValueError, 'unrelated overlay'):
            overlay.apply()
        self.assertEqual(live.read_bytes(), unrelated)

    def test_webui_resource_updates_regenerate_header_and_detect_live_tampering(self):
        overlay.apply()
        asset = self.project / 'src/chromium/webui/tai.css'
        asset.write_bytes(asset.read_bytes() + b'\n/* resource revision */\n')
        overlay.apply()
        header = self.source / 'sidebar_browser/tai_resources.h'
        self.assertIn(b'/* resource revision */', header.read_bytes())
        tampered = header.read_bytes() + b'\n// unowned live change\n'
        header.write_bytes(tampered)
        with self.assertRaisesRegex(ValueError, 'unrelated overlay'):
            overlay.apply()
        self.assertEqual(header.read_bytes(), tampered)

    def test_resource_delimiter_collision_is_rejected_without_live_changes(self):
        asset = self.project / 'src/chromium/webui/tai.js'
        asset.write_bytes(asset.read_bytes() + b')TAI_RESOURCE"')
        with self.assertRaisesRegex(ValueError, 'raw string delimiter'):
            overlay.apply()
        self.assertFalse((self.source / 'sidebar_browser').exists())

    def test_bundle_update_is_owned_and_live_tampering_is_preserved(self):
        overlay.apply()
        folder = self.project / 'research/local/host-bundles'
        def changed_bundle():
            (folder / 'manifest.json').write_text('{"inputs":{"contracts/v1/index.mjs":"fixture-digest"}}')
            return dict(reader='/* new shared reader */', pomodoro='/* timer */', bootstrap='/* bridge */',
                        library='/* library */', components='/* components */',
                        **{'welcome-import': '/* welcome import */'})
        with patch.object(overlay, 'bundle_host_assets', changed_bundle):
            manifest = overlay.apply()
            self.assertEqual(manifest['resource_inputs']['contracts/v1/index.mjs'], 'fixture-digest')
            header = self.source / 'sidebar_browser/host_bundles.h'
            self.assertIn(b'/* new shared reader */', header.read_bytes())
            tampered = header.read_bytes() + b'\n// unrelated bundle work\n'
            header.write_bytes(tampered)
            with self.assertRaisesRegex(ValueError, 'unrelated overlay'):
                overlay.apply()
            self.assertEqual(header.read_bytes(), tampered)

    def test_bundle_delimiter_collision_does_not_modify_live_sources(self):
        with patch.object(overlay, 'bundle_host_assets',
                          return_value=dict(reader=')TAI_BUNDLE"', pomodoro='', bootstrap='')):
            with self.assertRaisesRegex(ValueError, 'raw string delimiter'):
                overlay.apply()
        self.assertFalse((self.source / 'sidebar_browser').exists())
        for name, original in self.originals.items():
            self.assertEqual((self.source / name).read_bytes(), original)

    def test_wrong_upstream_revision_is_rejected(self):
        (self.project / 'chromium.lock.json').write_text(json.dumps({'revision': '0' * 40}))
        with self.assertRaisesRegex(ValueError, 'reviewed baseline'):
            overlay.apply()
        for name, original in self.originals.items():
            self.assertEqual((self.source / name).read_bytes(), original)


if __name__ == '__main__':
    unittest.main()
