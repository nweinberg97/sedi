// Sedi — speech input: dictation and Atom's ears. Private on-device hearing by default; the browser's own
// speech recognition (in Chrome, processed by Google) is the fallback. Sedi doesn't speak back: answers
// appear on screen.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR || canCapture;

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
import { captureUtterance, captureStream, prepareHearing, hearingState, hearingPref, canCapture, shouldPrepare, onHearingChange } from './hearing.js';
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
  // Only after you've agreed to the download (Set up private voice); never silently.
  if (hearingPref() !== 'browser' && canCapture && shouldPrepare() && (hearingDownloaded() || store.pref('voiceSetupOk') === hearingModel().id)) prepareHearing().catch(() => {});
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

/**
 * Unload's ears: listen continuously and hand back each chunk of speech as text while you keep talking.
 * On-device ears queue each pause-separated stretch for writing down in the background; the browser's
 * ears return a chunk each time they settle on a phrase. Callbacks as captureStream, plus onInterim and onPrepare.
 * Returns { stop() (finish what's queued, then onEnd), cancel(), ears }.
 */
export function hearStream(cb = {}) {
  const ears = earsNow();
  if (!ears) { cb.onError?.('Voice input isn’t supported in this browser.'); cb.onEnd?.(); return { stop() {}, cancel() {}, ears }; }
  if (ears === 'device') {
    let inner = null, cancelled = false;
    const go = () => { if (!cancelled) inner = captureStream(cb); };
    if (hearingState().status === 'ready') go();
    else {
      setTimeout(() => cb.onPrepare?.(hearingState().progress || 0), 0);
      const off = onHearingChange(st => { if (st.status === 'loading') cb.onPrepare?.(st.progress); });
      prepareHearing().finally(off).then(() => { cb.onPrepare?.(1, true); go(); }, err => { cb.onError?.(/^Not enough browser storage/.test(err?.message) ? err.message : navigator.onLine ? 'Couldn’t set up the private voice just now. Try again in a moment.' : 'The private voice needs a connection the first time, to download. Try again once you’re online.'); cb.onEnd?.(); });
    }
    return { stop() { inner ? inner.stop() : (cancelled = true, cb.onEnd?.()); }, cancel() { cancelled = true; inner ? inner.cancel() : cb.onEnd?.(); }, ears };
  }
  let id = 0, done = false;
  const s = listenBrowser({
    continuous: true,
    onInterim: t => { if (t) cb.onSpeech?.(); cb.onInterim?.(t); },
    onFinal: t => { if (t && !done) { id++; cb.onQueued?.(id, 0); cb.onChunk?.(id, t); } },
    onError: msg => cb.onError?.(msg),
    onEnd: () => { if (!done) { done = true; cb.onEnd?.(); } },
  });
  return { stop() { s.stop(); }, cancel() { done = true; s.stop(); cb.onEnd?.(); }, ears };
}
