import { mountChatPanel } from './chat-panel.mjs';

const fields = ['profileId', 'spaceId', 'taskId'];
const methods = ['getSnapshot', 'subscribe', 'send', 'approve', 'cancel', 'history'];

/** Browser ESM entry. Organizer injects its authorized IPC facade, never a Node session or Key. */
export function createAgentPanelModule({ binding, controller } = {}) {
  if (!binding || Object.keys(binding).sort().join(',') !== [...fields].sort().join(',') ||
      fields.some(key => typeof binding[key] !== 'string' || !binding[key].trim()))
    throw new TypeError('Fixed task binding required');
  const fixed = Object.freeze({ ...binding });
  if (controller && methods.some(key => typeof controller[key] !== 'function'))
    throw new TypeError('Authorized panel controller required');
  let unmount;
  const snapshot = value => {
    if (!value || fields.some(key => value.binding?.[key] !== fixed[key]))
      throw new TypeError('Panel binding mismatch');
    if (value.capabilities?.liveAttach || value.capabilities?.concurrentWriters)
      throw new TypeError('Codex adapter supports exclusive takeover only');
    // Keep the browser entry independent of Node, provider settings and credential APIs.
    return structuredClone(Object.fromEntries(['channel', 'state', 'binding', 'threadId', 'turnId',
      'lastTurn', 'capabilities', 'items', 'approvals'].map(key => [key, value[key]])));
  };
  const facade = controller && {
    getSnapshot: () => snapshot(controller.getSnapshot()),
    subscribe: listener => controller.subscribe(value => listener(snapshot(value))),
    ...Object.fromEntries(['send', 'approve', 'cancel', 'history'].map(key => [key, (...args) => {
      snapshot(controller.getSnapshot()); return controller[key](...args);
    }])),
  };
  return Object.freeze({
    id: 'tai.agent.codex', binding: fixed,
    capabilities: Object.freeze({ resume: true, liveAttach: false, concurrentWriters: false,
      panel: !!controller, modules: false, quickModelCredentials: false }),
    mount(container) {
      if (unmount) throw new Error('Panel already mounted');
      if (facade) unmount = mountChatPanel(container, facade);
      else {
        const notice = container.ownerDocument.createElement('p'); notice.setAttribute('role', 'status');
        notice.dataset.code = 'CAPABILITY_UNAVAILABLE';
        notice.textContent = '会话面板尚未连接。请继续在原 Agent 入口使用 TAi MCP；恢复会话须先取得接管权。';
        container.append(notice); unmount = () => notice.remove();
      }
    },
    dispose() { unmount?.(); unmount = undefined; },
  });
}
