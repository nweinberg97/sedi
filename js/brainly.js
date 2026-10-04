// Sedi — Brainly: universal search, My Links dashboard, and a free-form canvas of notes + folders.

import * as store from './store.js';
import {
  h, icon, uuid, clamp, toast, modal, popover, closePopovers, editInline, stripHtml,
  colorFor, smartEmoji, mostCommonEmoji, prettyUrl, EMOJI_CHOICES, debounce,
} from './util.js';
import { registerDrop } from './dnd.js';
import { routeCard, reorder, byOrder, openEditor, typeIcon, TOOL_NAMES, flatten } from './cards.js';
import { navigate } from './shell.js';
import { listen, canListen } from './speech.js';

let root, canvas, dash, searchInput, results;
const NOTE_W = 200, NOTE_H = 44, FOLDER_W = 148, FOLDER_H = 104;

const folders = () => store.get('brainFolders', []);
const linkFolders = () => store.get('linkFolders', []);
const canvasNotes = () => store.cardsWhere(c => c.tool === 'brainly' && c.type !== 'link' && !c.meta?.folderId);
const folderNotes = fid => store.cardsWhere(c => c.tool === 'brainly' && c.type !== 'link' && c.meta?.folderId === fid);
const links = lfid => store.cardsWhere(c => c.tool === 'brainly' && c.type === 'link' && (c.meta?.linkFolderId || null) === (lfid || null)).sort(byOrder);

export function mount(el) {
  root = el;
  searchInput = h('input', { class: 'search-input', type: 'search', placeholder: 'Search everything in Sedi', 'aria-label': 'Search everything' });
  results = h('div', { class: 'search-results', hidden: true });
  searchInput.addEventListener('input', debounce(runSearch, 40));
  searchInput.addEventListener('keydown', e => { if (e.key === 'Escape') { searchInput.value = ''; runSearch(); } });
  searchInput.addEventListener('focus', runSearch);
  document.addEventListener('pointerdown', e => { if (!e.target.closest('.search')) results.hidden = true; });
  canvas = h('div', { class: 'brain-canvas', dataset: { drop: 'brainly-canvas', accept: 'card bfolder' }, 'data-canvas': '' });
  dash = h('aside', { class: 'links-dash', 'aria-label': 'My links' });
  root.replaceChildren(h('div', { class: 'view brainly' },
    h('div', { class: 'view-head brainly-head' },
      h('h1', { class: 'view-title' }, 'Brainly'),
      h('div', { class: 'search' }, icon('search', 'search-icon'), searchInput, results),
      h('div', { class: 'brain-actions' },
        h('button', { class: 'btn primary sm', onclick: () => addNote() }, icon('plus'), 'Note'),
        h('button', { class: 'btn ghost sm', onclick: addFolder }, icon('folder'), 'Folder'))),
    h('div', { class: 'brain-body' }, dash, canvas)));
  setupFileDrop();
  render();
}

export function render() {
  if (!root?.isConnected) return;
  renderDash();
  renderCanvas();
  if (searchInput.value) runSearch();
}

// ---------- Universal search ----------
function runSearch() {
  const q = searchInput.value.trim().toLowerCase();
  canvas.querySelectorAll('.b-note, .b-folder').forEach(n => n.classList.remove('dim', 'hit'));
  if (!q) { results.hidden = true; return; }
  const terms = q.split(/\s+/);
  const hay = c => `${c.title} ${flatten(c)} ${c.meta?.url || ''}`.toLowerCase();
  const hits = store.allCards().map(c => {
    const t = hay(c);
    if (!terms.every(w => t.includes(w))) return null;
    const score = terms.reduce((s, w) => s + (c.title.toLowerCase().includes(w) ? 3 : 1), 0);
    return { c, score };
  }).filter(Boolean).sort((a, b) => b.score - a.score || b.c.updatedAt.localeCompare(a.c.updatedAt)).slice(0, 12);
  const ids = new Set(hits.map(x => x.c.id));
  canvas.querySelectorAll('.b-note').forEach(n => n.classList.add(ids.has(n.dataset.id) ? 'hit' : 'dim'));
  canvas.querySelectorAll('.b-folder').forEach(n => {
    const has = folderNotes(n.dataset.id).some(c => ids.has(c.id));
    n.classList.add(has ? 'hit' : 'dim');
  });
  results.hidden = false;
  results.replaceChildren(...(hits.length ? hits.map(({ c }) => h('button', {
    class: 'result', onclick: () => {
      results.hidden = true;
      if (c.tool === 'brainly' && c.type !== 'link') return openNote(c.id);
      if (c.type === 'link' && c.meta?.url) return window.open(c.meta.url, '_blank', 'noopener');
      navigate(c.tool === 'universal' ? 'home' : c.tool);
    },
  }, typeIcon(c.type), h('span', { class: 'result-title' }, c.title), h('span', { class: 'result-tool' }, TOOL_NAMES[c.tool]))) : [h('div', { class: 'result-empty' }, 'No matches.')]));
}

// ---------- My Links ----------
function renderDash() {
  const input = h('input', { class: 'field-input sm', placeholder: 'Paste a link', 'aria-label': 'Paste a link', 'data-keep': 'link-input' });
  input.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter' && input.value.trim()) { addLink(input.value.trim()); input.value = ''; }
  });
  input.addEventListener('paste', e => {
    const t = e.clipboardData.getData('text');
    if (/^https?:\/\//i.test(t.trim())) { e.preventDefault(); addLink(t.trim()); }
  });
  const fileIn = h('input', { type: 'file', accept: '.txt,.md,.markdown,text/plain,text/markdown', multiple: true, hidden: true, onchange: e => { [...e.target.files].forEach(addTextFile); e.target.value = ''; } });
  const loose = h('div', { class: 'link-list loose', dataset: { drop: 'link-list', accept: 'card', lfolder: '' }, 'data-list': '' }, links(null).map(linkEl));
  if (!links(null).length) loose.append(h('p', { class: 'empty-hint' }, 'Paste a link or drop a text file.'));
  dash.replaceChildren(
    h('div', { class: 'dash-head' }, h('h2', {}, 'My links'),
      h('button', { class: 'icon-btn sm', 'aria-label': 'Add a text file', title: 'Add a text file', onclick: () => fileIn.click() }, icon('file')),
      h('button', { class: 'icon-btn sm', 'aria-label': 'New link folder', title: 'New link folder', onclick: addLinkFolder }, icon('folder'))),
    input, fileIn,
    h('div', { class: 'dash-scroll' }, loose, linkFolders().map(linkFolderEl)));
}

function linkEl(c) {
  const m = c.meta || {};
  const seed = m.host || c.title;
  const el = h(m.url ? 'a' : 'div', {
    class: 'link-card', dataset: { drag: 'card', id: c.id },
    ...(m.url ? { href: m.url, target: '_blank', rel: 'noopener noreferrer' } : {}), title: m.url || c.title,
  },
  h('span', { class: 'link-badge', style: { background: colorFor(seed) } }, m.file ? '📄' : smartEmoji(`${m.url || ''} ${c.title}`, (m.host || c.title || '?')[0].toUpperCase())),
  h('span', { class: 'link-text' }, h('span', { class: 'link-title' }, c.title), h('span', { class: 'link-host' }, m.file ? 'Text file' : m.host || 'Link')));
  if (!m.url) el.addEventListener('click', () => openEditor(c.id, { title: 'Text file' }));
  el.addEventListener('dblclick', e => { e.preventDefault(); const t = el.querySelector('.link-title'); editInline(t, { onCommit: v => store.updateCard(c.id, { title: v }) }); });
  el.addEventListener('dragstart', e => e.preventDefault());
  return el;
}

function linkFolderEl(f) {
  const items = links(f.id);
  const emoji = mostCommonEmoji(items.map(c => `${c.meta?.url || ''} ${c.title}`), '🔗');
  const name = h('span', { class: 'lf-name' }, f.name);
  name.addEventListener('dblclick', () => editInline(name, { onCommit: v => store.set('linkFolders', linkFolders().map(x => (x.id === f.id ? { ...x, name: v } : x))) }));
  const list = h('div', { class: 'link-list lf-list', dataset: { drop: 'link-list', accept: 'card', lfolder: f.id }, 'data-list': '', 'data-autoscroll': '' }, items.map(linkEl));
  if (!items.length) list.append(h('p', { class: 'empty-hint' }, 'Drag links here.'));
  return h('section', { class: 'link-folder' },
    h('header', { class: 'lf-head' }, h('span', { class: 'lf-emoji' }, emoji), name, h('span', { class: 'col-count' }, items.length || ''),
      h('button', { class: 'icon-btn xs', 'aria-label': `Delete folder ${f.name}`, onclick: () => deleteLinkFolder(f) }, icon('x'))),
    list);
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
function setupFileDrop() {
  dash.addEventListener('dragover', e => { if ([...e.dataTransfer.types].some(t => t === 'Files' || t === 'text/uri-list')) { e.preventDefault(); dash.classList.add('drop-over'); } });
  dash.addEventListener('dragleave', e => { if (!dash.contains(e.relatedTarget)) dash.classList.remove('drop-over'); });
  dash.addEventListener('drop', e => {
    e.preventDefault(); dash.classList.remove('drop-over');
    const files = [...e.dataTransfer.files].filter(f => /\.(txt|md|markdown)$/i.test(f.name) || f.type.startsWith('text/'));
    files.forEach(addTextFile);
    const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
    if (!files.length && /^https?:\/\//i.test(uri?.trim() || '')) addLink(uri.trim().split('\n')[0]);
  });
}
function addLinkFolder() {
  const f = { id: uuid(), name: 'New folder' };
  store.set('linkFolders', [...linkFolders(), f]);
  setTimeout(() => { const n = [...dash.querySelectorAll('.lf-name')].at(-1); if (n) editInline(n, { onCommit: v => store.set('linkFolders', linkFolders().map(x => (x.id === f.id ? { ...x, name: v } : x))) }); }, 60);
}
function deleteLinkFolder(f) {
  const moved = links(f.id);
  moved.forEach(c => store.updateCard(c.id, { meta: { linkFolderId: null } }, { silent: true }));
  const prev = linkFolders();
  store.set('linkFolders', prev.filter(x => x.id !== f.id));
  toast(`Removed folder ${f.name}${moved.length ? '. Its links moved to My links.' : ''}`, {
    action: 'Undo', onAction: () => { store.set('linkFolders', prev); moved.forEach(c => store.updateCard(c.id, { meta: { linkFolderId: f.id } }, { silent: true })); store.notify(); },
  });
}

// ---------- Canvas: notes + folders ----------
function renderCanvas() {
  const cw = canvas.clientWidth || 900, ch = canvas.clientHeight || 600;
  const place = (el, x, y, w, hh) => { el.style.left = clamp(x ?? 24, 8, Math.max(8, cw - w - 8)) + 'px'; el.style.top = clamp(y ?? 24, 8, Math.max(8, ch - hh - 8)) + 'px'; return el; };
  const nodes = [
    ...folders().map(f => place(folderEl(f), f.x, f.y, FOLDER_W, FOLDER_H)),
    ...canvasNotes().map(c => place(noteEl(c), c.meta?.x, c.meta?.y, NOTE_W, NOTE_H)),
  ];
  canvas.replaceChildren(...nodes);
  if (!nodes.length) canvas.append(h('div', { class: 'canvas-empty' }, 'Start a note or a folder. Drag notes onto folders to file them.'));
}

function noteEl(c) {
  const emoji = h('button', { class: 'note-emoji', 'aria-label': 'Change emoji', onclick: e => { e.stopPropagation(); pickEmoji(e.currentTarget, c.id); } }, c.meta?.emoji || smartEmoji(c.title));
  const el = h('article', { class: 'b-note', dataset: { drag: 'card', id: c.id }, tabindex: 0, title: c.title }, emoji, h('span', { class: 'b-note-title' }, c.title));
  el.addEventListener('click', () => openNote(c.id));
  el.addEventListener('keydown', e => { if (e.key === 'Enter') openNote(c.id); });
  return el;
}

function folderEl(f) {
  const notes = folderNotes(f.id);
  const emoji = f.emoji || mostCommonEmoji(notes.map(n => `${n.title} ${stripHtml(n.description)}`), '🗂️');
  const name = h('span', { class: 'bf-name' }, f.name);
  name.addEventListener('dblclick', e => { e.stopPropagation(); editInline(name, { onCommit: v => saveFolder(f.id, { name: v }) }); });
  const el = h('div', {
    class: 'b-folder', tabindex: 0, style: { '--folder': f.color || '#A796CB' },
    dataset: { drag: 'bfolder', id: f.id, drop: 'brainly-folder', accept: 'card', folder: f.id },
  },
  h('div', { class: 'bf-tab' }),
  h('div', { class: 'bf-body' },
    h('span', { class: 'bf-emoji' }, emoji),
    name,
    h('span', { class: 'bf-count' }, notes.length ? `${notes.length} note${notes.length === 1 ? '' : 's'}` : 'Empty')),
  h('button', { class: 'bf-color', 'aria-label': 'Folder color', style: { background: f.color || '#A796CB' }, onclick: e => { e.stopPropagation(); pickFolderColor(e.currentTarget, f); } }));
  el.addEventListener('click', e => { if (!e.target.closest('button') && !name.isContentEditable) openFolder(f.id); });
  el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) openFolder(f.id); });
  return el;
}

registerDrop('brainly-canvas', ({ kind, id, left, top, zone }) => {
  if (kind === 'bfolder') {
    saveFolder(id, { x: clamp(Math.round(left), 8, zone.clientWidth - FOLDER_W - 8), y: clamp(Math.round(top), 8, zone.clientHeight - FOLDER_H - 8) });
    return;
  }
  const c = store.getCard(id);
  if (!c) return false;
  const x = clamp(Math.round(left), 8, zone.clientWidth - NOTE_W - 8), y = clamp(Math.round(top), 8, zone.clientHeight - NOTE_H - 8);
  if (c.tool === 'brainly' && c.type !== 'link') store.updateCard(id, { meta: { x, y, folderId: null } });
  else {
    routeCard(id, { tool: 'brainly', type: 'note', meta: { x, y, emoji: smartEmoji(c.title) } });
    if (c.tool === 'brainly') store.updateCard(id, { type: 'note', meta: { x, y, emoji: smartEmoji(c.title) } }, { replaceMeta: true });
  }
});
registerDrop('brainly-folder', ({ id, data }) => {
  const c = store.getCard(id);
  if (!c) return false;
  const f = folders().find(x => x.id === data.folder);
  if (c.tool === 'brainly' && c.type !== 'link') store.updateCard(id, { meta: { folderId: data.folder } }, { log: true, logLabel: `Filed in ${f?.name}` });
  else {
    routeCard(id, { tool: 'brainly', type: 'note', meta: { folderId: data.folder, emoji: smartEmoji(c.title) } });
    if (c.tool === 'brainly') store.updateCard(id, { type: 'note', meta: { folderId: data.folder } }, { replaceMeta: true });
  }
  toast(`Filed in ${f?.name || 'folder'}`);
});

function saveFolder(id, patch) { store.set('brainFolders', folders().map(f => (f.id === id ? { ...f, ...patch } : f))); }
function freeSpot() {
  const n = canvasNotes().length + folders().length;
  const cols = Math.max(1, Math.floor(((canvas.clientWidth || 800) - 32) / 220));
  return { x: 24 + (n % cols) * 216, y: 24 + Math.floor(n / cols) * 120 };
}
function addNote(folderId = null) {
  const card = store.createCard({ type: 'note', tool: 'brainly', title: 'Untitled note', description: '', meta: { ...freeSpot(), emoji: '📝', folderId } });
  openNote(card.id, true);
}
function addFolder() {
  const f = { id: uuid(), name: 'New folder', color: ['#A796CB', '#8E9BC9', '#86AE95', '#C9A46E', '#C98E8E'][folders().length % 5], ...freeSpot() };
  store.set('brainFolders', [...folders(), f]);
  setTimeout(() => { const n = canvas.querySelector(`[data-folder="${f.id}"] .bf-name`); if (n) editInline(n, { onCommit: v => saveFolder(f.id, { name: v }) }); }, 60);
}
export function trashFolder(id) {
  const f = folders().find(x => x.id === id);
  if (!f) return;
  const notes = folderNotes(id);
  const prev = folders();
  notes.forEach(n => store.deleteCard(n.id, { silent: true }));
  store.set('brainFolders', prev.filter(x => x.id !== id));
  import('./sound.js').then(m => m.crunch());
  toast(`Deleted ${f.name}${notes.length ? ` and ${notes.length} note${notes.length === 1 ? '' : 's'}` : ''}`, {
    action: 'Undo', onAction: () => { store.set('brainFolders', prev); notes.forEach(n => store.restoreCard(n)); },
  });
}
function pickEmoji(anchor, id) {
  popover(anchor, h('div', { class: 'emoji-grid' }, EMOJI_CHOICES.map(e => h('button', {
    class: 'emoji-opt', onclick: () => { store.updateCard(id, { meta: { emoji: e } }); closePopovers(); },
  }, e))));
}
function pickFolderColor(anchor, f) {
  const COLORS = ['#A796CB', '#8E9BC9', '#86AE95', '#C9A46E', '#C98E8E', '#7FAEBE', '#9AA3AD', '#D1A0B8'];
  popover(anchor, h('div', { class: 'swatches' }, COLORS.map(col => h('button', {
    class: `swatch ${col === f.color ? 'on' : ''}`, style: { background: col }, 'aria-label': `Use color ${col}`,
    onclick: () => { saveFolder(f.id, { color: col }); closePopovers(); },
  }))));
}

function openFolder(fid) {
  const f = folders().find(x => x.id === fid);
  if (!f) return;
  const list = h('div', { class: 'modal-list' });
  const fill = () => {
    const notes = folderNotes(fid).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    list.replaceChildren(...notes.map(n => h('div', { class: 'activity-row clickable', onclick: () => openNote(n.id) },
      h('span', { class: 'note-emoji static' }, n.meta?.emoji || '📝'),
      h('span', { class: 'activity-text' }, n.title),
      h('button', { class: 'chip', onclick: e => { e.stopPropagation(); store.updateCard(n.id, { meta: { folderId: null, ...freeSpot() } }, { log: true, logLabel: 'Moved out of folder' }); setTimeout(fill, 30); } }, 'Move to canvas'))));
    if (!notes.length) list.append(h('p', { class: 'muted' }, 'This folder is empty. Drag notes onto it from the canvas.'));
  };
  fill();
  const unsub = store.on(fill);
  modal({ title: `${f.emoji || mostCommonEmoji(folderNotes(fid).map(n => n.title), '🗂️')}  ${f.name}`, body: list, wide: true, onClose: unsub,
    actions: [{ label: 'New note here', kind: 'ghost', onClick: () => addNote(fid) }] });
}

// ---------- Note editor: rich text + live dictation ----------
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

export function openNote(id, isNew = false) {
  const c = store.getCard(id);
  if (!c) return;
  const title = h('input', { class: 'field-input title-input', value: isNew ? '' : c.title, placeholder: 'Title', 'aria-label': 'Note title' });
  const emojiBtn = h('button', { class: 'note-emoji lg', 'aria-label': 'Change emoji', onclick: e => pickEmoji(e.currentTarget, id) }, c.meta?.emoji || smartEmoji(c.title));
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
  const save = () => {
    session?.stop();
    const t = title.value.trim() || firstText(editor) || 'Untitled note';
    const current = store.getCard(id)?.meta?.emoji;
    const emoji = current && current !== '📝' ? current : smartEmoji(`${t} ${editor.textContent}`, '📝');
    const html = sanitize(editor.innerHTML);
    const before = store.getCard(id);
    if (before.title === t && before.description === html && current === emoji) return;
    store.updateCard(id, { title: t, description: html, meta: { emoji } }, { log: true });
  };
  editor.addEventListener('keydown', e => e.stopPropagation());
  modal({
    title: '', wide: true, className: 'note-modal',
    body: h('div', { class: 'note-editor' }, h('div', { class: 'note-title-row' }, emojiBtn, title), toolbar, editor),
    actions: [{ label: 'Done', kind: 'primary' }],
    onClose: () => { session?.stop(); if (store.getCard(id)) save(); },
  });
  if (isNew) setTimeout(() => title.focus(), 80);
}
const firstText = el => (el.innerText || '').trim().split('\n')[0].slice(0, 60);
const escapeHtml = s => s.replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
