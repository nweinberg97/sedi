// Sedi — persistent chrome: header + menu drawer, tool navigator, Universal Board, trash bin, routing.

import * as store from './store.js';
import { h, icon, svg, $, toast, modal, confirmModal, download, todayKey, clamp } from './util.js';
import { registerDrop, onDragStart, onDragEnd } from './dnd.js';
import { routeCard, reorder, byOrder, trashCard, typeIcon, openEditor, truncate, cardChrome, withMic } from './cards.js';
import { openBrainPanel } from './brain.js';
import { openRemindersSetup } from './timely.js';
import { openEnginesPanel } from './engines.js';
import { openGooglePanel } from './google.js';

export const ROUTES = ['home', 'taskly', 'boardly', 'timely', 'brainly'];
const NAV_ORDER = ['taskly', 'boardly', 'home', 'timely', 'brainly'];
const LABELS = { taskly: 'Taskly', boardly: 'Boardly', home: 'Home', timely: 'Timely', brainly: 'Brainly' };

export function currentRoute() {
  const r = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return ROUTES.includes(r) ? r : 'home';
}
export function navigate(route) {
  if (!ROUTES.includes(route)) route = 'home';
  if (currentRoute() !== route || !location.hash) location.hash = `#/${route}`;
}

// ---------- Header ----------
export function buildHeader() {
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', 'aria-label': 'Sedi home', onclick: e => spinAtom(e.currentTarget) }, icon('atom', 'brand-atom'), h('span', {}, 'Sedi')),
    h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Open menu', 'aria-expanded': 'false', onclick: toggleDrawer }, icon('menu')));
  return header;
}

let drawer;
function toggleDrawer(force) {
  const open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  $('.menu-btn').setAttribute('aria-expanded', String(open));
}
export function buildDrawer() {
  const item = (ic, label, sub, onclick, cls = '') =>
    h('button', { class: `drawer-item ${cls}`, onclick: () => { toggleDrawer(false); onclick?.(); } },
      icon(ic), h('span', { class: 'drawer-text' }, h('span', {}, label), sub ? h('small', {}, sub) : null));
  const fileInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => importFile(e.target.files[0], e.target) });
  drawer = h('aside', { class: 'drawer', 'aria-label': 'Menu' },
    h('div', { class: 'drawer-list' },
      item('sync', 'Sync devices', 'Coming later', null, 'disabled'),
      item('download', 'Download data', 'Save everything as a .json file', exportData),
      item('upload', 'Import data', 'Load a Sedi .json file', () => fileInput.click()),
      item('brain', 'Sovereign Brain', 'Private, on-device coach', openBrainPanel),
      item('atom', 'AI engines', 'On-device by default; add others if you like', openEnginesPanel),
      item('file', 'Google account', 'Create Google Docs from Brainly', openGooglePanel),
      item('bell', 'Apple Reminders', 'Set up the Shortcuts bridge', openRemindersSetup),
      h('div', { class: 'drawer-sep' }),
      item('trash', 'Clear storage', 'Erase everything on this device', clearStorage, 'danger')),
    fileInput);
  document.addEventListener('pointerdown', e => {
    if (drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('.menu-btn')) toggleDrawer(false);
  });
  return drawer;
}

async function exportData() {
  const data = await store.exportAllWithFiles();
  download(`sedi-${todayKey()}.json`, JSON.stringify(data, null, 2));
  toast(`Downloaded your Sedi data${data.files?.length ? ` (including ${data.files.length} PDF${data.files.length === 1 ? '' : 's'})` : ''}`);
}

async function importFile(file, input) {
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t valid JSON.'); return; }
  if (data?.app !== 'sedi') { toast('That file isn’t a Sedi export.'); return; }
  modal({
    title: 'Import data',
    body: h('p', { class: 'muted' }, `${data.cards.length} cards from ${new Date(data.exportedAt).toLocaleString()}. Merge keeps your current cards and adds or updates from the file. Replace swaps everything for the file’s contents.`),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Replace', kind: 'ghost', onClick: async () => { await store.importAll(data, 'replace'); toast('Replaced with imported data'); } },
      { label: 'Merge', kind: 'primary', onClick: async () => { await store.importAll(data, 'merge'); toast('Merged imported data'); } },
    ],
  });
}

async function clearStorage() {
  const first = await confirmModal('Clear storage?', 'This erases every card, board and setting saved on this device. Download your data first if you might want it back.', 'Continue', true);
  if (!first) return;
  const input = h('input', { class: 'field-input', placeholder: 'Type ERASE to confirm', 'aria-label': 'Type ERASE to confirm' });
  modal({
    title: 'This can’t be undone',
    body: h('div', {}, h('p', { class: 'muted' }, 'Type ERASE to permanently delete all Sedi data on this device.'), input),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: 'Erase everything', kind: 'danger', onClick: async () => {
          if (input.value.trim().toUpperCase() !== 'ERASE') { input.classList.add('shake'); setTimeout(() => input.classList.remove('shake'), 400); return true; }
          await store.clearAll();
          location.hash = '#/home';
          location.reload();
        },
      },
    ],
  });
}

/** The atom spins once when you click it (and on hover, via CSS). */
export function spinAtom(el) {
  const mark = el.querySelector('.atom-mark') || el;
  mark.classList.remove('spin'); void mark.getBoundingClientRect(); mark.classList.add('spin');
  setTimeout(() => mark.classList.remove('spin'), 1100);
}

// ---------- Navigator: same-size tool buttons with icons, open by default ----------
const NAV_ICONS = { taskly: 'checklist', boardly: 'board', home: 'home', timely: 'calendar', brainly: 'brain' };
export function buildNavigator() {
  const panel = h('nav', { class: 'navigator-panel', 'aria-label': 'Tools' });
  for (const r of NAV_ORDER) {
    panel.append(h('a', {
      class: 'nav-pill', href: `#/${r}`, title: LABELS[r],
      dataset: { route: r, springRoute: r }, 'aria-label': LABELS[r],
    }, icon(NAV_ICONS[r]), h('span', { class: 'nav-label' }, LABELS[r])));
  }
  const trigger = h('button', { class: 'navigator-trigger', 'aria-label': 'Hide tool buttons', 'aria-expanded': 'true', onclick: () => toggleNav() },
    h('span', { class: 'tri' }));
  const wrap = h('div', { class: 'navigator' }, panel, trigger);
  // Open unless you've closed it (small screens start closed so nothing covers the content).
  const startOpen = store.pref('navOpen', innerWidth > 900);
  function toggleNav(force, remember = true) {
    const open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
    wrap.classList.toggle('open', open);
    trigger.setAttribute('aria-expanded', String(open));
    trigger.setAttribute('aria-label', open ? 'Hide tool buttons' : 'Show tool buttons');
    if (remember) store.setPref('navOpen', open);
  }
  const narrow = matchMedia('(max-width: 900px)');
  toggleNav(narrow.matches ? false : startOpen, false);
  // Phones and small windows: fold away so the buttons never sit on top of your content.
  narrow.addEventListener?.('change', e => toggleNav(e.matches ? false : store.pref('navOpen', true), false));
  // While dragging, open the navigator when hovering the trigger so tools can be switched mid-drag.
  let openedForDrag = false;
  trigger.addEventListener('pointerenter', () => { if (document.body.classList.contains('is-dragging') && !wrap.classList.contains('open')) { openedForDrag = true; toggleNav(true, false); } });
  onDragEnd(() => { if (openedForDrag) { openedForDrag = false; toggleNav(store.pref('navOpen', true), false); } });
  return wrap;
}
export function markActiveRoute(route) {
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.toggle('active', p.dataset.route === route));
}

// ---------- Universal Board ----------
const UNI_ITEM_H = 46;
let uniPanel, uniList, uniCount;
export function buildUniversal() {
  // SD-H1: a dark 44px circle with a small spiral galaxy, the "universal" place cards pass through.
  const trigger = h('button', { class: 'universal-trigger', 'aria-label': 'Universal Board', title: 'Universal Board', 'aria-expanded': 'false', onclick: () => toggleUniversal() }, icon('galaxy'));
  const quick = h('input', { class: 'uni-input', placeholder: 'Capture something…', 'aria-label': 'Add to Universal Board' });
  quick.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    if (uniFull()) { toast('The board is full. Route or clear a card first.'); return; }
    const list = universalCards();
    store.createCard({ type: 'note', title: quick.value.trim(), tool: 'universal', meta: { order: list.length } });
    quick.value = '';
  });
  uniCount = h('span', { class: 'uni-count' });
  uniList = h('div', { class: 'uni-list', dataset: { drop: 'universal', accept: 'card' }, 'data-list': '' });
  uniPanel = h('section', { class: 'universal-panel', 'aria-label': 'Universal Board' },
    h('div', { class: 'uni-head' }, h('h2', {}, 'Universal Board'), uniCount),
    withMic(quick, { label: 'Dictate to the Universal Board' }), uniList,
    h('p', { class: 'uni-hint' }, 'Drop cards here, switch tools, then drag them out.'));
  const wrap = h('div', { class: 'universal' }, trigger, uniPanel);
  document.addEventListener('pointerdown', e => {
    if (!wrap.classList.contains('open') || wrap.contains(e.target) || e.target.closest('.modal-backdrop, .popover, .toast, [data-drag]')) return;
    toggleUniversal(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape' || !wrap.classList.contains('open') || document.querySelector('.modal-backdrop, .popover')) return;
    toggleUniversal(false);
  });
  registerDrop('universal', {
    accepts: ({ id }) => store.getCard(id)?.tool === 'universal' || !uniFull(),
    drop: ({ id, index }) => {
      const list = universalCards();
      routeCard(id, { tool: 'universal', meta: { order: index ?? list.length } });
      reorder(universalCards(), id, index);
    },
  });
  return wrap;
}
export function toggleUniversal(force) {
  const wrap = uniPanel.parentElement;
  const open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
  wrap.classList.toggle('open', open);
  wrap.querySelector('.universal-trigger').setAttribute('aria-expanded', String(open));
  if (open) renderUniversal();
}
const universalCards = () => store.cardsWhere(c => c.tool === 'universal').sort(byOrder);
function uniCapacity() {
  const hgt = uniList.clientHeight || 360;
  return Math.max(3, Math.floor((hgt + 6) / UNI_ITEM_H));
}
const uniFull = () => universalCards().length >= uniCapacity();

export function renderUniversal() {
  if (!uniList) return;
  const list = universalCards();
  uniCount.textContent = list.length ? `${list.length}/${uniCapacity()}` : '';
  uniList.replaceChildren(...list.map(c => {
    const el = h('div', { class: 'uni-card', dataset: { drag: 'card', id: c.id } },
      h('div', { class: 'uni-row' }, typeIcon(c.type), h('span', { class: 'uni-title', title: c.title }, c.title)));
    cardChrome(el, c, () => openEditor(c.id, { title: 'Universal card' }));
    el.addEventListener('dblclick', () => openEditor(c.id, { title: 'Universal card' }));
    return el;
  }));
  if (!list.length) uniList.append(h('div', { class: 'empty-hint' }, 'Nothing in transit.'));
}

// ---------- Trash ----------
export function buildTrash() {
  const bin = h('div', { class: 'trash', dataset: { drop: 'trash', accept: 'card bfolder lfolder' }, 'aria-label': 'Trash: drag cards here to delete' }, icon('trash'));
  registerDrop('trash', ({ kind, id }) => {
    if (kind === 'card') trashCard(id);
    else if (kind === 'bfolder') import('./brainly.js').then(m => m.trashFolder(id));
    else if (kind === 'lfolder') import('./brainly.js').then(m => m.trashLinkFolder(id));
    bin.classList.add('gulp');
    setTimeout(() => bin.classList.remove('gulp'), 380);
  });
  return bin;
}

onDragStart(() => document.querySelector('.trash')?.classList.add('ready'));
onDragEnd(() => document.querySelector('.trash')?.classList.remove('ready'));

// ---------- Reveal a card (search results, assistant): open its tool and flash it ----------
export function revealCard(id) {
  const c = store.getCard(id);
  if (!c) return;
  const m = c.meta || {};
  if (c.tool === 'universal') { toggleUniversal(true); return flashCard(id); }
  if (c.tool === 'timely') {
    if (m.board) { store.setPref('timelyMode', 'plan'); store.setPref('timelyPlan', m.board); }
    else {
      store.setPref('timelyMode', 'schedule');
      if (m.kind === 'reminder') store.setPref('timelyView', 'reminders');
      else { store.setPref('timelyView', 'day'); if (m.date && m.date >= todayKey()) store.setPref('timelyAnchor', m.date); }
    }
  }
  if (c.tool === 'boardly' && m.tabId) store.setPref('boardlyTab', m.tabId);
  navigate(c.tool);
  store.notify({ reason: 'reveal' });
  if (c.tool === 'brainly' && c.type !== 'link' && m.folderId) import('./brainly.js').then(b => setTimeout(() => b.openNote(id), 300));
  else flashCard(id);
}
function flashCard(id) {
  setTimeout(() => {
    const el = document.querySelector(`#view [data-id="${CSS.escape(id)}"], .universal [data-id="${CSS.escape(id)}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    el.classList.remove('flash-card'); void el.offsetWidth; el.classList.add('flash-card');
    setTimeout(() => el.classList.remove('flash-card'), 1700);
  }, 380);
}

// Keep a reference to helpers other modules may want.
export { clamp, truncate };
