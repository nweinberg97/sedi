// Sedi — Home: the morning-sky dashboard with clock, weather, Next Up and Recent Activity.

import * as store from './store.js';
import { h, icon, fmtLongDate, pad, popover, closePopovers, modal, relTime, todayKey, fmtMinutes, debounce } from './util.js';
import { mountLiquidGlass } from './glass.js';
import { typeIcon, peekBody, byOrder, TOOL_NAMES } from './cards.js';
import { navigate } from './shell.js';
import { occurrencesOn, SLOT_LABELS } from './timely.js';

let root, clockTime, clockDate, weatherEl, nextCol, recentCol, timer, weatherTimer, glassCleanup;

export function mount(el) {
  root = el;
  clockTime = h('div', { class: 'clock-time', 'aria-live': 'off' });
  clockDate = h('div', { class: 'clock-date' });
  weatherEl = h('button', { class: 'weather', 'aria-label': 'Weather', onclick: e => openWeatherMenu(e.currentTarget) });
  nextCol = h('div', { class: 'home-stack' });
  recentCol = h('div', { class: 'home-stack' });
  root.replaceChildren(h('div', { class: 'home' },
    h('section', { class: 'hero' }, h('div', { class: 'clock-glass liquid-glass' }, h('div', { class: 'lg-content' }, clockTime)), clockDate, weatherEl),
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
  weatherTimer = setInterval(() => loadWeather(false), 10 * 60e3);
  glassCleanup = mountLiquidGlass(root.querySelector('.clock-glass'), { refract: false });
  render();
}
export function unmount() { clearInterval(timer); clearInterval(weatherTimer); glassCleanup?.(); }

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
  [[0], '☀️', 'Sunny'], [[1], '🌤️', 'Mostly sunny'], [[2], '⛅', 'Partly cloudy'], [[3], '☁️', 'Cloudy'],
  [[45, 48], '🌫️', 'Fog'], [[51, 53, 55, 56, 57], '🌦️', 'Drizzle'], [[61, 63, 65, 66, 67, 80, 81, 82], '🌧️', 'Rain'],
  [[71, 73, 75, 77, 85, 86], '🌨️', 'Snow'], [[95, 96, 99], '⛈️', 'Storm'],
];
const describe = (code, isDay) => {
  const hit = WMO.find(([codes]) => codes.includes(code)) || [[], '🌡️', 'Weather'];
  let emoji = hit[1];
  if (!isDay && code <= 1) return { emoji: '🌙', label: code === 0 ? 'Clear' : 'Mostly clear' };
  return { emoji, label: hit[2] };
};

function renderWeather() {
  const w = store.pref('weather');
  const place = store.pref('coords')?.name;
  if (w?.temp != null) {
    const { emoji, label } = describe(w.code, w.isDay);
    weatherEl.replaceChildren(h('span', { class: 'wx-emoji' }, emoji), h('span', {}, `${Math.round(w.temp)}°C ${label}`));
    weatherEl.title = `${place ? `${place}. ` : ''}${navigator.onLine ? `Updated ${relTime(w.at)}` : `Offline, last updated ${relTime(w.at)}`}. Click to change location.`;
  } else if (store.pref('weatherState') === 'loading') {
    weatherEl.replaceChildren(h('span', { class: 'wx-emoji' }, '🌤️'), h('span', { class: 'muted' }, 'Getting weather…'));
  } else if (store.pref('weatherState') === 'error') {
    weatherEl.replaceChildren(h('span', { class: 'wx-emoji' }, '🌡️'), h('span', {}, 'Weather unavailable'));
    weatherEl.title = 'Click to try again or set your city';
  } else {
    weatherEl.replaceChildren(h('span', { class: 'wx-emoji' }, '📍'), h('span', {}, 'Set your city for weather'));
    weatherEl.title = 'Choose a city, or use your location';
  }
}

/** Ask the browser for a location once; resolves null if blocked, unavailable or slow. */
function locate() {
  return new Promise(res => {
    if (!navigator.geolocation) return res(null);
    navigator.geolocation.getCurrentPosition(
      p => res({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2), name: null }),
      () => res(null), { timeout: 8000, maximumAge: 3600e3 });
  });
}

async function loadWeather(force) {
  const cached = store.pref('weather');
  if (!force && cached?.temp != null && Date.now() - new Date(cached.at).getTime() < 30 * 60e3) return renderWeather();
  if (!navigator.onLine) return renderWeather();
  let coords = store.pref('coords');
  if (!coords) {
    store.setPref('weatherState', 'loading'); renderWeather();
    // Use precise location only if it's already allowed; otherwise start from the device's time-zone city.
    let state = 'prompt';
    try { state = (await navigator.permissions?.query({ name: 'geolocation' }))?.state || 'prompt'; } catch {}
    if (state === 'granted') coords = await locate();
    if (!coords) coords = await cityFromTimeZone();
    if (!coords) { store.setPref('weatherState', 'error'); return renderWeather(); }
    store.setPref('coords', coords);
  }
  await fetchWeather(coords);
}

/** "America/Vancouver" → Vancouver's coordinates, without asking for location permission. */
async function cityFromTimeZone() {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  const city = tz.split('/').pop()?.replace(/_/g, ' ');
  if (!city || /^(UTC|GMT|Etc)/i.test(city)) return null;
  const hit = (await geocode(city)).find(r => !r.timezone || r.timezone === tz) || (await geocode(city))[0];
  return hit ? { lat: +hit.latitude.toFixed(2), lon: +hit.longitude.toFixed(2), name: hit.name } : null;
}
async function geocode(q) {
  try {
    const r = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=en&format=json`, { cache: 'no-store' });
    if (!r.ok) return [];
    return (await r.json()).results || [];
  } catch { return []; }
}

async function fetchWeather(coords) {
  if (!cachedWeatherFresh()) { store.setPref('weatherState', 'loading'); renderWeather(); }
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}&current=temperature_2m,weather_code,is_day&timezone=auto`;
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    store.setPref('weather', { at: new Date().toISOString(), temp: j.current.temperature_2m, code: j.current.weather_code, isDay: !!j.current.is_day });
    store.setPref('weatherState', null);
  } catch {
    store.setPref('weatherState', store.pref('weather')?.temp != null ? null : 'error');
  }
  renderWeather();
}
const cachedWeatherFresh = () => store.pref('weather')?.temp != null;

/** Popover: search a city (Open-Meteo geocoding) or use the device location. */
function openWeatherMenu(anchor) {
  const input = h('input', { class: 'field-input sm', placeholder: 'Search a city', 'aria-label': 'City' });
  const list = h('div', { class: 'wx-results' });
  const note = h('p', { class: 'muted small wx-note' });
  const pick = async c => {
    store.setPref('coords', c);
    closePopovers();
    await fetchWeather(c);
  };
  const search = debounce(async () => {
    const q = input.value.trim();
    if (q.length < 2) { list.replaceChildren(); return; }
    try {
      const results = await geocode(q);
      list.replaceChildren(...(results.length ? results.map(x => {
        const name = [x.name, x.admin1, x.country_code].filter(Boolean).join(', ');
        return h('button', { class: 'wx-result', type: 'button', onclick: () => pick({ lat: +x.latitude.toFixed(2), lon: +x.longitude.toFixed(2), name: x.name }) }, name);
      }) : [h('p', { class: 'muted small' }, navigator.onLine ? 'No matching city.' : 'Search needs a connection.')]));
    } catch { list.replaceChildren(h('p', { class: 'muted small' }, 'Search needs a connection.')); }
  }, 250);
  input.addEventListener('input', search);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') list.querySelector('.wx-result')?.click(); });
  const useLoc = h('button', {
    class: 'chip', type: 'button', onclick: async () => {
      note.textContent = 'Asking your browser for your location…';
      const c = await locate();
      if (c) pick(c);
      else note.textContent = 'Location is blocked. On a Mac, allow it in System Settings → Privacy & Security → Location Services for your browser, or search a city above.';
    },
  }, icon('send'), 'Use my location');
  const current = store.pref('coords');
  popover(anchor, h('div', { class: 'wx-menu' },
    h('strong', {}, 'Weather location'),
    current?.name ? h('p', { class: 'muted small' }, `Showing ${current.name}`) : null,
    input, list, useLoc, note), { className: 'wx-pop' });
  setTimeout(() => input.focus(), 30);
}
