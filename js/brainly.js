// Sedi — Brainly: search, My Links (links, text files, PDFs in collapsible folders), and a free-form canvas
// of notes (rounded squares) and folders (which can hold folders).

import * as store from './store.js';
import {
  h, icon, uuid, clamp, toast, modal, popover, closePopovers, editInline, stripHtml,
  colorFor, smartEmoji, mostCommonEmoji, prettyUrl, EMOJI_CHOICES, debounce, hashStr,
} from './util.js';
import { registerDrop, onDragStart, onDragEnd } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, TOOL_NAMES, flatten, cardChrome, openMoveDialog, trashCard } from './cards.js';
import { revealCard } from './shell.js';
import { listen, canListen } from './speech.js';
import { crunch } from './sound.js';
import { summaryFor, ensureSummary, noteText } from './summaries.js';
import * as google from './google.js';

let root, canvas, dash, searchInput, results, peekEl = null, hovered = null;
const NOTE = 118, FOLDER_W = 150, FOLDER_H = 112;
const NOTE_COLORS = ['#fdf0d8', '#ece5fb', '#dff0fb', '#e2f3e4', '#fde2da', '#eef0f3'];
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
const kindOf = c => (c.meta?.pdf ? 'pdf' : c.meta?.file ? 'text' : c.type === 'link' ? 'link' : 'note');
const dotColor = c => ({ pdf: '#d6453d', text: '#9AA3AD', link: colorFor(c.meta?.host || c.title) }[kindOf(c)] || noteColor(c));
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
  canvas = h('div', { class: 'brain-canvas', dataset: { drop: 'brainly-canvas', accept: 'card bfolder' }, 'data-canvas': '' });
  dash = h('aside', { class: 'links-dash', 'aria-label': 'My links' });
  root.replaceChildren(h('div', { class: 'view brainly' },
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
  const letter = h('span', { class: 'link-badge', style: { background: colorFor(m.host || c.title) } }, (m.host || c.title || '?')[0].toUpperCase());
  if (!m.host) return letter;
  // SD-L3: the site's own icon, straight from the site (no third-party lookup). Falls back to a letter.
  const img = h('img', { class: 'link-fav', alt: '', src: `https://${m.host}/favicon.ico`, loading: 'lazy', referrerpolicy: 'no-referrer' });
  img.addEventListener('error', () => img.replaceWith(letter));
  return h('span', { class: 'link-badge fav-wrap' }, img);
}

function renderDash() {
  const q = query();
  const input = h('input', { class: 'field-input sm', placeholder: 'Paste a link', 'aria-label': 'Paste a link', 'data-keep': 'link-input' });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) { addLink(input.value.trim()); input.value = ''; }
  });
  input.addEventListener('paste', e => {
    const t = e.clipboardData.getData('text');
    if (/^https?:\/\//i.test(t.trim())) { e.preventDefault(); addLink(t.trim()); }
  });
  const textIn = h('input', { type: 'file', accept: '.txt,.md,.markdown,text/plain,text/markdown', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(f => addTextFile(f)); e.target.value = ''; } });
  const pdfIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(f => addPdf(f, null)); e.target.value = ''; } });
  const looseItems = links(null).filter(c => matches(c, q));
  const loose = h('div', { class: 'link-list loose', dataset: { drop: 'link-list', accept: 'card', lfolder: '' }, 'data-list': '' }, looseItems.map(linkEl));
  if (!looseItems.length && !q) loose.append(h('p', { class: 'empty-hint' }, 'Paste a link, or drop a PDF or text file here.'));
  const stack = h('div', { class: 'lf-stack', dataset: { drop: 'lfolder-stack', accept: 'lfolder' }, 'data-list': '' },
    linkFolders().filter(f => !q || f.name.toLowerCase().includes(q) || links(f.id).some(c => matches(c, q))).map(linkFolderEl));
  dash.replaceChildren(
    h('div', { class: 'dash-head' }, h('h2', {}, 'My links'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Add PDFs', title: 'Add PDFs', onclick: () => pdfIn.click() }, h('span', { class: 'pdf-mini' }, 'PDF')),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Add a text file', title: 'Add a text file', onclick: () => textIn.click() }, icon('file')),
      h('button', { class: 'chip new-lf', title: 'New folder for links', onclick: addLinkFolder }, icon('folder'), 'New folder')),
    input, textIn, pdfIn,
    h('div', { class: 'dash-scroll' }, loose, stack));
}

function linkEl(c) {
  const m = c.meta || {};
  const kind = kindOf(c);
  const el = h('div', { class: `link-card kind-${kind}`, dataset: { drag: 'card', id: c.id }, tabindex: 0, title: m.url || m.pdf?.name || c.title },
    favicon(c),
    h('span', { class: 'link-text' }, h('span', { class: 'link-title' }, c.title),
      h('span', { class: 'link-host' }, kind === 'pdf' ? `PDF · ${fmtSize(m.pdf.size || 0)}` : kind === 'text' ? 'Text file' : m.host || 'Link')));
  // SD-F4 / SD-L3: a click previews; the preview has the Open button.
  el.addEventListener('click', e => { if (!e.target.closest('button')) previewItem(el, c.id); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter') previewItem(el, c.id); });
  el.append(h('button', { class: 'card-del', 'aria-label': 'Delete', title: 'Delete (you can Undo)', onclick: e => { e.stopPropagation(); trashCard(c.id); } }, icon('x')));
  return el;
}

function dotsRow(items, max = 9) {
  const shown = items.slice(0, max);
  return h('div', { class: 'f-dots', 'aria-label': `${items.length} item${items.length === 1 ? '' : 's'}` },
    shown.map(c => h('i', { style: { background: dotColor(c) }, title: c.title })),
    items.length > max ? h('span', {}, `+${items.length - max}`) : null,
    !items.length ? h('span', {}, 'Empty') : null);
}

const PREVIEW_N = 4;
function linkFolderEl(f) {
  const q = query();
  const all = links(f.id);
  const items = all.filter(c => matches(c, q));
  const open = !f.collapsed || (q && items.length);
  const emoji = f.emoji || mostCommonEmoji(all.map(c => `${c.meta?.url || ''} ${c.title}`), '🔗');
  const name = h('span', { class: 'lf-name' }, f.name);
  name.addEventListener('dblclick', e => { e.stopPropagation(); editInline(name, { onCommit: v => saveLinkFolder(f.id, { name: v }) }); });
  const pdfIn = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(file => addPdf(file, f.id)); e.target.value = ''; } });
  const list = h('div', { class: 'link-list lf-list', dataset: { drop: 'link-list', accept: 'card', lfolder: f.id }, 'data-list': '' }, items.slice(0, PREVIEW_N).map(linkEl));
  if (!all.length) list.append(h('p', { class: 'empty-hint' }, 'Drag links here, or add PDFs.'));
  return h('section', { class: `link-folder ${open ? 'open' : ''}`, dataset: { drag: 'lfolder', id: f.id, lfolder: f.id } },
    h('header', { class: 'lf-head' },
      // SD-F1: collapse / expand.
      h('button', { class: 'lf-caret', 'aria-label': open ? 'Collapse folder' : 'Expand folder', 'aria-expanded': String(!!open), onclick: () => saveLinkFolder(f.id, { collapsed: !f.collapsed }) }, icon('chevR')),
      h('button', { class: 'lf-emoji', 'aria-label': 'Change folder emoji', onclick: e => { e.stopPropagation(); pickEmoji(e.currentTarget, v => saveLinkFolder(f.id, { emoji: v })); } }, emoji),
      name,
      h('span', { class: 'col-count' }, all.length || ''),
      h('button', { class: 'icon-btn xs', 'aria-label': `Open ${f.name}`, title: 'Open in a wide view', onclick: () => openLinkFolder(f.id) }, icon('expand')),
      h('button', { class: 'icon-btn xs', 'aria-label': `Add PDFs to ${f.name}`, title: 'Add PDFs', onclick: () => pdfIn.click() }, h('span', { class: 'pdf-mini' }, 'PDF')),
      h('button', { class: 'icon-btn xs', 'aria-label': `Delete folder ${f.name}`, onclick: () => deleteLinkFolder(f) }, icon('x'))),
    // SD-F6: what's inside, as coloured dots on one row.
    dotsRow(all),
    open ? list : null,
    open && items.length > PREVIEW_N ? h('button', { class: 'chip ghost lf-more', onclick: () => openLinkFolder(f.id) }, `Show all ${items.length}`) : null,
    pdfIn);
}

/** SD-F3: the wide view of a link folder. */
function openLinkFolder(fid) {
  const f = linkFolders().find(x => x.id === fid);
  if (!f) return;
  const grid = h('div', { class: 'wide-grid', dataset: { drop: 'link-list', accept: 'card', lfolder: fid }, 'data-list': '' });
  const fill = () => {
    const items = links(fid);
    grid.replaceChildren(...items.map(linkEl));
    if (!items.length) grid.append(h('p', { class: 'muted' }, 'Empty. Drag links here or add PDFs.'));
  };
  fill();
  const unsub = store.on(fill);
  modal({ title: `${f.emoji || '🔗'}  ${f.name}`, wide: true, body: grid, onClose: unsub });
}

registerDrop('link-list', ({ id, data, index }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const lfid = data.lfolder || null;
  if (c.tool === 'brainly' && c.type === 'link') {
    store.updateCard(id, { meta: { linkFolderId: lfid } }, { silent: true });
  } else {
    const url = (`${c.title} ${flatten(c)}`.match(/https?:\/\/\S+/) || [])[0];
    const meta = { linkFolderId: lfid, ...(url ? { url, host: prettyUrl(url).host } : { file: true }) };
    routeCard(id, { tool: 'brainly', type: 'link', meta });
    if (c.tool === 'brainly') store.updateCard(id, { type: 'link', meta }, { replaceMeta: true, silent: true });
  }
  reorder(links(lfid), id, index);
});
// SD-F5: link folders reorder by drag.
registerDrop('lfolder-stack', ({ kind, id, index }) => {
  if (kind !== 'lfolder') return false;
  const list = linkFolders();
  const moving = list.find(f => f.id === id);
  if (!moving) return false;
  const rest = list.filter(f => f.id !== id);
  rest.splice(index ?? rest.length, 0, moving);
  store.set('linkFolders', rest);
});

function addLink(raw) {
  let url = raw;
  if (!/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { new URL(url); } catch { return toast('That doesn’t look like a link.'); }
  const { host, title } = prettyUrl(url);
  store.createCard({ type: 'link', tool: 'brainly', title, description: url, meta: { url, host, linkFolderId: null, order: links(null).length } });
}
async function addTextFile(file) {
  if (!file || file.size > 2e6) return toast('Text files up to 2 MB, please.');
  const text = await file.text();
  store.createCard({ type: 'link', tool: 'brainly', title: file.name.replace(/\.[^.]+$/, ''), description: text, meta: { file: true, linkFolderId: null, order: links(null).length } });
  toast(`Added ${file.name}`);
}
/** SD-F2: PDFs are saved on this device and included in Download data. */
async function addPdf(file, lfid) {
  if (!file) return;
  if (file.size > MAX_PDF) return toast(`${file.name} is over 25 MB. Smaller PDFs only, please.`);
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
    const target = e.target.closest('.link-folder')?.dataset.id || null;
    const all = [...e.dataTransfer.files];
    all.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf').forEach(f => addPdf(f, target));
    all.filter(f => /\.(txt|md|markdown)$/i.test(f.name) || f.type.startsWith('text/')).forEach(addTextFile);
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!all.length && /^https?:\/\//i.test(uri?.trim() || '')) addLink(uri.trim().split('\n')[0]);
  });
}
function saveLinkFolder(id, patch) { store.set('linkFolders', linkFolders().map(x => (x.id === id ? { ...x, ...patch } : x))); }
function addLinkFolder() {
  const f = { id: uuid(), name: 'New folder' };
  store.set('linkFolders', [...linkFolders(), f]);
  setTimeout(() => { const n = dash.querySelector(`.link-folder[data-id="${f.id}"] .lf-name`); if (n) editInline(n, { onCommit: v => saveLinkFolder(f.id, { name: v }) }); }, 60);
}
export function deleteLinkFolder(f) {
  const moved = links(f.id);
  moved.forEach(c => store.updateCard(c.id, { meta: { linkFolderId: null } }, { silent: true }));
  const prev = linkFolders();
  store.set('linkFolders', prev.filter(x => x.id !== f.id));
  toast(`Removed folder ${f.name}${moved.length ? '. Its links moved to My links.' : ''}`, {
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
  title.addEventListener('change', () => title.value.trim() && store.updateCard(id, { title: title.value.trim() }, { log: true }));
  title.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') title.blur(); });
  const rows = [];
  if (kind === 'link') {
    rows.push(h('div', { class: 'peek-url' }, m.url),
      h('div', { class: 'peek-actions' },
        h('a', { class: 'btn sm primary', href: m.url, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open link'),
        h('button', { class: 'chip', onclick: () => { closePopovers(); openMoveDialog(id); } }, icon('move'), 'Move to…')),
      h('p', { class: 'muted small' }, 'Sites don’t let a browser app fetch their preview image, so Sedi shows the site’s icon, its address and the title you choose.'));
  } else if (kind === 'pdf') {
    const drive = h('input', { class: 'field-input sm', value: m.driveUrl || '', placeholder: 'Paste a Google Drive link', 'aria-label': 'Google Drive link' });
    drive.addEventListener('change', () => store.updateCard(id, { meta: { driveUrl: drive.value.trim() || null } }, { log: true, logLabel: 'Linked to Google Drive' }));
    drive.addEventListener('keydown', e => e.stopPropagation());
    const status = h('span', { class: 'muted small' });
    rows.push(h('div', { class: 'muted small' }, `${m.pdf.name} · ${fmtSize(m.pdf.size || 0)} · saved on this device`),
      h('div', { class: 'peek-actions' },
        h('button', { class: 'btn sm primary', onclick: () => openPdf(m.pdf) }, icon('external'), 'Open PDF'),
        m.driveUrl ? h('a', { class: 'chip', href: m.driveUrl, target: '_blank', rel: 'noopener noreferrer' }, icon('external'), 'Open in Drive')
          : h('button', { class: 'chip', onclick: async () => {
            status.textContent = 'Uploading to Google Drive…';
            try { const blob = await store.getFile(m.pdf.fileId); const url = await google.uploadToDrive(m.pdf.name, blob); store.updateCard(id, { meta: { driveUrl: url } }, { log: true, logLabel: 'Saved to Google Drive' }); status.textContent = 'Saved to Drive.'; }
            catch (err) { status.textContent = err.message; }
          } }, icon('upload'), 'Save to Google Drive')),
      h('label', { class: 'field-label' }, 'Google Drive link'), drive, status);
  } else {
    rows.push(h('div', { class: 'peek-text' }, (c.description || '').slice(0, 700) || 'Empty file.'),
      h('div', { class: 'peek-actions' }, h('button', { class: 'chip', onclick: () => { closePopovers(); openEditor(id, { title: 'Text file' }); } }, icon('pencil'), 'Open')));
  }
  popover(anchor, h('div', { class: 'item-peek' }, h('div', { class: 'item-peek-head' }, favicon(c), title), ...rows), { className: 'item-peek-pop' });
}
async function openPdf(pdf) {
  const blob = await store.getFile(pdf.fileId);
  if (!blob) return toast('That PDF isn’t on this device any more.');
  const url = URL.createObjectURL(blob.type ? blob : new Blob([blob], { type: 'application/pdf' }));
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
  const el = h('article', { class: 'b-note', dataset: { drag: 'card', id: c.id }, tabindex: 0, 'aria-label': c.title, style: { '--note': noteColor(c) } },
    emoji, h('span', { class: 'b-note-title' }, c.title));
  // Duplicate on hover: the quickest way to start a new note from an old one.
  cardChrome(el, c, () => openNote(c.id), { actions: [h('button', { class: 'card-tool', type: 'button', 'aria-label': 'Duplicate', title: 'Duplicate this note (⌘D)', onclick: e => { e.stopPropagation(); hidePeek(); duplicateNote(c.id); } }, icon('copy'))] });
  el.removeAttribute('title');
  el.addEventListener('click', e => { if (!e.target.closest('button')) { hidePeek(); openNote(c.id); } });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) openNote(c.id); });
  el.addEventListener('pointerenter', () => showPeek(el, c.id));
  el.addEventListener('pointerleave', hidePeek);
  return el;
}

function folderEl(f) {
  const notes = folderNotes(f.id);
  const subs = childFolders(f.id);
  const emoji = f.emoji || mostCommonEmoji(notes.map(n => `${n.title} ${stripHtml(n.description)}`), '🗂️');
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
    dotsRow([...subs.map(s => ({ title: s.name, meta: { color: s.color || '#A796CB' }, type: 'note' })), ...notes], 7),
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
function hidePeek() { clearTimeout(peekTimer); peekEl?.remove(); peekEl = null; }
onDragStart(() => hidePeek());

// ---------- Drops ----------
registerDrop('brainly-canvas', ({ kind, id, left, top, zone }) => {
  if (kind === 'bfolder') {
    saveFolder(id, { x: clamp(Math.round(left), 8, zone.clientWidth - FOLDER_W - 8), y: clamp(Math.round(top), 8, zone.clientHeight - FOLDER_H - 8), parentId: null });
    return;
  }
  const c = store.getCard(id);
  if (!c) return false;
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
function freeSpot() {
  const n = canvasNotes().length + topFolders().length;
  const cols = Math.max(1, Math.floor(((canvas?.clientWidth || 800) - 32) / 160));
  return { x: 24 + (n % cols) * 156, y: 24 + Math.floor(n / cols) * 150 };
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
  toast(`Duplicated “${c.title}”`, { action: 'Undo', onAction: () => store.deleteCard(copy.id) });
  return copy;
}
function duplicateFolder(fid) {
  const created = [];
  const copyTree = (src, parentId, top) => {
    const nf = { ...src, id: uuid(), name: top ? `${src.name} copy` : src.name, parentId, ...(top && !parentId ? { x: (src.x ?? 24) + 30, y: (src.y ?? 24) + 30 } : {}) };
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
function pickEmoji(anchor, onPick) {
  popover(anchor, h('div', { class: 'emoji-grid' }, EMOJI_CHOICES.map(e => h('button', {
    class: 'emoji-opt', onclick: () => { onPick(e); closePopovers(); },
  }, e))));
}
function pickFolderColor(anchor, f) {
  const COLORS = ['#A796CB', '#8E9BC9', '#86AE95', '#C9A46E', '#C98E8E', '#7FAEBE', '#9AA3AD', '#D1A0B8'];
  popover(anchor, h('div', { class: 'swatches' }, COLORS.map(col => h('button', {
    class: `swatch ${col === f.color ? 'on' : ''}`, style: { background: col }, 'aria-label': `Use color ${col}`,
    onclick: () => { saveFolder(f.id, { color: col }); closePopovers(); },
  }))));
}

/** A folder's window: sub-folders, notes as squares (drag them out), and actions. */
function openFolder(fid) {
  const box = h('div', { class: 'folder-view' });
  let m;
  const fill = () => {
    const f = folderById(fid);
    if (!f) { m?.close(); return; }
    const path = [];
    for (let p = f; p; p = folderById(p.parentId)) path.unshift(p);
    const subs = childFolders(fid);
    const notes = folderNotes(fid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    box.replaceChildren(
      h('div', { class: 'crumbs' }, path.map((p, i) => [i ? h('span', { class: 'muted' }, ' › ') : null, i < path.length - 1 ? h('button', { class: 'crumb', onclick: () => { m.close(); openFolder(p.id); } }, p.name) : h('strong', {}, p.name)])),
      subs.length ? h('div', { class: 'fv-section' }, h('h4', { class: 'list-sub' }, 'Folders'),
        h('div', { class: 'fv-folders' }, subs.map(s => h('div', { class: 'fv-folder', style: { '--folder': s.color || '#A796CB' } },
          h('button', { class: 'fv-folder-open', onclick: () => { m.close(); openFolder(s.id); } }, h('span', { class: 'bf-emoji' }, s.emoji || '🗂️'), h('span', {}, s.name), dotsRow(folderNotes(s.id), 6)),
          h('button', { class: 'chip ghost', title: 'Move this folder out onto the canvas', onclick: () => saveFolder(s.id, { parentId: null, ...freeSpot() }) }, 'Move out'))))) : null,
      h('div', { class: 'fv-section' }, h('h4', { class: 'list-sub' }, notes.length ? 'Notes · drag one out to move it' : 'Notes'),
        notes.length ? h('div', { class: 'fv-notes' }, notes.map(n => {
          const el = h('article', { class: 'b-note in-folder', dataset: { drag: 'card', id: n.id }, tabindex: 0, style: { '--note': noteColor(n) } },
            h('span', { class: 'note-emoji static' }, n.meta?.emoji || '📝'), h('span', { class: 'b-note-title' }, n.title));
          el.addEventListener('click', () => { hidePeek(); openNote(n.id); });
          el.addEventListener('pointerenter', () => showPeek(el, n.id));
          el.addEventListener('pointerleave', hidePeek);
          return el;
        })) : h('p', { class: 'muted' }, 'Empty. Drag notes onto this folder on the canvas, or add one here.')));
  };
  fill();
  const unsub = store.on(fill);
  const f = folderById(fid);
  m = modal({
    title: `${f.emoji || '🗂️'}  ${f.name}`, body: box, wide: true, onClose: () => { unsub(); hidePeek(); },
    actions: [
      { label: 'Duplicate folder', kind: 'ghost', onClick: () => duplicateFolder(fid) },
      { label: 'New folder inside', kind: 'ghost', onClick: () => { addFolder(fid); return true; } },
      { label: 'New note here', kind: 'primary', onClick: () => addNote(fid) },
    ],
  });
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
  const title = h('input', { class: 'field-input title-input', value: isNew ? '' : c.title, placeholder: 'Title', 'aria-label': 'Note title' });
  const emojiBtn = h('button', { class: 'note-emoji lg', 'aria-label': 'Change emoji', onclick: e => pickEmoji(e.currentTarget, v => { store.updateCard(id, { meta: { emoji: v } }); emojiBtn.textContent = v; }) }, c.meta?.emoji || smartEmoji(c.title));
  const editor = h('div', { class: 'rich-editor', contenteditable: 'true', 'aria-label': 'Note body', role: 'textbox', 'aria-multiline': 'true' });
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
  const colors = h('div', { class: 'note-colors', role: 'radiogroup', 'aria-label': 'Note colour' }, NOTE_COLORS.map(col => h('button', {
    class: `swatch sm ${noteColor(store.getCard(id)) === col ? 'on' : ''}`, style: { background: col }, 'aria-label': `Colour ${col}`,
    onclick: e => { store.updateCard(id, { meta: { color: col } }, { touch: false }); colors.querySelectorAll('.swatch').forEach(s => s.classList.toggle('on', s === e.currentTarget)); },
  })));

  // SD-A2: linked docs. "Create Google Doc" makes a real doc in your Drive; any link can be attached too.
  const docList = h('div', { class: 'doc-links' });
  const docStatus = h('span', { class: 'muted small' });
  const paintDocs = () => {
    const list = store.getCard(id)?.meta?.docLinks || [];
    docList.replaceChildren(...list.map((d, i) => h('div', { class: 'doc-link' },
      h('span', { class: `doc-kind kind-${d.kind}` }, (DOC_KINDS[d.kind]?.label || 'Link')),
      h('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, d.title || d.url),
      h('button', { class: 'icon-btn xs', 'aria-label': 'Remove link', onclick: () => { store.updateCard(id, { meta: { docLinks: list.filter((_, j) => j !== i) } }); paintDocs(); } }, icon('x')))));
  };
  paintDocs();
  const linkIn = h('input', { class: 'field-input sm', placeholder: 'Paste a Google Docs, Drive or Apple Notes link', 'aria-label': 'Attach a link' });
  linkIn.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') attach(); });
  const attach = () => {
    const url = linkIn.value.trim();
    if (!url) return;
    const kind = docKind(url);
    store.updateCard(id, { meta: { docLinks: [...(store.getCard(id)?.meta?.docLinks || []), { kind, url, title: DOC_KINDS[kind]?.label || prettyUrl(url).host || url }] } }, { log: true, logLabel: 'Linked a doc' });
    linkIn.value = '';
    paintDocs();
  };
  const createDoc = async () => {
    save();
    const now = store.getCard(id);
    docStatus.textContent = google.isSetUp() ? 'Creating your Google Doc…' : '';
    try {
      const url = await google.createDoc(now.title, noteText(now));
      store.updateCard(id, { meta: { docLinks: [...(now.meta?.docLinks || []), { kind: 'gdoc', url, title: `${now.title} (Google Doc)` }] } }, { log: true, logLabel: 'Created a Google Doc' });
      paintDocs();
      docStatus.textContent = 'Created. It’s linked below.';
      window.open(url, '_blank', 'noopener');
    } catch (err) { docStatus.textContent = err.message; }
  };
  const docs = h('div', { class: 'note-docs' },
    h('div', { class: 'note-docs-head' }, h('strong', {}, 'Linked docs'),
      h('button', { class: 'chip', type: 'button', onclick: createDoc, title: 'Creates a new Google Doc in your Drive with this note’s text' }, icon('plus'), 'Create Google Doc'), docStatus),
    docList,
    h('div', { class: 'note-docs-add' }, linkIn, h('button', { class: 'chip', type: 'button', onclick: attach }, icon('link'), 'Attach')),
    h('p', { class: 'muted small' }, 'Links open the doc; text isn’t synced back into Sedi. Apple Notes can’t be created from a web app, so attach its share link instead.'));

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
  modal({
    title: '', wide: true, className: 'note-modal',
    body: h('div', { class: 'note-editor' }, h('div', { class: 'note-title-row' }, emojiBtn, title, colors), toolbar, editor, docs),
    actions: [
      { label: 'Duplicate', kind: 'ghost', onClick: () => { save(); duplicateNote(id); } },
      { label: 'Move to…', kind: 'ghost', onClick: () => { save(); setTimeout(() => openMoveDialog(id), 200); } },
      { label: 'Done', kind: 'primary' },
    ],
    onClose: () => { session?.stop(); if (store.getCard(id)) save(); },
  });
  if (isNew) setTimeout(() => title.focus(), 80);
}
const firstText = el => (el.innerText || '').trim().split('\n')[0].slice(0, 60);
const escapeHtml = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
