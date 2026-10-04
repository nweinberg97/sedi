// Sedi — Taskly: five fixed kanban columns. No column scrolls; space is the constraint.

import * as store from './store.js';
import { h, icon, toast } from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor } from './cards.js';

export const COLUMNS = [
  { id: 'todo', name: 'To do' },
  { id: 'inprogress', name: 'In progress' },
  { id: 'review', name: 'Review' },
  { id: 'completed', name: 'Completed' },
  { id: 'backlog', name: 'Backlog' },
];
const CARD_H = 58, GAP = 8;
let root, board;

const colCards = col => store.cardsWhere(c => c.tool === 'taskly' && (c.meta?.columnId || 'todo') === col).sort(byOrder);

function capacity(body) {
  const hgt = body?.clientHeight || 0;
  if (!hgt) return 6;
  return Math.max(1, Math.floor((hgt + GAP) / (CARD_H + GAP)));
}

export function mount(el) {
  root = el;
  board = h('div', { class: 'taskly-board' });
  root.replaceChildren(h('div', { class: 'view taskly' },
    h('div', { class: 'view-head' }, h('h1', { class: 'view-title' }, 'Taskly'),
      h('p', { class: 'view-note' }, 'Columns never scroll. When one fills up, finish, move or delete something.')),
    board));
  render();
}

registerDrop('taskly-col', {
  accepts: ({ id, data }) => {
    const c = store.getCard(id);
    if (c?.tool === 'taskly' && c.meta?.columnId === data.col) return true;
    const body = document.querySelector(`.taskly-col[data-col="${data.col}"] .col-body`);
    return colCards(data.col).length < capacity(body);
  },
  drop: ({ id, data, index }) => {
    const col = data.col;
    const before = store.getCard(id);
    routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: col, order: index ?? 0 }, log: before?.meta?.columnId !== col ? `Moved to ${COLUMNS.find(c => c.id === col).name}` : null });
    reorder(colCards(col), id, index);
  },
});

export function render() {
  if (!root?.isConnected) return;
  // First pass builds columns so we can measure the real space before placing cards.
  if (!board.children.length) {
    for (const col of COLUMNS) {
      const body = h('div', { class: 'col-body' });
      const count = h('span', { class: 'col-count' });
      const add = h('button', { class: 'icon-btn sm', 'aria-label': `Add to ${col.name}`, onclick: () => startAdd(col.id) }, icon('plus'));
      board.append(h('section', {
        class: `taskly-col col-${col.id}`, dataset: { drop: 'taskly-col', accept: 'card', col: col.id }, 'data-list': '',
      }, h('header', { class: 'col-head' }, h('h2', {}, col.name), count, add), body));
    }
  }
  for (const col of COLUMNS) {
    const section = board.querySelector(`[data-col="${col.id}"]`);
    const body = section.querySelector('.col-body');
    const cards = colCards(col.id);
    const cap = capacity(body);
    section.querySelector('.col-count').textContent = `${cards.length}/${cap}`;
    section.classList.toggle('full', cards.length >= cap);
    body.replaceChildren(...cards.map(cardEl));
  }
}

function cardEl(c) {
  const el = h('article', { class: `task-card ${c.meta?.columnId === 'completed' ? 'done' : ''}`, dataset: { drag: 'card', id: c.id }, tabindex: 0 },
    h('span', { class: 'task-title' }, c.title),
    c.description?.trim() ? icon('info', 'has-notes') : null);
  el.addEventListener('dblclick', () => edit(c.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') edit(c.id); });
  return el;
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
      const body = document.querySelector(`.taskly-col[data-col="${select.value}"] .col-body`);
      if (colCards(select.value).length >= capacity(body)) { toast('That column is full.'); return {}; }
      return { meta: { ...card.meta, columnId: select.value, order: 999 } };
    },
  });
}

function startAdd(colId) {
  const section = board.querySelector(`[data-col="${colId}"]`);
  const body = section.querySelector('.col-body');
  if (colCards(colId).length >= capacity(body)) {
    section.classList.add('shake');
    setTimeout(() => section.classList.remove('shake'), 400);
    toast('This column is full. Finish, move or delete a card first.');
    return;
  }
  if (body.querySelector('.task-input')) return body.querySelector('.task-input').focus();
  const input = h('input', { class: 'task-input', placeholder: 'New task', 'aria-label': 'New task title' });
  body.append(input);
  input.focus();
  const commit = () => {
    const title = input.value.trim();
    input.remove();
    if (title) store.createCard({ type: 'task', tool: 'taskly', title, meta: { columnId: colId, order: colCards(colId).length } });
  };
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
    if (e.key === 'Escape') { input.value = ''; input.blur(); }
  });
  input.addEventListener('blur', commit);
}
