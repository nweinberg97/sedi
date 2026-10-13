// Sedi — the assistant: a draggable atom with Chat, Voice and Command modes.
// Chat answers from your own cards (and from the Sovereign Brain when it's on).
// Command turns plain language into a change, asks you to confirm, then logs it permanently.

import * as store from './store.js';
import { h, icon, clamp, toast, modal, renderText, todayKey, fmtMinutes, relTime } from './util.js';
import { TOOL_NAMES, typeIcon, byOrder, routeCard, flatten, trashCard } from './cards.js';
import { navigate, revealCard } from './shell.js';
import { available as engineAvailable, chat as engineChat, engineLabel, engineConfig, askClaudeUrl } from './engines.js';
import { summaryFor, ensureSummary, noteText } from './summaries.js';
import { findCard } from './commands.js';
import { nextUpItems } from './home.js';
import { COLUMNS } from './taskly.js';
import { occurrencesOn, weekPlanKey, monthPlanKey } from './timely.js';
import { listen, speak, stopSpeaking, canListen } from './speech.js';
import * as brain from './brain.js';
import { tick } from './sound.js';
import { parseCommands, looksLikeCommand } from './commands.js';

let token, tray, output, input, modeBar, micBtn, statusEl;
let mode = 'chat';
let session = null;
let convo = false; // Voice mode: keep the conversation going (listen → answer out loud → listen again)

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
  const active = engineConfig().active;
  if (active !== 'local') { statusEl.textContent = engineLabel(); statusEl.title = 'Answers come from the engine chosen in Menu → AI engines'; return; }
  statusEl.textContent = !brain.isEnabled() ? 'Search only' : s.status === 'ready' ? 'On-device model' : s.status === 'loading' ? 'Model loading…' : s.status === 'error' ? 'Model offline' : 'On-device model';
  statusEl.title = brain.isEnabled() ? 'Answers come from the open model running on this device' : 'Turn on Sovereign Brain (menu) for an on-device AI, or pick another engine in Menu → AI engines';
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
  if (open) { paintStatus(); positionTray(); setTimeout(() => input.focus(), 30); }
  else { convo = false; session?.stop(); stopSpeaking(); tray.classList.remove('speaking'); }
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
    else { toggle(); token.classList.remove('spin'); void token.offsetWidth; token.classList.add('spin'); setTimeout(() => token.classList.remove('spin'), 1100); }
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
  class: 'as-item', type: 'button', onclick: () => { toggle(false); revealCard(c.id); },
}, typeIcon(c.type), h('span', {}, c.title), h('small', {}, TOOL_NAMES[c.tool]))));
/** Who wrote this answer. */
const engineTag = label => h('span', { class: 'as-engine' }, label);
/** Free hand-off to Claude.ai, with the question and related cards typed in. */
const askClaude = (q, cards) => h('a', {
  class: 'chip ask-claude', href: askClaudeUrl(q, cards.map(c => ({ title: c.title, where: TOOL_NAMES[c.tool], text: flatten(c) }))), target: '_blank', rel: 'noopener noreferrer',
  title: 'Opens Claude.ai in a new tab with your question and related Sedi cards typed in. Uses your own Claude plan. Nothing is sent until you press send there.',
}, 'Ask Claude ↗');

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
  if ((mode === 'voice' || fromVoice) && /^(?:stop|bye|goodbye|good bye|that'?s all|that'?s it|nothing|no thanks|thanks|thank you|we'?re done|end)\b/i.test(text)) {
    convo = false;
    say(h('p', {}, 'Okay. Tap the mic whenever you want to talk again.'));
    speak('Okay. Talk soon.');
    return;
  }
  const reply = await answer(text);
  if ((mode === 'voice' || fromVoice) && reply) talkBack(reply);
}
/** Answer out loud; in Voice mode, start listening again when the answer finishes. */
function talkBack(text) {
  tray.classList.add('speaking');
  speak(text, { onEnd: () => {
    tray.classList.remove('speaking');
    if (convo && mode === 'voice' && !tray.hidden && !session && !pending) startListening();
  } });
}

function toggleMic() {
  if (session) { convo = false; session.stop(); return; }
  // Tapping the mic while I'm talking interrupts me and listens right away.
  convo = mode === 'voice';
  startListening();
}
function startListening() {
  stopSpeaking();
  tray.classList.remove('speaking');
  micBtn.classList.add('on');
  tray.classList.add('listening');
  if (output.querySelector('.as-hint')) output.replaceChildren();
  const live = say(h('span', { class: 'as-interim' }, convo ? 'Listening… (say “stop” to end)' : 'Listening…'), 'me');
  let finalText = '', errored = false;
  session = listen({
    continuous: false,
    onInterim: t => { live.firstChild.textContent = t || 'Listening…'; },
    onFinal: t => { if (!t) return; finalText += (finalText ? ' ' : '') + t; live.firstChild.textContent = finalText; },
    onError: msg => { errored = true; if (!/Didn’t catch/.test(msg) || !convo) toast(msg); },
    onEnd: () => {
      session = null; micBtn.classList.remove('on'); tray.classList.remove('listening');
      live.remove();
      if (finalText) return submit(finalText, { fromVoice: true });
      if (convo) { convo = false; say(h('p', { class: 'muted' }, errored ? 'I didn’t hear anything, so I stopped listening. Tap the mic to talk again.' : 'Paused. Tap the mic to keep talking.')); }
    },
  });
}

// ---------- Chat ----------
const SEARCH_STOP = new Set(('the and for what how are any about with my me show find search look looking did have has had is was were where which who when does do can you please sedi '
  + 'anything something everything all write wrote written saved save related regarding info information there that this those these from into stuff thing things '
  + 'notes note cards card tasks task items item links link goals goal reminders reminder events event list lists got get').split(' '));
const stem = w => w.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s)$/, '');
/** Rank your cards for a question. Words like "notes" or "tasks" narrow the search to that kind instead of matching titles. */
function search(q, n = 5) {
  const lower = q.toLowerCase();
  const kind = /\bnotes?\b/.test(lower) ? 'note' : /\blinks?\b|\bpdfs?\b/.test(lower) ? 'link' : /\bgoals?\b/.test(lower) ? 'goal' : /\breminders?\b/.test(lower) ? 'reminder' : /\b(?:tasks?|to ?dos?)\b/.test(lower) ? 'task' : /\b(?:events?|meetings?|calendar|appointments?)\b/.test(lower) ? 'event' : null;
  const terms = [...new Set((lower.match(/[a-z0-9']+/g) || []).filter(w => w.length > 2 && !SEARCH_STOP.has(w)).map(stem).filter(w => w.length > 1))];
  if (!terms.length) return [];
  const bf = store.get('brainFolders', []);
  const chain = f => { const names = []; let x = f, guard = 0; while (x && guard++ < 8) { names.push(x.name); x = bf.find(y => y.id === x.parentId); } return names.join(' '); };
  const folders = Object.fromEntries([...bf.map(f => [f.id, chain(f)]), ...store.get('linkFolders', []).map(f => [f.id, f.name])]);
  const tabs = Object.fromEntries(store.get('boardlyTabs', []).map(t => [t.id, t.name]));
  const plan = store.get('planContainers', { projects: [], goals: [] });
  const cts = Object.fromEntries([...(plan.projects || []), ...(plan.goals || [])].map(x => [x.id, x.name]));
  const fits = c => !kind || (kind === 'note' ? c.tool === 'brainly' && c.type !== 'link' : kind === 'link' ? c.type === 'link'
    : kind === 'goal' ? c.type === 'goal' : kind === 'reminder' ? c.meta?.kind === 'reminder' : kind === 'task' ? c.type === 'task' : c.tool === 'timely' && c.type === 'event');
  const wordsOf = s => (s.toLowerCase().match(/[a-z0-9']+/g) || []).map(stem);
  return store.allCards().filter(c => !c.meta?.archivedAt).map(c => {
    const title = wordsOf(c.title), body = wordsOf(flatten(c)), place = wordsOf([folders[c.meta?.folderId], folders[c.meta?.linkFolderId], tabs[c.meta?.tabId], cts[c.meta?.containerId]].filter(Boolean).join(' '));
    const has = (list, t) => list.some(w => w === t || (t.length > 3 && w.startsWith(t)));
    let s = 0, matched = 0;
    for (const t of terms) {
      const hit = has(title, t) ? 3 : has(place, t) ? 2 : has(body, t) ? 1 : 0;
      s += hit; if (hit) matched++;
    }
    if (!matched) return { c, s: 0 };
    s += matched === terms.length ? 2 : 0;           // all words found
    if (c.title.toLowerCase().includes(terms.join(' '))) s += 2;
    if (kind) s = fits(c) ? s + 3 : s * 0.3;         // "notes about…" → notes first
    return { c, s };
  }).filter(x => x.s >= 1).sort((a, b) => b.s - a.s || b.c.updatedAt.localeCompare(a.c.updatedAt)).slice(0, n).map(x => x.c);
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
  // SD-B5: "summarize <note>" gives that card's summary.
  // "summarize my notes" / "summarize" on its own: a digest of your latest notes.
  if (/^(?:please\s+)?(?:summari[sz]e|sum up|tl;?dr|recap)(?:\s+(?:all\s+)?(?:of\s+)?(?:my\s+|the\s+)?(?:recent\s+|latest\s+)?(?:notes?|brainly))?[.!?]*$/i.test(q.trim())) {
    const notes = store.cardsWhere(c => c.tool === 'brainly' && c.type !== 'link').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6);
    if (!notes.length) { say(h('p', {}, 'You don’t have any notes yet. Add one in Brainly.')); return 'You don’t have any notes yet.'; }
    const bubble = say(h('div', { class: 'as-digest' }, h('p', {}, h('strong', {}, `Your ${notes.length} latest notes`)),
      ...notes.map(c => h('button', { class: 'as-digest-row', type: 'button', onclick: () => { toggle(false); revealCard(c.id); } }, h('b', {}, c.title), h('span', {}, summaryFor(c).text))),
      engineTag(notes.some(c => summaryFor(c).ai) ? 'AI summaries' : 'Quick summaries · turn on an AI engine for fuller ones')));
    notes.forEach(c => ensureSummary(c).then(r => { if (r?.ai) { const row = [...bubble.querySelectorAll('.as-digest-row')].find(x => x.querySelector('b').textContent === c.title); row?.lastChild && (row.lastChild.textContent = r.text); } }));
    return notes.map(c => `${c.title}: ${summaryFor(c).text}`).join(' ');
  }
  const sm = /^(?:summari[sz]e|sum up|tl;?dr|recap)\s+(?:my\s+|the\s+)?(.+?)(?:\s+(?:note|notes|card|page))?[.!?]*$/i.exec(q.trim());
  if (sm) {
    const all = store.allCards();
    const card = findCard(sm[1], all.filter(c => c.tool === 'brainly' && c.type !== 'link')) || findCard(sm[1], all) || search(sm[1], 1)[0];
    if (card) {
      const bubble = say(h('div', {}, h('p', {}, h('strong', {}, card.title)), h('p', {}, summaryFor(card).text), engineTag(summaryFor(card).ai ? `AI summary · ${summaryFor(card).engine}` : 'Quick summary'), itemList([card])));
      ensureSummary(card).then(s => { if (s?.ai) bubble.firstChild.replaceChildren(h('p', {}, h('strong', {}, card.title)), h('p', {}, s.text), engineTag(`AI summary · ${s.engine}`), itemList([card])); });
      return summaryFor(card).text;
    }
    say(h('p', {}, `I couldn’t find a note matching “${sm[1]}”. Try part of its title.`));
    return `I couldn’t find a note matching ${sm[1]}.`;
  }
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
  // A non-default engine (Claude key, OpenAI-compatible, Ollama) answers with your matching cards as context.
  if (engineConfig().active !== 'local' && engineAvailable()) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, `Asking ${engineLabel()}…`)));
    try {
      const ctx = hits.slice(0, 6).map(c => `- ${c.title} (${TOOL_NAMES[c.tool]})${flatten(c) ? `: ${flatten(c).slice(0, 200)}` : ''}`).join('\n');
      const r = await engineChat({
        system: `You are the assistant inside Sedi, the user's personal planner (Taskly tasks, Boardly goals, Timely calendar, Brainly notes). Be brief and practical.${ctx ? `\n\nRelevant items from the user's Sedi:\n${ctx}` : ''}`,
        messages: [{ role: 'user', content: q }],
      });
      bubble.firstChild.replaceChildren(renderText(r.text), engineTag(r.engine), hits.length ? itemList(hits.slice(0, 3)) : null, askClaude(q, hits));
      return r.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `${engineLabel()} couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  if (brain.isEnabled() && (COACH.test(q) || !hits.length)) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, brain.brainState().status === 'ready' ? 'Thinking…' : 'Waking the brain…')));
    try {
      const ctx = hits.slice(0, 4).map(c => ({ title: c.title, where: TOOL_NAMES[c.tool] }));
      const res = await brain.ask(q, ctx, partial => { bubble.firstChild.replaceChildren(renderText(partial)); output.scrollTop = output.scrollHeight; });
      bubble.firstChild.replaceChildren(renderText(res.text), h('small', { class: 'as-sources' }, `From: ${res.sources.join(', ')}`), engineTag(engineLabel('local')), askClaude(q, hits));
      return res.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `The brain couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  if (hits.length) {
    text = `I found ${hits.length} match${hits.length === 1 ? '' : 'es'}: ${hits.map(c => c.title).join(', ')}.`;
    say(h('div', {}, h('p', {}, `Found ${hits.length} in your Sedi:`), itemList(hits), engineTag('Searched your Sedi'), askClaude(q, hits)));
    return text;
  }
  text = brain.isEnabled() ? 'I couldn’t find anything for that.' : 'Nothing in your Sedi matches that. Turn on the Sovereign Brain (menu) for an on-device AI, or ask Claude with your own plan.';
  say(h('div', {}, h('p', {}, text), askClaude(q, [])));
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
    plan: store.get('planContainers', { projects: [], goals: [] }),
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
  if (c.tool === 'timely' && c.plan) return c.plan === 'weekplan' ? 'this week’s plan' : 'this month’s plan';
  if (c.tool === 'timely' && c.board) return `Timely ${c.board === 'goals' ? 'goal' : 'project'} “${c.containerName}”`;
  if (c.tool === 'timely') return `Timely${c.when ? ` ${whenLabel(c.when)}` : c.reminder ? ' reminders' : ''}${c.dur ? `, ${c.dur >= 60 ? `${+(c.dur / 60).toFixed(1)} hr` : `${c.dur} min`}` : ''}`;
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
    else if (errors.length && voice) talkBack(errors[0].message);
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
    speak(`${labels.join('. ')}. Should I go ahead?`, { onEnd: () => { if (pending && !session && !tray.hidden) { convo = convo || mode === 'voice'; startListening(); } } });
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
  const past = l => l.replace(/^(Create|Move|Mark|Delete|Rename|Reschedule|Open)\b/, w => ({ Create: 'Created', Move: 'Moved', Mark: 'Marked', Delete: 'Deleted', Rename: 'Renamed', Reschedule: 'Rescheduled', Open: 'Opened' }[w]));
  done.splice(0, done.length, ...done.map(past));
  box.replaceChildren(h('div', {}, h('p', {}, h('strong', {}, 'Done. '), done.length === 1 ? `${done[0]}.` : `${done.length} changes made.`),
    actions.length > 1 ? h('ul', { class: 'as-plan done' }, done.map(l => h('li', {}, l))) : null));
  if (opens.length) navigate(opens.at(-1).route);
  if (voice) talkBack(done.length === 1 ? `Done. ${done[0]}.` : `Done. ${done.length} changes made.`);
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
      if (cmd.plan) {
        const planKey = cmd.plan === 'weekplan' ? weekPlanKey(new Date()) : monthPlanKey(new Date());
        return { board: cmd.plan, planKey, done: false, order: store.cardsWhere(c => c.tool === 'timely' && c.meta?.board === cmd.plan && c.meta?.planKey === planKey).length };
      }
      if (cmd.board) {
        const order = store.cardsWhere(c => c.tool === 'timely' && c.meta?.containerId === cmd.containerId).length;
        return { board: cmd.board, containerId: cmd.containerId, order, ...(cmd.board === 'goals' ? { stepKind: 'action', done: false } : {}) };
      }
      const w = cmd.when || {};
      const meta = { date: w.date || (cmd.reminder ? null : todayKey()), itemType: 'task' };
      if (cmd.reminder) delete meta.itemType;
      if (w.start != null) { meta.start = w.start; meta.dur = cmd.dur || 60; }
      else if (cmd.dur) meta.dur = cmd.dur;
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
    if (cmd.tool === 'timely' && (cmd.plan || cmd.board)) {
      const keep = { ...c.meta };
      ['date', 'start', 'dur', 'slot', 'kind', 'recurrence', 'archivedAt', 'containerId', 'board', 'planKey', 'columnId', 'completedAt', 'reviewUntil', 'tabId', 'x', 'y', 'folderId'].forEach(k => delete keep[k]);
      const meta = { ...keep, ...placement('timely', 'task', cmd) };
      const type = cmd.board === 'goals' ? 'goal' : 'task';
      if (c.tool === 'timely') store.updateCard(c.id, { type, meta }, { replaceMeta: true, log: true, logLabel: 'Moved' });
      else routeCard(c.id, { tool: 'timely', type, meta });
      return `moved ${c.id}`;
    }
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
