// Sedi — Atom, the assistant. Tap the breathing atom to type, hold it to talk. Voice is input only:
// Atom writes down what you said and answers on screen. It answers from your own cards (and an AI engine
// when one is on), and turns plain language into changes you confirm with a tap.

import * as store from './store.js';
import { h, icon, clamp, toast, modal, renderText, todayKey, fmtMinutes, relTime, popover, closePopovers, homeSpot } from './util.js';
import { TOOL_NAMES, typeIcon, byOrder, routeCard, flatten, trashCard } from './cards.js';
import { navigate, revealCard } from './shell.js';
import { available as engineAvailable, chat as engineChat, engineLabel, engineConfig, rememberAsk, forgetAsk, openEnginesPanel } from './engines.js';
import { summaryFor, ensureSummary, noteText } from './summaries.js';
import { findCard, fixVocabulary } from './commands.js';
import { nextUpItems } from './home.js';
import { COLUMNS } from './taskly.js';
import { occurrencesOn, weekPlanKey, monthPlanKey } from './timely.js';
import { hearOnce, earsNow } from './speech.js';
import { hearingState, onHearingChange, hearingPref, prepareHearing, canCapture, hearingDownloaded, hearingModel, hearingModelKey, HEARING_MODELS, resetHearing } from './hearing.js';
import * as brain from './brain.js';
import { removeModelFiles } from './runtime.js';
import { tick } from './sound.js';
import { parseCommands, looksLikeCommand } from './commands.js';
import { openUnload } from './unload.js';

let token, tray, output, input, statusEl, orb, caption, earsChip;
let session = null;
let unloadCtl = null;   // the Unload session, while it's open
let vstate = 'idle';    // idle | preparing | listening | hearing | thinking

export function buildAssistant() {
  token = h('button', { class: 'assistant-token', 'aria-label': 'Atom (⌘K to type)', title: 'Atom · Tap to open · Hold to talk until you let go · Drag to move', 'aria-expanded': 'false' }, icon('atom'));
  output = h('div', { class: 'as-output', 'aria-live': 'polite' });
  input = h('input', { class: 'as-input', placeholder: 'Ask, or tell Sedi what to change', 'aria-label': 'Message the assistant' });
  statusEl = h('span', { class: 'as-status' });
  earsChip = h('span', { class: 'as-ears' });
  orb = h('button', { class: 'as-orb', type: 'button', 'aria-label': 'Talk', onclick: onOrb }, h('span', { class: 'as-orb-ring' }), prepDots(), h('span', { class: 'as-orb-core' }, icon('mic')));
  caption = h('div', { class: 'as-caption', 'aria-live': 'polite' });
  const more = h('button', { class: 'icon-btn xs', 'aria-label': 'More', title: 'More', onclick: e => openMore(e.currentTarget) }, icon('more'));
  tray = h('section', { class: 'assistant-tray', 'aria-label': 'Atom', hidden: true, dataset: { view: 'voice', state: 'idle' } },
    h('div', { class: 'as-head' }, statusEl, earsChip, h('span', { class: 'head-spacer' }), more,
      h('button', { class: 'icon-btn xs', 'aria-label': 'Close assistant', title: 'Close', onclick: () => toggle(false) }, icon('x'))),
    output,
    h('div', { class: 'as-voice' },
      h('button', { class: 'icon-btn as-side', type: 'button', 'aria-label': 'Type instead', title: 'Type instead', onclick: () => setView('type') }, icon('keyboard')),
      h('div', { class: 'as-orb-wrap' }, orb, caption),
      h('button', { class: 'as-side as-unload-btn', type: 'button', title: 'Unload: talk it all out, then sort it into cards', onclick: () => startUnload() }, icon('list'), h('span', {}, 'Unload'))),
    h('form', { class: 'as-form', onsubmit: e => { e.preventDefault(); submit(input.value); } },
      input,
      h('button', { class: 'icon-btn as-mic', type: 'button', 'aria-label': 'Talk instead', title: 'Talk instead', onclick: () => { setView('voice'); talk(); } }, icon('mic')),
      h('button', { class: 'icon-btn as-send', 'aria-label': 'Send', type: 'submit' }, icon('send'))));
  input.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') toggle(false); });
  makeDraggable();
  // Atom no longer speaks. Free the old natural-voice download (about 90 MB) for anyone who had it.
  if (store.pref('naturalReady')) removeModelFiles(/kokoro/i).then(() => store.setPref('naturalReady', false)).catch(() => {});
  brain.onBrainChange(paintStatus);
  onHearingChange(paintStatus);
  paintStatus();
  setState('idle');
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); toggle(true, { view: 'type' }); }
    if (e.key === 'Escape' && !tray.hidden && !document.querySelector('.modal-backdrop, .popover')) toggle(false);
    if (e.key === ' ' && !tray.hidden && tray.dataset.view === 'voice' && !/^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName) && !e.target.isContentEditable) { e.preventDefault(); onOrb(); }
  });
  document.addEventListener('pointerdown', e => { if (!tray.hidden && tray.dataset.view !== 'unload' && !tray.contains(e.target) && !token.contains(e.target) && !e.target.closest('.modal-backdrop, .toast, .popover')) toggle(false); });
  // First visit only: a quiet hint by the atom, so people discover they can just talk.
  // It's only a label (taps pass through to whatever is underneath), worded for the device in hand.
  const touch = matchMedia('(hover: none)').matches;
  const hint = store.pref('voiceHintSeen') ? null : h('div', { class: 'atom-hint', 'aria-hidden': 'true' },
    h('b', {}, touch ? 'Tap to type, hold to talk' : 'Click to type, hold to talk'), h('span', {}, '“Add a task to call mom”'), h('i'));
  if (hint) {
    token.addEventListener('pointerdown', () => { hint.remove(); store.setPref('voiceHintSeen', true); }, { once: true });
    setTimeout(() => hint.classList.add('in'), 1800);
    // It fades after a while; it shows again next visit until you've used the atom.
    setTimeout(() => { hint.classList.remove('in'); setTimeout(() => hint.remove(), 400); }, touch ? 9000 : 15000);
  }
  return h('div', { class: 'assistant' }, tray, token, hint);
}

function paintStatus() {
  const s = brain.brainState();
  const active = engineConfig().active;
  if (active !== 'local') { statusEl.textContent = engineLabel(); statusEl.title = 'Answers come from the engine chosen in AI engines'; }
  else {
    statusEl.textContent = !brain.isEnabled() ? 'Atom' : s.status === 'ready' ? 'On-device AI' : s.status === 'loading' ? 'AI loading…' : s.status === 'error' ? 'AI offline' : 'On-device AI';
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
  if (done) { clearInterval(prepTimer); prepTimer = null; setState('listening', 'All in place. Listening…'); setTimeout(() => orb.querySelectorAll('.as-prep i').forEach(d => d.classList.remove('placed')), 1200); return; }
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

const CAPTIONS = { preparing: 'Setting up your private voice', idle: 'Tap to talk', listening: 'Listening… tap when you’re done', hearing: 'Listening… tap when you’re done', thinking: 'Writing it down…' };
function setState(st, text) {
  vstate = st;
  tray.dataset.state = st;
  token.classList.toggle('is-listening', st === 'listening' || st === 'hearing');
  orb.setAttribute('aria-label', { preparing: 'Setting up the private voice', idle: 'Talk', listening: 'Done talking', hearing: 'Done talking', thinking: 'Writing it down' }[st]);
  caption.textContent = text || CAPTIONS[st];
  if (st !== 'listening' && st !== 'hearing') orb.style.setProperty('--lvl', 0);
}
function setView(v) {
  if (v !== 'unload') { unloadCtl?.stop(); unloadCtl = null; }
  tray.dataset.view = v;
  if (v === 'type') { session?.cancel(); session = null; setState('idle'); setTimeout(() => input.focus(), 30); }
}

function greet() {
  const tries = ['What’s next today?', 'What did I write about Lisbon?', 'Remind me to call mom tomorrow at 9am'];
  output.replaceChildren(h('div', { class: 'as-hint' },
    h('strong', {}, 'Atom'),
    h('p', {}, 'Ask about anything you’ve saved, or tell it what to change. It shows you the change and waits for your OK.'),
    h('div', { class: 'as-tries' }, tries.map(t => h('button', { class: 'as-try', type: 'button', onclick: () => submit(t, { fromVoice: tray.dataset.view === 'voice' }) }, t)),
      earsNow() ? h('button', { class: 'as-try unload-try', type: 'button', onclick: () => startUnload() }, icon('list'), 'Unload: talk it all out') : null)));
}
/** Clear conversation forgets everything said in it: the messages on screen, the last question kept
 *  for "Ask Claude", and the command history (which records the words of each command). Undo puts it back. */
function clearChat() {
  if (pending) cancelPending(true);
  session?.cancel(); session = null; setState('idle');
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
    if (view === 'type' || !earsNow()) { setView('type'); return; }
    tray.dataset.view = 'voice';
    if (!wasOpen || vstate === 'idle') talk();
  } else { unloadCtl?.stop(); unloadCtl = null; session?.cancel(); session = null; setState('idle'); }
}

// ---------- Unload: the guided brain dump ----------
function startUnload() {
  if (tray.hidden) toggle(true, { view: 'type' });
  if (needsVoiceSetup()) { setView('voice'); showVoiceIntro(); return; }
  session?.cancel(); session = null; setState('idle');
  unloadCtl?.stop();
  tray.dataset.view = 'unload';
  positionTray();
  unloadCtl = openUnload(tray, {
    ctx: commandContext,
    execute,
    again: () => startUnload(),
    onClose: () => { unloadCtl = null; if (tray.dataset.view === 'unload') { tray.dataset.view = 'voice'; positionTray(); } },
  });
}

function positionTray() {
  const r = token.getBoundingClientRect();
  const w = Math.min(tray.dataset.view === 'unload' ? 460 : 400, innerWidth - 24);
  tray.style.width = w + 'px';
  const left = clamp(r.left + r.width / 2 - w / 2, 12, innerWidth - w - 12);
  tray.style.left = left + 'px';
  const above = r.top > innerHeight / 2;
  tray.style.top = ''; tray.style.bottom = '';
  if (above) tray.style.bottom = innerHeight - r.top + 12 + 'px';
  else tray.style.top = r.bottom + 12 + 'px';
}

// ---------- The atom: tap to talk, hold to talk until you let go, drag to move ----------
const HOLD_MS = 350;   // pressed this long without moving → push-to-talk
const DRAG_PX = 12;    // moved further than this → a drag (smaller wobbles still count as a tap)
/** Saved as fractions of the window, so the atom stays on screen when the window changes size. */
function placeToken() {
  const pos = store.pref('assistantPos');
  if (!pos) { token.removeAttribute('style'); return; }
  const fx = pos.fx ?? (pos.x != null ? pos.x / innerWidth : null), fy = pos.fy ?? (pos.y != null ? pos.y / innerHeight : null);
  if (fx == null || fy == null) { token.removeAttribute('style'); return; }
  const x = clamp(fx * innerWidth, 8, innerWidth - 62), y = clamp(fy * innerHeight, 64, innerHeight - 62);
  Object.assign(token.style, { left: x + 'px', top: y + 'px', transform: 'none', bottom: 'auto' });
}
function makeDraggable() {
  placeToken();
  const spot = homeSpot(() => {
    const saved = token.style.cssText;
    token.style.cssText = 'transition: none';
    const r = token.getBoundingClientRect();
    token.style.cssText = saved;
    return r;
  });
  const sendHome = () => { token.removeAttribute('style'); store.setPref('assistantPos', null); if (!tray.hidden) positionTray(); };
  addEventListener('sedi:reset-positions', sendHome);
  const pinned = () => matchMedia('(max-width: 700px)').matches; // phones: the atom sits above the tab bar
  let press = null, lastPress = 0;
  const finish = (e, cancelled) => {
    if (!press || (e && e.pointerId != null && e.pointerId !== press.id)) return;
    const p = press; press = null; lastPress = Date.now();
    clearTimeout(p.timer);
    token.classList.remove('pressing', 'dragging', 'holding');
    try { token.releasePointerCapture(p.id); } catch {}
    if (p.mode === 'hold') { if (session && (vstate === 'listening' || vstate === 'hearing')) session.stop(); return; }
    if (p.mode === 'drag') {
      const r = token.getBoundingClientRect();
      if (spot.near(r)) sendHome(); else store.setPref('assistantPos', { fx: r.left / innerWidth, fy: r.top / innerHeight });
      spot.hide();
      if (!tray.hidden) positionTray();
      return;
    }
    if (cancelled) return;
    toggle(undefined, { view: 'type' }); // a tap opens Atom ready to type; holding is how you talk
    token.classList.remove('spin'); void token.offsetWidth; token.classList.add('spin'); setTimeout(() => token.classList.remove('spin'), 1100);
  };
  token.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text selection or focus jump while pressing
    const r = token.getBoundingClientRect();
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, ox: e.clientX - r.left, oy: e.clientY - r.top, mode: 'tap' };
    try { token.setPointerCapture(e.pointerId); } catch {}
    token.classList.add('pressing');
    // Hold to talk: opens and listens straight away; letting go ends what you said.
    if (earsNow()) press.timer = setTimeout(() => {
      if (press?.mode !== 'tap') return;
      press.mode = 'hold';
      token.classList.add('holding');
      if (tray.hidden) toggle(true); else if (vstate === 'idle') talk();
    }, HOLD_MS);
  });
  token.addEventListener('pointermove', e => {
    if (!press || e.pointerId !== press.id || press.mode === 'hold') return;
    if (press.mode === 'tap') {
      if (Math.hypot(e.clientX - press.x, e.clientY - press.y) < DRAG_PX || pinned()) return;
      press.mode = 'drag';
      clearTimeout(press.timer);
      token.classList.add('dragging');
      spot.show();
    }
    const x = clamp(e.clientX - press.ox, 8, innerWidth - 62), y = clamp(e.clientY - press.oy, 64, innerHeight - 62);
    Object.assign(token.style, { left: x + 'px', top: y + 'px', transform: 'none', bottom: 'auto' });
    spot.near(token.getBoundingClientRect());
    if (!tray.hidden) positionTray();
  });
  token.addEventListener('pointerup', e => finish(e, false));
  token.addEventListener('pointercancel', e => finish(e, true));
  token.addEventListener('lostpointercapture', e => { if (press && e.pointerId === press.id) finish(e, press.mode === 'tap'); });
  // Keyboard: Enter or Space. Some touch browsers also send a detail-0 click right after a tap; that one is skipped.
  token.addEventListener('click', e => { if (e.detail === 0 && Date.now() - lastPress > 600) toggle(undefined, { view: 'type' }); });
  token.addEventListener('contextmenu', e => e.preventDefault());           // long-press on touch screens
  addEventListener('resize', () => { placeToken(); if (!tray.hidden) positionTray(); });
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
async function submit(text, { fromVoice = false } = {}) {
  text = (text || '').trim();
  if (!text) { if (pending) confirmPending(); return; }
  input.value = '';
  if (output.querySelector('.as-hint')) output.replaceChildren();
  say(text, 'me');
  // A pending confirmation takes yes/no answers first.
  if (pending) {
    // Deleting is never done on a spoken "yes": it takes a tap or click on Confirm.
    // Spoken answers never confirm anything: a misheard “yes” mustn't change your cards. Tap Confirm.
    if (fromVoice && (YES.test(text) || NO.test(text))) { say(h('p', {}, 'Tap Confirm or Cancel above.')); return; }
    if (YES.test(text)) return confirmPending();
    if (NO.test(text)) return cancelPending();
    cancelPending(true);
  }
  const ctx = commandContext();
  let cmds = parseCommands(text, ctx);
  let isCommand = cmds.length && looksLikeCommand(text) && cmds.some(c => c.kind !== 'create' || c.explicit || /\b(?:add|create|new|make|remind|schedule|put)\b/i.test(text));
  // With a real AI engine connected, it reads what you meant and restates it in Sedi's plain command form.
  // Sedi's own reader still turns that into actions, so the AI can only propose things Sedi already knows how
  // to do, and you still confirm before anything changes.
  if (smartEngine() && (fromVoice || !isCommand)) {
    if (fromVoice) setState('thinking');
    const restated = await restate(text, ctx).catch(() => null);
    if (restated?.commands?.length) {
      const smart = restated.commands.flatMap(c => parseCommands(c, ctx)).filter(c => c.kind !== 'error' || !cmds.length);
      if (smart.length) { cmds = smart; isCommand = true; }
    } else if (restated?.question) isCommand = false;
  }
  if (isCommand) { proposeCommands(text, cmds, fromVoice); if (fromVoice) setState('idle', 'Tap to talk again'); return; }
  if (fromVoice) setState('thinking', 'Looking…');
  await answer(text);
  if (fromVoice && !session) setState('idle', 'Tap to talk again');
}

function onOrb() {
  // The tips are showing: the orb is the way in, same as Start talking.
  if (output.querySelector('.voice-tips')) { store.setPref('voiceTipsSeen', true); output.replaceChildren(); startListening(); return; }
  // The private-voice question is showing: point at the choices instead of doing nothing.
  const intro = output.querySelector('.voice-intro');
  if (intro) { const b = intro.querySelector('.btn.primary'); b?.classList.remove('nudge'); void b?.offsetWidth; b?.classList.add('nudge'); b?.focus(); return; }
  if (vstate === 'listening' || vstate === 'hearing') { session?.stop(); return; }           // done talking
  if (vstate === 'thinking' || vstate === 'preparing') return;
  talk();
}
/** Start talking, or, the first time, explain the private voice and ask before downloading it. */
function talk() {
  if (needsVoiceSetup()) { showVoiceIntro(); return; }
  if (!store.pref('voiceTipsSeen')) { showVoiceTips(); return; }
  startListening();
}

// ---------- First time in voice mode: two small cards on how a voice chat goes ----------
function showVoiceTips() {
  setState('idle', 'Tap the orb to start talking');
  const go = () => { store.setPref('voiceTipsSeen', true); output.replaceChildren(); startListening(); };
  output.replaceChildren(h('div', { class: 'voice-tips' },
    h('div', { class: 'vt-card' }, h('span', { class: 'vt-num' }, '1'), h('div', {},
      h('strong', {}, 'Talk, then tap'),
      h('p', {}, 'Atom writes down what you say. Tap the orb when you’re done, or just pause. The answer appears here on screen.'))),
    h('div', { class: 'vt-card' }, h('span', { class: 'vt-num' }, '2'), h('div', {},
      h('strong', {}, 'Ask or tell'),
      h('p', {}, 'Ask “what’s next today?”, or say “remind me to call mom at 9”. Before changing anything, Atom shows the change and waits for you to tap Confirm.'))),
    h('div', { class: 'vi-actions' }, h('button', { class: 'btn primary sm', type: 'button', onclick: go }, 'Start talking'))));
}

/** The device's own dictation: Sedi never touches the microphone, it only gets the typed words. */
function dictationTip() {
  const ua = navigator.userAgent;
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  if (ios) return 'Tap the microphone on your keyboard and speak. Your iPhone or iPad does the listening; Sedi only gets the words.';
  if (/Android/.test(ua)) return 'Tap the microphone on your keyboard and speak. Your keyboard does the listening; Sedi only gets the words.';
  if (/Macintosh/.test(ua)) return 'Press the Globe or Fn key twice and speak (turn it on in System Settings → Keyboard → Dictation). Your Mac does the listening; Sedi only gets the words.';
  if (/Windows/.test(ua)) return 'Press Windows + H and speak. Windows does the listening; Sedi only gets the words.';
  return 'Use your keyboard’s dictation button and speak. Your device does the listening; Sedi only gets the words.';
}
const needsVoiceSetup = () => earsNow() === 'device' && hearingState().status !== 'ready' && !hearingDownloaded() && store.pref('voiceSetupOk') !== hearingModel().id; // asks again if the download changes

// ---------- First time: why there's a download, and what stays private ----------
const downloadSize = () => `about ${hearingModel().size.replace(/^about /, '')}`;
function showVoiceIntro() {
  setState('idle', 'Set up private voice to talk');
  const more = h('div', { class: 'vi-more', hidden: true },
    h('ul', {},
      h('li', {}, h('b', {}, 'What downloads: '), `Whisper, an open speech-to-text model, plus the open software that runs them in your browser. ${downloadSize().replace(/^a/, 'A')}, once.`),
      h('li', {}, h('b', {}, 'Where it comes from: '), 'Hugging Face and jsDelivr, the public libraries where open models are shared. They only see that the files were downloaded, never what you say.'),
      h('li', {}, h('b', {}, 'What’s kept: '), 'Only the words, in the cards and messages they go into. Each recording lives briefly in memory and is wiped as soon as it’s turned into text.'),
      h('li', {}, h('b', {}, 'Where it’s stored: '), 'In your browser’s download cache, apart from your cards. You can remove it any time in Voice and hearing.'),
      h('li', {}, h('b', {}, 'Clearing: '), 'Clear conversation erases what you said in it, including the command history.')));
  const card = h('div', { class: 'voice-intro' },
    h('div', { class: 'vi-badge' }, icon('lock'), 'Private voice'),
    h('strong', { class: 'vi-title' }, 'Talk to Atom'),
    h('p', {}, `Once it's set up, your voice stays on this device: Sedi turns your speech into text right here, so nothing you say is sent anywhere. It needs a one-time download of open models (${downloadSize()}), then works offline. Rather not download? Your keyboard's own dictation works too, with nothing extra to install.`),
    h('button', { class: 'vi-link', type: 'button', 'aria-expanded': 'false', onclick: e => { more.hidden = !more.hidden; e.currentTarget.setAttribute('aria-expanded', String(!more.hidden)); e.currentTarget.textContent = more.hidden ? 'What exactly happens?' : 'Hide details'; } }, 'What exactly happens?'),
    more,
    h('div', { class: 'vi-actions' },
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => { card.remove(); greet(); say(h('span', {}, h('b', {}, 'No download needed. '), 'Type here, or speak with your keyboard’s dictation. ', dictationTip())); setView('type'); } }, 'Type or dictate instead'),
      h('button', { class: 'btn primary sm', type: 'button', onclick: () => { store.setPref('voiceSetupOk', hearingModel().id); card.remove(); talk(); } }, 'Set up private voice')));
  output.replaceChildren(card);
}

function startListening() {
  if (session) { session.cancel(); session = null; }
  if (output.querySelector('.as-hint')) output.replaceChildren();
  setState('listening');
  let live = null, finalText = '', problem = '';
  const bubble = () => live || (live = say(h('span', { class: 'as-interim' }, '…'), 'me'));
  const me = session = hearOnce({
    idleMs: 10000,
    onSpeech: () => { if (session === me) setState('hearing'); },
    onInterim: t => { if (t) bubble().firstChild.textContent = t; },
    onLevel: l => orb.style.setProperty('--lvl', l.toFixed(2)),
    onPrepare: (p, done) => { if (session === me) showPrep(p, done); },
    onStatus: t => { if (session === me) caption.textContent = t; if (/Transcribing/.test(t)) bubble().firstChild.textContent = '…'; },
    onFinal: t => { finalText += (finalText ? ' ' : '') + t; },
    onError: msg => { if (!/Didn’t catch/.test(msg)) { problem = msg; toast(msg); } },
    onEnd: () => {
      if (session !== me) { live?.remove(); return; }
      session = null;
      live?.remove();
      paintStatus();
      if (finalText) return submit(fixVocabulary(finalText).trim(), { fromVoice: true });
      setState('idle', /blocked|not-allowed|permission/i.test(problem) ? 'Microphone blocked. Allow it, then tap' : problem ? 'Voice isn’t ready. Tap to try again, or type' : 'Didn’t catch that. Tap to try again');
      if (problem && !/blocked|not-allowed|permission/i.test(problem)) say(h('p', { class: 'muted' }, problem));
    },
  });
}

// ---------- Chat ----------
const SEARCH_STOP = new Set(('the and for what how are any about with my me show find search look looking did have has had is was were where which who when does do can you please sedi '
  + 'anything something everything all write wrote written saved save related regarding info information there that this those these from into stuff thing things '
  + 'notes note cards card tasks task items item links link goals goal reminders reminder events event list lists got get').split(' '));
const stem = w => w.replace(/(?:ies)$/, 'y').replace(/(?:ing|ed|es|s)$/, '').replace(/([b-df-hj-np-tv-z])\1$/, '$1'); // running → run
/** Rank your cards for a question. Words like "notes" or "tasks" narrow the search to that kind instead of matching titles. */
function search(q, n = 5) {
  const lower = q.toLowerCase();
  const kind = /\bnotes?\b/.test(lower) ? 'note' : /\blinks?\b|\bpdfs?\b/.test(lower) ? 'link' : /\bgoals?\b/.test(lower) ? 'goal' : /\breminders?\b/.test(lower) ? 'reminder' : /\b(?:tasks?|to ?dos?)\b/.test(lower) ? 'task' : /\b(?:events?|meetings?|calendar|appointments?)\b/.test(lower) ? 'event' : null;
  const terms = [...new Set((lower.match(/[a-z0-9']+/g) || []).filter(w => w.length > 2 && !SEARCH_STOP.has(w)).map(stem).filter(w => w.length > 1))];
  const fits = c => !kind || (kind === 'note' ? c.tool === 'brainly' && c.type !== 'link' : kind === 'link' ? c.type === 'link'
    : kind === 'goal' ? c.type === 'goal' : kind === 'reminder' ? c.meta?.kind === 'reminder' : kind === 'task' ? c.type === 'task' : c.tool === 'timely' && c.type === 'event');
  // "Show my goals", "list my reminders": nothing to match, so list that kind, newest first.
  if (!terms.length) return kind ? store.allCards().filter(c => !c.meta?.archivedAt && c.meta?.columnId !== 'completed' && fits(c)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, n) : [];
  const bf = store.get('brainFolders', []);
  const chain = f => { const names = []; let x = f, guard = 0; while (x && guard++ < 8) { names.push(x.name); x = bf.find(y => y.id === x.parentId); } return names.join(' '); };
  const folders = Object.fromEntries([...bf.map(f => [f.id, chain(f)]), ...store.get('linkFolders', []).map(f => [f.id, f.name])]);
  const tabs = Object.fromEntries(store.get('boardlyTabs', []).map(t => [t.id, t.name]));
  const plan = store.get('planContainers', { projects: [], goals: [] });
  const cts = Object.fromEntries([...(plan.projects || []), ...(plan.goals || [])].map(x => [x.id, x.name]));
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

// Hellos and mic checks get a friendly hello back, never a search of your cards.
const SMALL_TALK = /^(?:(?:hello|hi|hey|heya|hiya|yo|howdy|good (?:morning|afternoon|evening)|testing|test|tests|one|two|three|1|2|3|mic check|check|can you hear me|do you hear me|are you there|is this (?:on|working)|sedi|hey sedi)[\s,.!?…-]*)+$/i;
const THANKS = /^(?:(?:thanks|thank you|thx|cheers|cool|nice|great|awesome|ok|okay|perfect)[\s,.!?…-]*)+$/i;
async function answer(q) {
  const lower = q.toLowerCase();
  let text;
  if (SMALL_TALK.test(q.trim())) {
    text = /\b(test|testing|hear|check|one|two|three|1|2|3)\b/i.test(q) ? 'I can hear you loud and clear. Ask me something like “what’s next today?”, or tell me what to add.' : 'Hi! Ask me something like “what’s next today?”, or tell me what to add.';
    say(h('p', {}, text));
    return text;
  }
  if (THANKS.test(q.trim())) { text = 'Anytime.'; say(h('p', {}, text)); return text; }
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
    say(h('div', {}, h('p', {}, items.length ? 'Here’s what’s next:' : text), items.length ? itemList(items.map(i => i.card)) : null));
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
        system: `You are the assistant inside Sedi, the user's personal planner (Taskly tasks, Boardly goals, Timely calendar, Brainly notes). Be brief and practical.${ctx ? `\n\nRelevant items from the user's Sedi:\n${ctx}` : ''}`,
        messages: [{ role: 'user', content: q }],
      });
      bubble.firstChild.replaceChildren(renderText(r.text), engineTag(r.engine), hits.length ? itemList(hits.slice(0, 3)) : null);
      return r.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `${engineLabel()} couldn’t answer: ${err.message || err}. Showing matches instead.`));
    }
  }
  // The on-device AI answers only once it's loaded; until then the reply never waits on it.
  if (brain.isEnabled() && brain.brainState().status !== 'ready' && (COACH.test(q) || !hits.length)) {
    brain.warmUp();
    try {
      const [top] = COACH.test(q) ? await brain.retrieve(q, 1) : [];
      if (top) {
        say(h('div', {}, h('p', {}, h('strong', {}, top.title)), h('p', { class: 'as-framework' }, top.text),
          h('small', { class: 'as-sources' }, 'From Sedi’s library. The on-device AI is loading and will tailor answers in a moment.')));
        return `${top.title}. ${top.text}`;
      }
    } catch {}
  }
  if (brain.isEnabled() && brain.brainState().status === 'ready' && (COACH.test(q) || !hits.length)) {
    const bubble = say(h('div', { class: 'as-stream' }, h('span', { class: 'muted' }, 'Thinking…')));
    try {
      const ctx = hits.slice(0, 4).map(c => ({ title: c.title, where: TOOL_NAMES[c.tool] }));
      const res = await brain.ask(q, ctx, partial => { bubble.firstChild.replaceChildren(renderText(partial)); output.scrollTop = output.scrollHeight; });
      bubble.firstChild.replaceChildren(renderText(res.text), h('small', { class: 'as-sources' }, `From: ${res.sources.join(', ')}`), engineTag(engineLabel('local')));
      return res.text;
    } catch (err) {
      bubble.firstChild.replaceChildren(h('span', { class: 'muted' }, `The on-device AI couldn’t answer: ${err.message || err}. Showing matches instead.`));
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

// ---------- Understanding with a real AI engine (Ollama on your Mac, or Claude) ----------
const smartEngine = () => engineConfig().active !== 'local' && engineAvailable();
async function restate(text, ctx) {
  const tabs = (ctx.tabs || []).map(t => t.name).join(', ') || 'none';
  const recent = (ctx.cards || []).slice().sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || '')).slice(0, 40).map(c => `- ${c.title} (${TOOL_NAMES[c.tool]})`).join('\n');
  const system = `You turn what a person said to Sedi, their planner, into Sedi commands. The words may come from speech recognition, so fix obvious mishearings (e.g. "Bordly" or "Bored Lee" is Boardly; "Seti" is Sedi).
Sedi's tools: Taskly (columns: To do, In progress, Review, Completed, Backlog), Boardly (tabs: ${tabs}), Timely (calendar, reminders, this week's plan, this month's plan), Brainly (notes).
Reply with ONLY one of:
COMMANDS:
<one command per line, using exactly these forms>
or
QUESTION
Command forms:
add a task to <column> called <title>
make a note in Boardly <tab> called <title>
make a goal in Boardly <tab> called <title>
make a note in Brainly called <title>
remind me to <title> <when, e.g. tomorrow at 9am>
schedule <title> <when>
move <existing card title> to <column, tab, tool or when>
complete <existing card title>
rename <existing card title> to <new title>
delete <existing card title>
Use existing card titles exactly as listed. Leave out <tab> if they didn't name one.
Their recent cards:
${recent || '- none'}`;
  const r = await engineChat({ system, messages: [{ role: 'user', content: text }], maxTokens: 160 });
  const out = String(r.text || '').trim();
  if (/^QUESTION\b/i.test(out)) return { question: true };
  const m = /COMMANDS:\s*([\s\S]*)$/i.exec(out);
  if (!m) return null;
  const commands = m[1].split('\n').map(l => l.replace(/^[-*\d.)\s]+/, '').trim()).filter(l => l && l.length < 200).slice(0, 5);
  return { commands };
}

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
    return;
  }
  const labels = actions.map(describe);
  const box = say(h('div', { class: 'as-confirm' },
    actions.length === 1 ? h('p', {}, `${labels[0]}?`) : h('div', {}, h('p', {}, `Do these ${actions.length} things?`), h('ul', { class: 'as-plan' }, labels.map(l => h('li', {}, l)))),
    h('div', { class: 'as-confirm-actions' },
      h('span', { class: 'as-confirm-hint' }, voice ? 'Check it, then tap' : 'Enter to confirm'),
      h('button', { class: 'btn ghost sm', type: 'button', onclick: () => cancelPending() }, 'Cancel'),
      h('button', { class: 'btn primary sm', type: 'button', onclick: () => confirmPending() }, actions.length > 1 ? 'Do all' : 'Confirm'))));
  pending = { text, actions, labels, opens, box, voice };
}

function confirmPending() {
  if (!pending) return;
  const { text, actions, labels, opens, box } = pending;
  pending = null;
  const done = [];
  const removed = actions.filter(a => a.kind === 'delete').map(a => store.getCard(a.card.id)).filter(Boolean);
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
    actions.length > 1 ? h('ul', { class: 'as-plan done' }, done.map(l => h('li', {}, l))) : null,
    removed.length ? h('button', { class: 'btn ghost sm', type: 'button', onclick: e => { removed.forEach(c => { if (!store.getCard(c.id)) store.restoreCard(c); }); e.currentTarget.replaceWith(h('span', { class: 'muted' }, 'Restored.')); } }, removed.length === 1 ? 'Undo delete' : 'Undo deletes') : null));
  if (opens.length) navigate(opens.at(-1).route);
  if (!session) setState('idle');
}

function cancelPending(silent = false) {
  if (!pending) return;
  const { text, labels, box } = pending;
  pending = null;
  store.appendCommandLog({ text, action: labels.join('; '), result: 'cancelled' });
  box.replaceChildren(h('p', { class: 'muted' }, silent ? 'Not done, since you moved on. Say it again if you still want it.' : 'Cancelled.'));
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
  const paintHear = () => {
    const s = hearingState();
    hearStatus.textContent = !canCapture ? 'Not available in this browser.' : s.status === 'ready' ? `Ready on this device${s.device === 'webgpu' ? ' (using your GPU)' : ''}.`
      : s.status === 'loading' ? `Downloading… ${Math.round(s.progress * 100)}%` : s.status === 'error' ? 'Couldn’t download it just now (are you offline?). It tries again later.' : `Downloads once, the first time you talk (${hearingModel().size}).`;
    hearStatus.dataset.tone = s.status === 'error' ? 'warn' : s.status === 'ready' ? 'ok' : '';
  };
  const offH = onHearingChange(paintHear);
  paintHear();
  const hear = h('div', { class: 'vs-group', role: 'radiogroup', 'aria-label': 'Hearing' },
    choice('hearing', 'device', hearingPref(), 'Private, on this device', 'Your voice is turned into text on your computer and never leaves it. Only the words are kept; the recording is wiped as soon as it’s transcribed.', hearStatus),
    choice('hearing', 'auto', hearingPref(), 'Private, with a quick start', 'Uses your browser’s speech recognition until the private model has downloaded. In Chrome, that audio goes to Google.'),
    choice('hearing', 'browser', hearingPref(), 'Browser speech recognition', 'Nothing to download. In Chrome, your audio is processed by Google.'));
  const size = h('div', { class: 'vs-group vs-row', role: 'radiogroup', 'aria-label': 'Hearing accuracy' },
    ...Object.entries(HEARING_MODELS).map(([k, m]) => choice('hearingModel', k, hearingModelKey(), m.label, { accurate: `Fewest mistakes. ${m.size}, once. Best on a computer.`, fast: `Moonshine, built for live speech. Very quick. English only. ${m.size}, once.`, light: `Smaller. ${m.size}, once. Best on a phone.` }[k])));
  size.addEventListener('change', e => {
    store.setPref('hearingModel', e.target.value);
    size.querySelectorAll('.vs-choice').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    resetHearing(); paintHear();
    if (hearingPref() !== 'browser' && canCapture) prepareHearing().catch(() => {});
  });
  hear.addEventListener('change', e => {
    store.setPref('hearing', e.target.value);
    hear.querySelectorAll('.vs-choice').forEach(l => l.classList.toggle('on', l.contains(e.target)));
    if (e.target.value !== 'browser' && canCapture) prepareHearing().catch(() => {});
    paintStatus();
  });
  // Voice files live in the browser's cache, apart from your cards (which are in IndexedDB).
  const storageNote = h('small', { class: 'muted' }, 'Voice files are stored in your browser’s cache, apart from your cards.');
  const removeBtn = h('button', { class: 'btn ghost sm', type: 'button', onclick: async () => {
    const n = await removeModelFiles(/whisper|moonshine|kokoro/i);
    store.setPref('hearingReady', false); store.setPref('hearingHave', []); store.setPref('naturalReady', false);
    resetHearing();
    toast(n ? 'Removed the downloaded voice files. They’ll download again if you use voice.' : 'No voice files were stored on this device.');
  } }, icon('trash'), 'Remove voice downloads');
  modal({
    title: 'Voice and hearing', className: 'voice-settings',
    body: h('div', { class: 'vs' },
      h('h3', { class: 'vs-h' }, 'Hearing you'), hear,
      h('h3', { class: 'vs-h' }, 'Accuracy'), size,
      h('p', { class: 'muted small' }, 'Hold the atom and talk, or open Atom and tap the circle. Atom writes down what you said and answers on screen. Space bar works too.'),
      h('div', { class: 'vs-foot' }, storageNote, removeBtn)),
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => offH(),
  });
}
