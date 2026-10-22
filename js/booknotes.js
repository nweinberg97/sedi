// Sedi — Book notes: short, original summaries of books about habits, focus and wellbeing.
// Each note credits its author and recommends the book. Nothing is quoted from the books.

import * as store from './store.js';
import { h, icon, modal, toast, uuid } from './util.js';

const FOLDER_NAME = 'Book notes';
let cache = null;

export async function loadLibrary() {
  if (cache) return cache;
  const res = await fetch(new URL('../brain/library.json', import.meta.url));
  if (!res.ok) throw new Error('Couldn’t load the book notes');
  cache = await res.json();
  return cache;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** The note body: plain tags the Brainly editor accepts. */
export function noteHtml(b) {
  return [
    `<p><i>A summary of <b>${esc(b.title)}</b> by ${esc(b.author)} (${b.year}), written in Sedi’s own words. Read the book for the full picture.</i></p>`,
    `<h3>The big idea</h3><p>${esc(b.bigIdea)}</p>`,
    `<h3>Key ideas</h3><ul>${b.ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul>`,
    `<h3>Try this</h3><p>${esc(b.tryThis)}</p>`,
    `<h3>In Sedi</h3><p>${esc(b.inSedi)}</p>`,
    `<p><i>Source: ${esc(b.author)}, ${esc(b.title)} (${b.year}). Sedi isn’t affiliated with the author or publisher.</i></p>`,
  ].join('');
}

function bookFolder() {
  const all = store.get('brainFolders', []);
  let f = all.find(x => x.bookNotes) || all.find(x => x.name === FOLDER_NAME && !x.parentId);
  if (!f) {
    f = { id: uuid(), name: FOLDER_NAME, emoji: '📚', color: '#C9A46E', bookNotes: true, x: 24 + (all.length % 4) * 156, y: 200 };
    store.set('brainFolders', [...all, f], { silent: true });
  }
  return f;
}
const added = () => new Set(store.cardsWhere(c => c.tool === 'brainly' && c.meta?.bookId).map(c => c.meta.bookId));

function addBooks(books) {
  const have = added();
  const all = cache?.books || books;
  const todo = books.filter(b => !have.has(b.id));
  if (!todo.length) return 0;
  const folder = bookFolder();
  todo.forEach(b => store.createCard({
    type: 'note', tool: 'brainly', title: b.title, description: noteHtml(b),
    meta: { folderId: folder.id, emoji: b.emoji || '📚', bookId: b.id, bookOrder: all.indexOf(b), author: b.author },
  }, { silent: true }));
  store.notify({ reason: 'book-notes' });
  return todo.length;
}

export async function openBookNotes() {
  let lib;
  try { lib = await loadLibrary(); } catch (e) { toast(e.message); return; }
  const have = added();
  const rows = lib.books.map(b => {
    const btn = h('button', { class: 'btn sm ghost', disabled: have.has(b.id) || null }, have.has(b.id) ? 'Added' : 'Add');
    btn.onclick = () => { if (addBooks([b])) { btn.textContent = 'Added'; btn.disabled = true; toast(`Added “${b.title}” to ${FOLDER_NAME} in Brainly`); } };
    return h('li', { class: 'bn-row' },
      h('span', { class: 'bn-emoji', 'aria-hidden': 'true' }, b.emoji || '📚'),
      h('span', { class: 'bn-text' }, h('b', {}, b.title), h('small', {}, `${b.author} · ${b.year}`)),
      btn);
  });
  const body = h('div', { class: 'book-notes' },
    h('p', {}, 'One-page notes on books about habits, focus and feeling good: the big idea, a few key lessons, one thing to try, and how to do it in Sedi.'),
    h('p', { class: 'muted' }, 'Every note is our own short summary, credits its author, and is no substitute for the book. If one resonates, please read it — these authors did the real work.'),
    h('ul', { class: 'bn-list' }, rows),
    h('a', { class: 'bn-print', href: new URL('../welcome/book-notes.html', import.meta.url).href, target: '_blank', rel: 'noopener' }, icon('download'), 'Printable version (save as PDF)'));
  modal({
    title: 'Book notes', body, className: 'book-notes-modal',
    actions: [
      { label: 'Close', kind: 'ghost' },
      { label: 'Add all to Brainly', kind: 'primary', onClick: () => {
        const n = addBooks(lib.books);
        toast(n ? `Added ${n} book note${n === 1 ? '' : 's'} to ${FOLDER_NAME} in Brainly` : 'All the book notes are already in Brainly', { action: 'Open', onAction: () => { location.hash = '#/brainly'; } });
      } },
    ],
  });
}
