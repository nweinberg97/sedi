// Sedi — Unload: a guided brain dump, one of Atom's two modes (Ask and Unload). The microphone stays on while
// you talk; each pause closes a chunk, which is written down in the background while you keep going.
// The newest chunk sits at the top. A chunk with something to file shows suggested cards, each with a
// suggested home; you add, change or dismiss them whenever you like. A chunk with nothing to file shrinks
// to one quiet line you can delete (or turn into a card if Atom missed it). Nothing is added without a tap,
// and the transcript is saved to Brainly only if you choose to, without the lines you deleted.

import * as store from './store.js';
import { h, icon, toast, todayKey, editInline } from './util.js';
import { learnFromEdit } from './vocab.js';
import { hearStream, earsNow, isMicBlocked } from './speech.js';
import { suggest, commandFor, whenWords, tidyTitle, TYPE_LABEL } from './unload-parse.js';
import { parseCommands } from './commands.js';
import { tick } from './sound.js';
import { moveDestinations, destinationLabel, moveSelect, moveCardTo, currentDestination } from './cards.js';
import { popover, closePopovers } from './util.js';

// ---------- Where a card goes ----------
// Every suggestion has a destination, picked the same way as "Move to…" on any card: a tool, then a place in
// it (a Taskly column, a Timely project or goal, a Boardly category, a Brainly folder, the Universal Board).
// Atom proposes one: your own project, goal and folder names, when you mention them, beat the defaults.
const STOP = new Set('the and for with my our your this that from into about project projects goal goals folder notes note list'.split(' '));
const words = t => String(t || '').toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || [];
export function guessDestination(text, type) {
  const said = ` ${words(text).join(' ')} `;
  const groups = Object.fromEntries(moveDestinations());
  const pool = type === 'goal' ? [...(groups.Timely || []).filter(([v]) => v.startsWith('timely:plan:goals:')), ...(groups.Boardly || [])]
    : type === 'note' ? (groups.Brainly || []).filter(([v]) => v.startsWith('brainly:folder:'))
    : type === 'task' ? (groups.Timely || []).filter(([v]) => v.startsWith('timely:plan:projects:')) : [];
  let best = null;
  for (const [key, label] of pool) {
    const name = label.split(' › ').pop();
    const toks = words(name).filter(w => w.length >= 3 && !STOP.has(w));
    if (!toks.length) continue;
    const whole = said.includes(` ${words(name).join(' ')} `);
    const hits = toks.filter(w => said.includes(` ${w} `) || said.includes(` ${w}s `)).length;
    const score = whole ? 10 + toks.length : hits === toks.length ? 5 + hits : 0;
    if (score && (!best || score > best.score)) best = { key, score };
  }
  return best?.key || null;
}
const defaultDestination = (type, tabName) => {
  if (type === 'task') return 'taskly:todo';
  if (type === 'note') return 'brainly:canvas';
  if (type === 'goal') {
    const tab = (store.get('boardlyTabs', []) || []).find(t => t.name.toLowerCase() === String(tabName || '').toLowerCase()) || store.get('boardlyTabs', [])[0];
    return tab ? `boardly:${tab.id}` : 'universal';
  }
  return null; // reminders and events: on the day and time you said
};

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
  let waiting = 0, run = 0, savedNoteId = null, typing = false;
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
  // Which models are doing the work, in plain words, with one quiet way to make sorting sharper.
  const engineLine = h('div', { class: 'ul-engines' });
  const paintEngines = () => {
    const e = api.engines?.();
    if (!e) return;
    engineLine.replaceChildren(...[e.onDevice ? icon('lock') : null,
      h('span', {}, e.onDevice ? `Hearing: ${e.hear}, on this device.` : `Hearing: ${e.hear}.`),
      h('span', {}, e.sort ? ` Sorting: ${e.sort}.` : ' Sorting: Sedi’s built-in rules.'),
      !e.brainOn && api.openBrain ? h('button', { class: 'linkish', type: 'button', onclick: () => api.openBrain() }, 'Sort smarter') : null].filter(Boolean));
  };
  const panel = h('div', { class: 'unload', role: 'region', 'aria-label': 'Unload' },
    h('div', { class: 'ul-head' },
      h('span', { class: 'ul-dot', 'aria-hidden': 'true' }),
      status, h('span', { class: 'head-spacer' }), clock),
    h('div', { class: 'ul-bar' }, toSort, h('span', { class: 'head-spacer' }), clearBtn),
    intro, live, feed,
    h('div', { class: 'ul-foot' }, pauseBtn, h('span', { class: 'head-spacer' }), doneBtn),
    engineLine);
  host.append(panel);
  paintEngines();
  setTimeout(paintEngines, 1500);

  const openRows = () => [...rows].filter(r => r.state === 'open' && r.isConnected);
  const unfiled = () => chunks.filter(c => !c.deleted && c.el.classList.contains('unfiled'));
  const paintStatus = () => {
    panel.dataset.state = finished ? 'done' : paused ? 'paused' : 'listening';
    status.textContent = finished ? 'Finished' : typing ? 'Typing' : paused ? 'Paused' : waiting > 0 ? 'Listening · writing…' : 'Listening';
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
        if (!earsNow() || isMicBlocked()) { pause(); typeMode(); return; }
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
      // The rules found nothing. If Atom's brain is on (or an AI engine is connected), it has a read too:
      // it can only propose Sedi's own commands, and each becomes a suggestion you still add with a tap.
      if (api.understand) {
        entry.el.classList.add('reading');
        api.understand(text).then(res => {
          entry.el.classList.remove('reading');
          if (!res?.commands?.length || entry.deleted || !entry.el.isConnected) return;
          const now = new Date(), c2 = api.ctx();
          const found = res.commands.flatMap(cmd => parseCommands(cmd, c2)).filter(c => c.kind === 'create' && c.title).slice(0, 4).map(c => ({
            type: c.tool === 'boardly' && c.type === 'goal' ? 'goal' : c.tool === 'brainly' ? 'note' : c.tool === 'timely' ? (c.reminder ? 'reminder' : 'event') : 'task',
            title: tidyTitle(c.title) || c.title, when: c.when || null, tab: c.tabName || null, sure: false, raw: text, ai: true,
          }));
          if (!found.length) return;
          entry.el.classList.remove('unfiled');
          entry.el.replaceChildren(h('div', { class: 'ul-sugs' }, found.map(row)), said);
          void now;
          paintStatus();
        });
      }
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
    // Where it goes: Atom's guess (your own project or folder, when you named it), else the usual home.
    let picked = false;
    let dest = guessDestination(s.raw || s.title, s.type) || defaultDestination(s.type, s.tab);
    let guessed = !!guessDestination(s.raw || s.title, s.type);
    const where = h('button', { class: 'ul-where', type: 'button', title: 'Choose where it goes', onclick: e => chooseDest(e.currentTarget) });
    const paintWhere = () => {
      const w = (type.value === 'reminder' || type.value === 'event') ? whenWords(s.when) : '';
      const label = dest ? destinationLabel(dest) : `${HOME[type.value]}${w ? ` · ${w}` : ''}`;
      where.replaceChildren(...[h('span', { class: 'ul-where-arrow' }, '→'), h('span', {}, label), guessed && !picked ? h('em', { class: 'ul-guess' }, 'suggested') : null, icon('chevD', 'ul-where-chev')].filter(Boolean));
    };
    const chooseDest = anchor => {
      const picker = moveSelect({ tool: 'universal', type: type.value === 'goal' ? 'goal' : type.value === 'note' ? 'note' : 'task', meta: {} });
      if (dest) picker.value = dest;
      popover(anchor, h('div', { class: 'ul-dest-pop' },
        h('strong', {}, 'Where should it go?'), picker,
        h('div', { class: 'ul-dest-actions' },
          dest && (type.value === 'reminder' || type.value === 'event') ? h('button', { class: 'btn ghost xs', type: 'button', onclick: () => { dest = null; picked = true; closePopovers(); paintWhere(); } }, 'Keep it on its day') : null,
          h('button', { class: 'btn primary xs', type: 'button', onclick: () => { if (picker.value) { dest = picker.value; picked = true; } closePopovers(); paintWhere(); } }, 'Use this'))), { className: 'ul-dest-popover' });
    };
    type.addEventListener('change', () => { if (!picked) { const g = guessDestination(s.raw || s.title, type.value); dest = g || defaultDestination(type.value, s.tab); guessed = !!g; } paintWhere(); });
    paintWhere();
    const r = h('div', { class: `ul-row ${s.sure ? 'sure' : 'maybe'} ${s.ai ? 'from-ai' : ''}`, title: s.ai ? 'Atom read this one with its on-device brain' : '' },
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
      // Then into the chosen place, if that isn't where the command put it.
      const made = store.getCard(id);
      if (made && dest && dest !== currentDestination(made)) moveCardTo(id, dest, { quiet: true });
      const landed = store.getCard(id);
      r.state = 'added'; r.cardId = id; tick();
      r.classList.add('added');
      r.replaceChildren(h('div', { class: 'ul-done' }, icon('check'),
        h('span', {}, h('b', {}, sug.title), ` → ${landed ? destinationLabel(currentDestination(landed)) : HOME[sug.type]}`),
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

  // No microphone here (blocked, or the in-chat preview): Unload still works by typing. Same sorting, same cards.
  function typeMode() {
    if (panel.querySelector('.ul-type-box')) return;
    const box = h('textarea', { class: 'field-input ul-type-in', rows: 2, placeholder: 'Type it all out. Press Enter after each thought.', 'aria-label': 'Type a thought' });
    box.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); const t = box.value.trim(); if (t) { addChunk(t); box.value = ''; } }
    });
    const note = window.SEDI_SANDBOX ? 'Voice works in the real Sedi app. Here, type it out.' : 'The microphone is blocked, so type it out (or allow the mic and tap Resume).';
    live.after(h('div', { class: 'ul-type-box' }, h('p', { class: 'muted small' }, note), box));
    paused = true; typing = true; panel.dataset.state = 'paused'; paintStatus();
    pauseBtn.hidden = !!window.SEDI_SANDBOX;
    setTimeout(() => box.focus(), 30);
  }
  if (!earsNow() || isMicBlocked()) { typeMode(); return { stop: close, pause() {}, resume() {}, finish, busy }; }
  timer = setInterval(tickClock, 1000);
  softStop = setTimeout(() => { toast('Unload stopped after 15 minutes. Tap Unload more to keep going.'); finish(); }, SOFT_STOP_MS);
  listen();
  return { stop: close, pause, resume, finish, busy, el: panel };
}
