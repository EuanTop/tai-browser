import test from 'node:test';
import assert from 'node:assert/strict';
import {captureSnapshot} from '../browser.mjs';
const snapshot={scope:{profileId:'p',spaceId:'s',pageId:'page',pageRevision:3},url:'https://example.test/essay',title:'Synthetic',capturedAt:'2026-10-19T00:00:00Z',html:'<!doctype html><html><body><article><h1>Courtyard</h1><p>'+('A quiet architectural courtyard. '.repeat(80))+'</p><pre><code class="language-js">const daylight = 42;</code></pre><ul><li>Light enters through the circular opening and falls across the courtyard floor.</li><li>Space remains quiet so the reader can focus on the structure and the article.</li></ul><table><thead><tr><th>Room</th><th>Light</th></tr></thead><tbody><tr><td>East</td><td>Morning</td></tr></tbody></table></article></body></html>'};
test('production browser adapter emits real Markdown through virtual nodes',async()=>{
  const original=globalThis.getComputedStyle;
  const clip=await captureSnapshot(snapshot);
  assert.equal(globalThis.getComputedStyle,original);
  assert.match(clip.markdown,/```js\nconst daylight = 42;/);assert.match(clip.markdown,/-\s+Light enters/);assert.match(clip.markdown,/\| Room \| Light \|/);
  assert.doesNotMatch(clip.markdown,/Partial conversion|Original HTML|<article|<p>|<pre>/);
  assert.equal(clip.source.pageId,'page');assert.equal(clip.source.pageRevision,3);assert.equal(clip.source.selection,false);
});
test('production selection conversion stays inert and omits full-page body',async()=>{
  const clip=await captureSnapshot({...snapshot,selectionHtml:'<p>Selected <strong>passage</strong>.</p><script>throw "never run"</script>'});
  assert.match(clip.markdown,/Selected \*\*passage\*\*/);assert.doesNotMatch(clip.markdown,/architectural|never run|Original HTML/);assert.equal(clip.source.selection,true);
});
