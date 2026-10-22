// Sedi — persistent chrome: header + menu drawer, tool navigator, Universal Board, trash bin, routing.

import { openDataInfo, markBackedUp } from './datainfo.js';
import { IS_BETA } from './env.js';
import * as store from './store.js';
import { h, icon, svg, $, toast, modal, confirmModal, download, todayKey, clamp, homeSpot } from './util.js';
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
  // Help opens Navoro's in-app guide (navoro/navoro.js, runs fully on this device).
  // data-navoro-trigger hands the button to Navoro, which shows it once it's ready.
  const help = h('button', {
    class: 'icon-btn help-btn', 'aria-label': 'Help', title: 'Help', 'aria-expanded': 'false', 'aria-haspopup': 'dialog',
    'data-navoro-trigger': '', hidden: true,
  }, icon('help'));
  const header = h('header', { class: 'topbar' },
    h('a', { class: 'brand', href: '#/home', 'aria-label': 'Sedi home', onclick: e => spinAtom(e.currentTarget) }, icon('atom', 'brand-atom'), h('span', {}, 'Sedi'),
      IS_BETA ? h('span', { class: 'sandbox-pill', title: 'Preview copy with its own separate data' }, 'Sandbox') : null),
    h('div', { class: 'topbar-actions' },
      help,
      h('button', { class: 'icon-btn menu-btn', 'aria-label': 'Open menu', 'aria-expanded': 'false', onclick: toggleDrawer }, icon('menu'))));
  return header;
}

let drawer;
function toggleDrawer(force) {
  const open = typeof force === 'boolean' ? force : !drawer.classList.contains('open');
  drawer.classList.toggle('open', open);
  drawer.inert = !open; // closed menu: out of the Tab order and away from screen readers
  $('.menu-btn').setAttribute('aria-expanded', String(open));
  if (open) setTimeout(() => drawer.querySelector('.drawer-item:not(.disabled)')?.focus(), 50);
}
function resetPositions() {
  dispatchEvent(new Event('sedi:reset-positions'));
  toast('Buttons are back in their places');
}
export function buildDrawer() {
  const item = (ic, label, sub, onclick, cls = '', navoroId = null) =>
    h('button', { class: `drawer-item ${cls}`, 'aria-label': label, 'data-navoro-id': navoroId, onclick: () => { toggleDrawer(false); onclick?.(); } },
      icon(ic), h('span', { class: 'drawer-text' }, h('span', {}, label), sub ? h('small', {}, sub) : null));
  const fileInput = importInput = h('input', { type: 'file', accept: '.json,application/json', hidden: true, onchange: e => importFile(e.target.files[0], e.target) });
  drawer = h('aside', { class: 'drawer', 'aria-label': 'Menu' },
    h('div', { class: 'drawer-list' },
      item('lock', 'Your data', 'Where it lives, and how to keep it safe', showDataInfo),
      item('sync', 'Sync devices', 'Coming later', null, 'disabled'),
      item('download', 'Download data', 'Save everything as a .json file', exportData),
      item('upload', 'Import data', 'Load a Sedi .json file', () => fileInput.click()),
      item('brain', 'On-device AI', 'Optional: private answers and coaching', openBrainPanel),
      item('atom', 'Other AI services', 'Use Claude or your own AI instead', openEnginesPanel),
      item('file', 'Google Docs', 'Works without setup; connecting is optional', openGooglePanel),
      item('bell', 'Apple Reminders', 'Set up the Shortcuts bridge', openRemindersSetup),
      item('home', 'Reset button positions', 'Put moved buttons back in place', resetPositions),
      h('div', { class: 'drawer-sep' }),
      item('trash', 'Clear storage', 'Erase everything on this device', clearStorage, 'danger', 'menu.clear')),
    fileInput);
  document.addEventListener('pointerdown', e => {
    if (drawer.classList.contains('open') && !drawer.contains(e.target) && !e.target.closest('.menu-btn')) toggleDrawer(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && drawer.classList.contains('open')) { toggleDrawer(false); $('.menu-btn')?.focus(); }
  });
  drawer.inert = true;
  return drawer;
}

let importInput = null;
export const showDataInfo = () => openDataInfo({ onBackup: exportData, onImport: () => importInput?.click() });
export async function exportData() {
  const data = await store.exportAllWithFiles();
  download(`sedi-${todayKey()}.json`, JSON.stringify(data, null, 2));
  markBackedUp();
  toast(`Downloaded your Sedi data${data.files?.length ? ` (including ${data.files.length} PDF${data.files.length === 1 ? '' : 's'})` : ''}`);
}

async function importFile(file, input) {
  input.value = '';
  if (!file) return;
  let data;
  try { data = JSON.parse(await file.text()); } catch { toast('That file isn’t valid JSON.'); return; }
  if (data?.app !== 'sedi' || !Array.isArray(data.cards)) { toast('That file isn’t a Sedi backup.', { code: 'IMPORT_NOT_SEDI' }); return; }
  const when = Date.parse(data.exportedAt);
  const run = async mode => {
    try { await store.importAll(data, mode); toast(mode === 'replace' ? 'Replaced with imported data' : 'Merged imported data'); }
    catch (e) { toast(`Couldn’t import that file: ${e?.message || 'it looks damaged'}`); }
  };
  modal({
    title: 'Import data',
    body: h('p', { class: 'muted' }, `${data.cards.length} cards${Number.isNaN(when) ? '' : ` from ${new Date(when).toLocaleString()}`}. Merge keeps your current cards and adds or updates from the file. Replace swaps everything for the file’s contents.`),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Replace', kind: 'ghost', onClick: () => run('replace') },
      { label: 'Merge', kind: 'primary', onClick: () => run('merge') },
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
      dataset: { route: r, springRoute: r }, 'aria-label': LABELS[r], 'data-navoro-id': `nav.${r}`,
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
  // On Home the tools stay out of sight and fade in as the pointer heads toward them.
  addEventListener('pointermove', e => {
    if (document.body.dataset.route !== 'home' || e.pointerType === 'touch') return;
    const reveal = Math.max(0, Math.min(1, (360 - (innerWidth - e.clientX)) / 220));
    wrap.style.setProperty('--nav-reveal', reveal.toFixed(2));
    wrap.classList.toggle('revealed', reveal > 0.85);
  }, { passive: true });
  return wrap;
}
export function markActiveRoute(route) {
  document.querySelectorAll('.nav-pill').forEach(p => p.classList.toggle('active', p.dataset.route === route));
}

// ---------- Universal Board ----------
// The Universal Board is the in-transit shelf: room for 25, with a gentle nudge (once a day) past 8.
export const UNI_MAX = 25;
const UNI_NUDGE_AT = 8;
let uniPanel, uniList, uniCount;
export function buildUniversal() {
  // SD-H1: a dark 44px circle with a small spiral galaxy, the "universal" place cards pass through.
  // Drop a card straight onto the button to send it to the board, even while the board is closed.
  const trigger = h('button', { class: 'universal-trigger', 'aria-label': 'Universal Board', title: 'Universal Board (drag to move; drop a card here to park it)', 'aria-expanded': 'false', dataset: { drop: 'universal', accept: 'card' }, onclick: () => { if (!uniJustDragged) toggleUniversal(); } }, icon('galaxy'));
  const quick = h('input', { class: 'uni-input', placeholder: 'Capture something…', 'aria-label': 'Add to Universal Board' });
  quick.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !quick.value.trim()) return;
    if (uniFull()) { toast(`The board holds ${UNI_MAX} cards. Sort a few into place first.`, { code: 'UNIVERSAL_FULL' }); return; }
    const list = universalCards();
    store.createCard({ type: 'note', title: quick.value.trim(), tool: 'universal', meta: { order: list.length } });
    quick.value = '';
    setTimeout(maybeNudgeUniversal, 1200);
  });
  uniCount = h('span', { class: 'uni-count' });
  uniList = h('div', { class: 'uni-list', dataset: { drop: 'universal', accept: 'card' }, 'data-list': '', 'data-autoscroll': '', 'data-navoro-sensitive': '' });
  uniPanel = h('section', { class: 'universal-panel', 'aria-label': 'Universal Board' },
    h('div', { class: 'uni-head' }, h('h2', {}, 'Universal Board'), uniCount),
    withMic(quick, { label: 'Dictate to the Universal Board' }), uniList,
    h('p', { class: 'uni-hint' }, 'Drop cards here, switch tools, then drag them out.'));
  const wrap = h('div', { class: 'universal' }, trigger, uniPanel);
  makeUniversalDraggable(wrap, trigger);
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
      const wasHere = store.getCard(id)?.tool === 'universal';
      routeCard(id, { tool: 'universal', meta: { order: index ?? list.length } });
      reorder(universalCards(), id, index);
      if (!wasHere && !uniPanel.parentElement.classList.contains('open')) toast(`Parked “${store.getCard(id)?.title?.slice(0, 32) || 'card'}” on the Universal Board`, { action: 'Open', onAction: () => toggleUniversal(true) });
      setTimeout(maybeNudgeUniversal, 1200);
    },
  });
  return wrap;
}
export function toggleUniversal(force) {
  const wrap = uniPanel.parentElement;
  const open = typeof force === 'boolean' ? force : !wrap.classList.contains('open');
  if (open) placeUniversalPanel(wrap);
  wrap.classList.toggle('open', open);
  wrap.querySelector('.universal-trigger').setAttribute('aria-expanded', String(open));
  if (open) renderUniversal();
}

// The Universal Board button can be dragged anywhere (like the assistant's atom) and remembers
// where it was left. Its panel opens toward whichever side of the screen has room.
let uniJustDragged = false;
const cssPx = name => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || 0;
function uniBounds(size) {
  const top = cssPx('--header-h') + 6, bottom = innerHeight - cssPx('--tabbar-h') - size - 8;
  return { minX: 8, maxX: innerWidth - size - 8, minY: top, maxY: Math.max(top, bottom) };
}
function placeUniversal(wrap, trigger, x, y) {
  const b = uniBounds(trigger.offsetWidth || 44);
  const cx = Math.min(Math.max(x, b.minX), b.maxX), cy = Math.min(Math.max(y, b.minY), b.maxY);
  Object.assign(wrap.style, { left: cx + 'px', top: cy + 'px', right: 'auto' });
  return { x: cx, y: cy };
}
function placeUniversalPanel(wrap) {
  const r = wrap.querySelector('.universal-trigger').getBoundingClientRect();
  const up = r.top + r.height / 2 > innerHeight / 2;
  wrap.classList.toggle('uni-up', up);
  wrap.classList.toggle('uni-left', r.left + r.width / 2 < innerWidth / 2);
  const room = up ? r.top - cssPx('--header-h') - 20 : innerHeight - r.bottom - cssPx('--tabbar-h') - 20;
  wrap.style.setProperty('--uni-room', Math.max(200, Math.round(room)) + 'px');
  wrap.style.setProperty('--uni-trigger-top', Math.round(r.top) + 'px');
  wrap.style.setProperty('--uni-trigger-bottom', Math.round(r.bottom) + 'px');
}
function sendUniversalHome(wrap) {
  wrap.style.removeProperty('left'); wrap.style.removeProperty('top'); wrap.style.removeProperty('right');
  store.setPref('universalPos', null);
  if (wrap.classList.contains('open')) placeUniversalPanel(wrap);
}
function makeUniversalDraggable(wrap, trigger) {
  requestAnimationFrame(() => {
    const pos = store.pref('universalPos');
    if (pos) placeUniversal(wrap, trigger, pos.x, pos.y);
  });
  // Where it lives by default: measured with the drag position removed (no transition).
  const spot = homeSpot(() => {
    const saved = wrap.style.cssText;
    wrap.style.transition = 'none'; wrap.style.removeProperty('left'); wrap.style.removeProperty('top'); wrap.style.removeProperty('right');
    const r = trigger.getBoundingClientRect();
    wrap.style.cssText = saved;
    return r;
  });
  addEventListener('sedi:reset-positions', () => sendUniversalHome(wrap));
  let start = null;
  trigger.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const r = trigger.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false, id: e.pointerId };
    trigger.setPointerCapture(e.pointerId);
  });
  trigger.addEventListener('pointermove', e => {
    if (!start || e.pointerId !== start.id) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
    if (!start.moved) { start.moved = true; wrap.classList.add('moving'); spot.show(); }
    placeUniversal(wrap, trigger, e.clientX - start.ox, e.clientY - start.oy);
    spot.near(trigger.getBoundingClientRect());
    if (wrap.classList.contains('open')) placeUniversalPanel(wrap);
  });
  const end = () => {
    if (!start) return;
    if (start.moved) {
      const r = trigger.getBoundingClientRect();
      if (spot.near(r)) sendUniversalHome(wrap);
      else store.setPref('universalPos', { x: Math.round(r.left), y: Math.round(r.top) });
      spot.hide();
      wrap.classList.remove('moving');
      uniJustDragged = true;
      setTimeout(() => { uniJustDragged = false; }, 0);
    }
    start = null;
  };
  trigger.addEventListener('pointerup', end);
  trigger.addEventListener('pointercancel', end);
  // Keep it on screen when the window changes size (or the phone rotates).
  addEventListener('resize', () => {
    const pos = store.pref('universalPos');
    if (pos) placeUniversal(wrap, trigger, pos.x, pos.y);
    if (wrap.classList.contains('open')) placeUniversalPanel(wrap);
  });
}
const universalCards = () => store.cardsWhere(c => c.tool === 'universal').sort(byOrder);
const uniFull = () => universalCards().length >= UNI_MAX;

/** Once a day, when 8 or more cards are waiting, suggest a quick sort. */
export function maybeNudgeUniversal() {
  const n = universalCards().length;
  const today = todayKey();
  if (n < UNI_NUDGE_AT || store.pref('uniNudgedOn') === today) return;
  store.setPref('uniNudgedOn', today);
  toast(`${n} cards are waiting on the Universal Board. Want to sort a few into place?`, { action: 'Open board', onAction: () => toggleUniversal(true), duration: 9000 });
}

export function renderUniversal() {
  if (!uniList) return;
  const list = universalCards();
  uniCount.textContent = list.length ? `${list.length}/${UNI_MAX}` : '';
  uniCount.classList.toggle('busy', list.length >= UNI_NUDGE_AT);
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
  const bin = h('div', { class: 'trash', dataset: { drop: 'trash', accept: 'card bfolder lfolder' }, 'aria-label': 'Trash', title: 'Drag cards here to delete' }, icon('trash'));
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
