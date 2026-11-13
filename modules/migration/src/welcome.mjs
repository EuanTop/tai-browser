// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause

import {lexer} from 'marked';
import {decodeHTMLStrict} from 'entities/decode';
import {parseArcSidebar} from './arc.mjs';
import {parseBookmarksHTML, parseChromeBookmarks} from './chrome.mjs';

export const maximumImportBytes = 4 * 1024 * 1024;
const maximumItems = 10000;
const maximumSpaces = 256;

export function previewWelcomeImport(source, input, names) {
  if (typeof input !== 'string' || new TextEncoder().encode(input).length > maximumImportBytes) {
    throw new Error('IMPORT_FILE_LIMIT');
  }
  const content = input.trim();
  const spaces = [];
  let itemCount = 0;
  let linkCount = 0;
  let skipped = 0;

  function space(name) {
    if (spaces.length >= maximumSpaces) throw new Error('IMPORT_SPACE_LIMIT');
    const created = {name: safeTitle(name, 80) || names.source, items: []};
    spaces.push(created);
    return created;
  }

  function append(target, title, parent, url) {
    if (++itemCount > maximumItems) throw new Error('IMPORT_ITEM_LIMIT');
    const index = target.items.length;
    const item = {title: safeTitle(title, 400) || names.untitled, parent};
    if (url !== undefined) {
      item.url = url;
      linkCount++;
    }
    target.items.push(item);
    return index;
  }

  function addLink(target, title, parent, rawUrl) {
    const url = safeURL(rawUrl);
    if (!url) {
      skipped++;
      return;
    }
    append(target, title || url, parent, url);
  }

  function addNodes(target, nodes, parent = -1) {
    for (const node of nodes) {
      if (node.kind === 'folder') {
        const index = append(target, node.title, parent);
        addNodes(target, node.children, index);
      } else if (node.kind === 'page') {
        addLink(target, node.title, parent, node.url);
      }
    }
  }

  if (source === 'arc' && !content.startsWith('{')) {
    // The official export describes each Space as a Markdown section. Its
    // top-level section headings become Spaces, with nested headings as folders.
    const tokens = lexer(content).filter(token => token.type !== 'space');
    if (tokens[0]?.type === 'heading' && tokens[0].depth === 1 &&
        /^arc (data export|数据导出)$/i.test(plainText(tokens[0].tokens))) tokens.shift();
    const sectionDepth = tokens.reduce((depth, token) =>
      token.type === 'heading' ? Math.min(depth, token.depth) : depth, Infinity);
    let target;
    const targetSpace = () => (target ??= space(names.source));
    const sections = [];
    function walk(tokens, parent, depth = 0) {
      if (depth > 64) throw new Error('IMPORT_NESTING_LIMIT');
      for (const token of tokens) {
        if (token.type === 'link') {
          const title = token.autolink ? token.text : plainText(token.tokens) || token.text;
          const href = token.autolink ? token.href : decodeHTMLStrict(token.href);
          addLink(targetSpace(), title, parent, href);
        } else if (token.type === 'list') {
          for (const item of token.items) {
            const nested = item.tokens.filter(part => part.type === 'list');
            const inline = item.tokens.filter(part => part.type !== 'list');
            const hasLink = inline.some(containsLink);
            if (nested.length && !hasLink) {
              const title = plainText(inline);
              if (title) {
                walk(nested, append(targetSpace(), title, parent), depth + 1);
                continue;
              }
            }
            walk(item.tokens, parent, depth + 1);
          }
        } else if (token.tokens) {
          walk(token.tokens, parent, depth + 1);
        }
      }
    }
    for (const token of tokens) {
      if (token.type === 'heading') {
        if (token.depth === sectionDepth) {
          target = space(plainText(token.tokens));
          sections.length = 0;
          continue;
        }
        while (sections.length && sections.at(-1).depth >= token.depth) sections.pop();
        const index = append(targetSpace(), plainText(token.tokens), sections.at(-1)?.index ?? -1);
        sections.push({depth: token.depth, index});
      } else {
        walk([token], sections.at(-1)?.index ?? -1);
      }
    }
  } else if (source === 'arc') {
    const plan = parseArcSidebar(content);
    skipped += plan.warnings.length;
    for (const profile of plan.profiles) {
      if (profile.favorites.length) {
        addNodes(space(names.favorites), profile.favorites);
      }
      for (const entry of profile.spaces) {
        const target = space(entry.name);
        addNodes(target, entry.saved);
        if (entry.temporary.length) {
          addNodes(target, entry.temporary, append(target, names.tabs, -1));
        }
      }
    }
  } else if (source === 'chrome' || source === 'safari') {
    const options = {sourceProfileId: source, name: names.source};
    const plan = source === 'chrome' && content.startsWith('{')
      ? parseChromeBookmarks(content, options) : parseBookmarksHTML(content, options);
    skipped += plan.warnings.length;
    const target = space(names.source);
    for (const profile of plan.profiles) {
      for (const entry of profile.spaces) addNodes(target, entry.saved);
    }
  } else {
    throw new Error('INVALID_IMPORT_SOURCE');
  }
  if (!linkCount) throw new Error('NO_IMPORT_LINKS');
  return {spaces, linkCount, hasWarnings: skipped > 0};
}

function safeTitle(value, limit) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, limit).toWellFormed().trim();
}

function safeURL(value) {
  if (typeof value !== 'string' || value.length > 8192) return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    return url.href.length <= 8192 ? url.href : null;
  } catch {
    return null;
  }
}

function containsLink(token) {
  return token.type === 'link' || Boolean(token.tokens?.some(containsLink));
}

function plainText(tokens = []) {
  return tokens.map(token => {
    // Decode leaf text once, leaving code, backslash escapes and autolinks literal.
    if (token.autolink) return token.text;
    if (token.tokens) return plainText(token.tokens);
    const text = token.text ?? '';
    return token.type === 'text' ? decodeHTMLStrict(text) : text;
  }).join('').trim();
}
