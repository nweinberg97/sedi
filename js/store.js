// Sedi — local-first state engine.
// Cards + structural records live in IndexedDB; small UI preferences live in localStorage.
// Every mutation writes through immediately, then notifies subscribers on the next frame.

import { uuid, now } from './util.js';

const DB_NAME = 'sedi';
const DB_VERSION = 2; // v2 (additive): adds the 'files' store for PDFs. Nothing renamed or removed.
const PREFS_KEY = 'sedi.prefs';
export const SCHEMA_VERSION = 1;

let db = null;
const cards = new Map();
const kv = {};
const memFiles = new Map(); // Fallback when IndexedDB is unavailable (kept for this session only)
const listeners = new Set();
let pending = false;
let lastChange = { reason: 'init' };

// ---------- IndexedDB plumbing ----------
function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no-idb'));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('cards')) d.createObjectStore('cards', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('files')) d.createObjectStore('files'); // Blobs (PDFs), keyed by file id
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function tx(store, mode, fn) {
  if (!db) { fallbackSave(); return Promise.resolve(); }
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    const out = fn(s);
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
  });
}
function getAll(store) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, 'readonly');
    const s = t.objectStore(store);
    if (store === 'kv') {
      const out = {};
      const req = s.openCursor();
      req.onsuccess = () => { const c = req.result; if (c) { out[c.key] = c.value; c.continue(); } else resolve(out); };
      req.onerror = () => reject(req.error);
    } else {
      const req = s.getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }
  });
}
// If IndexedDB is unavailable (rare private modes), keep everything in localStorage instead.
function fallbackSave() {
  try { localStorage.setItem('sedi.fallback', JSON.stringify({ cards: [...cards.values()], kv })); } catch {}
}

export async function init() {
  try {
    db = await openDB();
    const [allCards, allKv] = await Promise.all([getAll('cards'), getAll('kv')]);
    allCards.forEach(c => cards.set(c.id, c));
    Object.assign(kv, allKv);
  } catch {
    db = null;
    try {
      const raw = JSON.parse(localStorage.getItem('sedi.fallback') || 'null');
      raw?.cards?.forEach(c => cards.set(c.id, c));
      Object.assign(kv, raw?.kv || {});
    } catch {}
  }
  // Ask the browser not to evict our data under storage pressure.
  navigator.storage?.persist?.().catch(() => {});
}
export const isEmpty = () => cards.size === 0 && Object.keys(kv).length === 0;

// ---------- Subscriptions ----------
export function on(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(reason) {
  lastChange = reason;
  if (pending) return;
  pending = true;
  requestAnimationFrame(() => { pending = false; listeners.forEach(fn => fn(lastChange)); });
}
export const notify = (reason = { reason: 'manual' }) => emit(reason);

// ---------- Cards ----------
export const getCard = id => cards.get(id);
export const allCards = () => [...cards.values()];
export const cardsWhere = fn => allCards().filter(fn);

export function createCard(partial, { silent = false, log = true } = {}) {
  const t = now();
  const card = {
    id: uuid(),
    type: 'task',
    title: 'Untitled',
    description: '',
    tool: 'taskly',
    createdAt: t,
    updatedAt: t,
    ...partial,
    meta: { ...(partial.meta || {}) },
  };
  cards.set(card.id, card);
  tx('cards', 'readwrite', s => s.put(card));
  if (log) logActivity('Created', card);
  if (!silent) emit({ reason: 'create', id: card.id });
  return card;
}

export function updateCard(id, patch, { silent = false, replaceMeta = false, log = false, logLabel, touch = true } = {}) {
  const card = cards.get(id);
  if (!card) return null;
  const meta = patch.meta ? (replaceMeta ? { ...patch.meta } : { ...card.meta, ...patch.meta }) : card.meta;
  // touch:false is for background bookkeeping (cached summaries) that shouldn't count as an edit.
  const next = { ...card, ...patch, meta, updatedAt: touch ? now() : card.updatedAt };
  cards.set(id, next);
  tx('cards', 'readwrite', s => s.put(next));
  if (log) logActivity(logLabel || 'Edited', next);
  if (!silent) emit({ reason: 'update', id });
  return next;
}

export function deleteCard(id, { silent = false } = {}) {
  const card = cards.get(id);
  if (!card) return null;
  cards.delete(id);
  tx('cards', 'readwrite', s => s.delete(id));
  logActivity('Deleted', card);
  if (!silent) emit({ reason: 'delete', id });
  return card;
}

export function restoreCard(card) {
  const restored = { ...card, updatedAt: now() };
  cards.set(card.id, restored);
  tx('cards', 'readwrite', s => s.put(restored));
  logActivity('Restored', restored);
  emit({ reason: 'restore', id: card.id });
  return restored;
}

// ---------- Structural key/value records ----------
export const get = (key, fallback) => (key in kv ? kv[key] : fallback);
export function set(key, value, { silent = false } = {}) {
  kv[key] = value;
  tx('kv', 'readwrite', s => s.put(value, key));
  if (!silent) emit({ reason: 'kv', key });
}

// ---------- Activity + command logs ----------
export function logActivity(action, card) {
  const list = kv.activity || [];
  list.unshift({ at: now(), action, id: card.id, title: card.title, tool: card.tool, type: card.type });
  if (list.length > 200) list.length = 200;
  kv.activity = list;
  tx('kv', 'readwrite', s => s.put(list, 'activity'));
}
/** Record of assistant commands, kept on this device. Entries are frozen once written; Clear conversation erases them all. */
export function clearCommandLog() { kv.commandLog = []; tx('kv', 'readwrite', s => s.put([], 'commandLog')); }
export function restoreCommandLog(list) { kv.commandLog = Array.isArray(list) ? list : []; tx('kv', 'readwrite', s => s.put(kv.commandLog, 'commandLog')); }
export function appendCommandLog(entry) {
  const list = kv.commandLog || [];
  list.push(Object.freeze({ at: now(), ...entry }));
  if (list.length > 500) list.splice(0, list.length - 500);
  kv.commandLog = list;
  tx('kv', 'readwrite', s => s.put(list, 'commandLog'));
}

// ---------- Prefs (localStorage: small, synchronous) ----------
let prefsCache = null;
export function prefs() {
  if (!prefsCache) { try { prefsCache = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}'); } catch { prefsCache = {}; } }
  return prefsCache;
}
export function setPref(key, value) {
  prefs()[key] = value;
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache)); } catch {}
}
export const pref = (key, fallback) => (key in prefs() ? prefs()[key] : fallback);

// ---------- Files (PDF blobs) ----------
export async function putFile(id, blob) {
  if (!db) { memFiles.set(id, blob); return; }
  await tx('files', 'readwrite', s => s.put(blob, id));
}
export function getFile(id) {
  if (!db) return Promise.resolve(memFiles.get(id) || null);
  return new Promise((resolve, reject) => {
    const req = db.transaction('files', 'readonly').objectStore('files').get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}
async function allFiles() {
  if (!db) return [...memFiles.entries()];
  return new Promise((resolve, reject) => {
    const out = [];
    const req = db.transaction('files', 'readonly').objectStore('files').openCursor();
    req.onsuccess = () => { const c = req.result; if (c) { out.push([c.key, c.value]); c.continue(); } else resolve(out); };
    req.onerror = () => reject(req.error);
  });
}
/** Drop stored files no card points at any more (run at boot, after any Undo window has passed). */
/** Files a card keeps on this device: PDFs and any other upload. */
const fileIdsOf = c => [c.meta?.pdf?.fileId, c.meta?.upload?.fileId].filter(Boolean);
export async function pruneFiles() {
  const used = new Set(allCards().flatMap(fileIdsOf));
  for (const [id] of await allFiles()) if (!used.has(id)) { if (db) await tx('files', 'readwrite', s => s.delete(id)); else memFiles.delete(id); }
}
const blobToB64 = blob => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = rej; r.readAsDataURL(blob); });
const b64ToBlob = (b64, type) => { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type }); };

// ---------- Secrets (API keys): this device only, never exported ----------
const SECRETS_KEY = 'sedi.secrets';
export function secret(name) { try { return JSON.parse(localStorage.getItem(SECRETS_KEY) || '{}')[name] || ''; } catch { return ''; } }
export function setSecret(name, value) {
  try {
    const all = JSON.parse(localStorage.getItem(SECRETS_KEY) || '{}');
    if (value) all[name] = value; else delete all[name];
    localStorage.setItem(SECRETS_KEY, JSON.stringify(all));
  } catch {}
}

// ---------- Export / import / wipe ----------
export function exportAll() {
  return {
    app: 'sedi',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now(),
    cards: allCards(),
    records: { ...kv },
    prefs: { ...prefs() },
  };
}
/** Export including stored files (PDFs) as base64, so a backup is complete. */
export async function exportAllWithFiles() {
  const data = exportAll();
  const used = new Set(data.cards.flatMap(fileIdsOf));
  data.files = [];
  for (const [id, blob] of await allFiles()) {
    if (!used.has(id) || !blob) continue;
    data.files.push({ id, type: blob.type || 'application/pdf', data: await blobToB64(blob) });
  }
  return data;
}

export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'sedi' || !Array.isArray(data.cards)) throw new Error('This file is not a Sedi export.');
  if (mode === 'replace') {
    cards.clear();
    for (const k of Object.keys(kv)) delete kv[k];
    if (db) { await tx('cards', 'readwrite', s => s.clear()); await tx('kv', 'readwrite', s => s.clear()); }
  }
  for (const c of data.cards) {
    if (!c?.id) continue;
    const existing = cards.get(c.id);
    if (!existing || mode === 'replace' || (c.updatedAt || '') > (existing.updatedAt || '')) {
      const card = { ...c, meta: { ...(c.meta || {}) } };
      cards.set(card.id, card);
      tx('cards', 'readwrite', s => s.put(card));
    }
  }
  const recs = data.records || {};
  for (const [k, v] of Object.entries(recs)) {
    if (mode === 'merge' && Array.isArray(v) && Array.isArray(kv[k]) && k !== 'activity' && k !== 'commandLog') {
      const ids = new Set(kv[k].map(x => x?.id));
      kv[k] = [...kv[k], ...v.filter(x => !ids.has(x?.id))];
    } else if (mode === 'replace' || !(k in kv)) {
      kv[k] = v;
    }
    tx('kv', 'readwrite', s => s.put(kv[k], k));
  }
  for (const f of Array.isArray(data.files) ? data.files : []) {
    if (f?.id && f.data) { try { await putFile(f.id, b64ToBlob(f.data, f.type || 'application/pdf')); } catch {} }
  }
  if (mode === 'replace' && data.prefs) {
    prefsCache = { ...data.prefs };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache)); } catch {}
  }
  emit({ reason: 'import' });
}

export async function clearAll() {
  cards.clear();
  for (const k of Object.keys(kv)) delete kv[k];
  prefsCache = {};
  try {
    Object.keys(localStorage).filter(k => k.startsWith('sedi.')).forEach(k => localStorage.removeItem(k));
  } catch {}
  if (db) { db.close(); db = null; }
  await new Promise(res => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
}
