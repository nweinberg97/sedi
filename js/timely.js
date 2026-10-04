// Sedi — Timely: forward-only scheduling (day / week / month / reminders) and planning boards.
// Past one-off items move to a 30-day archive, then delete themselves to keep storage light.

import * as store from './store.js';
import {
  h, icon, uuid, clamp, toast, modal, editInline, download, popover,
  dateKey, parseKey, todayKey, addDays, addMonths, startOfWeek, fmtMinutes, fmtShortDate, MONTH_NAMES, DAY_NAMES, pad,
} from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, trashCard } from './cards.js';
import { tick } from './sound.js';

export const SLOTS = ['morning', 'noon', 'afternoon', 'evening', 'night'];
export const SLOT_LABELS = { morning: 'Morning', noon: 'Noon', afternoon: 'Afternoon', evening: 'Evening', night: 'Night' };
const RECUR = { '': 'Does not repeat', daily: 'Every day', weekdays: 'Every weekday', weekly: 'Every week', monthly: 'Every month' };
const ARCHIVE_DAYS = 30;

let root, body;

// ---------- Queries ----------
const isSched = c => c.tool === 'timely' && !c.meta?.board;
const isPlan = c => c.tool === 'timely' && !!c.meta?.board;
const live = c => isSched(c) && !c.meta?.archivedAt;

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
export function occurrencesOn(key) {
  const out = store.cardsWhere(c => live(c) && !(c.meta.kind === 'reminder' && c.meta.done) && (c.meta.date === key || recursOn(c.meta, key)))
    .map(card => ({ card, date: key }));
  const slotIdx = s => (s ? SLOTS.indexOf(s) : 9);
  return out.sort((a, b) => {
    const ma = a.card.meta, mb = b.card.meta;
    const ka = ma.start != null ? ma.start : slotIdx(ma.slot) * 300 + 1, kb = mb.start != null ? mb.start : slotIdx(mb.slot) * 300 + 1;
    return ka - kb;
  });
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
    const doneReminder = m.kind === 'reminder' && m.done;
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
  root.replaceChildren(h('div', { class: 'view timely' }, h('div', { class: 'view-head timely-head' }), body));
  render();
}

export function render() {
  if (!root?.isConnected) return;
  const head = root.querySelector('.timely-head');
  const seg = (items, value, onPick, cls = '') => h('div', { class: `segmented ${cls}`, role: 'tablist' },
    items.map(([v, label]) => h('button', { class: v === value ? 'on' : '', role: 'tab', 'aria-selected': String(v === value), onclick: () => onPick(v) }, label)));
  head.replaceChildren(
    h('h1', { class: 'view-title' }, 'Timely'),
    seg([['schedule', 'Scheduling'], ['plan', 'Planning']], mode(), v => { store.setPref('timelyMode', v); render(); }, 'mode-toggle'),
    mode() === 'schedule'
      ? seg([['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly'], ['reminders', 'Reminders']], view(), v => { store.setPref('timelyView', v); render(); }, 'sub-tabs')
      : seg([['projects', 'Projects'], ['goals', 'Goals']], planBoard(), v => { store.setPref('timelyPlan', v); render(); }, 'sub-tabs'));
  if (mode() === 'plan') return renderPlan();
  ({ day: renderDay, week: renderWeek, month: renderMonth, reminders: renderReminders })[view()]();
}

function navControl(label, step, extra) {
  const a = anchor(), atToday = view() === 'day' ? a === todayKey()
    : view() === 'week' ? dateKey(startOfWeek(parseKey(a))) <= dateKey(startOfWeek(new Date()))
      : parseKey(a).getMonth() === new Date().getMonth() && parseKey(a).getFullYear() === new Date().getFullYear();
  return h('div', { class: 'time-nav' },
    h('button', { class: 'icon-btn tri-btn', 'aria-label': 'Previous', disabled: atToday, onclick: () => setAnchor(step(-1)) }, icon('chevL')),
    h('span', { class: 'time-label' }, label),
    h('button', { class: 'icon-btn tri-btn', 'aria-label': 'Next', onclick: () => setAnchor(step(1)) }, icon('chevR')),
    h('button', { class: 'chip ghost', disabled: atToday, onclick: () => setAnchor(todayKey()) }, 'Today'),
    h('span', { class: 'time-nav-extra' }, extra || null, archiveButton()));
}
function archiveButton() {
  const n = store.cardsWhere(c => isSched(c) && c.meta?.archivedAt).length;
  return n ? h('button', { class: 'chip ghost', onclick: openArchive, title: 'Past items are kept for 30 days' }, icon('archive'), `Archive ${n}`) : null;
}

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
    untimed.map(o => chip(o.card)),
    h('button', { class: 'icon-btn xs', 'aria-label': 'Add an any-time item', onclick: () => quickAdd({ date: key }) }, icon('plus')));
  const scroll = h('div', { class: 'day-scroll', 'data-autoscroll': '' });
  const grid = h('div', { class: 'day-grid', dataset: { drop: 'timely-day', accept: 'card', date: key } });
  scroll.append(grid);
  body.replaceChildren(
    navControl(label, n => dateKey(addDays(parseKey(key), n)),
      h('button', { class: 'chip ghost', onclick: () => exportDay(key), title: 'Download this day as an .ics calendar file' }, icon('calendar'), 'Export day')),
    allDay, scroll);

  // Size hours so 6am–8pm fills the visible window exactly.
  requestAnimationFrame(() => {
    const hourH = Math.max(36, scroll.clientHeight / 14);
    grid.style.setProperty('--hour', hourH + 'px');
    grid.style.height = hourH * 24 + 'px';
    for (let hr = 0; hr < 24; hr++) {
      grid.append(h('div', { class: 'hour-row', style: { top: hr * hourH + 'px', height: hourH + 'px' } },
        h('span', { class: 'hour-label' }, hr === 0 ? '' : fmtMinutes(hr * 60))));
    }
    for (const o of timed) grid.append(eventBlock(o.card, hourH));
    if (key === todayKey()) {
      const n = new Date(); const mins = n.getHours() * 60 + n.getMinutes();
      grid.append(h('div', { class: 'now-line', style: { top: (mins / 60) * hourH + 'px' } }));
    }
    scroll.scrollTop = 6 * hourH;
    grid.addEventListener('click', e => {
      if (e.target !== grid && !e.target.classList.contains('hour-row')) return;
      const y = e.clientY - grid.getBoundingClientRect().top;
      const start = clamp(Math.floor((y / hourH) * 2) * 30, 0, 23 * 60 + 30);
      const card = store.createCard({ type: 'event', tool: 'timely', title: 'New block', meta: { date: key, start, dur: 60 } });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const t = body.querySelector(`[data-id="${card.id}"] .ev-title`);
        if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
      }));
    });
  });
}

function eventBlock(c, hourH) {
  const m = c.meta;
  const dur = m.dur || 60;
  const el = h('article', {
    class: `event-block ${dur <= 30 ? 'short' : ''} ${m.kind === 'reminder' ? 'is-reminder' : ''}`, dataset: { drag: 'card', id: c.id },
    style: { top: (m.start / 60) * hourH + 'px', height: Math.max(18, (dur / 60) * hourH - 2) + 'px' },
  },
  h('span', { class: 'ev-title' }, c.title),
  h('span', { class: 'ev-time' }, `${fmtMinutes(m.start)}–${fmtMinutes(m.start + dur)}`, m.recurrence ? icon('repeat', 'ev-repeat') : null),
  h('button', { class: 'icon-btn xs ev-info', 'aria-label': 'Details', onclick: e => { e.stopPropagation(); openEventEditor(c.id); } }, icon('info')),
  h('div', { class: 'resize-handle', 'aria-hidden': 'true' }));
  el.querySelector('.ev-title').addEventListener('dblclick', e => { e.stopPropagation(); editInline(e.target, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  // Resize in 15-minute steps.
  el.querySelector('.resize-handle').addEventListener('pointerdown', e => {
    e.stopPropagation(); e.preventDefault();
    const sy = e.clientY, sd = dur;
    const move = ev => {
      const nd = clamp(Math.round((sd + ((ev.clientY - sy) / hourH) * 60) / 15) * 15, 15, 24 * 60 - m.start);
      el.style.height = Math.max(18, (nd / 60) * hourH - 2) + 'px';
      el.querySelector('.ev-time').firstChild.textContent = `${fmtMinutes(m.start)}–${fmtMinutes(m.start + nd)}`;
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

function chip(c, { showTime = false } = {}) {
  const m = c.meta || {};
  const el = h('div', { class: `t-chip ${m.kind === 'reminder' ? 'is-reminder' : ''}`, dataset: { drag: 'card', id: c.id }, title: c.title },
    showTime && m.start != null ? h('span', { class: 't-chip-time' }, fmtMinutes(m.start)) : null,
    h('span', { class: 't-chip-title' }, c.title),
    m.recurrence ? icon('repeat', 'ev-repeat') : null);
  el.addEventListener('dblclick', () => openEventEditor(c.id));
  return el;
}

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

// ---------- Weekly ----------
function renderWeek() {
  const a = parseKey(anchor());
  const ws = startOfWeek(a);
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const label = `${fmtShortDate(days[0])} – ${fmtShortDate(days[6])}`;
  const today = todayKey();
  const grid = h('div', { class: 'week-grid' });
  grid.append(h('div', { class: 'week-corner' }));
  for (const d of days) {
    const k = dateKey(d);
    grid.append(h('div', { class: `week-day-head ${k === today ? 'today' : ''} ${k < today ? 'past' : ''}` },
      h('span', {}, DAY_NAMES[d.getDay()].slice(0, 3)), h('strong', {}, d.getDate())));
  }
  const byDay = Object.fromEntries(days.map(d => [dateKey(d), occurrencesOn(dateKey(d))]));
  for (const slot of SLOTS) {
    grid.append(h('div', { class: 'week-slot-label' }, SLOT_LABELS[slot]));
    for (const d of days) {
      const k = dateKey(d);
      const items = byDay[k].filter(o => (o.card.meta.slot || (o.card.meta.start != null ? slotOfMinutes(o.card.meta.start) : 'morning')) === slot);
      const cell = h('div', {
        class: `week-cell ${k < today ? 'past' : ''} ${k === today ? 'today' : ''}`,
        dataset: { drop: 'timely-cell', accept: 'card', date: k, slot }, 'data-list': '',
      }, items.map(o => chip(o.card, { showTime: true })));
      if (k >= today) cell.append(h('button', { class: 'cell-add icon-btn xs', 'aria-label': `Add to ${SLOT_LABELS[slot]}`, onclick: () => quickAdd({ date: k, slot }) }, icon('plus')));
      grid.append(cell);
    }
  }
  body.replaceChildren(navControl(label, n => dateKey(addDays(ws, 7 * n))), grid);
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
    const occ = occurrencesOn(k);
    const inMonth = d.getMonth() === a.getMonth();
    const content = occ.length <= 2
      ? occ.map(o => h('div', { class: 'month-item' }, o.card.title))
      : h('div', { class: 'month-dots', 'aria-label': `${occ.length} items` }, occ.slice(0, 8).map(() => h('span', { class: 'mdot' })), occ.length > 8 ? h('span', { class: 'muted small' }, `+${occ.length - 8}`) : null);
    const cell = h('button', {
      class: `month-cell ${inMonth ? '' : 'out'} ${k < today ? 'past' : ''} ${k === today ? 'today' : ''}`,
      dataset: { drop: 'timely-month', accept: 'card', date: k },
      onclick: () => openDayOverlay(k),
    }, h('span', { class: 'month-num' }, d.getDate()), content);
    grid.append(cell);
  }
  const label = `${MONTH_NAMES[a.getMonth()]} ${a.getFullYear()}`;
  body.replaceChildren(navControl(label, n => { const m = addMonths(a, n); return dateKey(m < new Date() && n < 0 ? new Date() : m); }), grid);
}

function openDayOverlay(k) {
  const d = parseKey(k);
  const list = h('div', { class: 'modal-list' });
  const fill = () => {
    const occ = occurrencesOn(k);
    list.replaceChildren(...occ.map(o => {
      const m = o.card.meta;
      const r = h('div', { class: 'activity-row clickable' }, typeIcon(o.card.type), h('span', { class: 'activity-text' }, o.card.title),
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
      store.createCard({ type: 'event', tool: 'timely', title: input.value.trim(), meta: { date: k } });
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

// ---------- Reminders board ----------
function renderReminders() {
  const rem = store.cardsWhere(c => live(c) && c.meta.kind === 'reminder' && !c.meta.done);
  const nowMs = Date.now();
  const due = c => (c.meta.date ? parseKey(c.meta.date).getTime() + (c.meta.start ?? 23 * 60 + 59) * 60e3 : Infinity);
  rem.sort((a, b) => due(a) - due(b) || byOrder(a, b));
  const urgent = c => due(c) - nowMs < 24 * 3600e3;
  const input = h('input', { class: 'field-input', placeholder: 'Remind me to…', 'aria-label': 'New reminder', 'data-keep': 'rem-input' });
  const dateIn = h('input', { class: 'field-input sm', type: 'date', min: todayKey(), 'aria-label': 'Due date', 'data-keep': 'rem-date' });
  const timeIn = h('input', { class: 'field-input sm', type: 'time', 'aria-label': 'Due time', 'data-keep': 'rem-time' });
  const add = () => {
    if (!input.value.trim()) return;
    const [hh, mm] = (timeIn.value || '').split(':').map(Number);
    store.createCard({ type: 'event', tool: 'timely', title: input.value.trim(), meta: { kind: 'reminder', date: dateIn.value || null, start: timeIn.value ? hh * 60 + mm : null } });
    input.value = ''; dateIn.value = ''; timeIn.value = '';
  };
  input.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  const list = h('div', { class: 'rem-list', dataset: { drop: 'timely-reminders', accept: 'card' }, 'data-list': '' },
    rem.map(c => {
      const m = c.meta;
      const when = m.date ? `${m.date === todayKey() ? 'Today' : fmtShortDate(parseKey(m.date))}${m.start != null ? ` at ${fmtMinutes(m.start)}` : ''}` : 'No date';
      const overdue = due(c) < nowMs;
      const el = h('div', { class: `rem-item ${urgent(c) ? 'urgent' : ''} ${overdue ? 'overdue' : ''}`, dataset: { drag: 'card', id: c.id } },
        h('button', { class: 'check', 'aria-label': 'Complete reminder', onclick: e => { e.stopPropagation(); tick(); store.updateCard(c.id, { meta: { done: true } }, { log: true, logLabel: 'Completed' }); runMaintenance(); } }, icon('check')),
        h('span', { class: 'rem-title' }, c.title),
        h('span', { class: 'rem-when' }, overdue ? `Overdue · ${when}` : when, m.recurrence ? icon('repeat', 'ev-repeat') : null),
        h('button', { class: 'icon-btn xs', 'aria-label': 'Details', onclick: e => { e.stopPropagation(); openEventEditor(c.id); } }, icon('info')));
      return el;
    }));
  if (!rem.length) list.append(h('p', { class: 'empty-hint' }, 'No reminders. Add one above, or drop a card here.'));
  body.replaceChildren(h('div', { class: 'reminders' },
    h('div', { class: 'rem-add' }, input, dateIn, timeIn, h('button', { class: 'btn primary', onclick: add }, 'Add')),
    list));
}

function quickAdd(meta) {
  const card = store.createCard({ type: 'event', tool: 'timely', title: 'New item', meta });
  setTimeout(() => {
    const t = body.querySelector(`[data-id="${card.id}"] .t-chip-title`);
    if (t) editInline(t, { onCommit: v => store.updateCard(card.id, { title: v }) });
  }, 60);
}

// ---------- Event editor: time, recurrence, export ----------
export function openEventEditor(id) {
  const c = store.getCard(id);
  if (!c) return;
  let f = {};
  openEditor(id, {
    title: c.meta?.kind === 'reminder' ? 'Reminder' : 'Scheduled item',
    extra: card => {
      const m = card.meta || {};
      f.date = h('input', { class: 'field-input', type: 'date', min: todayKey(), value: m.date || '' });
      f.time = h('input', { class: 'field-input', type: 'time', value: m.start != null ? `${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : '' });
      const durs = [...new Set([15, 30, 45, 60, 90, 120, 180, m.dur || 60])].sort((a, b) => a - b);
      const durLabel = v => (v < 60 ? `${v} min` : v % 60 ? `${Math.floor(v / 60)} hr ${v % 60} min` : `${v / 60} hr`);
      f.dur = h('select', { class: 'field-input' }, durs.map(v => h('option', { value: v, selected: (m.dur || 60) === v }, durLabel(v))));
      f.slot = h('select', { class: 'field-input' }, h('option', { value: '' }, 'Any time'), SLOTS.map(s => h('option', { value: s, selected: m.slot === s }, SLOT_LABELS[s])));
      f.rec = h('select', { class: 'field-input' }, Object.entries(RECUR).map(([v, l]) => h('option', { value: v, selected: (m.recurrence || '') === v }, l)));
      const sync = () => { f.dur.disabled = !f.time.value; f.slot.disabled = !!f.time.value; };
      f.time.addEventListener('input', sync); sync();
      return h('div', { class: 'ical' },
        h('div', { class: 'ical-row' }, field('Date', f.date), field('Time', f.time), field('Length', f.dur)),
        h('div', { class: 'ical-row' }, field('Part of day', f.slot), field('Repeat', f.rec)),
        h('div', { class: 'ical-actions' },
          h('button', { class: 'chip', type: 'button', onclick: () => exportCard(store.getCard(id)) }, icon('calendar'), 'Export .ics'),
          h('button', { class: 'chip', type: 'button', onclick: () => sendToReminders(store.getCard(id)) }, icon('bell'), 'Send to Reminders')));
    },
    collect: (refs, card) => {
      const [hh, mm] = (f.time.value || '').split(':').map(Number);
      const start = f.time.value ? hh * 60 + mm : null;
      return {
        meta: {
          ...card.meta, date: f.date.value || (card.meta.kind === 'reminder' ? null : card.meta.date),
          start, dur: start != null ? +f.dur.value : card.meta.dur, slot: start != null ? null : f.slot.value || null,
          recurrence: f.rec.value || null,
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
  const lines = ['BEGIN:VEVENT', `UID:${c.id}@sedi`, `DTSTAMP:${stamp}`, `SUMMARY:${icsEsc(c.title)}`];
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
function exportDay(key) {
  const occ = occurrencesOn(key);
  if (!occ.length) return toast('Nothing on this day to export.');
  download(`sedi-${key}.ics`, wrapCal(occ.flatMap(o => vevent(o.card, key))), 'text/calendar');
  toast(`Exported ${occ.length} item${occ.length === 1 ? '' : 's'}`);
}

// ---------- Apple Reminders via Shortcuts ----------
const shortcutName = () => store.pref('reminderShortcut', 'Sedi Reminder');
export function sendToReminders(c) {
  if (!c) return;
  const m = c.meta || {};
  const parts = [c.title];
  if (m.date) parts.push(`${m.date}${m.start != null ? ` ${pad(Math.floor(m.start / 60))}:${pad(m.start % 60)}` : ''}`);
  const url = `shortcuts://run-shortcut?name=${encodeURIComponent(shortcutName())}&input=text&text=${encodeURIComponent(parts.join('\n'))}`;
  if (!store.pref('reminderShortcutReady')) return openRemindersSetup(url);
  location.href = url;
}
export function openRemindersSetup(pendingUrl) {
  const name = h('input', { class: 'field-input', value: shortcutName(), 'aria-label': 'Shortcut name' });
  modal({
    title: 'Send to Apple Reminders',
    body: h('div', { class: 'editor' },
      h('p', { class: 'muted' }, 'Sedi hands reminders to a one-time Apple Shortcut on your Mac or iPhone. Set it up once:'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Open the Shortcuts app and create a new shortcut.'),
        h('li', {}, 'Add the action “Split Text” (split Shortcut Input by New Lines).'),
        h('li', {}, 'Add “Add New Reminder”. Set its title to “First Item” from Split Text, and turn on the alert using “Last Item” as the date.'),
        h('li', {}, 'Name the shortcut exactly as below, and allow it to receive Text input.')),
      h('label', { class: 'field-label' }, 'Shortcut name'), name,
      h('p', { class: 'muted small' }, 'Works in Safari or Chrome on macOS and iOS. Your browser will ask to open Shortcuts the first time.')),
    actions: [
      { label: 'Cancel', kind: 'ghost' },
      {
        label: pendingUrl ? 'Done, send it' : 'Save', kind: 'primary', onClick: () => {
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

// ---------- Planning: carousel of containers ----------
const containers = () => store.get('planContainers', { projects: [], goals: [] });
const boardContainers = b => containers()[b] || [];
const planCards = (b, cid) => store.cardsWhere(c => isPlan(c) && c.meta.board === b && c.meta.containerId === cid).sort(byOrder);
export const DEFAULT_CONTAINERS = () => ({
  projects: ['Ideas', 'In motion', 'Wrapping up'].map(name => ({ id: uuid(), name })),
  goals: ['Health', 'Craft', 'People'].map(name => ({ id: uuid(), name })),
});
const VISIBLE = 3;

function renderPlan() {
  const b = planBoard();
  const list = boardContainers(b);
  const offsets = store.pref('planOffset', {});
  const off = clamp(offsets[b] || 0, 0, Math.max(0, list.length - VISIBLE));
  const setOff = v => { store.setPref('planOffset', { ...offsets, [b]: v }); render(); };
  const visible = list.slice(off, off + VISIBLE);
  const track = h('div', { class: 'plan-track', style: { '--cols': VISIBLE } }, visible.map(ct => containerEl(b, ct)));
  for (let i = visible.length; i < VISIBLE; i++) track.append(h('button', { class: 'plan-ghost', onclick: () => addContainer(b, list.length) }, icon('plus'), b === 'goals' ? 'Add a life outcome' : 'Add a project'));
  body.replaceChildren(h('div', { class: 'plan' },
    h('button', { class: 'carousel-btn left', 'aria-label': 'Previous containers', disabled: off === 0, onclick: () => setOff(off - 1) }, h('span', { class: 'tri' })),
    track,
    h('button', { class: 'carousel-btn right', 'aria-label': 'Next containers', disabled: off + VISIBLE >= list.length, onclick: () => setOff(off + 1) }, h('span', { class: 'tri' })),
    h('button', { class: 'plan-add icon-btn', 'aria-label': 'Add container', title: 'Add container', onclick: () => addContainer(b, list.length) }, icon('plus'))));
}

function containerEl(b, ct) {
  const cards = planCards(b, ct.id);
  const name = h('h2', { class: 'ct-name', tabindex: 0 }, ct.name);
  name.addEventListener('click', () => editInline(name, { onCommit: v => saveContainers(b, boardContainers(b).map(x => (x.id === ct.id ? { ...x, name: v } : x))) }));
  const input = h('input', { class: 'task-input', placeholder: b === 'goals' ? 'Add a sub-goal' : 'Add a task', 'aria-label': 'Add card', 'data-keep': `ct-${ct.id}` });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) {
      store.createCard({ type: b === 'goals' ? 'goal' : 'task', tool: 'timely', title: input.value.trim(), meta: { board: b, containerId: ct.id, order: cards.length } });
      input.value = '';
    }
  });
  const listEl = h('div', { class: 'ct-list', dataset: { drop: 'plan-container', accept: 'card', container: ct.id, board: b }, 'data-list': '', 'data-autoscroll': '' },
    cards.map(c => {
      const t = h('span', { class: 'pc-title', title: c.title }, c.title);
      t.addEventListener('dblclick', e => { e.stopPropagation(); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
      return h('div', { class: 'plan-card', dataset: { drag: 'card', id: c.id } }, typeIcon(c.type), t,
        h('button', { class: 'icon-btn xs', 'aria-label': 'Details', onclick: e => { e.stopPropagation(); openEditor(c.id, { title: b === 'goals' ? 'Sub-goal' : 'Task' }); } }, icon('info')));
    }));
  return h('section', { class: 'ct' },
    h('button', { class: 'ct-x icon-btn xs', 'aria-label': `Delete ${ct.name}`, onclick: () => deleteContainer(b, ct) }, icon('x')),
    h('header', { class: 'ct-head' }, name, h('span', { class: 'col-count' }, cards.length || '')),
    listEl, input);
}

registerDrop('plan-container', ({ id, data, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const type = data.board === 'goals' ? 'goal' : 'task';
  const meta = { board: data.board, containerId: data.container, order: index ?? 0 };
  if (c.tool !== 'timely') routeCard(id, { tool: 'timely', type, meta });
  else store.updateCard(id, { type, meta }, { replaceMeta: true });
  reorder(planCards(data.board, data.container), id, index);
});

function saveContainers(b, list) { store.set('planContainers', { ...containers(), [b]: list }); }
function addContainer(b, at) {
  const ct = { id: uuid(), name: b === 'goals' ? 'New outcome' : 'New project' };
  const list = [...boardContainers(b), ct];
  saveContainers(b, list);
  const offsets = store.pref('planOffset', {});
  store.setPref('planOffset', { ...offsets, [b]: Math.max(0, list.length - VISIBLE) });
  setTimeout(() => { const n = [...body.querySelectorAll('.ct-name')].at(-1); if (n) n.click(); }, 60);
  void at;
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
