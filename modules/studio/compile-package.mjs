// Explicit developer build command; product UI calls an organizer-injected compiler.
import {readFile,writeFile,stat} from 'node:fs/promises';
import {buildNativePackage} from './build-package.mjs';
const [input,output,...extra] = process.argv.slice(2);
if (!input || !output || extra.length) throw new Error('Usage: node modules/studio/compile-package.mjs package.json payload.json');
if ((await stat(input)).size > 16*1024*1024) throw new Error('PACKAGE_INPUT_QUOTA');
const payload = await buildNativePackage(JSON.parse(await readFile(input,'utf8')));
await writeFile(output,JSON.stringify(payload,null,2)+'\n',{flag:'wx'});
console.log('Built ' + payload.manifest.id + '@' + payload.manifest.version);
