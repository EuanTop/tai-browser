import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {maximumImportBytes, previewWelcomeImport} from '../src/welcome.mjs';

const names = {source: 'Imported', favorites: 'Favorites', tabs: 'Unpinned tabs', untitled: 'Untitled'};
const fixture = name => readFileSync(new URL('./fixtures/' + name, import.meta.url), 'utf8');

test('Chrome and Safari bookmark HTML preserves folder order and excludes unsafe links', () => {
  const html = `<!DOCTYPE NETSCAPE-Bookmark-file-1>
    <DL><p>
      <DT><H3>Reading</H3><DL><p>
        <DT><A HREF="https://example.test/a">A &amp; B</A>
        <DT><A HREF="javascript:alert(1)">Unsafe</A>
      </DL><p>
      <DT><A HREF="https://fake:fake@example.test/">Credential URL</A>
    </DL>`;
  for (const source of ['chrome', 'safari']) {
    const result = previewWelcomeImport(source, html, names);
    assert.deepEqual(result.spaces[0].items, [
      {title: 'Reading', parent: -1},
      {title: 'A & B', parent: 0, url: 'https://example.test/a'},
    ]);
    assert.equal(result.linkCount, 1);
    assert.equal(result.hasWarnings, true);
  }
});

test('Chrome snapshot and Arc sidebar use the existing parsers', () => {
  assert.ok(previewWelcomeImport('chrome', fixture('chrome.json'), names).linkCount > 0);
  const arc = previewWelcomeImport('arc', fixture('arc.json'), names);
  assert.ok(arc.spaces.some(space => space.name === 'Favorites'));
  assert.ok(arc.spaces.some(space => space.items.some(item => item.title === 'Unpinned tabs')));
  assert.ok(arc.spaces.length > 1);
});

test('Arc Markdown preserves section and list nesting and only imports web links', () => {
  const markdown = `# Arc Data Export

## Work

### Pinned

- Project
  - [Home](https://example.test/project_(home))
  - [Unsafe](file:///etc/hosts)
- [Read **this**](https://example.test/reading)

## Personal

- [News](https://example.test/news)
`;
  const result = previewWelcomeImport('arc', markdown, names);
  assert.deepEqual(result.spaces, [
    {name: 'Work', items: [
      {title: 'Pinned', parent: -1},
      {title: 'Project', parent: 0},
      {title: 'Home', parent: 1, url: 'https://example.test/project_(home)'},
      {title: 'Read this', parent: 0, url: 'https://example.test/reading'},
    ]},
    {name: 'Personal', items: [{title: 'News', parent: -1, url: 'https://example.test/news'}]},
  ]);
  assert.equal(result.linkCount, 3);
  assert.equal(result.hasWarnings, true);
});

test('empty, invalid and oversized input cannot be committed', () => {
  assert.throws(() => previewWelcomeImport('arc', '# Arc Data Export', names), /NO_IMPORT_LINKS/);
  assert.throws(() => previewWelcomeImport('safari', 'bad', names), /INVALID_BOOKMARKS_HTML/);
  assert.throws(() => previewWelcomeImport('arc', 'x'.repeat(maximumImportBytes + 1), names), /IMPORT_FILE_LIMIT/);
});

test('an Arc export with over 1,500 links can be imported in one preview', () => {
  const sections = Array.from({length: 14}, (_, space) => {
    const links = Array.from({length: 140}, (_, link) =>
      `- [Example](https://example.test/${space}/${link})`);
    return [`# Space ${space}`, '## Reading', ...links].join('\n\n');
  });
  const result = previewWelcomeImport('arc', sections.join('\n\n'), names);
  assert.equal(result.spaces.length, 14);
  assert.equal(result.linkCount, 1960);
  assert.equal(result.spaces[13].items[140].parent, 0);
});
