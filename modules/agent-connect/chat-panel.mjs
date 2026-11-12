/** Browser-only UI. The native host supplies a narrow controller; no Node/credentials. */
export function mountChatPanel(container, controller) {
  const document = container.ownerDocument;
  const root = document.createElement('section'); root.className = 'tai-agent-panel';
  root.setAttribute('aria-label', 'Agent 对话');
  const style = document.createElement('style');
  style.textContent = `.tai-agent-panel{font:14px/1.5 system-ui,sans-serif;color:inherit;display:flex;flex-direction:column;height:100%;min-width:260px;background:var(--tai-panel-background,#f8f7f4)}.tai-agent-panel *{box-sizing:border-box}.tai-agent-panel header,.tai-agent-panel form,.tai-agent-panel footer{padding:12px;border-bottom:1px solid #8883}.tai-agent-panel h2{font-size:15px;margin:0}.tai-agent-panel p{margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere}.tai-agent-panel main{overflow:auto;flex:1;padding:12px}.tai-agent-panel article{padding:10px 0;border-bottom:1px solid #8883}.tai-agent-panel button{font:inherit;padding:6px 10px;margin:4px 6px 4px 0;border:1px solid #8886;border-radius:8px;background:transparent;color:inherit;cursor:pointer}.tai-agent-panel button:disabled{opacity:.5;cursor:default}.tai-agent-panel textarea{width:100%;min-height:72px;font:inherit;resize:vertical;border:1px solid #8886;border-radius:8px;padding:8px;color:inherit;background:transparent}.tai-agent-panel small{display:block;opacity:.7}.tai-agent-panel aside{padding:12px;border-top:1px solid #8883}.tai-agent-panel [role=alert]{color:var(--tai-error,#9b302b)}.tai-agent-panel :focus-visible{outline:2px solid #52897b;outline-offset:2px}`;
  const el = (tag, text, parent = root) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; parent.append(node); return node; };
  root.append(style);
  const header = el('header'); el('h2', 'Codex', header);
  const status = el('p', '', header); status.setAttribute('role', 'status');
  const binding = el('small', '', header);
  const notice = el('small', '恢复会话需要接管原入口；历史记录单独载入。', header);
  const messages = el('main'); messages.setAttribute('aria-label', '当前连接消息'); messages.setAttribute('aria-live', 'polite');
  const approvals = el('aside'); approvals.setAttribute('aria-label', '等待批准');
  const form = el('form');
  const label = el('label', '发送消息', form);
  const input = el('textarea', undefined, label); input.setAttribute('aria-label', '发送消息'); input.maxLength = 64000;
  const send = el('button', '发送', form); send.type = 'submit';
  const stop = el('button', '停止', form); stop.type = 'button';
  const error = el('p', '', form); error.setAttribute('role', 'alert');
  const footer = el('footer');
  const historyButton = el('button', '载入历史', footer); historyButton.type = 'button';
  const history = el('div', undefined, footer); history.setAttribute('aria-label', '历史记录');
  const labels = { disconnected: '已断开', ready: '选择会话后开始', idle: '已连接', resumed: '已恢复 · 接管模式',
    starting: '正在发送', running: '正在执行', 'awaiting-approval': '等待你的批准', stopping: '正在停止', uncertain: '发送结果待核对，请重新连接并查看历史' };
  let disposed = false, sending = false;
  const run = async action => { error.textContent = ''; try { await action(); } catch { if (!disposed) error.textContent = '操作未完成，请核对会话状态后重试。'; } };
  function update(snapshot) {
    if (disposed) return;
    status.textContent = snapshot.state === 'idle' && snapshot.lastTurn?.status === 'failed' ? '上次执行失败' :
      snapshot.state === 'idle' && snapshot.lastTurn?.status === 'interrupted' ? '已停止' : labels[snapshot.state] ?? '未知连接状态';
    binding.textContent = `空间 ${snapshot.binding.spaceId} · 任务 ${snapshot.binding.taskId} · ${snapshot.threadId ?? '未选择会话'}`;
    notice.textContent = snapshot.state === 'resumed' ? '已恢复同一会话历史；当前入口持有接管权。' : '恢复会话需要接管原入口；历史记录单独载入。';
    send.disabled = sending || !['idle', 'resumed'].includes(snapshot.state);
    stop.disabled = !['running', 'awaiting-approval'].includes(snapshot.state);
    historyButton.disabled = !snapshot.threadId || snapshot.state === 'disconnected';
    messages.replaceChildren();
    for (const item of snapshot.items ?? []) {
      const article = el('article', undefined, messages);
      if (item.type === 'agentMessage') el('p', item.text ?? '', article);
      else if (item.type === 'userMessage') el('p', (item.content ?? []).filter(x => x.type === 'text').map(x => x.text).join('\n'), article);
      else { el('small', ({ commandExecution: '执行命令', fileChange: '修改文件', mcpToolCall: '调用工具' })[item.type] ?? 'Agent 活动', article);
        el('p', item.status ?? (item.final ? '已完成' : '处理中'), article); }
    }
    approvals.replaceChildren(); approvals.hidden = !snapshot.approvals?.length;
    for (const approval of snapshot.approvals ?? []) {
      const article = el('article', undefined, approvals);
      el('strong', approval.kind === 'item/fileChange/requestApproval' ? '允许文件修改？' : '允许命令执行？', article);
      if (approval.networkApprovalContext) el('p', `网络访问：${JSON.stringify(approval.networkApprovalContext)}`, article);
      if (approval.command) el('p', approval.command, article);
      if (approval.reason) el('p', approval.reason, article);
      if (approval.cwd || approval.grantRoot) el('p', approval.cwd ?? approval.grantRoot, article);
      for (const item of snapshot.items ?? []) if (item.id === approval.itemId && item.changes)
        el('p', JSON.stringify(item.changes), article);
      for (const [decision, title] of [['accept','允许一次'], ['decline','拒绝'], ['cancel','取消任务']]) {
        if (approval.availableDecisions && !approval.availableDecisions.includes(decision)) continue;
        const button = el('button', title, article); button.type = 'button';
        button.addEventListener('click', () => { button.disabled = true; void run(() => controller.approve(approval.requestId, decision)); });
      }
    }
  }
  form.addEventListener('submit', event => {
    event.preventDefault(); if (send.disabled || !input.value.trim()) return;
    const text = input.value; sending = true; send.disabled = true;
    void run(async () => { await controller.send(text); if (!disposed && input.value === text) input.value = ''; })
      .finally(() => { sending = false; if (!disposed) update(controller.getSnapshot()); });
  });
  stop.addEventListener('click', () => { stop.disabled = true; void run(() => controller.cancel()); });
  historyButton.addEventListener('click', () => {
    historyButton.disabled = true;
    void run(async () => {
      const page = await controller.history(); if (disposed) return;
      history.replaceChildren(); el('small', '历史记录（非实时活动）', history);
      for (const turn of page.data ?? []) {
        const article = el('article', undefined, history); el('small', `回合 ${turn.id} · ${turn.status}`, article);
        for (const item of turn.items ?? []) if (item.type === 'agentMessage') el('p', item.text ?? '', article);
      }
      if (page.nextCursor) el('small', '还有较早记录，可由会话宿主继续分页载入。', history);
    }).finally(() => { if (!disposed) update(controller.getSnapshot()); });
  });
  container.append(root); const unsubscribe = controller.subscribe(update); update(controller.getSnapshot());
  return () => { disposed = true; unsubscribe(); root.remove(); };
}
