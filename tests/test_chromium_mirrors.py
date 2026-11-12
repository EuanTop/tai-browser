"""Guard against mapping filtered LLVM repositories to nonexistent GitHub paths."""
import sys
from pathlib import Path
import unittest
import tempfile

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'tools'))
from chromium_mirrors import github_origin, transport_aliases  # noqa: E402


class MirrorRoutingTest(unittest.TestCase):
    def test_whole_repositories(self):
        for suffix in ('', '.git'):
            self.assertEqual(github_origin(
                'https://chromium.googlesource.com/external/github.com/'
                'KhronosGroup/SPIRV-Headers' + suffix),
                'https://github.com/KhronosGroup/SPIRV-Headers')

    def test_filtered_llvm_repositories_keep_canonical_source(self):
        for path in ('clang/tools/clang-format', 'compiler-rt', 'libcxx', 'libcxxabi', 'libunwind', 'libc'):
            self.assertIsNone(github_origin(
                'https://chromium.googlesource.com/external/github.com/'
                'llvm/llvm-project/' + path + '.git'))

    def test_unrelated_hosts_and_private_repositories_are_not_rewritten(self):
        for url in ('https://chrome-internal.googlesource.com/foo/bar',
                    'https://other.example/external/github.com/google/foo',
                    'https://chromium.googlesource.com/chromium/src.git'):
            self.assertIsNone(github_origin(url))

    def test_nested_paths_are_not_treated_as_repositories(self):
        self.assertIsNone(github_origin(
            'https://chromium.googlesource.com/external/github.com/a/b/subtree'))

    def test_chromium_alias_preserves_nested_upstream_repositories(self):
        repository = 'https://chromium.googlesource.com/chromium/src.git'
        with tempfile.TemporaryDirectory() as directory:
            aliases = transport_aliases(Path(directory), repository)
        self.assertEqual(aliases[repository], 'https://github.com/chromium/chromium')
        for name in ('freetype2', 'libunwindstack'):
            url = f'https://chromium.googlesource.com/chromium/src/third_party/{name}.git'
            self.assertFalse(any(url.startswith(prefix) for prefix in aliases))

    def test_parent_alias_cannot_capture_filtered_children(self):
        base = 'https://chromium.googlesource.com/external/github.com/llvm/llvm-project'
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / '.gitmodules').write_text(
                '[submodule "whole"]\nurl = ' + base + '\n'
                '[submodule "filtered"]\nurl = ' + base + '/libcxx\n')
            aliases = transport_aliases(root, 'https://chromium.googlesource.com/chromium/src.git')
            self.assertFalse(any((base + '/libcxx.git').startswith(prefix) for prefix in aliases))


if __name__ == '__main__':
    unittest.main()
