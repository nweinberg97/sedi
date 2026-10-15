// Sedi — Boardly: life-category tabs with a fixed, free-form canvas of goal, task and note cards.

import * as store from './store.js';
import { attachDots } from './dotfield.js';
import { h, icon, uuid, clamp, toast, modal, popover, closePopovers, editInline, confirmModal, SOFT_COLORS, listMode } from './util.js';
import { registerDrop, onDragStart, onDragEnd } from './dnd.js';
import { routeCard, openEditor, cardChrome, openMoveDialog, notesSnippet, duplicateCard, withMic } from './cards.js';
import { crunch } from './sound.js';

const MAX_TABS = 10;
const SIZES = { goal: [208, 60], task: [208, 60], note: [240, 52] };
const LEFT = 76; // Room for the in-canvas toolbar (SD-O4)
let root, tabBar, canvas, hoverCanvas = false;
const sel = new Set(); // SD-O1: selected card ids on the current tab

export const DEFAULT_TABS = [
  { name: 'Health', color: '#86AE95' }, { name: 'Relationships', color: '#C98E8E' }, { name: 'Work', color: '#8E9BC9' },
  { name: 'Chores', color: '#C9A46E' }, { name: 'Admin', color: '#9AA3AD' },
].map(t => ({ id: uuid(), ...t }));

const tabs = () => store.get('boardlyTabs', []);
function activeTab() {
  const list = tabs();
  const id = store.pref('boardlyTab');
  return list.find(t => t.id === id) || list[0];
}
const tabCards = tabId => store.cardsWhere(c => c.tool === 'boardly' && c.meta?.tabId === tabId);

let dots = null;
export function mount(el) {
  root = el;
  tabBar = h('div', { class: 'tabs boardly-tabs', role: 'tablist' });
  canvas = h('div', { class: 'board-canvas has-dots', tabindex: 0, 'aria-label': 'Board canvas. G adds a goal, T a task, N a note.', dataset: { drop: 'boardly-canvas', accept: 'card' }, 'data-canvas': '' });
  // The dot pattern is drawn on a canvas so it can drift away from the pointer and ripple on a click.
  dots?.destroy();
  dots = attachDots(canvas);
  // SD-O4: Goal / Task / Note live inside the canvas as a vertical toolbar.
  // Hovering a button slides out a label that says exactly what it adds.
  const tool = (type, ic, label, hint, key) => h('button', { class: `vtool vt-${type}`, 'aria-label': `New ${label} (${key})`, onclick: () => addCard(type) },
    h('span', { class: 'vt-icon' }, icon(ic)), h('span', { class: 'vt-label' }, label),
    h('span', { class: 'vtool-tip' }, h('strong', {}, `New ${label.toLowerCase()}`), h('small', {}, hint), h('kbd', {}, key)));
  const toolbar = h('div', { class: 'vtools', role: 'toolbar', 'aria-label': 'Add to the board' },
    h('span', { class: 'vt-head' }, 'Add'),
    tool('goal', 'target', 'Goal', 'A big outcome, with SMART fields', 'G'),
    tool('task', 'checklist', 'Task', 'Something to tick off', 'T'),
    tool('note', 'pencil', 'Note', 'A thought or a reminder', 'N'));
  root.replaceChildren(h('div', { class: 'view boardly' },
    h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Boardly'),
      h('p', { class: 'view-note' }, 'Shift-click or drag a box to select several, then drag them together.')),
    tabBar,
    h('div', { class: 'canvas-wrap' }, canvas, toolbar)));
  canvas.addEventListener('pointerenter', () => (hoverCanvas = true));
  canvas.addEventListener('pointerleave', () => (hoverCanvas = false));
  canvas.addEventListener('pointerdown', startMarquee);
  canvas.addEventListener('click', e => {
    const tile = e.target.closest('.tile');
    if (tile && e.shiftKey) { e.preventDefault(); toggleSel(tile.dataset.id); return; }
    if (!tile && !e.target.closest('.vtools') && !suppressClear) clearSel();
  });
  render();
}

// ---------- Selection (SD-O1) ----------
function paintSel() { canvas?.querySelectorAll('.tile').forEach(t => t.classList.toggle('selected', sel.has(t.dataset.id))); paintHint(); }
function toggleSel(id) { sel.has(id) ? sel.delete(id) : sel.add(id); paintSel(); }
function clearSel() { if (!sel.size) return; sel.clear(); paintSel(); }
function paintHint() {
  const hint = canvas?.querySelector('.sel-hint');
  if (hint) hint.textContent = sel.size > 1 ? `${sel.size} selected · drag any of them to move all · Esc to clear` : '';
}
function startMarquee(e) {
  if (listMode()) return;
  if (e.button !== 0 || (e.target !== canvas && !e.target.classList.contains('canvas-empty'))) return;
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX, sy = e.clientY;
  let box = null;
  const additive = e.shiftKey;
  const before = new Set(sel);
  const move = ev => {
    if (!box && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 5) return;
    if (!box) { box = h('div', { class: 'marquee' }); canvas.append(box); }
    const L = Math.min(sx, ev.clientX), T = Math.min(sy, ev.clientY), W = Math.abs(ev.clientX - sx), H = Math.abs(ev.clientY - sy);
    Object.assign(box.style, { left: L - r.left + 'px', top: T - r.top + 'px', width: W + 'px', height: H + 'px' });
    sel.clear();
    if (additive) before.forEach(id => sel.add(id));
    canvas.querySelectorAll('.tile').forEach(t => {
      const b = t.getBoundingClientRect();
      if (b.left < L + W && b.right > L && b.top < T + H && b.bottom > T) sel.add(t.dataset.id);
    });
    paintSel();
  };
  const up = () => {
    removeEventListener('pointermove', move); removeEventListener('pointerup', up);
    if (box) { box.remove(); suppressClear = true; setTimeout(() => (suppressClear = false), 0); }
  };
  addEventListener('pointermove', move); addEventListener('pointerup', up);
}
let suppressClear = false;

// Group drag: other selected tiles follow the one being dragged.
let group = null;
onDragStart(d => {
  if (!canvas?.isConnected || d.kind !== 'card' || !sel.has(d.id) || sel.size < 2) { group = null; return; }
  const els = [...sel].filter(id => id !== d.id).map(id => canvas.querySelector(`.tile[data-id="${CSS.escape(id)}"]`)).filter(Boolean);
  group = { d, els, ids: [...sel].filter(id => id !== d.id) };
  els.forEach(el => el.classList.add('following'));
  group.move = () => { if (live?.inside) return; const dx = d.x - d.sx, dy = d.y - d.sy; els.forEach(el => { el.style.transform = `translate(${dx}px, ${dy}px)`; }); };
  addEventListener('pointermove', group.move);
});
onDragEnd(snap => {
  if (!group) return;
  removeEventListener('pointermove', group.move);
  group.els.forEach(el => { el.style.transform = ''; el.classList.remove('following'); });
  if (snap.accepted && snap.zone?.dataset.drop === 'trash') {
    const removed = group.ids.map(id => store.deleteCard(id, { silent: true })).filter(Boolean);
    store.notify({ reason: 'group-trash' });
    sel.clear();
    if (removed.length) { crunch(); toast(`Also deleted ${removed.length} other selected card${removed.length === 1 ? '' : 's'}`, { action: 'Undo', onAction: () => removed.forEach(c => store.restoreCard(c)) }); }
  }
  group = null;
});

// ---------- Shortcuts (SD-O2): G / T / N on the canvas, ⌥G / ⌥T / ⌥N anywhere in Boardly ----------
document.addEventListener('keydown', e => {
  if (!canvas?.isConnected || e.metaKey || e.ctrlKey) return;
  const t = e.target;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || document.querySelector('.modal-backdrop')) return;
  if (e.key === 'Escape') { clearSel(); return; }
  const type = { KeyG: 'goal', KeyT: 'task', KeyN: 'note' }[e.code];
  if (!type) return;
  if (e.altKey || hoverCanvas || canvas.contains(document.activeElement)) { e.preventDefault(); addCard(type); }
});

// ---------- Drops ----------
registerDrop('boardly-canvas', ({ id, left, top, zone }) => {
  const card = store.getCard(id);
  const tab = activeTab();
  if (!card || !tab) return false;
  const type = ['goal', 'task', 'note'].includes(card.type) ? card.type : 'note';
  const [w, hgt] = SIZES[type];
  const x = clamp(Math.round(left), LEFT, zone.clientWidth - w - 8);
  const y = clamp(Math.round(top), 8, zone.clientHeight - hgt - 8);
  const wasHere = card.tool === 'boardly' && card.meta?.tabId === tab.id;
  if (wasHere && listMode()) return false; // phones list the board; keep the desktop layout untouched
  const dx = x - (card.meta?.x ?? x), dy = y - (card.meta?.y ?? y);
  // Same-tab moves keep the card's own data (SMART fields, done state); other drops route like before.
  if (wasHere) store.updateCard(id, { meta: { x, y } });
  else routeCard(id, { tool: 'boardly', type, meta: { tabId: tab.id, x, y } });
  // SD-O1: the rest of the selection moves by the same amount.
  if (wasHere && group && group.d.id === id) {
    for (const oid of group.ids) {
      const o = store.getCard(oid);
      if (!o) continue;
      const [ow, oh] = SIZES[o.type] || SIZES.note;
      store.updateCard(oid, { meta: { x: clamp((o.meta?.x ?? 24) + dx, LEFT, zone.clientWidth - ow - 8), y: clamp((o.meta?.y ?? 24) + dy, 8, zone.clientHeight - oh - 8) } }, { silent: true });
    }
    store.notify({ reason: 'group-move' });
  }
});
registerDrop('boardly-tab', ({ id, data }) => {
  const card = store.getCard(id);
  if (!card) return false;
  const type = ['goal', 'task', 'note'].includes(card.type) ? card.type : 'note';
  const pos = freeSpot(data.tab);
  routeCard(id, { tool: 'boardly', type, meta: { tabId: data.tab, ...pos }, log: 'Moved tab' });
  toast(`Moved to ${tabs().find(t => t.id === data.tab)?.name}`);
});
onDragStart(d => { if (d.el.classList.contains('note-card')) collapseNote(d.el); });

// Direct manipulation: inside the board the card itself moves under your pointer (no floating copy, no tilt).
// Drag it off the board and the floating copy takes over, so it can still go to another tool or the trash.
let live = null;
onDragStart(d => {
  if (!canvas?.isConnected || d.kind !== 'card' || !canvas.contains(d.el)) { live = null; return; }
  const el = d.el;
  const base = { left: parseFloat(el.style.left) || 0, top: parseFloat(el.style.top) || 0 };
  live = { d, el, base, inside: true };
  el.classList.add('live-drag');
  document.body.classList.add('board-live');
  live.move = () => {
    const cr = canvas.getBoundingClientRect();
    const inside = d.x >= cr.left && d.x <= cr.right && d.y >= cr.top && d.y <= cr.bottom;
    if (inside !== live.inside) {
      live.inside = inside;
      document.body.classList.toggle('board-live', inside);
      el.classList.toggle('live-drag', inside);
    }
    if (!inside) { el.style.transform = ''; return; }
    // Where the card's top-left would land, kept inside the board.
    const x = clamp(d.x - d.gx - cr.left + canvas.scrollLeft, LEFT, canvas.clientWidth - el.offsetWidth - 8);
    const y = clamp(d.y - d.gy - cr.top + canvas.scrollTop, 8, canvas.clientHeight - el.offsetHeight - 8);
    el.style.transform = `translate(${x - live.base.left}px, ${y - live.base.top}px)`;
    if (group) group.els.forEach(o => { o.style.transform = `translate(${x - live.base.left}px, ${y - live.base.top}px)`; });
  };
  addEventListener('pointermove', live.move);
  live.move();
});
onDragEnd(snap => {
  if (!live) return;
  removeEventListener('pointermove', live.move);
  // Land where it was dropped: fold the drag offset into left/top before clearing it,
  // so the card never flashes back to its old spot for a frame before the board redraws.
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\)/.exec(live.el.style.transform);
  if (m && live.inside && snap?.accepted !== false) {
    live.el.style.left = live.base.left + parseFloat(m[1]) + 'px';
    live.el.style.top = live.base.top + parseFloat(m[2]) + 'px';
    if (group) group.els.forEach(o => { o.style.left = (parseFloat(o.style.left) || 0) + parseFloat(m[1]) + 'px'; o.style.top = (parseFloat(o.style.top) || 0) + parseFloat(m[2]) + 'px'; });
  }
  live.el.classList.remove('live-drag');
  live.el.style.transform = '';
  document.body.classList.remove('board-live');
  live = null;
});

function freeSpot(tabId) {
  const n = tabCards(tabId).length;
  const cols = Math.max(1, Math.floor(((canvas?.clientWidth || 900) - LEFT - 16) / 230));
  return { x: LEFT + 8 + (n % cols) * 228, y: 24 + Math.floor(n / cols) * 84 };
}

// ---------- Render ----------
export function render() {
  if (!root?.isConnected) return;
  renderTabs();
  renderCanvas();
}

function renderTabs() {
  const list = tabs();
  const active = activeTab();
  tabBar.replaceChildren(...list.map(t => {
    const dot = h('button', { class: 'tab-dot', style: { background: t.color }, 'aria-label': `Color for ${t.name}`, onclick: e => { e.stopPropagation(); pickColor(e.currentTarget, t); } });
    const name = h('span', { class: 'tab-name' }, t.name);
    const del = h('button', { class: 'tab-x icon-btn xs', 'aria-label': `Delete ${t.name}`, onclick: e => { e.stopPropagation(); deleteTab(t); } }, icon('x'));
    const tab = h('div', {
      class: `tab ${t.id === active?.id ? 'active' : ''}`, role: 'tab', tabindex: 0, 'aria-selected': String(t.id === active?.id),
      style: { '--tab-color': t.color }, dataset: { drop: 'boardly-tab', accept: 'card', tab: t.id },
      onclick: () => { store.setPref('boardlyTab', t.id); sel.clear(); render(); },
    }, dot, name, list.length > 1 ? del : null);
    name.addEventListener('dblclick', e => { e.stopPropagation(); editInline(name, { onCommit: v => renameTab(t.id, v) }); });
    tab.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tab) tab.click(); });
    return tab;
  }));
  if (list.length < MAX_TABS) tabBar.append(h('button', { class: 'tab-add icon-btn sm', 'aria-label': 'Add category', onclick: addTab }, icon('plus')));
  else tabBar.append(h('span', { class: 'tab-limit muted small' }, '10 of 10'));
}

function renderCanvas() {
  const tab = activeTab();
  canvas.style.setProperty('--tab-color', tab?.color || '#8E9BC9');
  dots?.recolor();
  const cards = tab ? tabCards(tab.id) : [];
  const cw = canvas.clientWidth || 1000, ch = canvas.clientHeight || 600;
  canvas.replaceChildren(dots.el, ...cards.map(c => {
    const [w, hh] = SIZES[c.type] || SIZES.note;
    const el = c.type === 'note' ? noteEl(c) : tileEl(c);
    el.style.left = clamp(c.meta?.x ?? 24, LEFT, Math.max(LEFT, cw - w - 8)) + 'px';
    el.style.top = clamp(c.meta?.y ?? 24, 8, Math.max(8, ch - hh - 8)) + 'px';
    return el;
  }), h('div', { class: 'sel-hint', 'aria-live': 'polite' }));
  [...sel].forEach(id => { if (!cards.some(c => c.id === id)) sel.delete(id); });
  paintSel();
  if (!cards.length) canvas.append(h('div', { class: 'canvas-empty' }, `Add a goal, task or note to ${tab?.name || 'this category'}. Shortcut: G, T or N.`));
}

function titleSpan(c) {
  const t = h('span', { class: 'tile-title', title: c.title }, c.title);
  t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }, { log: true }) }); });
  return t;
}

function tileEl(c) {
  const isGoal = c.type === 'goal';
  const lead = isGoal ? icon('target', 'type-icon')
    : h('button', {
      class: `check ${c.meta?.done ? 'on' : ''}`, 'aria-label': c.meta?.done ? 'Mark not done' : 'Mark done', 'aria-pressed': String(!!c.meta?.done),
      onclick: e => { e.stopPropagation(); store.updateCard(c.id, { meta: { done: !c.meta?.done } }, { log: true, logLabel: c.meta?.done ? 'Reopened' : 'Completed' }); },
    }, icon('check'));
  const el = h('article', { class: `tile ${c.type}-card ${c.meta?.done ? 'done' : ''}`, dataset: { drag: 'card', id: c.id } },
    lead, h('div', { class: 'tile-main' }, titleSpan(c), notesSnippet(c)));
  cardChrome(el, c, () => (isGoal ? openSmart(c.id) : openEditor(c.id, { title: 'Task' })));
  return el;
}

// ---------- Notes: compact until opened, auto-minimize on click-away ----------
function noteEl(c) {
  const ta = h('textarea', { class: 'note-text', rows: 1, placeholder: 'Write…', 'aria-label': 'Note text' });
  ta.value = c.description || '';
  const el = h('article', { class: 'tile note-card', dataset: { drag: 'card', id: c.id } },
    h('div', { class: 'note-head' },
      icon('pencil', 'type-icon'), titleSpan(c),
      h('button', { class: 'icon-btn sm note-toggle', 'aria-label': 'Expand note', onclick: e => { e.stopPropagation(); el.classList.contains('open') ? collapseNote(el) : expandNote(el); } }, icon('expand'))),
    h('div', { class: 'note-preview' }, (c.description || '').split('\n')[0] || ' '),
    ta);
  cardChrome(el, c, () => openEditor(c.id, { title: 'Note' }));
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, parseFloat(getComputedStyle(ta).lineHeight) * 10 + 8) + 'px'; };
  ta.addEventListener('input', () => { grow(); store.updateCard(c.id, { description: ta.value }, { silent: true }); });
  ta.addEventListener('keydown', e => e.stopPropagation());
  el.addEventListener('focusout', e => { if (!el.contains(e.relatedTarget)) setTimeout(() => { if (!el.contains(document.activeElement)) collapseNote(el); }, 0); });
  el._grow = grow;
  return el;
}
function expandNote(el) {
  el.classList.add('open');
  el.querySelector('.note-toggle')?.replaceChildren(icon('minimize'));
  const ta = el.querySelector('textarea');
  el._grow?.();
  ta.focus();
  // Keep the expanded note inside the canvas.
  const r = el.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
  if (r.bottom > cr.bottom - 8) el.style.top = Math.max(8, cr.height - r.height - 8) + 'px';
}
function collapseNote(el) {
  if (!el.classList.contains('open')) return;
  el.classList.remove('open');
  el.querySelector('.note-toggle')?.replaceChildren(icon('expand'));
  const id = el.dataset.id;
  const ta = el.querySelector('textarea');
  const c = store.getCard(id);
  if (c && ta.value !== c.description) store.updateCard(id, { description: ta.value }, { log: true });
  else store.notify({ reason: 'collapse' });
}

// ---------- SMART goal modal ----------
const SMART = [
  ['specific', 'Specific', 'What exactly will you accomplish?'],
  ['measurable', 'Measurable', 'How will you know you’ve done it?'],
  ['achievable', 'Achievable', 'What makes this realistic right now?'],
  ['relevant', 'Relevant', 'Why does this matter to you?'],
  ['timebound', 'Time-bound', 'By when?'],
];
export function openSmart(id) {
  const c = store.getCard(id);
  if (!c) return;
  const s = c.meta?.smart || {};
  const title = h('input', { class: 'field-input title-input', value: c.title, 'aria-label': 'Goal title' });
  withMic(title, { label: 'Dictate the goal', subtle: true });
  const fields = {};
  const grid = h('div', { class: 'smart-grid' }, SMART.map(([k, label, ph]) => {
    fields[k] = h('textarea', { class: 'field-input', rows: 2, placeholder: ph, 'aria-label': label });
    fields[k].value = s[k] || '';
    return h('div', { class: 'smart-field' }, h('label', { class: 'field-label' }, h('span', { class: 'smart-letter' }, label[0]), label.slice(1)), fields[k]);
  }));
  const notes = h('textarea', { class: 'field-input', rows: 3, placeholder: 'Notes', 'aria-label': 'Notes' });
  notes.value = c.description || '';
  const saveSmart = () => {
    const smart = Object.fromEntries(SMART.map(([k]) => [k, fields[k].value]));
    store.updateCard(id, { title: title.value.trim() || 'Untitled goal', description: notes.value, meta: { smart } }, { log: true });
  };
  modal({
    title: 'SMART goal', wide: true,
    body: h('div', { class: 'editor' }, title, grid, h('label', { class: 'field-label' }, 'Notes'), notes,
      h('p', { class: 'muted small' }, 'When it’s set, drag the goal to the Universal Board and into Timely’s Goals view to plan it out.')),
    // Duplicate and Move to save what you've typed first, so nothing is lost on the way.
    actions: [{ label: 'Duplicate', kind: 'ghost', onClick: () => { saveSmart(); duplicateCard(id); } }, { label: 'Move to…', kind: 'ghost', onClick: () => { saveSmart(); setTimeout(() => openMoveDialog(id), 200); } }, { label: 'Cancel', kind: 'ghost' }, {
      label: 'Save goal', kind: 'primary', onClick: () => saveSmart(),
    }],
  });
}

// ---------- Mutations ----------
function addCard(type) {
  const tab = activeTab();
  if (!tab) return;
  const pos = freeSpot(tab.id);
  const [w, hh] = SIZES[type];
  pos.x = clamp(pos.x, LEFT, (canvas.clientWidth || 900) - w - 8);
  pos.y = clamp(pos.y, 8, (canvas.clientHeight || 500) - hh - 8);
  const title = { goal: 'New goal', task: 'New task', note: 'New note' }[type];
  const card = store.createCard({ type, tool: 'boardly', title, meta: { tabId: tab.id, ...pos, ...(type === 'goal' ? { smart: {} } : {}) } });
  sel.clear(); sel.add(card.id);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const t = canvas.querySelector(`[data-id="${card.id}"] .tile-title`);
    if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
  }));
}

function addTab() {
  const list = tabs();
  if (list.length >= MAX_TABS) return;
  const t = { id: uuid(), name: 'New category', color: SOFT_COLORS[list.length % SOFT_COLORS.length] };
  store.set('boardlyTabs', [...list, t]);
  store.setPref('boardlyTab', t.id);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const name = tabBar.querySelector('.tab.active .tab-name');
    if (name) editInline(name, { onCommit: v => renameTab(t.id, v) });
  }));
}
function renameTab(id, name) { store.set('boardlyTabs', tabs().map(t => (t.id === id ? { ...t, name } : t))); }
async function deleteTab(t) {
  const n = tabCards(t.id).length;
  if (n && !(await confirmModal(`Delete ${t.name}?`, `This also deletes its ${n} card${n === 1 ? '' : 's'}.`, 'Delete', true))) return;
  tabCards(t.id).forEach(c => store.deleteCard(c.id, { silent: true }));
  store.set('boardlyTabs', tabs().filter(x => x.id !== t.id));
  toast(`Deleted ${t.name}`);
}
function pickColor(anchor, t) {
  const COLORS = ['#86AE95', '#C98E8E', '#8E9BC9', '#C9A46E', '#9AA3AD', '#A796CB', '#7FAEBE', '#B9A27E', '#D1A0B8', '#6F8F72'];
  popover(anchor, h('div', { class: 'swatches' }, COLORS.map(col => h('button', {
    class: `swatch ${col === t.color ? 'on' : ''}`, style: { background: col }, 'aria-label': `Use color ${col}`,
    onclick: () => { store.set('boardlyTabs', tabs().map(x => (x.id === t.id ? { ...x, color: col } : x))); closePopovers(); },
  }))));
}
