// Sedi — the universal card: polymorphic routing between tools, ordering, and the shared editor.

import * as store from './store.js';
import { h, icon, modal, stripHtml, toast } from './util.js';
import { crunch } from './sound.js';
import { dictate as listen, canListen } from './speech.js'; // card mics: instant browser dictation

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
/** First line of a card's notes, shown small and italic under the title, so you can see there's more inside. */
export function notesSnippet(card, cls = '') {
  if (!hasNotes(card)) return null;
  const d = /<\/?[a-z][\s\S]*>/i.test(card.description || '') ? stripHtml(card.description) : (card.description || '');
  let line = d.split('\n').map(x => x.trim()).find(Boolean) || '';
  if (!line && card.meta?.smart) line = Object.values(card.meta.smart).find(v => v && String(v).trim()) || '';
  return line ? h('span', { class: `card-snippet ${cls}`, title: d.slice(0, 400) }, line) : null;
}

/** Adds the shared corner chrome to a card element: delete, details, duplicate, and the notes fold.
 *  Every card gets one-tap Duplicate in its hover tools, beside Details. Small cards ({ compact: true })
 *  get only that; their other extras live inside Details. Pass { onDuplicate } to use a tool's own copy. */
export function cardChrome(el, card, onInfo, { compact = false, actions = [], onDuplicate = null } = {}) {
  el.classList.add('has-chrome');
  el.classList.toggle('with-notes', hasNotes(card));
  if (hasNotes(card)) el.title = el.title || 'Has notes';
  el.append(deleteButton(card.id), infoButton(onInfo));
  const dup = duplicateButton(card.id, onDuplicate);
  // On touch screens there's no hover or double-click, so a single tap opens the card.
  if (!el.dataset.tapOpen) {
    el.dataset.tapOpen = '1';
    el.addEventListener('click', e => {
      if (!matchMedia('(hover: none)').matches) return;
      if (e.defaultPrevented || e.target.closest('button, a, input, textarea, select, [contenteditable="true"], .resize-handle')) return;
      onInfo(e);
      e.sediOpened = true; // a tool's own tap handler checks this so one tap never opens a card twice
    });
  }
  el.append(h('div', { class: 'card-tools' }, ...(compact ? [] : actions), dup));
  return el;
}
export const duplicateButton = (id, onDuplicate) => h('button', {
  class: 'card-tool card-dup', type: 'button', 'aria-label': 'Duplicate', title: 'Duplicate',
  onpointerdown: e => e.stopPropagation(), // a tap here never starts a drag
  onclick: e => { e.stopPropagation(); (onDuplicate || duplicateCard)(id); },
}, icon('copy'));

// ---------- Dictation into any card (speak; the words are added to the card's notes) ----------
let dictation = null;
export const dictateButton = id => h('button', {
  class: 'card-tool card-mic', type: 'button', 'aria-label': 'Dictate a note into this card', title: canListen ? 'Dictate into this card' : 'Voice input isn’t supported in this browser',
  onclick: e => { e.stopPropagation(); dictateInto(id, e.currentTarget); },
}, icon('mic'));
const escHtml = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
function appendNote(id, text) {
  const c = store.getCard(id);
  if (!c || !text) return;
  const t = text.charAt(0).toUpperCase() + text.slice(1) + (/[.!?]$/.test(text) ? '' : '.');
  const isHtml = /<\/?[a-z][\s\S]*>/i.test(c.description || '') || (c.tool === 'brainly' && c.type === 'note');
  const desc = isHtml ? `${c.description || ''}<div>${escHtml(t)}</div>` : (c.description?.trim() ? `${c.description.trimEnd()}\n${t}` : t);
  store.updateCard(id, { description: desc }, { log: true, logLabel: 'Dictated a note' });
  toast(`Added to “${truncate(c.title, 24)}”: ${truncate(t, 48)}`);
}
export function dictateInto(id, anchor) {
  if (dictation) { dictation.stop(); return; }
  const text = h('span', { class: 'dictate-text' }, 'Listening…');
  const bubble = h('div', { class: 'dictate-bubble', role: 'status' }, h('span', { class: 'wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')), text,
    h('button', { class: 'dictate-stop', type: 'button', onclick: () => dictation?.stop() }, 'Done'));
  document.body.append(bubble);
  const r = anchor.getBoundingClientRect();
  bubble.style.left = Math.max(12, Math.min(r.left - 120, innerWidth - 300)) + 'px';
  bubble.style.top = (r.bottom + 8 > innerHeight - 60 ? r.top - 52 : r.bottom + 8) + 'px';
  anchor.classList.add('on');
  dictation = listen({
    continuous: false,
    onInterim: t => { if (t) text.textContent = t; },
    onFinal: t => appendNote(id, t),
    onError: msg => toast(msg),
    onEnd: () => { dictation = null; anchor.classList.remove('on'); bubble.remove(); },
  });
}

/** Wrap a text input with a small mic that shows on hover/focus: speak and the words land in the field.
 *  The mic never steals focus, so inputs that save on blur keep working. */
export function withMic(input, { label = 'Dictate', subtle = false } = {}) {
  let session = null, base = '';
  const btn = h('button', {
    class: 'field-mic-inline', type: 'button', 'aria-label': label, title: canListen ? `${label} (speak, then Enter)` : 'Voice input isn’t supported in this browser', disabled: !canListen,
  }, icon('mic'));
  btn.addEventListener('pointerdown', e => e.preventDefault()); // keep focus in the field
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (session) { session.stop(); return; }
    input.focus();
    base = input.value ? `${input.value.trimEnd()} ` : '';
    wrap.classList.add('listening');
    session = listen({
      continuous: false,
      onInterim: t => { if (t) input.value = base + t; },
      onFinal: t => { if (t) input.value = base + t.charAt(0).toUpperCase() + t.slice(1); input.dispatchEvent(new Event('input', { bubbles: true })); },
      onError: msg => toast(msg),
      onEnd: () => { session = null; wrap.classList.remove('listening'); input.focus(); },
    });
  });
  const wrap = h('span', { class: `mic-field ${subtle ? 'mic-subtle' : ''}` });
  queueMicrotask(() => { if (input.parentNode && input.parentNode !== wrap) { input.replaceWith(wrap); wrap.append(input, btn); } });
  if (!input.parentNode) wrap.append(input, btn);
  return wrap;
}

// ---------- Duplicate any card ----------
// Tools can refuse a copy (e.g. a full Taskly column) by registering a guard that returns a message.
const dupGuards = [];
export const guardDuplicate = fn => dupGuards.push(fn);
export function duplicateCard(id) {
  const c = store.getCard(id);
  if (!c) return null;
  for (const g of dupGuards) { const msg = g(c); if (msg) { toast(msg); return null; } }
  const { summary, summaryOf, summaryBy, doneDates, archivedAt, ...meta } = c.meta || {};
  void summary; void summaryOf; void summaryBy; void doneDates; void archivedAt;
  if (meta.x != null) { meta.x += 26; meta.y = (meta.y ?? 0) + 26; }
  if (meta.order != null) meta.order += 0.5;
  const copy = store.createCard({ type: c.type, tool: c.tool, title: `${c.title} copy`, description: c.description, meta });
  landed(copy.id);
  toast(`Duplicated “${truncate(c.title, 28)}”`, { action: 'Undo', onAction: () => store.deleteCard(copy.id) });
  return copy;
}
/** Give a just-made card a soft pop so the eye finds it. */
export function landed(id) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    document.querySelectorAll(`[data-id="${CSS.escape(id)}"]`).forEach(el => { el.classList.add('landed'); setTimeout(() => el.classList.remove('landed'), 700); });
  }));
}

// ---------- Move to… (SD-C4): the same routes dragging uses ----------
const COLS = [['todo', 'To do'], ['inprogress', 'In progress'], ['review', 'Review'], ['completed', 'Completed'], ['backlog', 'Backlog']];
export function moveDestinations() {
  const tabs = store.get('boardlyTabs', []);
  const plan = store.get('planContainers', { projects: [], goals: [] });
  const folders = store.get('brainFolders', []);
  const lfolders = store.get('linkFolders', []);
  const lpath = f => { const names = [f.name]; let p = lfolders.find(x => x.id === f.parentId), g = 0; while (p && g++ < 10) { names.unshift(p.name); p = lfolders.find(x => x.id === p.parentId); } return names.join(' › '); };
  const fpath = f => { const names = [f.name]; let p = folders.find(x => x.id === f.parentId); while (p) { names.unshift(p.name); p = folders.find(x => x.id === p.parentId); } return names.join(' › '); };
  return [
    ['Taskly', COLS.map(([v, l]) => [`taskly:${v}`, l])],
    ['Boardly', tabs.map(t => [`boardly:${t.id}`, t.name])],
    ['Timely', [['timely:today', 'Today (any time)'], ['timely:reminders', 'Reminders'], ['timely:weekplan', 'This week’s plan'], ['timely:monthplan', 'This month’s plan'],
      ...(plan.projects || []).map(c => [`timely:plan:projects:${c.id}`, `Projects › ${c.name}`]),
      ...(plan.goals || []).map(c => [`timely:plan:goals:${c.id}`, `Goals › ${c.name}`])]],
    ['Brainly', [['brainly:canvas', 'Canvas'], ...folders.map(f => [`brainly:folder:${f.id}`, `Folder › ${fpath(f)}`]),
      ['brainly:links:', 'My links'], ...lfolders.map(f => [`brainly:links:${f.id}`, `Links › ${lpath(f)}`])]],
    ['Universal Board', [['universal', 'Universal Board']]],
  ];
}
export const destinationLabel = key => moveDestinations().flatMap(([g, list]) => list.map(([v, l]) => [v, g === 'Universal Board' ? l : `${g} › ${l}`])).find(([v]) => v === key)?.[1] || key;
export function currentDestination(card) {
  const m = card.meta || {};
  if (card.tool === 'taskly') return `taskly:${m.columnId || 'todo'}`;
  if (card.tool === 'boardly') return `boardly:${m.tabId}`;
  if (card.tool === 'timely') return m.board === 'weekplan' || m.board === 'monthplan' ? `timely:${m.board}` : m.board ? `timely:plan:${m.board}:${m.containerId}` : m.kind === 'reminder' ? 'timely:reminders' : 'timely:today';
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
    else if (a === 'weekplan' || a === 'monthplan') {
      const now = new Date();
      const wk = new Date(now.getFullYear(), now.getMonth(), now.getDate() - ((now.getDay() + 6) % 7));
      const planKey = a === 'weekplan' ? `${wk.getFullYear()}-${String(wk.getMonth() + 1).padStart(2, '0')}-${String(wk.getDate()).padStart(2, '0')}` : todayStr().slice(0, 7);
      dest = { tool, type: 'task', meta: { board: a, planKey, done: false, order: count(x => x.tool === 'timely' && x.meta?.board === a && x.meta?.planKey === planKey) } };
    }
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
      timely: a === 'today' ? ['kind', 'board', 'containerId', 'archivedAt', 'done', 'planKey'] : a === 'reminders' ? ['board', 'containerId', 'archivedAt', 'planKey'] : a === 'weekplan' || a === 'monthplan' ? ['date', 'start', 'dur', 'slot', 'kind', 'recurrence', 'archivedAt', 'containerId', 'doneDates'] : ['date', 'start', 'dur', 'slot', 'kind', 'recurrence', 'archivedAt', 'planKey'],
      brainly: a === 'canvas' ? ['folderId', 'linkFolderId'] : a === 'folder' ? ['x', 'y', 'linkFolderId'] : ['folderId', 'x', 'y'],
      boardly: [], universal: [],
    }[tool] || [];
    drop.forEach(k => delete meta[k]);
    store.updateCard(id, { type: dest.type || card.type, meta }, { replaceMeta: true, log: true, logLabel: `Moved to ${destinationLabel(key)}` });
  } else routeCard(id, dest);
  toast(`Moved to ${destinationLabel(key)}`);
  return true;
}
const MOVE_ICONS = { Taskly: 'checklist', Boardly: 'board', Timely: 'calendar', Brainly: 'brain', Links: 'link', 'Universal Board': 'galaxy' };
/** "Move to…" as a slideable panel: pick a tool, then swipe through its places. Exposes .value like a select. */
export function moveSelect(card) {
  const cur = currentDestination(card);
  // Links, PDFs and files only move between link folders.
  const isLink = card.tool === 'brainly' && card.type === 'link';
  const groups = moveDestinations().filter(([, list]) => list.length)
    .map(([g, list]) => (isLink ? (g === 'Brainly' ? ['Links', list.filter(([v]) => v.startsWith('brainly:links:'))] : null) : [g, list])).filter(Boolean);
  let value = cur;
  let group = (groups.find(([, list]) => list.some(([v]) => v === cur)) || groups[0])[0];
  const tabs = h('div', { class: 'mp-tabs', role: 'tablist', 'aria-label': 'Move to tool' });
  const track = h('div', { class: 'mp-track', role: 'listbox', 'aria-label': 'Move to' });
  const prev = h('button', { class: 'mp-arrow left', type: 'button', 'aria-label': 'Scroll left', onclick: () => track.scrollBy({ left: -220, behavior: 'smooth' }) }, icon('chevL'));
  const next = h('button', { class: 'mp-arrow right', type: 'button', 'aria-label': 'Scroll right', onclick: () => track.scrollBy({ left: 220, behavior: 'smooth' }) }, icon('chevR'));
  const status = h('p', { class: 'mp-status muted small' });
  const paintArrows = () => { prev.hidden = track.scrollLeft < 4; next.hidden = track.scrollLeft + track.clientWidth > track.scrollWidth - 4; };
  track.addEventListener('scroll', paintArrows, { passive: true });
  track.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { track.scrollLeft += e.deltaY; e.preventDefault(); } }, { passive: false });
  const paint = () => {
    tabs.replaceChildren(...groups.map(([g]) => h('button', { class: `mp-tab ${g === group ? 'on' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(g === group), onclick: () => { group = g; paint(); track.scrollLeft = 0; } },
      icon(MOVE_ICONS[g] || 'dot'), g === 'Universal Board' ? 'Universal' : g)));
    const list = groups.find(([g]) => g === group)[1];
    track.replaceChildren(...list.map(([v, l]) => h('button', {
      class: `mp-chip ${v === value ? 'on' : ''} ${v === cur ? 'is-here' : ''}`, type: 'button', role: 'option', 'aria-selected': String(v === value), dataset: { value: v },
      onclick: () => { value = v === value ? cur : v; paint(); },
    }, v === cur ? h('span', { class: 'mp-here' }, 'Here') : null, l.replace(/^(Projects|Goals|Folder|Links) › /, (m0, k) => `${k} · `))));
    status.textContent = value === cur ? `Now in ${destinationLabel(cur)}. Pick a place to move it.` : `Will move to ${destinationLabel(value)} when you save.`;
    status.classList.toggle('pending', value !== cur);
    requestAnimationFrame(() => { track.querySelector('.mp-chip.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' }); paintArrows(); });
  };
  const el = h('div', { class: 'move-picker' }, tabs, h('div', { class: 'mp-rail' }, prev, track, next), status);
  Object.defineProperty(el, 'value', { get: () => value, set: v => { value = v; paint(); } });
  paint();
  return el;
}
/** Stand-alone "Move to…" dialog for editors that aren't the shared one (SMART goals, Brainly notes). */
export function openMoveDialog(id, after) {
  const card = store.getCard(id);
  if (!card) return;
  const sel = moveSelect(card);
  modal({
    title: 'Move to…',
    body: h('div', { class: 'editor' }, h('p', { class: 'muted small' }, card.type === 'link' ? 'Pick the link folder it belongs in.' : 'Moves the card the same way dragging it through the Universal Board would.'), sel),
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
  withMic(refs.title, { label: 'Dictate the title', subtle: true });
  refs.desc = h('textarea', { class: 'field-input', rows: 6, placeholder: 'Add details, or press the mic and speak…', 'aria-label': 'Description' });
  // Dictate straight into the details box.
  let session = null;
  const mic = h('button', { class: 'icon-btn sm field-mic', type: 'button', 'aria-label': 'Dictate into details', title: canListen ? 'Dictate' : 'Voice input isn’t supported in this browser', disabled: !canListen,
    onclick: () => {
      if (session) { session.stop(); return; }
      mic.classList.add('on');
      session = listen({
        continuous: true,
        onFinal: t => { if (!t) return; const v = refs.desc.value; refs.desc.value = `${v}${v && !/\s$/.test(v) ? ' ' : ''}${t.charAt(0).toUpperCase()}${t.slice(1)}${/[.!?]$/.test(t) ? '' : '.'}`; },
        onError: msg => toast(msg),
        onEnd: () => { session = null; mic.classList.remove('on'); },
      });
    } }, icon('mic'));
  refs.desc.value = /<\/?[a-z][\s\S]*>/i.test(card.description || '') ? stripHtml(card.description) : (card.description || '');
  const shownDesc = refs.desc.value; // if the details aren't changed, keep the original (with its formatting)
  if (readOnlyDescription) refs.desc.readOnly = true;
  const body = h('div', { class: 'editor' },
    h('div', { class: 'editor-meta' }, typeIcon(card.type), h('span', {}, `${card.type[0].toUpperCase()}${card.type.slice(1)} in ${TOOL_NAMES[card.tool]}`)),
    refs.title,
    h('div', { class: 'field-label-row' }, h('label', { class: 'field-label' }, 'Details'), mic),
    refs.desc,
    extra ? extra(card, refs) : null,
    h('label', { class: 'field-label' }, 'Move to…'),
    refs.move = moveSelect(card));
  const save = () => {
    const patch = { title: refs.title.value.trim() || 'Untitled', description: refs.desc.value === shownDesc ? (card.description || '') : refs.desc.value };
    const more = collect?.(refs, card) || {};
    if (more.meta) patch.meta = more.meta;
    store.updateCard(id, { ...patch, ...more, meta: patch.meta }, { log: true });
    const moveTo = refs.move.value;
    if (moveTo && moveTo !== currentDestination(card)) moveCardTo(id, moveTo);
  };
  refs.title.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); save(); m.close(); } });
  const m = modal({ title, body, onClose: () => session?.stop(), actions: [
    { label: 'Duplicate', kind: 'ghost', onClick: () => { save(); duplicateCard(id); } },
    { label: 'Cancel', kind: 'ghost' }, { label: 'Save', kind: 'primary', onClick: save }] });
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
