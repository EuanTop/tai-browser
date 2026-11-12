import { build } from 'esbuild';
import { readFile, writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

// Explicit developer tool paths; never discover or use a personal browser Profile.
if (!process.env.TAI_PUPPETEER_MODULE || !process.env.TAI_CHROME_BIN)
  throw new Error('Set TAI_PUPPETEER_MODULE and TAI_CHROME_BIN to explicit developer tool paths');
const { default: puppeteer } = await import(pathToFileURL(process.env.TAI_PUPPETEER_MODULE).href);
const dir = fileURLToPath(new URL('../.context/browser-smoke/', import.meta.url));
await mkdir(dir, { recursive: true });
await build({ entryPoints: { scenario: fileURLToPath(new URL('../test/browser-scenario.mjs', import.meta.url)),
  'preview-worker': fileURLToPath(new URL('../src/preview-worker.mjs', import.meta.url)) },
  outdir: dir, outExtension: { '.js': '.mjs' }, bundle: true, platform: 'browser', format: 'esm', target: 'chrome120' });
await writeFile(join(dir, 'index.html'), '<!doctype html><meta charset="utf-8"><title>TAi synthetic migration check</title><script type="module" src="./scenario.mjs"></script><body></body>');
const source = (text, sourceId) => ({ sourceId, name: '<img src=x onerror=alert(1)>', text,
  sha256: createHash('sha256').update(text).digest('hex').toUpperCase(), bytes: Buffer.byteLength(text) });
const chrome = source(await readFile(new URL('../test/fixtures/chrome.json', import.meta.url), 'utf8'), 'native-chrome');
const arc = source(await readFile(new URL('../test/fixtures/arc.json', import.meta.url), 'utf8'), 'native-arc');
const large = source(JSON.stringify({ version: 1, roots: { root: { type: 'folder', id: 'root', name: 'Bulk',
  children: Array.from({ length: 18000 }, (_, i) => ({ type: 'url', id: String(i), name: `Page ${i}`, url: `https://example.com/${'x'.repeat(110)}` })) } } }), 'native-large');
const catalog = { revision: 'r7', profiles: [0, 1].map(i => ({ profileId: `p${i}`, name: `Target ${i}`, revision: `p${i}-r1`,
  spaces: [0, 1].map(j => ({ spaceId: `s${i}-${j}`, name: `Space ${i}-${j}`, revision: `s${i}-${j}-r1` })) })) };
const profile = await mkdtemp(join(tmpdir(), 'tai-migration-chrome-'));
let browser;
try {
  browser = await puppeteer.launch({ executablePath: process.env.TAI_CHROME_BIN, headless: true, pipe: true,
    userDataDir: profile, args: ['--allow-file-access-from-files', '--disable-background-networking', '--disable-component-update', '--disable-sync', '--no-first-run', '--no-default-browser-check'] });
  const page = await browser.newPage(); await page.setOfflineMode(true);
  await page.goto(pathToFileURL(join(dir, 'index.html')).href);
  await page.waitForFunction('typeof window.runMigrationChecks === "function"');
  const result = await page.evaluate(input => window.runMigrationChecks(input), { chrome, arc, large, catalog });
  console.log(JSON.stringify({ browser: await browser.version(), ...result }));
} finally { await browser?.close(); await rm(profile, { recursive: true, force: true }); }