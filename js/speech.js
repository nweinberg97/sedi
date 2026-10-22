// Sedi — browser speech: dictation (Web Speech API) and spoken replies (speechSynthesis).
// Note: in Chrome, speech recognition is processed by the browser vendor's service and needs a
// connection. Spoken replies use voices installed on your device and work offline.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR || canCapture;
export const canSpeak = 'speechSynthesis' in window;

import * as store from './store.js';
import { roomFor } from './runtime.js';

/** Optional: a Whisper-style transcription service, set in Menu → AI engines. */
function transcriber() {
  const t = store.pref('engine')?.transcribe;
  const key = store.secret('transcribeKey');
  return t?.enabled && t.base && key && navigator.mediaDevices?.getUserMedia && window.MediaRecorder ? { ...t, key } : null;
}
function listenRecorded(cfg, { onInterim, onFinal, onEnd, onError }) {
  let rec = null, stream = null, stopped = false;
  const chunks = [];
  navigator.mediaDevices.getUserMedia({ audio: true }).then(s => {
    stream = s;
    rec = new MediaRecorder(s);
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    rec.onstop = async () => {
      stream.getTracks().forEach(t => t.stop());
      onInterim?.('Transcribing…');
      try {
        const fd = new FormData();
        fd.append('file', new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), 'speech.webm');
        fd.append('model', cfg.model || 'whisper-1');
        const r = await fetch(`${cfg.base.replace(/\/$/, '')}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${cfg.key}` }, body: fd });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j?.error?.message || `status ${r.status}`);
        onFinal?.((j.text || '').trim());
      } catch (err) { onError?.(`Transcription didn’t work: ${err.message}`); }
      onEnd?.();
    };
    rec.start();
    onInterim?.('Recording… tap the mic again to stop');
    if (stopped) rec.stop();
  }).catch(() => { onError?.('Microphone access is blocked. Allow it in your browser’s site settings.'); onEnd?.(); });
  return { stop() { stopped = true; if (rec?.state === 'recording') rec.stop(); } };
}

/** Start dictation. Returns { stop }. Callbacks: onInterim(text), onFinal(text), onEnd(), onError(msg). */
export function listen(opts = {}) {
  // Private by default: when the on-device ears are the ones to use, dictation goes through them too.
  if (earsNow() === 'device' && !transcriber()) {
    const { onInterim, onFinal, onEnd, onError } = opts;
    let s = null, stopped = false;
    const go = () => {
      if (stopped) return onEnd?.();
      s = hearOnce({ onFinal: t => onFinal?.(t), onError, onEnd: () => onEnd?.(), onStatus: t => opts.onStatus?.(t) });
    };
    // First time only: say why there's a download before it starts (the same promise the assistant makes).
    if (voiceNeedsConsent()) askVoiceConsent().then(ok => (ok ? go() : (stopped = true, onEnd?.())));
    else go();
    return { stop() { stopped = true; s?.stop(); } };
  }
  return listenBrowser(opts);
}
/**
 * Dictation into cards and notes. Uses the browser's own speech recognition (Web Speech API) so the
 * mic works the moment you tap it, with no download and no setup. Only browsers without it (e.g. Firefox)
 * fall back to Sedi's private on-device voice.
 */
export function dictate(opts = {}) {
  if (SR && !transcriber()) return listenBrowser(opts);
  return listen(opts);
}
function listenBrowser({ onInterim, onFinal, onEnd, onError, continuous = true } = {}) {
  const tr = transcriber();
  if (tr) return listenRecorded(tr, { onInterim, onFinal, onEnd, onError });
  if (!SR) { onError?.('Voice input isn’t supported in this browser. Try Chrome or Safari.'); onEnd?.(); return { stop() {} }; }
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = continuous;
  let stopped = false, pendingInterim = '';
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) { onFinal?.(r[0].transcript.trim()); pendingInterim = ''; }
      else interim += r[0].transcript;
    }
    if (interim) pendingInterim = interim.trim();
    onInterim?.(interim);
  };
  let fatal = false;
  rec.onerror = e => {
    if (e.error === 'aborted') return;
    if (e.error === 'no-speech' && continuous) return; // a pause is normal while dictating; keep listening
    const msg = {
      'not-allowed': 'Microphone access is blocked. Click the lock icon in the address bar and allow the microphone.',
      'service-not-allowed': 'Speech recognition is turned off in this browser.',
      'network': 'Voice input needs an internet connection in this browser.',
      'no-speech': 'Didn’t catch anything. Try again.',
      'audio-capture': 'No microphone found.',
      'language-not-supported': 'Speech recognition doesn’t support this language here.',
    }[e.error] || `Voice input stopped (${e.error}).`;
    // These won't fix themselves, so don't keep restarting into them.
    if (['not-allowed', 'service-not-allowed', 'network', 'audio-capture', 'language-not-supported'].includes(e.error)) fatal = true;
    onError?.(msg);
  };
  rec.onend = () => {
    if (!stopped && !fatal && continuous) { try { rec.start(); return; } catch {} }
    // Some browsers end without marking the last words final; keep them instead of losing them.
    if (pendingInterim) { onFinal?.(pendingInterim); pendingInterim = ''; }
    onEnd?.();
  };
  try { rec.start(); } catch (err) { onError?.(err.message); onEnd?.(); }
  return { stop() { stopped = true; try { rec.stop(); } catch {} } };
}

let voice = null;
function pickVoice() {
  if (voice || !canSpeak) return voice;
  const voices = speechSynthesis.getVoices();
  const lang = (navigator.language || 'en').slice(0, 2);
  // Best first: downloaded premium/enhanced voices (installed in the system's settings), then good local ones.
  voice = voices.find(v => v.localService && v.lang.startsWith(lang) && /\((?:Premium|Enhanced)\)/i.test(v.name))
    || voices.find(v => v.localService && v.lang.startsWith(lang) && /Ava|Zoe|Evan|Nathan|Samantha|Daniel|Karen|Moira|Allison|Natural|Aria/i.test(v.name))
    || voices.find(v => v.localService && v.lang.startsWith(lang))
    || voices.find(v => v.lang.startsWith(lang)) || voices[0] || null;
  return voice;
}
if (canSpeak) speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice(); };

// ---------- Speaking ----------
// Replies are spoken sentence by sentence from a queue, so a streamed answer can start talking as soon
// as its first sentence is ready. Two voices: the device's own (instant, offline) and an optional
// natural voice (Kokoro, an open model that runs in the browser; downloaded once, about 90 MB).
// Chrome quirks handled for device voices: speaking right after cancel() can be dropped, long utterances
// get cut off after ~15 seconds, and an utterance can be garbage-collected mid-sentence (onend never fires).
const live = new Set();
/** Plain words for the ear: no markdown, no links, short sentences. */
export function speakable(text) {
  return String(text || '')
    .replace(/https?:\/\/\S+/g, 'a link')
    .replace(/[*_#`>|]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s*\n+\s*/g, '. ')
    .replace(/[:;,]\s*\./g, '.')
    .replace(/\.\s*\./g, '.')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
/**
 * Say things the way a person would: numbers, money, percentages, times, dates and symbols become words,
 * so the voice doesn't stumble or spell them out.
 */
const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
function numWords(n) {
  n = Math.floor(Math.abs(n));
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : '');
  if (n < 1000) return `${ONES[Math.floor(n / 100)]} hundred${n % 100 ? ` ${numWords(n % 100)}` : ''}`;
  for (const [v, w] of [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']]) if (n >= v) return `${numWords(n / v)} ${w}${n % v ? ` ${numWords(n % v)}` : ''}`;
  return String(n);
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const ORD = n => ({ 1: 'first', 2: 'second', 3: 'third', 5: 'fifth', 8: 'eighth', 9: 'ninth', 12: 'twelfth', 20: 'twentieth', 30: 'thirtieth' }[n]
  || (n > 20 && n % 10 ? `${TENS[Math.floor(n / 10)]}-${ORD(n % 10)}` : `${numWords(n)}th`));
export function forSpeech(text) {
  return String(text || '')
    .replace(/(\d),(?=\d{3}\b)/g, '$1')
    .replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, y, m, d) => `${MONTH_NAMES[+m - 1] || m} ${ORD(+d)}`)
    .replace(/\b(\d{1,2}):(\d{2})\s*([ap])\.?\s?m\.?/gi, (_, h, mm, ap) => `${numWords(+h)}${mm === '00' ? '' : ` ${+mm < 10 ? 'oh ' : ''}${numWords(+mm)}`} ${ap.toLowerCase() === 'a' ? 'A M' : 'P M'}`)
    .replace(/\b(\d{1,2})\s*([ap])\.?\s?m\.?(?![a-z])/gi, (_, h, ap) => `${numWords(+h)} ${ap.toLowerCase() === 'a' ? 'A M' : 'P M'}`)
    .replace(/\$(\d+)(?:\.(\d{2}))?/g, (_, d, c) => `${numWords(+d)} dollar${+d === 1 ? '' : 's'}${c && +c ? ` and ${numWords(+c)} cents` : ''}`)
    .replace(/(\d+(?:\.\d+)?)\s?%/g, '$1 percent')
    .replace(/\b(\d+)k\b/gi, (_, n) => `${numWords(+n)} K`)
    .replace(/\b(\d+)\/(\d+)\b/g, (_, a, b) => `${numWords(+a)} of ${numWords(+b)}`)
    .replace(/\b\d{1,9}\b/g, n => numWords(+n))
    .replace(/&/g, ' and ').replace(/\s\+\s/g, ' plus ').replace(/\s=\s/g, ' equals ').replace(/→|->/g, ' to ').replace(/[~≈]/g, 'about ')
    .replace(/\s{2,}/g, ' ').trim();
}
const sentences = text => (text.match(/[^.!?]+[.!?]+["”’)]*\s*|[^.!?]+$/g) || []).map(x => x.trim()).filter(Boolean);

function sayDevice(part) {
  return new Promise(resolve => {
    const u = new SpeechSynthesisUtterance(part);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.03;
    live.add(u);
    let ended = false;
    const end = () => { if (ended) return; ended = true; live.delete(u); clearTimeout(guard); resolve(); };
    u.onend = end; u.onerror = end;
    const guard = setTimeout(end, 1500 + part.length * 90); // if the browser never reports the end, move on
    speechSynthesis.speak(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
  });
}

// ----- Natural voice (Kokoro) -----
let ttsLoading = null, audioCtx = null, playing = null;
let naturalState = { status: 'off', progress: 0, error: null };
const naturalListeners = new Set();
export const onNaturalVoiceChange = fn => (naturalListeners.add(fn), () => naturalListeners.delete(fn));
const setNatural = patch => { naturalState = { ...naturalState, ...patch }; naturalListeners.forEach(fn => fn(naturalState)); };
export const naturalVoiceState = () => naturalState;
// The natural voice is the default on computers; phones keep the device voice (smaller download, less memory).
export const replyVoice = () => store.pref('replyVoice') || (isSmallDevice() ? 'device' : 'natural');
let ttsReady = false;
export function prepareNaturalVoice() {
  if (ttsReady) return Promise.resolve(true);
  if (ttsLoading) return ttsLoading;
  setNatural({ status: 'loading', progress: 0, error: null });
  ttsLoading = (async () => {
    if (!store.pref('naturalReady')) {
      const room = await roomFor(140);
      if (!room.ok) throw new Error(`Not enough browser storage for the natural voice: it needs about ${room.needMb} MB free, and ${room.freeMb} MB is available.`);
    }
    // Kokoro runs in the voice worker, so speaking never makes the page stutter.
    await new Promise((resolve, reject) => {
      const off = onWorker(msg => {
        if (msg.type === 'tts:progress') setNatural({ progress: msg.progress });
        else if (msg.type === 'tts:ready') { off(); resolve(); }
        else if (msg.type === 'tts:error' && !msg.id) { off(); reject(new Error(msg.message)); }
        else if (msg.type === 'worker:error') { off(); reject(new Error(msg.message)); }
      });
      voiceWorker().postMessage({ type: 'tts:load' });
    });
    ttsReady = true;
    setNatural({ status: 'ready', progress: 1 });
    store.setPref('naturalReady', true);
    return true;
  })();
  ttsLoading.catch(err => { ttsReady = false; setNatural({ status: 'error', error: err.message || String(err) }); }).finally(() => { ttsLoading = null; });
  return ttsLoading;
}
const naturalReady = () => replyVoice() === 'natural' && ttsReady;
let ttsSeq = 0;
/** Ask the worker for one phrase of speech; resolves to { audio, sampling_rate }. */
function renderNatural(part) {
  const id = ++ttsSeq;
  return new Promise((resolve, reject) => {
    const off = onWorker(msg => {
      if (msg.id !== id) return;
      off();
      if (msg.type === 'tts:audio') resolve({ audio: msg.audio, sampling_rate: msg.rate });
      else reject(new Error(msg.message || 'Speech failed'));
    });
    voiceWorker().postMessage({ type: 'tts:speak', id, text: forSpeech(part), voice: store.pref('naturalVoiceName', 'af_heart'), speed: 1.02 });
  });
}
function playPcm({ audio, sampling_rate }) {
  return new Promise(resolve => {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const buf = audioCtx.createBuffer(1, audio.length, sampling_rate);
    buf.copyToChannel(audio, 0);
    const src = audioCtx.createBufferSource();
    src.buffer = buf; src.connect(audioCtx.destination);
    src.onended = () => { if (playing === src) playing = null; resolve(); };
    playing = src;
    src.start();
  });
}

// ----- The queue -----
let talk = null; // the reply being spoken right now
/**
 * Start a spoken reply that can grow while it plays. push(text) adds words (whole sentences are
 * spoken as soon as they're complete); close() says no more is coming. onEnd fires once, at the end.
 */
export function speechStream({ onEnd } = {}) {
  stopSpeaking();
  const me = { buffer: '', queue: [], closed: false, ended: false, wake: null, onEnd, budget: 1200 };
  talk = me;
  const finish = () => { if (me.ended) return; me.ended = true; if (talk === me) talk = null; if (!me.stopped) me.onEnd?.(); }; // an interrupted reply doesn't report an end
  const take = () => {
    // Start talking at the first natural pause (a comma after a few words) instead of the first full stop.
    if (!me.started && !me.closed) {
      const cm = /^(.{18,}?[,;:—–])\s+/.exec(me.buffer);
      if (cm && !/[.!?]/.test(cm[1])) { me.started = true; me.queue.push(cm[1]); me.budget -= cm[1].length; me.buffer = me.buffer.slice(cm[0].length); }
    }
    const parts = sentences(me.buffer);
    if (parts.length && (me.closed || /[.!?]["”’)]*\s*$/.test(me.buffer) || parts.length > 1)) me.started = true;
    const keep = me.closed ? [] : (/[.!?]["”’)]*\s*$/.test(me.buffer) ? [] : parts.splice(-1));
    me.buffer = keep.join(' ');
    for (const p of parts) { if (me.budget <= 0) break; me.budget -= p.length; me.queue.push(p); }
  };
  const run = async () => {
    if (!canSpeak && !naturalReady()) { finish(); return; }
    if (!naturalReady()) speechSynthesis.cancel();
    await new Promise(r => setTimeout(r, 80)); // give cancel() a beat, or Chrome drops the first utterance
    let next = null; // natural voice: render the next sentence while this one plays
    while (talk === me) {
      if (!me.queue.length) {
        if (me.closed) break;
        await new Promise(r => (me.wake = r)); me.wake = null; continue;
      }
      const part = me.queue.shift();
      if (naturalReady()) {
        try {
          const pcm = await (next?.part === part ? next.p : renderNatural(part));
          next = me.queue[0] ? { part: me.queue[0], p: renderNatural(me.queue[0]) } : null;
          if (talk !== me) break;
          await playPcm(pcm);
        } catch { if (talk === me && canSpeak) await sayDevice(part); }
      } else await sayDevice(part);
    }
    finish();
  };
  const api = {
    push(text) { if (me.ended || me.closed) return api; me.buffer += (me.buffer && !/\s$/.test(me.buffer) ? ' ' : '') + speakable(text); take(); me.wake?.(); return api; },
    close() { me.closed = true; take(); me.wake?.(); return api; },
    get active() { return talk === me; },
  };
  run();
  return api;
}
/** Speak a whole reply. */
export function speak(text, { onEnd } = {}) {
  if (!text || (!canSpeak && !naturalReady())) { onEnd?.(); return; }
  speechStream({ onEnd }).push(text).close();
}
export const stopSpeaking = () => {
  const t = talk; talk = null;
  if (t) { t.stopped = true; t.queue = []; t.wake?.(); }
  if (canSpeak) speechSynthesis.cancel();
  try { playing?.stop(); } catch {} playing = null;
};
export const isSpeaking = () => !!talk;

// ---------- First-time consent for the private voice download ----------
import { hearingDownloaded, hearingModel } from './hearing.js';
import { modal, h } from './util.js';
export const voiceNeedsConsent = () => earsNow() === 'device' && hearingState().status !== 'ready' && !hearingDownloaded() && store.pref('voiceSetupOk') !== hearingModel().id;
export function askVoiceConsent() {
  return new Promise(resolve => {
    let answered = false;
    modal({
      title: 'Private voice',
      body: h('div', { class: 'voice-consent' },
        h('p', {}, `Sedi turns your speech into text right here on this device, so nothing you say is sent anywhere. The first time, it downloads an open speech model (${hearingModel().size}). After that it works offline.`),
        h('p', { class: 'muted small' }, 'Only the words are kept. Each recording lives briefly in memory and is wiped as soon as it’s turned into text.')),
      actions: [
        { label: 'Not now', kind: 'ghost', onClick: () => { answered = true; resolve(false); } },
        { label: 'Set up private voice', kind: 'primary', onClick: () => { answered = true; store.setPref('voiceSetupOk', hearingModel().id); resolve(true); } },
      ],
      onClose: () => { if (!answered) resolve(false); },
    });
  });
}

// ---------- Hearing one utterance (the assistant's ears) ----------
import { captureUtterance, prepareHearing, hearingState, hearingPref, canCapture, shouldPrepare, onHearingChange, isSmallDevice, voiceWorker, onWorker } from './hearing.js';
/** Which ears will be used right now: 'device' (private, on-device Whisper) or 'browser'. */
export function earsNow() {
  const pref = hearingPref(), ready = hearingState().status === 'ready';
  if (pref === 'browser') return SR ? 'browser' : (canCapture ? 'device' : null);
  if (ready && canCapture) return 'device';
  if (pref === 'device' || !SR) return canCapture ? 'device' : null;
  return 'browser';
}
/**
 * Hear one thing the person says and hand back the words.
 * Callbacks: onInterim(text) (browser ears only), onLevel(0..1) (device ears), onSpeech(), onStatus(text),
 * onFinal(text), onEnd({ heard }), onError(msg). Returns { stop(), cancel(), ears }.
 */
export function hearOnce(cb = {}) {
  const ears = earsNow();
  // While the browser's ears are in use, quietly get the private ones ready for next time.
  if (hearingPref() !== 'browser' && canCapture && shouldPrepare()) prepareHearing().catch(() => {});
  if (!ears) { cb.onError?.('Voice input isn’t supported in this browser.'); cb.onEnd?.({ heard: false }); return { stop() {}, cancel() {}, ears }; }
  if (ears === 'device') {
    let inner = null, cancelled = false;
    const go = () => { if (!cancelled) inner = captureUtterance(cb); };
    if (hearingState().status === 'ready') go();
    else {
      setTimeout(() => cb.onPrepare?.(hearingState().progress || 0), 0); // after the caller has its handle
      const off = onHearingChange(st => { if (st.status === 'loading') cb.onPrepare?.(st.progress); });
      prepareHearing().finally(off).then(() => { cb.onPrepare?.(1, true); go(); }, err => { cb.onError?.(/^Not enough browser storage/.test(err?.message) ? err.message : navigator.onLine ? 'Couldn’t set up the private voice just now. Try again in a moment.' : 'The private voice needs a connection the first time, to download. Try again once you’re online.'); cb.onEnd?.({ heard: false }); });
    }
    return { stop() { inner ? inner.stop() : (cancelled = true, cb.onEnd?.({ heard: false })); }, cancel() { cancelled = true; inner ? inner.cancel() : cb.onEnd?.({ heard: false }); }, ears };
  }
  let heard = false, cancelled = false;
  const s = listenBrowser({
    continuous: false,
    onInterim: t => { if (t) cb.onSpeech?.(); cb.onInterim?.(t); },
    onFinal: t => { if (t && !cancelled) { heard = true; cb.onFinal?.(t); } },
    onError: msg => cb.onError?.(msg),
    onEnd: () => cb.onEnd?.({ heard }),
  });
  return { stop() { s.stop(); }, cancel() { cancelled = true; s.stop(); }, ears };
}
