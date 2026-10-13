// Sedi — the universal card: polymorphic routing between tools, ordering, and the shared editor.

import * as store from './store.js';
import { h, icon, modal, stripHtml, toast } from './util.js';
import { crunch } from './sound.js';

export const TOOL_NAMES = { taskly: 'Taskly', boardly: 'Boardly', timely: 'Timely', brainly: 'Brainly', universal: 'Universal Board', home: 'Home' };
export const TYPE_ICON = { goal: 'target', task: 'checklist', note: 'pencil', event: 'calendar', link: 'link' };
export const typeIcon = type => icon(TYPE_ICON[type] || 'dot', 'type-icon');

/** Flatten any card into plain text: the shape it takes while living on the Universal Board. */
export function flatten(card) {
  const m = card.meta || {};
  const parts = [];
  const desc = /<\/?[a-z][\s\S]*>/i.test(card.description || '') ? stripHtml(card.description) : (card.description || '');
  if (desc.trim()) parts.push(desc.trim());
  if (m.smart) {
    const s = m.smart;
    const lines = [['Specific', s.specific], ['Measurable', s.measurable], ['Achievable', s.achievable], ['Relevant', s.relevant], ['Time-bound', s.timebound]]
      .filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v.trim()}`);
    if (lines.length) parts.push(lines.join('\n'));
  }
  if (m.url) parts.push(m.url);
  if (m.date) parts.push(`Date: ${m.date}${m.start != null ? ` ${Math.floor(m.start / 60)}:${String(m.start % 60).padStart(2, '0')}` : ''}`);
  if (m.done) parts.push('Status: done');
  return parts.join('\n\n');
}

/**
 * Move a card to a destination. Crossing a tool boundary strips domain state;
 * the Universal Board reduces a card to plain text, and leaving it re-initialises
 * the card as the destination's native type.
 */
export function routeCard(id, dest) {
  const card = store.getCard(id);
  if (!card) return null;
  const crossing = card.tool !== dest.tool;
  if (dest.tool === 'universal') {
    if (!crossing) return store.updateCard(id, { meta: dest.meta || {} });
    return store.updateCard(id, { tool: 'universal', description: flatten(card), meta: dest.meta || {} },
      { replaceMeta: true, log: true, logLabel: 'Sent to Universal Board' });
  }
  if (crossing) {
    const patch = { tool: dest.tool, type: dest.type || card.type, meta: dest.meta || {} };
    if (card.tool !== 'universal') patch.description = flatten(card);
    return store.updateCard(id, patch, { replaceMeta: true, log: true, logLabel: `Moved to ${TOOL_NAMES[dest.tool]}` });
  }
  const patch = { meta: dest.meta || {} };
  if (dest.type) patch.type = dest.type;
  return store.updateCard(id, patch, { log: !!dest.log, logLabel: dest.log });
}

/** Re-number orders for an ordered list after inserting `movedId` at `index`. */
export function reorder(list, movedId, index) {
  const ids = list.map(c => c.id).filter(x => x !== movedId);
  ids.splice(index == null ? ids.length : index, 0, movedId);
  ids.forEach((cid, i) => {
    const c = store.getCard(cid);
    if (c && c.meta?.order !== i) store.updateCard(cid, { meta: { order: i } }, { silent: true });
  });
  store.notify({ reason: 'reorder' });
}
export const byOrder = (a, b) => (a.meta?.order ?? 0) - (b.meta?.order ?? 0) || a.createdAt.localeCompare(b.createdAt);

/** Delete with an undo window: instant, but forgiving. */
export function trashCard(id) {
  const removed = store.deleteCard(id);
  if (!removed) return;
  crunch();
  toast(`Deleted “${truncate(removed.title, 28)}”`, { action: 'Undo', onAction: () => store.restoreCard(removed) });
}
export const truncate = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + '…' : s || '');

// ---------- Shared card chrome (SD-C1, SD-C2, SD-C3) ----------
/** Delete (×) button for the top-right corner of any card. Goes to the trash with crunch + Undo. */
export const deleteButton = (id, cls = '') => h('button', {
  class: `card-del ${cls}`, type: 'button', 'aria-label': 'Delete', title: 'Delete (you can Undo)',
  onclick: e => { e.stopPropagation(); trashCard(id); },
}, icon('x'));
/** Details button for the bottom-right corner of any card. */
export const infoButton = (onclick, label = 'Details') => h('button', {
  class: 'card-info', type: 'button', 'aria-label': label, title: label,
  onclick: e => { e.stopPropagation(); onclick(e); },
}, icon('more'));
/** True when a card carries notes worth flagging (details text or SMART fields). */
export function hasNotes(card) {
  const d = /<\/?[a-z][\s\S]*>/i.test(card.description || '') ? stripHtml(card.description) : (card.description || '');
  if (card.type === 'link') return false;
  if (d.trim() && d.trim() !== (card.meta?.url || '')) return true;
  return !!(card.meta?.smart && Object.values(card.meta.smart).some(v => v && String(v).trim()));
}
/** Adds the shared corner chrome to a card element: delete, details, and the notes fold. */
export function cardChrome(el, card, onInfo) {
  el.classList.add('has-chrome');
  el.classList.toggle('with-notes', hasNotes(card));
  if (hasNotes(card)) el.title = el.title || 'Has notes';
  el.append(deleteButton(card.id), infoButton(onInfo));
  return el;
}

// ---------- Move to… (SD-C4): the same routes dragging uses ----------
const COLS = [['todo', 'To do'], ['inprogress', 'In progress'], ['review', 'Review'], ['completed', 'Completed'], ['backlog', 'Backlog']];
export function moveDestinations() {
  const tabs = store.get('boardlyTabs', []);
  const plan = store.get('planContainers', { projects: [], goals: [] });
  const folders = store.get('brainFolders', []);
  const lfolders = store.get('linkFolders', []);
  const fpath = f => { const names = [f.name]; let p = folders.find(x => x.id === f.parentId); while (p) { names.unshift(p.name); p = folders.find(x => x.id === p.parentId); } return names.join(' › '); };
  return [
    ['Taskly', COLS.map(([v, l]) => [`taskly:${v}`, l])],
    ['Boardly', tabs.map(t => [`boardly:${t.id}`, t.name])],
    ['Timely', [['timely:today', 'Today (any time)'], ['timely:reminders', 'Reminders'],
      ...(plan.projects || []).map(c => [`timely:plan:projects:${c.id}`, `Projects › ${c.name}`]),
      ...(plan.goals || []).map(c => [`timely:plan:goals:${c.id}`, `Goals › ${c.name}`])]],
    ['Brainly', [['brainly:canvas', 'Canvas'], ...folders.map(f => [`brainly:folder:${f.id}`, `Folder › ${fpath(f)}`]),
      ['brainly:links:', 'My links'], ...lfolders.map(f => [`brainly:links:${f.id}`, `Links › ${f.name}`])]],
    ['Universal Board', [['universal', 'Universal Board']]],
  ];
}
export const destinationLabel = key => moveDestinations().flatMap(([g, list]) => list.map(([v, l]) => [v, g === 'Universal Board' ? l : `${g} › ${l}`])).find(([v]) => v === key)?.[1] || key;
export function currentDestination(card) {
  const m = card.meta || {};
  if (card.tool === 'taskly') return `taskly:${m.columnId || 'todo'}`;
  if (card.tool === 'boardly') return `boardly:${m.tabId}`;
  if (card.tool === 'timely') return m.board ? `timely:plan:${m.board}:${m.containerId}` : m.kind === 'reminder' ? 'timely:reminders' : 'timely:today';
  if (card.tool === 'brainly') return card.type === 'link' ? `brainly:links:${m.linkFolderId || ''}` : m.folderId ? `brainly:folder:${m.folderId}` : 'brainly:canvas';
  return 'universal';
}
const todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
/** Send a card somewhere. Crossing tools goes through routeCard, exactly like a drag via the Universal Board. */
export function moveCardTo(id, key) {
  const card = store.getCard(id);
  if (!card) return false;
  const [tool, a, b, c] = key.split(':');
  const count = fn => store.cardsWhere(fn).length;
  let dest;
  if (tool === 'taskly') dest = { tool, type: 'task', meta: { columnId: a, order: count(x => x.tool === 'taskly' && x.meta?.columnId === a), ...(a === 'completed' ? { completedAt: new Date().toISOString() } : {}) } };
  else if (tool === 'boardly') {
    const n = count(x => x.tool === 'boardly' && x.meta?.tabId === a);
    dest = { tool, type: ['goal', 'task', 'note'].includes(card.type) ? card.type : 'note', meta: { tabId: a, x: 84 + (n % 4) * 228, y: 24 + Math.floor(n / 4) * 84 } };
  } else if (tool === 'timely') {
    if (a === 'today') dest = { tool, type: 'event', meta: { date: todayStr(), start: null, slot: null } };
    else if (a === 'reminders') dest = { tool, type: 'event', meta: { kind: 'reminder', done: false, date: null, start: null } };
    else dest = { tool, type: b === 'goals' ? 'goal' : 'task', meta: { board: b, containerId: c, order: count(x => x.tool === 'timely' && x.meta?.containerId === c) } };
  } else if (tool === 'brainly') {
    const emoji = card.meta?.emoji;
    if (a === 'canvas') { const n = count(x => x.tool === 'brainly' && x.type !== 'link' && !x.meta?.folderId); dest = { tool, type: 'note', meta: { x: 32 + (n % 5) * 140, y: 32 + Math.floor(n / 5) * 140, ...(emoji ? { emoji } : {}) } }; }
    else if (a === 'folder') dest = { tool, type: 'note', meta: { folderId: b, ...(emoji ? { emoji } : {}) } };
    else {
      const url = (`${card.title} ${flatten(card)}`.match(/https?:\/\/\S+/) || [])[0];
      dest = { tool, type: 'link', meta: { linkFolderId: b || null, ...(url ? { url, host: new URL(url).hostname.replace(/^www\./, '') } : { file: true }) } };
    }
  } else dest = { tool: 'universal', meta: { order: count(x => x.tool === 'universal') } };
  if (card.tool === dest.tool) {
    // Same tool: change place and type without flattening, the way an in-tool drag does.
    const meta = { ...card.meta, ...dest.meta };
    const drop = {
      taskly: a !== 'review' ? ['reviewUntil'] : [],
      timely: a === 'today' ? ['kind', 'board', 'containerId', 'archivedAt', 'done'] : a === 'reminders' ? ['board', 'containerId', 'archivedAt'] : ['date', 'start', 'dur', 'slot', 'kind', 'recurrence', 'archivedAt'],
      brainly: a === 'canvas' ? ['folderId', 'linkFolderId'] : a === 'folder' ? ['x', 'y', 'linkFolderId'] : ['folderId', 'x', 'y'],
      boardly: [], universal: [],
    }[tool] || [];
    drop.forEach(k => delete meta[k]);
    store.updateCard(id, { type: dest.type || card.type, meta }, { replaceMeta: true, log: true, logLabel: `Moved to ${destinationLabel(key)}` });
  } else routeCard(id, dest);
  toast(`Moved to ${destinationLabel(key)}`);
  return true;
}
export function moveSelect(card) {
  const cur = currentDestination(card);
  return h('select', { class: 'field-input move-select', 'aria-label': 'Move to' },
    moveDestinations().map(([g, list]) => h('optgroup', { label: g }, list.map(([v, l]) => h('option', { value: v, selected: v === cur }, l)))));
}
/** Stand-alone "Move to…" dialog for editors that aren't the shared one (SMART goals, Brainly notes). */
export function openMoveDialog(id, after) {
  const card = store.getCard(id);
  if (!card) return;
  const sel = moveSelect(card);
  modal({
    title: 'Move to…',
    body: h('div', { class: 'editor' }, h('p', { class: 'muted small' }, 'Moves the card the same way dragging it through the Universal Board would.'), sel),
    actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Move', kind: 'primary', onClick: () => { if (sel.value !== currentDestination(store.getCard(id))) { moveCardTo(id, sel.value); after?.(); } } }],
  });
}

/**
 * Shared editor modal. `extra(card, refs)` lets a tool append its own fields;
 * `collect(refs)` returns extra patch data on save.
 */
export function openEditor(id, { extra, collect, title = 'Edit card', readOnlyDescription = false } = {}) {
  const card = store.getCard(id);
  if (!card) return;
  const refs = {};
  refs.title = h('input', { class: 'field-input title-input', value: card.title, placeholder: 'Title', 'aria-label': 'Title' });
  refs.desc = h('textarea', { class: 'field-input', rows: 6, placeholder: 'Add details…', 'aria-label': 'Description' });
  refs.desc.value = /<\/?[a-z][\s\S]*>/i.test(card.description || '') ? stripHtml(card.description) : (card.description || '');
  if (readOnlyDescription) refs.desc.readOnly = true;
  const body = h('div', { class: 'editor' },
    h('div', { class: 'editor-meta' }, typeIcon(card.type), h('span', {}, `${card.type[0].toUpperCase()}${card.type.slice(1)} in ${TOOL_NAMES[card.tool]}`)),
    refs.title,
    h('label', { class: 'field-label' }, 'Details'),
    refs.desc,
    extra ? extra(card, refs) : null,
    h('label', { class: 'field-label' }, 'Move to…'),
    refs.move = moveSelect(card));
  const save = () => {
    const patch = { title: refs.title.value.trim() || 'Untitled', description: refs.desc.value };
    const more = collect?.(refs, card) || {};
    if (more.meta) patch.meta = more.meta;
    store.updateCard(id, { ...patch, ...more, meta: patch.meta }, { log: true });
    const moveTo = refs.move.value;
    if (moveTo && moveTo !== currentDestination(card)) moveCardTo(id, moveTo);
  };
  refs.title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); m.close(); } });
  const m = modal({ title, body, actions: [{ label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: save }] });
  return m;
}

/** Read-only peek used by Home and search results. */
export function peekBody(card) {
  const text = flatten(card) || 'No details yet.';
  return h('div', { class: 'peek' },
    h('div', { class: 'peek-head' }, typeIcon(card.type), h('strong', {}, card.title)),
    h('div', { class: 'peek-text' }, text),
    h('div', { class: 'peek-foot muted' }, `${TOOL_NAMES[card.tool]} · edited ${new Date(card.updatedAt).toLocaleString()}`));
}
