export const settings = Object.freeze([
  { key: 'ai.agent.channel', title: 'Agent 渠道', type: 'select', scope: 'profile', default: 'codex-app-server',
    options: [{ value: 'codex-app-server', label: 'Codex App Server（协议原型）' }] },
  { key: 'ai.agent.panel-open', title: '打开右侧对话栏', type: 'boolean', scope: 'app', default: false },
]);
