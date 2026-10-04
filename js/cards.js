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
    extra ? extra(card, refs) : null);
  const save = () => {
    const patch = { title: refs.title.value.trim() || 'Untitled', description: refs.desc.value };
    const more = collect?.(refs, card) || {};
    if (more.meta) patch.meta = more.meta;
    store.updateCard(id, { ...patch, ...more, meta: patch.meta }, { log: true });
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
