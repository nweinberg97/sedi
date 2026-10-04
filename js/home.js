// Sedi — Home: the morning-sky dashboard with clock, weather, Next Up and Recent Activity.

import * as store from './store.js';
import { h, icon, fmtLongDate, pad, popover, modal, relTime, todayKey, fmtMinutes } from './util.js';
import { typeIcon, peekBody, byOrder, TOOL_NAMES } from './cards.js';
import { navigate } from './shell.js';
import { occurrencesOn, SLOT_LABELS } from './timely.js';

let root, clockTime, clockDate, weatherEl, nextCol, recentCol, timer;

export function mount(el) {
  root = el;
  clockTime = h('div', { class: 'clock-time', 'aria-live': 'off' });
  clockDate = h('div', { class: 'clock-date' });
  weatherEl = h('button', { class: 'weather', onclick: () => loadWeather(true) });
  nextCol = h('div', { class: 'home-stack' });
  recentCol = h('div', { class: 'home-stack' });
  root.replaceChildren(h('div', { class: 'home' },
    h('section', { class: 'hero glass' }, clockTime, h('div', { class: 'hero-sub' }, clockDate, weatherEl)),
    h('div', { class: 'home-cols' },
      h('section', { class: 'home-col glass' },
        h('button', { class: 'home-col-head', onclick: openNextUpList }, h('h2', {}, 'Next up'), h('span', { class: 'see-all' }, 'See all')),
        nextCol),
      h('section', { class: 'home-col glass' },
        h('button', { class: 'home-col-head', onclick: openActivityList }, h('h2', {}, 'Recent activity'), h('span', { class: 'see-all' }, 'See all')),
        recentCol))));
  tickClock();
  timer = setInterval(tickClock, 1000);
  renderWeather();
  loadWeather(false);
  render();
}
export function unmount() { clearInterval(timer); }

function tickClock() {
  const d = new Date();
  const hh = d.getHours() % 12 || 12;
  clockTime.textContent = `${hh}:${pad(d.getMinutes())}`;
  clockTime.dataset.ampm = d.getHours() < 12 ? 'am' : 'pm';
  clockDate.textContent = fmtLongDate(d);
}

// ---------- Next Up + Recent ----------
export function nextUpItems(limit = 3) {
  const items = [];
  const top = store.cardsWhere(c => c.tool === 'taskly' && c.meta?.columnId === 'todo').sort(byOrder)[0];
  if (top) items.push({ card: top, label: 'Top task' });
  for (const occ of occurrencesOn(todayKey())) {
    const m = occ.card.meta || {};
    const label = m.kind === 'reminder' ? (m.start != null ? `Reminder ${fmtMinutes(m.start)}` : 'Reminder')
      : m.start != null ? fmtMinutes(m.start) : m.slot ? SLOT_LABELS[m.slot] : 'Today';
    items.push({ card: occ.card, label });
  }
  return items.slice(0, limit);
}

function row(card, label) {
  const el = h('div', { class: 'home-card', tabindex: 0, role: 'button' },
    typeIcon(card.type),
    h('span', { class: 'home-card-title' }, card.title),
    label ? h('span', { class: 'home-card-label' }, label) : null,
    h('button', {
      class: 'icon-btn sm', 'aria-label': 'Show details',
      onclick: e => { e.stopPropagation(); popover(e.currentTarget, peekBody(card), { className: 'peek-pop' }); },
    }, icon('info')));
  const go = () => navigate(card.tool === 'universal' ? 'home' : card.tool);
  el.addEventListener('click', go);
  el.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  return el;
}

export function render() {
  if (!root?.isConnected) return;
  const next = nextUpItems(3);
  nextCol.replaceChildren(...(next.length ? next.map(i => row(i.card, i.label))
    : [h('p', { class: 'home-empty' }, 'Nothing scheduled. Add a task in Taskly or a block in Timely.')]));
  const recent = store.allCards().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 3);
  recentCol.replaceChildren(...(recent.length ? recent.map(c => row(c, relTime(c.updatedAt)))
    : [h('p', { class: 'home-empty' }, 'Your latest changes will show up here.')]));
}

function openNextUpList() {
  const tasks = store.cardsWhere(c => c.tool === 'taskly' && c.meta?.columnId === 'todo').sort(byOrder);
  const days = [];
  for (let i = 0; i < 14; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const occ = occurrencesOn(todayKeyOf(d));
    if (occ.length) days.push({ d, occ });
  }
  const list = h('div', { class: 'modal-list' });
  if (tasks.length) {
    list.append(h('h4', { class: 'list-sub' }, 'To do in Taskly'));
    tasks.forEach(c => list.append(row(c, null)));
  }
  for (const { d, occ } of days) {
    list.append(h('h4', { class: 'list-sub' }, i18nDay(d)));
    occ.forEach(o => list.append(row(o.card, o.card.meta?.start != null ? fmtMinutes(o.card.meta.start) : SLOT_LABELS[o.card.meta?.slot] || '')));
  }
  if (!list.children.length) list.append(h('p', { class: 'muted' }, 'Nothing coming up in the next two weeks.'));
  modal({ title: 'Next up', body: list, wide: true });
}
const todayKeyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const i18nDay = d => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

function openActivityList() {
  const log = store.get('activity', []);
  const list = h('div', { class: 'modal-list' });
  for (const e of log) {
    const card = store.getCard(e.id);
    const item = h('div', { class: `activity-row ${card ? '' : 'gone'}` },
      typeIcon(e.type),
      h('span', { class: 'activity-text' }, h('strong', {}, e.action), ' ', e.title),
      h('span', { class: 'muted small' }, `${TOOL_NAMES[e.tool] || ''} · ${relTime(e.at)}`));
    if (card) { item.classList.add('clickable'); item.addEventListener('click', () => { navigate(card.tool === 'universal' ? 'home' : card.tool); document.querySelector('.modal-backdrop .icon-btn')?.click(); }); }
    list.append(item);
  }
  if (!log.length) list.append(h('p', { class: 'muted' }, 'No activity yet.'));
  modal({ title: 'Recent activity', body: list, wide: true });
}

// ---------- Weather (Open-Meteo, cached 30 min) ----------
const WMO = [
  [[0], '☀️', 'Clear'], [[1], '🌤️', 'Mostly clear'], [[2], '⛅', 'Partly cloudy'], [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Rain'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'], [[95, 96, 99], '⛈️', 'Storm'],
];
const describe = (code, isDay) => {
  const hit = WMO.find(([codes]) => codes.includes(code)) || [[], '🌡️', 'Weather'];
  let emoji = hit[1];
  if (!isDay && code <= 1) emoji = '🌙';
  return { emoji, label: hit[2] };
};

function renderWeather() {
  const w = store.pref('weather');
  if (w?.temp != null) {
    const { emoji, label } = describe(w.code, w.isDay);
    weatherEl.replaceChildren(h('span', {}, emoji), h('span', {}, `${label}, ${Math.round(w.temp)}°C`));
    weatherEl.title = navigator.onLine ? `Updated ${relTime(w.at)}` : `Offline · last updated ${relTime(w.at)}`;
  } else if (store.pref('weatherDenied')) {
    weatherEl.replaceChildren(h('span', {}, 'Show weather'));
    weatherEl.title = 'Uses your location once to fetch the forecast from Open-Meteo';
  } else {
    weatherEl.replaceChildren(h('span', { class: 'muted' }, ' '));
  }
}

async function loadWeather(userAsked) {
  const cached = store.pref('weather');
  if (!userAsked && cached && Date.now() - new Date(cached.at).getTime() < 30 * 60e3) return;
  if (!navigator.onLine) return renderWeather();
  if (!userAsked && store.pref('weatherDenied')) return renderWeather();
  let coords = store.pref('coords');
  if (!coords || userAsked) {
    coords = await new Promise(res => {
      if (!navigator.geolocation) return res(null);
      navigator.geolocation.getCurrentPosition(p => res({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }), () => res(null), { timeout: 10000, maximumAge: 3600e3 });
    });
    if (!coords) { store.setPref('weatherDenied', true); return renderWeather(); }
    store.setPref('weatherDenied', false);
    store.setPref('coords', coords);
  }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`;
    const res = await fetch(url);
    const j = await res.json();
    store.setPref('weather', { at: new Date().toISOString(), temp: j.current.temperature_2m, code: j.current.weather_code, isDay: !!j.current.is_day });
  } catch { /* keep last known */ }
  renderWeather();
}
