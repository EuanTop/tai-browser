import { mountPomodoro } from './view.mjs';
// The isolated host injects a capability-scoped SDK before executing this module.
if (globalThis.taiComponentSDK) {
  const view = await mountPomodoro(document.querySelector('main'), { sdk:globalThis.taiComponentSDK,locale:'zh-CN' });
  addEventListener('pagehide',() => view.close(),{once:true});
}
