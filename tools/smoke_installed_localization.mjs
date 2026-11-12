// Exercise the installed app with disposable Profiles and process-local macOS languages.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { startNativeBrowser, until } from './native_smoke_support.mjs';

const launcher = process.argv[2];
if (!launcher || process.platform !== 'darwin') {
  throw new Error('Pass the installed macOS TAiLauncher path.');
}

const profiles = resolve('research/local/browser-profiles');
await mkdir(profiles, { recursive: true });

const nativePages = [
  ['chrome://settings/', 'Settings', '设置'],
  ['chrome://history/', 'History', '历史记录'],
  ['chrome://extensions/', 'Extensions', '扩展程序'],
];
const taiPages = [
  ['chrome://tai/#appearance', 'TAi Browser Settings', 'TAi Browser 设置'],
  ['chrome://tai/#agent', 'TAi Browser Settings', 'TAi Browser 设置'],
  ['chrome://tai/home.html', 'TAi · New Tab', 'TAi · 新标签页'],
  ['chrome://tai/help.html', 'TAi Browser Help', 'TAi Browser 帮助'],
];

for (const [appLanguage, preference] of [
  ['en', 'system'], ['zh-Hans', 'system'], ['en', 'zh-CN'], ['zh-Hans', 'en'],
]) {
  const profile = await mkdtemp(join(profiles, 'locale-matrix-'));
  let browser;
  try {
    await mkdir(join(profile, 'Default'));
    await writeFile(join(profile, 'Default', 'SidebarWorkspace.json'), JSON.stringify({
      version: 1, language: preference, active: 'personal', welcome_pending: false,
      spaces: [{ id: 'personal', name: 'Personal' }], items: [],
    }));

    // A startup URL after the Cocoa arguments can be interpreted as a second
    // headless target. Navigate explicitly after startup.
    browser = await startNativeBrowser(resolve(launcher), profile, {
      product: false, navigate: false, initialURL: null,
      extra: ['-AppleLanguages', '(' + appLanguage + ')'],
    });
    const nativeChinese = appLanguage === 'zh-Hans';
    const taiChinese = preference === 'system' ? nativeChinese : preference === 'zh-CN';

    for (const [pages, chinese] of [[taiPages, taiChinese], [nativePages, nativeChinese]]) {
      for (const [url, english, simplifiedChinese] of pages) {
        const title = chinese ? simplifiedChinese : english;
        await browser.call('Page.navigate', { url });
        const correct = await until(() => browser.evaluate(`document.readyState==='complete'
          && location.href===${JSON.stringify(url)} && document.title===${JSON.stringify(title)}
          && document.documentElement.lang.toLowerCase().startsWith(${JSON.stringify(chinese ? 'zh' : 'en')})`));
        assert(correct, `${appLanguage}/${preference} ${url} should display ${title}`);
      }
    }
    console.log(`PASS ${appLanguage}/${preference} (4 TAi pages, 3 Chromium pages)`);
  } finally {
    await browser?.stop();
    await rm(profile, { recursive: true, force: true });
  }
}
