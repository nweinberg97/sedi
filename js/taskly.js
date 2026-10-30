// Sedi — Taskly: five fixed kanban columns. No column scrolls; space is the constraint.

import * as store from './store.js';
import { h, icon, toast, popover, closePopovers, modal } from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, cardChrome, truncate, notesSnippet, withMic, guardDuplicate } from './cards.js';
import { crunch, checkSound } from './sound.js';
import { celebrate } from './celebrate.js';
import { sendListButton } from './builder.js';

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
// When Taskly isn't on screen, use the last measured size; never guess low (that could trash cards).
const capOf = col => {
  const body = document.querySelector(`.taskly-col[data-col="${col}"] .col-body`);
  return body?.clientHeight ? capacity(body) : (store.pref('tasklyCaps', {})[col] ?? Infinity);
};

// A copy lands in the same column, so it needs a free slot there.
guardDuplicate(c => (c.tool === 'taskly' && (c.meta?.columnId || 'todo') !== 'completed' && colCards(c.meta?.columnId || 'todo').length >= capOf(c.meta?.columnId || 'todo'))
  ? 'That column is full. Finish, move or delete a card first.' : null);

export function mount(el) {
  root = el;
  board = h('div', { class: 'taskly-board' });
  root.replaceChildren(h('div', { class: 'view taskly' },
    h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Taskly'),
      h('p', { class: 'view-note' }, 'Each column holds what fits on screen. When one fills up, finish, move or delete something.')),
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

/** SD-K3: when Completed is over its limit, the oldest finished cards move to the Finished archive (never deleted). */
function makeRoomInCompleted(keepId) {
  const list = colCards('completed');
  const cap = capOf('completed');
  if (list.length <= cap) return;
  const oldest = list.filter(c => c.id !== keepId)
    .sort((a, b) => (a.meta?.completedAt || a.updatedAt).localeCompare(b.meta?.completedAt || b.updatedAt))
    .slice(0, list.length - cap);
  const at = new Date().toISOString();
  oldest.forEach(c => store.updateCard(c.id, { meta: { columnId: 'archive', archivedAt: at } }, { silent: true, touch: false }));
  store.notify({ reason: 'archive-completed' });
  toast(oldest.length === 1 ? `Completed was full, so “${truncate(oldest[0].title, 26)}” moved to Finished` : `Completed was full, so ${oldest.length} older cards moved to Finished`,
    { action: 'See', onAction: openFinished });
}
const archived = () => store.cardsWhere(c => c.tool === 'taskly' && c.meta?.columnId === 'archive')
  .sort((a, b) => (b.meta?.archivedAt || b.updatedAt).localeCompare(a.meta?.archivedAt || a.updatedAt));
/** Finished: everything that rolled out of Completed, newest first. Restore or delete for good. */
function openFinished() {
  const box = h('div', { class: 'finished-list' });
  let m;
  const fill = () => {
    const list = archived();
    box.replaceChildren(list.length ? h('ul', { class: 'modal-list' }, list.map(c => h('li', { class: 'finished-row' },
      h('span', { class: 'finished-title' }, c.title),
      h('button', { class: 'btn sm ghost', onclick: () => {
        if (colCards('completed').length >= capOf('completed')) return toast('Completed is full. Clear it first, then restore.');
        store.updateCard(c.id, { meta: { columnId: 'completed', archivedAt: null, order: colCards('completed').length } }); fill();
      } }, 'Restore'),
      h('button', { class: 'icon-btn xs', 'aria-label': `Delete “${c.title}” for good`, onclick: () => { const gone = store.deleteCard(c.id); fill(); toast('Deleted', { action: 'Undo', onAction: () => { store.restoreCard(gone); fill(); } }); } }, icon('x'))))) :
      h('p', { class: 'muted' }, 'Nothing here yet. When Completed fills up, the oldest finished cards move here instead of disappearing.'));
  };
  fill();
  m = modal({ title: 'Finished', body: box, actions: [{ label: 'Done', kind: 'primary' }] });
  return m;
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
      const body = h('div', { class: 'col-body', 'data-navoro-sensitive': '' });
      const count = h('span', { class: 'col-count' });
      const head = h('header', { class: 'col-head' }, h('span', { class: 'col-icon' }, icon(col.icon)), h('h2', {}, col.name), count);
      if (col.id !== 'completed') head.append(sendListButton(col.name, () => colCards(col.id)));
      if (col.id === 'completed') head.append(h('button', { class: 'col-finished', 'aria-label': 'Finished archive', title: 'Finished: older completed cards', onclick: openFinished }, icon('inbox')));
      if (col.id === 'completed') head.append(h('button', { class: 'col-clear', 'aria-label': 'Clear completed', title: 'Clear completed (moves them to the trash, you can Undo)', onclick: clearCompleted }, icon('trash'), h('span', { class: 'col-clear-label' }, 'Clear')));
      const add = h('button', { class: 'col-add', 'aria-label': `Add a task to ${col.name}`, onclick: () => startAdd(col.id) }, icon('plus'), 'Add task');
      board.append(h('section', {
        class: `taskly-col col-${col.id}`, dataset: { drop: 'taskly-col', accept: 'card', col: col.id }, 'data-list': '', 'data-navoro-id': `taskly.col-${col.id}`, 'aria-label': col.name,
      }, head, add, body));
    }
  }
  for (const col of COLUMNS) {
    const section = board.querySelector(`[data-col="${col.id}"]`);
    const body = section.querySelector('.col-body');
    const cards = colCards(col.id);
    const cap = capacity(body);
    section.querySelector('.col-count').textContent = `${cards.length}/${cap}`;
    if (body.clientHeight && store.pref('tasklyCaps', {})[col.id] !== cap) store.setPref('tasklyCaps', { ...store.pref('tasklyCaps', {}), [col.id]: cap });
    section.classList.toggle('full', cards.length >= cap);
    // More cards than fit (a smaller screen, a rotated iPad, a backup from a bigger one): scroll rather than hide any.
    section.classList.toggle('over', cards.length > cap);
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
      h('span', { class: 'task-title one-line', title: c.title, dataset: { fit: c.title } }, c.title),
      col === 'review' ? null : notesSnippet(c),
      col === 'review' ? reviewTimer(c) : null));
  cardChrome(el, c, () => edit(c.id));
  el.addEventListener('dblclick', () => edit(c.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) edit(c.id); });
  return el;
}

/** Move a card to Completed (used by Taskly's checkmark and by Today's plan in Timely). */
export function completeTask(id) {
  const c = store.getCard(id);
  if (!c) return;
  routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: 'completed', order: colCards('completed').length, ...columnMeta(c, 'completed') }, log: 'Completed' });
  makeRoomInCompleted(id);
}
/** Add a To do card made from something else (a Brainly link, PDF or file). Returns the card, or null when To do is full. */
export function addTaskFrom({ title, description = '', meta = {} }) {
  if (colCards('todo').length >= capOf('todo')) { toast('To do is full. Finish, move or delete a task first.', { code: 'TASKLY_COLUMN_FULL' }); return null; }
  const card = store.createCard({ type: 'task', tool: 'taskly', title, description, meta: { ...meta, columnId: 'todo', order: -1, ...columnMeta(null, 'todo') } });
  reorder(colCards('todo'), card.id, 0);
  return card;
}
export const todoCards = () => colCards('todo');
export const todoCapacity = () => capOf('todo');

/** SD-K1: tick a To do card. Check pops, a sound plays, then it slides into Completed. */
function complete(id, btn) {
  const card = btn.closest('.task-card');
  btn.classList.add('ticked');
  card.classList.add('completing');
  celebrate(btn);
  setTimeout(() => completeTask(id), 520);
}

// ---------- Review timer (SD-K2) ----------
function fmtLeft(ms) {
  const d = Math.floor(ms / DAY), hrs = Math.floor((ms % DAY) / 36e5), mins = Math.max(1, Math.floor((ms % 36e5) / 6e4));
  return d ? `${d}d ${hrs}h` : hrs ? `${hrs}h` : `${mins}m`;
}
function reviewTimer(c) {
  const until = c.meta?.reviewUntil;
  const left = until ? new Date(until).getTime() - Date.now() : null;
  const label = left == null ? 'Set a timer' : left <= 0 ? 'Check on it now' : `Back in ${fmtLeft(left)}`;
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
      select = h('select', { class: 'field-input', 'aria-label': 'Column', 'data-navoro-id': 'task.column' }, COLUMNS.map(col => h('option', { value: col.id, selected: card.meta?.columnId === col.id }, col.name)));
      return h('div', {}, h('label', { class: 'field-label' }, 'Column'), select);
    },
    collect: (refs, card) => {
      if (select.value === card.meta?.columnId) return {};
      if (select.value !== 'completed' && colCards(select.value).length >= capOf(select.value)) { toast('That column is full.', { code: 'TASKLY_COLUMN_FULL' }); return {}; }
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
    toast('This column is full. Finish, move or delete a card first.', { code: 'TASKLY_COLUMN_FULL' });
    return;
  }
  if (body.querySelector('.task-input')) return body.querySelector('.task-input').focus();
  body.querySelector('.col-empty')?.remove();
  const input = h('input', { class: 'task-input', placeholder: 'New task, then Enter', 'aria-label': 'New task title' });
  body.prepend(withMic(input, { label: 'Dictate the task' }));
  input.focus();
  const commit = () => {
    const title = input.value.trim();
    (input.closest('.mic-field') || input).remove();
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
