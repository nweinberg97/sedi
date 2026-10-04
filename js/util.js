// Sedi — shared helpers: DOM builder, ids, dates, icons, toasts, modals, emoji + color heuristics.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Tiny hyperscript: h('div', {class:'x', onclick}, child, 'text', [more]) */
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    }
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}
function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}
export function svg(markup) {
  const t = document.createElement('template');
  t.innerHTML = markup.trim();
  return t.content.firstChild;
}
export const icon = (name, cls = '') => {
  const el = svg(ICONS[name] || ICONS.dot);
  if (cls) el.classList.add(...cls.split(' '));
  return el;
};

export function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = (Math.random() * 16) | 0;
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
  });
}
export const now = () => new Date().toISOString();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ---------- Dates (local, YYYY-MM-DD keys) ----------
export const pad = n => String(n).padStart(2, '0');
export const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
export const todayKey = () => dateKey(new Date());
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const addMonths = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth() + n, 1); return x; };
export const startOfWeek = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); }; // Monday
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const fmtLongDate = d => `${DAY_NAMES[d.getDay()]}, ${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
export const fmtShortDate = d => `${MONTH_NAMES[d.getMonth()].slice(0, 3)} ${d.getDate()}`;
export function fmtMinutes(m) {
  const hh = Math.floor(m / 60) % 24, mm = m % 60;
  const ampm = hh < 12 ? 'am' : 'pm';
  const h12 = hh % 12 === 0 ? 12 : hh % 12;
  return mm ? `${h12}:${pad(mm)}${ampm}` : `${h12}${ampm}`;
}
export function relTime(iso) {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// ---------- Text ----------
export const firstLine = s => (s || '').split('\n')[0];
export function stripHtml(html) {
  const d = document.createElement('div');
  d.innerHTML = html || '';
  d.querySelectorAll('br,p,div,li,h1,h2,h3').forEach(n => n.append('\n'));
  return d.textContent.replace(/\n{3,}/g, '\n\n').trim();
}
/** Very small, safe markdown-ish renderer for descriptions (bold, bullets, line breaks). */
export function renderText(text) {
  const wrap = h('div', { class: 'rich-text' });
  const lines = (text || '').split('\n');
  let list = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*•]\s+(.*)/.exec(line);
    if (bullet) {
      if (!list) { list = h('ul'); wrap.append(list); }
      list.append(inline(h('li'), bullet[1]));
      continue;
    }
    list = null;
    if (!line.trim()) { wrap.append(h('div', { class: 'gap' })); continue; }
    const head = /^#{1,3}\s+(.*)/.exec(line);
    wrap.append(inline(h(head ? 'h4' : 'p'), head ? head[1] : line));
  }
  return wrap;
}
function inline(el, s) {
  const parts = s.split(/(\*\*[^*]+\*\*)/g);
  for (const p of parts) {
    if (/^\*\*[^*]+\*\*$/.test(p)) el.append(h('strong', {}, p.slice(2, -2)));
    else if (p) el.append(p);
  }
  return el;
}

// ---------- Color + emoji heuristics ----------
export function hashStr(s) { let x = 2166136261; for (const c of s || '') { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; }
export const SOFT_COLORS = ['#8E9BC9', '#86AE95', '#C9A46E', '#A796CB', '#C98E8E', '#7FAEBE', '#B9A27E', '#9AA3AD'];
export const colorFor = s => SOFT_COLORS[hashStr(s) % SOFT_COLORS.length];

const EMOJI_RULES = [
  ['youtube|youtu\\.be|vimeo|video|film|movie|watch|twitch|netflix', '🎬'],
  ['spotify|music|song|podcast|soundcloud|audio|playlist', '🎵'],
  ['github|gitlab|code|coding|developer|api|stackoverflow|npm|javascript|python|program', '💻'],
  ['docs?|notion|wiki|guide|manual|readme|article|blog|medium|substack|read|reading', '📄'],
  ['recipe|food|cook|meal|eat|kitchen|grocer|grocery|groceries', '🍳'],
  ['amazon|shop|shopping|store|buy|cart|etsy|ebay|price|gift', '🛍️'],
  ['twitter|x\\.com|reddit|instagram|facebook|linkedin|tiktok|threads|social', '💬'],
  ['news|nytimes|bbc|cbc|guardian|reuters|times', '📰'],
  ['run|running|gym|workout|health|fitness|sleep|yoga|walk|doctor|meds?', '🌿'],
  ['travel|trip|flight|hotel|maps?|airbnb|booking', '✈️'],
  ['money|bank|budget|invest|tax|taxes|finance|bills?|pay', '💳'],
  ['learn|course|study|class|school|lecture|books?', '📚'],
  ['ideas?|brainstorm|think|thoughts?|dream|vision', '💡'],
  ['work|meeting|project|client|launch|team', '💼'],
  ['home|house|clean|chores?|laundry|fix', '🏠'],
  ['friends?|family|mom|dad|partner|love|relationships?', '🤝'],
].map(([words, e]) => [new RegExp(`(^|[^a-z])(${words})(?![a-z])`, 'i'), e]);
export function smartEmoji(text, fallback = '📝') {
  for (const [re, e] of EMOJI_RULES) if (re.test(text || '')) return e;
  return fallback;
}
export function mostCommonEmoji(texts, fallback) {
  const counts = {};
  for (const t of texts) { const e = smartEmoji(t, null); if (e) counts[e] = (counts[e] || 0) + 1; }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
  return best ? best[0] : fallback;
}
export const EMOJI_CHOICES = ['📝', '💡', '📚', '💼', '🌿', '🏠', '🤝', '✈️', '💳', '🎬', '🎵', '💻', '🍳', '🎯', '⭐', '🧭'];

export function prettyUrl(url) {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const seg = u.pathname.split('/').filter(Boolean).pop();
    let title = seg ? decodeURIComponent(seg).replace(/\.[a-z0-9]+$/i, '').replace(/[-_+]+/g, ' ').trim() : '';
    if (!title || /^[0-9a-f]{8,}$/i.test(title) || title.length < 3 || /^(watch|index|home|video|videos|post|posts|article|p|status|view|item|en|en us)$/i.test(title)) title = host.split('.').slice(-2, -1)[0] || host;
    title = title.charAt(0).toUpperCase() + title.slice(1);
    return { host, title };
  } catch { return { host: '', title: url }; }
}

// ---------- Download ----------
export function download(filename, content, type = 'application/json') {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: filename });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ---------- Toasts ----------
export function toast(message, { action, onAction, duration = 3200 } = {}) {
  const host = $('#toasts');
  const el = h('div', { class: 'toast', role: 'status' }, h('span', {}, message));
  if (action) {
    el.append(h('button', { class: 'toast-action', onclick: () => { onAction?.(); dismiss(); } }, action));
  }
  host.append(el);
  requestAnimationFrame(() => el.classList.add('in'));
  const t = setTimeout(dismiss, action ? Math.max(duration, 5500) : duration);
  function dismiss() { clearTimeout(t); el.classList.remove('in'); setTimeout(() => el.remove(), 250); }
  return dismiss;
}

// ---------- Modals ----------
let modalStack = [];
export function modal({ title, body, actions = [], wide = false, onClose, className = '' }) {
  const backdrop = h('div', { class: 'modal-backdrop' });
  const box = h('div', { class: `modal ${wide ? 'wide' : ''} ${className}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title || 'Dialog' });
  const close = () => {
    backdrop.classList.remove('in');
    modalStack = modalStack.filter(m => m !== close);
    setTimeout(() => backdrop.remove(), 180);
    document.removeEventListener('keydown', onKey, true);
    onClose?.();
  };
  const onKey = e => { if (e.key === 'Escape' && modalStack.at(-1) === close) { e.stopPropagation(); close(); } };
  const head = h('div', { class: 'modal-head' },
    h('h3', {}, title || ''),
    h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: close }, icon('x')));
  box.append(head);
  const content = h('div', { class: 'modal-body' });
  if (body) content.append(body instanceof Node ? body : document.createTextNode(body));
  box.append(content);
  if (actions.length) {
    const foot = h('div', { class: 'modal-foot' });
    for (const a of actions) {
      foot.append(h('button', {
        class: `btn ${a.kind || ''}`,
        onclick: async () => { const keep = await a.onClick?.(close); if (keep !== true) close(); },
      }, a.label));
    }
    box.append(foot);
  }
  backdrop.append(box);
  backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) close(); });
  document.body.append(backdrop);
  document.addEventListener('keydown', onKey, true);
  modalStack.push(close);
  requestAnimationFrame(() => backdrop.classList.add('in'));
  setTimeout(() => box.querySelector('input, textarea, [contenteditable="true"]')?.focus(), 60);
  return { close, box, content };
}
export const hasOpenModal = () => modalStack.length > 0;

export function confirmModal(title, text, confirmLabel = 'Confirm', danger = false) {
  return new Promise(res => {
    let done = false;
    modal({
      title, body: h('p', { class: 'muted' }, text),
      actions: [
        { label: 'Cancel', kind: 'ghost', onClick: () => { done = true; res(false); } },
        { label: confirmLabel, kind: danger ? 'danger' : 'primary', onClick: () => { done = true; res(true); } },
      ],
      onClose: () => { if (!done) res(false); },
    });
  });
}

/** Inline popover anchored to an element. Closes on outside click / Escape. */
export function popover(anchor, content, { className = '', placement = 'below' } = {}) {
  closePopovers();
  const pop = h('div', { class: `popover ${className}` }, content);
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  const pr = pop.getBoundingClientRect();
  let left = clamp(r.left, 12, innerWidth - pr.width - 12);
  let top = placement === 'below' ? r.bottom + 8 : r.top - pr.height - 8;
  if (top + pr.height > innerHeight - 12) top = r.top - pr.height - 8;
  if (top < 12) top = 12;
  pop.style.left = left + 'px'; pop.style.top = top + 'px';
  requestAnimationFrame(() => pop.classList.add('in'));
  const off = e => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePopovers(); };
  const key = e => { if (e.key === 'Escape') closePopovers(); };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', key); });
  pop._cleanup = () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', key); };
  return pop;
}
export function closePopovers() { $$('.popover').forEach(p => { p._cleanup?.(); p.remove(); }); }

/** Make an element's text editable in place; resolves with new text on Enter/blur. */
export function editInline(el, { multiline = false, onCommit, selectAll = true } = {}) {
  if (el.isContentEditable) return;
  const before = el.textContent;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  el.classList.add('editing');
  el.focus();
  if (selectAll) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); }
  const finish = commit => {
    el.removeEventListener('keydown', onKey); el.removeEventListener('blur', onBlur);
    el.contentEditable = 'false'; el.classList.remove('editing');
    const val = el.textContent.trim();
    if (commit && val && val !== before) onCommit?.(val);
    else el.textContent = before;
  };
  const onKey = e => {
    e.stopPropagation();
    if (e.key === 'Enter' && !multiline) { e.preventDefault(); finish(true); }
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
  };
  const onBlur = () => finish(true);
  el.addEventListener('keydown', onKey); el.addEventListener('blur', onBlur);
}

// ---------- Icons (1.6px strokes, currentColor) ----------
const S = (inner, vb = 24) => `<svg viewBox="0 0 ${vb} ${vb}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;
export const ICONS = {
  atom: S('<circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><ellipse cx="12" cy="12" rx="10" ry="4"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(120 12 12)"/>'),
  menu: S('<path d="M4 8h16M4 16h16"/>'),
  universe: S('<circle cx="12" cy="12" r="4.2"/><ellipse cx="12" cy="12" rx="10" ry="3.4" transform="rotate(-20 12 12)"/><path d="M5 4.5v1.6M4.2 5.3h1.6M19 17.6v1.6M18.2 18.4h1.6" stroke-width="1.3"/>'),
  home: S('<path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/><path d="M10 20v-5h4v5"/>'),
  trash: S('<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.5 7l.9 12.2h9.2l.9-12.2"/><path d="M10.2 10.5v5.5M13.8 10.5v5.5"/>'),
  target: S('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  checklist: S('<path d="M4 6.5l1.5 1.5L8.5 5"/><path d="M4 13.5l1.5 1.5 3-3"/><path d="M11.5 7h8.5M11.5 14h8.5M11.5 19.5h6"/>'),
  pencil: S('<path d="M15.5 4.5l4 4L8.5 19.5H4.5v-4z"/><path d="M13.5 6.5l4 4"/>'),
  info: S('<path d="M5 6h14M5 10.5h14M5 15h9"/>'),
  plus: S('<path d="M12 5v14M5 12h14"/>'),
  x: S('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  mic: S('<rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/>'),
  link: S('<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>'),
  file: S('<path d="M6 3.5h8l4 4v13H6z"/><path d="M14 3.5v4h4M9 12.5h6M9 16h6"/>'),
  folder: S('<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
  search: S('<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>'),
  calendar: S('<rect x="4" y="5.5" width="16" height="14.5" rx="2.5"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>'),
  bell: S('<path d="M6.5 16.5V11a5.5 5.5 0 0 1 11 0v5.5l1.5 1.5H5z"/><path d="M10 20.5h4"/>'),
  repeat: S('<path d="M17 4l3 3-3 3"/><path d="M20 7H8a4 4 0 0 0-4 4v1"/><path d="M7 20l-3-3 3-3"/><path d="M4 17h12a4 4 0 0 0 4-4v-1"/>'),
  download: S('<path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M5 19.5h14"/>'),
  upload: S('<path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M5 19.5h14"/>'),
  sync: S('<path d="M19.5 12a7.5 7.5 0 0 1-13 5.1M4.5 12a7.5 7.5 0 0 1 13-5.1"/><path d="M17.5 3.5v3.6h-3.6M6.5 20.5v-3.6h3.6"/>'),
  brain: S('<path d="M9 4.5a3 3 0 0 0-3 3 3 3 0 0 0-2 5.2A3 3 0 0 0 6.5 17 3 3 0 0 0 12 18.5V6a1.6 1.6 0 0 0-3-1.5z"/><path d="M15 4.5a3 3 0 0 1 3 3 3 3 0 0 1 2 5.2 3 3 0 0 1-2.5 4.3A3 3 0 0 1 12 18.5"/>'),
  send: S('<path d="M5 12h13M13 6.5 18.5 12 13 17.5"/>'),
  check: S('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  expand: S('<path d="M14 4.5h5.5V10M10 19.5H4.5V14M19.5 4.5l-6 6M4.5 19.5l6-6"/>'),
  minimize: S('<path d="M19.5 4.5l-5.5 5.5M14 5.5V10h4.5M4.5 19.5 10 14M10 18.5V14H5.5"/>'),
  chevL: S('<path d="M14.5 6 8.5 12l6 6"/>'),
  chevR: S('<path d="M9.5 6l6 6-6 6"/>'),
  stop: S('<rect x="7" y="7" width="10" height="10" rx="2"/>'),
  speaker: S('<path d="M5 9.5h3.5L13 5.5v13l-4.5-4H5z"/><path d="M16.5 9a4.5 4.5 0 0 1 0 6M18.8 6.5a8 8 0 0 1 0 11"/>'),
  archive: S('<rect x="3.5" y="4.5" width="17" height="4" rx="1.2"/><path d="M5 8.5V19h14V8.5M10 12h4"/>'),
  share: S('<path d="M12 4v11M8 8l4-4 4 4"/><path d="M6 12v7.5h12V12"/>'),
  dot: S('<circle cx="12" cy="12" r="3" fill="currentColor"/>'),
  palette: S('<circle cx="12" cy="12" r="8"/>'),
  text: S('<path d="M5 6.5h14M12 6.5V19"/>'),
  bold: S('<path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z"/>'),
  italic: S('<path d="M14 5h-4M14 19h-4M13 5l-2 14"/>'),
  list: S('<path d="M9 7h11M9 12h11M9 17h11"/><circle cx="4.8" cy="7" r=".9" fill="currentColor"/><circle cx="4.8" cy="12" r=".9" fill="currentColor"/><circle cx="4.8" cy="17" r=".9" fill="currentColor"/>'),
  heading: S('<path d="M6 5v14M18 5v14M6 12h12"/>'),
  open: S('<path d="M13.5 4.5h6v6M19.5 4.5 11 13"/><path d="M18 14v5.5H4.5V6H10"/>'),
};
