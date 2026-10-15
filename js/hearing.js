// Sedi — private hearing: speech-to-text that runs on this device.
// The microphone is read through Web Audio. A small voice-activity detector decides when you
// start and stop talking, and the finished utterance is transcribed by Whisper running in the
// browser (Transformers.js, the same open runtime the on-device brain uses). Nothing leaves the device.
// The model downloads once (about 80–150 MB, depending on your device) and is served from the browser cache after that.
// Where the files come from (Sedi's own copies, or the pinned public sources) is decided in runtime.js.

import * as store from './store.js';
import { loadTransformers, roomFor } from './runtime.js';

// Two sizes. "Accurate" (Whisper Small) makes noticeably fewer mistakes and is the default on computers;
// "Light" (Whisper Base) is the default on phones, where memory and downloads are tighter.
export const HEARING_MODELS = {
  accurate: { id: 'onnx-community/whisper-small', label: 'Accurate', size: 'about 250–300 MB', mb: 300 },
  light: { id: 'onnx-community/whisper-base', label: 'Light', size: 'about 80–150 MB', mb: 160 },
};
export const hearingModelKey = () => store.pref('hearingModel') || (isSmallDevice() ? 'light' : 'accurate');
export const hearingModel = () => HEARING_MODELS[hearingModelKey()] || HEARING_MODELS.accurate;
/** True once the chosen model has been downloaded on this device. */
export const hearingDownloaded = () => store.pref('hearingReady') === hearingModel().id;
const RATE = 16000;

let state = { status: 'off', progress: 0, error: null };
const listeners = new Set();
export const onHearingChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
export const hearingState = () => state;
export const canCapture = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
/** 'device' (private: on-device only; the default), 'auto' (on-device when ready, browser until then) or 'browser'. */
export const hearingPref = () => store.pref('hearing', 'device');

let asr = null, loading = null, lastTry = 0;
/** True when it's worth trying to load (never tried, or the last failure was over a minute ago). */
export const shouldPrepare = () => !asr && !loading && (state.status === 'off' || (state.status === 'error' && Date.now() - lastTry > 60000));
/** Download (once) and load Whisper. Resolves to the pipeline, or throws. */
let asrModel = null;
export const isSmallDevice = () => matchMedia('(max-width: 700px)').matches || (navigator.deviceMemory && navigator.deviceMemory < 6);
/** Drop the loaded model (e.g. after switching size) so the next use loads the chosen one. */
export function resetHearing() { asr = null; asrModel = null; loading = null; setState({ status: 'off', progress: 0, error: null }); }
export function prepareHearing() {
  if (loading) return loading;
  if (asr && asrModel === hearingModel().id) return Promise.resolve(asr);
  if (asr) resetHearing();
  lastTry = Date.now();
  setState({ status: 'loading', progress: 0, error: null });
  loading = (async () => {
    // Model files go to the browser's Cache Storage, not IndexedDB. Check there's room first (a no-op once cached).
    const MODEL = hearingModel().id;
    if (!hearingDownloaded()) {
      const room = await roomFor(hearingModel().mb);
      if (!room.ok) throw new Error(`Not enough browser storage for the private voice (about ${hearingModel().mb} MB needed, ${room.freeMb} MB free).`);
    }
    const tf = await loadTransformers(MODEL);
    const files = {};
    const progress_callback = p => {
      if (p.status !== 'progress' || !p.file) return;
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      const all = Object.values(files);
      const loaded = all.reduce((s, f) => s + f.loaded, 0), total = all.reduce((s, f) => s + f.total, 0);
      if (total) setState({ progress: Math.min(0.99, loaded / total) });
    };
    // Only try the GPU recipes the GPU can run, so nothing is downloaded that can't be used.
    let webgpu = false, f16 = false;
    try { const ad = await navigator.gpu?.requestAdapter(); webgpu = !!ad; f16 = !!ad?.features?.has('shader-f16'); } catch {}
    // WebGPU (fast): half-precision encoder, which keeps accuracy, with a compact decoder; then the safest GPU
    // mix; then the CPU (WASM) with 8-bit weights, which works everywhere.
    const tries = webgpu
      ? [...(f16 ? [{ device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } }] : []),
        { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
        { device: 'wasm', dtype: 'q8' }]
      : [{ device: 'wasm', dtype: 'q8' }];
    let lastErr;
    for (const opt of tries) {
      try { asr = await tf.pipeline('automatic-speech-recognition', MODEL, { ...opt, progress_callback }); setState({ device: opt.device }); break; }
      catch (err) { lastErr = err; }
    }
    if (!asr) throw lastErr || new Error('Speech model failed to load');
    // Warm up once so the first real sentence isn't slow.
    try { await asr(new Float32Array(RATE / 2), { language: lang(), task: 'transcribe' }); } catch {}
    setState({ status: 'ready', progress: 1 });
    asrModel = MODEL;
    store.setPref('hearingReady', MODEL);
    return asr;
  })();
  loading.catch(err => { loading = null; setState({ status: 'error', error: err.message || String(err) }); });
  return loading;
}
const lang = () => {
  const code = (navigator.language || 'en').slice(0, 2).toLowerCase();
  return { en: 'english', fr: 'french', de: 'german', es: 'spanish', it: 'italian', pt: 'portuguese', nl: 'dutch', he: 'hebrew', ja: 'japanese', zh: 'chinese', ko: 'korean', ru: 'russian' }[code] || 'english';
};

// Whisper sometimes "hears" stock phrases in near-silence. Drop them when the speech was short.
const PHANTOM = /^\s*(?:\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+|okay\.?)\s*$/i;

const WORKLET = `
class Tap extends AudioWorkletProcessor {
  constructor() { super(); this.buf = []; this.n = 0; }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) { this.buf.push(ch.slice(0)); this.n += ch.length; if (this.n >= 1024) { this.port.postMessage(this.buf); this.buf = []; this.n = 0; } }
    return true;
  }
}
registerProcessor('sedi-tap', Tap);`;

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
 * Callbacks: onLevel(0..1) for the visual, onSpeech() when talking starts, onStatus(text),
 * onFinal(text) with the transcript, onEnd({ heard }) always last, onError(message).
 * Returns { stop() } to finish now (transcribe what was said) and { cancel() } to drop it.
 */
export function captureUtterance({ onLevel, onSpeech, onStatus, onFinal, onEnd, onError, idleMs = 8000, endSilenceMs = 900, maxMs = 25000 } = {}) {
  let ctx = null, stream = null, node = null, done = false, cancelled = false;
  const frames = [];                 // 16 kHz samples of the utterance
  const preroll = [];                // the moment just before speech, so first syllables aren't clipped
  let speaking = false, speechMs = 0, silentMs = 0, waitedMs = 0, floor = 0.004, loud = 0, carry = new Float32Array(0);
  const FRAME = 480;                 // 30 ms at 16 kHz

  const finish = async () => {
    if (done) return; done = true;
    try { node?.port.close(); node?.disconnect(); } catch {}
    stream?.getTracks().forEach(t => t.stop());
    ctx?.close().catch(() => {});
    onLevel?.(0);
    preroll.length = 0; carry = new Float32Array(0);
    if (cancelled || !speaking || speechMs < 250) { frames.length = 0; onEnd?.({ heard: false }); return; }
    // The recording only ever exists in memory. It's transcribed here, then wiped: only the words are kept.
    let audio = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let o = 0; for (const f of frames) { audio.set(f, o); o += f.length; }
    frames.length = 0;
    onStatus?.('Transcribing…');
    try {
      const pipe = await prepareHearing();
      const r = await pipe(audio, { language: lang(), task: 'transcribe' });
      audio.fill(0); audio = null;
      const text = String(r?.text || '').replace(/\s+/g, ' ').trim();
      if (text && !(PHANTOM.test(text) && speechMs < 1500)) onFinal?.(text);
      onEnd?.({ heard: !!text });
    } catch (err) { onError?.(`On-device transcription failed: ${err.message || err}`); onEnd?.({ heard: false }); }
  };

  const feed = chunk => {
    if (done) return;
    let data = chunk;
    if (carry.length) { data = new Float32Array(carry.length + chunk.length); data.set(carry); data.set(chunk, carry.length); }
    let i = 0;
    for (; i + FRAME <= data.length; i += FRAME) {
      const f = data.subarray(i, i + FRAME);
      let s = 0; for (let j = 0; j < f.length; j++) s += f[j] * f[j];
      const rms = Math.sqrt(s / f.length);
      onLevel?.(Math.min(1, rms * 12));
      const startAt = Math.max(0.014, floor * 3.2), keepAt = Math.max(0.008, floor * 2);
      if (!speaking) {
        floor = floor * 0.95 + Math.min(rms, 0.05) * 0.05;
        preroll.push(f.slice(0)); if (preroll.length > 10) preroll.shift();
        loud = rms > startAt ? loud + 1 : 0;
        waitedMs += 30;
        if (loud >= 3) { speaking = true; frames.push(...preroll.splice(0)); speechMs = 90; onSpeech?.(); }
        else if (waitedMs > idleMs) { cancelled = true; finish(); return; }
      } else {
        frames.push(f.slice(0));
        speechMs += 30;
        silentMs = rms < keepAt ? silentMs + 30 : 0;
        if (silentMs >= endSilenceMs || speechMs >= maxMs) { finish(); return; }
      }
    }
    carry = data.slice(i);
  };

  (async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (done) { stream.getTracks().forEach(t => t.stop()); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      ctx = new AC();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      URL.revokeObjectURL(url);
      const src = ctx.createMediaStreamSource(stream);
      node = new AudioWorkletNode(ctx, 'sedi-tap');
      node.port.onmessage = e => { for (const c of e.data) feed(toRate(c, ctx.sampleRate)); };
      src.connect(node);
    } catch (err) {
      done = true;
      onError?.(err?.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser’s site settings.' : `Couldn’t open the microphone: ${err.message || err}`);
      onEnd?.({ heard: false });
    }
  })();

  return { stop() { finish(); }, cancel() { cancelled = true; finish(); } };
}
