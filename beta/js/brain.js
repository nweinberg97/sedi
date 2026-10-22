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
const CACHE_NAME = 'transformers-cache';

/** Is this model's download already saved on this device? Returns bytes saved (0 if not). */
export async function cachedBytes(key) {
  const model = MODELS[key];
  if (!model || !('caches' in window)) return 0;
  try {
    if (!(await caches.has(CACHE_NAME))) return 0;
    const cache = await caches.open(CACHE_NAME);
    const reqs = (await cache.keys()).filter(r => r.url.includes(model.id) && /\.onnx/.test(r.url));
    let total = 0;
    for (const r of reqs) total += +((await cache.match(r))?.headers.get('content-length') || 0);
    return reqs.length ? Math.max(total, 1) : 0;
  } catch { return 0; }
}

async function pickDtype() {
  if (!hasWebGPU()) return { device: 'wasm', dtypes: ['q4', 'q8'] };
  let f16 = false;
  try { f16 = !!(await navigator.gpu.requestAdapter())?.features.has('shader-f16'); } catch {}
  return { device: 'webgpu', dtypes: f16 ? ['q4f16', 'q4'] : ['q4'] };
}

async function loadModel(key) {
  if (generator) return generator;
  if (loading) return loading;
  const model = MODELS[key] || MODELS.light;
  const fromDevice = (await cachedBytes(key)) > 0;
  if (!fromDevice && !navigator.onLine) {
    setState({ status: 'error', error: 'The model isn’t downloaded on this device yet. Connect once to download it.' });
    throw new Error('offline');
  }
  setState({ status: 'loading', progress: 0, error: null, fromDevice });
  loading = (async () => {
    // Ask the browser to keep these files even when space runs low, so they download only once.
    try { await navigator.storage?.persist?.(); } catch {}
    const tf = await import(/* @vite-ignore */ TRANSFORMERS_URL);
    TextStreamer = tf.TextStreamer;
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;
    tf.env.cacheKey = CACHE_NAME;
    const files = {};
    const progress_callback = p => {
      if (p.status === 'progress' && p.file) {
        files[p.file] = { loaded: p.loaded || 0, total: p.total || 0 };
        const all = Object.values(files);
        const loaded = all.reduce((sum, f) => sum + f.loaded, 0), total = all.reduce((sum, f) => sum + f.total, 0);
        if (total) setState({ progress: Math.min(0.99, loaded / total) });
      }
    };
    const pref = store.pref('brain') || {};
    const plan = await pickDtype();
    // Reuse the precision that worked last time so we never fetch a second set of weights.
    const dtypes = pref.dtype && pref.model === key && plan.dtypes.includes(pref.dtype) ? [pref.dtype] : plan.dtypes;
    let lastErr;
    for (const dtype of dtypes) {
      try {
        generator = await tf.pipeline('text-generation', model.id, { device: plan.device, dtype, progress_callback });
        store.setPref('brain', { ...store.pref('brain'), dtype, downloaded: key });
        break;
      } catch (err) { lastErr = err; }
    }
    if (!generator) throw lastErr || new Error('Model failed to load');
    setState({ status: 'ready', progress: 1, device: plan.device, model: key });
    return generator;
  })();
  try { return await loading; }
  catch (err) {
    generator = null;
    setState({ status: 'error', error: err.message || String(err) });
    throw err;
  } finally { loading = null; }
}

export async function enable(key) {
  const prev = store.pref('brain') || {};
  if (prev.model && prev.model !== key) generator = null;
  store.setPref('brain', { ...prev, enabled: true, model: key, ...(prev.model !== key ? { dtype: null } : {}) });
  await loadModel(key);
  await loadLibrary();
}
export async function disable(removeFiles) {
  store.setPref('brain', { enabled: false, model: store.pref('brain')?.model });
  generator = null;
  if (removeFiles && 'caches' in window) await caches.delete(CACHE_NAME);
  setState({ status: 'off', progress: 0 });
}
export async function ensureLoaded() {
  const p = store.pref('brain');
  if (!p?.enabled) return null;
  return loadModel(p.model);
}
/** Start loading in the background (from this device) so answers are ready when you need them. */
export function warmUp() {
  if (!isEnabled() || generator || loading) return;
  ensureLoaded().catch(() => {});
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
  const sizes = {};
  const optBtns = {};
  const opts = h('div', { class: 'brain-opts' }, Object.entries(MODELS).map(([k, m]) => {
    const saved = h('small', { class: 'brain-saved' });
    optBtns[k] = { saved };
    return h('button', {
      class: `brain-opt ${k === choice ? 'on' : ''}`, type: 'button',
      onclick: e => { choice = k; opts.querySelectorAll('.brain-opt').forEach(b => b.classList.remove('on')); e.currentTarget.classList.add('on'); paintActions(); },
    }, h('strong', {}, m.label), h('span', {}, m.size), h('small', {}, m.note), saved);
  }));
  const bar = h('div', { class: 'progress' }, h('span'));
  const status = h('p', { class: 'muted small brain-status' });
  const primary = h('button', { class: 'btn primary' });
  const remove = h('button', { class: 'btn ghost' }, 'Remove download');
  const paintActions = () => {
    const on = isEnabled() && store.pref('brain')?.model === choice;
    const have = sizes[choice] > 0;
    primary.textContent = on && state.status === 'ready' ? 'Ready' : on ? 'Load now' : have ? 'Turn on' : 'Download and turn on';
    primary.disabled = (on && state.status === 'ready') || state.status === 'loading';
    remove.hidden = !Object.values(sizes).some(Boolean);
  };
  const paint = st => {
    bar.hidden = st.status !== 'loading';
    bar.firstChild.style.width = `${Math.round((st.progress || 0) * 100)}%`;
    status.textContent = st.status === 'loading'
      ? (st.fromDevice ? `Loading from this device… ${Math.round((st.progress || 0) * 100)}%` : `Downloading (one time only)… ${Math.round((st.progress || 0) * 100)}%`)
      : st.status === 'ready' ? `Ready on this device (${st.device === 'webgpu' ? 'GPU' : 'CPU'}). Works offline.`
        : st.status === 'error' ? `Couldn’t start: ${st.error}`
          : isEnabled() ? 'On. It loads from this device the first time you open the assistant.' : 'Off.';
    paintActions();
  };
  const refreshSizes = async () => {
    for (const k of Object.keys(MODELS)) {
      sizes[k] = await cachedBytes(k);
      optBtns[k].saved.textContent = sizes[k] ? `Saved on this device${sizes[k] > 1 ? ` · ${(sizes[k] / 1e9).toFixed(1)} GB` : ''}` : '';
    }
    paint(state);
  };
  refreshSizes();
  const unsub = onBrainChange(st => { paint(st); if (st.status === 'ready') refreshSizes(); });
  primary.addEventListener('click', async () => {
    if (!sizes[choice] && !navigator.onLine) { toast('Connect to the internet for the one-time download.'); return; }
    if (!sizes[choice] && navigator.storage?.estimate) {
      const { quota = 0, usage = 0 } = await navigator.storage.estimate();
      if (quota - usage < 1.6e9 && choice === 'full') toast('Storage is tight. The Light model may fit better.');
    }
    enable(choice).then(() => toast('Sovereign Brain is ready')).catch(() => {});
  });
  remove.addEventListener('click', async () => {
    await disable(true);
    toast('Removed the model from this device');
    refreshSizes();
  });
  modal({
    title: 'Sovereign Brain', wide: true, onClose: unsub,
    body: h('div', { class: 'editor' },
      h('p', {}, 'A private coach for focus, habits and getting unstuck. It runs entirely in this browser: nothing you type leaves your device.'),
      h('p', { class: 'muted small' }, `Downloads once and stays saved for offline use. ${hasWebGPU() ? 'Your browser supports WebGPU, so it runs on your graphics chip.' : 'WebGPU isn’t available here, so it runs on your CPU (slower). Chrome on a recent Mac works best.'} Voice and dictation don’t need it.`),
      opts, bar, status,
      h('div', { class: 'brain-actions-row' }, remove, h('span', { style: { flex: 1 } }), primary)),
  });
}

export { icon };
