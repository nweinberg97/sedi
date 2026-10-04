// Sedi — Boardly: life-category tabs with a fixed, free-form canvas of goal, task and note cards.

import * as store from './store.js';
import { h, icon, uuid, clamp, toast, modal, popover, closePopovers, editInline, confirmModal, SOFT_COLORS } from './util.js';
import { registerDrop, onDragStart } from './dnd.js';
import { routeCard, openEditor } from './cards.js';

const MAX_TABS = 10;
const SIZES = { goal: [208, 60], task: [208, 60], note: [240, 52] };
let root, tabBar, canvas;

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

export function mount(el) {
  root = el;
  tabBar = h('div', { class: 'tabs boardly-tabs', role: 'tablist' });
  canvas = h('div', { class: 'board-canvas', dataset: { drop: 'boardly-canvas', accept: 'card' }, 'data-canvas': '' });
  const toolbar = h('div', { class: 'canvas-tools' },
    h('button', { class: 'chip', onclick: () => addCard('goal') }, icon('target'), 'Goal'),
    h('button', { class: 'chip', onclick: () => addCard('task') }, icon('checklist'), 'Task'),
    h('button', { class: 'chip', onclick: () => addCard('note') }, icon('pencil'), 'Note'));
  root.replaceChildren(h('div', { class: 'view boardly' },
    h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Boardly')),
    tabBar,
    h('div', { class: 'canvas-wrap' }, toolbar, canvas)));
  render();
}

// ---------- Drops ----------
registerDrop('boardly-canvas', ({ id, left, top, zone }) => {
  const card = store.getCard(id);
  const tab = activeTab();
  if (!card || !tab) return false;
  const type = ['goal', 'task', 'note'].includes(card.type) ? card.type : 'note';
  const [w, hgt] = SIZES[type];
  const x = clamp(Math.round(left), 8, zone.clientWidth - w - 8);
  const y = clamp(Math.round(top), 8, zone.clientHeight - hgt - 8);
  routeCard(id, { tool: 'boardly', type, meta: { tabId: tab.id, x, y } });
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

function freeSpot(tabId) {
  const n = tabCards(tabId).length;
  const cols = Math.max(1, Math.floor(((canvas?.clientWidth || 900) - 40) / 230));
  return { x: 24 + (n % cols) * 228, y: 24 + Math.floor(n / cols) * 84 };
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
      onclick: () => { store.setPref('boardlyTab', t.id); render(); },
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
  const cards = tab ? tabCards(tab.id) : [];
  const cw = canvas.clientWidth || 1000, ch = canvas.clientHeight || 600;
  canvas.replaceChildren(...cards.map(c => {
    const [w, hh] = SIZES[c.type] || SIZES.note;
    const el = c.type === 'note' ? noteEl(c) : tileEl(c);
    el.style.left = clamp(c.meta?.x ?? 24, 8, Math.max(8, cw - w - 8)) + 'px';
    el.style.top = clamp(c.meta?.y ?? 24, 8, Math.max(8, ch - hh - 8)) + 'px';
    return el;
  }));
  if (!cards.length) canvas.append(h('div', { class: 'canvas-empty' }, `Add a goal, task or note to ${tab?.name || 'this category'}.`));
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
    lead, titleSpan(c),
    h('button', { class: 'icon-btn sm', 'aria-label': isGoal ? 'Open SMART goal' : 'Open details', onclick: e => { e.stopPropagation(); isGoal ? openSmart(c.id) : openEditor(c.id, { title: 'Task' }); } }, icon(isGoal ? 'expand' : 'info')),
    !isGoal ? icon('checklist', 'type-mark') : null);
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
  const fields = {};
  const grid = h('div', { class: 'smart-grid' }, SMART.map(([k, label, ph]) => {
    fields[k] = h('textarea', { class: 'field-input', rows: 2, placeholder: ph, 'aria-label': label });
    fields[k].value = s[k] || '';
    return h('div', { class: 'smart-field' }, h('label', { class: 'field-label' }, h('span', { class: 'smart-letter' }, label[0]), label.slice(1)), fields[k]);
  }));
  const notes = h('textarea', { class: 'field-input', rows: 3, placeholder: 'Notes', 'aria-label': 'Notes' });
  notes.value = c.description || '';
  modal({
    title: 'SMART goal', wide: true,
    body: h('div', { class: 'editor' }, title, grid, h('label', { class: 'field-label' }, 'Notes'), notes,
      h('p', { class: 'muted small' }, 'When it’s set, drag the goal to the Universal Board and into Timely’s Goals view to plan it out.')),
    actions: [{ label: 'Cancel', kind: 'ghost' }, {
      label: 'Save goal', kind: 'primary', onClick: () => {
        const smart = Object.fromEntries(SMART.map(([k]) => [k, fields[k].value]));
        store.updateCard(id, { title: title.value.trim() || 'Untitled goal', description: notes.value, meta: { smart } }, { log: true });
      },
    }],
  });
}

// ---------- Mutations ----------
function addCard(type) {
  const tab = activeTab();
  if (!tab) return;
  const pos = freeSpot(tab.id);
  const [w, hh] = SIZES[type];
  pos.x = clamp(pos.x, 8, (canvas.clientWidth || 900) - w - 8);
  pos.y = clamp(pos.y, 8, (canvas.clientHeight || 500) - hh - 8);
  const title = { goal: 'New goal', task: 'New task', note: 'New note' }[type];
  const card = store.createCard({ type, tool: 'boardly', title, meta: { tabId: tab.id, ...pos, ...(type === 'goal' ? { smart: {} } : {}) } });
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
