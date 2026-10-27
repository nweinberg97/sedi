// Sedi — what's new, shown once, in place. When a feature ships, the first time you're somewhere it lives,
// the page softly dims, a ring of light draws itself around the thing that changed, and two lines say what
// it does (sometimes the feature shows itself off, too). Any click carries on. Each one appears once, at
// most one at a time, never while you're typing or dragging, and only after you've settled for a moment.
// People new to Sedi don't get these: the welcome tour already covers everything.

import * as store from './store.js';
import { h } from './util.js';

const GAP_MS = 3 * 60e3;      // at least this long between two of them
const SETTLE_MS = 1400;       // you've been still on the page this long

// Newest last. `where` is a route ('*' = anywhere); `target` is what gets the spotlight.
const FEATURES = [
  { id: '2026-10-unload-mode', where: '*', target: '.assistant-token', title: 'Unload, a new mode in Atom', body: 'Open Atom and switch to Unload, then just talk. Sedi pulls out anything that could be a card.' },
  { id: '2026-10-magnet-dock', where: '*', target: '.universal-trigger', title: 'Toss it home', body: 'Drag Atom or this button anywhere. Let go near its spot and it clicks back into place.', demo: 'dock' },
  { id: '2026-10-day-side', where: 'timely', target: '.side-switch', title: 'Plan from your week', body: 'Switch to Week or Month here, then drag something onto a time.' },
  { id: '2026-10-categories', where: 'timely', target: '.event-block', title: 'Color by part of life', body: 'Open any block and pick a category, like Health or Work, to color it.' },
  { id: '2026-10-stretch', where: 'boardly', target: '.board-canvas > .tile:not(.note-card)', title: 'Stretch a card', body: 'Drag a card’s right edge to make it wider, so a long goal reads in full.' },
  { id: '2026-10-send-list', where: 'taskly', target: '.col-head .send-list', title: 'Send a list', body: 'Send any column to Claude or ChatGPT with everything typed in, or copy it.' },
];

const seen = () => new Set(store.pref('seenFeatures', []));
const markSeen = id => store.setPref('seenFeatures', [...seen(), id].slice(-200));
let lastShown = 0, showing = null, timer = null;

/** Call once at start. `fresh` = this is a brand-new Sedi (the tour covers what's new). */
export function initWhatsNew({ fresh = false } = {}) {
  if (store.pref('seenFeatures') == null) store.setPref('seenFeatures', fresh && !window.SEDI_SANDBOX ? FEATURES.map(f => f.id) : []);
  addEventListener('hashchange', schedule);
  schedule();
  // Sandbox only: Shift+N plays them again, for reviewing.
  if (window.SEDI_SANDBOX) document.addEventListener('keydown', e => {
    if (!(e.shiftKey && e.code === 'KeyN') || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    store.setPref('seenFeatures', []); lastShown = 0; schedule(300);
  });
}

function schedule(delay = SETTLE_MS) {
  clearTimeout(timer);
  timer = setTimeout(tryShow, typeof delay === 'number' ? delay : SETTLE_MS);
}
const busy = () => document.body.classList.contains('is-dragging') || document.querySelector('.modal-backdrop, .popover, .assistant-tray:not([hidden]), .universal.open')
  || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;

function tryShow() {
  if (showing || Date.now() - lastShown < GAP_MS && lastShown) return;
  if (busy() || document.hidden) return schedule(4000);
  const route = document.body.dataset.route, done = seen();
  for (const f of FEATURES) {
    if (done.has(f.id) || (f.where !== '*' && f.where !== route)) continue;
    const el = document.querySelector(f.target);
    if (!el || !visible(el)) continue;
    return spotlight(f, el);
  }
}
function visible(el) {
  const r = el.getBoundingClientRect();
  return r.width > 4 && r.height > 4 && r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth && getComputedStyle(el).visibility !== 'hidden';
}

function spotlight(f, el) {
  markSeen(f.id);
  lastShown = Date.now();
  const r = el.getBoundingClientRect();
  const pad = 10, size = Math.max(r.width, r.height) + pad * 2;
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const round = Math.abs(r.width - r.height) < 8; // round controls get a circle; anything else a soft rounded box
  const w = round ? size : r.width + pad * 2, hgt = round ? size : r.height + pad * 2;
  const ring = h('div', { class: `wn-ring ${round ? 'round' : ''}`, style: { left: cx - w / 2 + 'px', top: cy - hgt / 2 + 'px', width: w + 'px', height: hgt + 'px' } });
  const card = h('div', { class: 'wn-card', role: 'status' },
    h('span', { class: 'wn-new' }, 'New'),
    h('strong', {}, f.title), h('p', {}, f.body),
    h('button', { class: 'wn-ok', type: 'button' }, 'Got it'));
  const layer = h('div', { class: 'wn-layer', 'aria-live': 'polite' }, ring, card);
  document.body.append(layer);
  // The card sits beside the ring, on whichever side has room.
  const cw = Math.min(280, innerWidth - 32);
  card.style.width = cw + 'px';
  const right = cx < innerWidth / 2, below = cy < innerHeight / 2;
  const left = right ? Math.min(innerWidth - cw - 16, cx + w / 2 + 14) : Math.max(16, cx - w / 2 - 14 - cw);
  const fitsSide = right ? cx + w / 2 + 14 + cw < innerWidth - 8 : cx - w / 2 - 14 - cw > 8;
  const ch = card.offsetHeight || 150;
  if (fitsSide) Object.assign(card.style, { left: left + 'px', top: Math.max(16, Math.min(innerHeight - ch - 16, cy - 40)) + 'px' });
  else Object.assign(card.style, { left: Math.max(16, Math.min(innerWidth - cw - 16, cx - cw / 2)) + 'px', top: (below ? Math.min(innerHeight - ch - 16, cy + hgt / 2 + 14) : Math.max(16, cy - hgt / 2 - ch - 14)) + 'px' });
  requestAnimationFrame(() => layer.classList.add('in'));
  if (f.demo === 'dock') setTimeout(() => demoDock(el), 900);
  const close = () => {
    if (!layer.isConnected) return;
    layer.classList.remove('in'); layer.classList.add('out');
    setTimeout(() => layer.remove(), 320);
    showing = null;
    removeEventListener('pointerdown', close, true); removeEventListener('keydown', onKey, true); removeEventListener('resize', close);
  };
  const onKey = e => { if (e.key === 'Escape' || e.key === 'Enter') close(); };
  setTimeout(() => { addEventListener('pointerdown', close, true); addEventListener('keydown', onKey, true); addEventListener('resize', close); }, 250);
  showing = { close };
}

// The magnet, shown rather than told: the button drifts out, pauses, and glides back home with a click.
function demoDock(el) {
  const host = el.closest('.universal') || el;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || !host.animate) return;
  const r = host.getBoundingClientRect();
  const dx = r.left > innerWidth / 2 ? -64 : 64, dy = r.top > innerHeight / 2 ? -34 : 34;
  host.animate([
    { translate: '0 0' }, { translate: `${dx}px ${dy}px`, offset: 0.3, easing: 'cubic-bezier(.3,0,.2,1)' },
    { translate: `${dx}px ${dy}px`, offset: 0.48, easing: 'cubic-bezier(.34,1.56,.64,1)' }, { translate: '0 0' },
  ], { duration: 1700 }).finished.then(() => {
    const b = el.getBoundingClientRect();
    const click = h('div', { class: 'dock-click', 'aria-hidden': 'true', style: { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' } });
    document.body.append(click);
    setTimeout(() => click.remove(), 600);
  }).catch(() => {});
}
