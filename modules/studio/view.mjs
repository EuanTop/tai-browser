/** Small version panel; generating code stays in the user's original Agent channel. */
export function mountVersionPanel(root, { studio }) {
  const document = root.ownerDocument;
  let closed = false;
  function render() {
    if (closed) return;
    const state = studio.state(), label = document.createElement('p');
    label.textContent = state.current ? state.current.title + ' ' + state.current.version + (state.enabled ? ' · active' : ' · disabled') : 'No app applied';
    const status = document.createElement('p'); status.setAttribute('role','status');
    const list = document.createElement('ul');
    function action(button, operation) {
      button.addEventListener('click',async () => {
        button.disabled = true;
        try { await operation(); render(); } catch { status.textContent = 'Change could not complete; refresh app status'; button.disabled = false; }
      });
    }
    for (const manifest of state.versions) {
      const item = document.createElement('li'); item.textContent = manifest.title + ' ' + manifest.version + ' ';
      if (state.preview?.id === manifest.id && state.preview.version === manifest.version) {
        const apply = document.createElement('button'); apply.textContent = 'Apply'; action(apply,() => studio.apply(manifest.id,manifest.version)); item.append(apply);
      }
      if (state.history.includes(manifest.id + '@' + manifest.version)) {
        const undo = document.createElement('button'); undo.textContent = 'Restore version'; action(undo,() => studio.rollback(manifest.id,manifest.version)); item.append(undo);
      }
      list.append(item);
    }
    const disable = document.createElement('button'); disable.textContent = 'Disable'; disable.disabled = !state.enabled;
    const cancel = document.createElement('button'); cancel.textContent = 'Cancel preview'; cancel.disabled = !state.preview;
    action(cancel,() => studio.cancel());
    action(disable,() => studio.disable()); root.replaceChildren(label,list,disable,cancel,status);
  }
  render(); return { refresh:render,close() { closed = true; root.replaceChildren(); } };
}
