// Sedi — Brainly: search, My Links (links, text files, PDFs in collapsible folders), and a free-form canvas
// of notes (rounded squares) and folders (which can hold folders).

import * as store from './store.js';
import {
  h, icon, uuid, clamp, toast, modal, popover, closePopovers, editInline, stripHtml, relTime, confirmModal,
  colorFor, smartEmoji, mostCommonEmoji, prettyUrl, EMOJI_CHOICES, debounce, hashStr, listMode, safeUrl,
} from './util.js';
import { registerDrop, onDragStart, onDragEnd } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, TOOL_NAMES, flatten, cardChrome, openMoveDialog, trashCard, landed, withMic } from './cards.js';
import { revealCard } from './shell.js';
import { dictate as listen, canListen } from './speech.js'; // card mics: instant browser dictation
import { crunch } from './sound.js';
import { pickEmoji } from './emoji.js';
import { summaryFor, ensureSummary, noteText } from './summaries.js';
import * as google from './google.js';
import { addTaskFrom } from './taskly.js';

let root, canvas, dash, searchInput, results, peekEl = null, hovered = null;
const NOTE = 118, FOLDER_W = 150, FOLDER_H = 112;
const NOTE_COLORS = ['#fdf0d8', '#ece5fb', '#dff0fb', '#e2f3e4', '#fde2da', '#eef0f3']; // defaults new notes are given
// Everything you can pick for a note: soft paper colors, light enough to write on.
const NOTE_PALETTE = ['#fdf0d8', '#fff6b8', '#ffe9c7', '#fde2da', '#fbe3ec', '#f1defa', '#ece5fb', '#dfe3ff', '#dff0fb', '#d8ecff', '#d4f1ec', '#e2f3e4', '#e8f6c9', '#f6e3d3', '#e6e0d8', '#eef0f3', '#ffffff'];
const MAX_PDF = 25e6;

const folders = () => store.get('brainFolders', []);
const folderById = id => folders().find(f => f.id === id);
const topFolders = () => folders().filter(f => !f.parentId || !folderById(f.parentId));
const childFolders = fid => folders().filter(f => f.parentId === fid);
const linkFolders = () => store.get('linkFolders', []);
const canvasNotes = () => store.cardsWhere(c => c.tool === 'brainly' && c.type !== 'link' && !c.meta?.folderId);
const folderNotes = fid => store.cardsWhere(c => c.tool === 'brainly' && c.type !== 'link' && c.meta?.folderId === fid);
const links = lfid => store.cardsWhere(c => c.tool === 'brainly' && c.type === 'link' && (c.meta?.linkFolderId || null) === (lfid || null)).sort(byOrder);
const descendants = fid => childFolders(fid).flatMap(f => [f.id, ...descendants(f.id)]);
export const noteColor = c => c.meta?.color || NOTE_COLORS[hashStr(c.meta?.emoji || c.title) % NOTE_COLORS.length];
const kindOf = c => (c.meta?.pdf ? 'pdf' : c.meta?.upload ? 'upload' : c.meta?.file ? 'text' : c.type === 'link' ? 'link' : 'note');
const MAX_UPLOAD = 25e6;
/** What sort of file an upload is, from its type or extension. */
const FILE_KINDS = [
  ['image', /^image\//, /\.(png|jpe?g|gif|webp|heic|svg|avif)$/i, '🖼️', '#7FAEBE'],
  ['video', /^video\//, /\.(mp4|mov|webm|m4v)$/i, '🎬', '#A796CB'],
  ['audio', /^audio\//, /\.(mp3|m4a|wav|aac|ogg|flac)$/i, '🎵', '#C98E8E'],
  ['sheet', /spreadsheet|excel|csv/, /\.(xlsx?|csv|numbers|tsv)$/i, '📊', '#86AE95'],
  ['slides', /presentation|powerpoint/, /\.(pptx?|key)$/i, '📽️', '#C9A46E'],
  ['doc', /word|opendocument\.text|rtf/, /\.(docx?|pages|rtf|odt)$/i, '📝', '#8E9BC9'],
  ['archive', /zip|compressed|x-tar|x-7z/, /\.(zip|rar|7z|tar|gz)$/i, '🗜️', '#9AA3AD'],
];
const fileKind = up => FILE_KINDS.find(([, mime, ext]) => mime.test(up?.type || '') || ext.test(up?.name || '')) || ['file', null, null, '📄', '#9AA3AD'];
const fmtSize = n => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

// ---------- Search (SD-S1 in place, SD-B6 everything else in a list) ----------
const query = () => (searchInput?.value || '').trim().toLowerCase();
const matches = (c, q = query()) => !q || q.split(/\s+/).every(w => `${c.title} ${flatten(c)} ${c.meta?.url || ''} ${c.meta?.pdf?.name || ''}`.toLowerCase().includes(w));
const folderMatches = (f, q = query()) => !q || f.name.toLowerCase().includes(q) || folderNotes(f.id).some(c => matches(c, q)) || childFolders(f.id).some(x => folderMatches(x, q));

export function mount(el) {
  root = el;
  searchInput = h('input', { class: 'search-input', type: 'search', placeholder: 'Search Brainly and the rest of Sedi', 'aria-label': 'Search everything' });
  results = h('div', { class: 'search-results', hidden: true });
  searchInput.addEventListener('input', debounce(() => runSearch(), 60));
  searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { searchInput.value = ''; runSearch(); } });
  searchInput.addEventListener('focus', () => { if (query()) results.hidden = false; });
  document.addEventListener('pointerdown', e => { if (results && !e.target.closest('.search')) results.hidden = true; });
  canvas = h('div', { class: 'brain-canvas', dataset: { drop: 'brainly-canvas', accept: 'card bfolder' }, 'data-canvas': '', 'data-navoro-sensitive': '' });
  dash = h('aside', { class: 'links-dash', 'aria-label': 'My links' });
  // Phones show one pane at a time: your notes, or your links. Desktop shows both side by side.
  const pane = store.pref('brainlyPane', 'notes');
  const paneBtn = (v, label) => h('button', { type: 'button', role: 'tab', class: v === pane ? 'on' : '', 'aria-selected': String(v === pane), onclick: e => {
    store.setPref('brainlyPane', v);
    root.querySelector('.brainly').dataset.pane = v;
    e.currentTarget.parentElement.querySelectorAll('button').forEach(b => { const on = b === e.currentTarget; b.classList.toggle('on', on); b.setAttribute('aria-selected', String(on)); });
  } }, label);
  const paneSwitch = h('div', { class: 'segmented brain-pane-switch', role: 'tablist', 'aria-label': 'Show' }, paneBtn('notes', 'Notes'), paneBtn('links', 'Links'));
  root.replaceChildren(h('div', { class: 'view brainly', dataset: { pane } },
    paneSwitch,
    h('div', { class: 'view-head brainly-head' },
      h('h1', { class: 'view-title' }, 'Brainly'),
      h('div', { class: 'search' }, icon('search', 'search-icon'), searchInput, results),
      h('div', { class: 'brain-actions' },
        h('button', { class: 'btn primary sm', onclick: () => addNote() }, icon('plus'), 'Note'),
        h('button', { class: 'btn ghost sm', onclick: () => addFolder() }, icon('folder'), 'Folder'))),
    h('div', { class: 'brain-body' }, dash, canvas)));
  setupFileDrop();
  canvas.addEventListener('pointerover', e => { hovered = e.target.closest('.b-note, .b-folder'); });
  canvas.addEventListener('pointerleave', () => { hovered = null; });
  render();
}
export function unmount() { hidePeek(); }

export function render() {
  if (!root?.isConnected) return;
  renderDash();
  renderCanvas();
  if (query()) runSearch(true);
}

function runSearch(quiet = false) {
  const q = query();
  if (!quiet) { renderDash(); renderCanvas(); }
  if (!q) { results.hidden = true; return; }
  const inBrainly = store.cardsWhere(c => c.tool === 'brainly' && matches(c, q)).length;
  const others = store.allCards().filter(c => c.tool !== 'brainly' && matches(c, q))
    .sort((a, b) => (b.title.toLowerCase().includes(q) ? 1 : 0) - (a.title.toLowerCase().includes(q) ? 1 : 0) || b.updatedAt.localeCompare(a.updatedAt)).slice(0, 10);
  results.hidden = false;
  results.replaceChildren(
    h('div', { class: 'result-note' }, inBrainly ? `${inBrainly} match${inBrainly === 1 ? '' : 'es'} in Brainly, shown below. Everything else is hidden.` : 'No matches in Brainly.'),
    ...(others.length ? [h('div', { class: 'result-sub' }, 'Elsewhere in Sedi'), ...others.map(c => h('button', {
      class: 'result', onclick: () => { results.hidden = true; revealCard(c.id); },
    }, typeIcon(c.type), h('span', { class: 'result-title' }, c.title), h('span', { class: 'result-tool' }, TOOL_NAMES[c.tool])))] : []));
}

// ---------- My Links ----------
function favicon(c) {
  const m = c.meta || {};
  const kind = kindOf(c);
  if (kind === 'pdf') return h('span', { class: 'link-badge pdf-badge' }, 'PDF');
  if (kind === 'text') return h('span', { class: 'link-badge', style: { background: '#9AA3AD' } }, '📄');
  if (kind === 'upload') {
    const [k, , , emoji, tint] = fileKind(m.upload);
    const badge = h('span', { class: 'link-badge word-badge', style: { '--tint': tint } }, emoji);
    if (k === 'image') store.getFile(m.upload.fileId).then(blob => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const img = h('img', { class: 'link-thumb', src: url, alt: '' });
      img.addEventListener('load', () => { badge.replaceChildren(img); badge.classList.add('thumb'); });
    }).catch(() => {});
    return badge;
  }
  const letter = h('span', { class: 'link-badge', style: { background: colorFor(m.host || c.title) } }, (m.host || c.title || '?')[0].toUpperCase());
  // An icon picked from the link's own words (recipes → 🍳, flights → ✈️, GitHub → 💻…); the site icon only when nothing fits.
  const word = smartEmoji(`${c.title} ${m.host || ''} ${(m.url || '').replace(/[/._-]+/g, ' ')}`, null);
  if (word) return h('span', { class: 'link-badge word-badge', style: { '--tint': colorFor(m.host || c.title) } }, word);
  if (!m.host) return letter;
  // SD-L3: the site's own icon, straight from the site (no third-party lookup). Falls back to a letter.
  const img = h('img', { class: 'link-fav', alt: '', src: `https://${m.host}/favicon.ico`, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter));
  return h('span', { class: 'link-badge fav-wrap' }, img);
}

function renderDash() {
  const q = query();
  const input = h('input', { class: 'field-input sm', placeholder: 'Paste a link', 'aria-label': 'Paste a link', 'data-keep': 'link-input', 'data-navoro-id': 'brainly.paste-link' });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) { addLink(input.value.trim()); input.value = ''; }
  });
  input.addEventListener('paste', e => {
    const t = e.clipboardData.getData('text');
    if (/^https?:\/\//i.test(t.trim())) { e.preventDefault(); addLink(t.trim()); }
  });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(f => addUpload(f, null)); e.target.value = ''; } });
  const looseItems = links(null).filter(c => matches(c, q));
  const loose = h('div', { class: 'link-list loose', dataset: { drop: 'link-list', accept: 'card', lfolder: '' }, 'data-list': '' }, looseItems.map(linkEl));
  if (!looseItems.length && !q) loose.append(h('p', { class: 'empty-hint' }, 'Paste a link, or drop a PDF or text file here.'));
  const stack = h('div', { class: 'lf-stack', dataset: { drop: 'lfolder-stack', accept: 'lfolder', parent: '' }, 'data-list': 'grid' },
    lfChildren(null).filter(f => lfMatches(f, q)).map(linkFolderEl));
  dash.replaceChildren(
    h('div', { class: 'dash-head' }, h('h2', {}, 'My links'),
      h('button', { class: 'chip', title: 'Upload any file (up to 25 MB each)', onclick: () => fileIn.click() }, icon('upload'), 'Upload'),
      h('button', { class: 'chip new-lf', title: 'New folder', onclick: () => addLinkFolder(null) }, icon('folder'), 'Folder')),
    input, fileIn,
    h('div', { class: 'dash-scroll' }, loose, stack));
}

function linkEl(c) {
  const m = c.meta || {};
  const kind = kindOf(c);
  const el = h('div', { class: `link-card kind-${kind}`, dataset: { drag: 'card', id: c.id }, tabindex: 0, title: m.url || m.pdf?.name || c.title },
    favicon(c),
    h('span', { class: 'link-text' }, h('span', { class: 'link-title' }, c.title),
      h('span', { class: 'link-host' }, kind === 'pdf' ? `PDF · ${fmtSize(m.pdf.size || 0)}` : kind === 'upload' ? `${(m.upload.name.split('.').pop() || 'File').toUpperCase()} · ${fmtSize(m.upload.size || 0)}` : kind === 'text' ? 'Text file' : m.host || 'Link')));
  // SD-F4 / SD-L3: a click previews; the preview has the Open button.
  el.addEventListener('click', e => { if (!e.target.closest('button')) previewItem(el, c.id); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') previewItem(el, c.id); });
  hoverPreview(el, c);
  el.append(h('button', { class: 'link-task', 'aria-label': `Make a task: ${taskTitleFor(c)}`, title: `Make a task: “${taskTitleFor(c)}”`, onclick: e => { e.stopPropagation(); makeTaskFrom(c); } }, icon('checklist')),
    h('button', { class: 'card-del', 'aria-label': 'Delete', title: 'Delete (you can Undo)', onclick: e => { e.stopPropagation(); trashCard(c.id); } }, icon('x')));
  return el;
}

// From the outside, a folder shows one small dot per thing inside (notes, links and files, folders, each its
// own color), so you can tell at a glance how full it is and with what. Past a dozen, it's a count.
const DOT_MAX = 5; // one dot per thing inside, in its own color; past five it's a quiet "+N"
// Note papers are pale, so each dot uses a deeper shade of the same color to stay readable at 7px.
function deepen(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  if (!m) return hex;
  const n = parseInt(m[1], 16), r = (n >> 16) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  let hh = 0, s = d ? d / (1 - Math.abs(2 * l - 1)) : 0;
  if (d) hh = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  hh = Math.round(hh * 60 + 360) % 360;
  if (l < 0.72) return hex; // already strong enough
  return `hsl(${hh} ${Math.round(Math.max(s * 100 > 5 ? 45 : 6, Math.min(s * 100, 65)))}% 58%)`;
}
const dotColor = x => {
  if (x.folder) return x.color || '#A796CB';
  if (kindOf(x) === 'note') return deepen(noteColor(x));
  return x.meta?.color || '#5a8fd6';
};
function dotsRow(items) {
  const kind = x => (x.folder ? 'folder' : kindOf(x) === 'note' ? 'note' : 'link');
  const extra = items.length - DOT_MAX;
  const shown = items.slice(0, extra > 0 ? DOT_MAX - 1 : DOT_MAX); // the "+N" takes the last dot's place
  const label = `${items.length} item${items.length === 1 ? '' : 's'}`;
  return h('div', { class: 'f-dots', role: 'img', 'aria-label': label, title: label },
    shown.map(x => h('i', { class: `fd fd-${kind(x)}`, style: { '--dot': dotColor(x) } })),
    extra > 0 ? h('span', { class: 'fd-more' }, `+${items.length - shown.length}`) : null);
}
const ICON_MAX = 4; // a peek at what's inside, like icons in a folder; past that it's a count
/** Mini icons of a folder's contents: each note's emoji, each link's icon, each subfolder's emoji. */
function iconsRow(items, max = ICON_MAX) {
  const shown = items.slice(0, max);
  return h('div', { class: 'f-icons', 'aria-hidden': 'true' },
    shown.map(x => {
      if (x.folder) return h('span', { class: 'fi fi-folder', title: x.name }, x.emoji || '🗂️');
      if (kindOf(x) === 'note') return h('span', { class: 'fi', title: x.title }, x.meta?.emoji || smartEmoji(x.title));
      const b = favicon(x); b.classList.add('fi-link'); return h('span', { class: 'fi', title: x.title }, b);
    }),
    items.length > max ? h('span', { class: 'fi-more' }, `+${items.length - max}`) : null);
}

// ---------- Link folders: squares in the column; open one in a glass folder view (folders can hold folders) ----------
const lfById = id => linkFolders().find(f => f.id === id);
const lfChildren = pid => linkFolders().filter(f => (f.parentId && lfById(f.parentId) ? f.parentId : null) === (pid || null));
const lfDescendants = id => lfChildren(id).flatMap(f => [f.id, ...lfDescendants(f.id)]);
const lfPath = f => { const names = [f.name]; let p = lfById(f.parentId), guard = 0; while (p && guard++ < 10) { names.unshift(p.name); p = lfById(p.parentId); } return names.join(' › '); };
const lfMatches = (f, q) => !q || f.name.toLowerCase().includes(q) || links(f.id).some(c => matches(c, q)) || lfChildren(f.id).some(x => lfMatches(x, q));
const lfEmoji = f => f.emoji || mostCommonEmoji(links(f.id).map(c => `${c.meta?.url || ''} ${c.title}`), '🔗');
const lfCount = f => { const n = links(f.id).length, k = lfChildren(f.id).length; return [n ? `${n} item${n === 1 ? '' : 's'}` : '', k ? `${k} folder${k === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'Empty'; };

const FOLDER_TINTS = ['#7FA7D9', '#86AE95', '#C9A46E', '#A796CB', '#C98E8E', '#7FAEBE'];
const folderTint = f => f.color || FOLDER_TINTS[hashStr(f.id) % FOLDER_TINTS.length];
function linkFolderEl(f) {
  const all = links(f.id);
  const subs = lfChildren(f.id);
  const name = h('span', { class: 'lf-name', title: 'Double-click to rename' }, f.name);
  name.addEventListener('dblclick', e => { e.stopPropagation(); editInline(name, { onCommit: v => saveLinkFolder(f.id, { name: v }) }); });
  const tile = h('section', {
    class: 'lf-tile', tabindex: 0, role: 'button', 'aria-label': `${f.name}, ${lfCount(f)}. Open folder`, style: { '--fc': folderTint(f) },
    dataset: { drag: 'lfolder', id: f.id, lfolder: f.id, drop: 'lf-into', accept: 'card lfolder', into: f.id },
  },
  h('button', { class: 'lf-emoji', 'aria-label': 'Change folder emoji', title: 'Change emoji', onclick: e => { e.stopPropagation(); pickEmoji(e.currentTarget, v => saveLinkFolder(f.id, { emoji: v })); } }, lfEmoji(f)),
  h('div', { class: 'lf-tile-text' }, name, h('span', { class: 'lf-count' }, lfCount(f)),
    all.length || subs.length ? dotsRow([...subs.map(x => ({ folder: true, name: x.name, color: x.color })), ...all]) : null),
  h('button', { class: 'card-del', 'aria-label': `Delete folder ${f.name}`, title: 'Delete folder (what’s inside moves up a level)', onclick: e => { e.stopPropagation(); deleteLinkFolder(f); } }, icon('x')));
  tile.addEventListener('click', e => { if (!e.target.closest('button') && !name.isContentEditable) openLinkFolder(f.id, tile); });
  tile.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === tile) openLinkFolder(f.id, tile); });
  return tile;
}

/** The glass folder: a frosted panel over a blurred page, like opening a folder on an iPhone home screen. */
let glass = null;
function openLinkFolder(fid, fromEl) {
  closeGlass(true);
  const backdrop = h('div', { class: 'glass-backdrop', role: 'dialog', 'aria-modal': 'true' });
  const panel = h('div', { class: 'glass-folder' });
  backdrop.append(panel);
  if (fromEl) {
    const r = fromEl.getBoundingClientRect();
    panel.style.setProperty('--from-x', `${r.left + r.width / 2 - innerWidth / 2}px`);
    panel.style.setProperty('--from-y', `${r.top + r.height / 2 - innerHeight / 2}px`);
  }
  backdrop.addEventListener('pointerdown', e => { if (e.target === backdrop) closeGlass(); });
  const fileIn = h('input', { type: 'file', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(file => addUpload(file, glass?.fid)); e.target.value = ''; } });
  const paint = () => {
    const f = lfById(glass.fid);
    if (!f) return closeGlass();
    const parent = lfById(f.parentId);
    const title = h('input', { class: 'glass-title', value: f.name, size: Math.max(4, f.name.length + 1), 'aria-label': 'Folder name', spellcheck: false });
    title.addEventListener('input', () => { title.size = Math.max(4, title.value.length + 1); });
    title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') title.blur(); if (e.key === 'Escape') { title.value = f.name; title.blur(); } });
    title.addEventListener('change', () => { const v = title.value.trim(); if (v && v !== f.name) saveLinkFolder(f.id, { name: v }); });
    const subs = lfChildren(f.id), items = links(f.id);
    // Folders and files sit in their own labelled rows, and folders look like folders (tab, colour, count).
    const folderRow = subs.length ? h('div', { class: 'glass-section' },
      h('span', { class: 'glass-section-label' }, icon('folder'), `Folders · ${subs.length}`),
      h('div', { class: 'glass-grid glass-folders', dataset: { drop: 'lfolder-stack', accept: 'lfolder', parent: f.id }, 'data-list': 'grid' }, subs.map(x => {
        const n = links(x.id).length + lfChildren(x.id).length;
        const t = h('div', { class: 'glass-item glass-sub', tabindex: 0, title: `${x.name}: ${lfCount(x)}`, dataset: { drag: 'lfolder', id: x.id, drop: 'lf-into', accept: 'card lfolder', into: x.id } },
          h('span', { class: 'folder-shape', style: { '--fc': folderTint(x) } }, h('span', { class: 'folder-emoji' }, lfEmoji(x)), n ? h('span', { class: 'folder-badge' }, n) : null),
          h('span', { class: 'glass-label' }, x.name));
        t.addEventListener('click', () => { glass.fid = x.id; paint(); });
        t.addEventListener('keydown', e => { if (e.key === 'Enter') { glass.fid = x.id; paint(); } });
        return t;
      }))) : null;
    // Adding is right where the things are: three clear tiles lead the grid (a link, a file or PDF, a folder).
    const linkBox = h('div', { class: 'glass-add', hidden: !glass.adding }, icon('link'), (() => {
      const inp = h('input', { class: 'field-input sm glass-link-in', placeholder: 'Paste a link, then Enter', 'aria-label': `Add a link to ${f.name}`, inputmode: 'url' });
      inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Escape') { glass.adding = false; paint(); } if (e.key === 'Enter' && inp.value.trim()) { if (addLink(inp.value, f.id)) { inp.value = ''; toast(`Added to ${f.name}`); } } });
      inp.addEventListener('paste', () => setTimeout(() => { const v = inp.value.trim(); if (/^https?:\/\/\S+$/i.test(v) && addLink(v, f.id)) { inp.value = ''; toast(`Added to ${f.name}`); } }, 0));
      if (glass.adding) setTimeout(() => inp.focus(), 30);
      return inp;
    })());
    const tile = (ic, label, fn) => h('button', { class: 'glass-item glass-add-tile', type: 'button', onclick: fn }, h('span', { class: 'glass-icon add' }, icon(ic)), h('span', { class: 'glass-label' }, label));
    const grid = h('div', { class: 'glass-grid', dataset: { drop: 'link-list', accept: 'card', lfolder: f.id }, 'data-list': 'grid' },
      tile('link', 'Add link', () => { glass.adding = !glass.adding; paint(); }),
      tile('upload', 'Add file or PDF', () => fileIn.click()),
      tile('folder', 'New folder', () => addLinkFolder(f.id)),
      items.map(c => {
        const t = h('div', { class: 'glass-item', tabindex: 0, dataset: { drag: 'card', id: c.id }, title: c.meta?.url || c.title },
          h('span', { class: 'glass-icon' }, favicon(c)), h('span', { class: 'glass-label' }, c.title));
        t.addEventListener('click', () => previewItem(t, c.id));
        hoverPreview(t, c);
        t.addEventListener('keydown', e => { if (e.key === 'Enter') previewItem(t, c.id); });
        return t;
      }));
    if (!items.length && !subs.length) grid.append(h('p', { class: 'glass-empty' }, 'Empty. Add something above, or drop links and files here.'));
    const fileRow = h('div', { class: 'glass-section glass-files' }, subs.length ? h('span', { class: 'glass-section-label' }, icon('link'), `Links & files · ${items.length}`) : null, linkBox, grid);
    panel.replaceChildren(
      h('div', { class: 'glass-top' },
        parent ? h('button', { class: 'glass-back', type: 'button', onclick: () => { glass.fid = parent.id; paint(); } }, icon('chevL'), parent.name) : h('span'),
        h('div', { class: 'glass-top-right' },
          h('button', { class: 'glass-close', type: 'button', 'aria-label': 'Folder options', title: 'Move out, delete', onclick: e => {
            const item = (ic, label, fn, cls = '') => h('button', { class: `cm-item ${cls}`, type: 'button', onclick: ev => { ev.stopPropagation(); closePopovers(); fn(); } }, icon(ic), label);
            popover(e.currentTarget, h('div', { class: 'card-menu', role: 'menu' },
              parent ? item('chevL', `Move out of ${parent.name}`, () => { const to = lfById(parent.parentId) ? parent.parentId : null; saveLinkFolder(f.id, { parentId: to }); toast(`Moved ${f.name} to ${to ? lfById(to).name : 'My links'}`); }) : null,
              parent ? h('hr') : null,
              item('trash', 'Delete folder…', async () => {
                const ok = await confirmModal(`Delete “${f.name}”?`, 'What’s inside moves up a level, so nothing is lost. You can Undo right after.', 'Delete', true);
                if (ok) { const ff = lfById(glass?.fid); closeGlass(); if (ff) deleteLinkFolder(ff); }
              }, 'danger')), { className: 'card-menu-pop glass-menu-pop' });
          } }, icon('more')),
          h('button', { class: 'glass-close', type: 'button', 'aria-label': 'Close folder', onclick: () => closeGlass() }, icon('x')))),
      // The folder's icon sits by its name; click it to change it and see the new one right away.
      h('div', { class: 'glass-head' },
        h('button', { class: 'glass-emoji', type: 'button', title: 'Change icon', 'aria-label': 'Change folder icon', onclick: e => pickEmoji(e.currentTarget, v => saveLinkFolder(f.id, { emoji: v })) }, lfEmoji(f)),
        title),
      h('p', { class: 'glass-sub-line' }, `${lfCount(f)}${parent ? ` · in ${lfPath(parent)}` : ''}`),
      // While something is being dragged, this strip takes it back out a level.
      h('div', { class: 'glass-out', dataset: { drop: 'lf-out', accept: 'card lfolder', to: f.parentId && parent ? parent.id : '' } },
        icon('chevL'), `Drop here to move out to ${parent ? parent.name : 'My links'}`),
      h('div', { class: 'glass-scroll' }, folderRow, fileRow),
      fileIn);
  };
  glass = { fid, backdrop, paint, unsub: store.on(() => glass && paint()) };
  document.body.append(backdrop);
  paint();
  requestAnimationFrame(() => backdrop.classList.add('in'));
}
function closeGlass(instant = false) {
  if (!glass) return;
  const g = glass; glass = null;
  g.unsub?.();
  if (instant) { g.backdrop.remove(); return; }
  g.backdrop.classList.remove('in'); g.backdrop.classList.add('out');
  setTimeout(() => g.backdrop.remove(), 260);
}
document.addEventListener('keydown', e => { if (e.key === 'Escape' && glass && !document.querySelector('.popover, .modal-backdrop')) closeGlass(); });

function moveIntoLinkFolder(id, lfid, index) {
  const c = store.getCard(id);
  if (!c) return false;
  if (c.tool === 'brainly' && c.type === 'link') {
    store.updateCard(id, { meta: { linkFolderId: lfid } }, { silent: true });
  } else {
    const url = (`${c.title} ${flatten(c)}`.match(/https?:\/\/\S+/) || [])[0];
    const meta = { linkFolderId: lfid, ...(url ? { url, host: prettyUrl(url).host } : { file: true }) };
    routeCard(id, { tool: 'brainly', type: 'link', meta });
    if (c.tool === 'brainly') store.updateCard(id, { type: 'link', meta }, { replaceMeta: true, silent: true });
  }
  reorder(links(lfid), id, index);
}
registerDrop('link-list', ({ id, data, index }) => moveIntoLinkFolder(id, data.lfolder || null, index));
// Drop a link on a folder to file it; drop a folder on a folder to nest it.
registerDrop('lf-into', {
  hit: ({ kind, x, y, rect }) => kind !== 'lfolder' || (x > rect.left + rect.width * 0.22 && x < rect.right - rect.width * 0.22 && y > rect.top + rect.height * 0.2 && y < rect.bottom - rect.height * 0.2),
  accepts: ({ kind, id, data }) => kind !== 'lfolder' || (id !== data.into && !lfDescendants(id).includes(data.into)),
  drop: ({ kind, id, data }) => {
    if (kind === 'lfolder') { saveLinkFolder(id, { parentId: data.into }); toast(`Moved into ${lfById(data.into)?.name}`); return; }
    moveIntoLinkFolder(id, data.into, null);
    toast(`Filed in ${lfById(data.into)?.name}`);
  },
});
// SD-F5: folders reorder by drag, in the column and inside a glass folder. Dropping in the column's
// folder grid also takes a folder back to the top level.
registerDrop('lfolder-stack', ({ kind, id, data, index }) => {
  if (kind !== 'lfolder') return false;
  const parentId = data.parent || null;
  if (parentId && (parentId === id || lfDescendants(id).includes(parentId))) return false;
  const list = linkFolders();
  const moving = list.find(f => f.id === id);
  if (!moving) return false;
  const rest = list.filter(f => f.id !== id);
  const sibs = rest.filter(f => (f.parentId && lfById(f.parentId) ? f.parentId : null) === parentId);
  const before = sibs[index ?? sibs.length];
  const at = before ? rest.indexOf(before) : (sibs.length ? rest.indexOf(sibs.at(-1)) + 1 : rest.length);
  rest.splice(at, 0, { ...moving, parentId });
  store.set('linkFolders', rest);
  if ((moving.parentId || null) !== parentId) toast(`Moved ${moving.name} to ${parentId ? lfById(parentId)?.name : 'My links'}`);
});
// Out of a folder, one level up (the strip at the top of the glass folder).
registerDrop('lf-out', ({ kind, id, data }) => {
  const to = data.to || null;
  if (kind === 'lfolder') saveLinkFolder(id, { parentId: to });
  else moveIntoLinkFolder(id, to, null);
  toast(`Moved out to ${to ? lfById(to)?.name : 'My links'}`);
});

function addLink(raw, lfid = null) {
  let url = raw.trim();
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  // A real web address: no spaces, and a host with a dot (or localhost).
  let ok = false;
  try { const u = new URL(url); ok = !/\s/.test(raw.trim()) && /^https?:$/.test(u.protocol) && (u.hostname.includes('.') || u.hostname === 'localhost'); } catch {}
  if (!ok) { toast('That doesn’t look like a link. To save a thought, add a note instead.'); return false; }
  const { host, title } = prettyUrl(url);
  store.createCard({ type: 'link', tool: 'brainly', title, description: url, meta: { url, host, linkFolderId: lfid, order: links(lfid).length } });
  return true;
}
async function addTextFile(file, lfid = null) {
  const text = await file.text();
  store.createCard({ type: 'link', tool: 'brainly', title: file.name.replace(/\.[^.]+$/, ''), description: text, meta: { file: true, linkFolderId: lfid, order: links(lfid).length } });
  toast(`Added ${file.name}`);
}
/** Any file: PDFs and text open in Sedi; everything else is kept on this device and opens in its own app. */
async function addUpload(file, lfid = null) {
  if (!file) return;
  if (file.size > MAX_UPLOAD) return toast(`“${file.name}” is ${fmtSize(file.size)}. The upload limit is 25 MB per file.`, { code: 'UPLOAD_TOO_LARGE' });
  if (/\.pdf$/i.test(file.name) || file.type === 'application/pdf') return addPdf(file, lfid);
  if ((/\.(txt|md|markdown)$/i.test(file.name) || file.type === 'text/plain' || file.type === 'text/markdown') && file.size <= 2e6) return addTextFile(file, lfid);
  const fileId = uuid();
  try { await store.putFile(fileId, file); } catch { return toast('Couldn’t save that file on this device. It may be out of space.', { code: 'STORAGE_FULL' }); }
  store.createCard({ type: 'link', tool: 'brainly', title: file.name.replace(/\.[^.]+$/, ''), description: '',
    meta: { upload: { fileId, name: file.name, size: file.size, type: file.type || '' }, linkFolderId: lfid, order: links(lfid).length } });
  toast(`Added ${file.name}`);
}
// Files only open in a tab when they're a type the browser shows safely (PDF, images, plain text),
// re-wrapped with that exact type. Anything else (HTML, SVG…) downloads instead, so it can never run as Sedi.
const VIEWABLE = new Set(['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'text/plain']);
async function openUpload(up, download = false) {
  const blob = await store.getFile(up.fileId);
  if (!blob) return toast('That file isn’t on this device any more.');
  const viewable = !download && VIEWABLE.has(blob.type);
  const url = URL.createObjectURL(new Blob([blob], { type: viewable ? blob.type : 'application/octet-stream' }));
  const a = h('a', { href: url, target: '_blank', rel: 'noopener', ...(viewable ? {} : { download: up.name || 'file' }) });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60e3);
}
/** SD-F2: PDFs are saved on this device and included in Download data. */
async function addPdf(file, lfid) {
  if (!file) return;
  if (file.size > MAX_PDF) return toast(`${file.name} is over 25 MB. Smaller PDFs only, please.`, { code: 'UPLOAD_TOO_LARGE' });
  const fileId = uuid();
  try { await store.putFile(fileId, file); } catch { return toast('Couldn’t save that PDF on this device.'); }
  store.createCard({ type: 'link', tool: 'brainly', title: file.name.replace(/\.pdf$/i, ''), description: '', meta: { pdf: { fileId, name: file.name, size: file.size }, linkFolderId: lfid, order: links(lfid).length } });
  toast(`Added ${file.name}`);
}
function setupFileDrop() {
  dash.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/uri-list')) { e.preventDefault(); dash.classList.add('drop-over'); } });
  dash.addEventListener('dragleave', e => { if (!dash.contains(e.relatedTarget)) dash.classList.remove('drop-over'); });
  dash.addEventListener('drop', e => {
    e.preventDefault(); dash.classList.remove('drop-over');
    const target = e.target.closest('.lf-tile')?.dataset.id || null;
    const all = [...e.dataTransfer.files];
    all.forEach(f => addUpload(f, target));
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!all.length && /^https?:\/\//i.test(uri?.trim() || '')) addLink(uri.trim().split('\n')[0]);
  });
}
function saveLinkFolder(id, patch) { store.set('linkFolders', linkFolders().map(x => (x.id === id ? { ...x, ...patch } : x))); }
function addLinkFolder(parentId = null) {
  const f = { id: uuid(), name: 'New folder', ...(parentId ? { parentId } : {}) };
  store.set('linkFolders', [...linkFolders(), f]);
  if (parentId) { toast('Folder added. Click it to rename or fill it.'); return; }
  // Open the new folder right away with its name selected, ready to type.
  setTimeout(() => { const tile = dash.querySelector(`.lf-tile[data-id="${f.id}"]`); openLinkFolder(f.id, tile); setTimeout(() => { const t = document.querySelector('.glass-title'); t?.focus(); t?.select(); }, 280); }, 60);
}
export function deleteLinkFolder(f) {
  const up = f.parentId && lfById(f.parentId) ? f.parentId : null;
  const moved = links(f.id);
  moved.forEach(c => store.updateCard(c.id, { meta: { linkFolderId: up } }, { silent: true }));
  const prev = linkFolders();
  store.set('linkFolders', prev.filter(x => x.id !== f.id).map(x => (x.parentId === f.id ? { ...x, parentId: up } : x)));
  const where = up ? lfById(up)?.name : 'My links';
  toast(`Removed folder ${f.name}${moved.length || lfChildren(f.id).length ? `. What was inside moved to ${where}.` : ''}`, {
    action: 'Undo', onAction: () => { store.set('linkFolders', prev); moved.forEach(c => store.updateCard(c.id, { meta: { linkFolderId: f.id } }, { silent: true })); store.notify(); },
  });
}
export function trashLinkFolder(id) { const f = linkFolders().find(x => x.id === id); if (f) deleteLinkFolder(f); }

/** SD-F4 / SD-L3 / SD-A3: preview one link, PDF or text file. */
function previewItem(anchor, id) {
  const c = store.getCard(id);
  if (!c) return;
  const m = c.meta || {};
  const kind = kindOf(c);
  const title = h('input', { class: 'field-input sm', value: c.title, 'aria-label': 'Title' });
  withMic(title, { label: 'Dictate the title', subtle: true });
  title.addEventListener('change', () => title.value.trim() && store.updateCard(id, { title: title.value.trim() }, { log: true }));
  title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') title.blur(); });
  const rows = [];
  if (kind === 'link') {
    rows.push(h('div', { class: 'peek-url' }, m.url),
      h('div', { class: 'peek-actions' },
        h('a', { class: 'btn sm primary', href: safeUrl(m.url), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open link'),
        h('button', { class: 'chip', onclick: () => { closePopovers(); openMoveDialog(id); } }, icon('move'), 'Move to…')),
      h('label', { class: 'peek-toggle' },
        h('input', { type: 'checkbox', checked: linkPreviewsOn(), onchange: e => store.setPref('linkPreviews', e.target.checked) }),
        h('span', {}, h('b', {}, 'Page previews on hover. '), 'Shows a picture of the page when you hover a link. Uses WordPress.com’s screenshot service, which sees the link’s address (never your notes).')));
  } else if (kind === 'pdf') {
    const drive = h('input', { class: 'field-input sm', value: m.driveUrl || '', placeholder: 'Paste a Google Drive link', 'aria-label': 'Google Drive link' });
    drive.addEventListener('change', () => store.updateCard(id, { meta: { driveUrl: drive.value.trim() || null } }, { log: true, logLabel: 'Linked to Google Drive' }));
    drive.addEventListener('keydown', e => e.stopPropagation());
    const status = h('span', { class: 'muted small' });
    rows.push(h('div', { class: 'muted small' }, `${m.pdf.name} · ${fmtSize(m.pdf.size || 0)} · saved on this device`),
      h('div', { class: 'peek-actions' },
        h('button', { class: 'btn sm primary', onclick: () => openPdf(m.pdf) }, icon('external'), 'Open PDF'),
        h('button', { class: 'chip', onclick: () => { closePopovers(); openMoveDialog(id); } }, icon('move'), 'Move to…'),
        safeUrl(m.driveUrl) ? h('a', { class: 'chip', href: safeUrl(m.driveUrl), target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open in Drive')
          : h('button', { class: 'chip', onclick: async () => {
            status.textContent = 'Uploading to Google Drive…';
            try { const blob = await store.getFile(m.pdf.fileId); const url = await google.uploadToDrive(m.pdf.name, blob); store.updateCard(id, { meta: { driveUrl: url } }, { log: true, logLabel: 'Saved to Google Drive' }); status.textContent = 'Saved to Drive.'; }
            catch (err) { status.textContent = err.message; }
          } }, icon('upload'), 'Save to Google Drive')),
      h('label', { class: 'field-label' }, 'Google Drive link'), drive, status);
  } else if (kind === 'upload') {
    const up = m.upload;
    const [k] = fileKind(up);
    const media = h('div', { class: 'peek-media' });
    if (k === 'image') store.getFile(up.fileId).then(blob => { if (blob) media.append(h('img', { src: URL.createObjectURL(blob), alt: up.name })); });
    rows.push(media, h('div', { class: 'muted small' }, `${up.name} · ${fmtSize(up.size || 0)} · saved on this device`),
      h('div', { class: 'peek-actions' },
        h('button', { class: 'btn sm primary', onclick: () => openUpload(up) }, icon('external'), 'Open'),
        h('button', { class: 'chip', onclick: () => openUpload(up, true) }, icon('download'), 'Download'),
        h('button', { class: 'chip', onclick: () => { closePopovers(); openMoveDialog(id); } }, icon('move'), 'Move to…')));
  } else {
    rows.push(h('div', { class: 'peek-text' }, (c.description || '').slice(0, 700) || 'Empty file.'),
      h('div', { class: 'peek-actions' }, h('button', { class: 'chip', onclick: () => { closePopovers(); openEditor(id, { title: 'Text file' }); } }, icon('pencil'), 'Open'),
        h('button', { class: 'chip', onclick: () => { closePopovers(); openMoveDialog(id); } }, icon('move'), 'Move to…')));
  }
  const taskName = taskTitleFor(c);
  rows.push(h('div', { class: 'peek-task' },
    h('button', { class: 'chip task-chip', title: `Adds “${taskName}” to To do in Taskly`, onclick: () => { closePopovers(); makeTaskFrom(c); } }, icon('checklist'), 'Make a task'),
    h('span', { class: 'muted small' }, `“${taskName}”`)));
  popover(anchor, h('div', { class: 'item-peek' }, h('div', { class: 'item-peek-head' }, favicon(c), title), ...rows), { className: 'item-peek-pop' });
}
/** A task named for the thing: PDFs and files get reviewed, links get read. */
function taskTitleFor(c) {
  const kind = kindOf(c);
  const name = (c.title || c.meta?.host || 'this').trim();
  return kind === 'link' ? `Read article from ${name}` : `Review ${name}`;
}
function makeTaskFrom(c) {
  const m = c.meta || {};
  const description = m.url || (m.pdf ? `PDF in Brainly: ${m.pdf.name}` : m.upload ? `File in Brainly: ${m.upload.name}` : `From Brainly: ${c.title}`);
  const t = addTaskFrom({ title: taskTitleFor(c), description, meta: { fromCardId: c.id, ...(m.url ? { url: m.url } : {}) } });
  if (!t) return;
  toast(`Added to Taskly: ${t.title}`, { action: 'Show', onAction: () => revealCard(t.id) });
}
async function openPdf(pdf) {
  const blob = await store.getFile(pdf.fileId);
  if (!blob) return toast('That PDF isn’t on this device any more.');
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
  const w = window.open(url, '_blank', 'noopener');
  if (!w) {
    const a = h('a', { href: url, target: '_blank', rel: 'noopener' });
    document.body.append(a); a.click(); a.remove();
  }
  setTimeout(() => URL.revokeObjectURL(url), 60e3);
}

// ---------- Canvas: notes (rounded squares) + folders ----------
function renderCanvas() {
  hidePeek();
  const q = query();
  const cw = canvas.clientWidth || 900, ch = canvas.clientHeight || 600;
  const place = (el, x, y, w, hh) => { el.style.left = clamp(x ?? 24, 8, Math.max(8, cw - w - 8)) + 'px'; el.style.top = clamp(y ?? 24, 8, Math.max(8, ch - hh - 8)) + 'px'; return el; };
  const nodes = [
    ...topFolders().filter(f => folderMatches(f, q)).map(f => place(folderEl(f), f.x, f.y, FOLDER_W, FOLDER_H)),
    ...canvasNotes().filter(c => matches(c, q)).map(c => place(noteEl(c), c.meta?.x, c.meta?.y, NOTE, NOTE)),
  ];
  canvas.replaceChildren(...nodes);
  if (!nodes.length) canvas.append(h('div', { class: 'canvas-empty' }, q ? 'Nothing here matches.' : 'Start a note or a folder. Drag notes onto folders to file them.'));
}

function noteEl(c) {
  const emoji = h('button', { class: 'note-emoji', 'aria-label': 'Change emoji', title: 'Change emoji', onclick: e => { e.stopPropagation(); pickEmoji(e.currentTarget, v => store.updateCard(c.id, { meta: { emoji: v } })); } }, c.meta?.emoji || smartEmoji(c.title));
  // The first line and the last edit show only in the phone list (styles hide them on the desktop canvas).
  const snip = stripHtml(c.description || '').replace(/\s+/g, ' ').trim().slice(0, 140);
  const el = h('article', { class: 'b-note', dataset: { drag: 'card', id: c.id }, tabindex: 0, 'aria-label': c.title, style: { '--note': noteColor(c) } },
    emoji, h('span', { class: 'b-note-title' }, c.title),
    h('span', { class: 'b-note-snip' }, snip), h('span', { class: 'b-note-when' }, relTime(c.updatedAt)));
  // Duplicate on hover: the quickest way to start a new note from an old one.
  cardChrome(el, c, () => openNote(c.id), { onDuplicate: nid => { hidePeek(); duplicateNote(nid); } });
  el.removeAttribute('title');
  el.addEventListener('click', e => { if (e.sediOpened) return; if (!e.target.closest('button')) { hidePeek(); openNote(c.id); } });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) openNote(c.id); });
  el.addEventListener('pointerenter', () => showPeek(el, c.id));
  el.addEventListener('pointerleave', hidePeek);
  return el;
}

const folderEmoji = f => f.emoji || mostCommonEmoji(folderNotes(f.id).map(n => `${n.title} ${stripHtml(n.description)}`), '🗂️');
function folderEl(f) {
  const notes = folderNotes(f.id);
  const subs = childFolders(f.id);
  const emoji = folderEmoji(f);
  const name = h('span', { class: 'bf-name' }, f.name);
  name.addEventListener('dblclick', e => { e.stopPropagation(); editInline(name, { onCommit: v => saveFolder(f.id, { name: v }) }); });
  const count = [notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '', subs.length ? `${subs.length} folder${subs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ') || 'Empty';
  const el = h('div', {
    class: 'b-folder', tabindex: 0, style: { '--folder': f.color || '#A796CB' },
    dataset: { drag: 'bfolder', id: f.id, drop: 'brainly-folder', accept: 'card bfolder', folder: f.id },
  },
  h('div', { class: 'bf-tab' }),
  h('div', { class: 'bf-body' },
    h('button', { class: 'bf-emoji', 'aria-label': 'Change folder emoji', title: 'Change emoji', onclick: e => { e.stopPropagation(); pickEmoji(e.currentTarget, v => saveFolder(f.id, { emoji: v })); } }, emoji),
    name,
    notes.length || subs.length ? dotsRow([...subs.map(s => ({ folder: true, name: s.name, color: s.color })), ...notes]) : null,
    h('span', { class: 'bf-count' }, count)),
  h('button', { class: 'bf-color', 'aria-label': 'Folder color', style: { background: f.color || '#A796CB' }, onclick: e => { e.stopPropagation(); pickFolderColor(e.currentTarget, f); } }));
  el.addEventListener('click', e => { if (!e.target.closest('button') && !name.isContentEditable) openFolder(f.id); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) openFolder(f.id); });
  return el;
}

// ---------- Hover preview with summary (SD-V2, SD-I2) ----------
let peekTimer = null;
function showPeek(anchor, id) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (document.body.classList.contains('is-dragging') || !anchor.isConnected) return;
    const c = store.getCard(id);
    if (!c) return;
    hidePeek(false);
    const text = h('p', { class: 'note-peek-text' });
    const label = h('span', { class: 'note-peek-label' });
    const paint = s => { text.textContent = s.text; label.textContent = s.ai ? `AI summary · ${s.engine}` : 'Summary'; };
    paint(summaryFor(c));
    peekEl = h('div', { class: 'note-peek', role: 'tooltip' },
      h('span', { class: 'note-peek-swatch', style: { background: noteColor(c) } }),
      h('strong', {}, `${c.meta?.emoji || smartEmoji(c.title)} ${c.title}`), label, text,
      h('span', { class: 'muted small' }, 'Click to open the whole note'));
    document.body.append(peekEl);
    const r = anchor.getBoundingClientRect(), pr = peekEl.getBoundingClientRect();
    let left = r.right + 10;
    if (left + pr.width > innerWidth - 12) left = r.left - pr.width - 10;
    peekEl.style.left = Math.max(12, left) + 'px';
    peekEl.style.top = clamp(r.top, 12, innerHeight - pr.height - 12) + 'px';
    const mine = peekEl;
    ensureSummary(c).then(s => { if (peekEl === mine && s) paint(s); });
  }, 260);
}
// ---------- Website previews on hover (opt-in) ----------
// A browser app can't load another site's page itself, so the picture comes from WordPress.com's free
// screenshot service (mShots). That sends the link's address to WordPress.com, so it's off until you turn it on.
export const linkPreviewsOn = () => store.pref('linkPreviews') === true;
const shotUrl = (url, retry = 0) => `https://s0.wp.com/mshots/v1/${encodeURIComponent(url)}?w=640&h=400${retry ? `&r=${retry}` : ''}`;
function hoverPreview(el, c) {
  if (kindOf(c) !== 'link' || !safeUrl(c.meta?.url) || !/^https?:/.test(c.meta.url)) return;
  el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') showLinkPeek(el, c.id); });
  el.addEventListener('pointerleave', hidePeek);
  el.addEventListener('pointerdown', hidePeek);
}
function showLinkPeek(anchor, id) {
  clearTimeout(peekTimer);
  peekTimer = setTimeout(() => {
    if (document.body.classList.contains('is-dragging') || !anchor.isConnected || document.querySelector('.popover')) return;
    const c = store.getCard(id);
    if (!c) return;
    hidePeek();
    const m = c.meta || {};
    let shot = null;
    if (linkPreviewsOn()) {
      const img = h('img', { alt: '', referrerpolicy: 'no-referrer', src: shotUrl(m.url) });
      shot = h('div', { class: 'link-shot loading' }, img, h('span', { class: 'link-shot-wait' }, 'Loading preview…'));
      let tries = 0;
      // The service answers with a "generating" placeholder the first time it sees a page; ask again shortly.
      img.addEventListener('load', () => {
        if (img.naturalWidth && img.naturalWidth < 600 && tries < 3) { tries++; setTimeout(() => { if (img.isConnected) img.src = shotUrl(m.url, Date.now()); }, 1800); return; }
        shot.classList.remove('loading');
      });
      img.addEventListener('error', () => shot.replaceWith(h('p', { class: 'muted small' }, 'No preview for this page.')));
    }
    peekEl = h('div', { class: 'note-peek link-peek', role: 'tooltip' },
      shot,
      h('strong', {}, c.title),
      h('span', { class: 'link-peek-host' }, m.host || ''),
      h('span', { class: 'muted small' }, linkPreviewsOn() ? 'Click for options, or open the link' : 'Click for options. Page previews are off (turn them on there).'));
    document.body.append(peekEl);
    const r = anchor.getBoundingClientRect(), pr = peekEl.getBoundingClientRect();
    let left = r.right + 10;
    if (left + pr.width > innerWidth - 12) left = r.left - pr.width - 10;
    peekEl.style.left = Math.max(12, left) + 'px';
    peekEl.style.top = clamp(r.top, 12, innerHeight - pr.height - 12) + 'px';
  }, 350);
}
function hidePeek() { clearTimeout(peekTimer); peekEl?.remove(); peekEl = null; }
onDragStart(() => hidePeek());

// ---------- Drops ----------
registerDrop('brainly-canvas', ({ kind, id, left, top, zone }) => {
  if (kind === 'bfolder') {
    if (listMode()) return false;
    saveFolder(id, { x: clamp(Math.round(left), 8, zone.clientWidth - FOLDER_W - 8), y: clamp(Math.round(top), 8, zone.clientHeight - FOLDER_H - 8), parentId: null });
    return;
  }
  const c = store.getCard(id);
  if (!c) return false;
  if (listMode() && c.tool === 'brainly' && c.type !== 'link' && !c.meta?.folderId) return false; // phones list notes; keep desktop positions
  const x = clamp(Math.round(left), 8, zone.clientWidth - NOTE - 8), y = clamp(Math.round(top), 8, zone.clientHeight - NOTE - 8);
  if (c.tool === 'brainly' && c.type !== 'link') store.updateCard(id, { meta: { x, y, folderId: null } }, { log: !!c.meta?.folderId, logLabel: 'Moved out of folder' });
  else {
    routeCard(id, { tool: 'brainly', type: 'note', meta: { x, y, emoji: smartEmoji(c.title) } });
    if (c.tool === 'brainly') store.updateCard(id, { type: 'note', meta: { x, y, emoji: smartEmoji(c.title) } }, { replaceMeta: true });
  }
});
registerDrop('brainly-folder', {
  // SD-V4: a folder can go inside another folder, but never inside itself.
  accepts: ({ kind, id, data }) => kind !== 'bfolder' || (id !== data.folder && !descendants(id).includes(data.folder)),
  drop: ({ kind, id, data }) => {
    const f = folderById(data.folder);
    if (kind === 'bfolder') {
      saveFolder(id, { parentId: data.folder });
      toast(`Moved ${folderById(id)?.name} into ${f?.name}`, { action: 'Undo', onAction: () => saveFolder(id, { parentId: null }) });
      return;
    }
    const c = store.getCard(id);
    if (!c) return false;
    if (c.tool === 'brainly' && c.type !== 'link') store.updateCard(id, { meta: { folderId: data.folder } }, { log: true, logLabel: `Filed in ${f?.name}` });
    else {
      routeCard(id, { tool: 'brainly', type: 'note', meta: { folderId: data.folder, emoji: smartEmoji(c.title) } });
      if (c.tool === 'brainly') store.updateCard(id, { type: 'note', meta: { folderId: data.folder } }, { replaceMeta: true });
    }
    toast(`Filed in ${f?.name || 'folder'}`);
  },
});

// SD-V1: notes dragged out of an open folder window: the window fades so the canvas can take the drop.
let throughBackdrop = null;
onDragStart(d => {
  const bd = d.el.closest('.modal-backdrop');
  if (bd && d.el.closest('.folder-view')) { throughBackdrop = bd; bd.classList.add('drag-through'); }
});
onDragEnd(snap => {
  if (!throughBackdrop) return;
  const bd = throughBackdrop;
  throughBackdrop = null;
  bd.classList.remove('drag-through');
  if (snap.accepted) bd.querySelector('.modal-head .icon-btn')?.click();
});

// SD-A1: ⌘D / Ctrl D duplicates the note or folder under the pointer.
document.addEventListener('keydown', e => {
  if (!canvas?.isConnected || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'd' || !hovered?.isConnected) return;
  const t = e.target;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  e.preventDefault();
  if (hovered.classList.contains('b-note')) duplicateNote(hovered.dataset.id);
  else duplicateFolder(hovered.dataset.id);
});

// ---------- Mutations ----------
function saveFolder(id, patch) { store.set('brainFolders', folders().map(f => (f.id === id ? { ...f, ...patch } : f))); }
/** The first grid cell that nothing (note or folder) already covers. */
function freeSpot() {
  const taken = [...canvasNotes().map(c => c.meta || {}), ...topFolders()].filter(p => p.x != null && p.y != null);
  const cols = Math.max(1, Math.floor(((canvas?.clientWidth || 800) - 32) / 160));
  for (let i = 0; i < 400; i++) {
    const x = 24 + (i % cols) * 156, y = 24 + Math.floor(i / cols) * 150;
    if (!taken.some(p => Math.abs(p.x - x) < 140 && Math.abs(p.y - y) < 130)) return { x, y };
  }
  return { x: 24, y: 24 };
}
function addNote(folderId = null) {
  const card = store.createCard({ type: 'note', tool: 'brainly', title: 'Untitled note', description: '', meta: { ...(folderId ? {} : freeSpot()), emoji: '📝', folderId } });
  openNote(card.id, true);
}
function addFolder(parentId = null) {
  const f = { id: uuid(), name: 'New folder', color: ['#A796CB', '#8E9BC9', '#86AE95', '#C9A46E', '#C98E8E'][folders().length % 5], ...(parentId ? { parentId } : freeSpot()) };
  store.set('brainFolders', [...folders(), f]);
  if (!parentId) setTimeout(() => { const n = canvas.querySelector(`[data-folder="${f.id}"] .bf-name`); if (n) editInline(n, { onCommit: v => saveFolder(f.id, { name: v }) }); }, 60);
  return f;
}
export function duplicateNote(id) {
  const c = store.getCard(id);
  if (!c) return;
  const { summary, summaryOf, summaryBy, ...meta } = c.meta || {};
  void summary; void summaryOf; void summaryBy;
  const copy = store.createCard({ type: 'note', tool: 'brainly', title: `${c.title} copy`, description: c.description, meta: { ...meta, ...(meta.folderId ? {} : { x: (meta.x ?? 24) + 26, y: (meta.y ?? 24) + 26 }) } });
  landed(copy.id);
  toast(`Duplicated “${c.title}”`, { action: 'Undo', onAction: () => store.deleteCard(copy.id) });
  return copy;
}
function duplicateFolder(fid) {
  const created = [];
  const copyTree = (src, parentId, top) => {
    const nf = { ...src, id: uuid(), name: top ? `${src.name} copy` : src.name, parentId, ...(top && !parentId ? freeSpot() : {}) };
    created.push(nf);
    store.set('brainFolders', [...folders(), nf], { silent: true });
    folderNotes(src.id).forEach(n => store.createCard({ type: 'note', tool: 'brainly', title: n.title, description: n.description, meta: { ...n.meta, folderId: nf.id } }, { silent: true }));
    childFolders(src.id).filter(x => !created.includes(x)).forEach(ch => copyTree(ch, nf.id, false));
  };
  const src = folderById(fid);
  if (!src) return;
  copyTree(src, src.parentId || null, true);
  store.notify({ reason: 'duplicate-folder' });
  toast(`Duplicated ${src.name}`);
}
export function trashFolder(id) {
  const f = folderById(id);
  if (!f) return;
  const ids = [id, ...descendants(id)];
  const notes = store.cardsWhere(c => c.tool === 'brainly' && ids.includes(c.meta?.folderId));
  const prev = folders();
  notes.forEach(n => store.deleteCard(n.id, { silent: true }));
  store.set('brainFolders', prev.filter(x => !ids.includes(x.id)));
  crunch();
  const extra = [notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : '', ids.length > 1 ? `${ids.length - 1} folder${ids.length === 2 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  toast(`Deleted ${f.name}${extra ? ` with ${extra}` : ''}`, {
    action: 'Undo', onAction: () => { store.set('brainFolders', prev); notes.forEach(n => store.restoreCard(n)); },
  });
}
/** Copy formatted text right now (inside the click), so it lands on the clipboard before anything else takes focus. */
function copyNow(html, plain) {
  const box = h('div', { contenteditable: 'true', 'aria-hidden': 'true', style: { position: 'fixed', left: '-9999px', top: '0', whiteSpace: 'pre-wrap' } });
  box.innerHTML = html; // already sanitized above: the title is escaped and the body passes sanitize()
  document.body.append(box);
  const sel = getSelection(), saved = sel.rangeCount ? sel.getRangeAt(0) : null;
  const range = document.createRange(); range.selectNodeContents(box);
  sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  const onCopy = e => { if (!e.clipboardData) return; e.clipboardData.setData('text/html', html); e.clipboardData.setData('text/plain', plain); e.preventDefault(); };
  document.addEventListener('copy', onCopy, { once: true });
  try { ok = document.execCommand('copy'); } catch {}
  document.removeEventListener('copy', onCopy);
  sel.removeAllRanges(); if (saved) sel.addRange(saved);
  box.remove();
  return ok;
}
// Folder colors: a wide, calm palette, plus "Custom" for any color at all.
export const FOLDER_COLORS = ['#A796CB', '#8E9BC9', '#7FA3D6', '#7FAEBE', '#6FB5A8', '#86AE95', '#9DB86F', '#C9B85E', '#C9A46E', '#D99A6C', '#C98E8E', '#D98C9F', '#D1A0B8', '#B48CC9', '#9AA3AD', '#7C8591'];
function pickFolderColor(anchor, f, save = col => saveFolder(f.id, { color: col })) {
  popover(anchor, colorGrid(FOLDER_COLORS, f.color, col => { save(col); closePopovers(); }));
}
/** A grid of swatches plus a Custom swatch that opens the system color picker. */
export function colorGrid(colors, current, onPick, { size = '' } = {}) {
  const custom = h('input', { type: 'color', class: 'swatch-custom-input', value: /^#[0-9a-f]{6}$/i.test(current || '') ? current : '#a796cb', 'aria-label': 'Pick any color' });
  custom.addEventListener('change', () => onPick(custom.value));
  const isCustom = current && !colors.some(c => c.toLowerCase() === current.toLowerCase());
  return h('div', { class: `swatches wide ${size}` },
    colors.map(col => h('button', { class: `swatch ${size} ${col.toLowerCase() === (current || '').toLowerCase() ? 'on' : ''}`, type: 'button', style: { background: col }, 'aria-label': `Use color ${col}`, onclick: () => onPick(col) })),
    h('label', { class: `swatch swatch-custom ${size} ${isCustom ? 'on' : ''}`, title: 'Custom color', style: isCustom ? { background: current } : {} }, custom));
}

/** A folder's window: sub-folders, notes as squares (drag them out), and actions. */
function openFolder(fid) {
  const box = h('div', { class: 'folder-view' });
  let m;
  // The folder's own menu: the less-used actions live here, so the window itself stays calm.
  const folderMenu = (anchor, f) => {
    const item = (ic, label, fn, cls = '') => h('button', { class: `cm-item ${cls}`, type: 'button', onclick: e => { e.stopPropagation(); closePopovers(); fn(e); } }, icon(ic), label);
    popover(anchor, h('div', { class: 'card-menu', role: 'menu' },
      item('copy', 'Duplicate folder', () => duplicateFolder(fid)),
      item('palette', 'Change color', () => pickFolderColor(anchor, folderById(fid) || f)),
      h('hr'),
      item('trash', 'Delete folder…', async () => {
        const n = folderNotes(fid).length + childFolders(fid).length;
        const ok = await confirmModal(`Delete “${f.name}”?`, n ? `It holds ${n} item${n === 1 ? '' : 's'}; they’ll be deleted too. You can Undo right after.` : 'You can Undo right after.', 'Delete', true);
        if (ok) { m?.close(); trashFolder(fid); }
      }, 'danger')), { className: 'card-menu-pop' });
  };
  const fill = () => {
    const f = folderById(fid);
    if (!f) { m?.close(); return; }
    const path = [];
    for (let p = f.parentId ? folderById(f.parentId) : null; p; p = folderById(p.parentId)) path.unshift(p);
    const subs = childFolders(fid);
    const notes = folderNotes(fid).sort((a, b2) => b2.updatedAt.localeCompare(a.updatedAt));
    // The name is editable right here.
    const name = h('input', { class: 'fv-name', value: f.name, 'aria-label': 'Folder name', spellcheck: false });
    name.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') name.blur(); if (e.key === 'Escape') { name.value = f.name; name.blur(); } });
    name.addEventListener('change', () => { const v = name.value.trim(); if (v && v !== f.name) saveFolder(fid, { name: v }); });
    const newFolderTile = h('button', { class: 'fv-folder fv-new-folder', type: 'button', onclick: () => addFolder(fid) }, h('span', { class: 'fv-plus' }, '+'), h('span', {}, 'New folder'));
    box.replaceChildren(...[
      path.length ? h('div', { class: 'crumbs fv-crumbs' }, path.flatMap((p, i) => [i ? h('span', { class: 'muted' }, ' › ') : null, h('button', { class: 'crumb', onclick: () => { m.close(); openFolder(p.id); } }, p.name)]).filter(Boolean), h('span', { class: 'muted' }, ' ›')) : null,
      h('div', { class: 'fv-head' },
        h('button', { class: 'fv-emoji', type: 'button', title: 'Change icon', 'aria-label': 'Change folder icon', onclick: e => pickEmoji(e.currentTarget, v => saveFolder(fid, { emoji: v })) }, folderEmoji(f)),
        name,
        h('span', { class: 'head-spacer' }),
        h('button', { class: 'icon-btn sm fv-more', type: 'button', 'aria-label': 'Folder options', title: 'Duplicate, color, delete', onclick: e => folderMenu(e.currentTarget, f) }, icon('more'))),
      h('div', { class: 'fv-section' }, h('h4', { class: 'list-sub' }, subs.length ? `Folders · ${subs.length}` : 'Folders'),
        h('div', { class: 'fv-folders' }, newFolderTile, ...subs.map(sf => h('div', { class: 'fv-folder', style: { '--folder': sf.color || '#A796CB' } },
          h('button', { class: 'fv-folder-open', onclick: () => { m.close(); openFolder(sf.id); } }, h('span', { class: 'bf-emoji' }, folderEmoji(sf)), h('span', {}, sf.name), dotsRow([...childFolders(sf.id).map(x => ({ folder: true, name: x.name, color: x.color })), ...folderNotes(sf.id)])),
          h('button', { class: 'chip ghost', title: 'Move this folder out onto the canvas', onclick: () => saveFolder(sf.id, { parentId: null, ...freeSpot() }) }, 'Move out'))))),
      h('div', { class: 'fv-section' }, h('h4', { class: 'list-sub' }, notes.length ? `Notes · ${notes.length} · drag one out to move it` : 'Notes'),
        h('div', { class: 'fv-notes' }, newNoteTile(), ...notes.map(n => {
          const el = h('article', { class: 'b-note in-folder', dataset: { drag: 'card', id: n.id }, tabindex: 0, style: { '--note': noteColor(n) } },
            h('span', { class: 'note-emoji static' }, n.meta?.emoji || '📝'), h('span', { class: 'b-note-title' }, n.title));
          el.addEventListener('click', () => { hidePeek(); openNote(n.id); });
          el.addEventListener('pointerenter', () => showPeek(el, n.id));
          el.addEventListener('pointerleave', hidePeek);
          return el;
        })))].filter(Boolean));
    // "+ New note" sits first among the notes, the same way "+ New folder" leads the folders.
    function newNoteTile() { return h('button', { class: 'b-note in-folder fv-new-note', type: 'button', onclick: () => addNote(fid) }, h('span', { class: 'note-emoji static' }, '+'), h('span', { class: 'b-note-title' }, 'New note')); }
  };
  fill();
  const unsub = store.on(() => { if (!box.contains(document.activeElement) || document.activeElement?.tagName !== 'INPUT') fill(); });
  m = modal({ title: 'Folder', body: box, wide: true, className: 'folder-modal', onClose: () => { unsub(); hidePeek(); } });
}

// ---------- Note editor: rich text, dictation, colour, linked docs ----------
const ALLOWED = new Set(['B', 'STRONG', 'I', 'EM', 'U', 'H3', 'H4', 'UL', 'OL', 'LI', 'P', 'BR', 'DIV', 'BLOCKQUOTE']);
function sanitize(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const walk = node => {
    for (const ch of [...node.childNodes]) {
      if (ch.nodeType === 1) {
        if (!ALLOWED.has(ch.tagName)) { ch.replaceWith(...ch.childNodes); walk(node); return; }
        [...ch.attributes].forEach(a => ch.removeAttribute(a.name));
        walk(ch);
      } else if (ch.nodeType !== 3) ch.remove();
    }
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
const DOC_KINDS = { gdoc: { label: 'Google Doc', test: /docs\.google\.com\/document/ }, gdrive: { label: 'Google Drive', test: /drive\.google\.com/ }, applenotes: { label: 'Apple Notes', test: /icloud\.com\/notes|^applenotes:|^mobilenotes:/ } };
const docKind = url => Object.entries(DOC_KINDS).find(([, v]) => v.test.test(url))?.[0] || 'link';

export function openNote(id, isNew = false) {
  const c = store.getCard(id);
  if (!c) return;
  const title = h('input', { class: 'field-input title-input', value: isNew ? '' : c.title, placeholder: 'Title', 'aria-label': 'Note title', 'data-navoro-id': 'note.title' });
  withMic(title, { label: 'Dictate the title', subtle: true });
  const emojiBtn = h('button', { class: 'note-emoji lg', 'aria-label': 'Change emoji', onclick: e => pickEmoji(e.currentTarget, v => { store.updateCard(id, { meta: { emoji: v } }); emojiBtn.textContent = v; }) }, c.meta?.emoji || smartEmoji(c.title));
  const editor = h('div', { class: 'rich-editor', contenteditable: 'true', 'aria-label': 'Note body', role: 'textbox', 'aria-multiline': 'true', 'data-navoro-id': 'note.body' });
  editor.innerHTML = /<\/?[a-z][\s\S]*>/i.test(c.description || '') ? sanitize(c.description) : (c.description || '').split('\n').map(l => `<div>${escapeHtml(l) || '<br>'}</div>`).join('');
  const cmd = (name, val) => { editor.focus(); document.execCommand(name, false, val); };
  const interim = h('span', { class: 'interim' });
  const wave = h('span', { class: 'wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i'));
  const micStatus = h('div', { class: 'mic-status', hidden: true }, wave, h('span', {}, 'Listening'), interim);
  let session = null;
  const mic = h('button', { class: 'tool-btn mic', 'aria-label': 'Dictate', title: canListen ? 'Dictate into this note' : 'Voice input isn’t supported in this browser', disabled: !canListen, onclick: () => toggleMic() }, icon('mic'));
  function toggleMic() {
    if (session) { session.stop(); return; }
    mic.classList.add('on'); micStatus.hidden = false;
    session = listen({
      onInterim: t => (interim.textContent = t),
      onFinal: t => {
        interim.textContent = '';
        if (!t) return;
        editor.focus();
        const sel = getSelection();
        if (!editor.contains(sel.anchorNode)) { const r = document.createRange(); r.selectNodeContents(editor); r.collapse(false); sel.removeAllRanges(); sel.addRange(r); }
        document.execCommand('insertText', false, (editor.textContent.trim() ? ' ' : '') + t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? '' : '.'));
      },
      onError: msg => toast(msg),
      onEnd: () => { session = null; mic.classList.remove('on'); micStatus.hidden = true; interim.textContent = ''; },
    });
  }
  const toolbar = h('div', { class: 'rich-toolbar' },
    h('button', { class: 'tool-btn', 'aria-label': 'Bold', onmousedown: e => e.preventDefault(), onclick: () => cmd('bold') }, icon('bold')),
    h('button', { class: 'tool-btn', 'aria-label': 'Italic', onmousedown: e => e.preventDefault(), onclick: () => cmd('italic') }, icon('italic')),
    h('button', { class: 'tool-btn', 'aria-label': 'Heading', onmousedown: e => e.preventDefault(), onclick: () => cmd('formatBlock', 'H3') }, icon('heading')),
    h('button', { class: 'tool-btn', 'aria-label': 'Bulleted list', onmousedown: e => e.preventDefault(), onclick: () => cmd('insertUnorderedList') }, icon('list')),
    h('span', { class: 'tool-sep' }), mic, micStatus);

  // SD-V2: the note's colour.
  // One swatch shows the note's color; tap it for the whole palette.
  const colors = h('button', { class: 'note-color-btn', type: 'button', title: 'Note color', 'aria-label': 'Note color', style: { background: noteColor(store.getCard(id)) },
    onclick: e => popover(e.currentTarget, colorGrid(NOTE_PALETTE, noteColor(store.getCard(id)), col => { store.updateCard(id, { meta: { color: col } }, { touch: false }); colors.style.background = col; closePopovers(); })) });

  // SD-A2: linked docs. "Create Google Doc" makes a real doc in your Drive; any link can be attached too.
  const docList = h('div', { class: 'doc-links' });
  const docStatus = h('span', { class: 'muted small' });
  const paintDocs = () => {
    const list = store.getCard(id)?.meta?.docLinks || [];
    docList.replaceChildren(...list.map((d, i) => h('div', { class: 'doc-link' },
      h('span', { class: `doc-kind kind-${d.kind}` }, (DOC_KINDS[d.kind]?.label || 'Link')),
      safeUrl(d.url) ? h('a', { href: safeUrl(d.url), target: '_blank', rel: 'noopener noreferrer' }, d.title || d.url) : h('span', {}, d.title || d.url),
      h('button', { class: 'icon-btn xs', 'aria-label': 'Remove link', onclick: () => { store.updateCard(id, { meta: { docLinks: list.filter((_, j) => j !== i) } }); paintDocs(); } }, icon('x')))));
  };
  paintDocs();
  const linkIn = h('input', { class: 'field-input sm', placeholder: 'Paste a Google Docs, Drive or Apple Notes link', 'aria-label': 'Attach a link' });
  linkIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') attach(); });
  const attachRow = h('div', { class: 'note-docs-add', hidden: true }, linkIn, h('button', { class: 'chip', type: 'button', onclick: () => attach() }, icon('link'), 'Attach'));
  const showAttach = (hint = '') => { attachRow.hidden = false; linkIn.placeholder = hint || 'Paste a Google Docs, Drive or Apple Notes link'; setTimeout(() => linkIn.focus(), 30); };
  const attach = () => {
    const url = linkIn.value.trim();
    if (!url) return;
    const kind = docKind(url);
    store.updateCard(id, { meta: { docLinks: [...(store.getCard(id)?.meta?.docLinks || []), { kind, url, title: kind === 'gdoc' ? `${store.getCard(id)?.title || 'Note'} (Google Doc)` : DOC_KINDS[kind]?.label || prettyUrl(url).host || url }] } }, { log: true, logLabel: 'Linked a doc' });
    linkIn.value = ''; attachRow.hidden = true;
    docStatus.textContent = 'Linked.';
    paintDocs();
  };
  // One click, no setup: copy the note, open a new Google Doc with its title, paste.
  // (If a Google account is connected in the menu, Sedi creates the doc with the text already in it.)
  // Browsers only let a page open a tab during the click itself, so the tab opens first and everything
  // slow (creating the doc, copying) happens after.
  const createDoc = () => {
    save();
    const now = store.getCard(id);
    const createUrl = `https://docs.google.com/document/create?title=${encodeURIComponent(now.title || 'Note')}`;
    if (google.isSetUp() && store.pref('googleConnected')) {
      const tab = window.open('', '_blank');
      docStatus.textContent = 'Creating your Google Doc…';
      google.createDoc(now.title, noteText(now)).then(url => {
        store.updateCard(id, { meta: { docLinks: [...(now.meta?.docLinks || []), { kind: 'gdoc', url, title: `${now.title} (Google Doc)` }] } }, { log: true, logLabel: 'Created a Google Doc' });
        paintDocs(); docStatus.textContent = 'Created and linked.';
        if (tab) tab.location.href = url; else window.open(url, '_blank', 'noopener');
      }).catch(() => {
        if (tab) tab.location.href = createUrl;
        docStatus.textContent = 'Couldn’t create it automatically, so a blank doc opened. Your note is in Brainly to copy.';
      });
      return;
    }
    const html = `<h1>${escapeHtml(now.title || '')}</h1>${sanitize(now.description || '')}`;
    const plain = `${now.title}\n\n${noteText(now)}`;
    // Copy the whole note before the new tab opens. The async clipboard API finishes after the click,
    // and by then the new tab has taken focus, so browsers quietly refuse it and only the title made it
    // across. A synchronous copy of the formatted note finishes first, so the details come along.
    const copied = copyNow(html, plain);
    const paste = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘V' : 'Ctrl+V';
    if (!copied) { try { navigator.clipboard?.writeText(plain); } catch {} }
    window.open(createUrl, '_blank', 'noopener');
    docStatus.textContent = copied ? `Opened a new Google Doc with your note copied. Click into the doc and press ${paste} to paste the details.` : 'Opened a new Google Doc. Copy your note from here and paste it in.';
    toast(copied ? `Note copied. In the new Google Doc, press ${paste} to paste it in.` : 'Copy your note and paste it into the new doc.', { duration: 9000 });
    showAttach('Optional: paste the new doc’s address to keep it linked here');
  };
  const docs = h('div', { class: 'note-docs' },
    h('div', { class: 'note-docs-head' }, h('strong', {}, 'Docs'),
      h('button', { class: 'btn sm primary gdoc-btn', type: 'button', onclick: createDoc, title: 'Opens a new Google Doc with this note’s title and copies the note so you can paste it' }, h('span', { class: 'gdoc-mark', 'aria-hidden': 'true' }), 'Open as Google Doc'),
      h('button', { class: 'chip ghost', type: 'button', onclick: () => (attachRow.hidden ? showAttach() : (attachRow.hidden = true)) }, icon('link'), 'Attach a link')),
    docStatus,
    docList,
    attachRow);

  const save = () => {
    session?.stop();
    const before = store.getCard(id);
    if (!before) return;
    const t = title.value.trim() || firstText(editor) || 'Untitled note';
    const current = before.meta?.emoji;
    const emoji = current && current !== '📝' ? current : smartEmoji(`${t} ${editor.textContent}`, '📝');
    const html = sanitize(editor.innerHTML);
    if (before.title === t && before.description === html && current === emoji) return;
    store.updateCard(id, { title: t, description: html, meta: { emoji } }, { log: true });
  };
  editor.addEventListener('keydown', e => e.stopPropagation());
  title.addEventListener('keydown', e => e.stopPropagation());
  const noteModal = modal({
    title: '', wide: true, className: 'note-modal',
    body: h('div', { class: 'note-editor' }, h('div', { class: 'note-title-row' }, emojiBtn, title, colors), toolbar, editor, docs),
    actions: [
      { label: 'Duplicate', kind: 'ghost', onClick: () => { save(); duplicateNote(id); } },
      { label: 'Move to…', kind: 'ghost', onClick: () => { save(); setTimeout(() => openMoveDialog(id), 200); } },
      { label: 'Done', kind: 'primary' },
    ],
    onClose: () => {
      session?.stop();
      if (!store.getCard(id)) return;
      save();
      // A brand-new note that was closed without writing anything isn't kept.
      const c = store.getCard(id);
      if (isNew && c && (!c.title || c.title === 'Untitled note') && !stripHtml(c.description || '').trim()) store.deleteCard(id);
    },
  });
  noteModal.box.setAttribute('aria-label', `Note: ${store.getCard(id)?.title || 'Untitled'}`);
  if (isNew) setTimeout(() => title.focus(), 80);
}
const firstText = el => (el.innerText || '').trim().split('\n')[0].slice(0, 60);
const escapeHtml = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
