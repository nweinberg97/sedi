// Sedi — Timely: forward-only scheduling (day / week / month / reminders) and planning boards.
// Past one-off items move to a 30-day archive, then delete themselves to keep storage light.
// Routines (SD-T4) are cards with meta.recurrence; ticking one day adds that date to meta.doneDates.

import * as store from './store.js';
import {
  h, icon, uuid, clamp, toast, modal, editInline, download, popover, closePopovers, hashStr,
  dateKey, parseKey, todayKey, addDays, addMonths, startOfWeek, fmtMinutes, fmtShortDate, MONTH_NAMES, DAY_NAMES, pad,
} from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, trashCard, cardChrome, notesSnippet } from './cards.js';
import { todoCards, todoCapacity, completeTask } from './taskly.js';
import { tick, checkSound } from './sound.js';
import { listen, canListen } from './speech.js';
import { extractWhen } from './commands.js';

export const SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'];
export const SLOT_LABELS = { morning: 'Morning', noon: 'Noon', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const RECUR = { '': 'Does not repeat', daily: 'Every day (daily routine)', weekdays: 'Every weekday', weekly: 'Every week (weekly routine)', monthly: 'Every month (monthly routine)' };
const RECUR_SHORT = { daily: 'Daily', weekdays: 'Weekdays', weekly: 'Weekly', monthly: 'Monthly' };
// SD-T14: one-off item kinds. Stored as meta.itemType so it never collides with meta.kind ('reminder').
export const ITEM_TYPES = { task: { label: 'Task', icon: 'checklist' }, meeting: { label: 'Meeting', icon: 'calendar' }, appointment: { label: 'Appointment', icon: 'clock' }, work: { label: 'Work session', icon: 'target' } };
const ARCHIVE_DAYS = 30;

let root, body, planAdding = null;

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
    default: return false;
  }
}
/** Everything happening on a day. Routine occurrences carry `done` when that day was ticked. */
export function occurrencesOn(key) {
  const out = store.cardsWhere(c => live(c) && !(c.meta.kind === 'reminder' && c.meta.done && !c.meta.recurrence) && (c.meta.date === key || recursOn(c.meta, key)))
    .map(card => ({ card, date: key, done: !!card.meta.doneDates?.includes(key) }));
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
    const pastOneOff = m.date && m.date < today && !m.recurrence && m.kind !== 'reminder';
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
  body = h('div', { class: 'timely-body' });
  root.replaceChildren(h('div', { class: 'view timely' }, h('div', { class: 'timely-head' }), body));
  render();
}

export function render() {
  if (!root?.isConnected) return;
  const head = root.querySelector('.timely-head');
  const seg = (items, value, onPick, cls = '') => h('div', { class: `segmented ${cls}`, role: 'tablist' },
    items.map(([v, label]) => h('button', { class: v === value ? 'on' : '', role: 'tab', 'aria-selected': String(v === value), onclick: () => onPick(v) }, label)));
  // SD-T1/T2/T3: Scheduling / Planning on top; the sub-views sit in a smaller, indented bar beneath.
  head.replaceChildren(
    h('div', { class: 'timely-top' },
      h('h1', { class: 'view-title' }, 'Timely'),
      seg([['schedule', 'Scheduling'], ['plan', 'Planning']], mode(), v => { store.setPref('timelyMode', v); render(); }, 'mode-toggle'),
      h('span', { class: 'head-spacer' })),
    h('div', { class: 'nest-bar' },
      mode() === 'schedule'
        ? seg([['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['reminders', 'Reminders']], view(), v => { store.setPref('timelyView', v); render(); }, 'sub-tabs')
        : seg([['projects', 'Projects'], ['goals', 'Goals']], planBoard(), v => { store.setPref('timelyPlan', v); render(); }, 'sub-tabs'),
      mode() === 'plan' ? h('span', { class: 'nest-actions' },
        planBoard() === 'goals' ? h('button', { class: 'chip ghost', onclick: openGoalGuide }, icon('sparkle'), 'How to set a good goal') : null,
        h('button', { class: 'chip', onclick: () => (planBoard() === 'goals' ? openGoalWizard(null) : addContainer('projects')) }, icon('plus'), planBoard() === 'goals' ? 'New goal' : 'Add list')) : null));
  if (mode() === 'plan') return renderPlan();
  ({ day: renderDay, week: renderWeek, month: renderMonth, reminders: renderReminders })[view()]();
}

function navControl(label, step, extra) {
  const a = anchor(), atToday = view() === 'day' || view() === 'week' ? a === todayKey()
    : parseKey(a).getMonth() === new Date().getMonth() && parseKey(a).getFullYear() === new Date().getFullYear();
  return h('div', { class: 'time-nav' },
    h('div', { class: 'time-nav-main' },
      h('button', { class: 'icon-btn tri-btn', 'aria-label': 'Previous', disabled: atToday, onclick: () => setAnchor(step(-1)) }, icon('chevL')),
      h('span', { class: 'time-label' }, label),
      h('button', { class: 'icon-btn tri-btn', 'aria-label': 'Next', onclick: () => setAnchor(step(1)) }, icon('chevR')),
      h('button', { class: 'chip ghost', disabled: atToday, onclick: () => setAnchor(todayKey()) }, 'Today')),
    h('div', { class: 'time-nav-extra' }, extra || null, archiveButton()));
}
function archiveButton() {
  const n = store.cardsWhere(c => isSched(c) && c.meta?.archivedAt).length;
  return n ? h('button', { class: 'chip ghost', onclick: openArchive, title: 'Past items are kept for 30 days' }, icon('archive'), `Archive ${n}`) : null;
}
const itemTypeOf = c => (c.meta?.kind === 'reminder' ? 'reminder' : c.meta?.itemType || 'task');

// ---------- Daily ----------
function renderDay() {
  const key = anchor();
  const d = parseKey(key);
  const label = `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}`;
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
  body.replaceChildren(
    navControl(label, n => dateKey(addDays(parseKey(key), n))),
    h('div', { class: 'day-layout' },
      h('div', { class: 'day-col' }, allDay, scroll),
      dayPlanPanel(key)));

  // Size hours so 6am–8pm fills the visible window exactly.
  requestAnimationFrame(() => {
    const hourH = Math.max(50, scroll.clientHeight / 12); // roomy enough that hour-long titles wrap (SD-B1)
    grid.style.setProperty('--hour', hourH + 'px');
    grid.style.height = hourH * 24 + 'px';
    for (let hr = 0; hr < 24; hr++) {
      grid.append(h('div', { class: 'hour-row', style: { top: hr * hourH + 'px', height: hourH + 'px' } },
        h('span', { class: 'hour-label' }, hr === 0 ? '' : fmtMinutes(hr * 60))));
    }
    for (const o of timed) grid.append(eventBlock(o.card, hourH, key, o.done));
    if (key === todayKey()) {
      const n = new Date(); const mins = n.getHours() * 60 + n.getMinutes();
      grid.append(h('div', { class: 'now-line', style: { top: (mins / 60) * hourH + 'px' } }));
    }
    scroll.scrollTop = 7 * hourH;
    grid.addEventListener('click', e => {
      if (e.target !== grid && !e.target.classList.contains('hour-row')) return;
      const y = e.clientY - grid.getBoundingClientRect().top;
      const start = clamp(Math.floor((y / hourH) * 2) * 30, 0, 23 * 60 + 30);
      const card = store.createCard({ type: 'event', tool: 'timely', title: 'New block', meta: { date: key, start, dur: 60, itemType: 'task' } });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const t = body.querySelector(`[data-id="${card.id}"] .ev-title`);
        if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
      }));
    });
  });
}

function routineTick(c, key, done) {
  return h('button', { class: `routine-tick ${done ? 'on' : ''}`, 'aria-label': done ? 'Mark not done for this day' : 'Done for this day', 'aria-pressed': String(done), title: done ? 'Done for this day' : 'Tick off this day (the routine stays)',
    onclick: e => { e.stopPropagation(); toggleRoutineDay(c.id, key); } }, icon('check'));
}
const routineTag = c => h('span', { class: 'routine-tag' }, icon('repeat'), RECUR_SHORT[c.meta.recurrence] || 'Routine');

function eventBlock(c, hourH, key, done) {
  const m = c.meta;
  const dur = m.dur || 60;
  const px = Math.max(20, (dur / 60) * hourH - 2);
  // SD-B1: tall enough → title wraps (up to 2–3 lines); short blocks become a single clean row.
  const short = px < 40;
  const lines = px >= 84 ? 3 : 2;
  const el = h('article', {
    class: `event-block ${short ? 'short' : ''} it-${itemTypeOf(c)} ${isRoutine(c) ? 'is-routine' : ''} ${done ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id },
    style: { top: (m.start / 60) * hourH + 'px', height: px + 'px', '--lines': lines },
  },
  h('span', { class: 'ev-title', title: c.title }, c.title),
  h('span', { class: 'ev-time' }, h('span', { class: 'ev-range' }, `${fmtMinutes(m.start)}–${fmtMinutes(m.start + dur)}`), isRoutine(c) ? routineTag(c) : null),
  !short && px >= 70 ? notesSnippet(c) : null,
  isRoutine(c) ? routineTick(c, key, done) : null,
  h('div', { class: 'resize-handle', 'aria-hidden': 'true' }));
  // Calendar + repeat live on the card: on hover for roomy blocks, in Details for small ones.
  cardChrome(el, c, () => openEventEditor(c.id), { compact: short, actions: quickActions(c) });
  el.querySelector('.ev-title').addEventListener('dblclick', e => { e.stopPropagation(); editInline(e.target, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  // Resize in 15-minute steps.
  el.querySelector('.resize-handle').addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const sy = e.clientY, sd = dur;
    const move = ev => {
      const nd = clamp(Math.round((sd + ((ev.clientY - sy) / hourH) * 60) / 15) * 15, 15, 24 * 60 - m.start);
      el.style.height = Math.max(20, (nd / 60) * hourH - 2) + 'px';
      el.querySelector('.ev-range').textContent = `${fmtMinutes(m.start)}–${fmtMinutes(m.start + nd)}`;
      el.dataset.nd = nd;
    };
    const up = () => {
      removeEventListener('pointermove', move); removeEventListener('pointerup', up);
      if (el.dataset.nd && +el.dataset.nd !== dur) store.updateCard(c.id, { meta: { dur: +el.dataset.nd } });
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  });
  return el;
}

function chip(c, { showTime = false, date = null, done = false } = {}) {
  const m = c.meta || {};
  const el = h('div', { class: `t-chip it-${itemTypeOf(c)} ${isRoutine(c) ? 'is-routine' : ''} ${done ? 'is-done' : ''}`, dataset: { drag: 'card', id: c.id }, title: c.title },
    isRoutine(c) && date ? routineTick(c, date, done) : null,
    showTime && m.start != null ? h('span', { class: 't-chip-time' }, fmtMinutes(m.start)) : null,
    h('span', { class: 't-chip-title' }, c.title),
    isRoutine(c) && !date ? icon('repeat', 'ev-repeat') : null);
  el.addEventListener('dblclick', () => openEventEditor(c.id));
  el.addEventListener('click', e => { if (!e.target.closest('button')) openEventEditor(c.id); });
  return el;
}

/** Hover actions for Timely cards: add to calendar, and repeat (turn it into a routine). */
function quickActions(c) {
  return [
    h('button', { class: 'card-tool', type: 'button', 'aria-label': 'Add to calendar', title: 'Add to calendar (.ics)', onclick: e => { e.stopPropagation(); exportCard(store.getCard(c.id)); } }, icon('calendar')),
    h('button', { class: `card-tool ${isRoutine(c) ? 'on-routine' : ''}`, type: 'button', 'aria-label': 'Repeat', title: isRoutine(c) ? `Repeats ${RECUR_SHORT[c.meta.recurrence].toLowerCase()}` : 'Repeat: make it a routine', onclick: e => { e.stopPropagation(); openRepeat(e.currentTarget, c.id); } }, icon('repeat')),
  ];
}
function openRepeat(anchorEl, id) {
  const c = store.getCard(id);
  if (!c) return;
  const pick = v => {
    const meta = { recurrence: v || null };
    if (v && !c.meta.date) meta.date = todayKey();
    if (v && !c.meta.doneDates) meta.doneDates = [];
    store.updateCard(id, { meta }, { log: true, logLabel: v ? `Made a ${RECUR_SHORT[v].toLowerCase()} routine` : 'Stopped repeating' });
    closePopovers();
    toast(v ? `“${c.title}” now repeats ${RECUR_SHORT[v].toLowerCase()}. Ticking a day never deletes it.` : `“${c.title}” no longer repeats.`);
  };
  popover(anchorEl, h('div', { class: 'repeat-pop' },
    h('strong', {}, 'Repeat'),
    ...Object.entries(RECUR).map(([v, l]) => h('button', { class: `repeat-opt ${(c.meta.recurrence || '') === v ? 'on' : ''}`, onclick: () => pick(v) }, v ? icon('repeat') : icon('x'), l.replace(/ \(.*\)/, '')))));
}

// ---------- Today's plan (SD-T10) = Taskly's To do column. One list, shown in both places. ----------
function dayPlanPanel(key) {
  const list = todoCards();
  const input = h('input', { class: 'field-input sm', placeholder: 'Add to the plan, then Enter', 'aria-label': 'Add to today’s plan', 'data-keep': `plan-${key}` });
  input.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !input.value.trim()) return;
    if (todoCards().length >= todoCapacity()) { toast('Taskly’s To do column is full. Finish or move something first.'); return; }
    store.createCard({ type: 'task', tool: 'taskly', title: input.value.trim(), meta: { columnId: 'todo', order: todoCards().length } });
    input.value = '';
  });
  return h('aside', { class: 'day-plan', dataset: { drop: 'day-plan', accept: 'card' }, 'data-list': '' },
    h('div', { class: 'day-plan-head' },
      h('h3', {}, key === todayKey() ? 'Today’s plan' : 'Plan'),
      h('span', { class: 'sync-tag', title: 'This list is Taskly’s To do column. Changes show up in both places.' }, icon('sync'), 'Taskly To do')),
    h('div', { class: 'day-plan-list' }, list.map(c => {
      const el = h('div', { class: 'plan-item', dataset: { drag: 'card', id: c.id } },
        h('button', { class: 'plan-check', 'aria-label': `Complete “${c.title}”`, onclick: e => { e.stopPropagation(); e.currentTarget.classList.add('on'); checkSound(); setTimeout(() => completeTask(c.id), 380); } }, icon('check')),
        h('div', { class: 'plan-main' }, h('span', { class: 'plan-text' }, c.title), notesSnippet(c)),
        h('button', { class: 'icon-btn xs', title: 'Give it a time today', 'aria-label': 'Schedule it today', onclick: e => { e.stopPropagation(); scheduleToday(c.id, key); } }, icon('clock')));
      el.addEventListener('dblclick', () => openEditor(c.id, { title: 'Task' }));
      return el;
    })),
    input,
    h('p', { class: 'muted small' }, list.length ? 'Drag a task onto the day to give it a time.' : 'Nothing in To do. Add the day’s plan here; it shows up in Taskly too.'));
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
// Dropping a card on Today's plan puts it in Taskly's To do.
registerDrop('day-plan', ({ id, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  if (!(c.tool === 'taskly' && c.meta?.columnId === 'todo') && todoCards().length >= todoCapacity()) { toast('Taskly’s To do column is full.'); return false; }
  routeCard(id, { tool: 'taskly', type: 'task', meta: { columnId: 'todo', order: index ?? 0 }, log: 'Added to today’s plan' });
  reorder(todoCards(), id, index);
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
  if (patch.date && patch.date < todayKey()) { toast('Timely only looks forward. Pick today or later.'); return false; }
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

// ---------- Weekly: a rolling week that starts today (SD-T13) ----------
function renderWeek() {
  const ws = parseKey(anchor());
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const label = `${fmtShortDate(days[0])} – ${fmtShortDate(days[6])}`;
  const today = todayKey();
  const grid = h('div', { class: 'week-grid' });
  grid.append(h('div', { class: 'week-corner' }));
  for (const d of days) {
    const k = dateKey(d);
    grid.append(h('div', { class: `week-day-head ${k === today ? 'today' : ''}` },
      h('span', {}, k === today ? 'Today' : DAY_NAMES[d.getDay()].slice(0, 3)), h('strong', {}, d.getDate())));
  }
  const byDay = Object.fromEntries(days.map(d => [dateKey(d), occurrencesOn(dateKey(d))]));
  for (const slot of SLOTS) {
    grid.append(h('div', { class: 'week-slot-label' }, SLOT_LABELS[slot]));
    for (const d of days) {
      const k = dateKey(d);
      const items = byDay[k].filter(o => (o.card.meta.slot || (o.card.meta.start != null ? slotOfMinutes(o.card.meta.start) : 'morning')) === slot);
      const cell = h('div', {
        class: `week-cell ${k === today ? 'today' : ''}`,
        dataset: { drop: 'timely-cell', accept: 'card', date: k, slot }, 'data-list': '',
      }, items.map(o => chip(o.card, { showTime: true, date: k, done: o.done })));
      cell.append(h('button', { class: 'cell-add icon-btn xs', 'aria-label': `Add to ${SLOT_LABELS[slot]}`, onclick: e => openItemForm(e.currentTarget, { type: 'task', date: k, slot }) }, icon('plus')));
      grid.append(cell);
    }
  }
  // SD-T14 one-off buttons; SD-T15 the weekly routine button looks different on purpose.
  const adders = h('div', { class: 'item-adders' },
    Object.entries(ITEM_TYPES).map(([t, v]) => h('button', { class: `chip add-${t}`, onclick: e => openItemForm(e.currentTarget, { type: t, date: today }) }, icon(v.icon), v.label)),
    h('span', { class: 'muted small adders-hint' }, 'Hover a card to add it to your calendar or make it repeat.'));
  body.replaceChildren(navControl(label, n => dateKey(addDays(ws, 7 * n))), adders, grid);
}

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
    const daily = occ.filter(o => o.card.meta.recurrence === 'daily' || o.card.meta.recurrence === 'weekdays');
    const rest = occ.filter(o => !daily.includes(o));
    const shown = rest.slice(0, 3);
    const cell = h('div', {
      class: `month-cell ${inMonth ? '' : 'out'} ${k < today ? 'past' : ''} ${k === today ? 'today' : ''}`, role: 'button', tabindex: 0,
      dataset: { drop: 'timely-month', accept: 'card', date: k },
    }, h('span', { class: 'month-num' }, d.getDate()),
    // SD-T16: click an item to change its time right there.
    shown.map(o => h('button', {
      class: `month-item it-${itemTypeOf(o.card)} ${isRoutine(o.card) ? 'is-routine' : ''} ${o.done ? 'is-done' : ''}`, title: `${o.card.title} · click to change the time`,
      onclick: e => { e.stopPropagation(); openTimePopover(e.currentTarget, o.card.id); },
    }, o.card.meta.start != null ? h('b', {}, fmtMinutes(o.card.meta.start)) : null, o.card.title)),
    rest.length > 3 ? h('span', { class: 'month-more' }, `+${rest.length - 3} more`) : null,
    daily.length ? h('span', { class: 'month-routines' }, icon('repeat'), `${daily.length} daily`) : null);
    cell.addEventListener('click', () => openDayOverlay(k));
    cell.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === cell) openDayOverlay(k); });
    grid.append(cell);
  }
  const label = `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
  body.replaceChildren(
    navControl(label, n => { const m = addMonths(a, n); return dateKey(m < new Date() && n < 0 ? new Date() : m); },
      h('span', { class: 'nav-buttons' },
        h('button', { class: 'chip', onclick: e => openItemForm(e.currentTarget, { type: 'task', date: today, pickDate: true, title: 'Create event' }) }, icon('plus'), 'Create event'))),
    grid);
}

/** Small time editor for the monthly view. */
function openTimePopover(anchorEl, id) {
  const c = store.getCard(id);
  if (!c) return;
  const m = c.meta || {};
  const time = h('input', { class: 'field-input sm', type: 'time', value: m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '', 'aria-label': 'Time' });
  const date = h('input', { class: 'field-input sm', type: 'date', min: todayKey(), value: m.date || todayKey(), 'aria-label': 'Date', disabled: isRoutine(c) });
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

function openDayOverlay(k) {
  const d = parseKey(k);
  const list = h('div', { class: 'modal-list' });
  const fill = () => {
    const occ = occurrencesOn(k);
    list.replaceChildren(...occ.map(o => {
      const m = o.card.meta;
      const r = h('div', { class: 'activity-row clickable' }, typeIcon(o.card.type), h('span', { class: 'activity-text' }, o.card.title, isRoutine(o.card) ? h('span', { class: 'muted small' }, `  · ${RECUR_SHORT[m.recurrence]} routine`) : null),
        h('span', { class: 'muted small' }, m.start != null ? fmtMinutes(m.start) : SLOT_LABELS[m.slot] || 'Any time'));
      r.addEventListener('click', () => openEventEditor(o.card.id));
      return r;
    }));
    if (!occ.length) list.append(h('p', { class: 'muted' }, 'Nothing planned.'));
  };
  fill();
  const input = h('input', { class: 'field-input', placeholder: 'Add something for this day', 'aria-label': 'New item' });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' && input.value.trim()) {
      store.createCard({ type: 'event', tool: 'timely', title: input.value.trim(), meta: { date: k, itemType: 'task' } });
      input.value = ''; setTimeout(fill, 30);
    }
  });
  const past = k < todayKey();
  modal({
    title: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
    body: h('div', {}, list, past ? null : input),
    actions: past ? [] : [{ label: 'Open day view', kind: 'ghost', onClick: () => { store.setPref('timelyView', 'day'); setAnchor(k); } }],
  });
}

// ---------- New items and routines ----------
function timeFields(start = null) {
  const time = h('input', { class: 'field-input sm', type: 'time', value: start != null ? `${pad(Math.floor(start / 60))}:${pad(start % 60)}` : '', 'aria-label': 'Time' });
  const dur = h('select', { class: 'field-input sm', 'aria-label': 'Length' }, [15, 30, 45, 60, 90, 120, 180].map(v => h('option', { value: v, selected: v === 60 }, v < 60 ? `${v} min` : `${v / 60} hr`)));
  const read = () => { const [hh, mm] = time.value.split(':').map(Number); return time.value ? hh * 60 + mm : null; };
  return { time, dur, read };
}
/** SD-T14 / SD-T17: a one-off Task, Meeting, Appointment or Work session, with an optional exact time. */
function openItemForm(anchorEl, { type = 'task', date = todayKey(), slot = null, pickDate = true, title: heading } = {}) {
  const typeSel = h('select', { class: 'field-input sm', 'aria-label': 'Type' }, Object.entries(ITEM_TYPES).map(([v, t]) => h('option', { value: v, selected: v === type }, t.label)));
  const title = h('input', { class: 'field-input sm', placeholder: { task: 'Pick up the dry cleaning', meeting: 'Sync with Sam', appointment: 'Dentist', work: 'Focus: budget draft' }[type], 'aria-label': 'Title' });
  const dateIn = h('input', { class: 'field-input sm', type: 'date', min: todayKey(), value: date, 'aria-label': 'Date' });
  const { time, dur, read } = timeFields();
  const slotSel = h('select', { class: 'field-input sm', 'aria-label': 'Part of day' }, SLOTS.map(s => h('option', { value: s, selected: s === (slot || 'morning') }, SLOT_LABELS[s])));
  const sync = () => { slotSel.disabled = !!time.value; dur.disabled = !time.value; };
  time.addEventListener('input', sync); sync();
  const save = () => {
    const start = read();
    store.createCard({ type: 'event', tool: 'timely', title: title.value.trim() || ITEM_TYPES[typeSel.value].label,
      meta: { date: dateIn.value || date, itemType: typeSel.value, start, dur: start != null ? +dur.value : undefined, slot: start != null ? null : slotSel.value } });
    closePopovers();
  };
  title.addEventListener('keydown', e => { if (e.key === 'Enter') save(); });
  popover(anchorEl, h('div', { class: 'form-pop' },
    h('strong', {}, heading || `New ${ITEM_TYPES[type].label.toLowerCase()}`),
    field('What', title), field('Type', typeSel),
    pickDate ? field('Day', dateIn) : null,
    h('div', { class: 'time-pop-row' }, field('Time (optional)', time), field('Length', dur)),
    field('Otherwise, part of the day', slotSel),
    h('button', { class: 'btn sm primary', onclick: save }, 'Add')));
  setTimeout(() => title.focus(), 40);
}
// ---------- Reminders: a cork board of sticky notes (SD-T19/T20/T21) ----------
const STICKY = ['#fff3a3', '#ffd7c2', '#d6f0b8', '#c9e8fb', '#e7d6f7'];
let remDraft = { when: null, label: '' };
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

  const board = h('div', { class: 'cork', dataset: { drop: 'timely-reminders', accept: 'card' } }, composerSticky());
  for (const [k, label] of LANES) {
    if (!lanes[k].length) continue;
    board.append(h('section', { class: `lane lane-${k}` },
      h('h3', { class: 'lane-tag' }, label, h('span', { class: 'lane-n' }, lanes[k].length)),
      h('div', { class: 'lane-notes' }, lanes[k].map(c => stickyEl(c, k === 'overdue')))));
  }
  if (!rem.length) board.append(h('p', { class: 'cork-empty' }, 'Nothing pinned yet. Write one on the blank note, or drop any card here.'));
  body.replaceChildren(h('div', { class: 'reminders' }, board));
}

function stickyEl(c, overdue) {
  const m = c.meta;
  const when = isRoutine(c) ? `${RECUR_SHORT[m.recurrence]}${m.start != null ? ` · ${fmtMinutes(m.start)}` : ''}`
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
      tick(); store.updateCard(c.id, { meta: { done: true } }, { log: true, logLabel: 'Completed' }); runMaintenance();
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
  const custom = h('div', { class: 'pad-custom', hidden: true }, dateIn, timeIn);
  const setWhen = w => { remDraft.when = w; whenLabel.textContent = w ? w.label : 'No time'; chips.querySelectorAll('.pad-chip').forEach(c => c.classList.toggle('on', c.dataset.k === w?.k)); };
  const syncCustom = () => {
    if (!dateIn.value) return;
    const [hh, mm] = (timeIn.value || '').split(':').map(Number);
    const start = timeIn.value ? hh * 60 + mm : null;
    setWhen({ date: dateIn.value, start, k: 'custom', label: `${dateIn.value === todayKey() ? 'Today' : fmtShortDate(parseKey(dateIn.value))}${start != null ? ` · ${fmtMinutes(start)}` : ''}` });
  };
  dateIn.addEventListener('change', syncCustom); timeIn.addEventListener('change', syncCustom);
  const chips = h('div', { class: 'pad-chips' },
    [['1h', 'In 1 hour'], ['tonight', 'Tonight'], ['morning', 'Tomorrow AM'], ['weekend', 'Weekend']].map(([k, l]) =>
      h('button', { class: `pad-chip ${remDraft.when?.k === k ? 'on' : ''}`, type: 'button', dataset: { k }, onclick: () => setWhen({ ...quickWhen(k), k }) }, l)),
    h('button', { class: 'pad-chip', type: 'button', dataset: { k: 'custom' }, onclick: () => { custom.hidden = !custom.hidden; if (!custom.hidden) dateIn.focus(); } }, 'Pick…'));
  const add = () => {
    const title = input.value.trim();
    if (!title) { input.focus(); return; }
    const w = remDraft.when;
    store.createCard({ type: 'event', tool: 'timely', title, meta: { kind: 'reminder', date: w?.date || null, start: w?.start ?? null } });
    input.value = ''; remDraft = { when: null };
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
  return h('div', { class: 'sticky composer' },
    h('span', { class: 'sticky-pin', 'aria-hidden': 'true' }),
    h('span', { class: 'pad-label' }, 'New reminder'),
    input, chips, custom,
    h('div', { class: 'pad-foot' }, icon('clock'), whenLabel, heard, h('span', { class: 'head-spacer' }), mic, h('button', { class: 'pad-pin', type: 'button', onclick: add }, 'Pin')));
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
      f.date = h('input', { class: 'field-input', type: 'date', min: todayKey(), value: m.date || '' });
      f.time = h('input', { class: 'field-input', type: 'time', value: m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '' });
      const durs = [...new Set([15, 30, 45, 60, 90, 120, 180, m.dur || 60])].sort((a, b) => a - b);
      const durLabel = v => (v < 60 ? `${v} min` : v % 60 ? `${Math.floor(v / 60)} hr ${v % 60} min` : `${v / 60} hr`);
      f.dur = h('select', { class: 'field-input' }, durs.map(v => h('option', { value: v, selected: (m.dur || 60) === v }, durLabel(v))));
      f.slot = h('select', { class: 'field-input' }, h('option', { value: '' }, 'Any time'), SLOTS.map(s => h('option', { value: s, selected: m.slot === s }, SLOT_LABELS[s])));
      f.rec = h('select', { class: 'field-input' }, Object.entries(RECUR).map(([v, l]) => h('option', { value: v, selected: (m.recurrence || '') === v }, l)));
      f.type = isRem ? null : h('select', { class: 'field-input' }, Object.entries(ITEM_TYPES).map(([v, t]) => h('option', { value: v, selected: (m.itemType || 'task') === v }, t.label)));
      const sync = () => { f.dur.disabled = !f.time.value; f.slot.disabled = !!f.time.value; };
      f.time.addEventListener('input', sync); sync();
      return h('div', { class: 'ical' },
        h('div', { class: 'ical-row' }, field('Date', f.date), field('Time', f.time), field('Length', f.dur)),
        h('div', { class: 'ical-row' }, f.type ? field('Type', f.type) : null, field('Part of day', f.slot), field('Repeat', f.rec)),
        isRoutine(card) ? h('p', { class: 'muted small' }, 'Changes apply from today on. Days you already ticked stay ticked.') : null,
        h('div', { class: 'ical-actions' },
          h('button', { class: 'chip', type: 'button', onclick: () => exportCard(store.getCard(id)) }, icon('calendar'), 'Add to calendar (.ics)'),
          // SD-T12: Send to Reminders only for reminders.
          isRem ? h('button', { class: 'chip', type: 'button', onclick: () => sendToReminders(store.getCard(id)) }, icon('bell'), 'Send to Reminders') : null));
    },
    collect: (refs, card) => {
      const [hh, mm] = (f.time.value || '').split(':').map(Number);
      const start = f.time.value ? hh * 60 + mm : null;
      return {
        meta: {
          ...card.meta, date: f.date.value || (card.meta.kind === 'reminder' ? null : card.meta.date),
          start, dur: start != null ? +f.dur.value : card.meta.dur, slot: start != null ? null : f.slot.value || null,
          recurrence: f.rec.value || null, ...(f.type ? { itemType: f.type.value } : {}),
        },
      };
    },
  });
}
const field = (label, input) => h('label', { class: 'mini-field' }, h('span', { class: 'field-label' }, label), input);

// ---------- .ics export ----------
const icsEsc = s => String(s || '').replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/[,;]/g, m => '\\' + m);
const RRULE = { daily: 'FREQ=DAILY', weekdays: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR', weekly: 'FREQ=WEEKLY', monthly: 'FREQ=MONTHLY' };
function vevent(c, onDate) {
  const m = c.meta || {};
  const date = (onDate || m.date || todayKey()).replace(/-/g, '');
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VEVENT', `UID:${c.id}${onDate ? `-${onDate}` : ''}@sedi`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEsc(c.title)}`];
  if (m.start != null) {
    const end = m.start + (m.dur || 60);
    const t = mins => `${pad(Math.floor(mins / 60) % 24)}${pad(mins % 60)}00`;
    lines.push(`DTSTART:${date}T${t(m.start)}`, `DTEND:${date}T${t(Math.min(end, 24 * 60 - 1))}`);
  } else {
    const next = dateKey(addDays(parseKey(onDate || m.date || todayKey()), 1)).replace(/-/g, '');
    lines.push(`DTSTART;VALUE=DATE:${date}`, `DTEND;VALUE=DATE:${next}`);
  }
  if (m.recurrence && !onDate) lines.push(`RRULE:${RRULE[m.recurrence]}`);
  if (c.description) lines.push(`DESCRIPTION:${icsEsc(c.description)}`);
  if (m.kind === 'reminder') lines.push('BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEsc(c.title)}`, 'TRIGGER:PT0M', 'END:VALARM');
  lines.push('END:VEVENT');
  return lines;
}
const wrapCal = events => ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Sedi//Timely//EN', 'CALSCALE:GREGORIAN', ...events, 'END:VCALENDAR'].join('\r\n');
const slug = s => (s || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
export function exportCard(c) {
  if (!c) return;
  download(`${slug(c.title)}.ics`, wrapCal(vevent(c)), 'text/calendar');
  toast('Downloaded .ics — open it to add to Calendar');
}
// ---------- Apple Reminders via Shortcuts (SD-B2) ----------
const shortcutName = () => store.pref('reminderShortcut', 'Sedi Reminder');
/** What Sedi hands the shortcut: one line of JSON, so a missing date can't break it. */
export function reminderPayload(c) {
  const m = c.meta || {};
  const due = m.date ? `${m.date}T${m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '09:00'}:00` : '';
  const notes = /<\/?[a-z][\s\S]*>/i.test(c.description || '') ? '' : (c.description || '');
  return JSON.stringify({ title: c.title, due, notes });
}
const shortcutUrl = text => `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName())}&input=text&text=${encodeURIComponent(text)}`;
export function sendToReminders(c) {
  if (!c) return;
  const url = shortcutUrl(reminderPayload(c));
  if (!store.pref('reminderShortcutReady')) return openRemindersSetup(url);
  location.href = url;
  toast('Opening Shortcuts… If nothing happens, check the setup in Menu → Apple Reminders.');
}
export function openRemindersSetup(pendingUrl) {
  const name = h('input', { class: 'field-input', value: shortcutName(), 'aria-label': 'Shortcut name' });
  const test = () => {
    store.setPref('reminderShortcut', name.value.trim() || 'Sedi Reminder');
    const t = new Date(Date.now() + 5 * 60e3);
    location.href = shortcutUrl(JSON.stringify({ title: 'Sedi test reminder', due: `${dateKey(t)}T${pad(t.getHours())}:${pad(t.getMinutes())}:00`, notes: 'If this shows up in Reminders, the bridge works.' }));
  };
  modal({
    title: 'Send to Apple Reminders', wide: true,
    body: h('div', { class: 'editor' },
      h('p', { class: 'muted' }, 'Sedi hands each reminder to an Apple Shortcut on your Mac or iPhone. Build it once (about 3 minutes):'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the Shortcuts app and create a new shortcut. Name it exactly as below.'),
        h('li', {}, 'In the shortcut’s details (ⓘ), turn on “Receive Text input”, and if there’s no input, “Stop and respond”.'),
        h('li', {}, 'Add “Get Dictionary from Input” (input: Shortcut Input).'),
        h('li', {}, 'Add “Get Dictionary Value” → Value for “title”. Add another “Get Dictionary Value” → Value for “due”.'),
        h('li', {}, 'Add “If” → the “due” value → “has any value”.'),
        h('li', {}, 'Inside If: “Add New Reminder” with the title value, turn on “Remind Me”, and set the date to the “due” value. (If Shortcuts won’t accept it, put “Get Dates from Input” on “due” first.)'),
        h('li', {}, 'Inside Otherwise: “Add New Reminder” with the title value and no alert.'),
        h('li', {}, 'Come back here and press “Send a test reminder”. A reminder called “Sedi test reminder” should appear, due in 5 minutes.')),
      h('label', { class: 'field-label' }, 'Shortcut name'), name,
      h('p', { class: 'muted small' }, 'Works in Safari or Chrome on macOS and iOS. Your browser asks to open Shortcuts the first time.')),
    actions: [
      { label: 'Send a test reminder', kind: 'ghost', onClick: () => { test(); return true; } },
      { label: 'Cancel', kind: 'ghost' },
      {
        label: typeof pendingUrl === 'string' ? 'It works, send it' : 'Save', kind: 'primary', onClick: () => {
          store.setPref('reminderShortcut', name.value.trim() || 'Sedi Reminder');
          store.setPref('reminderShortcutReady', true);
          if (typeof pendingUrl === 'string') location.href = pendingUrl.replace(/name=[^&]*/, `name=${encodeURIComponent(shortcutName())}`);
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
const planCards = (b, cid) => store.cardsWhere(c => isPlan(c) && c.meta.board === b && c.meta.containerId === cid).sort(byOrder);
export const DEFAULT_CONTAINERS = () => ({
  projects: ['Ideas', 'In motion', 'Wrapping up'].map(name => ({ id: uuid(), name })),
  goals: ['Health', 'Craft', 'People'].map(name => ({ id: uuid(), name })),
});
const COL_GAP = 14;
const colW = b => (b === 'goals' ? 300 : 272);

function renderPlan() {
  const b = planBoard();
  const list = boardContainers(b);
  const viewport = h('div', { class: 'plan-viewport' });
  // data-list="x": the list runs left to right, so lists can be dragged into a new order.
  const track = h('div', { class: `plan-track board-${b}`, dataset: { drop: 'plan-track', accept: 'ctcol', board: b }, 'data-list': 'x' },
    list.map(ct => (b === 'goals' ? goalEl(ct) : containerEl(b, ct))),
    h('button', { class: 'plan-ghost', onclick: () => (b === 'goals' ? openGoalWizard(null) : addContainer(b)) }, icon('plus'), b === 'goals' ? 'New goal' : 'Add a list'));
  viewport.append(track);
  const left = h('button', { class: 'carousel-btn left', 'aria-label': 'Previous lists' }, h('span', { class: 'tri' }));
  const right = h('button', { class: 'carousel-btn right', 'aria-label': 'Next lists' }, h('span', { class: 'tri' }));
  const pager = h('div', { class: 'plan-pager' });
  body.replaceChildren(h('div', { class: 'plan' }, left, viewport, right), pager);
  requestAnimationFrame(() => {
    const step = colW(b) + COL_GAP;
    const visible = Math.max(1, Math.floor((viewport.clientWidth + COL_GAP) / step));
    const max = Math.max(0, list.length + 1 - visible);
    let off = clamp((store.pref('planOffset', {})[b]) || 0, 0, max);
    const paint = animate => {
      track.style.transition = animate ? '' : 'none';
      track.style.transform = `translateX(${-off * step}px)`;
      left.disabled = off === 0; right.disabled = off >= max;
      pager.replaceChildren(...(max ? Array.from({ length: max + 1 }, (_, i) => h('span', { class: `pdot ${i === off ? 'on' : ''}` })) : []));
      if (!animate) requestAnimationFrame(() => (track.style.transition = ''));
    };
    const go = d => { off = clamp(off + d, 0, max); store.setPref('planOffset', { ...store.pref('planOffset', {}), [b]: off }); paint(true); };
    left.onclick = () => go(-1); right.onclick = () => go(1);
    paint(false);
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
  return input;
}

function containerEl(b, ct) {
  const cards = planCards(b, ct.id);
  const adding = planAdding === ct.id;
  const listEl = h('div', { class: 'ct-list', dataset: { drop: 'plan-container', accept: 'card', container: ct.id, board: b }, 'data-list': '', 'data-autoscroll': '' },
    adding ? addInput(b, ct, 'New task, then Enter', title => {
      const card = store.createCard({ type: 'task', tool: 'timely', title, meta: { board: b, containerId: ct.id, order: -1 } });
      reorder(planCards(b, ct.id), card.id, 0);
    }) : null,
    cards.map(c => {
      const t = h('span', { class: 'pc-title', title: c.title }, c.title);
      t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
      const el = h('div', { class: 'plan-card', dataset: { drag: 'card', id: c.id } }, typeIcon(c.type), h('div', { class: 'pc-main' }, t, notesSnippet(c)));
      return cardChrome(el, c, () => openEditor(c.id, { title: 'Task' }));
    }));
  if (!cards.length && !adding) listEl.append(h('p', { class: 'ct-empty' }, 'No tasks yet.'));
  return h('section', { class: 'ct', dataset: { drag: 'ctcol', id: ct.id } },
    listHead(b, ct, [
      // SD-T8: add sits right next to the title.
      h('button', { class: 'ct-add', 'aria-label': `Add to ${ct.name}`, title: 'Add a card', onclick: () => { planAdding = ct.id; render(); } }, icon('plus')),
      h('span', { class: 'col-count' }, cards.length || '')]),
    listEl);
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
    })) : null,
    steps.map(c => stepEl(c)));
  if (!steps.length && !adding) listEl.append(h('div', { class: 'goal-empty' },
    h('p', {}, 'No steps yet.'),
    h('button', { class: 'btn sm primary', onclick: () => openGoalWizard(ct.id) }, icon('sparkle'), 'Break it down')));
  return h('section', { class: 'ct goal-ct', dataset: { drag: 'ctcol', id: ct.id } },
    listHead(b, ct, [
      h('button', { class: 'ct-add', 'aria-label': `Add a step to ${ct.name}`, title: 'Add a step', onclick: () => { planAdding = ct.id; render(); } }, icon('plus'))]),
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
  const t = h('span', { class: 'pc-title', title: c.title }, c.title);
  t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  const el = h('div', { class: `plan-card step step-${kind} ${c.meta.done ? 'done' : ''}`, dataset: { drag: 'card', id: c.id } },
    h('button', { class: `step-check ${c.meta.done ? 'on' : ''}`, 'aria-label': c.meta.done ? 'Mark not done' : 'Mark done', onclick: e => {
      e.stopPropagation();
      if (!c.meta.done) checkSound();
      store.updateCard(c.id, { meta: { done: !c.meta.done } }, { log: true, logLabel: c.meta.done ? 'Reopened' : 'Step done' });
    } }, icon('check')),
    h('span', { class: 'step-kind-icon', title: kind === 'milestone' ? 'Milestone' : 'Next action' }, icon(kind === 'milestone' ? 'flag' : 'arrowR')),
    h('div', { class: 'pc-main' }, t, notesSnippet(c)));
  return cardChrome(el, c, () => openEditor(c.id, { title: kind === 'milestone' ? 'Milestone' : 'Next action' }));
}

/** Step-by-step goal setup: WOOP, a deadline, milestones and the very next action. */
export function openGoalWizard(ctId) {
  const existing = ctId ? boardContainers('goals').find(x => x.id === ctId) : null;
  const w = existing?.woop || {};
  const f = {};
  const area = (k, label, help, ph, val = '') => {
    f[k] = h('textarea', { class: 'field-input', rows: 2, placeholder: ph, 'aria-label': label });
    f[k].value = val;
    f[k].addEventListener('keydown', e => e.stopPropagation());
    return h('div', { class: 'wiz-step' }, h('label', { class: 'field-label' }, label), h('p', { class: 'muted small' }, help), f[k]);
  };
  f.name = h('input', { class: 'field-input title-input', value: existing?.name || '', placeholder: 'Name the goal, e.g. “Run a 10K”', 'aria-label': 'Goal name' });
  f.due = h('input', { class: 'field-input sm', type: 'date', min: todayKey(), value: existing?.due || '', 'aria-label': 'Deadline' });
  const ms = [0, 1, 2].map(i => h('input', { class: 'field-input sm', placeholder: ['First milestone, e.g. run 5K without stopping', 'Second milestone', 'Third milestone'][i], 'aria-label': `Milestone ${i + 1}` }));
  const next = h('input', { class: 'field-input sm', placeholder: 'Something you can start in 5 minutes, e.g. put running shoes by the door', 'aria-label': 'First next action' });
  [...ms, next, f.name].forEach(x => x.addEventListener('keydown', e => e.stopPropagation()));
  const bodyEl = h('div', { class: 'editor goal-wizard' },
    f.name,
    h('p', { class: 'muted small' }, 'Four short questions, then break it into steps. Write in your own words; one line each is enough.'),
    area('wish', '1 · Wish', 'What do you want to achieve? Make it challenging but doable.', 'Run a 10K race without walking', w.wish || ''),
    area('outcome', '2 · Outcome', 'Picture the best result. How will it feel, what changes?', 'More energy, proud crossing the line', w.outcome || ''),
    area('obstacle', '3 · Obstacle', 'What inside you is most likely to get in the way?', 'Skipping runs when I’m tired after work', w.obstacle || ''),
    area('plan', '4 · Plan (if-then)', 'If that obstacle shows up, what will you do? Write it as “If …, then I will …”.', 'If I’m tired after work, then I’ll do a 15-minute easy run anyway', w.plan || ''),
    h('div', { class: 'wiz-row' }, h('label', { class: 'field-label' }, 'Deadline'), f.due),
    existing ? null : h('div', { class: 'wiz-step' },
      h('label', { class: 'field-label' }, '5 · Break it down'),
      h('p', { class: 'muted small' }, 'Milestones are checkpoints you can see. The next action is the smallest first move.'),
      ...ms, h('label', { class: 'field-label' }, 'Next action'), next));
  modal({
    title: existing ? 'Goal plan' : 'New goal', wide: true, body: bodyEl,
    actions: [
      { label: 'Guide', kind: 'ghost', onClick: () => { setTimeout(openGoalGuide, 200); return true; } },
      { label: 'Cancel', kind: 'ghost' },
      { label: existing ? 'Save' : 'Create goal', kind: 'primary', onClick: () => {
        const woop = { wish: f.wish.value.trim(), outcome: f.outcome.value.trim(), obstacle: f.obstacle.value.trim(), plan: f.plan.value.trim() };
        const name = f.name.value.trim() || woop.wish || 'New goal';
        if (existing) {
          saveContainers('goals', boardContainers('goals').map(x => (x.id === ctId ? { ...x, name, woop, due: f.due.value || null } : x)));
          return;
        }
        const ct = { id: uuid(), name, woop, due: f.due.value || null };
        saveContainers('goals', [...boardContainers('goals'), ct]);
        let order = 0;
        ms.map(x => x.value.trim()).filter(Boolean).forEach(t => store.createCard({ type: 'goal', tool: 'timely', title: t, meta: { board: 'goals', containerId: ct.id, order: order++, stepKind: 'milestone', done: false } }, { silent: true }));
        if (next.value.trim()) store.createCard({ type: 'goal', tool: 'timely', title: next.value.trim(), meta: { board: 'goals', containerId: ct.id, order: order++, stepKind: 'action', done: false } }, { silent: true });
        store.setPref('planOffset', { ...store.pref('planOffset', {}), goals: boardContainers('goals').length });
        store.notify({ reason: 'goal' });
        toast(`Created “${name}”`);
      } },
    ],
  });
  // Focus the first field, unless you've already clicked into another one.
  setTimeout(() => { if (!bodyEl.contains(document.activeElement)) (existing ? f.wish : f.name).focus(); }, 80);
}
function openGoalGuide() {
  const sec = (title, text) => h('div', { class: 'guide-sec' }, h('h4', {}, title), h('p', {}, text));
  modal({
    title: 'How to set a goal that sticks', wide: true,
    body: h('div', { class: 'editor goal-guide' },
      sec('1. Be specific, and make it a stretch', 'Specific, challenging goals tend to beat “do your best”. Say what done looks like and by when.'),
      sec('2. WOOP it: Wish, Outcome, Obstacle, Plan', 'Imagine the best outcome, then the main thing inside you that could stop you. Picturing both together (mental contrasting) gives you energy for goals you can reach and helps you let go of ones you can’t.'),
      sec('3. Write an if-then plan', '“If it’s 6pm on a workday, then I’ll put on my running shoes.” Linking a situation to an action makes you far more likely to follow through than intention alone.'),
      sec('4. Break it into milestones', 'Two to four checkpoints you can see. Each one should feel like progress, not busywork.'),
      sec('5. Always know the next action', 'The very next physical step, small enough to start in five minutes. When it’s done, write the next one.'),
      sec('6. Review weekly', 'Once a week, tick what’s done, move what slipped, and adjust the plan. Seeing progress keeps motivation up.'),
      h('p', { class: 'muted small' }, 'Based on Gabriele Oettingen’s WOOP research, Peter Gollwitzer’s implementation intentions, and Locke & Latham’s goal-setting theory.')),
    actions: [{ label: 'Got it', kind: 'primary' }],
  });
}

registerDrop('plan-container', ({ id, data, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const type = data.board === 'goals' ? 'goal' : 'task';
  const meta = { board: data.board, containerId: data.container, order: index ?? 0, ...(data.board === 'goals' ? { stepKind: c.meta?.stepKind || 'action', done: !!c.meta?.done } : {}) };
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
