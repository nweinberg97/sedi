// Sedi — the voice worker. Everything heavy about voice runs here, off the page's main thread, so the
// interface and the audio never stutter while a model is thinking:
//   1. Silero VAD decides, frame by frame, whether you're speaking (an energy detector fills in if it can't load).
//   2. Only the stretch of speech reaches the speech model (Whisper or Moonshine), never the silence around it.
// Audio arrives as 16 kHz samples and lives only in memory here. It's wiped as soon as it's transcribed.

import { loadTransformers } from './runtime.js';

const RATE = 16000;
const post = (msg, transfer) => self.postMessage(msg, transfer || []);

// ---------- Loading ----------
const progressReporter = kind => {
  const files = {};
  return p => {
    if (p.status !== 'progress' || !p.file) return;
    files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
    const all = Object.values(files), loaded = all.reduce((s, f) => s + f.loaded, 0), total = all.reduce((s, f) => s + f.total, 0);
    if (total) post({ type: `${kind}:progress`, progress: Math.min(0.99, loaded / total) });
  };
};
async function gpu() {
  try { const ad = await self.navigator.gpu?.requestAdapter(); return { webgpu: !!ad, f16: !!ad?.features?.has('shader-f16') }; }
  catch { return { webgpu: false, f16: false }; }
}

let asr = null, asrModel = null, asrOpts = {}, vad = null, tf = null;
async function loadAsr({ model, language, englishOnly, prefer }) {
  if (asr && asrModel === model) return post({ type: 'asr:ready', device: asr.device });
  asr = null;
  tf = await loadTransformers(model);
  const { webgpu, f16 } = await gpu();
  // GPU first (fast): half-precision encoder keeps accuracy; then the safest GPU mix; then the CPU with 8-bit weights.
  const tries = webgpu
    ? [...(f16 ? [{ device: 'webgpu', dtype: { encoder_model: 'fp16', decoder_model_merged: 'q4f16' } }] : []),
      { device: 'webgpu', dtype: { encoder_model: 'fp32', decoder_model_merged: 'q4' } },
      { device: 'wasm', dtype: 'q8' }]
    : [{ device: 'wasm', dtype: 'q8' }];
  // Start with whatever worked last time on this device, so a failed first try never fetches extra weights again.
  const key = o => `${o.device}:${JSON.stringify(o.dtype)}`;
  const known = prefer ? tries.find(o => key(o) === prefer) : null;
  const order = known ? [known, ...tries.filter(o => o !== known)] : tries;
  let lastErr, used = null, usedKey = null;
  for (const opt of order) {
    try { asr = await tf.pipeline('automatic-speech-recognition', model, { ...opt, progress_callback: progressReporter('asr') }); used = opt.device; usedKey = key(opt); break; }
    catch (err) { lastErr = err; }
  }
  if (!asr) throw lastErr || new Error('Speech model failed to load');
  asr.device = used;
  asr.optKey = usedKey;
  asrModel = model;
  // English-only models (Moonshine) take no language option; Whisper is told which language to expect.
  asrOpts = englishOnly ? {} : { language, task: 'transcribe' };
  try { await asr(new Float32Array(RATE / 2), asrOpts); } catch {}       // warm up, so the first sentence isn't slow
  // Silero VAD: tiny (about 2 MB) and far better than a loudness threshold at telling speech from noise.
  try {
    vad = await tf.AutoModel.from_pretrained('onnx-community/silero-vad', { config: { model_type: 'custom' }, dtype: 'fp32' });
    vadState = new tf.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
    vadSr = new tf.Tensor('int64', [RATE], []);
  } catch { vad = null; }
  post({ type: 'asr:ready', device: used, vad: !!vad, optKey: usedKey });
}

// ---------- Listening: voice activity detection + segmentation ----------
const PHANTOM = /^\s*(?:\[[^\]]*\]|\([^)]*\)|thank you\.?|thanks for watching!?|you\.?|bye\.?|\.+|okay\.?)\s*$/i;
let vadState = null, vadSr = null;
let L = null; // the utterance being listened to
function startListening(o) {
  L = {
    continuous: !!o.continuous, seq: 0,              // Unload: keep listening; each pause closes a chunk
    idleMs: o.idleMs || 8000, maxMs: o.maxMs || 25000,
    endMs: o.endSilenceMs || (vad ? 700 : 900),      // Silero is trusted to end a turn a little sooner
    frames: [], preroll: [], carry: new Float32Array(0), speaking: false, speechMs: 0, silentMs: 0, waitedMs: 0,
    floor: 0.004, loud: 0, busy: Promise.resolve(), done: false,
  };
  if (vadState) vadState = new tf.Tensor('float32', new Float32Array(2 * 128), [2, 1, 128]);
}
async function isSpeech(frame, rms) {
  if (vad) {
    try {
      const out = await vad({ input: new tf.Tensor('float32', frame, [1, frame.length]), sr: vadSr, state: vadState });
      vadState = out.stateN;
      const p = out.output.data[0];
      return L.speaking ? p > 0.2 : p > 0.5; // hysteresis: harder to start, easier to keep going
    } catch { vad = null; }
  }
  const startAt = Math.max(0.014, L.floor * 3.2), keepAt = Math.max(0.008, L.floor * 2);
  if (!L.speaking) L.floor = L.floor * 0.95 + Math.min(rms, 0.05) * 0.05;
  return rms > (L.speaking ? keepAt : startAt);
}
async function feed(chunk) {
  const S = L;
  if (!S || S.done) return;
  const FRAME = vad ? 512 : 480; // Silero expects 32 ms frames at 16 kHz
  let data = chunk;
  if (S.carry.length) { data = new Float32Array(S.carry.length + chunk.length); data.set(S.carry); data.set(chunk, S.carry.length); }
  let i = 0;
  for (; i + FRAME <= data.length; i += FRAME) {
    if (S.done) return;
    const f = data.slice(i, i + FRAME);
    let s = 0; for (let j = 0; j < f.length; j++) s += f[j] * f[j];
    const rms = Math.sqrt(s / f.length), ms = (FRAME / RATE) * 1000;
    const voiced = await isSpeech(f, rms);
    if (!S.speaking) {
      S.preroll.push(f); if (S.preroll.length > 10) S.preroll.shift();
      S.loud = voiced ? S.loud + 1 : 0;
      S.waitedMs += ms;
      if (S.loud >= (vad ? 2 : 3)) { S.speaking = true; S.frames.push(...S.preroll.splice(0)); S.speechMs = S.loud * ms; post({ type: 'speech' }); }
      else if (S.waitedMs > S.idleMs && !S.continuous) return finish(false);
    } else {
      S.frames.push(f);
      S.speechMs += ms;
      S.silentMs = voiced ? 0 : S.silentMs + ms;
      if (S.silentMs >= S.endMs || S.speechMs >= S.maxMs) { if (S.continuous) cut(S); else return finish(true); }
    }
  }
  S.carry = data.slice(i);
}
// ---------- Unload: chunks are written down in the background while you keep talking ----------
let writing = Promise.resolve(), queued = 0;
/** Close the current stretch of speech, queue it for writing down, and go back to listening. */
function cut(S) {
  const enough = S.speaking && S.speechMs >= 400;
  const keepFrames = Math.max(1, S.frames.length - Math.floor(Math.max(0, S.silentMs - 200) / (((S.frames[0]?.length || 512) / RATE) * 1000)));
  const parts = enough ? S.frames.slice(0, keepFrames) : [];
  S.frames = []; S.speaking = false; S.speechMs = 0; S.silentMs = 0; S.loud = 0; S.waitedMs = 0;
  if (!parts.length) return;
  let audio = new Float32Array(parts.reduce((n, f) => n + f.length, 0));
  let o = 0; for (const f of parts) { audio.set(f, o); o += f.length; }
  const id = ++S.seq, speechMs = audio.length / RATE * 1000;
  queued++;
  post({ type: 'seg:queued', id, waiting: queued });
  writing = writing.then(async () => {
    try {
      if (!asr) throw new Error('The speech model isn’t loaded');
      const r = await asr(audio, asrOpts);
      const text = String(r?.text || '').replace(/\s+/g, ' ').trim();
      if (text && !(PHANTOM.test(text) && speechMs < 1500)) post({ type: 'seg:final', id, text });
      else post({ type: 'seg:empty', id });
    } catch (err) { post({ type: 'seg:empty', id, message: `On-device transcription failed: ${err.message || err}` }); }
    finally { audio.fill(0); audio = null; queued--; post({ type: 'seg:waiting', waiting: queued }); }
  });
}
function stopContinuous(S) {
  if (!S || S.done) return;
  cut(S);
  S.done = true; if (L === S) L = null;
  writing.then(() => post({ type: 'end', heard: S.seq > 0 }));
}

async function finish(keep) {
  const S = L;
  if (!S || S.done) return;
  S.done = true; L = null;
  S.preroll.length = 0; S.carry = null;
  if (!keep || !S.speaking || S.speechMs < 250) { S.frames.length = 0; return post({ type: 'end', heard: false }); }
  // Trim the trailing silence, then join the speech into one clip. The clip is wiped right after.
  const keepFrames = Math.max(1, S.frames.length - Math.floor(Math.max(0, S.silentMs - 200) / ((S.frames[0].length / RATE) * 1000)));
  const parts = S.frames.slice(0, keepFrames);
  let audio = new Float32Array(parts.reduce((n, f) => n + f.length, 0));
  let o = 0; for (const f of parts) { audio.set(f, o); o += f.length; }
  S.frames.length = 0;
  post({ type: 'transcribing' });
  try {
    if (!asr) throw new Error('The speech model isn’t loaded');
    const r = await asr(audio, asrOpts);
    const text = String(r?.text || '').replace(/\s+/g, ' ').trim();
    audio.fill(0); audio = null;
    if (text && !(PHANTOM.test(text) && S.speechMs < 1500)) post({ type: 'final', text });
    post({ type: 'end', heard: !!text });
  } catch (err) { post({ type: 'error', message: `On-device transcription failed: ${err.message || err}` }); post({ type: 'end', heard: false }); }
}

// ---------- Messages ----------
self.onmessage = async e => {
  const m = e.data || {};
  try {
    switch (m.type) {
      case 'asr:load': await loadAsr(m); break;
      case 'listen:start': startListening(m); break;
      case 'audio': if (L) L.busy = L.busy.then(() => feed(m.data)); break;
      case 'listen:stop': if (L) { const S = L; S.busy.then(() => { if (L === S) (S.continuous ? stopContinuous(S) : finish(true)); }); } break;
      case 'listen:cancel': if (L) { L.frames.length = 0; if (L.continuous) { L.done = true; L = null; post({ type: 'end', heard: false }); } else finish(false); } break;
      default: break;
    }
  } catch (err) {
    const kind = (m.type || '').split(':')[0];
    post({ type: `${kind}:error`, message: err.message || String(err) });
  }
};
