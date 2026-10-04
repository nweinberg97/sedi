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
  input.placeholder = { chat: 'Ask about your tasks, notes or goals', voice: 'Tap the mic and talk', command: 'e.g. create task call the dentist in Taskly' }[m];
  tray.dataset.mode = m;
  if (!output.childElementCount) greet();
}
function greet() {
  output.replaceChildren(h('p', { class: 'as-hint' }, {
    chat: 'Ask “what’s next?”, “summary”, or search for anything you’ve saved.',
    voice: 'Tap the mic, speak, and I’ll answer out loud.',
    command: 'Say or type a change: create, move, complete or delete a card. You’ll confirm before anything happens.',
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
async function submit(text) {
  text = (text || '').trim();
  if (!text) return;
  input.value = '';
  if (output.querySelector('.as-hint')) output.replaceChildren();
  say(text, 'me');
  if (mode === 'command') return proposeCommand(text);
  const reply = await answer(text);
  if (mode === 'voice' && reply) speak(reply);
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
      if (finalText) submit(finalText);
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
const TOOL_WORDS = { taskly: 'taskly', 'task list': 'taskly', tasks: 'taskly', boardly: 'boardly', board: 'boardly', timely: 'timely', calendar: 'timely', schedule: 'timely', brainly: 'brainly', notes: 'brainly', universal: 'universal', 'universal board': 'universal' };
const DEFAULT_TOOL = { task: 'taskly', note: 'brainly', goal: 'boardly', event: 'timely', reminder: 'timely', link: 'brainly', card: 'universal' };
const COL_WORDS = Object.fromEntries(COLUMNS.map(c => [c.name.toLowerCase(), c.id]).concat([['todo', 'todo'], ['done', 'completed'], ['complete', 'completed']]));

function findCard(phrase) {
  const p = phrase.toLowerCase().replace(/^(the|my|a)\s+/, '').replace(/\s+(card|task|note|goal|event)$/, '').trim();
  const words = p.split(/\s+/);
  let best = null, bestScore = 0;
  for (const c of store.allCards()) {
    const t = c.title.toLowerCase();
    let s = t === p ? 10 : t.includes(p) ? 6 : 0;
    s += words.filter(w => w.length > 1 && t.includes(w)).length / words.length * 4;
    if (s > bestScore) { bestScore = s; best = c; }
  }
  return bestScore >= 3 ? best : null;
}

export function parseCommand(raw) {
  const t = raw.trim().replace(/[.!?]+$/, '');
  const low = t.toLowerCase();
  let m;
  if ((m = /^(?:open|go to|show(?: me)?|switch to)\s+(?:the\s+)?(taskly|boardly|timely|brainly|home)\b/.exec(low))) {
    return { kind: 'open', route: m[1], label: `Open ${m[1][0].toUpperCase() + m[1].slice(1)}` };
  }
  if ((m = /^remind me (?:to\s+)?(.+)$/i.exec(t))) {
    return { kind: 'create', type: 'event', reminder: true, title: cap(m[1]), tool: 'timely', label: `Create reminder “${cap(m[1])}” in Timely` };
  }
  if ((m = /^(?:create|add|make|new)\s+(?:a\s+|an\s+)?(?:new\s+)?(card|task|note|goal|event|reminder)?\s*(?:called|titled|named|for|to)?\s*(.+)$/i.exec(t))) {
    let rest = m[2];
    const type0 = (m[1] || 'card').toLowerCase();
    let tool = DEFAULT_TOOL[type0];
    let column = null;
    const toolRe = /\s+(?:in|to|on|into)\s+(?:the\s+)?(taskly|boardly|timely|brainly|universal board|universal|calendar|schedule|notes|board)(?:\s+(?:in|under)\s+(to do|todo|in progress|review|completed|backlog))?$/i;
    const tm = toolRe.exec(rest);
    if (tm) { tool = TOOL_WORDS[tm[1].toLowerCase()]; column = tm[2] ? COL_WORDS[tm[2].toLowerCase()] : null; rest = rest.slice(0, tm.index); }
    const title = cap(rest.replace(/^["“']|["”']$/g, '').trim());
    if (!title) return null;
    const type = type0 === 'reminder' ? 'event' : type0 === 'card' ? ({ taskly: 'task', boardly: 'note', timely: 'event', brainly: 'note', universal: 'note' })[tool] : type0;
    return { kind: 'create', type, reminder: type0 === 'reminder', title, tool, column, label: `Create ${type0 === 'reminder' ? 'reminder' : type} “${title}” in ${TOOL_NAMES[tool]}` };
  }
  if ((m = /^move\s+(.+?)\s+(?:from\s+\w+(?:\s+board)?\s+)?(?:to|into)\s+(?:the\s+)?(taskly|boardly|timely|brainly|universal board|universal|to do|todo|in progress|review|completed|backlog|done)$/i.exec(t))) {
    const card = findCard(m[1]);
    if (!card) return { kind: 'error', label: `I couldn’t find a card matching “${m[1]}”.` };
    const dest = m[2].toLowerCase();
    if (COL_WORDS[dest]) return { kind: 'move', card, tool: 'taskly', column: COL_WORDS[dest], label: `Move “${card.title}” to ${COLUMNS.find(c => c.id === COL_WORDS[dest]).name} in Taskly` };
    const tool = TOOL_WORDS[dest];
    return { kind: 'move', card, tool, label: `Move “${card.title}” from ${TOOL_NAMES[card.tool]} to ${TOOL_NAMES[tool]}` };
  }
  if ((m = /^(?:complete|finish|check off|mark)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/i.exec(t))) {
    const card = findCard(m[1]);
    if (!card) return { kind: 'error', label: `I couldn’t find a card matching “${m[1]}”.` };
    return { kind: 'complete', card, label: `Mark “${card.title}” as done` };
  }
  if ((m = /^(?:delete|remove|trash|throw away)\s+(.+)$/i.exec(t))) {
    const card = findCard(m[1]);
    if (!card) return { kind: 'error', label: `I couldn’t find a card matching “${m[1]}”.` };
    return { kind: 'delete', card, label: `Delete “${card.title}” from ${TOOL_NAMES[card.tool]}` };
  }
  return null;
}
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function proposeCommand(text) {
  const cmd = parseCommand(text);
  if (!cmd) {
    say(h('p', {}, 'I can create, move, complete, delete or open. Try “create task book flights in Taskly” or “move book flights to Boardly”.'));
    return;
  }
  if (cmd.kind === 'error') { say(h('p', {}, cmd.label)); return; }
  if (cmd.kind === 'open') { navigate(cmd.route); say(h('p', {}, `${cmd.label}.`)); return; }
  const box = say(h('div', { class: 'as-confirm' },
    h('p', {}, cmd.label + '?'),
    h('div', { class: 'as-confirm-actions' },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { box.replaceChildren(h('p', { class: 'muted' }, 'Cancelled.')); store.appendCommandLog({ text, action: cmd.label, result: 'cancelled' }); } }, 'Cancel'),
      h('button', {
        class: 'btn primary sm', type: 'button', onclick: () => {
          const result = execute(cmd);
          store.appendCommandLog({ text, action: cmd.label, result });
          tick();
          box.replaceChildren(h('p', {}, h('strong', {}, 'Done. '), cmd.label + '.'));
          if (mode === 'voice') speak(`Done. ${cmd.label}`);
        },
      }, 'Confirm'))));
}

function placement(tool, type, column) {
  switch (tool) {
    case 'taskly': {
      const col = column || 'todo';
      return { columnId: col, order: store.cardsWhere(c => c.tool === 'taskly' && c.meta?.columnId === col).length };
    }
    case 'boardly': {
      const tabs = store.get('boardlyTabs', []);
      const tab = tabs.find(x => x.id === store.pref('boardlyTab')) || tabs[0];
      const n = store.cardsWhere(c => c.tool === 'boardly' && c.meta?.tabId === tab?.id).length;
      return { tabId: tab?.id, x: 24 + (n % 4) * 228, y: 24 + Math.floor(n / 4) * 84, ...(type === 'goal' ? { smart: {} } : {}) };
    }
    case 'timely': return { date: todayKey() };
    case 'brainly': {
      const n = store.cardsWhere(c => c.tool === 'brainly' && !c.meta?.folderId && c.type !== 'link').length;
      return { x: 24 + (n % 4) * 216, y: 24 + Math.floor(n / 4) * 120, emoji: '📝' };
    }
    default: return { order: store.cardsWhere(c => c.tool === 'universal').length };
  }
}

function execute(cmd) {
  if (cmd.kind === 'create') {
    const meta = placement(cmd.tool, cmd.type, cmd.column);
    if (cmd.reminder) { meta.kind = 'reminder'; meta.date = null; }
    const type = cmd.tool === 'boardly' && !['goal', 'task', 'note'].includes(cmd.type) ? 'note' : cmd.tool === 'timely' ? 'event' : cmd.tool === 'taskly' ? 'task' : cmd.type;
    const card = store.createCard({ type, tool: cmd.tool, title: cmd.title, meta });
    return `created ${card.id}`;
  }
  if (cmd.kind === 'move') {
    const type = { taskly: 'task', timely: 'event', brainly: 'note', boardly: ['goal', 'task', 'note'].includes(cmd.card.type) ? cmd.card.type : 'note', universal: cmd.card.type }[cmd.tool];
    if (cmd.tool === cmd.card.tool && cmd.tool === 'taskly') store.updateCard(cmd.card.id, { meta: placement('taskly', type, cmd.column) }, { log: true, logLabel: 'Moved' });
    else routeCard(cmd.card.id, { tool: cmd.tool, type, meta: placement(cmd.tool, type, cmd.column) });
    return `moved ${cmd.card.id}`;
  }
  if (cmd.kind === 'complete') {
    const c = cmd.card;
    if (c.tool === 'taskly') store.updateCard(c.id, { meta: placement('taskly', 'task', 'completed') }, { log: true, logLabel: 'Completed' });
    else store.updateCard(c.id, { meta: { done: true } }, { log: true, logLabel: 'Completed' });
    return `completed ${c.id}`;
  }
  if (cmd.kind === 'delete') { trashCard(cmd.card.id); return `deleted ${cmd.card.id}`; }
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
