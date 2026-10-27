// Sedi — the words Sedi knows. Speech recognisers stumble on names: Sedi's own, the apps people use, and the
// people and places in someone's life. Three light, private layers put them right, all on this device:
//   1. A small built-in index of words recognisers commonly get wrong (Sedi and its tools first).
//   2. Names already in your own cards ("Lisbon", "Priya"), matched by how they sound. Nothing new is
//      collected or stored for this: it reads the cards you already have, when it's needed.
//   3. Fixes you make yourself. Correct a word once in a transcript and Sedi remembers it. Only the pair
//      (what it heard → what you meant) is kept, you can see the list, and clear it, in Voice settings.
// No audio is kept and nothing leaves the device.

import * as store from './store.js';

// ---------- 1. The built-in index ----------
// Each entry: what recognisers write → what was said. Ambiguous ones (e.g. "Adam" for Atom) only apply in
// the phrases where they can only mean the Sedi word.
const BUILTIN = [
  [/\b(?:sedi|seti|setti|setty|sedie|sedy|seddy|sedee|cedi|ceddy|sadie(?= app)|said he(?= app))\b/gi, 'Sedi'],
  [/\bbo(?:a|u|o)?re?d[\s-]?(?:ly|lee|ley|li|lie|ie|y)\b/gi, 'Boardly'],
  [/\bbrain[\s-]?(?:ly|lee|ley|li|lie|ie)\b/gi, 'Brainly'],
  [/\btask[\s-]?(?:ly|lee|ley|li|lie|ie)\b/gi, 'Taskly'],
  [/\btime[\s-](?:lee|ley|li|lie)\b/gi, 'Timely'],
  [/\b(?:hey|hi|ask|tell|okay|ok)\s+(?:adam|atum|addum|at um)\b/gi, m => m.replace(/\s+\S+(?:\s+um)?$/i, ' Atom')],
  [/\buniversal bored\b/gi, 'Universal Board'],
  [/\b(?:un|on)[\s-]load(?= mode| it all| everything)\b/gi, 'Unload'],
  // Apps and everyday tech words
  [/\bchat\s*g\.?\s*p\.?\s*t\b/gi, 'ChatGPT'],
  [/\b(?:claude|cloud|clawed)(?=\s+(?:ai|code|desktop)\b)/gi, 'Claude'],
  [/\b(?:send|ask|open)\s+(?:it\s+)?(?:to\s+|in\s+)?(?:cloud|clawed)\b/gi, m => m.replace(/(?:cloud|clawed)$/i, 'Claude')],
  [/\bi[\s-]cloud\b/gi, 'iCloud'],
  [/\bi[\s-]?phone\b/gi, 'iPhone'],
  [/\bi[\s-]pad\b/gi, 'iPad'],
  [/\bmac[\s-]?book\b/gi, 'MacBook'],
  [/\bg[\s-]mail\b/gi, 'Gmail'],
  [/\bgoogle (?:cal|calendar|calender)\b/gi, 'Google Calendar'],
  [/\bgoogle (?:doc|docs|dock|docks)\b/gi, m => /s$/i.test(m) ? 'Google Docs' : 'Google Doc'],
  [/\bwhats[\s-]?app\b/gi, 'WhatsApp'],
  [/\byou[\s-]tube\b/gi, 'YouTube'],
  [/\blinked[\s-]in\b/gi, 'LinkedIn'],
  [/\bface[\s-]time\b/gi, 'FaceTime'],
  [/\bpower[\s-]point\b/gi, 'PowerPoint'],
  [/\bnot[\s-]ion\b/gi, 'Notion'],
  [/\bfig[\s-]ma\b/gi, 'Figma'],
  [/\bget[\s-]hub\b|\bgit[\s-]hub\b/gi, 'GitHub'],
  [/\bproduct hunt\b/gi, 'Product Hunt'],
  [/\bp\.?\s?d\.?\s?f\b/gi, 'PDF'],
  [/\bwi[\s-]?fi\b/gi, 'Wi-Fi'],
  [/\be[\s-]mail\b/gi, 'email'],
];

// ---------- 2. Names from your own cards, matched by sound ----------
/** A rough sound key: letters that sound alike map together, vowels after the first letter drop out. */
export function soundKey(w) {
  let s = String(w || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!s) return '';
  s = s.replace(/^kn|^gn|^pn|^wr/, m => m[1]).replace(/ph/g, 'f').replace(/ck/g, 'k').replace(/c(?=[eiy])/g, 's').replace(/c/g, 'k')
    .replace(/q/g, 'k').replace(/x/g, 'ks').replace(/z/g, 's').replace(/dg/g, 'j').replace(/gh/g, '').replace(/th/g, '0')
    .replace(/sch/g, 'sk').replace(/sh/g, 'x').replace(/v/g, 'f').replace(/(?<=[aeiou])w(?=[aeiou])/g, 'f').replace(/w(?![aeiou])/g, '')
    .replace(/(?<=[^aeiou])j(?=[aeiou])|(?<=[aeiou])j(?=[aeiou])/g, 'y').replace(/y(?![aeiou])/g, '');
  const first = s[0];
  return (first + s.slice(1).replace(/[aeiouhwy]/g, '')).replace(/(.)\1+/g, '$1');
}
function distance(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
// Capitalised words that start sentences or commands aren't names, even if they look like one.
const NOT_NAMES = new Set('I Im Ive Id The A An And But So Then Also Call Text Email Remind Add Make Put Schedule Book Buy Pay Send Write Finish Fix Move Open Tell Ask Check Get Go Need Want Maybe Today Tomorrow Monday Tuesday Wednesday Thursday Friday Saturday Sunday January February March April May June July August September October November December Taskly Boardly Timely Brainly Sedi Atom Unload'.split(' '));
let nameCache = null, nameStamp = -1, changes = 0;
store.on?.(() => { changes++; });
/** Proper names in your cards: capitalised words that aren't at the start of a title. Read when needed, never stored. */
function cardNames() {
  if (nameCache && nameStamp === changes) return nameCache;
  const names = new Map();
  for (const c of store.allCards?.() || []) {
    const words = String(c.title || '').split(/\s+/);
    words.forEach((w, i) => {
      const clean = w.replace(/^[^A-Za-z]+|[^A-Za-z'’]+$/g, '').replace(/['’]s$/, '');
      if (i === 0 || clean.length < 3 || !/^[A-Z][a-z]/.test(clean) || NOT_NAMES.has(clean)) return;
      names.set(clean.toLowerCase(), clean);
    });
  }
  nameCache = [...names.values()].map(n => ({ n, k: soundKey(n) }));
  nameStamp = changes;
  return nameCache;
}
function fixNames(text) {
  const names = cardNames();
  if (!names.length) return text;
  return text.replace(/\b[A-Za-z][a-z'’]{3,}\b/g, (w, at) => {
    // Recognisers capitalise what they take for a name; a lowercase word is left alone unless it's a near-exact match.
    const capital = /^[A-Z]/.test(w);
    if (NOT_NAMES.has(w)) return w;
    const k = soundKey(w);
    let best = null;
    for (const x of names) {
      if (x.n === w) return w;
      if (x.k !== k) continue;
      const dist = distance(w, x.n);
      if (dist <= (capital ? Math.max(1, Math.floor(x.n.length / 3)) : 1) && (!best || dist < best.d)) best = { n: x.n, d: dist };
    }
    return best ? best.n : w;
  });
}

// ---------- 3. Your own fixes ----------
const fixes = () => store.pref('voiceFixes', {});
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function applyFixes(text) {
  const f = fixes();
  let out = text;
  for (const [heard, meant] of Object.entries(f)) out = out.replace(new RegExp(`\\b${esc(heard)}\\b`, 'gi'), meant);
  return out;
}
/** Remember a fix: next time Sedi hears `heard`, it writes `meant`. Keeps only the last 300. */
export function learnFix(heard, meant) {
  heard = String(heard || '').trim().toLowerCase(); meant = String(meant || '').trim();
  if (!heard || !meant || heard === meant.toLowerCase() || heard.length > 40 || meant.length > 40) return false;
  const next = { ...fixes() };
  delete next[heard];
  next[heard] = meant;
  const keys = Object.keys(next);
  if (keys.length > 300) delete next[keys[0]];
  store.setPref('voiceFixes', next);
  return true;
}
export function forgetFix(heard) { const next = { ...fixes() }; delete next[heard]; store.setPref('voiceFixes', next); }
export function clearFixes() { store.setPref('voiceFixes', {}); }
export const listFixes = () => Object.entries(fixes());

/**
 * Compare what was heard with what you corrected it to, and learn the words that changed one-for-one
 * (or two heard words that became one name: "lisp on" → "Lisbon"). Returns what was learned.
 */
export function learnFromEdit(before, after) {
  const a = String(before || '').split(/\s+/).filter(Boolean), b = String(after || '').split(/\s+/).filter(Boolean);
  const strip = w => w.replace(/^[^\w’']+|[^\w’']+$/g, '');
  const learned = [];
  let i = 0, j = 0;
  while (i < a.length && j < b.length) {
    const x = strip(a[i]), y = strip(b[j]);
    if (x.toLowerCase() === y.toLowerCase()) { i++; j++; continue; }
    // two heard → one meant ("on dree" → "Andrei"), when the words around it line up
    if (i + 1 < a.length && strip(a[i + 2] || '').toLowerCase() === strip(b[j + 1] || '').toLowerCase() && /[A-Z]/.test(y)) {
      if (learnFix(`${x} ${strip(a[i + 1])}`, y)) learned.push([`${x} ${strip(a[i + 1])}`, y]);
      i += 2; j++; continue;
    }
    // one for one, only when the rest lines up (so a rewritten sentence teaches nothing)
    // Only names and proper words (they have a capital) are learned; fixing "leek" to "leak" corrects this
    // transcript but teaches nothing, so an everyday word is never swapped everywhere.
    if (strip(a[i + 1] || '').toLowerCase() === strip(b[j + 1] || '').toLowerCase() && /[A-Z]/.test(y)) {
      if (x && y && learnFix(x, y)) learned.push([x, y]);
    }
    i++; j++;
  }
  return learned;
}

/** Put right the words recognisers get wrong: the built-in index, your fixes, then names from your cards. */
export function fixHeard(text) {
  if (!text) return text;
  let out = String(text);
  for (const [re, to] of BUILTIN) out = out.replace(re, to);
  out = applyFixes(out);
  out = fixNames(out);
  return out;
}
