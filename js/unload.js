// Sedi — Unload: a guided brain dump, one of Atom's two modes (Ask and Unload). The microphone stays on while
// you talk; each pause closes a chunk, which is written down in the background while you keep going.
// The newest chunk sits at the top. A chunk with something to file shows suggested cards, each with a
// suggested home; you add, change or dismiss them whenever you like. A chunk with nothing to file shrinks
// to one quiet line you can delete (or turn into a card if Atom missed it). Nothing is added without a tap,
// and the transcript is saved to Brainly only if you choose to, without the lines you deleted.

import * as store from './store.js';
import { h, icon, toast, todayKey, editInline } from './util.js';
import { learnFromEdit } from './vocab.js';
import { hearStream, earsNow } from './speech.js';
import { suggest, commandFor, whenWords, tidyTitle, TYPE_LABEL } from './unload-parse.js';
import { parseCommands } from './commands.js';
import { tick } from './sound.js';

const SOFT_STOP_MS = 15 * 60000;   // long sessions stop on their own (battery, and the queue on phones)
const TYPES = ['task', 'reminder', 'event', 'goal', 'note'];
const HOME = { task: 'Taskly', reminder: 'Timely', event: 'Timely', goal: 'Boardly', note: 'Brainly' };

/**
 * Open Unload inside the Atom tray. api: { ctx() → command context, execute(cmd) → 'created <id>',
 * onClose(), again() }. Returns { stop(), pause(), resume(), finish(), busy() } so Atom can pause it when you
 * switch to Ask or close the tray, and only end it when you say so.
 */
export function openUnload(host, api) {
  let session = null, paused = false, finished = false, startedAt = Date.now(), talkMs = 0, timer = null, softStop = null;
  let waiting = 0, run = 0, savedNoteId = null;
  const chunks = [];            // { text, el, deleted }
  const rows = new Set();       // every suggestion row, to count what's left

  const clock = h('span', { class: 'ul-clock' }, '0:00');
  const status = h('span', { class: 'ul-status' }, 'Starting…');
  const toSort = h('button', { class: 'ul-tosort', type: 'button', hidden: true, onclick: () => jumpToOpen() });
  const clearBtn = h('button', { class: 'linkish ul-clear', type: 'button', hidden: true, onclick: () => clearUnfiled() }, 'Clear unfiled');
  const live = h('p', { class: 'ul-live', 'aria-live': 'polite' });
  const feed = h('div', { class: 'ul-feed' });
  const pauseBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => (paused ? resume() : pause()) }, icon('stop'), 'Pause');
  const doneBtn = h('button', { class: 'btn primary sm', type: 'button', onclick: () => finish() }, 'Done');
  const intro = store.pref('unloadIntroSeen') ? null : h('div', { class: 'ul-intro' },
    h('strong', {}, 'Just talk.'),
    h('span', {}, ' Atom writes it down and pulls out anything that could be a card. Lines with nothing to file fade, so you can delete them. Short pauses help it keep up.'));
  store.setPref('unloadIntroSeen', true);
  const panel = h('div', { class: 'unload', role: 'region', 'aria-label': 'Unload' },
    h('div', { class: 'ul-head' },
      h('span', { class: 'ul-dot', 'aria-hidden': 'true' }),
      status, h('span', { class: 'head-spacer' }), clock),
    h('div', { class: 'ul-bar' }, toSort, h('span', { class: 'head-spacer' }), clearBtn),
    intro, live, feed,
    h('div', { class: 'ul-foot' }, pauseBtn, h('span', { class: 'head-spacer' }), doneBtn));
  host.append(panel);

  const openRows = () => [...rows].filter(r => r.state === 'open' && r.isConnected);
  const unfiled = () => chunks.filter(c => !c.deleted && c.el.classList.contains('unfiled'));
  const paintStatus = () => {
    panel.dataset.state = finished ? 'done' : paused ? 'paused' : 'listening';
    status.textContent = finished ? 'Finished' : paused ? 'Paused' : waiting > 0 ? 'Listening · writing…' : 'Listening';
    const n = openRows().length;
    toSort.hidden = !n;
    toSort.textContent = `${n} to sort`;
    const u = unfiled().length;
    clearBtn.hidden = !u;
    clearBtn.textContent = `Clear unfiled (${u})`;
  };
  const tickClock = () => {
    if (!paused && !finished) talkMs = Date.now() - startedAt;
    const s = Math.floor(talkMs / 1000);
    clock.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  // New things go on top. If you've scrolled down to read, the list holds still under you.
  function addTop(el) {
    const before = feed.scrollTop;
    feed.prepend(el);
    if (before > 4) feed.scrollTop = before + el.offsetHeight + 8;
  }
  function jumpToOpen() {
    const r = openRows()[0];
    if (!r) return;
    r.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    r.querySelector('.ul-title')?.focus({ preventScroll: true });
  }

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
      onError: msg => {
        if (/Didn’t catch/.test(msg)) return;
        live.textContent = msg;
        // A blocked microphone won't fix itself: pause once and say so, instead of retrying into it.
        if (!earsNow()) { pause(); live.textContent = 'Voice isn’t available here: the microphone is blocked. Allow it in your browser, then tap Resume.'; return; }
        toast(msg);
      },
      onEnd: () => {
        if (mine !== run) return;
        session = null; waiting = 0;
        if (finished) return wrapUp();
        // The browser's ears can end on their own after a long silence: carry on unless paused.
        if (!paused) setTimeout(() => { if (!paused && !finished && !session && earsNow()) listen(); }, 300);
        paintStatus();
      },
    });
    paintStatus();
  }
  function pause() {
    if (paused || finished) return;
    paused = true; talkMs = Date.now() - startedAt;
    pauseBtn.replaceChildren(icon('mic'), 'Resume');
    session?.stop();
    live.textContent = '';
    paintStatus();
  }
  function resume() {
    if (!paused || finished) return;
    paused = false; startedAt = Date.now() - talkMs;
    pauseBtn.replaceChildren(icon('stop'), 'Pause');
    listen();
  }

  // ---------- Chunks and suggestions ----------
  // What was heard, small and quiet. Tap to read it all; the pencil fixes a misheard word, and Sedi learns it.
  function saidEl(entry) {
    const p = h('p', { class: 'ul-said', title: 'Tap to show all', onclick: () => { if (!p.isContentEditable) p.classList.toggle('open'); } }, entry.text);
    const fix = h('button', { class: 'icon-btn xs ul-fix', type: 'button', 'aria-label': 'Fix a misheard word', title: 'Fix a misheard word (Sedi learns it)', onclick: e => {
      e.stopPropagation();
      p.classList.add('open');
      editInline(p, { selectAll: false, onCommit: v => {
        const learned = learnFromEdit(entry.text, v);
        entry.text = v;
        if (learned.length) toast(`Got it. Sedi will write ${learned.map(([, m]) => `“${m}”`).join(', ')} from now on.`);
      } });
    } }, icon('pencil'));
    return h('div', { class: 'ul-said-row' }, p, fix);
  }
  function addChunk(text) {
    const ctx = api.ctx();
    const sugs = suggest(text, { now: new Date(), tabs: ctx.tabs, cards: ctx.cards, plan: ctx.plan });
    const entry = { text, el: null, deleted: false };
    if (sugs.length) {
      const said = saidEl(entry);
      entry.el = h('div', { class: 'ul-chunk' }, h('div', { class: 'ul-sugs' }, sugs.map(row)), said);
    } else {
      // Nothing to file: one quiet line. Delete it, or make a card if Atom missed something.
      const del = h('button', { class: 'icon-btn xs ul-del', type: 'button', 'aria-label': 'Delete this line', title: 'Delete (it won’t be saved)', onclick: () => remove() }, icon('trash'));
      const make = h('button', { class: 'linkish ul-make', type: 'button', title: 'Turn this into a card', onclick: () => promote() }, '+ Card');
      const said = saidEl(entry);
      entry.el = h('div', { class: 'ul-chunk unfiled' }, said, h('div', { class: 'ul-line-actions' }, make, del));
      const remove = () => { entry.deleted = true; entry.el.classList.add('gone'); setTimeout(() => { entry.el.remove(); paintStatus(); }, 180); };
      const promote = () => {
        const title = tidyTitle(entry.text.split(/[.!?]/)[0]);
        entry.el.classList.remove('unfiled');
        entry.el.replaceChildren(h('div', { class: 'ul-sugs' }, row({ type: 'task', title: title || entry.text.slice(0, 60), when: null, tab: null, sure: false })), said);
        paintStatus();
        entry.el.querySelector('.ul-title')?.focus();
      };
    }
    chunks.push(entry);
    if (intro?.isConnected) intro.remove(); // it has done its job once there's something to look at
    addTop(entry.el);
    paintStatus();
  }
  function row(s) {
    const title = h('input', { class: 'ul-title', value: s.title, 'aria-label': 'Card title' });
    title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') add(); });
    const type = h('select', { class: 'ul-type', 'aria-label': 'What it becomes' },
      TYPES.map(t => h('option', { value: t, selected: t === s.type }, TYPE_LABEL[t])));
    const where = h('span', { class: 'ul-where' });
    const paintWhere = () => {
      const w = (type.value === 'reminder' || type.value === 'event') ? whenWords(s.when) : '';
      where.textContent = `→ ${HOME[type.value]}${type.value === 'goal' && s.tab ? ` · ${s.tab}` : type.value === 'task' ? ' · To do' : ''}${w ? ` · ${w}` : ''}`;
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
        h('span', {}, h('b', {}, sug.title), ` → ${HOME[sug.type]}`),
        h('button', { class: 'linkish', type: 'button', onclick: () => { store.deleteCard(id); rows.delete(r); const fresh = row(s); r.replaceWith(fresh); paintStatus(); } }, 'Undo')));
      paintStatus();
    };
    const dismiss = () => { r.state = 'dismissed'; r.classList.add('gone'); setTimeout(() => { r.remove(); paintStatus(); }, 180); };
    r.add = add;
    return r;
  }
  function clearUnfiled() {
    const list = unfiled();
    list.forEach(c => { c.deleted = true; c.el.remove(); });
    paintStatus();
    toast(`Cleared ${list.length} ${list.length === 1 ? 'line' : 'lines'}`, { action: 'Undo', onAction: () => { list.forEach(c => { c.deleted = false; }); rebuildOrder(); paintStatus(); } });
  }
  function rebuildOrder() {
    const keep = chunks.filter(c => !c.deleted).map(c => c.el);
    const extras = [...feed.children].filter(el => !chunks.some(c => c.el === el));
    feed.replaceChildren(...extras.filter(el => el.classList.contains('ul-summary')), ...keep.reverse());
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
  function saveTranscript() {
    const kept = chunks.filter(c => !c.deleted);
    if (!kept.length) return null;
    const at = new Date();
    const title = `Unload · ${at.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
    const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
    return store.createCard({ type: 'note', tool: 'brainly', title, description: kept.map(c => `<div>${esc(c.text)}</div>`).join(''), meta: { emoji: '🎙️', unload: todayKey() } }).id;
  }
  function wrapUp() {
    paintStatus();
    live.textContent = '';
    doneBtn.disabled = false;
    const left = openRows();
    const added = [...rows].filter(r => r.state === 'added').length;
    const kept = chunks.filter(c => !c.deleted).length;
    const saveRow = kept ? h('div', { class: 'ul-save' },
      h('span', {}, 'Keep what you said?'),
      h('button', { class: 'btn ghost xs', type: 'button', onclick: () => {
        savedNoteId = saveTranscript();
        saveRow.replaceChildren(icon('check'), h('span', {}, 'Transcript saved to Brainly.'));
      } }, icon('brain'), 'Save transcript to Brainly')) : null;
    const summary = h('div', { class: 'ul-summary' },
      h('strong', {}, chunks.length ? `${added} added${left.length ? `, ${left.length} still to sort` : ''}.` : 'Nothing was heard.'),
      left.length ? h('div', { class: 'ul-sum-actions' },
        h('button', { class: 'btn primary sm', type: 'button', onclick: () => { left.forEach(r => r.add()); summary.querySelector('.ul-sum-actions')?.remove(); } }, `Add all ${left.length}`),
        h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { left.forEach(r => { r.state = 'dismissed'; r.remove(); }); summary.querySelector('.ul-sum-actions')?.remove(); paintStatus(); } }, 'Dismiss the rest')) : null,
      saveRow);
    feed.prepend(summary);
    feed.scrollTop = 0;
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
  // Worth keeping open when Atom closes: something was said that hasn't been dealt with.
  const busy = () => !finished ? chunks.some(c => !c.deleted) || openRows().length > 0 : openRows().length > 0 || (!savedNoteId && chunks.some(c => !c.deleted));

  if (!earsNow()) { live.textContent = 'Voice isn’t available in this browser. Type in Atom instead.'; finished = true; paintStatus(); return { stop: close, pause() {}, resume() {}, finish() {}, busy: () => false }; }
  timer = setInterval(tickClock, 1000);
  softStop = setTimeout(() => { toast('Unload stopped after 15 minutes. Tap Unload more to keep going.'); finish(); }, SOFT_STOP_MS);
  listen();
  return { stop: close, pause, resume, finish, busy, el: panel };
}
