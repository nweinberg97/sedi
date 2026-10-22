// Sedi — By Design lessons: one principle, framework, system and practice per book.
// Original summaries with numbered sources; each credits its author and recommends the book.

import * as store from './store.js';
import { h, icon, modal, toast, uuid } from './util.js';

const FOLDER_NAME = 'By Design';
let cache = null;

export async function loadLibrary() {
  if (cache) return cache;
  const res = await fetch(new URL('../brain/library.json', import.meta.url));
  if (!res.ok) throw new Error('Couldn’t load the book notes');
  cache = await res.json();
  return cache;
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// **bold** and *italic*; [n] footnote markers stay as text and match the numbered Sources list.
const md = s => esc(s ?? '').replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\*(.+?)\*/g, '<i>$1</i>');
const cite = src => (src?.length ? ` [${src.join(',')}]` : '');
const tag = o => (o ? ` (${esc(o)} application)` : '');

/** The note body: only tags the Brainly editor accepts (no links or superscripts). */
export function noteHtml(b) {
  const f = b.framework, s = b.system;
  return [
    `<p><i>Lesson · ${esc(b.discipline)}. A summary of <b>${esc(b.title)}</b> by ${esc(b.author)} (${b.year}), written in our own words. Read the book for the full picture.</i></p>`,
    `<p>${md(b.about)}</p>`,
    `<h3>Principle: ${esc(b.principle.name)}${cite(b.principle.src)}${tag(b.principle.origin)}</h3><p>${md(b.principle.body)}</p>`,
    `<h3>Framework: ${esc(f.name)}${f.formula ? ` (${esc(f.formula)})` : ''}${cite(f.src)}${tag(f.origin)}</h3>`,
    f.intro ? `<p>${md(f.intro)}</p>` : '',
    `<ol>${f.parts.map(p => `<li><b>${esc(p.name)}</b>${p.tagline ? ` · <i>${esc(p.tagline)}</i>` : ''}${cite(p.src)}<br>${md(p.what)}${p.how?.length ? `<ul>${p.how.map(x => `<li>${md(x)}</li>`).join('')}</ul>` : ''}</li>`).join('')}</ol>`,
    f.note ? `<p><i>${md(f.note)}</i></p>` : '',
    `<h3>System: ${esc(s.name)}${cite(s.src)}${tag(s.origin)}</h3>`,
    s.intro ? `<p>${md(s.intro)}</p>` : '',
    `<ol>${s.steps.map(x => `<li><b>${esc(x.name)}</b>: ${md(x.detail)}</li>`).join('')}</ol>`,
    `<h3>Reflect</h3><ul>${b.reflect.map(q => `<li><i>${md(q)}</i></li>`).join('')}</ul>`,
    `<h3>Practice (${esc(b.practice.time)})${cite(b.practice.src)}${tag(b.practice.origin)}</h3><ol>${b.practice.steps.map(x => `<li>${md(x)}</li>`).join('')}</ol>`,
    b.inSedi ? `<p><b>In Sedi:</b> ${md(b.inSedi)}</p>` : '',
    `<h4>Sources</h4><ol>${b.sources.map(x => `<li>${md(x.text)}${x.url ? ` ${esc(x.url)}` : ''}</li>`).join('')}</ol>`,
    `<p><i>Items marked “By Design application” are our application of the book's ideas, not the author's. Named frameworks belong to their authors. Sedi isn't affiliated with any author or publisher.</i></p>`,
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
      h('span', { class: 'bn-text' }, h('b', {}, b.title), h('small', {}, `${b.author} · ${b.discipline}`)),
      btn);
  });
  const body = h('div', { class: 'book-notes' },
    h('p', {}, 'Lessons on behavior design from great books. Each one gives you a principle, the book’s framework, a system to apply it, and a practice to try today.'),
    h('p', { class: 'muted' }, 'Every lesson is our own summary with numbered sources, credits its author, and is no substitute for the book. If one resonates, please read it. These authors did the real work.'),
    h('ul', { class: 'bn-list' }, rows),
    h('a', { class: 'bn-print', href: new URL('../welcome/by-design.html', import.meta.url).href, target: '_blank', rel: 'noopener' }, icon('download'), 'Read online or save as PDF'));
  modal({
    title: 'By Design', body, className: 'book-notes-modal',
    actions: [
      { label: 'Close', kind: 'ghost' },
      { label: 'Add all to Brainly', kind: 'primary', onClick: () => {
        const n = addBooks(lib.books);
        toast(n ? `Added ${n} lesson${n === 1 ? '' : 's'} to ${FOLDER_NAME} in Brainly` : 'All the lessons are already in Brainly', { action: 'Open', onAction: () => { location.hash = '#/brainly'; } });
      } },
    ],
  });
}
