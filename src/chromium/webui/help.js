// Copyright 2026 TAi Browser contributors.
// SPDX-License-Identifier: BSD-3-Clause
import {sendWithPromise} from 'chrome://resources/js/cr.js';
import {setLanguage,setColorMode, t} from './i18n.js';

const form = document.querySelector('#report');
const subject = document.querySelector('#subject');
const details = document.querySelector('#details');
const email = document.querySelector('#email');
const status = document.querySelector('#status');
const issue = 'https://github.com/EuanTop/tai-browser/issues/new';
const recipient = 'mailto:euan@mail.bnu.edu.cn';
const linkLimit = 7000;

setLanguage(navigator.language.startsWith('zh') ? 'zh' : 'en');
sendWithPromise('taiGetState').then(state => {
  if (state.language) setLanguage(state.language);
  setColorMode(state.colorMode);
  if (state.edition) document.documentElement.dataset.edition = state.edition;
}).catch(() => {});

function issueDraft(title, body) {
  const url = new URL(issue);
  url.searchParams.set('title', title);
  if (body) url.searchParams.set('body', body);
  return url.href;
}

function mailDraft(title, body) {
  return recipient + '?subject=' + encodeURIComponent(title) +
      (body ? '&body=' + encodeURIComponent(body) : '');
}

function draft(buildLink) {
  const title = subject.value.trim();
  const body = details.value.trim();
  const url = buildLink(title, body);
  if (url.length <= linkLimit) return url;
  status.textContent = t('反馈较长，请复制完整内容后粘贴到草稿中。');
  return buildLink(title, '');
}

form.addEventListener('input', () => {
  status.textContent = '';
  subject.setCustomValidity('');
  details.setCustomValidity('');
});

form.addEventListener('submit', event => {
  event.preventDefault();
  for (const field of [subject, details]) {
    field.setCustomValidity(field.value.trim() ? '' : t('请填写此项。'));
  }
  if (form.reportValidity()) {
    window.open(draft(issueDraft), '_blank', 'noopener,noreferrer');
  }
});

email.addEventListener('click', () => {
  email.href = draft(mailDraft);
});

document.querySelector('#copy').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(
        [subject.value.trim(), details.value.trim()].filter(Boolean).join('\n\n'));
    status.textContent = t('已复制反馈。');
  } catch {
    details.focus();
    details.select();
    status.textContent = t('请选择并手动复制反馈。');
  }
});
