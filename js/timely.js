// Sedi — Timely: forward-only scheduling (day / week / month / reminders) and planning boards.
// Past one-off items move to a 30-day archive, then delete themselves to keep storage light.
// Routines (SD-T4) are cards with meta.recurrence; ticking one day adds that date to meta.doneDates.

import * as store from './store.js';
import { builderOn, toggleBuilder, sendButton, openSendMenu, taskPrompt, listPrompt, ship, shipButton, shipLabel, openShipSettings } from './builder.js';
import {
  h, icon, uuid, clamp, toast, modal, editInline, download, popover, closePopovers, hashStr, listMode,
  dateKey, parseKey, todayKey, addDays, addMonths, startOfWeek, fmtMinutes, fmtShortDate, MONTH_NAMES, DAY_NAMES, pad,
} from './util.js';
import { registerDrop, onDragStart, onDragEnd } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, trashCard, cardChrome, notesSnippet, withMic, truncate } from './cards.js';
import { todoCards, todoCapacity, completeTask } from './taskly.js';
import { tick, checkSound } from './sound.js';
import { celebrate } from './celebrate.js';
import { dictate as listen, canListen } from './speech.js'; // card mics: instant browser dictation
import { extractWhen } from './commands.js';

export const SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'];
export const SLOT_LABELS = { morning: 'Morning', noon: 'Noon', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const RECUR = { '': 'Does not repeat', daily: 'Every day (daily routine)', weekdays: 'Every weekday', weekly: 'Every week (weekly routine)', monthly: 'Every month (monthly routine)', custom: 'Custom…' };
const RECUR_SHORT = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
// SD-T14: one-off item kinds. Stored as meta.itemType so it never collides with meta.kind ('reminder').
// Category = which part of life (a color). Type = what kind of thing (task, meeting…). Kept apart on purpose.
// Categories are yours: rename them, recolor them, add your own, remove the ones you don't use.
export const CAT_PALETTE = ['#2e9e6a', '#4a6fd1', '#c9822b', '#d0567f', '#7a5cc7', '#2f97b0', '#d9534f', '#8a9a2b', '#b5651d', '#5b6b82', '#e08ab6', '#3cb4a6'];
const DEFAULT_CATS = [['health', 'Health', 0], ['work', 'Work', 1], ['admin', 'Admin', 9], ['meals', 'Meals', 7], ['chores', 'Chores', 2], ['social', 'Social', 3], ['learning', 'Learning', 4], ['personal', 'Personal', 5]]
  .map(([id, name, i]) => ({ id, name, color: CAT_PALETTE[i] }));
/** Your categories, in order. Earlier renames (catNames) carry over. */
export function cats() {
  const saved = store.pref('cats');
  if (Array.isArray(saved)) {
    // Admin and Meals joined the standard set later: offer them once to lists made before.
    if (!store.pref('catsV2')) {
      store.setPref('catsV2', true);
      const add = DEFAULT_CATS.filter(d => ['admin', 'meals'].includes(d.id) && !saved.some(x => x.id === d.id || x.name?.toLowerCase() === d.name.toLowerCase()));
      if (add.length) { const next = [...saved, ...add]; store.setPref('cats', next); return next; }
    }
    return saved.filter(x => x && x.id && x.color);
  }
  const old = store.pref('catNames', {});
  return DEFAULT_CATS.map(c => ({ ...c, name: (old[c.id] || '').trim() || c.name }));
}
const saveCats = list => store.setPref('cats', list);
export const catOf = c => (c?.meta?.cat ? cats().find(x => x.id === c.meta.cat) : null);
export const catName = id => cats().find(x => x.id === id)?.name || '';
const catVars = color => ({ '--cat': color, '--cat-bg': `color-mix(in srgb, ${color} 13%, white)` });
const catClass = c => (catOf(c) ? 'cat' : '');
/** Paint a block, chip or dot in its category's color. */
function paintCat(el, c) { const k = catOf(c); if (k) Object.entries(catVars(k.color)).forEach(([p, v]) => el.style.setProperty(p, v)); return el; }

/** One small place to shape both lists: your types (names) and your categories (names, colors, add, remove). */
function openCatNames(anchorEl, onChange) {
  const tnames = { ...store.pref('typeNames', {}) };
  const box = h('div', { class: 'cat-names' });
  // Colors open right under the row (not a second pop-up, which would close this one).
  const swatchPicker = (anchor, current, onPick) => {
    const row = anchor.closest('.cat-name-row');
    const open = row.nextElementSibling?.classList.contains('cat-swatches');
    box.querySelectorAll('.cat-swatches').forEach(x => x.remove());
    if (open) return;
    row.after(h('div', { class: 'cat-swatches' }, CAT_PALETTE.map(col => h('button', { class: `cat-sw ${col === current ? 'on' : ''}`, type: 'button', style: { background: col }, 'aria-label': `Color ${col}`,
      onclick: e => { e.preventDefault(); box.querySelectorAll('.cat-swatches').forEach(x => x.remove()); onPick(col); } }))));
  };
  const paint = () => {
    const list = cats();
    const typeRows = Object.keys(TYPE_DEFAULTS).filter(k => !TYPE_DEFAULTS[k].span).map(k => {
      const input = h('input', { class: 'field-input sm', value: ITEM_TYPES[k].label, maxlength: 18, 'aria-label': `Name for ${TYPE_DEFAULTS[k].label}` });
      input.addEventListener('input', () => { tnames[k] = input.value.trim() === TYPE_DEFAULTS[k].label ? '' : input.value.trim(); store.setPref('typeNames', tnames); onChange?.(); });
      input.addEventListener('keydown', e => e.stopPropagation());
      return h('label', { class: 'cat-name-row' }, icon(TYPE_DEFAULTS[k].icon, 'type-row-ic'), input);
    });
    const catRows = list.map((c, i) => {
      const input = h('input', { class: 'field-input sm', value: c.name, maxlength: 18, 'aria-label': `Name for category ${c.name}` });
      input.addEventListener('input', () => { const l = cats(); l[i] = { ...l[i], name: input.value.trim() || c.name }; saveCats(l); onChange?.(); });
      input.addEventListener('keydown', e => e.stopPropagation());
      const dot = h('button', { class: 'cat-dot', type: 'button', style: { background: c.color }, title: 'Change color', 'aria-label': `Change the color of ${c.name}`,
        onclick: e => { e.preventDefault(); swatchPicker(e.currentTarget, c.color, col => { const l = cats(); l[i] = { ...l[i], color: col }; saveCats(l); onChange?.(); paint(); }); } });
      const del = h('button', { class: 'icon-btn xs', type: 'button', 'aria-label': `Remove ${c.name}`, title: 'Remove (blocks keep their place, just uncolored)',
        onclick: e => { e.preventDefault(); const l = cats().filter(x => x.id !== c.id); saveCats(l); onChange?.(); paint(); } }, icon('x'));
      return h('div', { class: 'cat-name-row' }, dot, input, del);
    });
    const newName = h('input', { class: 'field-input sm', placeholder: 'New category', maxlength: 18, 'aria-label': 'New category name' });
    let newColor = CAT_PALETTE.find(col => !list.some(c => c.color === col)) || CAT_PALETTE[list.length % CAT_PALETTE.length];
    const newDot = h('button', { class: 'cat-dot', type: 'button', style: { background: newColor }, 'aria-label': 'Pick a color', onclick: e => swatchPicker(e.currentTarget, newColor, col => { newColor = col; newDot.style.background = col; }) });
    const add = () => {
      const name = newName.value.trim();
      if (!name) { newName.focus(); return; }
      saveCats([...cats(), { id: `c${Date.now().toString(36)}`, name, color: newColor }]);
      onChange?.(); paint();
      box.querySelector('.cat-new input')?.focus();
    };
    newName.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') add(); });
    box.replaceChildren(
      h('strong', {}, 'Types and categories'),
      h('span', { class: 'cat-names-h' }, 'Types'), ...typeRows,
      h('span', { class: 'cat-names-h' }, 'Categories'), ...catRows,
      h('div', { class: 'cat-name-row cat-new' }, newDot, newName, h('button', { class: 'btn ghost xs', type: 'button', onclick: add }, 'Add')));
  };
  paint();
  popover(anchorEl, box, { className: 'cat-names-pop' });
}
const TYPE_DEFAULTS = { task: { label: 'Task', icon: 'checklist' }, meeting: { label: 'Meeting', icon: 'calendar' }, appointment: { label: 'Appointment', icon: 'clock' }, work: { label: 'Focus', icon: 'target' }, event: { label: 'Event', icon: 'sparkle' }, trip: { label: 'Trip', icon: 'plane', span: true }, conference: { label: 'Conference', icon: 'people', span: true } };
// Types can carry your own names too ("Class" instead of Appointment). The label is read fresh each time.
export const ITEM_TYPES = Object.fromEntries(Object.entries(TYPE_DEFAULTS).map(([k, t]) => [k, {
  ...t, get label() { return (store.pref('typeNames', {})[k] || '').trim() || t.label; },
}]));
const ARCHIVE_DAYS = 30;

let root, body, tbRight, planAdding = null;
let dayScroll = null;      // { key, top }: keeps your place in the day while things change
let zoom = null;           // { view: 'week'|'month', date, slot?, anim }: the zoomed-in period or day
const SLOT_HOURS = { morning: [5, 11], noon: [11, 13], afternoon: [13, 17], evening: [17, 21], night: [21, 29] }; // 29 = 5am next day
const hourLabel = hr => fmtMinutes((hr % 24) * 60);
export const dayName = (key, { short = false } = {}) => { const d = parseKey(key); return `${key === todayKey() ? 'Today · ' : ''}${short ? DAY_NAMES[d.getDay()].slice(0, 3) : DAY_NAMES[d.getDay()]}, ${fmtShortDate(d)}`; };

// ---------- Queries ----------
const isSched = c => c.tool === 'timely' && !c.meta?.board;
const isPlan = c => c.tool === 'timely' && !!c.meta?.board;
const live = c => isSched(c) && !c.meta?.archivedAt;
const isRoutine = c => !!c.meta?.recurrence;

const slotOfMinutes = m => (m < 5 * 60 ? 'night' : m < 11 * 60 ? 'morning' : m < 13 * 60 ? 'noon' : m < 17 * 60 ? 'afternoon' : m < 21 * 60 ? 'evening' : 'night');

function recursOn(meta, key) {
  if (!meta.recurrence || !meta.date || key < meta.date) return false;
  const d = parseKey(key), base = parseKey(meta.date);
  switch (meta.recurrence) {
    case 'daily': return true;
    case 'weekdays': return d.getDay() >= 1 && d.getDay() <= 5;
    case 'weekly': return d.getDay() === base.getDay();
    case 'monthly': return d.getDate() === base.getDate();
    case 'custom': {
      const r = meta.repeat || {};
      if (r.until && key > r.until) return false;
      const every = Math.max(1, r.every || 1);
      if (r.unit === 'week') {
        const weeks = Math.round((startOfWeek(d) - startOfWeek(base)) / (7 * 864e5));
        const days = r.days?.length ? r.days : [base.getDay()];
        return weeks % every === 0 && days.includes(d.getDay());
      }
      if (r.unit === 'month') {
        const months = (d.getFullYear() - base.getFullYear()) * 12 + d.getMonth() - base.getMonth();
        return months % every === 0 && d.getDate() === base.getDate();
      }
      return Math.round((d - base) / 864e5) % every === 0;
    }
    default: return false;
  }
}
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ICS_DOW = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
/** "Weekly", or for custom rules "Every 2 weeks · Mon, Wed". */
export function recurLabel(meta) {
  if (meta?.recurrence !== 'custom') return RECUR_SHORT[meta?.recurrence] || 'Routine';
  const r = meta.repeat || {}, n = Math.max(1, r.every || 1);
  const unit = { day: 'day', week: 'week', month: 'month' }[r.unit] || 'day';
  let out = n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`;
  if (unit === 'week' && r.days?.length) out += ` · ${[...r.days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map(d => DOW[d]).join(', ')}`;
  if (r.until) out += ` · until ${fmtShortDate(parseKey(r.until))}`;
  return out;
}
function rruleFor(meta) {
  if (meta.recurrence !== 'custom') return RRULE[meta.recurrence];
  const r = meta.repeat || {};
  const freq = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY' }[r.unit] || 'DAILY';
  let rule = `FREQ=${freq};INTERVAL=${Math.max(1, r.every || 1)}`;
  if (r.unit === 'week' && r.days?.length) rule += `;BYDAY=${r.days.map(d => ICS_DOW[d]).join(',')}`;
  if (r.until) rule += `;UNTIL=${r.until.replace(/-/g, '')}T235959`;
  return rule;
}
/** Every N days/weeks/months, on chosen weekdays, until a date (or forever). */
function customRepeatFields(initial = {}, baseDate = todayKey()) {
  const r = { every: 1, unit: 'week', days: [parseKey(baseDate).getDay()], until: null, ...initial };
  const every = h('input', { class: 'field-input sm rp-every', type: 'number', min: 1, max: 99, value: r.every, 'aria-label': 'Repeat every' });
  const unit = h('select', { class: 'field-input sm', 'aria-label': 'Unit' }, [['day', 'days'], ['week', 'weeks'], ['month', 'months']].map(([v, l]) => h('option', { value: v, selected: r.unit === v }, l)));
  const days = new Set(r.days || []);
  const dayRow = h('div', { class: 'rp-days', role: 'group', 'aria-label': 'On these days' }, [1, 2, 3, 4, 5, 6, 0].map(d => h('button', {
    type: 'button', class: `rp-day ${days.has(d) ? 'on' : ''}`, 'aria-pressed': String(days.has(d)), title: DAY_NAMES[d],
    onclick: e => { days.has(d) ? days.delete(d) : days.add(d); e.currentTarget.classList.toggle('on', days.has(d)); e.currentTarget.setAttribute('aria-pressed', String(days.has(d))); preview(); },
  }, DAY_NAMES[d][0])));
  const ends = h('select', { class: 'field-input sm', 'aria-label': 'Ends' }, h('option', { value: '' }, 'Never ends'), h('option', { value: 'on', selected: !!r.until }, 'Ends on…'));
  const until = h('input', { class: 'field-input sm', type: 'date', min: baseDate, value: r.until || '', hidden: !r.until, 'aria-label': 'Ends on' });
  const sum = h('p', { class: 'rp-sum muted small' });
  const read = () => ({ every: Math.max(1, +every.value || 1), unit: unit.value, days: unit.value === 'week' ? [...days] : [], until: ends.value === 'on' && until.value ? until.value : null });
  const preview = () => { dayRow.hidden = unit.value !== 'week'; until.hidden = ends.value !== 'on'; sum.textContent = recurLabel({ recurrence: 'custom', repeat: read() }); };
  [every, unit, ends, until].forEach(x => x.addEventListener('input', preview));
  [every, unit, ends, until].forEach(x => x.addEventListener('change', preview));
  every.addEventListener('keydown', e => e.stopPropagation());
  const el = h('div', { class: 'rp-custom' },
    h('div', { class: 'rp-row' }, h('span', { class: 'rp-lbl' }, 'Every'), every, unit),
    dayRow,
    h('div', { class: 'rp-row' }, ends, until),
    sum);
  preview();
  return { el, read };
}
/** Everything happening on a day. Routine occurrences carry `done` when that day was ticked. */
export function occurrencesOn(key) {
  const spans = m => m.endDate && m.date && key > m.date && key <= m.endDate; // trips and conferences cover every day in between
  const out = store.cardsWhere(c => live(c) && !(c.meta.kind === 'reminder' && c.meta.done && !c.meta.recurrence) && (c.meta.date === key || spans(c.meta) || recursOn(c.meta, key)))
    .map(card => ({ card, date: key, done: card.meta.recurrence ? !!card.meta.doneDates?.includes(key) : !!card.meta.done }));
  const slotIdx = s => (s ? SLOTS.indexOf(s) : 9);
  return out.sort((a, b) => {
    const ma = a.card.meta, mb = b.card.meta;
    const ka = ma.start != null ? ma.start : slotIdx(ma.slot) * 300 + 1, kb = mb.start != null ? mb.start : slotIdx(mb.slot) * 300 + 1;
    return ka - kb;
  });
}
/** Tick or untick one day of a routine. The routine itself is never removed. */
export function toggleRoutineDay(id, key) {
  const c = store.getCard(id);
  if (!c) return;
  const done = new Set(c.meta.doneDates || []);
  const on = !done.has(key);
  on ? done.add(key) : done.delete(key);
  // Keep the list short: only the last 60 days matter.
  const cutoff = dateKey(addDays(new Date(), -60));
  store.updateCard(id, { meta: { doneDates: [...done].filter(k => k >= cutoff).sort() } }, { log: on, logLabel: 'Done for today' });
  if (on) { checkSound(); toast(`Done for ${key === todayKey() ? 'today' : fmtShortDate(parseKey(key))}. “${c.title}” comes back next time.`); }
}

// ---------- Maintenance: archive then purge ----------
export function runMaintenance() {
  const today = todayKey();
  const cutoff = Date.now() - ARCHIVE_DAYS * 864e5;
  let changed = false;
  for (const c of store.allCards()) {
    if (!isSched(c)) continue;
    const m = c.meta || {};
    if (m.archivedAt) {
      if (new Date(m.archivedAt).getTime() < cutoff) { store.deleteCard(c.id, { silent: true }); changed = true; }
      continue;
    }
    const pastOneOff = m.date && (m.endDate || m.date) < today && !m.recurrence && m.kind !== 'reminder';
    const doneReminder = m.kind === 'reminder' && m.done && !m.recurrence; // a routine reminder never archives itself
    if (pastOneOff || doneReminder) { store.updateCard(c.id, { meta: { archivedAt: new Date().toISOString() } }, { silent: true }); changed = true; }
  }
  if (changed) store.notify({ reason: 'maintenance' });
}

// ---------- View state ----------
const mode = () => store.pref('timelyMode', 'schedule');
const view = () => store.pref('timelyView', 'day');
const planBoard = () => store.pref('timelyPlan', 'projects');
function anchor() {
  const a = store.pref('timelyAnchor', todayKey());
  return a < todayKey() ? todayKey() : a;
}
const setAnchor = k => { store.setPref('timelyAnchor', k); render(); };

export function mount(el) {
  root = el;
  body = h('div', { class: 'timely-body', 'data-navoro-sensitive': '' });
  root.replaceChildren(h('div', { class: 'view timely' }, h('div', { class: 'timely-head' }), body));
  dayScroll = null; zoom = null;
  render();
}

export function render() {
  if (!root?.isConnected) return;
  const head = root.querySelector('.timely-head');
  const seg = (items, value, onPick, cls = '') => h('div', { class: `segmented ${cls}`, role: 'tablist' },
    items.map(([v, label]) => h('button', { class: v === value ? 'on' : '', role: 'tab', 'aria-selected': String(v === value), 'data-navoro-id': `timely.${v}`, onclick: () => onPick(v) }, label)));
  // SD-T1/T2/T3: Scheduling / Planning on top; the sub-views sit in a smaller, indented bar beneath.
  // One clear hierarchy: the tool, then the mode, then a single toolbar with the views (left) and what you can do (right).
  const tabs = (items, value, onPick) => h('div', { class: 'tl-tabs', role: 'tablist' },
    items.map(([v, label, ic]) => h('button', { class: `tl-tab ${v === value ? 'on' : ''}`, role: 'tab', 'aria-selected': String(v === value), onclick: () => { zoom = null; onPick(v); } }, icon(ic), label)));
  tbRight = h('div', { class: 'tb-right' });
  head.replaceChildren(
    h('div', { class: 'timely-top' },
      h('h1', { class: 'view-title' }, 'Timely'),
      seg([['schedule', 'Scheduling'], ['plan', 'Planning']], mode(), v => { zoom = null; store.setPref('timelyMode', v); render(); }, 'mode-toggle'),
      h('span', { class: 'head-spacer' })),
    h('div', { class: 'timely-toolbar' },
      mode() === 'schedule'
        ? tabs([['day', 'Daily', 'sun'], ['week', 'Weekly', 'columns'], ['month', 'Monthly', 'grid'], ['reminders', 'Reminders', 'pin']], view(), v => { store.setPref('timelyView', v); render(); })
        : tabs([['projects', 'Projects', 'folder'], ['goals', 'Goals', 'flag']], planBoard(), v => { store.setPref('timelyPlan', v); render(); }),
      tbRight));
  if (mode() === 'plan') tbRight.append(...[
    planBoard() === 'goals' ? h('button', { class: 'chip ghost', onclick: openGoalGuide }, icon('sparkle'), 'How to set a good goal') : null,
    // Builder mode is a quiet switch, so it never reads like an action button.
    planBoard() === 'projects' ? h('button', { class: `builder-switch builder-chip ${builderOn() ? 'on' : ''}`, type: 'button', role: 'switch', 'aria-checked': String(builderOn()), title: 'Builder mode: repo, Ship and Ship all for software projects', onclick: () => toggleBuilder(render) }, h('span', { class: 'bs-track' }, h('span', { class: 'bs-knob' })), 'Builder mode') : null,
    // On a computer the "Add project" tile at the end of the board does this; phones keep a button.
    listMode() ? h('button', { class: 'btn sm primary', onclick: () => (planBoard() === 'goals' ? openGoalWizard(null) : addContainer('projects')) }, icon('plus'), planBoard() === 'goals' ? 'New goal' : 'Add project') : null].filter(Boolean));
  if (mode() === 'plan') return renderPlan();
  ({ day: renderDay, week: renderWeek, month: renderMonth, reminders: renderReminders })[view()]();
}

/** The date header that sits right above a calendar: big title, then ‹ › and Today. */
function navControl(label, step, { sub = '' } = {}) {
  const a = anchor(), atToday = view() === 'day' || view() === 'week' ? a === todayKey()
    : parseKey(a).getMonth() === new Date().getMonth() && parseKey(a).getFullYear() === new Date().getFullYear();
  const go = k => { zoom = null; dayScroll = null; setAnchor(k); };
  const archive = archiveButton();
  if (archive) tbRight.append(archive);
  return h('div', { class: 'cal-head' },
    h('div', { class: 'cal-title' }, h('h2', {}, label), sub ? h('span', { class: 'cal-sub' }, sub) : null),
    h('div', { class: 'cal-nav' },
      h('button', { class: 'icon-btn cal-arrow', 'aria-label': 'Previous', disabled: atToday, onclick: () => go(step(-1)) }, icon('chevL')),
      h('button', { class: 'icon-btn cal-arrow', 'aria-label': 'Next', onclick: () => go(step(1)) }, icon('chevR')),
      h('button', { class: 'chip cal-today', disabled: atToday, onclick: () => go(todayKey()) }, 'Today')));
}
function archiveButton() {
  const n = store.cardsWhere(c => isSched(c) && c.meta?.archivedAt).length;
  return n ? h('button', { class: 'chip ghost', onclick: openArchive, title: 'Past items are kept for 30 days' }, icon('archive'), `Archive ${n}`) : null;
}
const itemTypeOf = c => (c.meta?.kind === 'reminder' ? 'reminder' : c.meta?.itemType || 'task');

// ---------- Daily ----------
/** Touch screens: stretch a calendar box down to just above the tab bar, so the screen is used and nothing scrolls. */
function fitBottom(el, min = 300) {
  if (!el?.isConnected) return;
  const host = document.querySelector('.view-host'), bar = document.querySelector('.navigator');
  const br = bar?.getBoundingClientRect(), hr = host?.getBoundingClientRect();
  let bottom = Math.min(br && br.height && br.top > innerHeight / 2 ? br.top : innerHeight, hr?.bottom || innerHeight);
  // Atom floats at the bottom centre: end the box above it rather than hiding a day under it.
  const at = document.querySelector('.assistant-token')?.getBoundingClientRect(), er = el.getBoundingClientRect();
  if (at && at.width && at.left < er.right && at.right > er.left && at.top < bottom) bottom = at.top - 4;
  el.style.setProperty('height', Math.max(min, bottom - el.getBoundingClientRect().top - 14) + 'px', 'important');
}
function markTouch(layout) {
  const v = root.querySelector('.timely');
  v?.classList.toggle('day-touch', layout !== 'desktop');
  v?.classList.toggle('day-compact', layout === 'compact');
  v?.classList.toggle('day-wide-touch', layout === 'tablet');
}
/** Which day layout fits this screen: 'compact' (phones, portrait tablets), 'tablet' (landscape touch), or 'desktop'. */
function dayLayout() {
  if (listMode()) return 'compact';
  const touch = matchMedia('(hover: none) and (pointer: coarse)').matches;
  if (!touch) return innerWidth <= 820 ? 'compact' : 'desktop';
  return innerWidth < 1000 || innerHeight > innerWidth ? 'compact' : 'tablet';
}
function renderDay() {
  const key = anchor();
  const d = parseKey(key);
  const label = `${key === todayKey() ? 'Today, ' : ''}${DAY_NAMES[d.getDay()]} ${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
  const occ = occurrencesOn(key);
  const timed = occ.filter(o => o.card.meta.start != null);
  const untimed = occ.filter(o => o.card.meta.start == null);
  const allDay = h('div', { class: 'allday', dataset: { drop: 'timely-allday', accept: 'card', date: key } },
    h('span', { class: 'allday-label' }, 'Any time'),
    untimed.map(o => chip(o.card, { date: key, done: o.done })),
    h('button', { class: 'icon-btn xs', 'aria-label': 'Add an any-time item', onclick: () => quickAdd({ date: key }) }, icon('plus')));
  const scroll = h('div', { class: 'day-scroll', 'data-autoscroll': '' });
  const grid = h('div', { class: 'day-grid', dataset: { drop: 'timely-day', accept: 'card', date: key } });
  scroll.append(grid);
  // SD-T9 narrower day column, SD-T10 the day's to-do list beside it, SD-T11 Daily routine.
  const head = navControl(label, n => dateKey(addDays(parseKey(key), n)), { sub: `${occ.length ? `${occ.length} planned` : 'Nothing planned yet'}` });
  // Touch screens get a day built for fingers. Phones and portrait tablets: the day fills the screen, with one
  // "+ Add" and a "Plan" button by the date (the plan opens as a sheet). Landscape tablets keep the plan beside the
  // day, but both fill the screen and the add buttons collapse into one "+ Add".
  const layout = dayLayout();
  const onPhone = layout === 'compact';
  markTouch(layout);
  const phoneActions = onPhone ? h('div', { class: 'm-day-actions' },
    key !== todayKey() ? h('button', { class: 'chip m-today-btn', type: 'button', onclick: () => { zoom = null; dayScroll = null; setAnchor(todayKey()); } }, 'Today') : null,
    h('button', { class: 'chip m-plan-btn', type: 'button', onclick: () => openPlanSheet(key) }, icon('checklist'), 'Plan', todoCards().length ? h('small', {}, todoCards().length) : null),
    h('button', { class: 'btn sm primary m-add-btn', type: 'button', onclick: e => openItemForm(e.currentTarget, { type: 'task', date: key, pickDate: false }) }, icon('plus'), 'Add')) : null;
  const tabletAdd = layout === 'tablet' ? h('div', { class: 'm-day-actions' },
    key !== todayKey() ? h('button', { class: 'chip m-today-btn', type: 'button', onclick: () => { zoom = null; dayScroll = null; setAnchor(todayKey()); } }, 'Today') : null,
    h('button', { class: 'btn sm primary m-add-btn', type: 'button', onclick: e => openItemForm(e.currentTarget, { type: 'task', date: key, pickDate: false }) }, icon('plus'), 'Add')) : null;
  if (tabletAdd) head.append(tabletAdd); // landscape tablets: Add sits on the date line, no extra row
  body.replaceChildren(...[
    layout === 'desktop' ? actionRow(standardAdds(key), 'Hover the day to add at a time, or press + Now.') : null,
    h('div', { class: 'day-layout' },
      h('div', { class: 'day-col' }, head, phoneActions, allDay, scroll),
      onPhone ? null : sidePlan(key))].filter(Boolean));

  // Size hours so 6am–8pm fills the visible window exactly.
  requestAnimationFrame(() => {
    // Phones: the day is part of the page's own scroll (no box scrolling inside a scrolling page), so the hour height is fixed.
    const phone = layout !== 'desktop'; // every touch layout: fixed, finger-sized hours, and the box fills the screen
    const hourH = phone ? (layout === 'compact' && listMode() ? 64 : 72) : Math.max(64, scroll.clientHeight / 12); // 15 minutes ≥ 14px, so short blocks stay grabbable // roomy enough that hour-long titles wrap (SD-B1)
    grid.style.setProperty('--hour', hourH + 'px');
    grid.style.height = hourH * 24 + 'px';
    for (let hr = 0; hr < 24; hr++) {
      grid.append(h('div', { class: 'hour-row', style: { top: hr * hourH + 'px', height: hourH + 'px' } },
        h('span', { class: 'hour-label' }, hr === 0 ? '' : fmtMinutes(hr * 60))));
    }
    // Overlapping blocks sit side by side instead of on top of each other.
    const spans = timed.map(o => ({ o, a: o.card.meta.start, b: o.card.meta.start + (o.card.meta.dur || 60) })).sort((x, y) => x.a - y.a || y.b - x.b);
    let cluster = [], clusterEnd = -1;
    // Side by side, the way good calendars do it: each block takes the first free lane, then stretches across
    // any lanes to its right that are free for its whole time, so nothing is squeezed narrower than it needs.
    const flush = () => {
      const lanes = [];
      for (const sp of cluster) { let i = lanes.findIndex(end => end <= sp.a); if (i < 0) { i = lanes.length; lanes.push(0); } lanes[i] = sp.b; sp.lane = i; }
      cluster.forEach(sp => {
        sp.lanes = lanes.length;
        let span = 1;
        while (sp.lane + span < lanes.length && !cluster.some(o => o !== sp && o.lane === sp.lane + span && o.a < sp.b && o.b > sp.a)) span++;
        sp.span = span;
      });
      cluster = [];
    };
    for (const sp of spans) { if (sp.a >= clusterEnd && cluster.length) flush(); cluster.push(sp); clusterEnd = Math.max(clusterEnd, sp.b); }
    flush();
    for (const sp of spans) {
      const el = eventBlock(sp.o.card, hourH, key, sp.o.done);
      if (sp.lanes > 1) { el.style.setProperty('--lane', sp.lane); el.style.setProperty('--lanes', sp.lanes); el.style.setProperty('--span', sp.span); el.classList.add('in-lane'); }
      grid.append(el);
    }
    const nowMins = (() => { const n = new Date(); return n.getHours() * 60 + n.getMinutes(); })();
    const addAt = (start, dur = 60) => {
      const card = store.createCard({ type: 'event', tool: 'timely', title: 'New block', meta: { date: key, start, dur, itemType: 'task' } });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const el = body.querySelector(`[data-id="${card.id}"]`);
        el?.classList.add('just-added');
        const t = el?.querySelector('.ev-title');
        if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
      }));
    };
    if (key === todayKey()) {
      grid.append(h('div', { class: 'now-line', style: { top: (nowMins / 60) * hourH + 'px' } },
        h('button', { class: 'now-add', type: 'button', 'aria-label': 'Add something right now', title: `Add at ${fmtMinutes(Math.floor(nowMins / 5) * 5)}`, onclick: e => { e.stopPropagation(); const at = Math.floor(nowMins / 5) * 5; if (phone) openItemForm(e.currentTarget, { type: 'task', date: key, start: at, pickDate: false }); else addAt(at, 30); } }, icon('plus'), h('span', {}, 'Now'))));
    }
    // Start where you are in the day: right now for today (a little context above), 7am otherwise. Keep your place on updates.
    const startTop = key === todayKey() ? Math.max(0, (nowMins / 60 - 1.25) * hourH) : 7 * hourH;
    const wantTop = dayScroll?.key === key ? dayScroll.top : startTop;
    // Phones: the hours fill the rest of the screen and scroll on their own, under a header that stays put.
    if (phone) {
      const host = document.querySelector('.view-host');
      if (host) host.scrollTop = 0;
      fitBottom(scroll, 320);
      // The plan beside the day (landscape tablets) ends where the day ends.
      const side = body.querySelector('.day-layout > .side-plan, .day-layout > .day-plan');
      if (side) { side.style.setProperty('height', (scroll.getBoundingClientRect().bottom - side.getBoundingClientRect().top) + 'px', 'important'); }
    }
    scroll.scrollTop = wantTop;
    // The box may not be laid out yet on the first render (phones); set it again once it is.
    requestAnimationFrame(() => { if (Math.abs(scroll.scrollTop - wantTop) > 2) scroll.scrollTop = wantTop; });
    scroll.addEventListener('scroll', () => { dayScroll = { key, top: scroll.scrollTop }; }, { passive: true });
    // Hover the day: after a short pause on a clearly empty spot, the free time under the pointer lights up with
    // a +. Passing over, or resting right next to a block, shows nothing, so grabbing a short block never turns
    // into adding a new one. A click adds only while the + is showing.
    const ghost = h('div', { class: 'slot-ghost', hidden: true }, h('span', { class: 'slot-ghost-pill' }, icon('plus'), h('span', { class: 'slot-ghost-time' })));
    grid.append(ghost);
    const slotAt = e => clamp(Math.floor(((e.clientY - grid.getBoundingClientRect().top) / hourH) * 2) * 30, 0, 23 * 60 + 30);
    const onEmpty = e => e.target === grid || e.target.classList.contains('hour-row') || e.target.closest('.slot-ghost');
    const nearBlock = e => [-10, 10].some(dy => document.elementsFromPoint(e.clientX, e.clientY + dy).some(n => n.classList?.contains('event-block')));
    let armed = null, armTimer = 0, lastSlot = -1;
    const disarm = () => { clearTimeout(armTimer); armed = null; lastSlot = -1; ghost.hidden = true; };
    const arm = (start, x) => {
      // Fit the free gap: up to half an hour, stopping at the next block in that column.
      const next = timed.map(o => o.card.meta.start).filter(t => t > start && t < start + 30).sort((p, q) => p - q)[0];
      const len = (next ?? start + 30) - start;
      if (len < 15) return;
      armed = { start, len };
      ghost.hidden = false;
      ghost.style.top = (start / 60) * hourH + 'px';
      ghost.style.height = (len / 60) * hourH + 'px';
      ghost.querySelector('.slot-ghost-time').textContent = `Add at ${fmtMinutes(start)}`;
    };
    grid.addEventListener('pointermove', e => {
      if (document.body.classList.contains('is-dragging') || resizing) return; // the drag preview owns the ghost then
      if (!onEmpty(e) || nearBlock(e)) { disarm(); return; }
      const start = slotAt(e);
      if (start === lastSlot) return;
      disarm(); lastSlot = start;
      armTimer = setTimeout(() => arm(start, e.clientX), 320);
    });
    grid.addEventListener('pointerleave', () => { if (!document.body.classList.contains('is-dragging')) disarm(); });
    // Adding is a deliberate click on the lit spot: press and release in place. Letting go after a drag or a
    // resize (which the browser also reports as a click) never starts a new event.
    let press = null;
    grid.addEventListener('pointerdown', e => {
      press = onEmpty(e) && e.button === 0 && armed ? { x: e.clientX, y: e.clientY, t: Date.now(), slot: armed } : null;
    });
    grid.addEventListener('click', e => {
      if (!onEmpty(e)) return;
      const p = press; press = null;
      if (!p || Date.now() - lastMoveEnd < 450 || Math.hypot(e.clientX - p.x, e.clientY - p.y) > 6 || Date.now() - p.t > 700) return;
      disarm();
      // On a phone a tap opens the add sheet with that time filled in, so a stray tap never makes an event.
      if (phone) openItemForm(grid, { type: 'task', date: key, start: p.slot.start, pickDate: false });
      else {
        // An hour by default, or up to the next block if that comes sooner.
        const next = timed.map(o => o.card.meta.start).filter(t => t > p.slot.start).sort((x, y) => x - y)[0];
        addAt(p.slot.start, Math.max(15, Math.min(60, (next ?? p.slot.start + 60) - p.slot.start)));
      }
    });
    // Phones have no hover: a tap on an empty spot opens the add sheet straight away.
    if (phone) grid.addEventListener('click', e => { if (onEmpty(e) && !press && Date.now() - lastMoveEnd > 450) openItemForm(grid, { type: 'task', date: key, start: slotAt(e), pickDate: false }); });
  });
}

/** The tick on anything scheduled. A routine is ticked for that day only; anything else is simply done. */
function routineTick(c, key, done) {
  const routine = isRoutine(c);
  return h('button', { class: `routine-tick ${done ? 'on' : ''}`, type: 'button', 'aria-label': done ? 'Mark not done' : routine ? 'Done for this day' : 'Mark done', 'aria-pressed': String(done),
    title: routine ? (done ? 'Done for this day' : 'Tick off this day (the routine stays)') : done ? 'Done. Click to undo' : 'Mark done',
    onclick: e => { e.stopPropagation(); routine ? toggleRoutineDay(c.id, key) : toggleDone(c.id); } }, icon('check'));
}
function toggleDone(id) {
  const c = store.getCard(id);
  if (!c) return;
  const on = !c.meta.done;
  store.updateCard(id, { meta: { done: on, completedAt: on ? new Date().toISOString() : null } }, { log: on, logLabel: 'Completed' });
  if (on) { checkSound(); toast(`Done: “${truncate(c.title, 32)}”`, { action: 'Undo', onAction: () => store.updateCard(id, { meta: { done: false, completedAt: null } }) }); }
}
const routineTag = c => h('span', { class: 'routine-tag' }, icon('repeat'), recurLabel(c.meta));

function eventBlock(c, hourH, key, done) {
  const m = c.meta;
  const dur = m.dur || 60;
  // Drawn at its true length, so a 15-minute block never covers the one after it.
  const px = Math.max(14, (dur / 60) * hourH - 2);
  // SD-B1: tall enough → title wraps (up to 2–3 lines); short blocks become a single clean row.
  const short = px < 40, tiny = px < 24;
  const lines = px >= 84 ? 3 : 2;
  const el = h('article', {
    class: `event-block ${short ? 'short' : ''} ${tiny ? 'tiny' : ''} ${catClass(c)} it-${itemTypeOf(c)} ${isRoutine(c) ? 'is-routine' : ''} ${done ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id },
    style: { top: (m.start / 60) * hourH + 'px', height: px + 'px', '--lines': lines },
  },
  // Anything scheduled can be ticked off: routines for the day, everything else for good.
  ITEM_TYPES[itemTypeOf(c)]?.span ? null : routineTick(c, key, done),
  h('span', { class: 'ev-title', title: 'Double-click to rename' }, catClass(c) ? h('span', {}, icon(ITEM_TYPES[itemTypeOf(c)]?.icon || 'bell', 'ev-type'), c.title) : c.title),
  h('span', { class: 'ev-time' }, h('span', { class: 'ev-range' }, `${fmtMinutes(m.start)}–${fmtMinutes(m.start + dur)}`), isRoutine(c) ? routineTag(c) : null),
  !short && px >= 70 ? notesSnippet(c) : null,
  // Both edges stretch it: the top moves the start, the bottom moves the end. Tiny blocks are all grab.
  tiny ? null : h('div', { class: 'resize-handle top', 'aria-hidden': 'true' }),
  tiny ? null : h('div', { class: 'resize-handle', 'aria-hidden': 'true' }));
  el.title = `${c.title} · ${fmtMinutes(m.start)}–${fmtMinutes(m.start + dur)} · double-click for details`;
  // Roomy blocks keep their hover tools; short ones stay clean so they're easy to grab.
  if (short) el.classList.add('bare');
  else cardChrome(el, c, () => openEventEditor(c.id), { actions: quickActions(c) });
  paintCat(el, c);
  // One way in, for every block: double-click the title to rename it, anywhere else to open details.
  // (On touch screens, which have no double-click, a tap opens details.)
  el.querySelector('.ev-title').addEventListener('dblclick', e => { e.stopPropagation(); editInline(e.currentTarget, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  el.addEventListener('dblclick', e => { if (!e.target.closest('button, .resize-handle, [contenteditable="true"]')) openEventEditor(c.id); });
  if (short) el.addEventListener('click', e => { if (matchMedia('(hover: none)').matches && !e.target.closest('button, .resize-handle')) openEventEditor(c.id); });
  // Stretch in 15-minute steps, from either edge.
  el.querySelectorAll('.resize-handle').forEach(handle => handle.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation(); e.preventDefault();
    resizing = true;
    const fromTop = handle.classList.contains('top');
    const sy = e.clientY, end = m.start + dur;
    let ns = m.start, nd = dur;
    const move = ev => {
      const delta = Math.round((((ev.clientY - sy) / hourH) * 60) / 15) * 15;
      if (fromTop) { ns = clamp(m.start + delta, 0, end - 15); nd = end - ns; el.style.top = (ns / 60) * hourH + 'px'; }
      else nd = clamp(dur + delta, 15, 24 * 60 - m.start);
      el.style.height = Math.max(14, (nd / 60) * hourH - 2) + 'px';
      el.querySelector('.ev-range').textContent = `${fmtMinutes(ns)}–${fmtMinutes(ns + nd)}`;
      el.classList.add('resizing');
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      resizing = false; lastMoveEnd = Date.now();
      el.classList.remove('resizing');
      if (ns !== m.start || nd !== dur) store.updateCard(c.id, { meta: { start: ns, dur: nd } });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  }));
  return el;
}

function chip(c, { showTime = false, date = null, done = false } = {}) {
  const m = c.meta || {};
  const el = h('div', { class: `t-chip ${catClass(c)} it-${itemTypeOf(c)} ${isRoutine(c) ? 'is-routine' : ''} ${done ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id }, title: c.title },
    date && !ITEM_TYPES[itemTypeOf(c)]?.span ? routineTick(c, date, done) : null,
    showTime && m.start != null ? h('span', { class: 't-chip-time' }, fmtMinutes(m.start)) : null,
    h('span', { class: 't-chip-title' }, c.title),
    isRoutine(c) && !date ? icon('repeat', 'ev-repeat') : null);
  el.addEventListener('dblclick', () => openEventEditor(c.id));
  el.addEventListener('click', e => { if (!e.target.closest('button')) openEventEditor(c.id); });
  return paintCat(el, c);
}

/** Hover actions for Timely cards: add to calendar, and repeat (turn it into a routine). */
function quickActions(c) {
  return [
    h('button', { class: 'card-tool', type: 'button', 'aria-label': 'Add to calendar', title: 'Add to your calendar…', onclick: e => { e.stopPropagation(); addToCalendar(e.currentTarget, c.id, { choose: true }); } }, icon('calendar')),
    h('button', { class: `card-tool ${isRoutine(c) ? 'on-routine' : ''}`, type: 'button', 'aria-label': 'Repeat', title: isRoutine(c) ? `Repeats ${recurLabel(c.meta).toLowerCase()}` : 'Repeat: make it a routine', onclick: e => { e.stopPropagation(); openRepeat(e.currentTarget, c.id); } }, icon('repeat')),
  ];
}
function openRepeat(anchorEl, id) {
  const c = store.getCard(id);
  if (!c) return;
  const pick = (v, repeat) => {
    const meta = { recurrence: v || null, repeat: v === 'custom' ? repeat : null };
    if (v && !c.meta.date) meta.date = todayKey();
    if (v && !c.meta.doneDates) meta.doneDates = [];
    const label = v ? recurLabel({ recurrence: v, repeat }).toLowerCase() : '';
    store.updateCard(id, { meta }, { log: true, logLabel: v ? `Repeats ${label}` : 'Stopped repeating' });
    closePopovers();
    toast(v ? `“${c.title}” now repeats ${label}. Ticking a day never deletes it.` : `“${c.title}” no longer repeats.`);
  };
  const custom = customRepeatFields(c.meta.recurrence === 'custom' ? c.meta.repeat : {}, c.meta.date || todayKey());
  const customBox = h('div', { class: 'rp-box', hidden: c.meta.recurrence !== 'custom' }, custom.el,
    h('button', { class: 'btn sm primary', type: 'button', onclick: () => pick('custom', custom.read()) }, 'Save repeat'));
  popover(anchorEl, h('div', { class: 'repeat-pop' },
    h('strong', {}, 'Repeat'),
    ...Object.entries(RECUR).map(([v, l]) => h('button', {
      class: `repeat-opt ${(c.meta.recurrence || '') === v ? 'on' : ''}`,
      onclick: () => { if (v === 'custom') { customBox.hidden = !customBox.hidden; return; } pick(v); },
    }, v === 'custom' ? icon('gear') : v ? icon('repeat') : icon('x'), l.replace(/ \(.*\)/, ''))),
    customBox));
}

// ---------- The day's side panel: Today's plan, or this week's or month's, to drag onto a time ----------
// Weekly and monthly plans are for deciding what; the day is for deciding when. Switching the panel lets
// you pull something from the week or the month straight onto an hour, without leaving the day.
function sidePlan(key, { onChange = render, scheduleOn = null } = {}) {
  const which = store.pref('daySide', 'today');
  const d = parseKey(key);
  const panel = which === 'week' ? periodPlanPanel('weekplan', weekPlanKey(d), 'This week’s plan', `Week of ${fmtShortDate(parseKey(weekPlanKey(d)))}`, { scheduleOn })
    : which === 'month' ? periodPlanPanel('monthplan', monthPlanKey(d), `${MONTH_NAMES[d.getMonth()]} plan`, 'Drag one onto a time to schedule it', { scheduleOn })
    : dayPlanPanel(key);
  const count = k => (k === 'week' ? periodCards('weekplan', weekPlanKey(d)) : k === 'month' ? periodCards('monthplan', monthPlanKey(d)) : todoCards()).filter(c => !c.meta?.done).length;
  const seg = h('div', { class: 'side-switch', role: 'tablist', 'aria-label': 'Which plan' },
    [['today', key === todayKey() ? 'Today' : 'Day'], ['week', 'Week'], ['month', 'Month']].map(([v, label]) => {
      const n = count(v);
      return h('button', { class: v === which ? 'on' : '', role: 'tab', 'aria-selected': String(v === which), type: 'button', onclick: () => { store.setPref('daySide', v); onChange(); } },
        label, n ? h('small', {}, n) : null);
    }));
  if (which !== 'today') { const tip = [...panel.querySelectorAll('p.muted.small')].pop(); if (tip && panel.querySelector('.plan-item')) tip.textContent = 'Drag one onto a time to schedule it.'; }
  return h('div', { class: 'side-plan' }, seg, panel);
}

// ---------- Today's plan (SD-T10) = Taskly's To do column. One list, shown in both places. ----------
function dayPlanPanel(key) {
  const list = todoCards();
  const input = h('input', { class: 'field-input sm', placeholder: 'Add to the plan, then Enter', 'aria-label': 'Add to today’s plan', 'data-keep': `plan-${key}` });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    if (todoCards().length >= todoCapacity()) { toast('Taskly’s To do column is full. Finish or move something first.', { code: 'TASKLY_COLUMN_FULL' }); return; }
    store.createCard({ type: 'task', tool: 'taskly', title: input.value.trim(), meta: { columnId: 'todo', order: todoCards().length } });
    input.value = '';
  });
  return h('aside', { class: 'day-plan', dataset: { drop: 'day-plan', accept: 'card' }, 'data-list': '' },
    h('div', { class: 'day-plan-head' },
      h('h3', {}, key === todayKey() ? 'Today’s plan' : 'Plan'),
      h('span', { class: 'sync-tag', title: 'This list is Taskly’s To do column. Changes show up in both places.' }, icon('sync'), 'Taskly To do')),
    h('div', { class: 'day-plan-list' }, list.map(c => {
      const el = h('div', { class: 'plan-item', dataset: { drag: 'card', id: c.id } },
        h('button', { class: 'plan-check', 'aria-label': `Complete “${c.title}”`, onclick: e => { e.stopPropagation(); e.currentTarget.classList.add('on'); celebrate(e.currentTarget); setTimeout(() => completeTask(c.id), 520); } }, icon('check')),
        h('div', { class: 'plan-main' }, h('span', { class: 'plan-text', title: c.title, dataset: { fit: c.title } }, c.title), notesSnippet(c)),
        h('button', { class: 'icon-btn xs', title: 'Give it a time today', 'aria-label': 'Schedule it today', onclick: e => { e.stopPropagation(); scheduleToday(c.id, key); } }, icon('clock')));
      el.addEventListener('dblclick', () => openEditor(c.id, { title: 'Task' }));
      return el;
    })),
    withMic(input, { label: 'Dictate a plan item' }),
    h('p', { class: 'muted small' }, list.length ? (matchMedia('(hover: none)').matches ? 'Tap the clock on a task to give it a time.' : 'Drag a task onto the day to give it a time.') : 'Nothing in To do. Add the day’s plan here; it shows up in Taskly too.'));
}
/** Put a plan task on the day at the next free half hour (moves it from Taskly into Timely). */
function scheduleToday(id, key) {
  const now = new Date();
  const taken = occurrencesOn(key).filter(o => o.card.meta.start != null).map(o => [o.card.meta.start, o.card.meta.start + (o.card.meta.dur || 60)]);
  let start = key === todayKey() ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30 : 9 * 60;
  while (start < 23 * 60 && taken.some(([a, b]) => start < b && start + 30 > a)) start += 30;
  start = Math.min(start, 23 * 60);
  const c = store.getCard(id);
  placeSched(id, { date: key, start, dur: 30, slot: null, itemType: 'task' }, 'Scheduled');
  toast(`Scheduled “${c?.title}” at ${fmtMinutes(start)}`, { action: 'Undo', onAction: () => routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: 'todo', order: 0 } }) });
}
/** Give any plan item the next free half hour on a day (week and month plan items, from the phone's plan sheet). */
function scheduleAt(id, key) {
  const now = new Date();
  const taken = occurrencesOn(key).filter(o => o.card.meta.start != null).map(o => [o.card.meta.start, o.card.meta.start + (o.card.meta.dur || 60)]);
  let start = key === todayKey() ? Math.ceil((now.getHours() * 60 + now.getMinutes() + 1) / 30) * 30 : 9 * 60;
  while (start < 23 * 60 && taken.some(([a, b]) => start < b && start + 30 > a)) start += 30;
  start = Math.min(start, 23 * 60);
  const c = store.getCard(id);
  placeSched(id, { date: key, start, dur: 30, slot: null, itemType: 'task' }, 'Scheduled');
  toast(`Scheduled “${truncate(c?.title || '', 30)}” at ${fmtMinutes(start)}`);
}
/** Phones: the day's plan opens as a sheet over the day, and stays in step with changes. */
function openPlanSheet(key) {
  const holder = h('div', { class: 'plan-sheet' });
  const paint = () => holder.replaceChildren(sidePlan(key, { onChange: paint, scheduleOn: key }));
  paint();
  const off = store.on(() => repaintKeepingFocus(holder, paint));
  modal({ title: key === todayKey() ? 'Today’s plan' : `Plan · ${fmtShortDate(parseKey(key))}`, body: holder, className: 'sheet-modal', onClose: () => off() });
}

// Dropping a card on Today's plan puts it in Taskly's To do.
registerDrop('day-plan', ({ id, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  if (!(c.tool === 'taskly' && c.meta?.columnId === 'todo') && todoCards().length >= todoCapacity()) { toast('Taskly’s To do column is full.', { code: 'TASKLY_COLUMN_FULL' }); return false; }
  routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: 'todo', order: index ?? 0 }, log: 'Added to today’s plan' });
  reorder(todoCards(), id, index);
});

// ---------- Moving things on the day: see exactly where it will land ----------
let resizing = false, lastMoveEnd = 0, preview = null;
onDragStart(d => {
  if (d.kind !== 'card') return;
  const c = store.getCard(d.id);
  const dur = isSched(c) && c.meta.dur ? c.meta.dur : 60;
  const move = () => {
    const grid = document.querySelector('.day-grid');
    const ghost = grid?.querySelector('.slot-ghost');
    if (!grid || !ghost) return;
    const r = grid.getBoundingClientRect(), sr = grid.parentElement.getBoundingClientRect();
    const inside = d.x >= r.left && d.x <= r.right && d.y >= sr.top && d.y <= sr.bottom;
    if (!inside) { ghost.hidden = true; ghost.classList.remove('moving'); return; }
    const hourH = parseFloat(getComputedStyle(grid).getPropertyValue('--hour')) || 48;
    const start = clamp(Math.round((((d.y - d.gy - r.top) / hourH) * 60) / 15) * 15, 0, 24 * 60 - 15);
    ghost.hidden = false; ghost.classList.add('moving');
    ghost.style.top = (start / 60) * hourH + 'px';
    ghost.style.height = Math.max(13, (dur / 60) * hourH - 2) + 'px';
    ghost.querySelector('.slot-ghost-time').textContent = `${fmtMinutes(start)}–${fmtMinutes(start + dur)}`;
  };
  preview = { move };
  addEventListener('pointermove', move);
});
onDragEnd(() => {
  lastMoveEnd = Date.now();
  if (!preview) return;
  removeEventListener('pointermove', preview.move);
  preview = null;
  document.querySelectorAll('.day-grid .slot-ghost').forEach(g => { g.hidden = true; g.classList.remove('moving'); });
});

// Scheduling drop zones
const schedMeta = (c, patch) => {
  const base = isSched(c) ? { ...c.meta } : {};
  delete base.archivedAt;
  return { ...base, ...patch };
};
function placeSched(id, patch, label) {
  const c = store.getCard(id);
  if (!c) return false;
  if (patch.date && patch.date < todayKey()) { toast('Timely only looks forward. Pick today or later.', { code: 'TIMELY_PAST_DATE' }); return false; }
  if (c.tool !== 'timely') return routeCard(id, { tool: 'timely', type: 'event', meta: schedMeta(c, patch) });
  store.updateCard(id, { type: 'event', meta: schedMeta(c, patch) }, { replaceMeta: true, log: !!label, logLabel: label });
}
registerDrop('timely-day', ({ id, zone, y, gy, data }) => {
  const hourH = parseFloat(getComputedStyle(zone).getPropertyValue('--hour')) || 48;
  const top = y - gy - zone.getBoundingClientRect().top;
  const start = clamp(Math.round(((top / hourH) * 60) / 15) * 15, 0, 24 * 60 - 15);
  const c = store.getCard(id);
  const dur = isSched(c) && c.meta.dur ? c.meta.dur : 60;
  return placeSched(id, { date: data.date, start, dur, slot: null, kind: c?.meta?.kind === 'reminder' && isSched(c) ? 'reminder' : undefined }, 'Rescheduled');
});
registerDrop('timely-allday', ({ id, data }) => placeSched(id, { date: data.date, start: null, slot: null }, 'Rescheduled'));
registerDrop('timely-cell', {
  accepts: ({ data }) => data.date >= todayKey(),
  drop: ({ id, data }) => placeSched(id, { date: data.date, slot: data.slot, start: null }, 'Rescheduled'),
});
registerDrop('timely-month', {
  accepts: ({ data }) => data.date >= todayKey(),
  drop: ({ id, data }) => placeSched(id, { date: data.date }, 'Rescheduled'),
});
registerDrop('timely-reminders', ({ id }) => {
  const c = store.getCard(id);
  return placeSched(id, { kind: 'reminder', done: false, ...(isSched(c) ? {} : { date: null, start: null }) }, 'Made a reminder');
});

// ---------- Calm cells: dots and a count; the cards live in the zoom view ----------
const cellTitle = list => list.map(o => `${o.done ? '✓ ' : ''}${o.card.meta.start != null ? `${fmtMinutes(o.card.meta.start)} ` : ''}${o.card.title}`).join('\n');
function cellDots(list, { compact = false } = {}) {
  if (!list.length) return null;
  const MAX = compact ? 5 : 7;
  return h('div', { class: `cell-dots ${compact ? 'compact' : ''}` },
    compact ? null : h('b', { class: 'cell-n' }, list.length),
    h('span', { class: 'cd-row' },
      list.slice(0, MAX).map(o => paintCat(h('i', { class: `cd ${catClass(o.card)} it-${itemTypeOf(o.card)} ${isRoutine(o.card) ? 'is-r' : ''} ${o.done ? 'is-done' : ''}` }), o.card)),
      list.length > MAX ? h('em', {}, `+${list.length - MAX}`) : null));
}
/** Trips and conferences read as one thin bar across the days they cover. */
function spanBars(list, key) {
  return list.filter(o => o.card.meta.endDate).map(o => {
    const m = o.card.meta;
    return h('button', { class: `span-bar it-${itemTypeOf(o.card)} ${key === m.date ? 'span-start' : ''} ${key === m.endDate ? 'span-end' : ''}`, title: `${o.card.title} · ${fmtShortDate(parseKey(m.date))} – ${fmtShortDate(parseKey(m.endDate))}`, onclick: e => { e.stopPropagation(); openEventEditor(o.card.id); } },
      key === m.date || parseKey(key).getDay() === 1 ? h('span', {}, o.card.title) : null);
  });
}

// ---------- Weekly: a rolling week that starts today (SD-T13) ----------
const nowSlot = () => { const n = new Date(); return slotOfMinutes(n.getHours() * 60 + n.getMinutes()); };
const slotOf = c => c.meta.slot || (c.meta.start != null ? slotOfMinutes(c.meta.start) : null); // null = all day
/** Calm cells: routines fold into one "↻ 3 routines" pill, then at most `max` items and a count. */
function cellItems(list, key, { max = 2, showTime = true } = {}) {
  const routines = list.filter(o => isRoutine(o.card) && !ITEM_TYPES[o.card.meta.itemType]?.span);
  const rest = list.filter(o => !routines.includes(o));
  const out = [];
  if (routines.length >= 2) {
    const left = routines.filter(o => !o.done).length;
    out.push(h('span', { class: `routine-pill ${left ? '' : 'all-done'}`, title: routines.map(o => `${o.done ? '✓ ' : ''}${o.card.title}`).join('\n') }, icon('repeat'), `${routines.length} routines${left && left < routines.length ? ` · ${left} left` : !left ? ' · done' : ''}`));
  } else rest.unshift(...routines);
  rest.slice(0, max).forEach(o => out.push(chip(o.card, { showTime, date: key, done: o.done })));
  if (rest.length > max) out.push(h('span', { class: 'cell-more' }, `+${rest.length - max} more`));
  return out;
}
/** The add buttons sit on the left of their own row; a quiet hint sits on the right. */
function actionRow(buttons, hint) {
  return h('div', { class: 'action-row' }, h('div', { class: 'action-adds' }, buttons), hint ? h('span', { class: 'action-hint' }, hint) : null);
}
/** The same one-word add buttons in Daily and Weekly. */
function standardAdds(date, slot = null) {
  return [
    h('button', { class: 'add-btn add-routine', type: 'button', onclick: e => openItemForm(e.currentTarget, { type: 'task', date, slot, routine: true, title: 'New routine' }) }, h('span', { class: 'add-btn-ic' }, icon('repeat')), 'Routine'),
    ...['task', 'meeting', 'appointment', 'work', 'event'].map(t => addBtn(t, e => openItemForm(e.currentTarget, { type: t, date, slot }))),
  ];
}
const addBtn = (type, onClick) => h('button', { class: `add-btn add-${type}`, type: 'button', onclick: onClick }, h('span', { class: 'add-btn-ic' }, icon(ITEM_TYPES[type].icon)), ITEM_TYPES[type].label);
/** Touch screens: one row with the period's plan (as a sheet, where there's no room beside the calendar) and one
 *  "+ Add" that offers the same choices as the desktop's row of add buttons. */
function touchActions(adds, { planLabel, planCount = 0, openPlan = null } = {}) {
  const addBtnEl = h('button', { class: 'btn sm primary m-add-btn', type: 'button', onclick: () => {
    popover(addBtnEl, h('div', { class: 'add-menu' }, adds), { className: 'add-menu-pop' });
  } }, icon('plus'), 'Add');
  return h('div', { class: 'm-day-actions' },
    openPlan ? h('button', { class: 'chip m-plan-btn', type: 'button', onclick: openPlan }, icon('checklist'), planLabel, planCount ? h('small', {}, planCount) : null) : null,
    addBtnEl);
}
/** Redraw a sheet after a change, keeping the cursor in the field you were typing in. */
function repaintKeepingFocus(holder, paint) {
  if (!holder.isConnected) return;
  const a = document.activeElement, keep = holder.contains(a) ? a?.dataset?.keep : null;
  if (holder.contains(a) && !keep) return; // typing somewhere without a key: leave it alone
  const val = keep ? a.value : '';
  paint();
  if (keep) { const f = holder.querySelector(`[data-keep="${keep}"]`); if (f) { f.value = val; f.focus(); } }
}
function planSheet(title, make) {
  const holder = h('div', { class: 'plan-sheet' });
  const paint = () => holder.replaceChildren(make());
  paint();
  const off = store.on(() => repaintKeepingFocus(holder, paint));
  modal({ title, body: holder, className: 'sheet-modal', onClose: () => off() });
}
/** Phones: the week as a calm list of days, like a calendar app's list view. Tap + to add to a day, tap an item
 *  to open it, hold and drag an item onto another day to move it. The week's plan opens as a sheet. */
function renderWeekPhone() {
  const ws = parseKey(anchor());
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const label = days[0].getMonth() === days[6].getMonth() ? `${fmtShortDate(days[0])} – ${days[6].getDate()}` : `${fmtShortDate(days[0])} – ${fmtShortDate(days[6])}`;
  const today = todayKey();
  const head = navControl(label, n => dateKey(addDays(ws, 7 * n)), { sub: '' });
  const wk = weekPlanKey(ws), planN = periodCards('weekplan', wk).filter(c => !c.meta.done).length;
  const actions = h('div', { class: 'm-day-actions' },
    anchor() !== today ? h('button', { class: 'chip m-today-btn', type: 'button', onclick: () => { zoom = null; setAnchor(today); } }, 'Today') : null,
    h('button', { class: 'chip m-plan-btn', type: 'button', onclick: () => {
      const holder = h('div', { class: 'plan-sheet' });
      const paint = () => holder.replaceChildren(periodPlanPanel('weekplan', wk, 'This week’s plan', `Week of ${fmtShortDate(parseKey(wk))}`, { scheduleOn: dateKey(ws) < today ? today : dateKey(ws) }));
      paint();
      const off = store.on(() => repaintKeepingFocus(holder, paint));
      modal({ title: 'This week’s plan', body: holder, className: 'sheet-modal', onClose: () => off() });
    } }, icon('checklist'), 'Week plan', planN ? h('small', {}, planN) : null));
  const list = h('div', { class: 'agenda' }, days.map(d => {
    const k = dateKey(d);
    const occ = occurrencesOn(k);
    return h('section', { class: `ag-day ${k === today ? 'today' : ''}`, dataset: { drop: 'timely-month', accept: 'card', date: k }, 'data-list': '' },
      h('div', { class: 'ag-head' },
        h('span', { class: 'ag-name' }, k === today ? 'Today' : DAY_NAMES[d.getDay()]),
        h('span', { class: 'ag-date' }, `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`),
        h('span', { class: 'head-spacer' }),
        h('button', { class: 'icon-btn sm ag-add', type: 'button', 'aria-label': `Add to ${DAY_NAMES[d.getDay()]}`, onclick: e => openItemForm(e.currentTarget, { type: 'task', date: k, pickDate: false }) }, icon('plus'))),
      occ.length ? h('div', { class: 'ag-items' }, occ.map(o => chip(o.card, { showTime: true, date: k, done: o.done })))
        : h('p', { class: 'ag-empty' }, 'Nothing planned'));
  }));
  body.replaceChildren(h('div', { class: 'week-phone' }, head, actions, list));
}

function renderWeek() {
  if (listMode()) return renderWeekPhone();
  const ws = parseKey(anchor());
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const label = days[0].getMonth() === days[6].getMonth() ? `${fmtShortDate(days[0])} – ${days[6].getDate()}` : `${fmtShortDate(days[0])} – ${fmtShortDate(days[6])}`;
  const today = todayKey();
  const curSlot = nowSlot();
  const grid = h('div', { class: 'week-grid' });
  grid.append(h('div', { class: 'week-corner' }));
  for (const d of days) {
    const k = dateKey(d);
    grid.append(h('div', { class: `week-day-head ${k === today ? 'today' : ''}` },
      h('span', { class: 'wd-name' }, k === today ? 'Today' : DAY_NAMES[d.getDay()].slice(0, 3)), h('strong', { class: 'wd-num' }, d.getDate())));
  }
  const byDay = Object.fromEntries(days.map(d => [dateKey(d), occurrencesOn(dateKey(d))]));
  // All day: trips, conferences and untimed things, so the parts of the day stay clean.
  grid.append(h('div', { class: 'week-slot-label allday-label' }, h('span', {}, 'All day')));
  for (const d of days) {
    const k = dateKey(d);
    const items = byDay[k].filter(o => slotOf(o.card) === null);
    grid.append(h('div', { class: `week-cell week-allday ${k === today ? 'today' : ''}`, title: cellTitle(items), dataset: { drop: 'timely-cell', accept: 'card', date: k, slot: '' }, 'data-list': '' },
      spanBars(items, k), cellDots(items.filter(o => !o.card.meta.endDate), { compact: true })));
  }
  for (const slot of SLOTS) {
    const [a, b] = SLOT_HOURS[slot];
    grid.append(h('div', { class: `week-slot-label ${slot === curSlot && days.some(d => dateKey(d) === today) ? 'now' : ''}` },
      h('span', {}, SLOT_LABELS[slot]), h('small', {}, `${hourLabel(a)}–${hourLabel(b)}`)));
    for (const d of days) {
      const k = dateKey(d);
      const items = byDay[k].filter(o => slotOf(o.card) === slot);
      const isNow = k === today && slot === curSlot;
      const cell = h('div', {
        class: `week-cell ${k === today ? 'today' : ''} ${isNow ? 'now' : ''} ${items.length ? 'has-items' : ''}`, title: cellTitle(items) || `${DAY_NAMES[d.getDay()]} ${SLOT_LABELS[slot].toLowerCase()} · click to zoom in`,
        dataset: { drop: 'timely-cell', accept: 'card', date: k, slot }, 'data-list': '',
      }, isNow ? h('span', { class: 'now-badge' }, h('i'), 'Now') : null,
      cellDots(items));
      cell.append(
        h('button', { class: 'cell-zoom icon-btn xs', 'aria-label': `Zoom into ${DAY_NAMES[d.getDay()]} ${SLOT_LABELS[slot]}`, title: 'Zoom in', onclick: e => { e.stopPropagation(); openZoom('week', k, slot, cell); } }, icon('expand')),
        h('button', { class: 'cell-add icon-btn xs', 'aria-label': `Add to ${SLOT_LABELS[slot]}`, onclick: e => { e.stopPropagation(); openItemForm(e.currentTarget, { type: 'task', date: k, slot }); } }, icon('plus')));
      cell.addEventListener('click', e => { if (!e.target.closest('.t-chip, button')) openZoom('week', k, slot, cell); });
      grid.append(cell);
    }
  }
  const head = navControl(label, n => dateKey(addDays(ws, 7 * n)), { sub: `${MONTH_NAMES[days[0].getMonth()]} ${days[0].getFullYear()}` });
  const wk = weekPlanKey(ws);
  const layout = dayLayout();
  markTouch(layout);
  const makePlan = () => periodPlanPanel('weekplan', wk, 'This week’s plan', `Week of ${fmtShortDate(parseKey(wk))}`);
  if (layout !== 'desktop') head.append(touchActions(standardAdds(today), layout === 'compact'
    ? { planLabel: 'Week plan', planCount: periodCards('weekplan', wk).filter(c => !c.meta.done).length, openPlan: () => planSheet('This week’s plan', () => periodPlanPanel('weekplan', wk, 'This week’s plan', `Week of ${fmtShortDate(parseKey(wk))}`, { scheduleOn: dateKey(ws) < today ? today : dateKey(ws) })) } : {}));
  const host = h('div', { class: 'zoom-host week-main' }, head, grid);
  body.replaceChildren(...[
    layout === 'desktop' ? actionRow(standardAdds(today), 'Dots show what’s planned. Click a block to zoom in and see it all.') : null,
    h('div', { class: 'period-layout' }, host, layout === 'compact' ? null : makePlan())].filter(Boolean));
  if (zoom?.view === 'week') host.append(zoomPanel());
}
export const weekPlanKey = d => dateKey(startOfWeek(d instanceof Date ? d : parseKey(d)));
export const monthPlanKey = d => { const x = d instanceof Date ? d : parseKey(d); return `${x.getFullYear()}-${pad(x.getMonth() + 1)}`; };

// ---------- Monthly ----------
function renderMonth() {
  const a = parseKey(anchor());
  const first = new Date(a.getFullYear(), a.getMonth(), 1);
  const gridStart = startOfWeek(first);
  const today = todayKey();
  const grid = h('div', { class: 'month-grid' });
  for (const n of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) grid.append(h('div', { class: 'month-dow' }, n));
  const weeks = Math.ceil(((first.getDay() + 6) % 7 + new Date(a.getFullYear(), a.getMonth() + 1, 0).getDate()) / 7);
  grid.style.setProperty('--weeks', weeks);
  for (let i = 0; i < weeks * 7; i++) {
    const d = addDays(gridStart, i);
    const k = dateKey(d);
    const occ = k >= today ? occurrencesOn(k) : [];
    const inMonth = d.getMonth() === a.getMonth();
    const cell = h('div', {
      class: `month-cell ${inMonth ? '' : 'out'} ${k < today ? 'past' : ''} ${k === today ? 'today' : ''} ${occ.length ? 'has-items' : ''}`, role: 'button', tabindex: 0,
      title: k < today ? '' : (cellTitle(occ) || `${DAY_NAMES[d.getDay()]}, ${fmtShortDate(d)} · click to zoom in`),
      dataset: { drop: 'timely-month', accept: 'card', date: k },
    }, h('span', { class: 'month-num' }, d.getDate()),
    spanBars(occ, k),
    cellDots(occ.filter(o => !o.card.meta.endDate)));
    if (k >= today) {
      cell.addEventListener('click', () => openZoom('month', k, null, cell));
      cell.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === cell) openZoom('month', k, null, cell); });
    }
    grid.append(cell);
  }
  const label = `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
  const head = navControl(label, n => { const m = addMonths(a, n); return dateKey(m < new Date() && n < 0 ? new Date() : m); });
  const host = h('div', { class: 'zoom-host month-main' }, head, grid);
  const first0 = dateKey(a < parseKey(today) ? parseKey(today) : a);
  const adds = () => [
    addBtn('trip', e => openSpanForm(e.currentTarget, 'trip', first0)),
    addBtn('meeting', e => openItemForm(e.currentTarget, { type: 'meeting', date: first0 })),
    addBtn('conference', e => openSpanForm(e.currentTarget, 'conference', first0)),
    h('button', { class: 'add-btn add-task', type: 'button', onclick: e => openItemForm(e.currentTarget, { type: 'event', date: first0 }) }, h('span', { class: 'add-btn-ic' }, icon(ITEM_TYPES.event.icon)), ITEM_TYPES.event.label),
  ];
  const layout = dayLayout();
  markTouch(layout);
  const mk = monthPlanKey(a);
  const makePlan = () => periodPlanPanel('monthplan', mk, `${MONTH_NAMES[a.getMonth()]} plan`, 'Goals and to-dos for the month');
  if (layout !== 'desktop') (listMode() ? head.after.bind(head) : head.append.bind(head))(touchActions(adds(), layout === 'compact'
    ? { planLabel: 'Month plan', planCount: periodCards('monthplan', mk).filter(c => !c.meta.done).length, openPlan: () => planSheet(`${MONTH_NAMES[a.getMonth()]} plan`, () => periodPlanPanel('monthplan', mk, `${MONTH_NAMES[a.getMonth()]} plan`, 'Goals and to-dos for the month', { scheduleOn: first0 })) } : {}));
  body.replaceChildren(...[
    layout === 'desktop' ? actionRow(adds(), 'Dots show what’s planned. Click a day to zoom in.') : null,
    h('div', { class: 'period-layout' }, host, layout === 'compact' ? null : makePlan())].filter(Boolean));
  if (layout !== 'desktop' && !listMode()) requestAnimationFrame(() => fitBottom(grid, 360));
  if (zoom?.view === 'month') host.append(zoomPanel());
}

// ---------- Zoom: open a period of a weekday, or a whole day of the month, right in place ----------
function openZoom(v, date, slot, fromEl) {
  if (date < todayKey()) return;
  const host = fromEl?.closest('.zoom-host');
  let origin = '50% 50%';
  if (host && fromEl) {
    const hr = host.getBoundingClientRect(), cr = fromEl.getBoundingClientRect();
    origin = `${cr.left - hr.left + cr.width / 2}px ${cr.top - hr.top + cr.height / 2}px`;
  }
  zoom = { view: v, date, slot, anim: true, origin };
  render();
}
function closeZoom() {
  const panel = body.querySelector('.zoom-panel');
  if (!panel) { zoom = null; return render(); }
  panel.classList.add('closing');
  setTimeout(() => { zoom = null; render(); }, 180);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && zoom && !document.querySelector('.modal-backdrop, .popover') && root?.isConnected) closeZoom(); });
function zoomHours() {
  if (zoom.view === 'month') return [...Array(18)].map((_, i) => i + 6); // 6am–11pm
  const [a, b] = SLOT_HOURS[zoom.slot];
  return [...Array(b - a)].map((_, i) => (a + i) % 24);
}
function zoomPanel() {
  const { date, slot, view: v } = zoom;
  const all = occurrencesOn(date);
  const inScope = o => (v === 'month' ? true : slotOf(o.card) === slot);
  const occ = all.filter(inScope);
  const hours = zoomHours();
  const untimed = occ.filter(o => o.card.meta.start == null);
  const timed = occ.filter(o => o.card.meta.start != null);
  const outside = v === 'month' ? timed.filter(o => !hours.includes(Math.floor(o.card.meta.start / 60))) : [];
  const nowM = new Date().getHours() * 60 + new Date().getMinutes();
  const isToday = date === todayKey();
  const addRowFor = (meta, placeholder) => {
    const input = h('input', { class: 'zoom-input', placeholder, 'aria-label': placeholder, 'data-keep': `zoom-${date}-${meta.start ?? 'any'}` });
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && input.value.trim()) {
        store.createCard({ type: 'event', tool: 'timely', title: input.value.trim(), meta: { date, itemType: 'task', ...meta } });
        input.value = '';
      }
      if (e.key === 'Escape') { e.stopPropagation(); input.blur(); }
    });
    return withMic(input, { label: 'Dictate it' });
  };
  const hourRow = hr => {
    const items = timed.filter(o => Math.floor(o.card.meta.start / 60) % 24 === hr);
    const past = isToday && (hr + 1) * 60 <= nowM && hr >= 5;
    const current = isToday && Math.floor(nowM / 60) === hr;
    const row = h('div', { class: `zoom-hour ${past ? 'past' : ''} ${current ? 'current' : ''}`, dataset: { drop: 'timely-hour', accept: 'card', date, start: hr * 60 } },
      h('span', { class: 'zh-time' }, hourLabel(hr)),
      h('div', { class: 'zh-items' }, items.map(o => chip(o.card, { showTime: true, date, done: o.done }))),
      h('button', { class: 'zh-add', type: 'button', 'aria-label': `Add at ${hourLabel(hr)}`, onclick: e => {
        e.stopPropagation();
        const slotEl = row.querySelector('.zh-items');
        if (slotEl.querySelector('.zoom-input')) return slotEl.querySelector('.zoom-input').focus();
        const field = addRowFor({ start: hr * 60, dur: 60, slot: null }, `What’s at ${hourLabel(hr)}?`);
        slotEl.append(field);
        field.querySelector('input').focus();
      } }, icon('plus'), h('span', {}, 'Add')));
    if (current) row.append(h('span', { class: 'zh-now', style: { top: `${((nowM % 60) / 60) * 100}%` } }));
    return row;
  };
  const title = v === 'month' ? dayName(date).replace('Today · ', 'Today, ') : `${dayName(date).replace('Today · ', 'Today, ')}`;
  const sub = v === 'month' ? `${occ.length ? `${occ.length} planned` : 'Nothing planned yet'}` : `${SLOT_LABELS[slot]} · ${hourLabel(SLOT_HOURS[slot][0])}–${hourLabel(SLOT_HOURS[slot][1])}`;
  const panel = h('section', { class: `zoom-panel ${zoom.anim ? 'opening' : ''}`, style: { transformOrigin: zoom.origin }, role: 'dialog', 'aria-label': `${title}, ${sub}` },
    h('header', { class: 'zoom-head' },
      h('button', { class: 'zoom-back', type: 'button', onclick: closeZoom }, icon('chevL'), v === 'month' ? 'Month' : 'Week'),
      h('div', { class: 'zoom-title' }, h('strong', {}, title), h('span', {}, sub)),
      v === 'week' ? h('div', { class: 'zoom-slots', role: 'tablist' }, SLOTS.map(sl => h('button', { class: `zs ${sl === slot ? 'on' : ''}`, role: 'tab', 'aria-selected': String(sl === slot), onclick: () => { zoom = { ...zoom, slot: sl, anim: false }; render(); } }, SLOT_LABELS[sl]))) : null,
      h('button', { class: 'icon-btn sm', 'aria-label': 'Close', onclick: closeZoom }, icon('x'))),
    h('div', { class: 'zoom-body' },
      h('div', { class: 'zoom-any', dataset: { drop: 'timely-cell', accept: 'card', date, slot: v === 'week' ? slot : '' } },
        h('span', { class: 'zh-time' }, v === 'week' ? 'Any time' : 'All day'),
        h('div', { class: 'zh-items' }, untimed.map(o => chip(o.card, { date, done: o.done })), addRowFor(v === 'week' ? { slot, start: null } : { start: null, slot: null }, v === 'week' ? `Something for this ${SLOT_LABELS[slot].toLowerCase()}…` : 'Something for this day…'))),
      outside.length ? h('div', { class: 'zoom-any' }, h('span', { class: 'zh-time' }, 'Outside'), h('div', { class: 'zh-items' }, outside.map(o => chip(o.card, { showTime: true, date, done: o.done })))) : null,
      h('div', { class: 'zoom-hours' }, hours.map(hourRow))));
  if (zoom.anim) { zoom.anim = false; }
  requestAnimationFrame(() => panel.querySelector('.zoom-hour.current')?.scrollIntoView({ block: 'center' }));
  return panel;
}
registerDrop('timely-hour', {
  accepts: ({ data }) => data.date >= todayKey(),
  drop: ({ id, data }) => { const c = store.getCard(id); return placeSched(id, { date: data.date, start: +data.start, dur: isSched(c) && c.meta.dur ? c.meta.dur : 60, slot: null }, 'Rescheduled'); },
});

// ---------- Weekly and monthly plans (separate from Taskly; only Today's plan is Taskly's To do) ----------
const periodCards = (kind, key) => store.cardsWhere(c => c.tool === 'timely' && c.meta?.board === kind && c.meta.planKey === key).sort(byOrder);
function periodPlanPanel(kind, key, heading, sub, { scheduleOn = null } = {}) {
  const list = periodCards(kind, key);
  const done = list.filter(c => c.meta.done).length;
  const input = h('input', { class: 'field-input sm', placeholder: kind === 'weekplan' ? 'Add to this week, then Enter' : 'Add to this month, then Enter', 'aria-label': heading, 'data-keep': `pp-${kind}-${key}` });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    store.createCard({ type: 'task', tool: 'timely', title: input.value.trim(), meta: { board: kind, planKey: key, order: list.length, done: false } });
    input.value = '';
  });
  const items = list.map(c => {
    const el = h('div', { class: `plan-item ${c.meta.done ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id } },
      h('button', { class: `plan-check ${c.meta.done ? 'on' : ''}`, 'aria-label': c.meta.done ? `Mark “${c.title}” not done` : `Complete “${c.title}”`, onclick: e => {
        e.stopPropagation();
        const btn = e.currentTarget, was = !!c.meta.done;
        btn.classList.toggle('on', !was); el.classList.toggle('is-done', !was);
        if (!was) celebrate(btn);
        setTimeout(() => store.updateCard(c.id, { meta: { done: !was } }, { log: !was, logLabel: 'Completed' }), was ? 0 : 450);
      } }, icon('check')),
      h('div', { class: 'plan-main' }, h('span', { class: 'plan-text', title: c.title, dataset: { fit: c.title } }, c.title), notesSnippet(c)),
      // Phones can't drag from a sheet onto the day, so a tap gives it the next free time instead.
      scheduleOn && !c.meta.done ? h('button', { class: 'icon-btn xs', type: 'button', title: 'Give it a time that day', 'aria-label': `Schedule “${c.title}”`, onclick: e => { e.stopPropagation(); scheduleAt(c.id, scheduleOn); } }, icon('clock')) : null);
    el.addEventListener('dblclick', () => openEditor(c.id, { title: 'Plan item' }));
    return cardChrome(el, c, () => openEditor(c.id, { title: 'Plan item' }), { compact: true });
  });
  return h('aside', { class: `day-plan period-plan plan-${kind}`, dataset: { drop: 'period-plan', accept: 'card', kind, key }, 'data-list': '' },
    h('div', { class: 'day-plan-head' },
      h('div', { class: 'pp-title' }, h('h3', {}, heading), h('span', { class: 'pp-sub' }, sub)),
      list.length ? h('span', { class: 'pp-count', title: `${done} of ${list.length} done` }, `${done}/${list.length}`) : null),
    list.length ? h('div', { class: 'pp-progress' }, h('span', { style: { width: `${Math.round((done / list.length) * 100)}%` } })) : null,
    h('div', { class: 'day-plan-list' }, items),
    withMic(input, { label: 'Dictate a plan item' }),
    h('p', { class: 'muted small' }, scheduleOn ? (list.length ? 'Tap the clock on an item to give it a time.' : kind === 'weekplan' ? 'What should this week include? Add a few things, then give each a time.' : 'Big things for the month. Give them a date when you’re ready.')
      : list.length ? `Drag an item onto a ${kind === 'weekplan' ? 'day' : 'date'} to schedule it.` : kind === 'weekplan' ? 'What should this week include? Add a few things, then drag them onto days.' : 'Big things for the month. Drag them onto dates when you’re ready.'));
}
const PLAN_STRIP = ['date', 'start', 'dur', 'slot', 'kind', 'recurrence', 'archivedAt', 'containerId', 'doneDates', 'itemType', 'columnId', 'completedAt', 'reviewUntil'];
registerDrop('period-plan', ({ id, index, data }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const meta = { board: data.kind, planKey: data.key, order: index ?? periodCards(data.kind, data.key).length, done: false };
  if (c.tool === 'timely') {
    const m = { ...c.meta }; PLAN_STRIP.forEach(k => delete m[k]);
    store.updateCard(id, { type: 'task', meta: { ...m, ...meta } }, { replaceMeta: true, log: true, logLabel: 'Added to plan' });
  } else routeCard(id, { tool: 'timely', type: 'task', meta, log: 'Added to plan' });
  reorder(periodCards(data.kind, data.key), id, index);
});

/** Small time editor for the monthly view. */
function openTimePopover(anchorEl, id) {
  const c = store.getCard(id);
  if (!c) return;
  const m = c.meta || {};
  const time = h('input', { class: 'field-input sm', type: 'time', value: m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '', 'aria-label': 'Time' });
  const date = daySelect(m.date && m.date >= todayKey() ? m.date : todayKey());
  const durs = [15, 30, 45, 60, 90, 120, 180];
  const dur = h('select', { class: 'field-input sm', 'aria-label': 'Length' }, durs.map(v => h('option', { value: v, selected: (m.dur || 60) === v }, v < 60 ? `${v} min` : `${v / 60} hr`)));
  const save = () => {
    const [hh, mm] = time.value.split(':').map(Number);
    const start = time.value ? hh * 60 + mm : null;
    store.updateCard(id, { meta: { start, dur: start != null ? +dur.value : m.dur, slot: start != null ? null : m.slot || null, ...(isRoutine(c) ? {} : { date: date.value || m.date }) } }, { log: true, logLabel: 'Rescheduled' });
    closePopovers();
  };
  popover(anchorEl, h('div', { class: 'time-pop' },
    h('strong', {}, c.title),
    h('div', { class: 'time-pop-row' }, field('Time', time), field('Length', dur)),
    isRoutine(c) ? h('p', { class: 'muted small' }, 'Changing a routine’s time changes it from today on.') : field('Date', date),
    h('div', { class: 'time-pop-actions' },
      h('button', { class: 'chip ghost', onclick: () => { closePopovers(); openEventEditor(id); } }, 'More details'),
      h('button', { class: 'btn sm primary', onclick: save }, 'Save'))));
  setTimeout(() => time.focus(), 40);
}

// ---------- New items and routines ----------
function timeFields(start = null) {
  const time = h('input', { class: 'field-input sm', type: 'time', value: start != null ? `${pad(Math.floor(start / 60))}:${pad(start % 60)}` : '', 'aria-label': 'Time' });
  const dur = h('select', { class: 'field-input sm', 'aria-label': 'Length' }, [15, 30, 45, 60, 90, 120, 180].map(v => h('option', { value: v, selected: v === 60 }, v < 60 ? `${v} min` : `${v / 60} hr`)));
  const read = () => { const [hh, mm] = time.value.split(':').map(Number); return time.value ? hh * 60 + mm : null; };
  return { time, dur, read };
}
/** Trips and conferences cover several days. */
function openSpanForm(anchorEl, type, date = todayKey()) {
  const t = ITEM_TYPES[type];
  const title = h('input', { class: 'field-input sm', placeholder: type === 'trip' ? 'Lisbon' : 'Design Week 2026', 'aria-label': 'Name' });
  const from = daySelect(date);
  const to = daySelect(dateKey(addDays(parseKey(date), type === 'trip' ? 3 : 1)));
  const where = h('input', { class: 'field-input sm', placeholder: type === 'trip' ? 'Hotel, flight number… (optional)' : 'Venue, badge pickup… (optional)', 'aria-label': 'Details' });
  const save = () => {
    let a = from.value, b = to.value;
    if (b < a) [a, b] = [b, a];
    store.createCard({ type: 'event', tool: 'timely', title: title.value.trim() || t.label, description: where.value.trim(),
      meta: { date: a, endDate: b > a ? b : null, start: null, slot: null, itemType: type } });
    closePopovers();
    toast(`${t.label} added: ${fmtShortDate(parseKey(a))}${b > a ? ` – ${fmtShortDate(parseKey(b))}` : ''}`);
  };
  [title, where].forEach(x => x.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') save(); }));
  popover(anchorEl, h('div', { class: 'form-pop' },
    h('strong', { class: 'form-pop-title' }, h('span', { class: `add-btn-ic add-${type}` }, icon(t.icon)), `New ${t.label.toLowerCase()}`),
    field('Name', title),
    h('div', { class: 'time-pop-row' }, field('From', from), field('To', to)),
    field('Details', where),
    h('button', { class: 'btn sm primary', onclick: save }, `Add ${t.label.toLowerCase()}`)));
  setTimeout(() => title.focus(), 40);
}
/** A day picker that reads like a person would say it: “Tuesday, Oct 13”. Next 60 days, plus any date. */
function daySelect(value) {
  const t = parseKey(todayKey());
  const keys = [...Array(60)].map((_, i) => dateKey(addDays(t, i)));
  if (value && !keys.includes(value)) keys.push(value);
  const sel = h('select', { class: 'field-input sm day-select', 'aria-label': 'Day' },
    keys.map(k => h('option', { value: k, selected: k === value }, k === todayKey() ? `Today, ${fmtShortDate(parseKey(k))}` : dayName(k))),
    h('option', { value: '__pick' }, 'Another date…'));
  const picker = h('input', { type: 'date', class: 'day-select-native', min: todayKey(), tabindex: -1, 'aria-hidden': 'true' });
  let last = value;
  sel.addEventListener('change', () => {
    if (sel.value !== '__pick') { last = sel.value; return; }
    sel.value = last;
    try { picker.showPicker(); } catch { picker.focus(); }
  });
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    if (![...sel.options].some(o => o.value === picker.value)) sel.insertBefore(h('option', { value: picker.value }, dayName(picker.value)), sel.lastChild);
    sel.value = last = picker.value;
  });
  const wrap = h('span', { class: 'day-select-wrap' }, sel, picker);
  Object.defineProperty(wrap, 'value', { get: () => sel.value });
  return wrap;
}
/** SD-T14 / SD-T17: a one-off Task, Meeting, Appointment or Work session, with an optional exact time. */
function openItemForm(anchorEl, { type = 'task', date = todayKey(), slot = null, start: startAt = null, pickDate = true, title: heading, routine = false } = {}) {
  const typeSel = h('select', { class: 'field-input sm', 'aria-label': 'Type' }, Object.entries(ITEM_TYPES).filter(([, t]) => !t.span).map(([v, t]) => h('option', { value: v, selected: v === type }, t.label)));
  const title = h('input', { class: 'field-input sm', placeholder: routine ? 'Morning stretch' : { task: 'Pick up the dry cleaning', meeting: 'Sync with Sam', appointment: 'Dentist', work: 'Budget draft' }[type], 'aria-label': 'Title' });
  const dateIn = daySelect(date);
  const dayText = h('span', {}, dayName(date));
  const dayHead = h('span', { class: 'form-pop-day' }, icon('calendar'), dayText, slot ? h('span', { class: 'muted' }, ` · ${SLOT_LABELS[slot]}`) : startAt != null ? h('span', { class: 'muted' }, ` · ${fmtMinutes(startAt)}`) : null);
  dateIn.querySelector('select').addEventListener('change', () => { if (dateIn.value !== '__pick') dayText.textContent = dayName(dateIn.value); });
  const { time, dur, read } = timeFields(startAt);
  // The part of the day follows the time you picked (3:30pm → Afternoon), so the two never disagree.
  const slotFor = mins => (mins == null ? null : slotOfMinutes(mins));
  const slotSel = h('select', { class: 'field-input sm', 'aria-label': 'Part of day' }, SLOTS.map(s => h('option', { value: s, selected: s === (slot || slotFor(startAt) || 'morning') }, SLOT_LABELS[s])));
  const sync = () => { slotSel.disabled = !!time.value; dur.disabled = !time.value; };
  time.addEventListener('input', sync); sync();
  // Routines: how often, from the same choices as everywhere else.
  const recSel = routine ? h('select', { class: 'field-input sm', 'aria-label': 'Repeat' }, Object.entries(RECUR).filter(([v]) => v && v !== 'custom').map(([v, l]) => h('option', { value: v, selected: v === 'daily' }, l.replace(/ \(.*\)/, '')))) : null;
  if (routine) { time.value = '07:00'; sync(); }
  const save = () => {
    const start = read();
    store.createCard({ type: 'event', tool: 'timely', title: title.value.trim() || (routine ? 'Routine' : ITEM_TYPES[typeSel.value].label),
      meta: { date: dateIn.value || date, itemType: typeSel.value, start, dur: start != null ? +dur.value : undefined, slot: start != null ? null : slotSel.value,
        ...(routine ? { recurrence: recSel.value, doneDates: [] } : {}) } });
    closePopovers();
    if (routine) toast(`Routine added. It repeats ${recurLabel({ recurrence: recSel.value }).toLowerCase()}.`);
  };
  title.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  popover(anchorEl, h('div', { class: 'form-pop' },
    h('strong', {}, heading || `New ${ITEM_TYPES[type].label.toLowerCase()}`),
    dayHead,
    field('What', title), routine ? field('Repeats', recSel) : field('Type', typeSel),
    pickDate ? field(routine ? 'Starting' : 'Day', dateIn) : null,
    h('div', { class: 'time-pop-row' }, field('Time (optional)', time), field('Length', dur)),
    field('Otherwise, part of the day', slotSel),
    h('div', { class: 'form-pop-actions' },
      h('button', { class: 'btn sm ghost', type: 'button', onclick: () => closePopovers() }, 'Cancel'),
      h('button', { class: 'btn sm primary', onclick: save }, 'Add'))));
  setTimeout(() => title.focus(), 40);
}
// ---------- Reminders: a cork board of sticky notes (SD-T19/T20/T21) ----------
const STICKY = ['#fff3a3', '#ffd7c2', '#d6f0b8', '#c9e8fb', '#e7d6f7'];
let remDraft = { when: null, label: '' };
let justPinned = null, refocusPad = false;
function quickWhen(kind, hours) {
  const n = new Date();
  const at = (d, hh, mm = 0) => ({ date: dateKey(d), start: hh * 60 + mm });
  switch (kind) {
    case '1h': { const t = new Date(n.getTime() + 36e5); return { ...at(t, t.getHours(), Math.round(t.getMinutes() / 5) * 5 % 60), label: 'In 1 hour' }; }
    case 'tonight': return { ...at(n.getHours() >= 20 ? addDays(n, 1) : n, 20), label: n.getHours() >= 20 ? 'Tomorrow 8pm' : 'Tonight 8pm' };
    case 'morning': return { ...at(addDays(n, 1), 9), label: 'Tomorrow 9am' };
    case 'weekend': { const d = addDays(n, ((6 - n.getDay() + 7) % 7) || 7); return { ...at(d, 10), label: `Saturday 10am` }; }
    case 'slider': { const t = new Date(n.getTime() + hours * 36e5); return { ...at(t, t.getHours(), 0), label: hours < 24 ? `In ${hours} hour${hours === 1 ? '' : 's'}` : `In ${Math.round(hours / 24 * 10) / 10} days` }; }
    default: return null;
  }
}
function renderReminders() {
  const rem = store.cardsWhere(c => live(c) && c.meta.kind === 'reminder' && !c.meta.done);
  const nowMs = Date.now();
  const due = c => (c.meta.date ? parseKey(c.meta.date).getTime() + (c.meta.start ?? 23 * 60 + 59) * 60e3 : Infinity);
  rem.sort((a, b) => due(a) - due(b) || byOrder(a, b));
  // Lanes so the board reads at a glance: what's late, what's today, what's coming, what repeats.
  const t0 = parseKey(todayKey()).getTime(), DAY = 864e5;
  const laneOf = c => {
    if (isRoutine(c)) return 'routines';
    if (!c.meta.date) return 'someday';
    const d = due(c);
    if (d < nowMs) return 'overdue';
    if (d < t0 + DAY) return 'today';
    if (d < t0 + 2 * DAY) return 'tomorrow';
    if (d < t0 + 7 * DAY) return 'week';
    return 'later';
  };
  const LANES = [['overdue', 'Overdue'], ['today', 'Today'], ['tomorrow', 'Tomorrow'], ['week', 'This week'], ['later', 'Later'], ['someday', 'No date'], ['routines', 'Routines']];
  const lanes = Object.fromEntries(LANES.map(([k]) => [k, []]));
  rem.forEach(c => lanes[laneOf(c)].push(c));

  const prevScroll = body.querySelector('.cork')?.scrollTop || 0;
  const board = h('div', { class: 'cork', dataset: { drop: 'timely-reminders', accept: 'card' } }, composerSticky());
  for (const [k, label] of LANES) {
    if (!lanes[k].length) continue;
    board.append(h('section', { class: `lane lane-${k}` },
      h('h3', { class: 'lane-tag' }, label, h('span', { class: 'lane-n' }, lanes[k].length)),
      h('div', { class: 'lane-notes' }, lanes[k].map(c => stickyEl(c, k === 'overdue')))));
  }
  if (!rem.length) board.append(h('p', { class: 'cork-empty' }, 'Nothing pinned yet. Write one on the blank note, or drop any card here.'));
  const overdueN = lanes.overdue.length;
  const unsent = rem.filter(c => c.meta.date && !c.meta.sentToApple && !isRoutine(c));
  const head = h('div', { class: 'cal-head' }, h('div', { class: 'cal-title' }, h('h2', {}, 'Reminders'),
    h('span', { class: 'cal-sub' }, `${rem.length} open${overdueN ? ` · ${overdueN} overdue` : ''}`)),
    onApple() && unsent.length ? h('button', { class: 'chip ghost apple-send', type: 'button', title: 'Add these to Apple Reminders, with alerts, in one go', onclick: () => sendToReminders(unsent) }, icon('bell'), `Send ${unsent.length} to Apple Reminders`) : null);
  body.replaceChildren(h('div', { class: 'reminders' }, head, board));
  board.scrollTop = prevScroll;
  if (justPinned) {
    const el = board.querySelector(`.sticky[data-id="${justPinned}"]`);
    justPinned = null;
    if (el) {
      el.classList.add('pin-drop');
      el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      setTimeout(() => tick(), 260);
      setTimeout(() => el.classList.remove('pin-drop'), 900);
    }
  }
}

function stickyEl(c, overdue) {
  const m = c.meta;
  const when = isRoutine(c) ? `${recurLabel(m)}${m.start != null ? ` · ${fmtMinutes(m.start)}` : ''}`
    : m.date ? `${m.date === todayKey() ? 'Today' : fmtShortDate(parseKey(m.date))}${m.start != null ? ` · ${fmtMinutes(m.start)}` : ''}` : 'No date';
  const hsh = hashStr(c.id);
  const doneToday = isRoutine(c) && m.doneDates?.includes(todayKey());
  const el = h('div', {
    class: `sticky ${overdue ? 'overdue' : ''} ${doneToday ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id },
    style: { '--sticky': STICKY[hsh % STICKY.length], '--tilt': `${((hsh >> 3) % 5) - 2}deg` },
  },
  h('span', { class: 'sticky-pin', 'aria-hidden': 'true' }),
  h('span', { class: 'sticky-title' }, c.title),
  notesSnippet(c),
  h('span', { class: 'sticky-when' }, icon(isRoutine(c) ? 'repeat' : 'clock'), overdue ? `Overdue · ${when}` : when),
  h('div', { class: 'sticky-actions' },
    h('button', { class: 'sticky-btn', 'aria-label': 'Done', title: isRoutine(c) ? 'Done for today (the routine stays)' : 'Done', onclick: e => {
      e.stopPropagation();
      if (isRoutine(c)) return toggleRoutineDay(c.id, todayKey());
      tick(); el.classList.add('sticky-done-out');
      setTimeout(() => { store.updateCard(c.id, { meta: { done: true } }, { log: true, logLabel: 'Completed' }); runMaintenance(); }, 300);
    } }, icon('check'), 'Done'),
    h('button', { class: 'sticky-btn', 'aria-label': 'Send to Apple Reminders', title: 'Send to Apple Reminders', onclick: e => { e.stopPropagation(); sendToReminders(store.getCard(c.id)); } }, icon('bell'))));
  cardChrome(el, c, () => openEventEditor(c.id), { actions: quickActions(c) });
  return el;
}

/** The first note on the board is a blank pad: write, pick when (or say it), pin. */
function composerSticky() {
  const input = h('textarea', { class: 'pad-input', rows: 2, placeholder: 'Remind me to…', 'aria-label': 'New reminder', 'data-keep': 'rem-input' });
  const whenLabel = h('span', { class: 'pad-when' }, remDraft.when ? remDraft.when.label : 'No time');
  const dateIn = h('input', { class: 'pad-date', type: 'date', min: todayKey(), 'aria-label': 'Date' });
  const timeIn = h('input', { class: 'pad-date', type: 'time', 'aria-label': 'Time' });
  const custom = h('div', { class: 'pad-custom', hidden: true },
    h('label', { class: 'pad-field' }, h('span', {}, 'Day'), dateIn), h('label', { class: 'pad-field' }, h('span', {}, 'Time'), timeIn));
  const setWhen = w => { remDraft.when = w; whenLabel.textContent = w ? w.label : 'No time'; chips.querySelectorAll('.pad-chip').forEach(c => c.classList.toggle('on', c.dataset.k === w?.k)); };
  const syncCustom = () => {
    if (!dateIn.value) return;
    const [hh, mm] = (timeIn.value || '').split(':').map(Number);
    const start = timeIn.value ? hh * 60 + mm : null;
    setWhen({ date: dateIn.value, start, k: 'custom', label: `${dateIn.value === todayKey() ? 'Today' : fmtShortDate(parseKey(dateIn.value))}${start != null ? ` · ${fmtMinutes(start)}` : ''}` });
  };
  dateIn.addEventListener('change', syncCustom); timeIn.addEventListener('change', syncCustom);
  const toggleOff = k => remDraft.when?.k === k;
  const chips = h('div', { class: 'pad-chips' },
    [['1h', 'In 1 hour'], ['tonight', 'Tonight'], ['morning', 'Tomorrow 9am'], ['weekend', 'Saturday']].map(([k, l]) =>
      h('button', { class: `pad-chip ${remDraft.when?.k === k ? 'on' : ''}`, type: 'button', dataset: { k }, onclick: () => { custom.hidden = true; setWhen(toggleOff(k) ? null : { ...quickWhen(k), k }); } }, l)),
    h('button', { class: `pad-chip pad-chip-date ${remDraft.when?.k === 'custom' ? 'on' : ''}`, type: 'button', dataset: { k: 'custom' }, 'aria-expanded': 'false', onclick: e => {
      custom.hidden = !custom.hidden; e.currentTarget.setAttribute('aria-expanded', String(!custom.hidden));
      if (!custom.hidden) { dateIn.value ||= todayKey(); try { dateIn.showPicker(); } catch { dateIn.focus(); } }
    } }, icon('calendar'), 'Date & time'));
  const add = () => {
    const title = input.value.trim();
    if (!title) { pad.classList.remove('nudge'); void pad.offsetWidth; pad.classList.add('nudge'); input.focus(); return; }
    const w = remDraft.when;
    const card = store.createCard({ type: 'event', tool: 'timely', title, meta: { kind: 'reminder', date: w?.date || null, start: w?.start ?? null } }, { silent: true });
    input.value = ''; remDraft = { when: null };
    justPinned = card.id; refocusPad = true;
    pad.classList.add('pinning');
    setTimeout(() => store.notify({ reason: 'pin' }), 140);
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); add(); } });
  // Voice: "call mom tomorrow at 9am" → the title and the time are pulled out for you.
  const heard = h('span', { class: 'pad-heard' });
  let session = null;
  const mic = h('button', { class: 'pad-mic', type: 'button', 'aria-label': 'Say the reminder', disabled: !canListen, title: canListen ? 'Say it, e.g. “call mom tomorrow at 9am”' : 'Voice input isn’t supported in this browser',
    onclick: () => {
      if (session) { session.stop(); return; }
      mic.classList.add('on'); heard.textContent = 'Listening…';
      session = listen({
        continuous: false,
        onInterim: t => { if (t) heard.textContent = t; },
        onFinal: t => {
          if (!t) return;
          const { when, rest } = extractWhen(t.replace(/^remind me (?:to |about )?/i, ''));
          input.value = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : t;
          if (when?.date) setWhen({ date: when.date, start: when.start ?? (when.slot ? { morning: 540, noon: 720, afternoon: 900, evening: 1140, night: 1260 }[when.slot] : null), label: `${when.date === todayKey() ? 'Today' : fmtShortDate(parseKey(when.date))}${when.start != null ? ` · ${fmtMinutes(when.start)}` : ''}`, k: 'voice' });
          heard.textContent = 'Got it. Press Pin or Enter.';
        },
        onError: msg => { heard.textContent = msg; },
        onEnd: () => { session = null; mic.classList.remove('on'); },
      });
    } }, icon('mic'));
  const pad = h('div', { class: 'sticky composer' },
    h('span', { class: 'sticky-pin', 'aria-hidden': 'true' }),
    h('span', { class: 'pad-label' }, 'New reminder'),
    input,
    h('span', { class: 'pad-sub' }, 'When?'),
    chips, custom,
    h('div', { class: 'pad-foot' }, icon('clock'), whenLabel, heard, h('span', { class: 'head-spacer' }), mic, h('button', { class: 'pad-pin', type: 'button', 'aria-label': 'Pin', onclick: add }, icon('pin'), 'Pin it')));
  if (refocusPad) { refocusPad = false; setTimeout(() => input.focus(), 30); }
  return pad;
}

function quickAdd(meta) {
  const card = store.createCard({ type: 'event', tool: 'timely', title: 'New item', meta: { itemType: 'task', ...meta } });
  setTimeout(() => {
    const t = body.querySelector(`[data-id="${card.id}"] .t-chip-title`);
    if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
  }, 60);
}

// ---------- Event editor: time, type, routine, export ----------
export function openEventEditor(id) {
  const c = store.getCard(id);
  if (!c) return;
  let f = {};
  const isRem = c.meta?.kind === 'reminder';
  openEditor(id, {
    title: isRem ? 'Reminder' : isRoutine(c) ? 'Routine' : 'Scheduled item',
    extra: card => {
      const m = card.meta || {};
      // A routine's date is when the series starts; it isn't today's date, so it's labelled that way and can be in the past.
      f.date = h('input', { class: 'field-input', type: 'date', ...(m.recurrence ? {} : { min: todayKey() }), value: m.date || '' });
      f.end = h('input', { class: 'field-input', type: 'date', min: m.date || todayKey(), value: m.endDate || '', 'aria-label': 'Until' });
      f.time = h('input', { class: 'field-input', type: 'time', value: m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '' });
      const durs = [...new Set([15, 30, 45, 60, 90, 120, 180, m.dur || 60])].sort((a, b) => a - b);
      const durLabel = v => (v < 60 ? `${v} min` : v % 60 ? `${Math.floor(v / 60)} hr ${v % 60} min` : `${v / 60} hr`);
      f.dur = h('select', { class: 'field-input' }, durs.map(v => h('option', { value: v, selected: (m.dur || 60) === v }, durLabel(v))));
      f.slot = h('select', { class: 'field-input' }, h('option', { value: '' }, 'Any time'), SLOTS.map(s => h('option', { value: s, selected: m.slot === s }, SLOT_LABELS[s])));
      f.rec = h('select', { class: 'field-input' }, Object.entries(RECUR).map(([v, l]) => h('option', { value: v, selected: (m.recurrence || '') === v }, l)));
      f.custom = customRepeatFields(m.recurrence === 'custom' ? m.repeat : {}, m.date || todayKey());
      f.custom.el.hidden = f.rec.value !== 'custom';
      f.rec.addEventListener('change', () => { f.custom.el.hidden = f.rec.value !== 'custom'; });
      // Type: one tap to switch what it is. Spans (trips, conferences) need an end date, so they're offered only when it has one.
      let typeVal = m.itemType || 'task';
      // Every type is open to every item, whichever view it was made in. Trips and conferences add an end date.
      const typeOpts = Object.entries(ITEM_TYPES);
      f.type = isRem ? null : { get value() { return typeVal; } };
      const typeRow = isRem ? null : h('div', { class: 'type-pick', role: 'radiogroup', 'aria-label': 'Type' }, typeOpts.map(([v, t]) => {
        const b = h('button', { class: `type-opt it-${v} ${v === typeVal ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(v === typeVal),
          onclick: () => { typeVal = v; typeRow.querySelectorAll('.type-opt').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', String(on)); }); syncSpan(); } }, icon(t.icon), t.label);
        return b;
      }));
      // Category: a color for a part of life, so all your health things read as one at a glance.
      let catVal = cats().some(x => x.id === m.cat) ? m.cat : '';
      f.cat = { get value() { return catVal; } };
      const catRow = h('div', { class: 'cat-pick', role: 'radiogroup', 'aria-label': 'Category' });
      // Your most-used categories show first; the rest sit behind "More". "+ New" adds one right here,
      // with its color, and the dot on the chosen chip changes that category's color.
      let showAll = false, adding = false;
      const useCount = () => { const n = {}; store.cardsWhere(x => x.tool === 'timely' && x.meta?.cat).forEach(x => { n[x.meta.cat] = (n[x.meta.cat] || 0) + 1; }); return n; };
      const SHOW = 5;
      const paintCatRow = () => {
        const all = cats(), used = useCount();
        const ranked = all.map((k, i) => ({ k, i, n: used[k.id] || 0 })).sort((a2, b2) => b2.n - a2.n || a2.i - b2.i).map(x => x.k);
        const top = ranked.slice(0, SHOW);
        if (catVal && !top.some(k => k.id === catVal)) { const cur = all.find(k => k.id === catVal); if (cur) top.push(cur); }
        const list = showAll ? ranked : top;
        const chip = k => {
          const b = h('button', { class: `cat-opt ${k.id ? '' : 'cat-none'} ${k.id === catVal ? 'on' : ''}`, type: 'button', role: 'radio', 'aria-checked': String(k.id === catVal), title: k.id ? `${k.name} (click the dot to change its color)` : 'No category', style: k.id ? catVars(k.color) : {},
            onclick: e => {
              if (k.id && k.id === catVal && e.target.closest('i')) { recolor(k, b); return; }
              catVal = k.id; paintCatRow();
            } }, h('i'), h('span', {}, k.name));
          return b;
        };
        const kids = [chip({ id: '', name: 'None' }), ...list.map(chip)];
        if (ranked.length > list.length) kids.push(h('button', { class: 'cat-more-btn', type: 'button', onclick: () => { showAll = true; paintCatRow(); } }, `More (${ranked.length - list.length})`));
        else if (showAll && ranked.length > SHOW) kids.push(h('button', { class: 'cat-more-btn', type: 'button', onclick: () => { showAll = false; paintCatRow(); } }, 'Fewer'));
        if (adding) {
          let color = CAT_PALETTE.find(col => !all.some(x => x.color === col)) || CAT_PALETTE[all.length % CAT_PALETTE.length];
          const name = h('input', { class: 'field-input sm cat-new-name', placeholder: 'Name', maxlength: 18, 'aria-label': 'New category name' });
          const dots = h('div', { class: 'cat-new-colors' }, CAT_PALETTE.map(col => h('button', { class: `cat-sw ${col === color ? 'on' : ''}`, type: 'button', style: { background: col }, 'aria-label': `Color ${col}`,
            onclick: ev => { color = col; dots.querySelectorAll('.cat-sw').forEach(x => x.classList.toggle('on', x === ev.currentTarget)); } })));
          const save = () => { const nm = name.value.trim(); if (!nm) { name.focus(); return; } const id = `c${Date.now().toString(36)}`; saveCats([...cats(), { id, name: nm, color }]); catVal = id; adding = false; paintCatRow(); };
          name.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); save(); } if (ev.key === 'Escape') { adding = false; paintCatRow(); } });
          kids.push(h('div', { class: 'cat-new-inline' }, name, dots, h('div', { class: 'cat-new-actions' },
            h('button', { class: 'btn ghost xs', type: 'button', onclick: () => { adding = false; paintCatRow(); } }, 'Cancel'),
            h('button', { class: 'btn primary xs', type: 'button', onclick: save }, 'Add'))));
          setTimeout(() => name.focus(), 0);
        } else kids.push(h('button', { class: 'cat-add-btn', type: 'button', onclick: () => { adding = true; paintCatRow(); } }, icon('plus'), 'New'));
        catRow.replaceChildren(...kids);
      };
      // Change a category's color straight from its chip.
      const recolor = (k, anchor) => {
        catRow.querySelectorAll('.cat-swatches').forEach(x => x.remove());
        anchor.after(h('div', { class: 'cat-swatches inline' }, CAT_PALETTE.map(col => h('button', { class: `cat-sw ${col === k.color ? 'on' : ''}`, type: 'button', style: { background: col }, 'aria-label': `Color ${col}`,
          onclick: () => { saveCats(cats().map(x => (x.id === k.id ? { ...x, color: col } : x))); paintCatRow(); } }))));
      };
      paintCatRow();
      const sync = () => { f.dur.disabled = !f.time.value; f.slot.disabled = !!f.time.value; };
      f.time.addEventListener('input', sync); sync();
      const repaintNames = () => {
            paintCatRow();
            typeRow?.querySelectorAll('.type-opt').forEach(b => { const k = [...b.classList].find(x => x.startsWith('it-'))?.slice(3); if (k && ITEM_TYPES[k]) b.lastChild.textContent = ITEM_TYPES[k].label; });
          };
      const dateLabel = m.recurrence ? 'Repeats from' : 'Date';
      const dateField = field(dateLabel, f.date), untilField = field('Until', f.end);
      // Trips and conferences run over days: they show an end date, and the first date reads "From".
      const syncSpan = () => {
        const span = !!(ITEM_TYPES[f.type ? f.type.value : m.itemType]?.span || f.end.value);
        untilField.hidden = !span;
        dateField.querySelector('.field-label').textContent = span ? 'From' : dateLabel;
      };
      setTimeout(syncSpan, 0);
      return h('div', { class: 'ical' },
        h('div', { class: 'ical-row' }, dateField, untilField, field('Time', f.time), field('Length', f.dur)),
        typeRow ? h('div', { class: 'mini-field' }, h('span', { class: 'field-label' }, 'Type'), typeRow) : null,
        h('div', { class: 'mini-field' }, h('span', { class: 'field-label cat-label' }, 'Category',
          h('button', { class: 'linkish small', type: 'button', title: 'Rename types, and add, rename or recolor categories', onclick: e => openCatNames(e.currentTarget, repaintNames) }, 'Edit types and categories')), catRow),
        h('div', { class: 'ical-row' }, field('Part of day', f.slot), field('Repeat', f.rec)),
        f.custom.el,
        isRoutine(card) ? h('p', { class: 'muted small' }, 'Changes apply from today on. Days you already ticked stay ticked.') : null,
        h('div', { class: 'ical-actions' },
          h('button', { class: 'chip', type: 'button', onclick: e => addToCalendar(e.currentTarget, id, { choose: true }) }, icon('calendar'), 'Add to calendar…'),
          // SD-T12: Send to Reminders only for reminders.
          isRem ? h('button', { class: 'chip', type: 'button', onclick: () => sendToReminders(store.getCard(id)) }, icon('bell'), 'Send to Reminders') : null));
    },
    collect: (refs, card) => {
      const [hh, mm] = (f.time.value || '').split(':').map(Number);
      const start = f.time.value ? hh * 60 + mm : null;
      return {
        meta: {
          ...card.meta, date: f.date.value || (card.meta.kind === 'reminder' ? null : card.meta.date),
          endDate: f.end.value && f.end.value > (f.date.value || card.meta.date) ? f.end.value : null,
          start, dur: start != null ? +f.dur.value : card.meta.dur, slot: start != null ? null : f.slot.value || null,
          recurrence: f.rec.value || null, repeat: f.rec.value === 'custom' ? f.custom.read() : null, ...(f.type ? { itemType: f.type.value } : {}), cat: f.cat.value || null,
        },
      };
    },
  });
}
const field = (label, input) => h('label', { class: 'mini-field' }, h('span', { class: 'field-label' }, label), input);

// ---------- .ics export ----------
const plainText = s => String(s || '').replace(/<\/(div|p|li)>/gi, '\n').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\r\n?|\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
const RRULE = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY' };
// A reminder needs a moment to go off. Without a time it would land in a calendar as an all-day event, and
// its alert would ring at midnight. So it goes in at the part of day you picked, or 9am, for 15 minutes.
const SLOT_TIME = { morning: 9 * 60, noon: 12 * 60, afternoon: 14 * 60, evening: 18 * 60, night: 20 * 60 };
function calMeta(c) {
  const m = { ...(c.meta || {}) };
  if (m.kind === 'reminder' && m.start == null) { m.start = SLOT_TIME[m.slot] ?? 9 * 60; m.dur = 15; }
  if (m.kind === 'reminder' && !m.date) m.date = todayKey();
  return m;
}
function vevent(c, onDate) {
  const m = calMeta(c);
  const date = (onDate || m.date || todayKey()).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VEVENT', `UID:${c.id}${onDate ? `-${onDate}` : ''}@sedi`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEsc(c.title)}`];
  if (m.start != null) {
    const end = m.start + (m.dur || 60);
    const t = mins => `${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}00`;
    lines.push(`DTSTART:${date}T${t(m.start)}`, `DTEND:${date}T${t(Math.min(end, 24 * 60 - 1))}`);
  } else {
    const next = dateKey(addDays(parseKey(onDate || m.endDate || m.date || todayKey()), 1)).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next}`);
  }
  if (m.recurrence && !onDate) lines.push(`RRULE:${rruleFor(m)}`);
  const desc = plainText(c.description);
  if (desc) lines.push(`DESCRIPTION:${icsEsc(desc)}`);
  if (m.kind === 'reminder') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(c.title)}`, 'TRIGGER:PT0M', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}
/** RFC 5545: lines longer than 75 bytes are folded (CRLF + space), and the file ends with CRLF. */
function foldLine(line) {
  const bytes = new TextEncoder().encode(line);
  if (bytes.length <= 75) return line;
  const out = []; let cur = '', size = 0, limit = 75;
  for (const ch of line) {
    const n = new TextEncoder().encode(ch).length;
    if (size + n > limit) { out.push(cur); cur = ''; size = 0; limit = 74; }
    cur += ch; size += n;
  }
  out.push(cur);
  return out.join('\r\n ');
}
const wrapCal = events => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sedi//Timely//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', ...events, 'END:VCALENDAR'].map(foldLine).join('\r\n') + '\r\n';
const slug = s => (s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function exportCard(c) {
  if (!c) return;
  download(`${slug(c.title)}.ics`, wrapCal(vevent(c)), 'text/calendar');
  toast('Saved. Open the file and your calendar adds it.');
}
/** A prefilled Google Calendar event (opens in a new tab; you press Save there). */
export function googleCalendarUrl(c) {
  const m = calMeta(c);
  const date = (m.date || todayKey()).replace(/-/g, '');
  let dates;
  if (m.start != null) {
    const t = mins => `${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}00`;
    dates = `${date}T${t(m.start)}/${date}T${t(Math.min(m.start + (m.dur || 60), 24 * 60 - 1))}`;
  } else dates = `${date}/${dateKey(addDays(parseKey(m.endDate || m.date || todayKey()), 1)).replace(/-/g, '')}`;
  const q = new URLSearchParams({ action: 'TEMPLATE', text: c.title, dates, details: plainText(c.description), ctz: Intl.DateTimeFormat().resolvedOptions().timeZone || '' });
  if (m.recurrence) q.set('recur', `RRULE:${rruleFor(m)}`);
  return `https://calendar.google.com/calendar/render?${q}`;
}
const CAL_TARGETS = {
  google: { label: 'Google Calendar', hint: 'Opens prefilled; press Save', run: c => { window.open(googleCalendarUrl(c), '_blank', 'noopener'); toast('Opened in Google Calendar. Press Save there.'); } },
  ics: { label: 'Apple Calendar or Outlook', hint: 'Downloads a file that opens in your calendar', run: c => exportCard(c) },
};
/** Add a card to a calendar: one click once you've picked a calendar (choice is remembered; change it any time). */
export function addToCalendar(anchor, id, { choose = false } = {}) {
  const c = store.getCard(id);
  if (!c) return;
  const saved = store.pref('calTarget');
  if (saved && CAL_TARGETS[saved] && !choose) {
    CAL_TARGETS[saved].run(c);
    return;
  }
  let remember = true;
  const pick = k => { if (remember) store.setPref('calTarget', k); closePopovers(); CAL_TARGETS[k].run(c); };
  popover(anchor, h('div', { class: 'cal-pop' },
    h('strong', {}, 'Add to calendar'),
    h('p', { class: 'muted small' }, (() => { const m = calMeta(c); return `${c.title}${m.date ? ` · ${fmtShortDate(parseKey(m.date))}` : ''}${m.start != null ? ` · ${fmtMinutes(m.start)}` : ''}${m.kind === 'reminder' ? ' · alert at that time' : ''}`; })()),
    ...Object.entries(CAL_TARGETS).map(([k, t]) => h('button', { class: `cal-opt ${saved === k ? 'on' : ''}`, type: 'button', onclick: () => pick(k) },
      h('span', { class: `cal-logo cal-${k}` }, icon(k === 'google' ? 'calendar' : 'download')), h('span', { class: 'cal-opt-text' }, h('b', {}, t.label), h('small', {}, t.hint)))),
    h('label', { class: 'cal-remember small muted' }, h('input', { type: 'checkbox', checked: true, onchange: e => { remember = e.target.checked; } }), ' Remember, and do it in one click next time')));
}
// ---------- Apple Reminders via Shortcuts (SD-B2) ----------
// Sedi hands each card to an Apple Shortcut, which adds it to Reminders. Web pages can't reach Reminders
// directly, so the shortcut is the bridge.
// When a shared iCloud link for the ready-made "Sedi Reminder" shortcut exists, put it here: everyone then
// installs it in one tap instead of building it.
export const REMINDER_SHORTCUT_URL = '';
const shortcutName = () => store.pref('reminderShortcut', 'Sedi Reminder');
const onApple = () => /Mac|iPhone|iPad|iPod/.test(navigator.platform || '') || /Macintosh|iPhone|iPad/.test(navigator.userAgent);
/** One reminder as the shortcut reads it. `due` is ISO local time; `when` is written the way Shortcuts reads dates best. */
function reminderItem(c) {
  const m = c.meta || {};
  const at = m.start ?? SLOT_TIME[m.slot] ?? 9 * 60;
  const hhmm = `${pad(Math.floor(at / 60))}:${pad(at % 60)}`;
  const due = m.date ? `${m.date}T${hhmm}:00` : '';
  const when = m.date ? new Date(`${m.date}T${hhmm}:00`).toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  return { title: c.title, when, due, notes: plainText(c.description || ''), list: store.pref('reminderList', '') };
}
/** What Sedi hands the shortcut: one line of JSON with a list of reminders (one or many, same shape). */
export function reminderPayload(cards) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  return JSON.stringify({ v: 2, items: list.map(reminderItem) });
}
// On iPhone and iPad, Shortcuts hands you straight back to Sedi when it's done (x-callback-url).
const onTouchApple = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
const shortcutUrl = text => {
  const base = `name=${encodeURIComponent(shortcutName())}&input=text&text=${encodeURIComponent(text)}`;
  if (!onTouchApple()) return `shortcuts://run-shortcut?${base}`;
  const back = encodeURIComponent(location.href.split('#')[0] + '#/timely');
  return `shortcuts://x-callback-url/run-shortcut?${base}&x-success=${back}&x-cancel=${back}&x-error=${back}`;
};
/** Send one reminder, or several at once, to Apple Reminders. Marks them as sent so they aren't sent twice. */
export function sendToReminders(cards) {
  const list = (Array.isArray(cards) ? cards : [cards]).filter(Boolean);
  if (!list.length) return;
  if (!onApple()) { toast('Apple Reminders works on a Mac, iPhone or iPad. Here, add it to your calendar instead.'); return; }
  const url = shortcutUrl(reminderPayload(list));
  if (!store.pref('reminderShortcutReady')) return openRemindersSetup(url, list.map(c => c.id));
  markSent(list.map(c => c.id));
  location.href = url;
  toast(list.length === 1 ? `Sent “${list[0].title.slice(0, 30)}” to Reminders.` : `Sent ${list.length} reminders to Reminders.`, { action: 'Not working?', onAction: () => openRemindersSetup(url), duration: 7000 });
}
const markSent = ids => ids.forEach(id => store.updateCard(id, { meta: { sentToApple: new Date().toISOString() } }, { silent: true, touch: false }));
export function openRemindersSetup(pendingUrl, pendingIds = []) {
  if (!onApple()) {
    modal({ title: 'Apple Reminders', body: h('div', { class: 'editor' },
      h('p', {}, 'Sending to Reminders works on a Mac, iPhone or iPad, through Apple’s Shortcuts app.'),
      h('p', { class: 'muted' }, 'On this device, use “Add to calendar” on any card instead: it works with Google Calendar, Outlook and Apple Calendar.')) });
    return;
  }
  const name = h('input', { class: 'field-input', value: shortcutName(), 'aria-label': 'Shortcut name' });
  const result = h('p', { class: 'muted small rem-test-result' });
  const test = () => {
    store.setPref('reminderShortcut', name.value.trim() || 'Sedi Reminder');
    const t = new Date(Date.now() + 5 * 60e3);
    const k = dateKey(t), mins = t.getHours() * 60 + t.getMinutes();
    location.href = shortcutUrl(reminderPayload({ title: 'Sedi test reminder', description: 'If this shows up in Reminders, the bridge works.', meta: { date: k, start: mins } }));
    result.textContent = 'Sent. Check Reminders: “Sedi test reminder”, due in 5 minutes. If Shortcuts says it can’t find the shortcut, check the name matches exactly.';
  };
  const steps = REMINDER_SHORTCUT_URL
    ? h('ol', { class: 'steps' },
      h('li', {}, h('a', { href: REMINDER_SHORTCUT_URL, target: '_blank', rel: 'noopener', class: 'btn sm primary' }, 'Get the Sedi Reminder shortcut'), ' and press “Add Shortcut”.'),
      h('li', {}, 'Come back and press “Send a test reminder”.'))
    : h('ol', { class: 'steps' },
      h('li', {}, 'Open the Shortcuts app and create a new shortcut named exactly as below.'),
      h('li', {}, 'Add “Get Dictionary from Input” (Shortcut Input), then “Get Dictionary Value” for the key “items”.'),
      h('li', {}, 'Add “Repeat with Each” on those items. Inside it: “Get Dictionary Value” for “title”, then for “when”, then “Get Dates from Input” on the when value.'),
      h('li', {}, 'Still inside: “Add New Reminder” with the title, and turn on “Remind Me” at the date. Add the “notes” value as notes if you like.'),
      h('li', {}, 'Come back and press “Send a test reminder”.'));
  modal({
    title: 'Send to Apple Reminders', wide: true,
    body: h('div', { class: 'editor' },
      h('p', { class: 'muted' }, 'Web pages can’t reach Reminders directly, so Sedi hands each card to an Apple Shortcut that adds it for you. Set it up once on each Mac or iPhone you use:'),
      steps,
      h('label', { class: 'field-label' }, 'Shortcut name'), name, result,
      h('p', { class: 'muted small' }, 'The first time, your browser asks whether to open Shortcuts. Choose Allow (or Always Allow).')),
    actions: [
      { label: 'Send a test reminder', kind: 'ghost', onClick: () => { test(); return true; } },
      { label: 'Cancel', kind: 'ghost' },
      {
        label: typeof pendingUrl === 'string' ? 'It works, send it' : 'It works', kind: 'primary', onClick: () => {
          store.setPref('reminderShortcut', name.value.trim() || 'Sedi Reminder');
          store.setPref('reminderShortcutReady', true);
          if (typeof pendingUrl === 'string') { markSent(pendingIds); location.href = pendingUrl.replace(/name=[^&]*/, `name=${encodeURIComponent(shortcutName())}`); }
        },
      },
    ],
  });
}

// ---------- Archive ----------
function openArchive() {
  const list = h('div', { class: 'modal-list' });
  const fill = () => {
    const items = store.cardsWhere(c => isSched(c) && c.meta?.archivedAt).sort((a, b) => b.meta.archivedAt.localeCompare(a.meta.archivedAt));
    list.replaceChildren(...items.map(c => {
      const left = Math.max(0, ARCHIVE_DAYS - Math.floor((Date.now() - new Date(c.meta.archivedAt)) / 864e5));
      return h('div', { class: 'activity-row' }, typeIcon(c.type),
        h('span', { class: 'activity-text' }, c.title, h('span', { class: 'muted small' }, `  ${c.meta.date || ''}`)),
        h('span', { class: 'muted small' }, `${left}d left`),
        h('button', { class: 'chip', onclick: () => { store.updateCard(c.id, { meta: { archivedAt: null, done: false, date: c.meta.date ? todayKey() : null } }, { log: true, logLabel: 'Restored' }); fill(); } }, 'Restore to today'),
        h('button', { class: 'icon-btn xs', 'aria-label': 'Delete now', onclick: () => { trashCard(c.id); fill(); } }, icon('trash')));
    }));
    if (!items.length) list.append(h('p', { class: 'muted' }, 'The archive is empty.'));
  };
  fill();
  modal({ title: 'Archive', wide: true, body: h('div', {}, h('p', { class: 'muted small' }, 'Past items stay here for 30 days, then delete themselves. Need a long record? Export to your calendar.'), list) });
}

// ---------- Planning: an animated carousel of lists you can add and reorder (SD-B8, SD-T5–T8) ----------
const containers = () => store.get('planContainers', { projects: [], goals: [] });
const boardContainers = b => containers()[b] || [];
// Open cards first, in their order; finished ones settle at the bottom, most recent first.
const planCards = (b, cid) => store.cardsWhere(c => isPlan(c) && c.meta.board === b && c.meta.containerId === cid)
  .sort((x, y) => (!!x.meta.done - !!y.meta.done) || (x.meta.done ? (y.meta.doneAt || '').localeCompare(x.meta.doneAt || '') : byOrder(x, y)));

/** Tick or untick a project task or goal step: celebrate in place first, then let it settle. */
function togglePlanCard(c, check, row) {
  const nowDone = !c.meta.done;
  store.updateCard(c.id, { meta: { done: nowDone, doneAt: nowDone ? new Date().toISOString() : null } },
    { silent: true, log: true, logLabel: nowDone ? (c.meta.stepKind ? 'Step done' : 'Completed') : 'Reopened' });
  check.classList.toggle('on', nowDone);
  row.classList.toggle('done', nowDone);
  if (nowDone) {
    const all = planCards(c.meta.board, c.meta.containerId);
    const finishedAll = all.length > 1 && all.every(x => x.meta.done);
    celebrate(check, { big: finishedAll });
    if (finishedAll) row.closest('.ct')?.classList.add('all-done');
  }
  setTimeout(() => store.notify({ reason: 'check' }), nowDone ? 650 : 120);
}
export const DEFAULT_CONTAINERS = () => ({
  projects: ['Ideas', 'In motion', 'Wrapping up'].map(name => ({ id: uuid(), name })),
  goals: ['Health', 'Craft', 'People'].map(name => ({ id: uuid(), name })),
});
const COL_GAP = 14;
const colW = () => 288; // every list and goal column shares one width

function renderPlan() {
  const b = planBoard();
  const list = boardContainers(b);
  const viewport = h('div', { class: 'plan-viewport' });
  // data-list="x": the list runs left to right, so lists can be dragged into a new order.
  const track = h('div', { class: `plan-track board-${b}`, dataset: { drop: 'plan-track', accept: 'ctcol', board: b }, 'data-list': 'x' },
    list.map(ct => (b === 'goals' ? goalEl(ct) : containerEl(b, ct))),
    h('button', { class: 'plan-ghost', onclick: () => (b === 'goals' ? openGoalWizard(null) : addContainer(b)) }, icon('plus'), b === 'goals' ? 'New goal' : 'Add project'));
  viewport.append(track);
  // Paging lives in the toolbar (same look as the date navigator), so nothing sits next to the tool buttons on the right edge.
  const left = h('button', { class: 'icon-btn tri-btn', 'aria-label': `Previous ${b === 'goals' ? 'goals' : 'projects'}` }, icon('chevL'));
  const right = h('button', { class: 'icon-btn tri-btn', 'aria-label': `Next ${b === 'goals' ? 'goals' : 'projects'}` }, icon('chevR'));
  const label = h('span', { class: 'time-label plan-range' });
  const navEl = h('div', { class: 'time-nav plan-nav' }, h('div', { class: 'time-nav-main' }, left, label, right));
  tbRight.prepend(navEl);
  body.replaceChildren(h('div', { class: 'plan' }, viewport));
  // Native sideways scrolling with snapping: swipe on touch screens and trackpads, or use the arrows.
  requestAnimationFrame(() => {
    // Measure what's really on screen (column widths differ between phones, tablets and computers).
    const firstCol = track.querySelector('.ct, .plan-ghost');
    const step = (firstCol?.getBoundingClientRect().width || colW(b)) + COL_GAP;
    const maxScroll = () => Math.max(0, viewport.scrollWidth - viewport.clientWidth);
    navEl.hidden = maxScroll() < 4;
    const paint = () => {
      const x = viewport.scrollLeft, from = Math.min(list.length, Math.floor(x / step + 0.5) + 1);
      const to = Math.min(list.length, Math.floor((x + viewport.clientWidth + COL_GAP) / step));
      left.disabled = x <= 2; right.disabled = x >= maxScroll() - 2;
      label.textContent = list.length ? (from >= to ? `${from} of ${list.length}` : `${from}–${to} of ${list.length}`) : '';
    };
    const go = d => viewport.scrollTo({ left: clamp(Math.round(viewport.scrollLeft / step + d) * step, 0, maxScroll()), behavior: 'smooth' });
    viewport.scrollLeft = clamp(((store.pref('planOffset', {})[b]) || 0) * step, 0, maxScroll());
    let t = null;
    viewport.addEventListener('scroll', () => {
      paint();
      clearTimeout(t);
      t = setTimeout(() => store.setPref('planOffset', { ...store.pref('planOffset', {}), [b]: Math.round(viewport.scrollLeft / step) }), 200);
    }, { passive: true });
    left.onclick = () => go(-1); right.onclick = () => go(1);
    paint();
  });
}

function listHead(b, ct, extra) {
  const name = h('h2', { class: 'ct-name', tabindex: 0, title: 'Click to rename' }, ct.name);
  name.addEventListener('click', () => editInline(name, { onCommit: v => saveContainers(b, boardContainers(b).map(x => (x.id === ct.id ? { ...x, name: v } : x))) }));
  return h('header', { class: 'ct-head' },
    h('span', { class: 'ct-grip', title: 'Drag to reorder', 'aria-hidden': 'true' }, icon('grip')),
    name, ...extra,
    h('button', { class: 'ct-x icon-btn xs', 'aria-label': `Delete ${ct.name}`, title: 'Delete this list (you can Undo)', onclick: () => deleteContainer(b, ct) }, icon('x')));
}
function addInput(b, ct, placeholder, onAdd) {
  const input = h('input', { class: 'task-input', placeholder, 'aria-label': 'Add card', 'data-keep': `ct-${ct.id}` });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) { onAdd(input.value.trim()); input.value = ''; }
    if (e.key === 'Escape') { planAdding = null; render(); }
  });
  input.addEventListener('blur', () => setTimeout(() => { if (planAdding === ct.id && !input.value.trim()) { planAdding = null; render(); } }, 150));
  setTimeout(() => input.focus(), 30);
  return withMic(input, { label: 'Dictate the card' });
}
/** The add row that sits right under a list's header (Taskly-style). */
const addRow = (ct, label) => h('button', { class: 'col-add ct-add-row', 'aria-label': `${label} to ${ct.name}`, onclick: () => { planAdding = ct.id; render(); } }, icon('plus'), label);

function containerEl(b, ct) {
  const builder = b === 'projects' && builderOn();
  const cards = planCards(b, ct.id);
  const adding = planAdding === ct.id;
  const listEl = h('div', { class: 'ct-list', dataset: { drop: 'plan-container', accept: 'card', container: ct.id, board: b }, 'data-list': '', 'data-autoscroll': '' },
    adding ? addInput(b, ct, 'New task, then Enter', title => {
      const card = store.createCard({ type: 'task', tool: 'timely', title, meta: { board: b, containerId: ct.id, order: -1 } });
      reorder(planCards(b, ct.id), card.id, 0);
    }) : addRow(ct, 'Add task'),
    cards.map(c => {
      const t = h('span', { class: 'pc-title', title: c.title, dataset: { fit: c.title } }, c.title);
      t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
      const check = h('button', {
        class: `step-check round ${c.meta.done ? 'on' : ''}`, 'aria-label': c.meta.done ? `Mark “${c.title}” not done` : `Mark “${c.title}” done`, 'aria-pressed': String(!!c.meta.done),
        onclick: e => { e.stopPropagation(); togglePlanCard(c, check, el); },
      }, icon('check'));
      const el = h('div', { class: `plan-card ${c.meta.done ? 'done' : ''}`, dataset: { drag: 'card', id: c.id } }, check, h('div', { class: 'pc-main' }, t, notesSnippet(c)));
      const actions = builder ? [shipButton(() => boardContainers(b).find(x => x.id === ct.id) || ct, () => taskPrompt(store.getCard(c.id) || c, boardContainers(b).find(x => x.id === ct.id) || ct), `Ship “${c.title}” to ${shipLabel(ct)}`)] : [];
      return cardChrome(el, c, () => openEditor(c.id, { title: 'Task' }), { actions });
    }));
  if (!cards.length && !adding) listEl.append(h('p', { class: 'ct-empty' }, 'No tasks yet.'));
  const done = cards.filter(c => c.meta.done).length;
  // Builder mode: the project's repo, and one button that sends every open task.
  const repo = builder ? h('input', { class: 'ct-repo', value: ct.repo || '', placeholder: 'Repo, like yourname/app', 'aria-label': `Repo for ${ct.name}`, spellcheck: false }) : null;
  repo?.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') repo.blur(); });
  repo?.addEventListener('change', () => saveContainers(b, boardContainers(b).map(x => (x.id === ct.id ? { ...x, repo: repo.value.trim() || undefined } : x))));
  const open = cards.filter(c => !c.meta.done).length;
  const live = () => ({ ...(boardContainers(b).find(x => x.id === ct.id) || ct), repo: repo?.value.trim() || ct.repo });
  const sendAll = builder && open ? h('button', { class: 'chip xs ct-send-all', type: 'button', title: `Ship all ${open} open tasks to ${shipLabel(ct)}`, onclick: e => ship(live(), () => listPrompt(live(), planCards(b, ct.id)), e.currentTarget, { title: `Ship ${open} task${open === 1 ? '' : 's'} to` }) }, icon('send'), `Ship all ${open}`) : null;
  const shipSet = builder ? h('button', { class: 'chip ghost xs ct-ship-to', type: 'button', title: 'Where this project ships, its repo, and standing instructions',
    onclick: e => openShipSettings(e.currentTarget, live(), patch => { saveContainers(b, boardContainers(b).map(x => (x.id === ct.id ? { ...x, ...patch } : x))); }) }, icon('gear'), ct.shipUrl ? `To ${shipLabel(ct)}` : 'Ship settings') : null;
  // Once anything is ticked, one quiet button sweeps the finished tasks away (one Undo brings them all back).
  const clearDone = done ? h('button', { class: 'ct-clear-done', type: 'button', title: 'Delete the ticked tasks in this project (you can Undo)',
    onclick: () => clearDoneTasks(b, ct) }, icon('check'), done === cards.length ? `Clear all ${done} done` : `Clear ${done} done`) : null;
  if (clearDone) listEl.append(clearDone);
  return h('section', { class: `ct ${cards.length > 1 && done === cards.length ? 'all-done' : ''} ${builder ? 'builder' : ''}`, dataset: { drag: 'ctcol', id: ct.id } },
    listHead(b, ct, [h('span', { class: 'col-count' }, cards.length ? `${done}/${cards.length}` : '')]),
    builder ? h('div', { class: 'ct-builder' }, repo, h('div', { class: 'ct-ship-row' }, shipSet, sendAll)) : null,
    cards.length ? h('div', { class: 'ct-progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': cards.length, 'aria-valuenow': done, 'aria-label': `${done} of ${cards.length} done` },
      h('span', { style: { width: `${(done / cards.length) * 100}%` } })) : null,
    listEl);
}

function clearDoneTasks(b, ct) {
  const gone = planCards(b, ct.id).filter(c => c.meta.done).map(c => store.deleteCard(c.id, { silent: true })).filter(Boolean);
  if (!gone.length) return;
  store.notify({ reason: 'delete' });
  toast(`Cleared ${gone.length} done task${gone.length === 1 ? '' : 's'} from “${truncate(ct.name, 24)}”`, { action: 'Undo', onAction: () => gone.forEach(c => store.restoreCard(c)) });
}

// ---------- Goals: framed with WOOP, broken into milestones and next actions ----------
// WOOP (Wish, Outcome, Obstacle, Plan) comes from Gabriele Oettingen's research on mental contrasting;
// the "if-then" plan is Peter Gollwitzer's implementation intention. Goal-setting research (Locke & Latham)
// favours specific, challenging goals with a deadline and visible progress.
function goalEl(ct) {
  const b = 'goals';
  const steps = planCards(b, ct.id);
  const done = steps.filter(c => c.meta.done).length;
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0;
  const w = ct.woop || {};
  const adding = planAdding === ct.id;
  let addKind = 'action';
  const kindToggle = adding ? h('div', { class: 'segmented small step-kind' },
    [['milestone', 'Milestone'], ['action', 'Next action']].map(([v, l]) => h('button', { type: 'button', class: v === addKind ? 'on' : '', onmousedown: e => e.preventDefault(), onclick: e => { addKind = v; e.currentTarget.parentElement.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === e.currentTarget)); } }, l))) : null;
  const daysLeft = ct.due ? Math.ceil((parseKey(ct.due) - parseKey(todayKey())) / 864e5) : null;
  const listEl = h('div', { class: 'ct-list goal-steps', dataset: { drop: 'plan-container', accept: 'card', container: ct.id, board: b }, 'data-list': '', 'data-autoscroll': '' },
    adding ? h('div', { class: 'step-add' }, kindToggle, addInput(b, ct, 'Describe the step, then Enter', title => {
      const card = store.createCard({ type: 'goal', tool: 'timely', title, meta: { board: b, containerId: ct.id, order: steps.length, stepKind: addKind, done: false } });
      void card;
    })) : (steps.length ? addRow(ct, 'Add a step') : null),
    steps.map(c => stepEl(c)));
  if (!steps.length && !adding) listEl.append(h('div', { class: 'goal-empty' },
    h('p', {}, 'No steps yet.'),
    h('button', { class: 'btn sm primary', onclick: () => openGoalWizard(ct.id) }, icon('sparkle'), 'Break it down')));
  return h('section', { class: 'ct goal-ct', dataset: { drag: 'ctcol', id: ct.id } },
    listHead(b, ct, [h('span', { class: 'col-count' }, steps.length ? `${done}/${steps.length}` : '')]),
    h('div', { class: 'goal-meta' },
      h('div', { class: 'goal-progress', role: 'progressbar', 'aria-valuenow': pct, 'aria-valuemin': 0, 'aria-valuemax': 100, title: `${done} of ${steps.length} steps done` }, h('span', { style: { width: `${pct}%` } })),
      h('div', { class: 'goal-stats' },
        h('span', {}, steps.length ? `${done}/${steps.length} steps` : 'Not broken down yet'),
        daysLeft != null ? h('span', { class: `goal-due ${daysLeft < 0 ? 'late' : ''}` }, icon('flag'), daysLeft < 0 ? `${-daysLeft}d past due` : daysLeft === 0 ? 'Due today' : `${daysLeft}d left`) : null),
      w.outcome ? h('p', { class: 'goal-line' }, h('b', {}, 'Outcome '), w.outcome) : null,
      w.plan ? h('p', { class: 'goal-line ifthen' }, h('b', {}, 'If-then '), w.plan) : null,
      h('button', { class: 'chip ghost goal-frame-btn', onclick: () => openGoalWizard(ct.id) }, icon('sparkle'), w.wish || w.outcome ? 'Edit the plan' : 'Frame this goal')),
    listEl);
}
function stepEl(c) {
  const kind = c.meta.stepKind || 'action';
  const t = h('span', { class: 'pc-title', title: c.title, dataset: { fit: c.title } }, c.title);
  t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  const el = h('div', { class: `plan-card step step-${kind} ${c.meta.done ? 'done' : ''}`, dataset: { drag: 'card', id: c.id } },
    h('button', { class: `step-check ${c.meta.done ? 'on' : ''}`, 'aria-label': c.meta.done ? 'Mark not done' : 'Mark done', 'aria-pressed': String(!!c.meta.done), onclick: e => {
      e.stopPropagation();
      togglePlanCard(c, e.currentTarget, el);
    } }, icon('check')),
    h('span', { class: 'step-kind-icon', title: kind === 'milestone' ? 'Milestone' : 'Next action' }, icon(kind === 'milestone' ? 'flag' : 'arrowR')),
    h('div', { class: 'pc-main' }, t, notesSnippet(c)));
  return cardChrome(el, c, () => openEditor(c.id, { title: kind === 'milestone' ? 'Milestone' : 'Next action' }));
}

/** Step-by-step goal setup: one question at a time (WOOP, a deadline, milestones, the very next action). */
export function openGoalWizard(ctId) {
  const existing = ctId ? boardContainers('goals').find(x => x.id === ctId) : null;
  const w = existing?.woop || {};
  const stop = el => { el.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter' && el.tagName === 'INPUT') { e.preventDefault(); go(1); } }); return el; };
  const input = (ph, val = '', extra = {}) => stop(h('input', { class: 'field-input wz-input', placeholder: ph, value: val, ...extra }));
  const area = (ph, val = '') => { const t = stop(h('textarea', { class: 'field-input wz-input', rows: 2, placeholder: ph })); t.value = val; return t; };
  const f = {
    name: input('e.g. Run a 10K', existing?.name || w.wish || '', { 'aria-label': 'Goal' }),
    due: stop(h('input', { class: 'field-input wz-date', type: 'date', min: todayKey(), value: existing?.due || '', 'aria-label': 'By when' })),
    outcome: area('e.g. More energy, and proud crossing the line', w.outcome || ''),
    obstacle: area('e.g. Skipping runs when I’m tired after work', w.obstacle || ''),
    plan: area('If I’m tired after work, then I’ll do 15 easy minutes anyway', w.plan || ''),
    ms: [0, 1, 2].map(i => input(['e.g. Run 5K without stopping', 'e.g. Run 8K', 'e.g. Sign up for the race'][i], '', { 'aria-label': `Milestone ${i + 1}` })),
    next: input('e.g. Put my running shoes by the door', '', { 'aria-label': 'Next action' }),
  };
  // If-then: start the plan off with their own obstacle, so they only finish the sentence.
  f.obstacle.addEventListener('change', () => { if (f.obstacle.value.trim() && !f.plan.value.trim()) f.plan.value = 'If that happens, I’ll '; });
  const obstacleQuote = () => { const ob = f.obstacle.value.trim().replace(/[.!]$/, ''); return ob ? h('blockquote', { class: 'wz-quote' }, ob) : null; };
  const STEPS = [
    { key: 'goal', q: 'What do you want to achieve?', tip: 'Make it specific and a bit of a stretch. Say what done looks like.', body: () => [f.name, h('label', { class: 'wz-sub' }, 'By when', h('span', { class: 'muted' }, ' (optional)')), f.due], focus: () => f.name },
    { key: 'outcome', q: 'Picture the best result.', tip: 'How will it feel? What changes for you?', body: () => [f.outcome], focus: () => f.outcome },
    { key: 'obstacle', q: 'What in you could get in the way?', tip: 'Be honest: the habit, feeling or excuse most likely to stop you.', body: () => [f.obstacle], focus: () => f.obstacle },
    { key: 'plan', q: 'When that happens, what will you do?', tip: 'One small, concrete move. Plans written as “if …, I’ll …” are far more likely to stick.', body: () => [obstacleQuote(), f.plan].filter(Boolean), focus: () => f.plan },
    ...(existing ? [] : [{ key: 'steps', q: 'Break it into steps.', tip: 'A few checkpoints you can see, then the smallest first move, something you could start in five minutes.', body: () => [
      h('label', { class: 'wz-sub' }, 'Milestones'), ...f.ms, h('label', { class: 'wz-sub' }, 'Your first move'), f.next], focus: () => f.ms[0] }]),
  ];
  let i = 0;
  const dots = h('div', { class: 'wz-dots', role: 'tablist' });
  const stage = h('div', { class: 'wz-stage' });
  const back = h('button', { class: 'btn ghost', type: 'button', onclick: () => go(-1) }, 'Back');
  const nextBtn = h('button', { class: 'btn primary', type: 'button', onclick: () => go(1) });
  const show = (dir = 0) => {
    const st = STEPS[i];
    dots.replaceChildren(...STEPS.map((x, k) => h('button', { class: `wz-dot ${k === i ? 'on' : ''} ${k < i ? 'done' : ''}`, type: 'button', 'aria-label': `Step ${k + 1}`, onclick: () => { i = k; show(); } })));
    stage.replaceChildren(h('div', { class: `wz-card ${dir > 0 ? 'from-right' : dir < 0 ? 'from-left' : ''}` },
      h('span', { class: 'wz-count' }, `${i + 1} of ${STEPS.length}`),
      h('h3', { class: 'wz-q' }, st.q), h('p', { class: 'wz-tip' }, st.tip), ...st.body()));
    back.style.visibility = i ? 'visible' : 'hidden';
    nextBtn.textContent = i < STEPS.length - 1 ? 'Next' : existing ? 'Save' : 'Create goal';
    setTimeout(() => st.focus()?.focus(), 60);
  };
  let m;
  const go = d => {
    if (d > 0 && i === 0 && !f.name.value.trim()) { f.name.focus(); f.name.classList.add('wz-need'); setTimeout(() => f.name.classList.remove('wz-need'), 600); return; }
    if (d > 0 && i === STEPS.length - 1) { finish(); m?.close(); return; }
    i = clamp(i + d, 0, STEPS.length - 1); show(d);
  };
  const finish = () => {
    const woop = { wish: f.name.value.trim(), outcome: f.outcome.value.trim(), obstacle: f.obstacle.value.trim(), plan: f.plan.value.trim().replace(/^If that happens, I’ll\s*$/, '').trim() };
    const name = f.name.value.trim() || 'New goal';
    if (existing) { saveContainers('goals', boardContainers('goals').map(x => (x.id === ctId ? { ...x, name, woop, due: f.due.value || null } : x))); return; }
    const ct = { id: uuid(), name, woop, due: f.due.value || null };
    saveContainers('goals', [...boardContainers('goals'), ct]);
    let order = 0;
    f.ms.map(x => x.value.trim()).filter(Boolean).forEach(t => store.createCard({ type: 'goal', tool: 'timely', title: t, meta: { board: 'goals', containerId: ct.id, order: order++, stepKind: 'milestone', done: false } }, { silent: true }));
    if (f.next.value.trim()) store.createCard({ type: 'goal', tool: 'timely', title: f.next.value.trim(), meta: { board: 'goals', containerId: ct.id, order: order++, stepKind: 'action', done: false } }, { silent: true });
    store.setPref('planOffset', { ...store.pref('planOffset', {}), goals: boardContainers('goals').length });
    store.notify({ reason: 'goal' });
    toast(`Created “${name}”`);
  };
  m = modal({
    title: existing ? 'Goal plan' : 'New goal', className: 'goal-wizard-modal',
    body: h('div', { class: 'goal-wizard wz' }, dots, stage, h('div', { class: 'wz-foot' },
      h('button', { class: 'chip ghost wz-why', type: 'button', onclick: () => setTimeout(openGoalGuide, 150) }, 'Why this works'),
      h('span', { class: 'head-spacer' }), back, nextBtn)),
    actions: [],
  });
  show();
}
function openGoalGuide() {
  const row = (n, title, ex) => h('li', { class: 'gg-row' }, h('span', { class: 'gg-n' }, n), h('div', {}, h('strong', {}, title), h('span', { class: 'gg-ex' }, ex)));
  modal({
    title: 'A goal that sticks', className: 'goal-guide-modal',
    body: h('div', { class: 'goal-guide gg' },
      h('p', { class: 'gg-lead' }, 'Five small moves. Each one takes a line.'),
      h('ol', { class: 'gg-list' },
        row('1', 'Name it, and when it’s done', 'Run a 10K by May'),
        row('2', 'Picture the best result', 'More energy, proud at the finish'),
        row('3', 'Spot what in you could stop you', 'Skipping runs when I’m tired'),
        row('4', 'Plan for it: if …, then I’ll …', 'If I’m tired, then I’ll run 15 easy minutes'),
        row('5', 'Know the very next move', 'Shoes by the door tonight')),
      h('p', { class: 'gg-foot' }, 'Then check in once a week: tick what’s done, write the next move.'),
      h('details', { class: 'gg-why' }, h('summary', {}, 'Why this works'),
        h('p', {}, 'Picturing the result and the obstacle together (Gabriele Oettingen’s WOOP) gives you energy for goals you can reach. If-then plans (Peter Gollwitzer) make follow-through far more likely. Specific, stretching goals beat “do your best” (Locke & Latham).'))),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}

registerDrop('plan-container', ({ id, data, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const type = data.board === 'goals' ? 'goal' : 'task';
  const keepDone = isPlan(c) && c.meta?.done ? { done: true, doneAt: c.meta.doneAt } : {};
  const meta = { board: data.board, containerId: data.container, order: index ?? 0, ...keepDone, ...(data.board === 'goals' ? { stepKind: c.meta?.stepKind || 'action', done: !!c.meta?.done } : {}) };
  if (c.tool !== 'timely') routeCard(id, { tool: 'timely', type, meta });
  else store.updateCard(id, { type, meta }, { replaceMeta: true });
  reorder(planCards(data.board, data.container), id, index);
});
// Reorder whole lists by dragging their header.
registerDrop('plan-track', ({ kind, id, index, data }) => {
  if (kind !== 'ctcol') return false;
  const b = data.board;
  const list = boardContainers(b);
  const moving = list.find(x => x.id === id);
  if (!moving) return false;
  const rest = list.filter(x => x.id !== id);
  rest.splice(clamp(index ?? rest.length, 0, rest.length), 0, moving);
  saveContainers(b, rest);
});

function saveContainers(b, list) { store.set('planContainers', { ...containers(), [b]: list }); }
function addContainer(b) {
  const ct = { id: uuid(), name: b === 'goals' ? 'New outcome' : 'New list' };
  const list = [...boardContainers(b), ct];
  store.setPref('planOffset', { ...store.pref('planOffset', {}), [b]: list.length });
  saveContainers(b, list);
  setTimeout(() => { const n = [...body.querySelectorAll('.ct-name')].at(-1); if (n) n.click(); }, 120);
}
function deleteContainer(b, ct) {
  const cards = planCards(b, ct.id);
  const prev = boardContainers(b);
  const idx = prev.findIndex(x => x.id === ct.id);
  cards.forEach(c => store.deleteCard(c.id, { silent: true }));
  saveContainers(b, prev.filter(x => x.id !== ct.id));
  toast(`Deleted ${ct.name}`, {
    action: 'Undo', onAction: () => {
      const list = boardContainers(b).slice(); list.splice(idx, 0, ct);
      saveContainers(b, list);
      cards.forEach(c => store.restoreCard(c));
    },
  });
}

export { popover };
