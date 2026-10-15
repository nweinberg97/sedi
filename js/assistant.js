// Sedi — the assistant: voice first. Tap the breathing atom and talk; it listens, answers out loud,
// and keeps listening until you're done. Typing is one tap away (or ⌘K). It answers from your own cards
// (and an AI engine when one is on), and turns plain language into changes you confirm first.

import * as store from './store.js';
import { h, icon, clamp, toast, modal, renderText, todayKey, fmtMinutes, relTime, popover, closePopovers } from './util.js';
import { TOOL_NAMES, typeIcon, byOrder, routeCard, flatten, trashCard } from './cards.js';
import { navigate, revealCard } from './shell.js';
import { available as engineAvailable, chat as engineChat, engineLabel, engineConfig, rememberAsk, forgetAsk, openEnginesPanel } from './engines.js';
import { summaryFor, ensureSummary, noteText } from './summaries.js';
import { findCard, fixVocabulary } from './commands.js';
import { nextUpItems } from './home.js';
import { COLUMNS } from './taskly.js';
import { occurrencesOn, weekPlanKey, monthPlanKey } from './timely.js';
import { speak, speechStream, stopSpeaking, hearOnce, earsNow, replyVoice, prepareNaturalVoice, naturalVoiceState, onNaturalVoiceChange } from './speech.js';
import { hearingState, onHearingChange, hearingPref, prepareHearing, canCapture, hearingDownloaded, hearingModel, hearingModelKey, HEARING_MODELS, resetHearing } from './hearing.js';
import * as brain from './brain.js';
import { removeModelFiles } from './runtime.js';
import { tick } from './sound.js';
import { parseCommands, looksLikeCommand } from './commands.js';

let token, tray, output, input, statusEl, orb, caption, earsChip;
let session = null;
let convo = false;      // keep the conversation going: listen → answer out loud → listen again
let vstate = 'idle';    // idle | listening | hearing | thinking | speaking
let spokeAlready = false;

export function buildAssistant() {
  token = h('button', { class: 'assistant-token', 'aria-label': 'Talk to Sedi (⌘K to type)', 'aria-expanded': 'false' }, icon('atom'));
  output = h('div', { class: 'as-output', 'aria-live': 'polite' });
  input = h('input', { class: 'as-input', placeholder: 'Type a message, or a change like “move passport to in progress”', 'aria-label': 'Message the assistant' });
  statusEl = h('span', { class: 'as-status' });
  earsChip = h('span', { class: 'as-ears' });
  orb = h('button', { class: 'as-orb', type: 'button', 'aria-label': 'Talk', onclick: onOrb }, h('span', { class: 'as-orb-ring' }), prepDots(), h('span', { class: 'as-orb-core' }, icon('mic')));
  caption = h('div', { class: 'as-caption', 'aria-live': 'polite' });
  const more = h('button', { class: 'icon-btn xs', 'aria-label': 'More', title: 'More', onclick: e => openMore(e.currentTarget) }, icon('more'));
  tray = h('section', { class: 'assistant-tray', 'aria-label': 'Assistant', hidden: true, dataset: { view: 'voice', state: 'idle' } },
    h('div', { class: 'as-head' }, statusEl, earsChip, h('span', { class: 'head-spacer' }), more,
      h('button', { class: 'icon-btn xs', 'aria-label': 'Close assistant', title: 'Close', onclick: () => toggle(false) }, icon('x'))),
    output,
    h('div', { class: 'as-voice' },
      h('button', { class: 'icon-btn as-side', type: 'button', 'aria-label': 'Type instead', title: 'Type instead', onclick: () => setView('type') }, icon('keyboard')),
      h('div', { class: 'as-orb-wrap' }, orb, caption),
      h('span', { class: 'as-side' })),
    h('form', { class: 'as-form', onsubmit: e => { e.preventDefault(); submit(input.value); } },
      input,
      h('button', { class: 'icon-btn as-mic', type: 'button', 'aria-label': 'Talk instead', title: 'Talk instead', onclick: () => { setView('voice'); convo = true; startListening(); } }, icon('mic')),
      h('button', { class: 'icon-btn as-send', 'aria-label': 'Send', type: 'submit' }, icon('send'))));
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') toggle(false); });
  makeDraggable();
  brain.onBrainChange(paintStatus);
  onHearingChange(paintStatus);
  paintStatus();
  setState('idle');
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(true, { view: 'type' }); }
    if (e.key === ' ' && !tray.hidden && tray.dataset.view === 'voice' && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); onOrb(); }
  });
  document.addEventListener('pointerdown', e => { if (!tray.hidden && !tray.contains(e.target) && !token.contains(e.target) && !e.target.closest('.modal-backdrop, .toast, .popover')) toggle(false); });
  return h('div', { class: 'assistant' }, tray, token);
}

function paintStatus() {
  const s = brain.brainState();
  const active = engineConfig().active;
  if (active !== 'local') { statusEl.textContent = engineLabel(); statusEl.title = 'Answers come from the engine chosen in AI engines'; }
  else {
    statusEl.textContent = !brain.isEnabled() ? 'Your Sedi' : s.status === 'ready' ? 'On-device AI' : s.status === 'loading' ? 'AI loading…' : s.status === 'error' ? 'AI offline' : 'On-device AI';
    statusEl.title = brain.isEnabled() ? 'Answers come from the open model running on this device' : 'Answers come from your own cards. Turn on an AI engine for open questions.';
  }
  const ears = earsNow(), hs = hearingState();
  earsChip.replaceChildren(...(ears === 'device' ? [icon('lock'), 'Private'] : hs.status === 'loading' ? [`Private voice ${Math.round(hs.progress * 100)}%`] : []));
  earsChip.title = ears === 'device' ? 'Your voice is transcribed on this device. Nothing is sent anywhere.'
    : hs.status === 'loading' ? 'Downloading the private speech model (once, about 75 MB). Until it’s ready, your browser’s speech recognition is used.' : '';
  earsChip.hidden = !earsChip.childNodes.length;
}

// ---------- Setting up the private voice: everything finds its place ----------
// The first time, the speech model downloads. A loose cloud of dots drifts around the orb, and each one
// springs into its place on the ring as the download moves along. When the ring closes, it listens.
const DOTS = 28;
function prepDots() {
  const wrap = h('span', { class: 'as-prep', 'aria-hidden': 'true' });
  for (let i = 0; i < DOTS; i++) {
    const a = (i / DOTS) * 360, r = 44 + Math.random() * 30, t = Math.random() * 6.283;
    wrap.append(h('i', { style: { '--a': `${a}deg`, '--sx': `${Math.cos(t) * r}px`, '--sy': `${Math.sin(t) * r}px`, '--d': `${(Math.random() * 3).toFixed(2)}s`, '--o': `${i * 18}ms` } }));
  }
  return wrap;
}
const PREP_LINES = ['Setting up your private voice', 'Speech becomes text on this device', 'Recordings are never saved, only words', 'Only the first time'];
let prepLine = 0, prepTimer = null;
function showPrep(p, done) {
  const placed = done ? DOTS : Math.floor(Math.min(0.99, p) * DOTS);
  orb.querySelectorAll('.as-prep i').forEach((d, i) => d.classList.toggle('placed', i < placed));
  if (done) { clearInterval(prepTimer); prepTimer = null; setState('listening', 'All in place. Listening…'); warmNaturalVoice(); return; }
  if (vstate !== 'preparing') {
    setState('preparing');
    prepLine = 0; clearInterval(prepTimer);
    prepTimer = setInterval(() => { prepLine = (prepLine + 1) % PREP_LINES.length; paintPrep(); }, 3200);
  }
  orb.dataset.pct = Math.round(p * 100);
  paintPrep();
}
function paintPrep() {
  if (vstate !== 'preparing') { clearInterval(prepTimer); prepTimer = null; return; }
  caption.replaceChildren(h('span', { class: 'prep-line', key: prepLine }, PREP_LINES[prepLine]), h('b', { class: 'prep-pct' }, ` ${orb.dataset.pct || 0}%`));
}

const CAPTIONS = { preparing: 'Setting up your private voice', idle: 'Tap to talk', listening: 'Listening…', hearing: 'Listening…', thinking: 'Thinking…', speaking: 'Tap to interrupt' };
function setState(st, text) {
  vstate = st;
  tray.dataset.state = st;
  token.classList.toggle('is-listening', st === 'listening' || st === 'hearing');
  orb.setAttribute('aria-label', { preparing: 'Setting up the private voice', idle: 'Talk', listening: 'Done talking', hearing: 'Done talking', thinking: 'Thinking', speaking: 'Interrupt' }[st]);
  caption.textContent = text || CAPTIONS[st];
  if (st !== 'listening' && st !== 'hearing') orb.style.setProperty('--lvl', 0);
}
function setView(v) {
  tray.dataset.view = v;
  if (v === 'type') { convo = false; session?.cancel(); stopSpeaking(); setState('idle'); setTimeout(() => input.focus(), 30); }
}

function greet() {
  const tries = ['What’s next today?', 'What did I write about Lisbon?', 'Remind me to call mom tomorrow at 9am'];
  output.replaceChildren(h('div', { class: 'as-hint' },
    h('strong', {}, 'Talk to Sedi'),
    h('p', {}, 'Ask about anything you’ve saved, or tell it what to change. It answers out loud and checks with you before changing anything.'),
    h('div', { class: 'as-tries' }, tries.map(t => h('button', { class: 'as-try', type: 'button', onclick: () => submit(t, { fromVoice: tray.dataset.view === 'voice' }) }, t)))));
}
/** Clear conversation forgets everything said in it: the messages on screen, the last question kept
 *  for "Ask Claude", and the command history (which records the words of each command). Undo puts it back. */
function clearChat() {
  if (pending) cancelPending(true);
  session?.cancel(); stopSpeaking(); convo = false; setState('idle');
  const kept = [...output.childNodes], log = store.get('commandLog', []);
  output.replaceChildren();
  forgetAsk();
  store.clearCommandLog();
  greet();
  toast('Conversation and command history cleared', { action: 'Undo', onAction: () => { output.replaceChildren(...kept); store.restoreCommandLog(log); } });
}
function openMore(anchor) {
  const item = (ic, label, fn) => h('button', { class: 'as-menu-item', type: 'button', onclick: () => { closePopovers(); fn(); } }, icon(ic), label);
  popover(anchor, h('div', { class: 'as-menu' },
    item('mic', 'Voice and hearing…', openVoiceSettings),
    item('brain', 'AI engines…', () => { toggle(false); openEnginesPanel(); }),
    item('archive', 'Command history', openLog),
    item('eraser', 'Clear conversation', clearChat)), { className: 'as-menu-pop' });
}

function toggle(force, { view = 'voice' } = {}) {
  const open = typeof force === 'boolean' ? force : tray.hidden;
  const wasOpen = !tray.hidden;
  tray.hidden = !open;
  token.setAttribute('aria-expanded', String(open));
  if (open) {
    paintStatus(); positionTray();
    if (!output.childElementCount) greet();
    if (hearingDownloaded() && hearingPref() !== 'browser' && canCapture && hearingState().status === 'off') prepareHearing().catch(() => {});
    if (hearingDownloaded() || store.pref('naturalReady')) warmNaturalVoice();
    if (view === 'type' || !earsNow()) { setView('type'); return; }
    tray.dataset.view = 'voice';
    if (!wasOpen || vstate === 'idle') talk();
  } else { convo = false; session?.cancel(); session = null; stopSpeaking(); setState('idle'); }
}

function positionTray() {
  const r = token.getBoundingClientRect();
  const w = Math.min(400, innerWidth - 24);
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
  while (output.children.length > 14) output.firstChild.remove();
  output.scrollTop = output.scrollHeight;
  return el;
}
const itemList = cards => h('div', { class: 'as-items' }, cards.map(c => h('button', {
  class: 'as-item', type: 'button', onclick: () => { toggle(false); revealCard(c.id); },
}, typeIcon(c.type), h('span', {}, c.title), h('small', {}, TOOL_NAMES[c.tool]))));
/** Who wrote this answer. */
const engineTag = label => h('span', { class: 'as-engine' }, label);

// ---------- Submit ----------
const ENDINGS = /^(?:stop|bye|goodbye|good bye|that'?s all|that'?s it|nothing|no thanks|thanks|thank you|we'?re done|end|i'?m done|done)\b[.!]*$/i;
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
  const isCommand = cmds.length && looksLikeCommand(text) && cmds.some(c => c.kind !== 'create' || c.explicit || /\b(?:add|create|new|make|remind|schedule|put)\b/i.test(text));
  if (isCommand) return proposeCommands(text, cmds, fromVoice);
  if (fromVoice && ENDINGS.test(text)) {
    convo = false;
    say(h('p', {}, 'Okay. Tap the atom whenever you want to talk again.'));
    setState('speaking');
    speak('Okay. Talk soon.', { onEnd: () => setState('idle') });
    return;
  }
  if (fromVoice) setState('thinking');
  spokeAlready = false;
  const reply = await answer(text, { voice: fromVoice });
  if (fromVoice && reply && !spokeAlready) talkBack(reply);
  else if (fromVoice && !spokeAlready) afterSpeaking();
}
/** Answer out loud, then listen again while the conversation is going. */
function talkBack(text) {
  setState('speaking');
  speak(text, { onEnd: afterSpeaking });
}
function afterSpeaking() {
  if (convo && !tray.hidden && tray.dataset.view === 'voice' && !session) startListening({ followUp: true });
  else if (!session) setState('idle');
}

function onOrb() {
  if (vstate === 'speaking') { stopSpeaking(); convo = true; startListening(); return; }      // tap to interrupt
  if (vstate === 'listening' || vstate === 'hearing') { session?.stop(); return; }           // done talking
  if (vstate === 'thinking' || vstate === 'preparing') return;
  talk();
}
/** Start talking, or, the first time, explain the private voice and ask before downloading it. */
function talk() {
  if (needsVoiceSetup()) { showVoiceIntro(); return; }
  convo = true; startListening();
}
const needsVoiceSetup = () => earsNow() === 'device' && hearingState().status !== 'ready' && !hearingDownloaded() && !store.pref('voiceSetupOk');

// ---------- First time: why there's a download, and what stays private ----------
const downloadSize = () => {
  const hear = hearingModel().size.replace(/^about /, '');
  return replyVoice() === 'natural' ? `about ${hear} for hearing, plus about 90 MB for the natural voice` : `about ${hear}`;
};
/** The natural voice downloads quietly after hearing is ready, and loads from the cache after that. */
function warmNaturalVoice() {
  if (replyVoice() === 'natural' && naturalVoiceState().status === 'off') prepareNaturalVoice().catch(() => {});
}
function showVoiceIntro() {
  setState('idle', 'Set up private voice to talk');
  const more = h('div', { class: 'vi-more', hidden: true },
    h('ul', {},
      h('li', {}, h('b', {}, 'What downloads: '), `Whisper, an open speech-to-text model${replyVoice() === 'natural' ? ', and Kokoro, an open voice model for natural-sounding replies' : ''}, plus the open software that runs them in your browser. ${downloadSize().replace(/^a/, 'A')}, once.`),
      h('li', {}, h('b', {}, 'Where it comes from: '), 'Hugging Face and jsDelivr, the public libraries where open models are shared. They only see that the files were downloaded, never what you say.'),
      h('li', {}, h('b', {}, 'What’s kept: '), 'Only the words, in the cards and messages they go into. Each recording lives briefly in memory and is wiped as soon as it’s turned into text.'),
      h('li', {}, h('b', {}, 'Where it’s stored: '), 'In your browser’s download cache, apart from your cards. You can remove it any time in Voice and hearing.'),
      h('li', {}, h('b', {}, 'Clearing: '), 'Clear conversation erases what you said in it, including the command history.')));
  const card = h('div', { class: 'voice-intro' },
    h('div', { class: 'vi-badge' }, icon('lock'), 'Private voice'),
    h('strong', { class: 'vi-title' }, 'Talk to Sedi'),
    h('p', {}, `Your voice stays on this device: Sedi turns your speech into text right here, so nothing you say is sent anywhere. To do that, it needs a one-time download of open models (${downloadSize()}). After that, it works offline.`),
    h('button', { class: 'vi-link', type: 'button', 'aria-expanded': 'false', onclick: e => { more.hidden = !more.hidden; e.currentTarget.setAttribute('aria-expanded', String(!more.hidden)); e.currentTarget.textContent = more.hidden ? 'What exactly happens?' : 'Hide details'; } }, 'What exactly happens?'),
    more,
    h('div', { class: 'vi-actions' },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { card.remove(); greet(); setView('type'); } }, 'Type instead'),
      h('button', { class: 'btn primary sm', type: 'button', onclick: () => { store.setPref('voiceSetupOk', true); card.remove(); convo = true; startListening(); } }, 'Set up private voice')));
  output.replaceChildren(card);
}

function startListening({ followUp = false } = {}) {
  stopSpeaking();
  if (session) { session.cancel(); session = null; }
  if (output.querySelector('.as-hint')) output.replaceChildren();
  setState('listening', followUp && !pending ? 'Listening… say “bye” to finish' : null);
  let live = null, finalText = '';
  const bubble = () => live || (live = say(h('span', { class: 'as-interim' }, '…'), 'me'));
  const me = session = hearOnce({
    idleMs: followUp ? 7000 : 10000,
    onSpeech: () => { if (session === me) setState('hearing'); },
    onInterim: t => { if (t) bubble().firstChild.textContent = t; },
    onLevel: l => orb.style.setProperty('--lvl', l.toFixed(2)),
    onPrepare: (p, done) => { if (session === me) showPrep(p, done); },
    onStatus: t => { if (session === me) caption.textContent = t; if (/Transcribing/.test(t)) bubble().firstChild.textContent = '…'; },
    onFinal: t => { finalText += (finalText ? ' ' : '') + t; },
    onError: msg => { if (!/Didn’t catch/.test(msg)) toast(msg); },
    onEnd: () => {
      if (session !== me) { live?.remove(); return; }
      session = null;
      live?.remove();
      paintStatus();
      if (finalText) return submit(fixVocabulary(finalText).trim(), { fromVoice: true });
      convo = false;
      setState('idle');
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

async function answer(q, { voice = false } = {}) {
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
  rememberAsk(q, hits.map(c => ({ title: c.title, where: TOOL_NAMES[c.tool], text: flatten(c) })));
  // A non-default engine (Claude key, OpenAI-compatible, Ollama) answers with your matching cards as context.
  if (engineConfig().active !== 'local' && engineAvailable()) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, `Asking ${engineLabel()}…`)));
    try {
      const ctx = hits.slice(0, 6).map(c => `- ${c.title} (${TOOL_NAMES[c.tool]})${flatten(c) ? `: ${flatten(c).slice(0, 200)}` : ''}`).join('\n');
      const r = await engineChat({
        system: `You are the assistant inside Sedi, the user's personal planner (Taskly tasks, Boardly goals, Timely calendar, Brainly notes). Be brief and practical.${voice ? ' Your reply will be spoken aloud: answer in one to three short, natural sentences, with no lists, headings or markdown.' : ''}${ctx ? `\n\nRelevant items from the user's Sedi:\n${ctx}` : ''}`,
        messages: [{ role: 'user', content: q }],
      });
      bubble.firstChild.replaceChildren(renderText(r.text), engineTag(r.engine), hits.length ? itemList(hits.slice(0, 3)) : null);
      return r.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `${engineLabel()} couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  if (brain.isEnabled() && (COACH.test(q) || !hits.length)) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, brain.brainState().status === 'ready' ? 'Thinking…' : 'Waking the brain…')));
    try {
      const ctx = hits.slice(0, 4).map(c => ({ title: c.title, where: TOOL_NAMES[c.tool] }));
      // Spoken replies start with the first finished sentence instead of waiting for the whole answer.
      let voiceOut = null, sent = 0;
      const res = await brain.ask(q, ctx, partial => {
        bubble.firstChild.replaceChildren(renderText(partial)); output.scrollTop = output.scrollHeight;
        if (voice && tray.dataset.view === 'voice') {
          if (!voiceOut) { voiceOut = speechStream({ onEnd: afterSpeaking }); setState('speaking'); spokeAlready = true; }
          voiceOut.push(partial.slice(sent)); sent = partial.length;
        }
      });
      if (voiceOut) { voiceOut.push(res.text.slice(sent)); voiceOut.close(); }
      bubble.firstChild.replaceChildren(renderText(res.text), h('small', { class: 'as-sources' }, `From: ${res.sources.join(', ')}`), engineTag(engineLabel('local')));
      return res.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `The brain couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  if (hits.length) {
    text = `I found ${hits.length} match${hits.length === 1 ? '' : 'es'}: ${hits.map(c => c.title).join(', ')}.`;
    say(h('div', {}, h('p', {}, `Found ${hits.length} in your Sedi:`), itemList(hits), engineTag('Searched your Sedi')));
    return text;
  }
  text = brain.isEnabled() ? 'I couldn’t find anything for that.' : 'Nothing in your Sedi matches that. Turn on the on-device AI in Settings for open questions.';
  say(h('div', {}, h('p', {}, text)));
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
  if (voice) {
    setState('speaking');
    speak(`${labels.join('. ')}. Should I go ahead?`, { onEnd: () => { if (pending && !session && !tray.hidden) { convo = true; startListening(); } else if (!session) setState('idle'); } });
  }
}

function confirmPending() {
  if (!pending) return;
  const { text, actions, labels, opens, box, voice } = pending;
  pending = null;
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
  else if (!session) setState('idle');
}

function cancelPending(silent = false) {
  if (!pending) return;
  const { text, labels, box, voice: pendingVoice } = pending;
  pending = null;
  store.appendCommandLog({ text, action: labels.join('; '), result: 'cancelled' });
  box.replaceChildren(h('p', { class: 'muted' }, silent ? 'Skipped.' : 'Cancelled.'));
  if (!silent && pendingVoice) talkBack('Okay, I won’t.');
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
      h('p', { class: 'muted small' }, 'Every command you confirm or cancel is recorded here, on this device only. Clear conversation erases it.'),
      log.length ? log.map(e => h('div', { class: 'activity-row' },
        h('span', { class: `log-dot ${e.result === 'cancelled' ? 'off' : ''}` }),
        h('span', { class: 'activity-text' }, e.action, h('small', { class: 'muted' }, `  “${e.text}”`)),
        h('span', { class: 'muted small' }, `${e.result === 'cancelled' ? 'Cancelled' : 'Done'} · ${relTime(e.at)}`))) : h('p', { class: 'muted' }, 'No commands yet.')),
  });
}

export { byOrder, fmtMinutes };

// ---------- Voice and hearing settings ----------
function openVoiceSettings() {
  const choice = (name, value, current, title, note, extra = null) => h('label', { class: `vs-choice ${value === current ? 'on' : ''}` },
    h('input', { type: 'radio', name, value, checked: value === current }),
    h('span', { class: 'vs-text' }, h('b', {}, title), h('small', {}, note), extra));
  const hearStatus = h('small', { class: 'vs-status' });
  const voiceStatus = h('small', { class: 'vs-status' });
  const paintHear = () => {
    const s = hearingState();
    hearStatus.textContent = !canCapture ? 'Not available in this browser.' : s.status === 'ready' ? `Ready on this device${s.device === 'webgpu' ? ' (using your GPU)' : ''}.`
      : s.status === 'loading' ? `Downloading… ${Math.round(s.progress * 100)}%` : s.status === 'error' ? 'Couldn’t download it just now (are you offline?). It tries again later.' : `Downloads once, the first time you talk (${hearingModel().size}).`;
    hearStatus.dataset.tone = s.status === 'error' ? 'warn' : s.status === 'ready' ? 'ok' : '';
  };
  const paintVoice = () => {
    const s = naturalVoiceState();
    voiceStatus.textContent = s.status === 'ready' ? 'Ready.' : s.status === 'loading' ? `Downloading… ${Math.round(s.progress * 100)}%` : s.status === 'error' ? 'Couldn’t download it just now, so your device’s voice is used.' : 'Downloads once when you choose it (about 90 MB).';
    voiceStatus.dataset.tone = s.status === 'error' ? 'warn' : s.status === 'ready' ? 'ok' : '';
  };
  const offH = onHearingChange(paintHear), offV = onNaturalVoiceChange(paintVoice);
  paintHear(); paintVoice();
  const hear = h('div', { class: 'vs-group', role: 'radiogroup', 'aria-label': 'Hearing' },
    choice('hearing', 'device', hearingPref(), 'Private, on this device', 'Your voice is turned into text on your computer and never leaves it. Only the words are kept; the recording is wiped as soon as it’s transcribed.', hearStatus),
    choice('hearing', 'auto', hearingPref(), 'Private, with a quick start', 'Uses your browser’s speech recognition until the private model has downloaded. In Chrome, that audio goes to Google.'),
    choice('hearing', 'browser', hearingPref(), 'Browser speech recognition', 'Nothing to download. In Chrome, your audio is processed by Google.'));
  const size = h('div', { class: 'vs-group vs-row', role: 'radiogroup', 'aria-label': 'Hearing accuracy' },
    ...Object.entries(HEARING_MODELS).map(([k, m]) => choice('hearingModel', k, hearingModelKey(), m.label, k === 'accurate' ? `Fewest mistakes. ${m.size}, once. Best on a computer.` : `Smaller and faster. ${m.size}, once. Best on a phone.`)));
  size.addEventListener('change', e => {
    store.setPref('hearingModel', e.target.value);
    size.querySelectorAll('.vs-choice').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    resetHearing(); paintHear();
    if (hearingPref() !== 'browser' && canCapture) prepareHearing().catch(() => {});
  });
  const sample = h('button', { class: 'btn ghost sm', type: 'button', onclick: () => speak('Hi. This is how I’ll sound when I answer you.') }, icon('play'), 'Hear it');
  const voice = h('div', { class: 'vs-group', role: 'radiogroup', 'aria-label': 'Reply voice' },
    choice('replyVoice', 'device', replyVoice(), 'Your device’s voice', 'Instant and offline. How natural it sounds depends on your device.'),
    choice('replyVoice', 'natural', replyVoice(), 'Natural voice', 'Sounds like a person. An open voice model (Kokoro) that runs on your device, so nothing is sent anywhere. Your device’s voice fills in while it downloads.', voiceStatus));
  hear.addEventListener('change', e => {
    store.setPref('hearing', e.target.value);
    hear.querySelectorAll('.vs-choice').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    if (e.target.value !== 'browser' && canCapture) prepareHearing().catch(() => {});
    paintStatus();
  });
  voice.addEventListener('change', e => {
    store.setPref('replyVoice', e.target.value);
    voice.querySelectorAll('.vs-choice').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    if (e.target.value === 'natural') prepareNaturalVoice().catch(err => toast(`The natural voice couldn’t load, so your device’s voice will be used: ${err.message || err}`));
  });
  // Voice files live in the browser's cache, apart from your cards (which are in IndexedDB).
  const storageNote = h('small', { class: 'muted' }, 'Voice files are stored in your browser’s cache, apart from your cards.');
  const removeBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
    const n = await removeModelFiles(/whisper|kokoro/i);
    store.setPref('hearingReady', false); store.setPref('naturalReady', false);
    toast(n ? 'Removed the downloaded voice files. They’ll download again if you use voice.' : 'No voice files were stored on this device.');
  } }, icon('trash'), 'Remove voice downloads');
  modal({
    title: 'Voice and hearing', className: 'voice-settings',
    body: h('div', { class: 'vs' },
      h('h3', { class: 'vs-h' }, 'Hearing you'), hear,
      h('h3', { class: 'vs-h' }, 'Accuracy'), size,
      h('div', { class: 'vs-h-row' }, h('h3', { class: 'vs-h' }, 'Answering you'), sample), voice,
      h('p', { class: 'muted small' }, 'Tap the atom and talk. Tap the circle to interrupt while it’s speaking, or say “bye” to finish. Space bar works too.'),
      h('div', { class: 'vs-foot' }, storageNote, removeBtn)),
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => { offH(); offV(); },
  });
}
