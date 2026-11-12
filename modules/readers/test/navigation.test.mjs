import {test} from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {mountReader} from '../index.mjs';

test('reader links emit explicit bounded navigation intents; unavailable attachments and failed navigation stay visible',async t => {
  const dom = new JSDOM('<main></main>',{url:'https://parent.test/'}); t.after(() => dom.window.close());
  const root = dom.window.document.querySelector('main'), intents = [], loads = [];
  const reader = await mountReader(root,{format:'markdown',baseURL:'https://source.test/path/page',text:
    '[relative](../next) [web](https://other.test/) [fragment](#title) [blocked](file:///etc/passwd) ![missing](images/a.png) ![remote](https://remote.test/image)'},
  {onNavigate:intent => {intents.push(intent);if (intent.url?.includes('other.test')) throw Error('not granted');},
    resolveResource:async request => {loads.push(request.resourceId);throw Error('not granted');}});
  const links = root.querySelectorAll('a');
  assert.ok([...links].every(link => !link.hasAttribute('href')));
  links[0].dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));
  links[0].click(); links[1].dispatchEvent(new dom.window.MouseEvent('auxclick',{bubbles:true,cancelable:true,button:1})); links[2].click(); links[3].click();
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(intents,[{kind:'navigate',url:'https://source.test/next'},{kind:'navigate',url:'https://source.test/next'},{kind:'navigate',url:'https://other.test/'},{kind:'fragment',fragment:'title'}]);
  assert.deepEqual(loads,['images/a.png']); assert.equal(root.querySelectorAll('.attachment-unavailable').length,2);
  assert.match(root.textContent,/Could not open link/); assert.equal(dom.window.location.href,'https://parent.test/');
  reader.close();
  await mountReader(root,{format:'markdown',text:'[external](https://other.test/)'});
  root.querySelector('a').click(); assert.match(root.textContent,/Link navigation unavailable/);
});
