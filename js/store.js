// Sedi — local-first state engine.
// Cards + structural records live in IndexedDB; small UI preferences live in localStorage.
// Every mutation writes through immediately, then notifies subscribers on the next frame.

import { NS } from './env.js';
import { uuid, now } from './util.js';

const DB_NAME = NS;
const DB_VERSION = 2; // v2 (additive): adds the 'files' store for PDFs. Nothing renamed or removed.
const PREFS_KEY = `${NS}.prefs`;
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
  try { localStorage.setItem(`${NS}.fallback`, JSON.stringify({ cards: [...cards.values()], kv })); } catch {}
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
      const raw = JSON.parse(localStorage.getItem(`${NS}.fallback`) || 'null');
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
const SECRETS_KEY = `${NS}.secrets`;
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
    prefs: portablePrefs(prefs()),
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

// Only layout choices travel between devices. Anything that decides where data or keys are sent
// (AI engine, Google client, Shortcuts name, location, voice/model setup) stays on the device it was set on,
// so a shared or tampered backup can't redirect your keys or notes.
const PORTABLE_PREFS = ['boardlyTab', 'brainlyPane', 'calTarget', 'homeTab', 'planOffset', 'reviewDays', 'tasklyCaps', 'timelyAnchor', 'timelyMode', 'timelyPlan', 'timelyView'];
const oneOf = (...vals) => v => vals.includes(v);
const isNumMap = v => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(n => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n < 1000);
// Each setting that travels must hold a value the app knows how to show; anything else is left behind.
const PREF_OK = {
  boardlyTab: v => typeof v === 'string' && v.length < 200,
  brainlyPane: oneOf('notes', 'links'),
  calTarget: oneOf('google', 'ics'),
  homeTab: oneOf('next', 'recent'),
  planOffset: isNumMap,
  reviewDays: v => Number.isInteger(v) && v > 0 && v <= 365,
  tasklyCaps: isNumMap,
  timelyAnchor: v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v),
  timelyMode: oneOf('schedule', 'plan'),
  timelyPlan: oneOf('projects', 'goals'),
  timelyView: oneOf('day', 'week', 'month', 'reminders'),
};
function portablePrefs(p) {
  const out = {};
  for (const k of PORTABLE_PREFS) if (p && Object.prototype.hasOwnProperty.call(p, k) && PREF_OK[k](p[k])) out[k] = p[k];
  return out;
}
const RECORD_KEYS = new Set(['activity', 'boardlyTabs', 'brainFolders', 'commandLog', 'linkFolders', 'onboarded', 'planContainers', 'recur']);
const TOOLS = new Set(['taskly', 'boardly', 'timely', 'brainly', 'universal']);
const SAFE_FILE_TYPES = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain', 'text/markdown', 'application/octet-stream']);
const isoOr = (v, fb) => (typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : fb);
/** Coerce an imported card into the shape the app expects, or drop it. */
const str = (v, max = 500) => typeof v === 'string' && v.length <= max;
const COLOR = /^#[0-9a-f]{3,8}$/i;
/** A named list item (a tab, folder or plan list): string id and name, an optional #hex colour, nothing exotic. */
function cleanItem(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x) || !str(x.id, 200) || !x.id || !str(x.name ?? '', 200)) return null;
  const out = JSON.parse(JSON.stringify(x));
  for (const k of ['__proto__', 'constructor', 'prototype']) delete out[k];
  out.name = x.name ?? '';
  if (out.color != null && !(typeof out.color === 'string' && COLOR.test(out.color))) delete out.color;
  if (out.parentId != null && !str(out.parentId, 200)) delete out.parentId;
  for (const n of ['x', 'y', 'order']) if (out[n] != null && !Number.isFinite(out[n])) delete out[n];
  return out;
}
const cleanList = v => (Array.isArray(v) ? v.map(cleanItem).filter(Boolean) : null);
const plainObjs = v => (Array.isArray(v) ? v.filter(x => x && typeof x === 'object' && !Array.isArray(x)).map(x => JSON.parse(JSON.stringify(x))) : null);
/** Imported records are reshaped into what the app expects; a record that can't be is skipped. */
function cleanRecord(k, v) {
  switch (k) {
    case 'boardlyTabs': case 'brainFolders': case 'linkFolders': return cleanList(v);
    case 'planContainers': {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return { projects: cleanList(v.projects) || [], goals: cleanList(v.goals) || [] };
    }
    case 'recur': return plainObjs(v)?.filter(r => str(r.id, 200) && r.id) ?? null;
    case 'activity': case 'commandLog': return plainObjs(v);
    case 'onboarded': return typeof v === 'boolean' ? v : null;
    default: return null;
  }
}
/** Attached-file pointers must be complete, or the card simply loses the attachment. */
function cleanFileRef(f) {
  return f && typeof f === 'object' && str(f.fileId, 200) && f.fileId && str(f.name, 500) && (f.size == null || Number.isFinite(f.size)) ? f : undefined;
}

function cleanCard(c) {
  if (!c || typeof c !== 'object' || typeof c.id !== 'string' || !c.id || c.id.length > 200) return null;
  if (!TOOLS.has(c.tool)) return null;
  const t = now();
  const meta = c.meta && typeof c.meta === 'object' && !Array.isArray(c.meta) ? JSON.parse(JSON.stringify(c.meta)) : {};
  for (const k of ['__proto__', 'constructor', 'prototype']) delete meta[k];
  for (const k of ['upload', 'pdf']) if (k in meta) { const f = cleanFileRef(meta[k]); if (f) meta[k] = f; else delete meta[k]; }
  if (meta.color != null && !(typeof meta.color === 'string' && COLOR.test(meta.color))) delete meta.color;
  if (meta.emoji != null && !str(meta.emoji, 16)) delete meta.emoji;
  // A link's host comes from its own address (it decides which site the favicon is fetched from).
  if (typeof meta.url === 'string') {
    try { const u = new URL(meta.url); if (/^https?:$/.test(u.protocol)) meta.host = u.hostname; else delete meta.host; } catch { delete meta.host; }
  } else if (meta.host != null && !(typeof meta.host === 'string' && /^[a-z0-9.-]{1,253}$/i.test(meta.host))) delete meta.host;
  // AI summaries are only ever made on this device; an imported one could put words in Claude's mouth.
  for (const k of ['summary', 'summaryBy', 'summaryOf', 'summaryAt']) delete meta[k];
  return {
    ...c,
    id: c.id,
    type: typeof c.type === 'string' ? c.type : 'note',
    tool: c.tool,
    title: typeof c.title === 'string' ? c.title : String(c.title ?? ''),
    description: typeof c.description === 'string' ? c.description : '',
    createdAt: isoOr(c.createdAt, t),
    updatedAt: isoOr(c.updatedAt, t),
    meta,
  };
}

export async function importAll(data, mode = 'merge') {
  if (!data || data.app !== 'sedi' || !Array.isArray(data.cards)) throw new Error('This file is not a Sedi export.');
  if (mode === 'replace') {
    cards.clear();
    for (const k of Object.keys(kv)) delete kv[k];
    if (db) { await tx('cards', 'readwrite', s => s.clear()); await tx('kv', 'readwrite', s => s.clear()); }
  }
  for (const raw of data.cards) {
    const card = cleanCard(raw);
    if (!card) continue;
    const existing = cards.get(card.id);
    if (!existing || mode === 'replace' || card.updatedAt > (existing.updatedAt || '')) {
      cards.set(card.id, card);
      tx('cards', 'readwrite', s => s.put(card));
    }
  }
  const recs = data.records && typeof data.records === 'object' ? data.records : {};
  for (const [k, raw] of Object.entries(recs)) {
    if (!RECORD_KEYS.has(k)) continue;
    const v = cleanRecord(k, raw);
    if (v === null) continue;
    if (mode === 'merge' && Array.isArray(v) && Array.isArray(kv[k]) && k !== 'activity' && k !== 'commandLog') {
      const ids = new Set(kv[k].map(x => x?.id));
      kv[k] = [...kv[k], ...v.filter(x => !ids.has(x?.id))];
    } else if (mode === 'replace' || !(k in kv)) {
      kv[k] = v;
    }
    tx('kv', 'readwrite', s => s.put(kv[k], k));
  }
  const have = mode === 'merge' ? new Set((await allFiles()).map(([id]) => id)) : new Set();
  for (const f of Array.isArray(data.files) ? data.files : []) {
    if (typeof f?.id !== 'string' || typeof f.data !== 'string' || have.has(f.id)) continue;
    // Never trust the type in the file: anything unexpected becomes a plain download.
    const type = SAFE_FILE_TYPES.has(f.type) ? f.type : 'application/octet-stream';
    try { await putFile(f.id, b64ToBlob(f.data, type)); } catch {}
  }
  const incoming = portablePrefs(data.prefs);
  if (Object.keys(incoming).length) {
    prefsCache = { ...prefs(), ...incoming };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefsCache)); } catch {}
  }
  emit({ reason: 'import' });
}

export async function clearAll() {
  cards.clear();
  for (const k of Object.keys(kv)) delete kv[k];
  prefsCache = {};
  try {
    Object.keys(localStorage).filter(k => k.startsWith(`${NS}.`)).forEach(k => localStorage.removeItem(k));
  } catch {}
  if (db) { db.close(); db = null; }
  await new Promise(res => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => res();
  });
}
