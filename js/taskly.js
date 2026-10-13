// Sedi — Taskly: five fixed kanban columns. No column scrolls; space is the constraint.

import * as store from './store.js';
import { h, icon, toast, popover, closePopovers } from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, cardChrome, truncate } from './cards.js';
import { crunch, checkSound } from './sound.js';

export const COLUMNS = [
  { id: 'todo', name: 'To do', icon: 'checklist', empty: 'Nothing queued. Add the next thing you’ll start.' },
  { id: 'inprogress', name: 'In progress', icon: 'play', empty: 'Drag a task here when you start it.' },
  { id: 'review', name: 'Review', icon: 'eye', empty: 'Waiting on someone? Park it here with a timer.' },
  { id: 'completed', name: 'Completed', icon: 'check', empty: 'Finished work lands here.' },
  { id: 'backlog', name: 'Backlog', icon: 'inbox', empty: 'Someday ideas live here.' },
];
const CARD_H = 58, GAP = 8;
const DAY = 864e5;
// SD-K2: default "come back in" time for Review cards. Changeable per card from its timer.
export const REVIEW_DEFAULT_DAYS = 3;
let root, board, ticker;

const colCards = col => {
  const list = store.cardsWhere(c => c.tool === 'taskly' && (c.meta?.columnId || 'todo') === col).sort(byOrder);
  // Review: anything that's due comes back to the top.
  if (col === 'review') return [...list.filter(isDue), ...list.filter(c => !isDue(c))];
  return list;
};
const isDue = c => !!c.meta?.reviewUntil && new Date(c.meta.reviewUntil).getTime() <= Date.now();

function capacity(body) {
  const hgt = body?.clientHeight || 0;
  if (!hgt) return 6;
  return Math.max(1, Math.floor((hgt + GAP) / (CARD_H + GAP)));
}
const capOf = col => capacity(document.querySelector(`.taskly-col[data-col="${col}"] .col-body`));

export function mount(el) {
  root = el;
  board = h('div', { class: 'taskly-board' });
  root.replaceChildren(h('div', { class: 'view taskly' },
    h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Taskly'),
      h('p', { class: 'view-note' }, 'Columns never scroll. When one fills up, finish, move or delete something.')),
    board));
  render();
  // Review countdowns tick over without anyone touching the board.
  ticker = setInterval(() => { if (root?.isConnected) render(); }, 60e3);
}
export function unmount() { clearInterval(ticker); }

/** Column-specific bookkeeping when a card lands in a column. */
function columnMeta(card, col) {
  const m = {};
  if (col === 'review') m.reviewUntil = card?.meta?.columnId === 'review' && card.meta.reviewUntil ? card.meta.reviewUntil : new Date(Date.now() + reviewDays() * DAY).toISOString();
  else m.reviewUntil = null;
  if (col === 'completed') m.completedAt = card?.meta?.columnId === 'completed' && card.meta.completedAt ? card.meta.completedAt : new Date().toISOString();
  return m;
}
const reviewDays = () => store.pref('reviewDays', REVIEW_DEFAULT_DAYS);

registerDrop('taskly-col', {
  accepts: ({ id, data }) => {
    const c = store.getCard(id);
    if (c?.tool === 'taskly' && c.meta?.columnId === data.col) return true;
    if (data.col === 'completed') return true; // Full? The oldest completed card makes room (SD-K3).
    return colCards(data.col).length < capOf(data.col);
  },
  drop: ({ id, data, index }) => {
    const col = data.col;
    const before = store.getCard(id);
    const moving = before?.meta?.columnId !== col || before?.tool !== 'taskly';
    routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: col, order: index ?? 0, ...columnMeta(before, col) }, log: moving ? `Moved to ${COLUMNS.find(c => c.id === col).name}` : null });
    reorder(colCards(col), id, index);
    if (col === 'completed' && moving) makeRoomInCompleted(id);
  },
});

/** SD-K3: when Completed is over its limit, the oldest completed card goes to the trash, with Undo. */
function makeRoomInCompleted(keepId) {
  const list = colCards('completed');
  const cap = capOf('completed');
  if (list.length <= cap) return;
  const oldest = list.filter(c => c.id !== keepId)
    .sort((a, b) => (a.meta?.completedAt || a.updatedAt).localeCompare(b.meta?.completedAt || b.updatedAt))
    .slice(0, list.length - cap);
  const removed = oldest.map(c => store.deleteCard(c.id, { silent: true })).filter(Boolean);
  store.notify({ reason: 'auto-trash' });
  crunch();
  toast(removed.length === 1 ? `Completed was full: “${truncate(removed[0].title, 26)}” went to the trash` : `Completed was full: ${removed.length} oldest cards went to the trash`,
    { action: 'Undo', onAction: () => removed.forEach(c => store.restoreCard(c)) });
}

function clearCompleted() {
  const list = colCards('completed');
  if (!list.length) return;
  const removed = list.map(c => store.deleteCard(c.id, { silent: true })).filter(Boolean);
  store.notify({ reason: 'clear-completed' });
  crunch();
  toast(`Moved ${removed.length} completed card${removed.length === 1 ? '' : 's'} to the trash`, { action: 'Undo', onAction: () => removed.forEach(c => store.restoreCard(c)) });
}

export function render() {
  if (!root?.isConnected) return;
  // First pass builds columns so we can measure the real space before placing cards.
  if (!board.children.length) {
    for (const col of COLUMNS) {
      const body = h('div', { class: 'col-body' });
      const count = h('span', { class: 'col-count' });
      const head = h('header', { class: 'col-head' }, h('span', { class: 'col-icon' }, icon(col.icon)), h('h2', {}, col.name), count);
      if (col.id === 'completed') head.append(h('button', { class: 'chip ghost col-clear', title: 'Move every completed card to the trash (you can Undo)', onclick: clearCompleted }, icon('trash'), 'Clear'));
      const add = h('button', { class: 'col-add', 'aria-label': `Add a task to ${col.name}`, onclick: () => startAdd(col.id) }, icon('plus'), 'Add task');
      board.append(h('section', {
        class: `taskly-col col-${col.id}`, dataset: { drop: 'taskly-col', accept: 'card', col: col.id }, 'data-list': '',
      }, head, add, body));
    }
  }
  for (const col of COLUMNS) {
    const section = board.querySelector(`[data-col="${col.id}"]`);
    const body = section.querySelector('.col-body');
    const cards = colCards(col.id);
    const cap = capacity(body);
    section.querySelector('.col-count').textContent = `${cards.length}/${cap}`;
    section.classList.toggle('full', cards.length >= cap);
    const clear = section.querySelector('.col-clear');
    if (clear) clear.hidden = !cards.length;
    const input = body.querySelector('.task-input');
    body.replaceChildren(...(input ? [input] : []), ...cards.map(cardEl));
    if (!cards.length && !input) body.append(h('div', { class: 'col-empty' }, icon(col.icon), h('span', {}, col.empty)));
  }
}

function cardEl(c) {
  const col = c.meta?.columnId || 'todo';
  const el = h('article', { class: `task-card ${col === 'completed' ? 'done' : ''} ${col === 'review' && isDue(c) ? 'due' : ''}`, dataset: { drag: 'card', id: c.id }, tabindex: 0 },
    col === 'todo' ? h('button', { class: 'task-check', 'aria-label': `Complete “${c.title}”`, onclick: e => { e.stopPropagation(); complete(c.id, e.currentTarget); } }, icon('check')) : null,
    h('div', { class: 'task-main' },
      h('span', { class: `task-title ${col === 'review' ? 'one-line' : ''}` }, c.title),
      col === 'review' ? reviewTimer(c) : null));
  cardChrome(el, c, () => edit(c.id));
  el.addEventListener('dblclick', () => edit(c.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) edit(c.id); });
  return el;
}

/** SD-K1: tick a To do card. Check pops, a sound plays, then it slides into Completed. */
function complete(id, btn) {
  const card = btn.closest('.task-card');
  btn.classList.add('ticked');
  card.classList.add('completing');
  checkSound();
  setTimeout(() => {
    const c = store.getCard(id);
    if (!c) return;
    routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: 'completed', order: colCards('completed').length, ...columnMeta(c, 'completed') }, log: 'Completed' });
    makeRoomInCompleted(id);
  }, 520);
}

// ---------- Review timer (SD-K2) ----------
function fmtLeft(ms) {
  const d = Math.floor(ms / DAY), hrs = Math.floor((ms % DAY) / 36e5), mins = Math.max(1, Math.floor((ms % 36e5) / 6e4));
  return d ? `${d}d ${hrs}h` : hrs ? `${hrs}h` : `${mins}m`;
}
function reviewTimer(c) {
  const until = c.meta?.reviewUntil;
  const left = until ? new Date(until).getTime() - Date.now() : null;
  const label = left == null ? 'Set a timer' : left <= 0 ? 'Back now: check on it' : `Back in ${fmtLeft(left)}`;
  return h('button', {
    class: `review-timer ${left != null && left <= 0 ? 'due' : ''}`, title: until ? `Comes back ${new Date(until).toLocaleString()}` : 'Choose when this comes back',
    onclick: e => { e.stopPropagation(); pickReviewTime(e.currentTarget, c.id); },
  }, icon('clock'), label);
}
function pickReviewTime(anchor, id) {
  const set = ms => { store.updateCard(id, { meta: { reviewUntil: new Date(Date.now() + ms).toISOString() } }, { log: true, logLabel: 'Review timer set' }); closePopovers(); };
  const custom = h('input', { class: 'field-input sm', type: 'datetime-local', 'aria-label': 'Come back on' });
  custom.addEventListener('change', () => { if (custom.value) { const t = new Date(custom.value).getTime(); if (t > Date.now()) set(t - Date.now()); } });
  const def = h('label', { class: 'small muted review-default' },
    h('input', { type: 'checkbox', checked: false, onchange: e => { if (e.target.checked) { const c = store.getCard(id); const ms = new Date(c.meta.reviewUntil).getTime() - Date.now(); store.setPref('reviewDays', Math.max(1, Math.round(ms / DAY))); toast('New Review cards will use this timer'); } } }),
    ' Use this as the default');
  popover(anchor, h('div', { class: 'review-pop' },
    h('strong', {}, 'Come back in…'),
    h('div', { class: 'chip-row' }, [['1 day', 1], ['3 days', 3], ['1 week', 7], ['2 weeks', 14]].map(([l, d]) => h('button', { class: 'chip', onclick: () => set(d * DAY) }, l))),
    h('label', { class: 'field-label' }, 'Or pick a date'), custom, def));
}

function edit(id) {
  let select;
  openEditor(id, {
    title: 'Edit task',
    extra: card => {
      select = h('select', { class: 'field-input', 'aria-label': 'Column' }, COLUMNS.map(col => h('option', { value: col.id, selected: card.meta?.columnId === col.id }, col.name)));
      return h('div', {}, h('label', { class: 'field-label' }, 'Column'), select);
    },
    collect: (refs, card) => {
      if (select.value === card.meta?.columnId) return {};
      if (select.value !== 'completed' && colCards(select.value).length >= capOf(select.value)) { toast('That column is full.'); return {}; }
      const meta = { ...card.meta, columnId: select.value, order: 999, ...columnMeta(card, select.value) };
      if (select.value === 'completed') setTimeout(() => makeRoomInCompleted(id), 0);
      return { meta };
    },
  });
}

function startAdd(colId) {
  const section = board.querySelector(`[data-col="${colId}"]`);
  const body = section.querySelector('.col-body');
  if (colCards(colId).length >= capacity(body) && colId !== 'completed') {
    section.classList.add('shake');
    setTimeout(() => section.classList.remove('shake'), 400);
    toast('This column is full. Finish, move or delete a card first.');
    return;
  }
  if (body.querySelector('.task-input')) return body.querySelector('.task-input').focus();
  body.querySelector('.col-empty')?.remove();
  const input = h('input', { class: 'task-input', placeholder: 'New task, then Enter', 'aria-label': 'New task title' });
  body.prepend(input);
  input.focus();
  const commit = () => {
    const title = input.value.trim();
    input.remove();
    if (title) {
      const card = store.createCard({ type: 'task', tool: 'taskly', title, meta: { columnId: colId, order: -1, ...columnMeta(null, colId) } });
      reorder(colCards(colId), card.id, 0);
      if (colId === 'completed') makeRoomInCompleted(card.id);
    } else render();
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
  input.addEventListener('blur', commit);
}
