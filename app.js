// Sedi — boot: hydrate local state, build the shell, route, and keep views in sync with the store.

import * as store from './js/store.js';
import { h, $, debounce, todayKey, toast, fitTitles } from './js/util.js';
import { initDnd } from './js/dnd.js';
import {
  buildHeader, buildDrawer, buildNavigator, buildUniversal, buildTrash,
  currentRoute, navigate, markActiveRoute, renderUniversal, maybeNudgeUniversal, showDataInfo, exportData,
} from './js/shell.js';
import { dataNudges } from './js/datainfo.js';
import { buildAssistant } from './js/assistant.js';
import { seedIfEmpty } from './js/onboarding.js';
import { initWhatsNew } from './js/whatsnew.js';
import { runMaintenance } from './js/timely.js';
import * as home from './js/home.js';
import * as taskly from './js/taskly.js';
import * as boardly from './js/boardly.js';
import * as timely from './js/timely.js';
import * as brainly from './js/brainly.js';

const VIEWS = { home, taskly, boardly, timely, brainly };
let viewEl, active = null, renderQueued = false;

/** Another site showing Sedi inside a frame could trick clicks, so Sedi only runs in its own tab
 *  (the in-chat sandbox preview is the one exception). */
function framedByAnotherSite() {
  if (window.SEDI_SANDBOX) return false;
  try { if (window.top === window.self) return false; } catch {}
  document.getElementById('app').replaceChildren(h('p', { style: { padding: '24px', fontFamily: 'system-ui' } },
    'Sedi opens in its own tab. ', h('a', { href: location.href, target: '_top', rel: 'noopener' }, 'Open Sedi')));
  return true;
}

async function boot() {
  if (framedByAnotherSite()) return;
  await store.init();
  const fresh = seedIfEmpty() !== false;
  runMaintenance();

  viewEl = h('main', { id: 'view', class: 'view-host' });
  document.getElementById('app').replaceChildren(
    buildHeader(), viewEl, buildDrawer(), buildNavigator(), buildUniversal(), buildTrash(), buildAssistant());
  // Toasts live outside #app so their Undo buttons still work while a dialog makes the page inert.
  document.body.append(h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }));

  initDnd(navigate);
  addEventListener('hashchange', mountRoute);
  mountRoute();
  renderUniversal();

  store.on(() => renderAll());
  addEventListener('resize', debounce(() => renderAll(true), 120));
  document.addEventListener('focusout', () => { if (renderQueued) setTimeout(() => renderAll(), 0); });

  // Day rollover + hourly archive pass.
  let day = todayKey();
  setInterval(() => {
    if (todayKey() !== day) { day = todayKey(); runMaintenance(); renderAll(true); }
  }, 60e3);
  setInterval(runMaintenance, 60 * 60e3);

  addEventListener('online', () => document.body.classList.remove('offline'));
  addEventListener('offline', () => { document.body.classList.add('offline'); toast('You’re offline. Everything keeps working.'); });
  if (!navigator.onLine) document.body.classList.add('offline');

  registerServiceWorker();
  setTimeout(maybeNudgeUniversal, 4000);
  initWhatsNew({ fresh });
  dataNudges({ onBackup: exportData, onOpen: showDataInfo });
  // The in-chat preview can't reach the microphone, the weather service or model downloads.
  if (window.SEDI_SANDBOX) setTimeout(() => toast('Sandbox preview. Voice and weather need the real app.', { duration: 5000 }), 900);
}

function mountRoute() {
  const route = currentRoute();
  if (!location.hash) history.replaceState(null, '', `#/${route}`);
  if (active?.name === route) return;
  active?.mod.unmount?.();
  document.body.dataset.route = route;
  // First visits: keep the tool buttons visible on Home until a tool has been opened once.
  if (route !== 'home' && !store.pref('navLearned')) store.setPref('navLearned', true);
  document.body.classList.toggle('nav-learn', !store.pref('navLearned'));
  markActiveRoute(route);
  const mod = VIEWS[route];
  active = { name: route, mod };
  viewEl.classList.remove('enter');
  void viewEl.offsetWidth;
  viewEl.classList.add('enter');
  safely(() => mod.mount(viewEl), route);
  refit();
  document.title = route === 'home' ? 'Sedi' : `${route[0].toUpperCase() + route.slice(1)} · Sedi`;
}

/** If something in the data stops a view from drawing, say so and keep the rest of Sedi working,
 *  instead of a blank screen. Nothing is deleted; the person can back up and get help. */
function safely(fn, route) {
  try { fn(); }
  catch (err) {
    console.error(err);
    const name = route[0].toUpperCase() + route.slice(1);
    viewEl.replaceChildren(h('div', { class: 'view-error' },
      h('h2', {}, `${name} couldn’t open`),
      h('p', {}, 'Something in your saved data looks damaged, often from an imported file. Your cards are still saved. Download a backup, then try undoing the last import or reloading.'),
      h('div', { class: 'view-error-actions' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => exportData() }, 'Download data'),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => location.reload() }, 'Reload'))));
  }
}

/** Re-render the visible view, but never while someone is typing inside it. */
// Card titles are fitted to one line once the view has its final widths.
const refit = () => requestAnimationFrame(() => requestAnimationFrame(() => viewEl && fitTitles(viewEl)));
document.fonts?.ready.then(() => refit()); // widths change once the real font arrives
function renderAll(force = false) {
  renderUniversal();
  const ae = document.activeElement;
  // "Capture" inputs (data-keep) survive a re-render: we restore focus, text and caret afterwards.
  const keep = ae?.dataset?.keep && viewEl.contains(ae) ? { key: ae.dataset.keep, value: ae.value, pos: ae.selectionStart } : null;
  const editing = !keep && ae && viewEl.contains(ae) && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
  if (editing && !force) { renderQueued = true; return; }
  if (document.body.classList.contains('is-dragging')) { renderQueued = true; setTimeout(() => renderAll(), 300); return; }
  renderQueued = false;
  if (active?.mod.render) safely(() => active.mod.render(), active.name);
  refit();
  if (keep) {
    const el = viewEl.querySelector(`[data-keep="${CSS.escape(keep.key)}"]`);
    if (el && el !== document.activeElement) {
      el.value = keep.value;
      el.focus();
      try { el.setSelectionRange(keep.pos, keep.pos); } catch {}
    }
  }
}

function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
  // A new version installs in the background and waits; "Reload" switches over, so old and new code never mix.
  const offer = w => toast('A new version of Sedi is ready.', { action: 'Reload', duration: 15000, onAction: () => w.postMessage('skipWaiting') });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!reloading) { reloading = true; location.reload(); } });
  navigator.serviceWorker.register('./sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w);
      });
    });
  }).catch(() => {});
}

boot().catch(err => {
  console.error(err);
  const app = $('#app');
  if (app) app.replaceChildren(h('div', { class: 'boot-error' }, h('h1', {}, 'Sedi couldn’t start'), h('p', {}, String(err?.message || err))));
});
