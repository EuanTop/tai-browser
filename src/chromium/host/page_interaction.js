// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
// Runs only in Chromium's isolated world, with arguments supplied by NativeHost.
// A compact DOM control inventory, not a complete accessibility-tree snapshot.
(args => {
  const key = '__taiControlsV1';
  const stores = globalThis[key] ??= new Map();
  const clean = value => String(value ?? '').slice(0, 2048).replace(/\s+/gu, ' ').trim().slice(0, 256);
  const valueField = node => node.matches('input,textarea,select,script,style,[role="textbox"]') || node.isContentEditable;
  const labelText = node => {
    if (!node || valueField(node)) return '';
    // textContent on textarea or a wrapping label can reveal an initial draft.
    let text = '', count = 0, child = node.firstChild;
    while (child && ++count <= 1024 && text.length < 256) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent.slice(0, 256 - text.length) + ' ';
      const skip = child.nodeType === Node.ELEMENT_NODE && valueField(child);
      if (!skip && child.firstChild) { child = child.firstChild; continue; }
      while (child && !child.nextSibling) {
        child = child.parentNode === node ? null : child.parentNode;
      }
      child = child?.nextSibling;
    }
    return clean(text);
  };
  const name = element => {
    const labelled = element.getAttribute('aria-labelledby');
    return clean(element.getAttribute('aria-label') ||
      (labelled && labelled.split(/\s+/u).slice(0, 16).map(id => labelText(document.getElementById(id))).join(' ').trim()) ||
      Array.from(element.labels || []).slice(0, 16).map(labelText).join(' ').trim() ||
      element.getAttribute('alt') || element.getAttribute('title') ||
      element.getAttribute('placeholder') ||
      labelText(element));
  };
  const visible = element => {
    const style = getComputedStyle(element);
    return !element.closest('[hidden],[inert],[aria-hidden="true"]') &&
      style.visibility !== 'hidden' && style.display !== 'none' && element.getClientRects().length > 0;
  };
  const disabled = element => element.matches(':disabled,[aria-disabled="true"]');
  const role = element => clean(element.getAttribute('role')).slice(0, 64) ||
    (element.matches('a[href]') ? 'link' : element.matches('button,input[type="submit"],input[type="button"]') ? 'button' :
      element.matches('input[type="checkbox"]') ? 'checkbox' : element.matches('input[type="radio"]') ? 'radio' :
      element.matches('select') ? 'combobox' : 'textbox');
  if (args.mode === 'read') {
    const old = stores.get(args.owner);
    old?.dispose();
    stores.delete(args.owner);
    // Bound retained DOM references, including when multiple authorized clients read.
    while (stores.size >= 8) {
      const oldest = stores.keys().next().value;
      stores.get(oldest).dispose();
      stores.delete(oldest);
    }
    const state = {id: args.snapshotId, entries: new Map(), dirty: false, at: performance.now()};
    state.dispose = () => {
      state.dirty = true;
      state.entries.clear();
      state.observer.disconnect();
      clearTimeout(state.timer);
      for (const event of ['input', 'change', 'pointerdown', 'keydown'])
        document.removeEventListener(event, state.dispose, true);
    };
    state.observer = new MutationObserver(state.dispose);
    state.observer.observe(document, {subtree: true, childList: true, attributes: true, characterData: true});
    for (const event of ['input', 'change', 'pointerdown', 'keydown'])
      document.addEventListener(event, state.dispose, true);
    state.timer = setTimeout(state.dispose, 30000);
    const controls = [], walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
    let element = walker.currentNode, scanned = 0, truncated = false;
    for (; element; element = walker.nextNode()) {
      if (++scanned > 20000 || controls.length >= 200) { truncated = true; break; }
      if (!element.matches('a[href],button,input:not([type="hidden"]),textarea,select,[role="button"],[role="link"],[role="textbox"],[role="checkbox"],[role="radio"]') || !visible(element)) continue;
      const ref = 'e' + (controls.length + 1);
      const item = {ref, role: role(element), name: name(element), disabled: disabled(element)};
      if (element.matches('input[type="password"]')) item.sensitive = true;
      // Never serialize input values, including password, hidden or autofilled fields.
      state.entries.set(ref, {element, name: item.name, role: item.role});
      controls.push(item);
    }
    stores.set(args.owner, state);
    return {url: location.href, title: clean(document.title), snapshotId: state.id, controls, truncated,
      coverage: 'main-frame DOM controls; no iframe or shadow-root traversal',
      validForMs: 30000};
  }
  const state = stores.get(args.owner);
  let element;
  if (args.selector) {
    try { element = document.querySelector(args.selector); }
    catch { return {performed: false, reason: 'INVALID_SELECTOR'}; }
    if (!element) return {performed: false, reason: 'NOT_FOUND'};
  } else {
    if (!state || state.id !== args.snapshotId) return {performed: false, reason: 'STALE_SNAPSHOT'};
    if (state.dirty || state.observer.takeRecords().length || performance.now() - state.at > 30000) {
      state.dispose();
      return {performed: false, reason: 'STALE_SNAPSHOT'};
    }
    const entry = state.entries.get(args.ref);
    element = entry?.element;
    if (!element?.isConnected || name(element) !== entry.name || role(element) !== entry.role)
      return {performed: false, reason: 'STALE_ELEMENT'};
  }
  if (!visible(element)) return {performed: false, reason: 'NOT_VISIBLE'};
  if (disabled(element)) return {performed: false, reason: 'NOT_ENABLED'};
  if (args.action === 'click') {
    const link = element.closest('a[href],area[href]');
    const submits = element.matches('button:not([type]),button[type="submit"],input[type="submit"],input[type="image"]') && element.form;
    const formTarget = submits && (element.getAttribute('formtarget') || element.form.target);
    const target = (link || submits) &&
      (link?.target || formTarget || document.querySelector('base[target]')?.target);
    if (element.matches('input[type="file"]') || link?.hasAttribute('download') ||
        (target && target.toLowerCase() !== '_self'))
      return {performed: false, reason: 'HUMAN_REQUIRED'};
    state?.dispose();
    element.click();
    return {performed: true, verification: 'dispatched; read again to verify the website outcome'};
  }
  if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) || element.readOnly)
    return {performed: false, reason: 'NOT_EDITABLE'};
  if (element.type === 'password') return {performed: false, reason: 'SENSITIVE_FIELD'};
  if (element instanceof HTMLInputElement && !['text','search','email','tel','url','number'].includes(element.type))
    return {performed: false, reason: 'NOT_EDITABLE'};
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  // Consume immediately before dispatch, never duplicate a write on replay.
  state?.dispose();
  Object.getOwnPropertyDescriptor(proto, 'value').set.call(element, args.value);
  element.dispatchEvent(new Event('input', {bubbles: true}));
  element.dispatchEvent(new Event('change', {bubbles: true}));
  return {performed: true, verification: 'dispatched; read again to verify the website outcome'};
})
