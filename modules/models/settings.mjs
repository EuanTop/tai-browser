/** Declarations only: unified host validates/persists and stores secrets. */
export const settings = Object.freeze([
  { key: 'ai.quick.endpoint', title: '快捷模型服务地址', type: 'string', scope: 'profile', default: '' },
  { key: 'ai.quick.model', title: '快捷模型名称', type: 'string', scope: 'profile', default: '' },
  { key: 'ai.quick.credential', title: '快捷模型凭据', type: 'credential-reference', scope: 'profile' },
]);
