// Sedi — where the on-device AI software and model files come from.
// Sedi prefers its own copies, served from this site (the vendor/ and models/ folders), so nothing is
// fetched from a third party. Until those copies are added, it falls back to the pinned public sources:
// the runtime from jsDelivr and the open model files from Hugging Face. Either way everything runs on
// this device and is cached after the first download.

const PUBLIC_TRANSFORMERS = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';
const OWN_TRANSFORMERS = new URL('../vendor/transformers/transformers.web.min.js', import.meta.url).href;
const OWN_MODELS = new URL('../models/', import.meta.url).href;

const exists = url => fetch(url, { method: 'HEAD', cache: 'no-store' }).then(r => r.ok, () => false);
let manifest = null;
/** vendor/manifest.json lists which copies Sedi has of its own: { runtime: true, models: ["onnx-community/whisper-base", …] } */
async function own() {
  if (manifest) return manifest;
  try { const r = await fetch(new URL('../vendor/manifest.json', import.meta.url), { cache: 'no-store' }); manifest = r.ok ? await r.json() : {}; }
  catch { manifest = {}; }
  return manifest;
}

/** Load Transformers.js, preferring Sedi's own copy, and point model downloads at Sedi's own copies when present. */
export async function loadTransformers(modelId) {
  const m = await own();
  const tf = await import(/* @vite-ignore */ m.runtime && await exists(OWN_TRANSFORMERS) ? OWN_TRANSFORMERS : PUBLIC_TRANSFORMERS);
  tf.env.useBrowserCache = true;
  const local = !!modelId && Array.isArray(m.models) && m.models.includes(modelId);
  tf.env.allowLocalModels = local;
  tf.env.allowRemoteModels = !local;
  if (local) tf.env.localModelPath = OWN_MODELS;
  if (m.runtime && m.wasm) tf.env.backends.onnx.wasm.wasmPaths = new URL('../vendor/transformers/', import.meta.url).href;
  return tf;
}
/** Where a model's files come from, in words, for settings. */
export async function modelSource(modelId) {
  const m = await own();
  return Array.isArray(m.models) && m.models.includes(modelId) ? 'Sedi' : 'Hugging Face';
}

/**
 * Is there room on this device for a download of about `mb` megabytes? Model files live in the browser's
 * Cache Storage (not in IndexedDB, where your cards are), but both count toward the same per-site allowance.
 * Leaves a safety margin so your own data always has space.
 */
export async function roomFor(mb) {
  try {
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    if (!quota) return { ok: true };
    const free = (quota - usage) / 1048576, need = Math.round(mb + 150); // the download plus room to spare for your own data
    return { ok: free > need, freeMb: Math.round(free), needMb: need };
  } catch { return { ok: true }; }
}

/** Remove downloaded files for models matching `pattern` (e.g. /whisper/i), leaving everything else. */
export async function removeModelFiles(pattern) {
  if (!('caches' in window)) return 0;
  let n = 0;
  for (const name of ['transformers-cache']) {
    const cache = await caches.open(name);
    for (const req of await cache.keys()) if (pattern.test(req.url)) { await cache.delete(req); n++; }
  }
  return n;
}
