// Sedi — private hearing: speech-to-text that runs on this device.
// The microphone is read through Web Audio. A small voice-activity detector decides when you
// start and stop talking, and the finished utterance is transcribed by Whisper running in the
// browser (Transformers.js, the same open runtime the on-device brain uses). Nothing leaves the device.
// The model downloads once (about 75 MB) and is served from the browser cache after that.

import * as store from './store.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const MODEL = 'onnx-community/whisper-base';
const RATE = 16000;

let state = { status: 'off', progress: 0, error: null };
const listeners = new Set();
export const onHearingChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
export const hearingState = () => state;
export const canCapture = !!(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext));
/** 'auto' (on-device when ready, browser until then), 'device' (on-device only) or 'browser'. */
export const hearingPref = () => store.pref('hearing', 'auto');

let asr = null, loading = null, lastTry = 0;
/** True when it's worth trying to load (never tried, or the last failure was over a minute ago). */
export const shouldPrepare = () => !asr && !loading && (state.status === 'off' || (state.status === 'error' && Date.now() - lastTry > 60000));
/** Download (once) and load Whisper. Resolves to the pipeline, or throws. */
export function prepareHearing() {
  if (asr) return Promise.resolve(asr);
  if (loading) return loading;
  lastTry = Date.now();
  setState({ status: 'loading', progress: 0, error: null });
  loading = (async () => {
    const tf = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;
    const files = {};
    const progress_callback = p => {
      if (p.status !== 'progress' || !p.file) return;
      files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
      const all = Object.values(files);
      const loaded = all.reduce((s, f) => s + f.loaded, 0), total = all.reduce((s, f) => s + f.total, 0);
      if (total) setState({ progress: Math.min(0.99, loaded / total) });
    };
    const webgpu = !!navigator.gpu;
    // WebGPU: full-precision encoder (accuracy) with a 4-bit decoder (speed). WASM: 8-bit throughout.
    const tries = webgpu
      ? [{ device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } }, { device: 'wasm', dtype: 'q8' }]
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
    store.setPref('hearingReady', true);
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
    if (cancelled || !speaking || speechMs < 250) { onEnd?.({ heard: false }); return; }
    const audio = new Float32Array(frames.reduce((n, f) => n + f.length, 0));
    let o = 0; for (const f of frames) { audio.set(f, o); o += f.length; }
    onStatus?.('Transcribing…');
    try {
      const pipe = await prepareHearing();
      const r = await pipe(audio, { language: lang(), task: 'transcribe' });
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
