import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
const source=(await readFile(new URL('../../../src/chromium/webui/agent-setup.js',import.meta.url),'utf8'))
  // Localization/DOM mounting are covered by native WebUI checks, not this pure shell-format test.
  .replace(/^import \{t,translateDOM,markCopy\} from '.\/i18n.js';$/m,'const t=text=>text;')
  .replace(/^import \{sendWithPromise\} from 'chrome:\/\/resources\/js\/cr.js';$/m,
    'const sendWithPromise=()=>{throw new Error("Native WebUI is outside this pure guide test")};');
const {connectionGuide,quote}=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
test('setup quotes literal paths, preserving apostrophes and shell metacharacters',()=>{
 const path="/test/Test's SSD/$(literal);do-not-run.json";
 const result=spawnSync('/bin/sh',['-c','printf %s '+quote(path)],{encoding:'utf8'});
 assert.equal(result.status,0);assert.equal(result.stdout,path);
});
test('channel guides use absolute runtime paths and separate client formats',()=>{
 const runtime={node:'/test/node',entry:'/test/native-stdio.mjs',piEntry:'/test/pi-extension.mjs'},file='/test/connection.json',id='lease-1234';
 assert.match(connectionGuide('codex',runtime,file,id).command,/^codex mcp add tai-lease1234 -- /);
 assert.match(connectionGuide('claude',runtime,file,id).command,/^claude mcp add --transport stdio --scope local/);
 assert.match(connectionGuide('pi',runtime,file,id).command,/TAI_CONNECTION_FILE=.* pi -e/);
 const config=JSON.parse(connectionGuide('other',runtime,file,id).command);
 assert.equal(config.mcpServers['tai-lease1234'].args.at(-1),file);
 assert.throws(()=>connectionGuide('codex',{},file,id));
});
