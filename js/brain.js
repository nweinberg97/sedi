// Sedi — Sovereign Brain: an opt-in, on-device coach.
// Retrieval runs over a pre-baked library (brain/master_library.json) with BM25 in plain JS.
// Generation runs a small quantized language model in the browser via Transformers.js
// (WebGPU when available, WebAssembly otherwise). After the one-time download, the model,
// the library and the runtime are all served from local caches, so it works in airplane mode.

import * as store from './store.js';
import { h, icon, modal, toast } from './util.js';

const TRANSFORMERS_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
export const MODELS = {
  light: { id: 'onnx-community/Qwen2.5-0.5B-Instruct', label: 'Light', size: 'about 500 MB', note: 'Fast on most laptops.' },
  full: { id: 'HuggingFaceTB/SmolLM2-1.7B-Instruct', label: 'Full', size: 'about 1.2 GB', note: 'Smarter. Best with a recent GPU.' },
};

const SYSTEM = `You are the integrated executive function and behavioral coach inside Sedi. Your primary knowledge base is the context snippets below, which describe frameworks on habit architecture, social mechanics, occupational therapy, and cognitive structuring.

Operational rules:
1. Ground every strategy or step strictly in the provided snippets.
2. Be direct, action-focused, and precise. No filler, pleasantries, or lecturing.
3. If the user presents a bottleneck (e.g. procrastination), select exactly ONE exercise or framework from the context, break it into micro-steps, and tell the user how to do step one right now.
4. Keep responses scannable: short bold labels and bullet points. Under 150 words.`;

let state = { status: 'off', progress: 0, error: null };
let generator = null, TextStreamer = null, loading = null;
const listeners = new Set();
export const onBrainChange = fn => (listeners.add(fn), () => listeners.delete(fn));
const setState = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn(state)); };
export const brainState = () => state;
export const isEnabled = () => !!store.pref('brain')?.enabled;
export const hasWebGPU = () => !!navigator.gpu;

// ---------- Retrieval (BM25) ----------
const STOP = new Set('the a an and or but if then of to in on for with at by from is are was were be been am i me my you your it its this that these those as so do does did not no can will just about into over than too very what how why when who which'.split(' '));
const tokenize = s => (s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 2 && !STOP.has(w)).map(w => w.replace(/(ing|ed|es|s)$/, ''));
let library = null;
async function loadLibrary() {
  if (library) return library;
  const res = await fetch('./brain/master_library.json');
  const data = await res.json();
  const docs = data.chunks.map(c => ({ ...c, toks: tokenize(`${c.title} ${c.title} ${c.tags?.join(' ') || ''} ${c.text}`) }));
  const df = {};
  docs.forEach(d => new Set(d.toks).forEach(t => (df[t] = (df[t] || 0) + 1)));
  const avg = docs.reduce((s, d) => s + d.toks.length, 0) / docs.length;
  library = { docs, df, avg, N: docs.length };
  return library;
}
export async function retrieve(query, k = 3) {
  const lib = await loadLibrary();
  const q = tokenize(query);
  const k1 = 1.4, b = 0.75;
  const scored = lib.docs.map(d => {
    const tf = {};
    d.toks.forEach(t => (tf[t] = (tf[t] || 0) + 1));
    let s = 0;
    for (const t of q) {
      if (!tf[t]) continue;
      const idf = Math.log(1 + (lib.N - lib.df[t] + 0.5) / (lib.df[t] + 0.5));
      s += idf * (tf[t] * (k1 + 1)) / (tf[t] + k1 * (1 - b + b * d.toks.length / lib.avg));
    }
    return { d, s };
  }).sort((a, b) => b.s - a.s);
  const top = scored.filter(x => x.s > 0).slice(0, k).map(x => x.d);
  return top.length ? top : scored.slice(0, 1).map(x => x.d); // always give the coach something to stand on
}

// ---------- Model ----------
async function loadModel(key, { fromCacheOnly = false } = {}) {
  if (generator) return generator;
  if (loading) return loading;
  const model = MODELS[key] || MODELS.light;
  setState({ status: 'loading', progress: 0, error: null });
  loading = (async () => {
    const tf = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    TextStreamer = tf.TextStreamer;
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;
    const files = {};
    const progress_callback = p => {
      if (p.status === 'progress' && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        const all = Object.values(files);
        const loaded = all.reduce((s, f) => s + f.loaded, 0), total = all.reduce((s, f) => s + f.total, 0);
        if (total) setState({ progress: Math.min(0.99, loaded / total) });
      }
    };
    const device = hasWebGPU() ? 'webgpu' : 'wasm';
    const tries = device === 'webgpu' ? ['q4f16', 'q4'] : ['q4', 'q8'];
    let lastErr;
    for (const dtype of tries) {
      try {
        generator = await tf.pipeline('text-generation', model.id, { device, dtype, progress_callback });
        break;
      } catch (err) { lastErr = err; }
    }
    if (!generator) throw lastErr || new Error('Model failed to load');
    setState({ status: 'ready', progress: 1, device, model: key });
    return generator;
  })();
  try { return await loading; }
  catch (err) {
    generator = null;
    setState({ status: 'error', error: navigator.onLine ? (err.message || String(err)) : 'The model isn’t downloaded on this device yet. Connect once to download it.' });
    throw err;
  } finally { loading = null; }
}

export async function enable(key) {
  store.setPref('brain', { enabled: true, model: key });
  await loadModel(key);
  await loadLibrary();
}
export async function disable(removeFiles) {
  store.setPref('brain', { enabled: false, model: store.pref('brain')?.model });
  generator = null;
  if (removeFiles && 'caches' in window) await caches.delete('transformers-cache');
  setState({ status: 'off', progress: 0 });
}
export async function ensureLoaded() {
  const p = store.pref('brain');
  if (!p?.enabled) return null;
  return loadModel(p.model, { fromCacheOnly: true });
}

/** Ask the coach. `sediContext` is a short list of the user's own relevant cards. */
export async function ask(question, sediContext = [], onToken) {
  const gen = await ensureLoaded();
  if (!gen) throw new Error('Sovereign Brain is off');
  const chunks = await retrieve(`${question} ${sediContext.map(c => c.title).join(' ')}`, 3);
  const ctx = chunks.map((c, i) => `[${i + 1}] ${c.title}: ${c.text}`).join('\n\n');
  const mine = sediContext.length ? `\n\nRelevant items from the user's Sedi:\n${sediContext.map(c => `- ${c.title}${c.where ? ` (${c.where})` : ''}`).join('\n')}` : '';
  const messages = [
    { role: 'system', content: `${SYSTEM}\n\nContext snippets:\n${ctx}${mine}` },
    { role: 'user', content: question },
  ];
  let text = '';
  const streamer = TextStreamer ? new TextStreamer(gen.tokenizer, {
    skip_prompt: true, skip_special_tokens: true,
    callback_function: t => { text += t; onToken?.(text); },
  }) : undefined;
  const out = await gen(messages, { max_new_tokens: 320, do_sample: false, repetition_penalty: 1.1, streamer });
  const final = out?.[0]?.generated_text;
  const answer = Array.isArray(final) ? final.at(-1)?.content : text;
  return { text: (answer || text).trim(), sources: chunks.map(c => c.title) };
}

// ---------- Settings panel ----------
export function openBrainPanel() {
  const p = store.pref('brain') || {};
  let choice = p.model || (hasWebGPU() ? 'full' : 'light');
  const opts = h('div', { class: 'brain-opts' }, Object.entries(MODELS).map(([k, m]) => h('button', {
    class: `brain-opt ${k === choice ? 'on' : ''}`, type: 'button',
    onclick: e => { choice = k; opts.querySelectorAll('.brain-opt').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); },
  }, h('strong', {}, m.label), h('span', {}, m.size), h('small', {}, m.note))));
  const bar = h('div', { class: 'progress' }, h('span'));
  const status = h('p', { class: 'muted small brain-status' });
  const paint = s => {
    bar.hidden = s.status !== 'loading';
    bar.firstChild.style.width = `${Math.round((s.progress || 0) * 100)}%`;
    status.textContent = s.status === 'loading' ? `Downloading and preparing… ${Math.round((s.progress || 0) * 100)}%`
      : s.status === 'ready' ? `Ready on this device (${s.device === 'webgpu' ? 'GPU' : 'CPU'}). Works offline.`
        : s.status === 'error' ? `Couldn’t start: ${s.error}`
          : isEnabled() ? 'Enabled. Loads the first time you ask a question.' : 'Off.';
  };
  paint(state);
  const unsub = onBrainChange(paint);
  modal({
    title: 'Sovereign Brain', wide: true, onClose: unsub,
    body: h('div', { class: 'editor' },
      h('p', {}, 'A private coach for focus, habits and getting unstuck. It runs entirely in this browser: nothing you type leaves your device.'),
      h('p', { class: 'muted small' }, `One-time download, cached for offline use. ${hasWebGPU() ? 'Your browser supports WebGPU, so it will run on your graphics chip.' : 'WebGPU isn’t available here, so it will run on your CPU (slower). Chrome on a recent Mac works best.'}`),
      opts, bar, status,
      h('p', { class: 'muted small' }, 'Use it from the assistant (the atom at the bottom) or press ⌘K / Ctrl K.')),
    actions: [
      ...(isEnabled() ? [{ label: 'Turn off and remove download', kind: 'ghost', onClick: async () => { await disable(true); toast('Sovereign Brain removed from this device'); } }] : []),
      { label: 'Close', kind: 'ghost' },
      {
        label: isEnabled() ? 'Reload model' : 'Download and enable', kind: 'primary', onClick: async () => {
          if (!navigator.onLine) { toast('Connect to the internet for the one-time download.'); return true; }
          if (navigator.storage?.estimate) {
            const { quota = 0, usage = 0 } = await navigator.storage.estimate();
            if (quota - usage < 1.6e9 && choice === 'full') toast('Storage is tight. The Light model may fit better.');
          }
          generator = null;
          enable(choice).then(() => toast('Sovereign Brain is ready')).catch(() => {});
          return true;
        },
      },
    ],
  });
}

export { icon };
