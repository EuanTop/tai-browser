/** First-party DOM factory; all source strings are inert text, never markup/links. */
export function mountMigrationPanel(container, { controller, catalog }) {
  const doc = container.ownerDocument;
  let selections = {}, disposed = false;
  const el = (tag, text) => { const node = doc.createElement(tag); if (text !== undefined) node.textContent = text; return node; };
  const button = (text, action) => { const node = el('button', text); node.type = 'button'; node.addEventListener('click', action); return node; };
  const root = el('section'); root.setAttribute('aria-label', '数据迁移预览');
  const choose = button('选择来源', () => { selections = {}; void controller.select(); });
  const cancel = button('中止', () => controller.cancel());
  const status = el('p'); status.setAttribute('role', 'status');
  const content = el('div');
  const submit = button('导入', () => {}); submit.disabled = true;
  const reason = el('p', controller.getState().commitUnavailable);
  root.append(el('h2', '从 Chrome / Arc 迁移'),
    el('p', '仅迁移组织与可恢复网址；来源名称不代表已登录账号。不导入 Cookie、密码或扩展，目标账号环境可能需要重新登录。Arc 会话与分屏不能完整恢复。'),
    choose, cancel, status, content, submit, reason);
  container.append(root);
  function select(label, options, current, change) {
    const wrapper = el('label', label), node = el('select'); node.setAttribute('aria-label', label);
    for (const [value, title] of [['', '请选择'], ['new', '新建（仅计划）'], ...options]) {
      const option = el('option', title); option.value = value; node.append(option);
    }
    const selected = [...node.options].find(option => option.value === (current ?? '')) ?? node.options[0];
    selected.selected = true;
    node.addEventListener('change', () => change(node.value)); wrapper.append(node); return wrapper;
  }
  // Page long lists without dropping empty folders, hierarchy or repeated URLs.
  function tree(items, title) {
    const group = el('section'); group.append(el('h5', `${title} · ${items.length}`));
    if (!items.length) { group.append(el('p', '空')); return group; }
    const rows = [];
    function walk(items, depth) { for (const item of items) { rows.push({ item, depth }); if (item.children) walk(item.children, depth + 1); } }
    walk(items, 0);
    const list = el('ol'); let offset = 0;
    const more = button('显示更多', render);
    function render() {
      for (const { item, depth } of rows.slice(offset, offset + 100)) {
        const row = el('li', `${item.kind === 'folder' ? '文件夹' : '页面'}：${item.title || '未命名'}${item.url ? ` · ${item.url}` : ''}${item.children?.length === 0 ? '（空文件夹）' : ''}`);
        row.style.paddingInlineStart = `${depth * 16}px`;
        row.setAttribute('data-kind', item.kind); row.setAttribute('data-depth', String(depth));
        if (item.url) row.setAttribute('data-url', item.url);
        list.append(row);
      }
      offset += 100; more.hidden = offset >= rows.length;
    }
    group.append(list, more); render(); return group;
  }
  const unsubscribe = controller.subscribe(state => {
    if (disposed) return;
    status.textContent = ({ idle: '请选择授权来源', selecting: '等待原生来源选择器', parsing: '正在 worker 中解析',
      ready: '预览就绪（尚未导入）', cancelled: '已中止', error: `预览失败：${state.error}` })[state.status];
    cancel.disabled = !['selecting', 'parsing', 'ready'].includes(state.status);
    content.replaceChildren();
    if (!state.preview) return;
    for (const r of state.preview.results) {
      const source = el('article'); source.append(el('h3', `${r.source.name} · ${r.source.format}`));
      source.append(el('p', `来源身份：${r.source.sourceId} · SHA-256：${r.source.sha256}`));
      const chosen = selections[r.source.sourceId] ??= [];
      for (const p of r.plan.profiles) {
        let mapping = chosen.find(m => m.sourceProfileId === p.sourceProfileId);
        if (!mapping) { mapping = { sourceProfileId: p.sourceProfileId, targetProfileId: '',
          spaces: p.spaces.map(s => ({ sourceSpaceId: s.sourceSpaceId, targetSpaceId: '' })) }; chosen.push(mapping); }
        const profile = el('section'); profile.append(el('h4', `来源账号环境：${p.name}（登录未导入）`));
        const spaceControls = el('div');
        const renderSpaces = () => {
          spaceControls.replaceChildren();
          const target = catalog.profiles.find(t => t.profileId === mapping.targetProfileId);
          for (const s of p.spaces) {
            const sm = mapping.spaces.find(m => m.sourceSpaceId === s.sourceSpaceId);
            spaceControls.append(select(`Space 映射：${s.name}`, (target?.spaces ?? []).map(t => [t.spaceId, t.name]), sm.targetSpaceId,
              value => { sm.targetSpaceId = value; }));
          }
        };
        profile.append(select('目标账号环境', catalog.profiles.map(t => [t.profileId, t.name]), mapping.targetProfileId,
          value => { mapping.targetProfileId = value; for (const s of mapping.spaces) s.targetSpaceId = ''; renderSpaces(); }));
        renderSpaces(); profile.append(spaceControls, tree(p.favorites, '常用网站'));
        for (const s of p.spaces) {
          const space = el('section'); space.append(el('h4', `Space：${s.name}`), tree(s.saved, '收藏'), tree(s.temporary, '临时区（仅可恢复网址）'));
          profile.append(space);
        }
        source.append(profile);
      }
      source.append(el('p', r.mappingError ? `映射待处理：${r.mappingError}` :
        `批次：新增 ${r.batch.counts.create} · 重复批次跳过 ${r.batch.counts.skipped} · 冲突 ${r.batch.counts.conflicts}`));
      if (!r.historyAvailable) source.append(el('p', '宿主持久批次历史未接入；重新选源后的重复导入尚不能确认。'));
      if (r.previousBatches.length) source.append(el('p', `已导入相同摘要的来源批次：${r.previousBatches.join('、')}；禁止生成重复提交意图。`));
      if (r.duplicateSelection) source.append(el('p', '本次选择中存在相同摘要的来源；请保留一份，避免重复批次。'));
      if (r.batch?.counts.conflicts) {
        const conflicts = el('ul'); conflicts.setAttribute('aria-label', '冲突');
        for (const item of r.batch.actions.filter(a => a.status === 'conflict')) conflicts.append(el('li',
          `${item.value.title || '未命名'} · ${item.destination.area} · 位置 ${item.position} · 来源 ${item.sourceId}`));
        source.append(conflicts);
      }
      const warnings = el('ul'); warnings.setAttribute('aria-label', '警告');
      for (const warning of r.plan.warnings) warnings.append(el('li', warning.code));
      source.append(warnings); content.append(source);
    }
    content.append(button('更新映射预览', () => controller.setMappings(selections)));
  });
  return { dispose() { disposed = true; unsubscribe(); controller.dispose(); root.remove(); } };
}