// Capture the actual TAi window using an isolated synthetic Profile.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdir, mkdtemp, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {basename, join, resolve} from 'node:path';
import {startNativeBrowser, until} from './native_smoke_support.mjs';

const appPath = process.argv[2];
if (!appPath) throw new Error('Usage: node tools/capture_readme.mjs /path/to/TAi.app');
const app = resolve(appPath);
const build = JSON.parse(await readFile(join(app, 'Contents/Resources/build-info.json')));
const binary = join(app, 'Contents/MacOS/TAiLauncher');
const root = await realpath(await mkdtemp(join(tmpdir(), 'native-smoke-')));
const profile = join(root, 'Default');
const output = resolve('docs/images/readme');
const spaces = [
  {id: 'studio', name: 'Studio', icon: '🎨'},
  {id: 'research', name: 'Research', icon: '📚'},
  {id: 'personal', name: 'Personal', icon: '🌱'},
];
function saved(id, title, {parent = '', kind = 1, url, collapsed = false} = {}) {
  return {id, title, parent, kind, space: kind === 2 ? '' : 'studio', collapsed,
    url: kind === 0 ? '' : url || 'https://example.com/' + id};
}
const items = [
  saved('reference', 'Reference library', {kind: 2, url: 'https://developer.mozilla.org/'}),
  saved('notes', 'Design notes', {kind: 2, url: 'https://example.org/notes'}),
  saved('brief', 'Project brief'),
  saved('research', 'References', {kind: 0}),
  saved('reading', 'Reading list', {parent: 'research'}),
  saved('palette', 'Color studies', {parent: 'research'}),
  saved('prototype', 'Prototype'),
  saved('launch', 'Release checklist', {kind: 0, collapsed: true}),
];

let browser;
try {
  await mkdir(profile);
  await writeFile(join(profile, 'SidebarWorkspace.json'), JSON.stringify({
    version: 1, active: 'studio', language: 'en', edition: 'standard',
    welcome_pending: false, spaces, items,
  }));
  browser = await startNativeBrowser(binary, root, {
    headless: false, navigate: false, initialURL: null,
    extra: ['--sidebar-browser-smoke-test', '--tai-test-capture-window',
      '--window-size=1240,780', '--window-position=40,60', '--disable-sync'],
  });
  await until(() => browser.evaluate(
    "location.pathname==='/home.html' && document.querySelector('.atrium-hero')?.naturalWidth > 0"));
  const bytes = await until(async () => {
    const candidate = await readFile(join(root, 'ReadmeWindow.png'));
    return candidate.length > 32 && candidate.subarray(-8, -4).toString() === 'IEND'
      ? candidate : false;
  });
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
  const filename = join(output, 'browser-window.png');
  await mkdir(output, {recursive: true});
  await writeFile(filename, bytes);
  await writeFile(join(output, 'capture.json'), JSON.stringify({
    description: 'Native macOS TAi Browser compositor capture, including the sidebar, toolbar and new-tab artwork.',
    file: basename(filename),
    sourceCommit: build.sourceCommit,
    chromiumRevision: build.chromiumRevision,
    edition: 'standard',
    syntheticData: true,
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    sha256: createHash('sha256').update(bytes).digest('hex'),
  }, null, 2) + '\n');
  console.log('Captured the native TAi Browser window using a disposable Profile.');
} finally {
  await browser?.stop();
  await rm(root, {recursive: true, force: true});
}
