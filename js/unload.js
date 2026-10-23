// Sedi — Unload: a guided brain dump inside Atom. The microphone stays on while you talk; each pause closes a
// chunk, which is written down in the background while you keep going. Every chunk shows what Atom heard and
// the cards it suggests, each with a suggested home. You add, change or dismiss them whenever you like, without
// stopping. Nothing is added without a tap, and the whole transcript is kept as a Brainly note at the end.

import * as store from './store.js';
import { h, icon, toast, todayKey } from './util.js';
import { hearStream, earsNow } from './speech.js';
import { suggest, commandFor, whenWords, TYPE_LABEL } from './unload-parse.js';
import { parseCommands } from './commands.js';
import { tick } from './sound.js';

const NUDGE_EVERY_MS = 60000;      // a gentle "sort now or keep going?" after each minute of talking
const SOFT_STOP_MS = 15 * 60000;   // long sessions stop on their own (battery, and the queue on phones)
const TYPES = ['task', 'reminder', 'event', 'goal', 'note'];
const HOME = { task: 'Taskly', reminder: 'Timely', event: 'Timely', goal: 'Boardly', note: 'Brainly' };

/**
 * Open Unload inside the Atom tray. api: { ctx() → command context, execute(cmd) → 'created <id>',
 * onClose() }. Returns { stop() } so Atom can end it when the tray closes.
 */
export function openUnload(host, api) {
  let session = null, paused = false, finished = false, startedAt = Date.now(), talkMs = 0, lastNudge = 0, timer = null, softStop = null;
  let waiting = 0, run = 0;
  const chunks = [];            // { id, text, el }
  const rows = new Set();       // every suggestion row, to count what's left at the end

  const clock = h('span', { class: 'ul-clock' }, '0:00');
  const status = h('span', { class: 'ul-status' }, 'Starting…');
  const live = h('p', { class: 'ul-live', 'aria-live': 'polite' });
  const feed = h('div', { class: 'ul-feed' });
  const pauseBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => (paused ? resume() : pause()) }, icon('stop'), 'Pause');
  const doneBtn = h('button', { class: 'btn primary sm', type: 'button', onclick: () => finish() }, 'Done');
  const intro = store.pref('unloadIntroSeen') ? null : h('div', { class: 'ul-intro' },
    h('strong', {}, 'Keep talking.'),
    h('span', {}, ' Atom writes things down as you go, and suggests where each one belongs. Sort them whenever you like. Short pauses help it keep up.'));
  store.setPref('unloadIntroSeen', true);
  const panel = h('div', { class: 'unload', role: 'region', 'aria-label': 'Unload' },
    h('div', { class: 'ul-head' },
      h('span', { class: 'ul-dot', 'aria-hidden': 'true' }),
      h('strong', {}, 'Unload'), status, h('span', { class: 'head-spacer' }), clock),
    intro, live, feed,
    h('div', { class: 'ul-foot' }, pauseBtn, h('span', { class: 'head-spacer' }), doneBtn));
  host.append(panel);

  const paintStatus = () => {
    panel.dataset.state = finished ? 'done' : paused ? 'paused' : 'listening';
    status.textContent = finished ? '' : paused ? 'Paused' : waiting > 0 ? `Listening · writing down ${waiting === 1 ? '1 bit' : `${waiting} bits`}` : 'Listening';
  };
  const tickClock = () => {
    if (!paused && !finished) talkMs = Date.now() - startedAt;
    const s = Math.floor(talkMs / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    if (!paused && !finished && talkMs - lastNudge >= NUDGE_EVERY_MS && chunks.length) { lastNudge = talkMs; nudge(); }
  };

  // ---------- Listening ----------
  function listen() {
    const mine = ++run;
    session = hearStream({
      onSpeech: () => { if (intro?.isConnected) intro.classList.add('fade'); },
      onInterim: t => { live.textContent = t || ''; },
      onLevel: l => panel.style.setProperty('--lvl', l.toFixed(2)),
      onPrepare: (p, done) => { status.textContent = done ? 'Listening' : `Setting up private voice ${Math.round(p * 100)}%`; },
      onQueued: (_, n) => { waiting = Math.max(waiting, n || 0); paintStatus(); },
      onWaiting: n => { waiting = n; paintStatus(); },
      onChunk: (_, text) => { live.textContent = ''; addChunk(text); },
      onError: msg => { if (!/Didn’t catch/.test(msg)) { live.textContent = msg; toast(msg); } },
      onEnd: () => {
        if (mine !== run) return;
        session = null; waiting = 0;
        if (finished) return wrapUp();
        // The browser's ears can end on their own after a long silence: carry on unless paused.
        if (!paused) setTimeout(() => { if (!paused && !finished && !session) listen(); }, 300);
        paintStatus();
      },
    });
    paintStatus();
  }
  function pause() {
    paused = true; talkMs = Date.now() - startedAt;
    pauseBtn.replaceChildren(icon('mic'), 'Resume');
    session?.stop();
    paintStatus();
  }
  function resume() {
    paused = false; startedAt = Date.now() - talkMs;
    pauseBtn.replaceChildren(icon('stop'), 'Pause');
    listen();
  }

  // ---------- Chunks and suggestions ----------
  function addChunk(text) {
    const ctx = api.ctx();
    const sugs = suggest(text, { now: new Date(), tabs: ctx.tabs, cards: ctx.cards, plan: ctx.plan });
    const said = h('p', { class: 'ul-said' }, text);
    const list = h('div', { class: 'ul-sugs' }, sugs.map(row));
    const el = h('div', { class: 'ul-chunk' }, said,
      sugs.length ? list : h('p', { class: 'ul-none' }, 'Nothing to file here. It stays in the transcript.'));
    chunks.push({ text, el });
    feed.append(el);
    feed.scrollTop = feed.scrollHeight;
  }
  function row(s) {
    const title = h('input', { class: 'ul-title', value: s.title, 'aria-label': 'Card title' });
    title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') add(); });
    const type = h('select', { class: 'ul-type', 'aria-label': 'What it becomes' },
      TYPES.map(t => h('option', { value: t, selected: t === s.type }, TYPE_LABEL[t])));
    const where = h('span', { class: 'ul-where' });
    const paintWhere = () => {
      const w = (type.value === 'reminder' || type.value === 'event') ? whenWords(s.when) : '';
      where.textContent = `${HOME[type.value]}${type.value === 'goal' && s.tab ? ` · ${s.tab}` : type.value === 'task' ? ' · To do' : ''}${w ? ` · ${w}` : ''}`;
    };
    type.addEventListener('change', paintWhere);
    paintWhere();
    const r = h('div', { class: `ul-row ${s.sure ? 'sure' : 'maybe'}` },
      h('div', { class: 'ul-row-main' }, type, title),
      h('div', { class: 'ul-row-foot' }, where,
        h('span', { class: 'head-spacer' }),
        h('button', { class: 'icon-btn xs ul-dismiss', type: 'button', 'aria-label': 'Dismiss', title: 'Dismiss', onclick: () => dismiss() }, icon('x')),
        h('button', { class: 'btn primary xs ul-add', type: 'button', onclick: () => add() }, icon('check'), 'Add')));
    r.state = 'open';
    rows.add(r);
    const add = () => {
      if (r.state !== 'open') return;
      const sug = { ...s, type: type.value, title: title.value.trim() || s.title };
      const cmd = parseCommands(commandFor(sug, new Date()), api.ctx()).find(c => c.kind === 'create');
      if (!cmd) { toast('Couldn’t add that one. Change the words or the type and try again.'); return; }
      let id = null;
      try { id = String(api.execute(cmd)).replace(/^created /, ''); } catch (err) { toast(`Couldn’t add it: ${err.message}`); return; }
      r.state = 'added'; r.cardId = id; tick();
      r.classList.add('added');
      r.replaceChildren(h('div', { class: 'ul-done' }, icon('check'),
        h('span', {}, h('b', {}, sug.title), ` added to ${HOME[sug.type]}`),
        h('button', { class: 'linkish', type: 'button', onclick: () => { store.deleteCard(id); r.state = 'open'; rows.delete(r); r.replaceWith(row(s)); } }, 'Undo')));
    };
    const dismiss = () => { r.state = 'dismissed'; r.classList.add('gone'); setTimeout(() => r.remove(), 180); };
    r.add = add;
    return r;
  }
  const openRows = () => [...rows].filter(r => r.state === 'open' && r.isConnected);
  function nudge() {
    const left = openRows();
    const card = h('div', { class: 'ul-nudge' },
      h('span', {}, left.length ? `${Math.round(talkMs / 60000)} min in. ${left.length} ${left.length === 1 ? 'suggestion is' : 'suggestions are'} waiting.` : `${Math.round(talkMs / 60000)} min in. Keep going, or tap Done to wrap up.`),
      left.length ? h('button', { class: 'btn ghost xs', type: 'button', onclick: () => { left[0].scrollIntoView({ block: 'center', behavior: 'smooth' }); left[0].querySelector('.ul-title')?.focus(); card.remove(); } }, 'Sort now') : null,
      h('button', { class: 'btn ghost xs', type: 'button', onclick: () => card.remove() }, 'Keep talking'));
    feed.append(card);
    feed.scrollTop = feed.scrollHeight;
  }

  // ---------- Finishing ----------
  function finish() {
    if (finished) return;
    finished = true;
    clearInterval(timer); clearTimeout(softStop);
    doneBtn.disabled = true; pauseBtn.disabled = true;
    status.textContent = waiting ? 'Writing down the last bit…' : '';
    if (session) session.stop(); else wrapUp();
  }
  function wrapUp() {
    paintStatus();
    live.textContent = '';
    doneBtn.disabled = false;
    // Keep everything that was said, even what wasn't filed, as one Brainly note.
    let noteId = null;
    if (chunks.length) {
      const at = new Date();
      const title = `Unload · ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
      const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      noteId = store.createCard({ type: 'note', tool: 'brainly', title, description: chunks.map(c => `<div>${esc(c.text)}</div>`).join(''), meta: { emoji: '🎙️', unload: todayKey() } }).id;
    }
    const left = openRows();
    const added = [...rows].filter(r => r.state === 'added').length;
    const summary = h('div', { class: 'ul-summary' },
      h('strong', {}, chunks.length ? `${added} added${left.length ? `, ${left.length} still to sort` : ''}.` : 'Nothing was heard.'),
      noteId ? h('span', {}, 'The full transcript is saved in Brainly.') : null,
      left.length ? h('div', { class: 'ul-sum-actions' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => { left.forEach(r => r.add()); summary.querySelector('.ul-sum-actions')?.remove(); } }, `Add all ${left.length}`),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { left.forEach(r => { r.state = 'dismissed'; r.remove(); }); summary.querySelector('.ul-sum-actions')?.remove(); } }, 'Dismiss the rest')) : null);
    feed.append(summary);
    feed.scrollTop = feed.scrollHeight;
    doneBtn.textContent = 'Close';
    doneBtn.onclick = () => close();
    pauseBtn.replaceChildren(icon('mic'), 'Unload more');
    pauseBtn.disabled = false;
    pauseBtn.onclick = () => { close(); api.again?.(); };
  }
  function close() {
    run++; session?.cancel(); session = null;
    clearInterval(timer); clearTimeout(softStop);
    panel.remove();
    api.onClose?.();
  }

  if (!earsNow()) { live.textContent = 'Voice isn’t available in this browser. Type in Atom instead.'; finished = true; paintStatus(); return { stop: close }; }
  timer = setInterval(tickClock, 1000);
  softStop = setTimeout(() => { toast('Unload stopped after 15 minutes. Tap Unload more to keep going.'); finish(); }, SOFT_STOP_MS);
  listen();
  return { stop: close, finish };
}
