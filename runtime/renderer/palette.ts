// ⌘K / Ctrl+K command palette for the notebook: a filterable list of quick actions.
import { el, iconBadge } from './ui';

export type PaletteAction = { id: string; title: string; icon: string; group: string; hint?: string; keywords?: string; shortcut?: string; run: () => void };

/** Case-insensitive match over title, hint and keywords; every space-separated term must appear. */
export function matchAction(action: Pick<PaletteAction, 'title' | 'hint' | 'keywords' | 'group'>, query: string): boolean {
  const haystack = `${action.title} ${action.hint || ''} ${action.keywords || ''} ${action.group}`.toLowerCase();
  return query.toLowerCase().split(/\s+/).filter(Boolean).every(term => haystack.includes(term));
}

export function openPalette(actions: PaletteAction[], onClose?: () => void) {
  if (document.querySelector('.palette-backdrop')) return;
  const previous = document.activeElement as HTMLElement | null;
  const backdrop = el('div', 'palette-backdrop'), box = el('div', 'palette');
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); box.setAttribute('aria-label', '快捷操作');
  const search = el('div', 'palette-search'), input = el('input');
  input.placeholder = '搜索操作、页面、角色、小人…'; input.setAttribute('aria-label', '搜索快捷操作'); input.setAttribute('role', 'combobox'); input.setAttribute('aria-controls', 'palette-list'); input.spellcheck = false;
  search.append(el('span', 'palette-glass', '⌕'), input, el('kbd', '', 'Esc'));
  const list = el('div', 'palette-list'); list.id = 'palette-list'; list.setAttribute('role', 'listbox');
  const foot = el('div', 'palette-foot'); foot.append(el('span', '', '↑↓ 选择'), el('span', '', '↵ 执行'), el('span', '', 'Ctrl+1…0 切换页面'), el('span', '', '/ 聚焦输入框'));
  box.append(search, list, foot); backdrop.append(box); document.body.append(backdrop);
  let shown: PaletteAction[] = [], index = 0;
  const close = () => { backdrop.classList.add('closing'); setTimeout(() => backdrop.remove(), 140); document.removeEventListener('keydown', keys, true); previous?.focus?.(); onClose?.(); };
  const run = (action?: PaletteAction) => { if (!action) return; close(); setTimeout(action.run, 0); };
  const highlight = () => {
    list.querySelectorAll<HTMLElement>('.palette-item').forEach((item, i) => { const on = i === index; item.classList.toggle('active', on); item.setAttribute('aria-selected', String(on)); if (on) { item.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', item.id); } });
  };
  const draw = () => {
    shown = actions.filter(a => matchAction(a, input.value)); index = Math.min(index, Math.max(0, shown.length - 1));
    list.replaceChildren();
    if (!shown.length) { list.append(el('p', 'palette-empty', '没有找到匹配的操作')); return; }
    let group = '';
    shown.forEach((action, i) => {
      if (action.group !== group) { group = action.group; list.append(el('div', 'palette-group', group)); }
      const item = el('button', 'palette-item'); item.type = 'button'; item.id = `palette-${i}`; item.setAttribute('role', 'option'); item.tabIndex = -1;
      const text = el('span', 'palette-text'); text.append(el('strong', '', action.title)); if (action.hint) text.append(el('small', '', action.hint));
      item.append(iconBadge(action.icon, 'sm'), text); if (action.shortcut) item.append(el('kbd', '', action.shortcut));
      item.onmousemove = () => { if (index !== i) { index = i; highlight(); } };
      item.onclick = () => run(action);
      list.append(item);
    });
    highlight();
  };
  const keys = (event: KeyboardEvent) => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); }
    else if (event.key === 'ArrowDown' || (event.key === 'Tab' && !event.shiftKey)) { event.preventDefault(); index = (index + 1) % Math.max(1, shown.length); highlight(); }
    else if (event.key === 'ArrowUp' || (event.key === 'Tab' && event.shiftKey)) { event.preventDefault(); index = (index - 1 + shown.length) % Math.max(1, shown.length); highlight(); }
    else if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); run(shown[index]); }
  };
  document.addEventListener('keydown', keys, true);
  input.oninput = () => { index = 0; draw(); };
  backdrop.onmousedown = event => { if (event.target === backdrop) close(); };
  draw(); input.focus();
}
