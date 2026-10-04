// Sedi — boot: hydrate local state, build the shell, route, and keep views in sync with the store.

import * as store from './js/store.js';
import { h, $, debounce, todayKey, toast } from './js/util.js';
import { initDnd } from './js/dnd.js';
import {
  buildHeader, buildDrawer, buildNavigator, buildUniversal, buildTrash,
  currentRoute, navigate, markActiveRoute, renderUniversal,
} from './js/shell.js';
import { buildAssistant } from './js/assistant.js';
import { seedIfEmpty } from './js/onboarding.js';
import { runMaintenance } from './js/timely.js';
import * as home from './js/home.js';
import * as taskly from './js/taskly.js';
import * as boardly from './js/boardly.js';
import * as timely from './js/timely.js';
import * as brainly from './js/brainly.js';

const VIEWS = { home, taskly, boardly, timely, brainly };
let viewEl, active = null, renderQueued = false;

async function boot() {
  await store.init();
  seedIfEmpty();
  runMaintenance();

  viewEl = h('main', { id: 'view', class: 'view-host' });
  document.getElementById('app').replaceChildren(
    buildHeader(), viewEl, buildDrawer(), buildNavigator(), buildUniversal(), buildTrash(), buildAssistant(),
    h('div', { id: 'toasts', class: 'toasts', 'aria-live': 'polite' }));

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
}

function mountRoute() {
  const route = currentRoute();
  if (!location.hash) history.replaceState(null, '', `#/${route}`);
  if (active?.name === route) return;
  active?.mod.unmount?.();
  document.body.dataset.route = route;
  markActiveRoute(route);
  const mod = VIEWS[route];
  active = { name: route, mod };
  viewEl.classList.remove('enter');
  void viewEl.offsetWidth;
  viewEl.classList.add('enter');
  mod.mount(viewEl);
  document.title = route === 'home' ? 'Sedi' : `${route[0].toUpperCase() + route.slice(1)} · Sedi`;
}

/** Re-render the visible view, but never while someone is typing inside it. */
function renderAll(force = false) {
  renderUniversal();
  const ae = document.activeElement;
  // "Capture" inputs (data-keep) survive a re-render: we restore focus, text and caret afterwards.
  const keep = ae?.dataset?.keep && viewEl.contains(ae) ? { key: ae.dataset.keep, value: ae.value, pos: ae.selectionStart } : null;
  const editing = !keep && ae && viewEl.contains(ae) && (ae.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName));
  if (editing && !force) { renderQueued = true; return; }
  if (document.body.classList.contains('is-dragging')) { renderQueued = true; setTimeout(() => renderAll(), 300); return; }
  renderQueued = false;
  active?.mod.render?.();
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
  navigator.serviceWorker.register('./sw.js').then(reg => {
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      w?.addEventListener('statechange', () => {
        if (w.state === 'installed' && navigator.serviceWorker.controller) {
          toast('A new version of Sedi is ready.', { action: 'Reload', onAction: () => location.reload() });
        }
      });
    });
  }).catch(() => {});
}

boot().catch(err => {
  console.error(err);
  const app = $('#app');
  if (app) app.replaceChildren(h('div', { class: 'boot-error' }, h('h1', {}, 'Sedi couldn’t start'), h('p', {}, String(err?.message || err))));
});
