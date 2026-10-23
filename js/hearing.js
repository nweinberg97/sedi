// Sedi — private hearing: speech-to-text that runs on this device.
// The microphone is read through Web Audio. A small voice-activity detector decides when you
// start and stop talking, and the finished utterance is transcribed by Whisper running in the
// browser (Transformers.js, the same open runtime the on-device brain uses), in a worker off the main thread.
// Nothing leaves the device.
// The model downloads once (about 80–150 MB, depending on your device) and is served from the browser cache after that.
// Where the files come from (Sedi's own copies, or the pinned public sources) is decided in runtime.js.

import * as store from './store.js';
import { roomFor } from './runtime.js';

// Three choices. "Accurate" (Whisper Small) makes the fewest mistakes and is the default on computers;
// "Fast" (Moonshine Base) is built for live speech and very quick, English only; "Light" (Whisper Base)
// is the default on phones, where memory and downloads are tighter.
export const HEARING_MODELS = {
  accurate: { id: 'onnx-community/whisper-small', label: 'Accurate', size: 'about 250–300 MB', mb: 300 },
  fast: { id: 'onnx-community/moonshine-base-ONNX', label: 'Fast', size: 'about 60–120 MB', mb: 130, englishOnly: true },
  light: { id: 'onnx-community/whisper-base', label: 'Light', size: 'about 80–150 MB', mb: 160 },
};
// The first conversation should start quickly: English speakers on a computer get Moonshine ("Fast", the smallest
// download); everyone else gets Whisper Base. "Accurate" is one tap away in Voice and hearing.
const english = () => (navigator.language || 'en').toLowerCase().startsWith('en');
export const hearingModelKey = () => store.pref('hearingModel') || (!isSmallDevice() && english() ? 'fast' : 'light');
/** Pin the model the first time voice is set up, so resizing the window (which changes the
 *  phone/computer guess) never swaps it for a different download. */
export const lockHearingModel = () => { if (!store.pref('hearingModel')) store.setPref('hearingModel', hearingModelKey()); };
export const hearingModel = () => HEARING_MODELS[hearingModelKey()] || HEARING_MODELS.accurate;
/** True once the chosen model has been downloaded on this device. */
export const hearingDownloaded = () => store.pref('hearingReady') === hearingModel().id || (store.pref('hearingHave') || []).includes(hearingModel().id);
const RATE = 16000;

let state = { status: 'off', progress: 0, error: null };
const listeners = new Set();
export const onHearingChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
export const hearingState = () => state;
export const canCapture = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext) && window.Worker);
/** 'device' (private: on-device only; the default), 'auto' (on-device when ready, browser until then) or 'browser'. */
// Default: start instantly with the browser's speech recognition, and switch to the private on-device
// model once it has downloaded (once, in the background). 'device' and 'browser' stay one tap away.
export const hearingPref = () => store.pref('hearing', 'auto');
export const isSmallDevice = () => matchMedia('(max-width: 700px)').matches || (navigator.deviceMemory && navigator.deviceMemory < 6);

// ---------- The voice worker (models run there, off the main thread) ----------
let worker = null;
const handlers = new Set();
export function voiceWorker() {
  if (!worker) {
    worker = new Worker(new URL('./voice-worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = e => handlers.forEach(fn => fn(e.data));
    worker.onerror = e => handlers.forEach(fn => fn({ type: 'worker:error', message: e.message || 'The voice worker stopped' }));
  }
  return worker;
}
export const onWorker = fn => (handlers.add(fn), () => handlers.delete(fn));

let ready = false, readyModel = null, loading = null, lastTry = 0;
/** True when it's worth trying to load (never tried, or the last failure was over a minute ago). */
export const shouldPrepare = () => !ready && !loading && (state.status === 'off' || (state.status === 'error' && Date.now() - lastTry > 60000));
/** Drop the loaded model (e.g. after switching) so the next use loads the chosen one. */
export function resetHearing() { ready = false; readyModel = null; loading = null; setState({ status: 'off', progress: 0, error: null }); }
/** Download (once) and load the speech model in the worker. Resolves when it's ready, or throws. */
export function prepareHearing() {
  if (loading) return loading;
  lockHearingModel();
  const m = hearingModel();
  if (ready && readyModel === m.id) return Promise.resolve(true);
  ready = false;
  lastTry = Date.now();
  setState({ status: 'loading', progress: 0, error: null });
  loading = (async () => {
    // Model files go to the browser's Cache Storage, not IndexedDB. Check there's room first (a no-op once cached).
    if (!hearingDownloaded()) {
      // Ask the browser to keep these files when space runs low, so they only ever download once.
      try { await navigator.storage?.persist?.(); } catch {}
      const room = await roomFor(m.mb);
      if (!room.ok) throw new Error(`Not enough browser storage for the private voice: it needs about ${room.needMb} MB free, and ${room.freeMb} MB is available.`);
    }
    const w = voiceWorker();
    await new Promise((resolve, reject) => {
      const off = onWorker(msg => {
        if (msg.type === 'asr:progress') setState({ progress: msg.progress });
        else if (msg.type === 'asr:ready') { off(); setState({ device: msg.device, vad: msg.vad }); if (msg.optKey) store.setPref('hearingOpt', { ...(store.pref('hearingOpt') || {}), [m.id]: msg.optKey }); resolve(); }
        else if (msg.type === 'asr:error' || msg.type === 'worker:error') { off(); reject(new Error(msg.message)); }
      });
      w.postMessage({ type: 'asr:load', model: m.id, language: lang(), englishOnly: !!m.englishOnly, prefer: (store.pref('hearingOpt') || {})[m.id] || null });
    });
    ready = true; readyModel = m.id;
    setState({ status: 'ready', progress: 1 });
    store.setPref('hearingReady', m.id);
    store.setPref('hearingHave', [...new Set([...(store.pref('hearingHave') || []), m.id])]);
    return true;
  })();
  loading.catch(err => setState({ status: 'error', error: err.message || String(err) })).finally(() => { loading = null; });
  return loading;
}
const lang = () => {
  const code = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return { en: 'english', fr: 'french', de: 'german', es: 'spanish', it: 'italian', pt: 'portuguese', nl: 'dutch', he: 'hebrew', ja: 'japanese', zh: 'chinese', ko: 'korean', ru: 'russian' }[code] || 'english';
};

// The microphone tap lives in js/mic-worklet.js.

/** Simple decimating resampler to 16 kHz (averages each window, which also low-passes a little). */
function toRate(chunk, from) {
  if (from === RATE) return chunk;
  const ratio = from / RATE, out = new Float32Array(Math.floor(chunk.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const a = Math.floor(i * ratio), b = Math.min(chunk.length, Math.floor((i + 1) * ratio));
    let s = 0; for (let j = a; j < b; j++) s += chunk[j];
    out[i] = s / Math.max(1, b - a);
  }
  return out;
}

/**
 * Listen for one utterance and transcribe it on this device.
 * The page only captures the microphone and shows the level; the worker decides when you're speaking
 * (Silero VAD) and transcribes just that stretch. Audio is sent to the worker without copying.
 * Callbacks: onLevel(0..1), onSpeech(), onStatus(text), onFinal(text), onEnd({ heard }) always last, onError(message).
 * Returns { stop() } to finish now (transcribe what was said) and { cancel() } to drop it.
 */
export function captureUtterance({ onLevel, onSpeech, onStatus, onFinal, onEnd, onError, idleMs = 8000, maxMs = 25000 } = {}) {
  let ctx = null, stream = null, node = null, closed = false, ended = false;
  const w = voiceWorker();
  const closeMic = () => {
    if (closed) return; closed = true;
    try { node?.port.close(); node?.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => {});
    onLevel?.(0);
  };
  const off = onWorker(msg => {
    if (ended) return;
    if (msg.type === 'speech') onSpeech?.();
    else if (msg.type === 'transcribing') { closeMic(); onStatus?.('Transcribing…'); }
    else if (msg.type === 'final') onFinal?.(msg.text);
    else if (msg.type === 'error') onError?.(msg.message);
    else if (msg.type === 'end' || msg.type === 'worker:error') {
      ended = true; off(); closeMic();
      if (msg.type === 'worker:error') onError?.(msg.message);
      onEnd?.({ heard: !!msg.heard });
    }
  });
  w.postMessage({ type: 'listen:start', idleMs, maxMs });

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
      const src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'sedi-tap');
      node.port.onmessage = e => {
        if (closed) return;
        for (const c of e.data) {
          const pcm = toRate(c, ctx.sampleRate);
          let s = 0; for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
          onLevel?.(Math.min(1, Math.sqrt(s / Math.max(1, pcm.length)) * 12));
          w.postMessage({ type: 'audio', data: pcm }, [pcm.buffer]); // handed over, not copied
        }
      };
      src.connect(node);
    } catch (err) {
      closeMic();
      w.postMessage({ type: 'listen:cancel' });
      onError?.(err?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings.' : `Couldn’t open the microphone: ${err.message || err}`);
    }
  })();

  return {
    stop() { closeMic(); w.postMessage({ type: 'listen:stop' }); },
    cancel() { closeMic(); w.postMessage({ type: 'listen:cancel' }); },
  };
}

/**
 * Unload: keep the microphone open and hand back each stretch of speech as it's written down, while you
 * keep talking. Callbacks: onLevel, onSpeech, onQueued(id, waiting), onChunk(id, text), onEmpty(id),
 * onWaiting(n), onEnd(), onError(msg). Returns { stop() (finish the last bit, then end), cancel() }.
 */
export function captureStream({ onLevel, onSpeech, onQueued, onChunk, onEmpty, onWaiting, onEnd, onError, endSilenceMs = 1100, maxMs = 30000 } = {}) {
  let ctx = null, stream = null, node = null, closed = false, ended = false;
  const w = voiceWorker();
  const closeMic = () => {
    if (closed) return; closed = true;
    try { node?.port.close(); node?.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => {});
    onLevel?.(0);
  };
  const off = onWorker(msg => {
    if (ended) return;
    if (msg.type === 'speech') onSpeech?.();
    else if (msg.type === 'seg:queued') onQueued?.(msg.id, msg.waiting);
    else if (msg.type === 'seg:final') onChunk?.(msg.id, msg.text);
    else if (msg.type === 'seg:empty') { onEmpty?.(msg.id); if (msg.message) onError?.(msg.message); }
    else if (msg.type === 'seg:waiting') onWaiting?.(msg.waiting);
    else if (msg.type === 'error') onError?.(msg.message);
    else if (msg.type === 'end' || msg.type === 'worker:error') {
      ended = true; off(); closeMic();
      if (msg.type === 'worker:error') onError?.(msg.message);
      onEnd?.();
    }
  });
  w.postMessage({ type: 'listen:start', continuous: true, endSilenceMs, maxMs, idleMs: 3600000 });
  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (closed) { stream.getTracks().forEach(t => t.stop()); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      await ctx.audioWorklet.addModule(new URL('./mic-worklet.js', import.meta.url));
      const src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'sedi-tap');
      node.port.onmessage = e => {
        if (closed) return;
        for (const c of e.data) {
          const pcm = toRate(c, ctx.sampleRate);
          let s = 0; for (let i = 0; i < pcm.length; i++) s += pcm[i] * pcm[i];
          onLevel?.(Math.min(1, Math.sqrt(s / Math.max(1, pcm.length)) * 12));
          w.postMessage({ type: 'audio', data: pcm }, [pcm.buffer]);
        }
      };
      src.connect(node);
    } catch (err) {
      closeMic();
      w.postMessage({ type: 'listen:cancel' });
      onError?.(err?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings.' : `Couldn’t open the microphone: ${err.message || err}`);
    }
  })();
  return {
    stop() { closeMic(); w.postMessage({ type: 'listen:stop' }); },
    cancel() { closeMic(); w.postMessage({ type: 'listen:cancel' }); },
  };
}
