// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
import {sendWithPromise, addWebUiListener} from 'chrome://resources/js/cr.js';
import {setLanguage,setColorMode, t} from './i18n.js';

const $ = selector => document.querySelector(selector);
const card = $('.welcome');
const intro = $('#welcome-intro');
const importPanel = $('#welcome-import');
const openImport = $('#open-import');
const back = $('#import-back');
const sources = $('#import-sources');
const choose = $('#pick-file');
const proceed = $('#continue');
const status = $('#welcome-status');
const selectedSource = () => sources.querySelector(':checked').value;
const labels = {chrome: 'Chrome 书签', arc: 'Arc 收藏', safari: 'Safari 书签'};
let busy = false;
let currentSource;
let nextPage = '';
let startup = false;

function receive(state) {
  if (!state.ready) return;
  setLanguage(state.language);
  setColorMode(state.colorMode);
  document.documentElement.dataset.edition = state.edition;
  document.querySelector('.welcome-logo').src = state.edition === 'pride'
    ? 'brand-pride-icon.png' : 'brand-product-icon.png';
}

function showImport(visible) {
  syncSource();
  intro.hidden = visible;
  openImport.hidden = visible;
  importPanel.hidden = !visible;
  proceed.classList.toggle('button-quiet', visible);
  $(visible ? '#import-heading' : '#open-import').focus();
}

openImport.onclick = () => showImport(true);
back.onclick = () => showImport(false);

function syncSource() {
  const source = selectedSource();
  if (source === currentSource) return;
  currentSource = source;
  if (source !== 'safari' && nextPage === 'safari') nextPage = '';
  for (const detail of document.querySelectorAll('[data-source-info]')) {
    detail.hidden = detail.dataset.sourceInfo !== source;
  }
  $('#safari-native').hidden = source !== 'safari';
  status.textContent = '';
}

function controls(disabled) {
  busy = disabled;
  sources.disabled = disabled;
  choose.disabled = disabled;
  proceed.disabled = disabled;
  back.disabled = disabled;
}

sources.addEventListener('change', syncSource);
choose.onclick = async () => {
  if (busy) return;
  syncSource();
  const source = selectedSource();
  controls(true);
  let saved = false;
  try {
    const file = await sendWithPromise('taiPickWelcomeExport', source);
    if (file.error?.code === 'CANCELED') return;
    if (!file.ok) throw new Error(file.error?.code ?? 'IMPORT_READ_FAILED');
    status.textContent = t('正在导入…');
    const {previewWelcomeImport} = await import('./welcome-import.js');
    let plan;
    try {
      plan = previewWelcomeImport(source, file.value, {
        source: t(labels[source]),
        favorites: t('Arc 常用网站'),
        tabs: t('Arc 未固定标签'),
        untitled: t('未命名'),
      });
    } catch (error) {
      if (error.message.startsWith('IMPORT_')) throw error;
      throw new Error('IMPORT_NO_LINKS');
    }
    const result = await sendWithPromise('taiImportWelcome', plan.spaces);
    if (result.ok) {
      const links = t(plan.linkCount === 1 ? '1 个链接' : '{count} 个链接')
        .replace('{count}', plan.linkCount);
      const spaces = t(plan.spaces.length === 1 ? '1 个新 Space' : '{count} 个新 Space')
        .replace('{count}', plan.spaces.length);
      status.textContent = t('已将 {links} 导入 {spaces}。')
        .replace('{links}', links).replace('{spaces}', spaces);
      if (plan.hasWarnings) status.textContent += ' ' + t('部分项目无法导入。');
    } else if (result.error?.code === 'ALREADY_IMPORTED') {
      status.textContent = t('这批链接已导入。');
    } else {
      throw new Error(result.error?.code);
    }
    saved = true;
  } catch (error) {
    const messages = {
      IMPORT_FILE_LIMIT: '导出文件超过 4 MB。',
      IMPORT_ITEM_LIMIT: '单次导入最多 10,000 个链接和文件夹。',
      IMPORT_SPACE_LIMIT: '单次导入最多 256 个 Space。',
      IMPORT_NESTING_LIMIT: '导出的文件夹层级太深。',
      IMPORT_STORAGE_LIMIT: 'Space 存储空间不足，请分批导入。',
      IMPORT_READ_FAILED: '无法读取导出文件，请重新选择。',
      IMPORT_NO_LINKS: '未找到可导入的链接，请确认文件来自所选浏览器。',
    };
    status.textContent = t(messages[error.message] ?? '暂时无法保存导入内容，请稍后重试。');
  } finally {
    controls(false);
    if (saved) proceed.focus();
  }
};

for (const [link, destination, notice] of [
  [$('#import-passwords'), 'passwords', '点「开始浏览」后打开密码导入。'],
  [$('#safari-native'), 'safari', '点「开始浏览」后打开 Safari 导入。'],
]) {
  link.addEventListener('click', event => {
    if (!startup) return;
    event.preventDefault();
    nextPage = destination;
    status.textContent = t(notice);
    proceed.focus();
  });
  link.addEventListener('auxclick', event => {
    if (startup) event.preventDefault();
  });
}

proceed.onclick = async () => {
  if (busy) return;
  controls(true);
  const exit = matchMedia('(prefers-reduced-motion: reduce)').matches ? null :
    card.animate([{opacity: 1, transform: 'none'},
      {opacity: 0, transform: 'translateY(-8px) scale(.985)'}],
    {duration: 150, easing: 'ease-in', fill: 'forwards'});
  try {
    await exit?.finished;
    if (await sendWithPromise('taiCompleteWelcome', nextPage)) return;
  } catch {
  } finally {
    controls(false);
  }
  exit?.cancel();
  status.textContent = t('暂时无法保存欢迎页状态，请稍后重试。');
};

syncSource();
addWebUiListener('tai-state-changed', receive);
void sendWithPromise('taiGetState').then(receive).catch(() => {});
void sendWithPromise('taiPrepareWelcome').then(surface => {
  if (surface === 'tab') {
    location.replace('chrome://tai/#browser');
    return;
  }
  startup = surface === 'startup';
  card.hidden = false;
  if (surface === 'import') {
    back.hidden = true;
    proceed.dataset.i18n = '完成导入';
    proceed.textContent = t('完成导入');
    showImport(true);
  }
}).catch(() => {});
