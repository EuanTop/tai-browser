import { readFile, readdir, mkdir, writeFile, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const root = resolve(process.argv[2] || 'modules/clipping');
const lock = JSON.parse(await readFile(join(root,'package-lock.json'),'utf8'));
const manifest = [];
for (const [path, value] of Object.entries(lock.packages)) {
  if (!path) continue;
  const directory = join(root,path);
  let pkg;
  try { pkg = JSON.parse(await readFile(join(directory,'package.json'),'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT' || !value.optional) throw error;
    manifest.push({ name:path.split('node_modules/').at(-1), version:value.version,license:value.license,
      source:value.resolved,integrity:value.integrity,files:[],installed:false,
      note:'Optional platform package not installed or bundled here; regenerate notices on the release platform.' });
    continue;
  }
  const files = (await readdir(directory)).filter(name => /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name));
  const output = join(root,'third-party',pkg.name.replaceAll('/','__') + '@' + pkg.version);
  await mkdir(output,{recursive:true});
  for (const file of files) await cp(join(directory,file),join(output,file),{recursive:true});
  let supplementalSource;
  if (pkg.name.startsWith('@esbuild/') && !files.length) {
    const compiler = JSON.parse(await readFile(join(root,'node_modules/esbuild/package.json'),'utf8'));
    if (compiler.version !== pkg.version || pkg.license !== 'MIT') throw new Error('Unexpected esbuild binary license/version');
    supplementalSource = 'https://github.com/evanw/esbuild/blob/v' + pkg.version + '/LICENSE.md';
    await cp(join(root,'node_modules/esbuild/LICENSE.md'),join(output,'LICENSE.md')); files.push('LICENSE.md');
  }
  if (pkg.name === 'saxes' && pkg.version === '6.0.0' && !files.length) {
    supplementalSource = 'https://raw.githubusercontent.com/lddubeau/saxes/211fa0ebec9b628affc09219199639887174bfc3/LICENSE';
    const response = await fetch(supplementalSource);
    if (!response.ok) throw new Error('Upstream saxes license unavailable');
    await writeFile(join(output,'LICENSE'),await response.text()); files.push('LICENSE');
  }
  manifest.push({ name:pkg.name,version:pkg.version,license:pkg.license || value.license,
    source:value.resolved,integrity:value.integrity,files, ...(supplementalSource ? { supplementalSource } : {}) });
}
await writeFile(join(root,'third-party','manifest.json'),JSON.stringify(manifest,null,2)+'\n');
const missing = manifest.filter(p => p.installed !== false && !p.files.length);
console.log(JSON.stringify({ packages:manifest.length,missing:missing.map(p=>p.name) }));
if (missing.length) process.exitCode = 1;
