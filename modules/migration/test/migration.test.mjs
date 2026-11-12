import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assertMigrationPlan } from '../../../contracts/v1/index.mjs';
import { parseChromeBookmarks, parseBookmarksHTML, parseArcSidebar, previewBatch, previewUndo, combineMigrationPlans } from '../src/index.mjs';
const fixture = async name => readFile(new URL(`fixtures/${name}`, import.meta.url), 'utf8');
const chrome = await fixture('chrome.json'), html = await fixture('bookmarks.html'), arc = await fixture('arc.json');
const options = { sourceProfileId: 'synthetic-personal', name: 'Personal' };
const code = expected => error => error.code === expected;
function mapping(plan) {
 return plan.profiles.map((profile, i) => ({ sourceProfileId: profile.sourceProfileId, targetProfileId: `target-profile-${i}`, spaces: profile.spaces.map((space, j) => ({sourceSpaceId: space.sourceSpaceId, targetSpaceId: `target-space-${i}-${j}`})) }));
}
function all(plan) {
 const result = [];
 const walk = items => { for(const item of items) { result.push(item); if(item.children) walk(item.children); } };
 for(const profile of plan.profiles) { walk(profile.favorites); for(const space of profile.spaces) { walk(space.saved); walk(space.temporary); } }
 return result;
}
function freeze(value) { Object.freeze(value); for(const child of Object.values(value)) if(child && typeof child === 'object') freeze(child); return value; }

test('Chrome JSON preserves roots, empty folders, titles, order, duplicate URLs and immutable source', () => {
 const data = freeze(JSON.parse(chrome)), before = JSON.stringify(data);
 const plan = parseChromeBookmarks(data, options); assertMigrationPlan(plan);
 assert.equal(JSON.stringify(data), before);
 const saved = plan.profiles[0].spaces[0].saved;
 assert.equal(saved.length, 2); assert.equal(saved[0].title, '书签栏 🧭');
 assert.deepEqual(saved[0].children[0].children, []);
 assert.equal(all(plan).filter(item => item.kind === 'page').length, 2);
 assert.equal(new Set(all(plan).map(item => item.sourceId)).size, all(plan).length);
 assert.deepEqual(parseChromeBookmarks(chrome, options), plan);
});
test('HTML tolerant parsing handles compact markup, quote variants and complete entity decoding', () => {
 const plan = parseBookmarksHTML(html, options); assertMigrationPlan(plan);
 const saved = plan.profiles[0].spaces[0].saved;
 assert.equal(saved[0].title, '书签栏 & 工作 🧭');
 assert.deepEqual(saved[0].children[0].children, []);
 const pages = all(plan).filter(item => item.kind === 'page');
 assert.equal(pages.length, 2); assert.equal(pages[0].title, 'One & 📚');
 assert.equal(pages[0].url, 'https://example.com/?a=1&b=2');
 assert.equal(pages[0].url, pages[1].url);
 assert.ok(plan.warnings.some(w => w.code === 'UNSUPPORTED_URL_SCHEME'));
 assert.deepEqual(parseBookmarksHTML(html, options), plan);
});
test('Arc preserves multi-Profile same-site accounts, favorites, spaces, empties and repeated URLs', () => {
 const data = freeze(JSON.parse(arc)), before = JSON.stringify(data), plan = parseArcSidebar(data);
 assertMigrationPlan(plan); assert.equal(JSON.stringify(data), before);
 assert.equal(plan.profiles.length, 2); assert.deepEqual(plan.profiles.map(p => p.spaces.length), [2, 1]);
 assert.equal(plan.profiles[0].favorites[0].url, plan.profiles[1].favorites[0].url);
 const first = plan.profiles[0].spaces[0];
 assert.deepEqual(first.saved[0].children, []); assert.equal(first.saved[1].children[0].title, 'Custom title');
 assert.equal(first.saved[1].children[0].url, first.saved[2].url);
 assert.equal(first.temporary[0].url, first.saved[2].url); assert.equal(first.temporary.length, 2);
 assert.ok(plan.warnings.some(w => w.code === 'TEMPORARY_FOLDER_FLATTENED'));
 assert.deepEqual(parseArcSidebar(arc), plan);
});
test('Arc cycles, duplicate references, missing links, odd pairs and unknown version produce URL-free diagnostics', () => {
 const data = JSON.parse(arc), main = data.sidebar.containers[1]; data.version = 999;
 main.items.push('cycle', {title:'Cycle',childrenIds:['cycle','missing']}, 'odd');
 main.items[main.items.indexOf('pin1') + 1].childrenIds.push('cycle', 'same1');
 const plan = parseArcSidebar(data), codes = plan.warnings.map(w => w.code);
 for(const expected of ['CYCLE','MISSING_REFERENCE','DUPLICATE_REFERENCE','ODD_PAIR_ARRAY','UNVERIFIED_ARC_VERSION']) assert.ok(codes.includes(expected), expected);
 assert.equal(JSON.stringify(plan.warnings).includes('example.com'), false);
 assertMigrationPlan(plan);
});
test('Arc missing root fallback respects childrenIds, reports uncertain root ordering', () => {
 const data = JSON.parse(arc), main = data.sidebar.containers[1];
 const i = main.items.indexOf('pin1'); main.items.splice(i, 2);
 main.items[main.items.indexOf('folder')+1].parentID = 'pin1';
 main.items[main.items.indexOf('deep')+1].parentID = 'pin1';
 const plan = parseArcSidebar(data), saved = plan.profiles[0].spaces[0].saved;
 assert.equal(saved.length, 1); assert.equal(saved[0].children.length, 1);
 assert.ok(plan.warnings.some(w => w.code === 'PARENT_ID_FALLBACK_ORDER'));
});
test('Unknown Arc profile tags are isolated rather than merged into a default account', () => {
 const data = JSON.parse(arc), main = data.sidebar.containers[1];
 main.topAppsContainerIDs = []; for(let i=1;i<main.spaces.length;i+=2) delete main.spaces[i].profile;
 const plan = parseArcSidebar(data); assert.equal(plan.profiles.length, 3);
 assert.equal(new Set(plan.profiles.map(p=>p.sourceProfileId)).size, 3);
});
test('Repeated batch skips source identities; changed source or target conflicts; no URL deduplication', () => {
 const plan = parseArcSidebar(arc), opts = { sourceNamespace: 'chosen-snapshot-family', mappings: mapping(plan) };
 const first = previewBatch(plan, opts); assert.equal(first.counts.create, all(plan).length); assert.ok(first.canCommit);
 const retry = previewBatch(plan, {...opts, ledger:first.receipt});
 assert.equal(retry.counts.create, 0); assert.equal(retry.counts.skipped, all(plan).length);
 const edited = structuredClone(plan); edited.profiles[0].favorites[0].title = 'Changed';
 const conflict = previewBatch(edited, {...opts,ledger:first.receipt});
 assert.equal(conflict.counts.conflicts, 1); assert.equal(conflict.canCommit, false);
 const moved = structuredClone(opts); moved.mappings[0].targetProfileId = 'other-profile';
 assert.ok(previewBatch(plan, {...moved,ledger:first.receipt}).counts.conflicts > 0);
 assert.deepEqual(previewBatch(plan, opts), first);
});
test('Batch rejects missing mappings, multi-Profile collapse and ambiguous ledger records', () => {
 const plan = parseArcSidebar(arc), opts = {sourceNamespace:'source',mappings:mapping(plan)};
 assert.throws(()=>previewBatch(plan,{...opts,mappings:[]}),code('PROFILE_MAPPING_REQUIRED'));
 const collapsed = mapping(plan); collapsed[1].targetProfileId = collapsed[0].targetProfileId;
 assert.throws(()=>previewBatch(plan,{...opts,mappings:collapsed}),code('PROFILE_MAPPING_COLLISION'));
 const invalid = mapping(plan); invalid[0].spaces=[];
 assert.throws(()=>previewBatch(plan,{...opts,mappings:invalid}),code('SPACE_MAPPING_REQUIRED'));
 assert.throws(()=>previewBatch(plan,{...opts,ledger:[{key:'k',revision:'1'},{key:'k',revision:'2'}]}),code('INVALID_LEDGER'));
});
test('Undo detects edits/missing targets and removes children before parents', () => {
 const receipt = [{objectId:'folder',revision:'1'},{objectId:'child',revision:'1'}];
 const result = previewUndo(receipt,[{objectId:'folder',revision:'1'},{objectId:'child',revision:'2'}]);
 assert.equal(result.canUndo,false); assert.deepEqual(result.actions,[{objectId:'child',status:'conflict'},{objectId:'folder',status:'remove'}]);
 assert.deepEqual(previewUndo(receipt,[]).actions.map(a=>a.status),['missing','missing']);
});
test('Large synthetic import, budget, cancellation, malformed JSON/schema, unsupported schemes and source digests', () => {
 const data = {version:1,roots:{bookmark_bar:{type:'folder',id:'root',name:'Bulk',children:Array.from({length:10_000},(_,i)=>({type:'url',id:`p${i}`,name:`Page ${i}`,url:'https://example.com/repeated'}))}}};
 const before = createHash('sha256').update(JSON.stringify(data)).digest('hex');
 const plan = parseChromeBookmarks(data,options); assert.equal(all(plan).length,10_001);
 assert.equal(createHash('sha256').update(JSON.stringify(data)).digest('hex'),before);
 assert.throws(()=>parseChromeBookmarks(data,{...options,maxItems:100}),code('ITEM_LIMIT'));
 const controller = new AbortController(); controller.abort();
 assert.throws(()=>parseArcSidebar(arc,{signal:controller.signal}),code('CANCELLED'));
 assert.throws(()=>parseChromeBookmarks(chrome,{...options,signal:controller.signal}),code('CANCELLED'));
 assert.throws(()=>parseBookmarksHTML(html,{...options,signal:controller.signal}),code('CANCELLED'));
 assert.throws(()=>previewBatch(plan,{sourceNamespace:'bulk',mappings:mapping(plan),signal:controller.signal}),code('CANCELLED'));
 assert.throws(()=>parseChromeBookmarks('{"url":"https://private.example/',options),code('INVALID_JSON'));
 assert.throws(()=>parseArcSidebar({sidebar:{containers:[]}}),code('INVALID_ARC_SCHEMA'));
 assert.throws(()=>parseChromeBookmarks({version:9,roots:{}},options),code('UNSUPPORTED_CHROME_VERSION'));
 assert.throws(()=>parseBookmarksHTML('<h1>not bookmarks</h1>',options),code('INVALID_BOOKMARKS_HTML'));
});
test('Depth guard and Chrome cycles/duplicate source identities do not overflow', () => {
 const root = {type:'folder',id:'root',name:'',children:[]}; let cursor=root;
 for(let i=0;i<70;i++) { const next={type:'folder',id:`f${i}`,children:[]}; cursor.children.push(next);cursor=next; }
 assert.throws(()=>parseChromeBookmarks({version:1,roots:{root}},options),code('DEPTH_LIMIT'));
 const data=JSON.parse(chrome), first=data.roots.bookmark_bar;
 first.children.push(first,structuredClone(first.children[1]));
 const plan=parseChromeBookmarks(data,options);
 assert.ok(plan.warnings.some(w=>w.code==='CYCLE')); assert.ok(plan.warnings.some(w=>w.code==='DUPLICATE_SOURCE_ID'));
});


test('Chrome Profile aggregation keeps same-site accounts separate and rejects duplicate identities', () => {
 const personal = parseChromeBookmarks(chrome, options), work = parseChromeBookmarks(chrome, {...options,sourceProfileId:'synthetic-work',name:'Work'});
 const combined = combineMigrationPlans([personal,work]); assert.equal(combined.profiles.length,2);
 const preview = previewBatch(combined,{sourceNamespace:'selected-chrome-install',mappings:mapping(combined)});
 assert.equal(preview.counts.create,all(personal).length*2);
 assert.throws(()=>combineMigrationPlans([personal,personal]), /Invalid source profile/);
 assert.throws(()=>combineMigrationPlans([personal,parseArcSidebar(arc)]),code('MIXED_PLAN_SOURCES'));
});
test('Reorder is a conflict and an input byte budget fails without parsing or exposing text', () => {
 const plan=parseChromeBookmarks(chrome,options), opts={sourceNamespace:'chrome-install',mappings:mapping(plan)};
 const first=previewBatch(plan,opts), changed=structuredClone(plan);
 changed.profiles[0].spaces[0].saved[0].children.reverse();
 assert.equal(previewBatch(changed,{...opts,ledger:first.receipt}).canCommit,false);
 assert.throws(()=>parseChromeBookmarks(chrome,{...options,maxBytes:10}),code('INPUT_LIMIT'));
 assert.throws(()=>parseBookmarksHTML(html,{...options,maxBytes:10}),code('INPUT_LIMIT'));
});

test('Arc multipage and optional archive limitations are explicit while recoverable children survive', () => {
 const data=JSON.parse(arc),main=data.sidebar.containers[1];
 main.items[main.items.indexOf('folder')+1].data={tab:{savedURL:'https://example.com/own'},splitView:{synthetic:true}};
 const plan=parseArcSidebar(data,{archive:{items:[]}}), codes=plan.warnings.map(w=>w.code);
 for(const expected of ['MULTIPAGE_ITEM_RELATION_UNSUPPORTED','UNSUPPORTED_ARC_ITEM_DATA','ARCHIVE_NOT_IMPORTED']) assert.ok(codes.includes(expected));
 const folder=plan.profiles[0].spaces[0].saved[1];
 assert.equal(folder.children.length,2);assert.equal(folder.children[0].url,'https://example.com/own');
 assertMigrationPlan(plan);
});
