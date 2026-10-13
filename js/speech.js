// Sedi — browser speech: dictation (Web Speech API) and spoken replies (speechSynthesis).
// Note: in Chrome, speech recognition is processed by the browser vendor's service and needs a
// connection. Spoken replies use voices installed on your device and work offline.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

import * as store from './store.js';

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
export function listen({ onInterim, onFinal, onEnd, onError, continuous = true } = {}) {
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
  rec.onerror = e => {
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it in your browser’s site settings.',
      'network': 'Voice input needs an internet connection in this browser.',
      'no-speech': 'Didn’t catch anything. Try again.',
      'audio-capture': 'No microphone found.',
    }[e.error] || `Voice input stopped (${e.error}).`;
    if (e.error !== 'aborted') onError?.(msg);
  };
  rec.onend = () => {
    if (!stopped && continuous) { try { rec.start(); return; } catch {} }
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
  voice = voices.find(v => v.localService && v.lang.startsWith(lang) && /Samantha|Daniel|Karen|Moira|Ava|Allison|Natural|Aria/i.test(v.name))
    || voices.find(v => v.localService && v.lang.startsWith(lang))
    || voices.find(v => v.lang.startsWith(lang)) || voices[0] || null;
  return voice;
}
if (canSpeak) speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice(); };

// Chrome quirks handled here: speaking right after cancel() can be dropped, long utterances get cut off
// after ~15 seconds, and an utterance can be garbage-collected mid-sentence (so onend never fires).
let queue = [], speakToken = 0;
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
export function speak(text, { onEnd } = {}) {
  if (!canSpeak || !text) { onEnd?.(); return; }
  const token = ++speakToken;
  speechSynthesis.cancel();
  const clean = speakable(text).slice(0, 1200);
  // Speak in sentence-sized pieces so nothing gets cut off.
  const parts = (clean.match(/[^.!?]+[.!?]*/g) || [clean]).reduce((acc, s) => {
    const last = acc[acc.length - 1];
    if (last && (last + s).length < 180) acc[acc.length - 1] = last + s; else acc.push(s);
    return acc;
  }, []).map(x => x.trim()).filter(Boolean);
  queue = parts;
  let finished = false;
  const done = () => { if (finished) return; finished = true; onEnd?.(); };
  const next = () => {
    if (token !== speakToken) return;          // a newer reply took over
    const part = queue.shift();
    if (!part) return done();
    const u = new SpeechSynthesisUtterance(part);
    const v = pickVoice();
    if (v) u.voice = v;
    u.rate = 1.03;
    live.add(u);
    let ended = false;
    const end = () => { if (ended) return; ended = true; live.delete(u); clearTimeout(guard); next(); };
    u.onend = end;
    u.onerror = end; // next() bows out if a newer reply took over
    // Safety net: if the browser never reports the end, move on anyway.
    const guard = setTimeout(end, 1500 + part.length * 90);
    speechSynthesis.speak(u);
    if (speechSynthesis.paused) speechSynthesis.resume();
  };
  setTimeout(next, 80); // give cancel() a beat, or Chrome drops the first utterance
}
export const stopSpeaking = () => { speakToken++; queue = []; if (canSpeak) speechSynthesis.cancel(); };
export const isSpeaking = () => canSpeak && (speechSynthesis.speaking || queue.length > 0);
