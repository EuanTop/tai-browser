import test from 'node:test';
import assert from 'node:assert/strict';
import {assertRequest, scopeMatches, assertModuleManifest, assertMigrationPlan,
  isRelativeResource} from './index.mjs';
import {readFileSync} from 'node:fs';
const fixture = name => JSON.parse(readFileSync(new URL('./fixtures/'+name, import.meta.url)));
test('foreground changes must not retarget a task or stale page', () => {
  const binding = {profileId:'p-a',spaceId:'s-a',taskId:'t-a',pageId:'w-a',pageRevision:2};
  const request = {protocol:'tai.v1',id:'r-a',command:'page.read',scope:binding,payload:{}};
  assert.equal(assertRequest(request),request);
  assert.ok(scopeMatches(request.scope,binding));
  for (const delta of [{profileId:'p-b'},{spaceId:'s-b'},{taskId:'t-b'},
                       {pageId:'w-b'},{pageRevision:3}])
    assert.equal(scopeMatches({...request.scope,...delta},binding),false);
  assert.throws(() => assertRequest({...request,scope:{spaceId:'s-a'}}));
});
test('module resources cannot escape the installed package', () => {
  const manifest=fixture('pomodoro.json');
  assert.equal(assertModuleManifest(manifest),manifest);
  for (const path of ['/etc/passwd','../index.html','a/../../index.html',
    'file:index.html','a\\b.html','%2e%2e/file','a/%2f/b','a//b']) {
    assert.equal(isRelativeResource(path),false,path);
    assert.throws(() => assertModuleManifest({...manifest,entry:path}));
  }
  assert.throws(() => assertModuleManifest({...manifest,capabilities:['native.shell']}));
});
test('migration preserves repeated URLs but rejects ambiguous identities', () => {
  const plan=fixture('migration.json');
  assert.equal(assertMigrationPlan(plan),plan);
  const duplicate=structuredClone(plan);
  duplicate.profiles[0].spaces[0].saved[1].sourceId='page-one';
  assert.throws(() => assertMigrationPlan(duplicate));
  const cross=structuredClone(plan); cross.profiles.push(structuredClone(plan.profiles[0]));
  assert.throws(() => assertMigrationPlan(cross));
});

test('native page discovery and selected-library commands use the existing envelope', () => {
  for (const command of ['page.list','library.read','library.list','library.putIfAbsent']) {
    assertRequest({protocol:'tai.v1',id:'native-command',command,scope:{profileId:'p',spaceId:'s',taskId:'t'},payload:{}});
  }
  assert.throws(()=>assertRequest({protocol:'tai.v1',id:'denied',command:'native.shell',scope:{profileId:'p',spaceId:'s'},payload:{}}));
});
