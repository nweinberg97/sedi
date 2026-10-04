// Sedi — the assistant: a draggable atom with Chat, Voice and Command modes.
// Chat answers from your own cards (and from the Sovereign Brain when it's on).
// Command turns plain language into a change, asks you to confirm, then logs it permanently.

import * as store from './store.js';
import { h, icon, clamp, toast, modal, renderText, todayKey, fmtMinutes, relTime } from './util.js';
import { TOOL_NAMES, typeIcon, byOrder, routeCard, flatten, trashCard } from './cards.js';
import { navigate } from './shell.js';
import { nextUpItems } from './home.js';
import { COLUMNS } from './taskly.js';
import { occurrencesOn } from './timely.js';
import { listen, speak, stopSpeaking, canListen } from './speech.js';
import * as brain from './brain.js';
import { tick } from './sound.js';
import { parseCommands, looksLikeCommand } from './commands.js';

let token, tray, output, input, modeBar, micBtn, statusEl;
let mode = 'chat';
let session = null;

export function buildAssistant() {
  token = h('button', { class: 'assistant-token', 'aria-label': 'Open assistant (⌘K)', 'aria-expanded': 'false' }, icon('atom'));
  modeBar = h('div', { class: 'segmented small', role: 'tablist' });
  output = h('div', { class: 'as-output', 'aria-live': 'polite' });
  input = h('input', { class: 'as-input', placeholder: '', 'aria-label': 'Message the assistant' });
  micBtn = h('button', { class: 'icon-btn as-mic', type: 'button', 'aria-label': 'Speak', disabled: !canListen, title: canListen ? 'Speak' : 'Voice isn’t supported in this browser', onclick: toggleMic }, icon('mic'));
  statusEl = h('span', { class: 'as-status' });
  tray = h('section', { class: 'assistant-tray', 'aria-label': 'Assistant', hidden: true },
    h('div', { class: 'as-head' }, modeBar, statusEl,
      h('button', { class: 'icon-btn xs', 'aria-label': 'Command history', title: 'Command history', onclick: openLog }, icon('archive')),
      h('button', { class: 'icon-btn xs', 'aria-label': 'Close assistant', onclick: () => toggle(false) }, icon('x'))),
    output,
    h('form', { class: 'as-form', onsubmit: e => { e.preventDefault(); submit(input.value); } },
      input, micBtn, h('button', { class: 'icon-btn as-send', 'aria-label': 'Send', type: 'submit' }, icon('send'))));
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') toggle(false); });
  setMode(store.pref('assistantMode', 'chat'));
  makeDraggable();
  brain.onBrainChange(paintStatus);
  paintStatus();
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setMode('chat'); toggle(true); }
  });
  document.addEventListener('pointerdown', e => { if (!tray.hidden && !tray.contains(e.target) && !token.contains(e.target) && !e.target.closest('.modal-backdrop, .toast')) toggle(false); });
  return h('div', { class: 'assistant' }, tray, token);
}

function paintStatus() {
  const s = brain.brainState();
  statusEl.textContent = !brain.isEnabled() ? '' : s.status === 'ready' ? 'Brain on' : s.status === 'loading' ? 'Brain loading…' : s.status === 'error' ? 'Brain offline' : 'Brain on';
  statusEl.title = brain.isEnabled() ? 'Sovereign Brain answers coaching questions on this device' : '';
}

function setMode(m) {
  mode = m;
  store.setPref('assistantMode', m);
  modeBar.replaceChildren(...[['chat', 'Chat'], ['voice', 'Voice'], ['command', 'Command']].map(([v, l]) =>
    h('button', { class: v === m ? 'on' : '', type: 'button', role: 'tab', 'aria-selected': String(v === m), onclick: () => setMode(v) }, l)));
  input.placeholder = { chat: 'Ask about your tasks, notes or goals', voice: 'Tap the mic and talk', command: 'e.g. add call the dentist to my to do list' }[m];
  tray.dataset.mode = m;
  if (!output.childElementCount) greet();
}
function greet() {
  output.replaceChildren(h('p', { class: 'as-hint' }, {
    chat: 'Ask “what’s next?”, “summary”, or search for anything you’ve saved.',
    voice: 'Tap the mic, speak, and I’ll answer out loud.',
    command: 'Say or type a change, like “remind me to call mom tomorrow at 3pm” or “move call the dentist to review”. You’ll confirm before anything happens. Commands also work from Chat and Voice.',
  }[mode]));
}

function toggle(force) {
  const open = typeof force === 'boolean' ? force : tray.hidden;
  tray.hidden = !open;
  token.setAttribute('aria-expanded', String(open));
  if (open) { positionTray(); setTimeout(() => input.focus(), 30); }
  else { session?.stop(); stopSpeaking(); }
}

function positionTray() {
  const r = token.getBoundingClientRect();
  const w = Math.min(420, innerWidth - 24);
  tray.style.width = w + 'px';
  const left = clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12);
  tray.style.left = left + 'px';
  const above = r.top > innerHeight / 2;
  tray.style.top = ''; tray.style.bottom = '';
  if (above) tray.style.bottom = innerHeight - r.top + 12 + 'px';
  else tray.style.top = r.bottom + 12 + 'px';
}

function makeDraggable() {
  const pos = store.pref('assistantPos');
  if (pos) Object.assign(token.style, { left: pos.x + 'px', top: pos.y + 'px', transform: 'none', bottom: 'auto' });
  let start = null;
  token.addEventListener('pointerdown', e => {
    const r = token.getBoundingClientRect();
    start = { x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, moved: false };
    token.setPointerCapture(e.pointerId);
  });
  token.addEventListener('pointermove', e => {
    if (!start) return;
    if (!start.moved && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 5) return;
    start.moved = true;
    const x = clamp(e.clientX - start.ox, 8, innerWidth - 56), y = clamp(e.clientY - start.oy, 64, innerHeight - 56);
    Object.assign(token.style, { left: x + 'px', top: y + 'px', transform: 'none', bottom: 'auto' });
    if (!tray.hidden) positionTray();
  });
  token.addEventListener('pointerup', () => {
    if (!start) return;
    if (start.moved) { const r = token.getBoundingClientRect(); store.setPref('assistantPos', { x: r.left, y: r.top }); }
    else toggle();
    start = null;
  });
  addEventListener('resize', () => {
    const r = token.getBoundingClientRect();
    if (r.right > innerWidth || r.bottom > innerHeight) { token.removeAttribute('style'); store.setPref('assistantPos', null); }
  });
}

// ---------- Output helpers ----------
function say(node, who = 'bot') {
  const el = h('div', { class: `as-msg ${who}` }, node);
  output.append(el);
  while (output.children.length > 12) output.firstChild.remove();
  output.scrollTop = output.scrollHeight;
  return el;
}
const itemList = cards => h('div', { class: 'as-items' }, cards.map(c => h('button', {
  class: 'as-item', type: 'button', onclick: () => { navigate(c.tool === 'universal' ? 'home' : c.tool); toggle(false); },
}, typeIcon(c.type), h('span', {}, c.title), h('small', {}, TOOL_NAMES[c.tool]))));

// ---------- Submit ----------
async function submit(text, { fromVoice = false } = {}) {
  text = (text || '').trim();
  if (!text) { if (pending) confirmPending(); return; }
  input.value = '';
  if (output.querySelector('.as-hint')) output.replaceChildren();
  say(text, 'me');
  // A pending confirmation takes yes/no answers first.
  if (pending) {
    if (YES.test(text)) return confirmPending();
    if (NO.test(text)) return cancelPending();
    cancelPending(true);
  }
  const ctx = commandContext();
  const cmds = parseCommands(text, ctx);
  const isCommand = cmds.length && (mode === 'command' || (looksLikeCommand(text) && cmds.some(c => c.kind !== 'create' || c.explicit)));
  if (isCommand) return proposeCommands(text, cmds, fromVoice || mode === 'voice');
  if (mode === 'command') {
    say(h('p', {}, 'I can create, move, reschedule, complete, rename or delete cards. Try “add call the dentist to my to do list” or “remind me to pay rent Friday at 9am”.'));
    return;
  }
  const reply = await answer(text);
  if ((mode === 'voice' || fromVoice) && reply) speak(reply);
}

function toggleMic() {
  if (session) { session.stop(); return; }
  stopSpeaking();
  micBtn.classList.add('on');
  tray.classList.add('listening');
  const live = say(h('span', { class: 'as-interim' }, 'Listening…'), 'me');
  let finalText = '';
  session = listen({
    continuous: false,
    onInterim: t => { live.firstChild.textContent = t || 'Listening…'; },
    onFinal: t => { finalText += (finalText ? ' ' : '') + t; live.firstChild.textContent = finalText; },
    onError: msg => toast(msg),
    onEnd: () => {
      session = null; micBtn.classList.remove('on'); tray.classList.remove('listening');
      live.remove();
      if (finalText) submit(finalText, { fromVoice: true });
    },
  });
}

// ---------- Chat ----------
function search(q, n = 5) {
  const terms = q.toLowerCase().split(/\s+/).filter(w => w.length > 2 && !/^(the|and|for|what|how|are|any|about|with|my|me|show|find|did|have|is)$/.test(w));
  if (!terms.length) return [];
  return store.allCards().map(c => {
    const t = `${c.title} ${flatten(c)}`.toLowerCase();
    const s = terms.reduce((acc, w) => acc + (c.title.toLowerCase().includes(w) ? 3 : t.includes(w) ? 1 : 0), 0);
    return { c, s };
  }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, n).map(x => x.c);
}

function summary() {
  const all = store.allCards();
  const count = f => all.filter(f).length;
  const lines = [
    `**Taskly**: ${COLUMNS.map(col => `${count(c => c.tool === 'taskly' && c.meta?.columnId === col.id)} ${col.name.toLowerCase()}`).join(', ')}`,
    `**Boardly**: ${count(c => c.tool === 'boardly' && c.type === 'goal')} goals, ${count(c => c.tool === 'boardly' && c.type !== 'goal')} other cards`,
    `**Timely**: ${occurrencesOn(todayKey()).length} items today, ${count(c => c.tool === 'timely' && c.meta?.kind === 'reminder' && !c.meta?.done && !c.meta?.archivedAt)} open reminders`,
    `**Brainly**: ${count(c => c.tool === 'brainly' && c.type !== 'link')} notes, ${count(c => c.tool === 'brainly' && c.type === 'link')} links`,
  ];
  return lines.join('\n');
}

const COACH = /stuck|overwhelm|procrastinat|motivat|focus|habit|anxious|stress|can'?t start|paraly|distract|routine|tired|burn ?out|lazy|unmotivated|how (do|can|should) i|help me|advice|tips?/i;

async function answer(q) {
  const lower = q.toLowerCase();
  let text;
  if (/\b(next|today|agenda|schedule|plan for|on my plate)\b/.test(lower)) {
    const items = nextUpItems(5);
    text = items.length ? `Here’s what’s next:\n${items.map(i => `- ${i.card.title} (${i.label})`).join('\n')}` : 'Nothing is lined up. Your To do column and today’s schedule are clear.';
    say(h('div', {}, renderText(text), items.length ? itemList(items.map(i => i.card)) : null));
    return text;
  }
  if (/\b(summary|overview|status|how many|counts?)\b/.test(lower)) {
    text = summary();
    say(renderText(text));
    return text.replace(/\*\*/g, '');
  }
  const hits = search(q);
  if (brain.isEnabled() && (COACH.test(q) || !hits.length)) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, brain.brainState().status === 'ready' ? 'Thinking…' : 'Waking the brain…')));
    try {
      const ctx = hits.slice(0, 4).map(c => ({ title: c.title, where: TOOL_NAMES[c.tool] }));
      const res = await brain.ask(q, ctx, partial => { bubble.firstChild.replaceChildren(renderText(partial)); output.scrollTop = output.scrollHeight; });
      bubble.firstChild.replaceChildren(renderText(res.text), h('small', { class: 'as-sources' }, `From: ${res.sources.join(', ')}`));
      return res.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `The brain couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  if (hits.length) {
    text = `I found ${hits.length} match${hits.length === 1 ? '' : 'es'}: ${hits.map(c => c.title).join(', ')}.`;
    say(h('div', {}, h('p', {}, `Found ${hits.length} in your Sedi:`), itemList(hits)));
    return text;
  }
  text = brain.isEnabled() ? 'I couldn’t find anything for that.' : 'Nothing in your Sedi matches that. For coaching questions, turn on the Sovereign Brain from the menu.';
  say(h('p', {}, text));
  return text;
}

// ---------- Command ----------
const YES = /^(?:y|yes|yeah|yep|yup|sure|ok|okay|confirm|confirmed|do it|go ahead|go|correct|right|please do|sounds good)\b/i;
const NO = /^(?:n|no|nope|nah|cancel|stop|never ?mind|don'?t|wait)\b/i;
let pending = null;

function commandContext() {
  return {
    cards: store.allCards().filter(c => !c.meta?.archivedAt),
    tabs: store.get('boardlyTabs', []),
    now: new Date(),
  };
}

const whenLabel = w => {
  if (!w) return '';
  const parts = [];
  if (w.date) {
    const d = new Date(`${w.date}T00:00`);
    const t = todayKey();
    const tm = new Date(); tm.setDate(tm.getDate() + 1);
    parts.push(w.date === t ? 'today' : w.date === `${tm.getFullYear()}-${String(tm.getMonth() + 1).padStart(2, '0')}-${String(tm.getDate()).padStart(2, '0')}` ? 'tomorrow'
      : d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }));
  }
  if (w.start != null) parts.push(`at ${fmtMinutes(w.start)}`);
  else if (w.slot) parts.push(`(${w.slot})`);
  return parts.join(' ');
};
function where(c) {
  if (c.tool === 'taskly') return `Taskly${c.column ? `, ${COLUMNS.find(x => x.id === c.column)?.name}` : ''}`;
  if (c.tool === 'boardly') return `Boardly${c.tabName ? `, ${c.tabName}` : ''}`;
  if (c.tool === 'timely') return `Timely${c.when ? ` ${whenLabel(c.when)}` : c.reminder ? ' reminders' : ''}`;
  return TOOL_NAMES[c.tool] || c.tool;
}
export function describe(c) {
  switch (c.kind) {
    case 'open': return `Open ${c.route[0].toUpperCase() + c.route.slice(1)}`;
    case 'create': return `Create ${c.reminder ? 'reminder' : c.type} “${c.title}” in ${where(c)}`;
    case 'move': return c.tool === c.card.tool && c.tool === 'timely' ? `Reschedule “${c.card.title}” to ${whenLabel(c.when)}` : `Move “${c.card.title}” to ${where(c)}`;
    case 'complete': return `Mark “${c.card.title}” as done`;
    case 'delete': return `Delete “${c.card.title}” from ${TOOL_NAMES[c.card.tool]}`;
    case 'rename': return `Rename “${c.card.title}” to “${c.title}”`;
    case 'error': return c.message;
    default: return '';
  }
}

function proposeCommands(text, cmds, voice) {
  const errors = cmds.filter(c => c.kind === 'error');
  const opens = cmds.filter(c => c.kind === 'open');
  const actions = cmds.filter(c => !['error', 'open'].includes(c.kind));
  errors.forEach(e => say(h('p', {}, e.message)));
  if (!actions.length) {
    if (opens.length) { navigate(opens.at(-1).route); say(h('p', {}, `${describe(opens.at(-1))}.`)); store.appendCommandLog({ text, action: describe(opens.at(-1)), result: 'done' }); }
    else if (errors.length && voice) speak(errors[0].message);
    return;
  }
  const labels = actions.map(describe);
  const box = say(h('div', { class: 'as-confirm' },
    actions.length === 1 ? h('p', {}, `${labels[0]}?`) : h('div', {}, h('p', {}, `Do these ${actions.length} things?`), h('ul', { class: 'as-plan' }, labels.map(l => h('li', {}, l)))),
    h('div', { class: 'as-confirm-actions' },
      h('span', { class: 'as-confirm-hint' }, voice ? 'Say yes or no' : 'Enter to confirm'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => cancelPending() }, 'Cancel'),
      h('button', { class: 'btn primary sm', type: 'button', onclick: () => confirmPending() }, actions.length > 1 ? 'Do all' : 'Confirm'))));
  pending = { text, actions, labels, opens, box, voice };
  input.placeholder = 'Press Enter to confirm, or type “no”';
  if (voice) {
    speak(`${labels.join('. ')}. Should I go ahead?`, { onEnd: () => { if (pending && !session && !tray.hidden) toggleMic(); } });
  }
}

function confirmPending() {
  if (!pending) return;
  const { text, actions, labels, opens, box, voice } = pending;
  pending = null;
  setMode(mode);
  const done = [];
  actions.forEach((cmd, i) => {
    try {
      const result = execute(cmd);
      store.appendCommandLog({ text, action: labels[i], result });
      done.push(labels[i]);
    } catch (err) {
      store.appendCommandLog({ text, action: labels[i], result: `failed: ${err.message}` });
    }
  });
  tick();
  box.replaceChildren(h('div', {}, h('p', {}, h('strong', {}, 'Done. '), done.length === 1 ? `${done[0]}.` : `${done.length} changes made.`),
    actions.length > 1 ? h('ul', { class: 'as-plan done' }, done.map(l => h('li', {}, l))) : null));
  if (opens.length) navigate(opens.at(-1).route);
  if (voice) speak(done.length === 1 ? `Done. ${done[0]}.` : `Done. ${done.length} changes made.`);
}

function cancelPending(silent = false) {
  if (!pending) return;
  const { text, labels, box } = pending;
  pending = null;
  setMode(mode);
  store.appendCommandLog({ text, action: labels.join('; '), result: 'cancelled' });
  box.replaceChildren(h('p', { class: 'muted' }, silent ? 'Skipped.' : 'Cancelled.'));
}

function placement(tool, type, cmd = {}) {
  switch (tool) {
    case 'taskly': {
      const col = cmd.column || 'todo';
      return { columnId: col, order: store.cardsWhere(c => c.tool === 'taskly' && c.meta?.columnId === col).length };
    }
    case 'boardly': {
      const tabs = store.get('boardlyTabs', []);
      const tab = tabs.find(x => x.id === cmd.tabId) || tabs.find(x => x.id === store.pref('boardlyTab')) || tabs[0];
      const n = store.cardsWhere(c => c.tool === 'boardly' && c.meta?.tabId === tab?.id).length;
      return { tabId: tab?.id, x: 24 + (n % 4) * 228, y: 24 + Math.floor(n / 4) * 84, ...(type === 'goal' ? { smart: {} } : {}) };
    }
    case 'timely': {
      const w = cmd.when || {};
      const meta = { date: w.date || (cmd.reminder ? null : todayKey()) };
      if (w.start != null) { meta.start = w.start; meta.dur = 60; }
      if (w.slot) meta.slot = w.slot;
      if (cmd.reminder) meta.kind = 'reminder';
      return meta;
    }
    case 'brainly': {
      const n = store.cardsWhere(c => c.tool === 'brainly' && !c.meta?.folderId && c.type !== 'link').length;
      return { x: 24 + (n % 4) * 216, y: 24 + Math.floor(n / 4) * 120, emoji: '📝' };
    }
    default: return { order: store.cardsWhere(c => c.tool === 'universal').length };
  }
}

function execute(cmd) {
  if (cmd.kind === 'create') {
    const card = store.createCard({ type: cmd.type, tool: cmd.tool, title: cmd.title, meta: placement(cmd.tool, cmd.type, cmd) });
    return `created ${card.id}`;
  }
  const c = store.getCard(cmd.card.id);
  if (!c) throw new Error('card no longer exists');
  if (cmd.kind === 'move') {
    if (cmd.tool === 'timely' && c.tool === 'timely' && !c.meta?.board) {
      const w = cmd.when || {};
      const meta = { ...c.meta, archivedAt: null };
      if (w.date) meta.date = w.date;
      if (w.start != null) { meta.start = w.start; meta.dur = meta.dur || 60; meta.slot = null; }
      else if (w.slot) { meta.slot = w.slot; meta.start = null; }
      store.updateCard(c.id, { meta }, { replaceMeta: true, log: true, logLabel: 'Rescheduled' });
    } else {
      const type = { taskly: 'task', timely: 'event', brainly: 'note', boardly: ['goal', 'task', 'note'].includes(c.type) ? c.type : 'note', universal: c.type }[cmd.tool];
      if (cmd.tool === c.tool && cmd.tool !== 'timely') store.updateCard(c.id, { meta: placement(cmd.tool, type, cmd) }, { log: true, logLabel: 'Moved' });
      else routeCard(c.id, { tool: cmd.tool, type, meta: placement(cmd.tool, type, cmd) });
    }
    return `moved ${c.id}`;
  }
  if (cmd.kind === 'complete') {
    if (c.tool === 'taskly') store.updateCard(c.id, { meta: placement('taskly', 'task', { column: 'completed' }) }, { log: true, logLabel: 'Completed' });
    else store.updateCard(c.id, { meta: { done: true } }, { log: true, logLabel: 'Completed' });
    return `completed ${c.id}`;
  }
  if (cmd.kind === 'rename') { store.updateCard(c.id, { title: cmd.title }, { log: true, logLabel: 'Renamed' }); return `renamed ${c.id}`; }
  if (cmd.kind === 'delete') { trashCard(c.id); return `deleted ${c.id}`; }
  return 'noop';
}

function openLog() {
  const log = store.get('commandLog', []).slice().reverse();
  modal({
    title: 'Command history', wide: true,
    body: h('div', { class: 'modal-list' },
      h('p', { class: 'muted small' }, 'Every command you confirm or cancel is recorded here. Entries can’t be edited.'),
      log.length ? log.map(e => h('div', { class: 'activity-row' },
        h('span', { class: `log-dot ${e.result === 'cancelled' ? 'off' : ''}` }),
        h('span', { class: 'activity-text' }, e.action, h('small', { class: 'muted' }, `  “${e.text}”`)),
        h('span', { class: 'muted small' }, `${e.result === 'cancelled' ? 'Cancelled' : 'Done'} · ${relTime(e.at)}`))) : h('p', { class: 'muted' }, 'No commands yet.')),
  });
}

export { byOrder, fmtMinutes };
