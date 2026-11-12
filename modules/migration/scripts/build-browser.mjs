import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Independent developer check only. Organizer owns WebUI resource registration.
await build({
  entryPoints: ['browser', 'panel', 'preview-worker'].map(name => fileURLToPath(new URL(`../src/${name}.mjs`, import.meta.url))),
  outdir: fileURLToPath(new URL('../.context/browser/', import.meta.url)),
  outExtension: { '.js': '.mjs' },
  bundle: true, platform: 'browser', format: 'esm', target: 'chrome120',
});