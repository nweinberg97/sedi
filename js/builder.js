// Sedi — Builder mode, for people who build software. Plan in Sedi, build anywhere: each project list in
// Timely can name its repo, and any task (or a whole list) can be sent to an AI app with everything it
// needs typed in. Sedi only opens a link in your browser; you read the message and press send yourself.
// Nothing is connected, no keys are stored, and the work happens in your own account on that app.

import * as store from './store.js';
import { h, icon, toast, popover, closePopovers, modal } from './util.js';
import { flatten } from './cards.js';

export const builderOn = () => store.pref('builderMode') === true;
const LIMIT = 3500; // links can only carry so much; longer messages are copied for pasting instead

const TARGETS = [
  { id: 'claude', label: 'Claude', open: q => `https://claude.ai/new?q=${encodeURIComponent(q)}`, base: 'https://claude.ai/new' },
  { id: 'chatgpt', label: 'ChatGPT', open: q => `https://chatgpt.com/?q=${encodeURIComponent(q)}`, base: 'https://chatgpt.com/' },
  { id: 'perplexity', label: 'Perplexity', open: q => `https://www.perplexity.ai/search?q=${encodeURIComponent(q)}`, base: 'https://www.perplexity.ai/' },
  { id: 'gemini', label: 'Gemini', open: null, base: 'https://gemini.google.com/app' },
  { id: 'copy', label: 'Just copy it', open: null, base: null },
];

const repoLine = ct => (ct?.repo ? ` (repo: ${ct.repo})` : '');
// A long title is shortened on its card ("Fix the thing that…") with the rest carried into the notes
// ("…breaks on Safari"). An AI should read the whole sentence, so the two halves are joined back up here.
function parts(c) {
  let title = c.title || '';
  let d = flatten(c);
  if (/…$/.test(title)) {
    const lines = d.split(/\n|<\/div>|<br\s*\/?>/).map(x => x.replace(/<[^>]+>/g, '').trim());
    if (lines[0]?.startsWith('…')) {
      title = `${title.slice(0, -1)} ${lines[0].slice(1)}`.replace(/\s+/g, ' ').trim();
      d = lines.slice(1).join(' ');
    }
  }
  d = d.replace(/\s+/g, ' ').trim();
  return { title, d: d && d !== title ? d : '' };
}
const details = c => parts(c).d;
const fullTitle = c => parts(c).title;
/** One task, written so the AI has what it needs. */
export function taskPrompt(c, ct) {
  const d = details(c);
  return `I'm working on ${ct?.name || 'a project'}${repoLine(ct)}. Please help with this task:\n\n${fullTitle(c)}${d ? `\n${d}` : ''}\n\n`
    + `${ct?.repo ? 'Work in that repo. ' : ''}When you're done, summarize what you changed and anything I should check.${standing(ct)}`;
}
// A project's standing instructions ride along with every ship ("work on a branch, sandbox preview first").
const standing = ct => (ct?.shipNote?.trim() ? `\n\n${ct.shipNote.trim()}` : '');
/** Every open task in a list, in order. */
export function listPrompt(ct, cards) {
  const open = cards.filter(c => !c.meta?.done);
  const lines = open.map((c, i) => { const d = details(c); return `${i + 1}. ${fullTitle(c)}${d ? `\n   ${d}` : ''}`; }).join('\n');
  return `I'm working on ${ct.name}${repoLine(ct)}. Here are the open tasks, in order:\n\n${lines}\n\n`
    + `${ct.repo ? 'Work in that repo. ' : ''}Go through them one at a time. After each one, summarize what you changed and anything I should check before moving on.${standing(ct)}`;
}

/** Copy right now, inside the click, before a new tab takes focus. The async clipboard API finishes *after*
 *  the click, and by then the new tab has focus, so Safari and others quietly drop it. execCommand('copy') on a
 *  selected text box is synchronous and works everywhere; the async API is only the fallback. */
export function copyPlainNow(text) {
  const box = h('textarea', { 'aria-hidden': 'true', readonly: true, style: { position: 'fixed', left: '-9999px', top: '0', opacity: '0', width: '1px', height: '1px' } });
  box.value = text;
  document.body.append(box);
  const prev = document.activeElement;
  box.focus({ preventScroll: true }); box.select(); box.setSelectionRange(0, text.length);
  let ok = false;
  const onCopy = e => { if (!e.clipboardData) return; e.clipboardData.setData('text/plain', text); e.preventDefault(); };
  document.addEventListener('copy', onCopy, { once: true });
  try { ok = document.execCommand('copy'); } catch {}
  document.removeEventListener('copy', onCopy);
  box.remove();
  prev?.focus?.({ preventScroll: true });
  if (!ok) { try { navigator.clipboard?.writeText(text).then(() => {}, () => {}); } catch {} }
  return ok;
}
const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
const touch = () => matchMedia('(hover: none)').matches;
const pasteHow = where => (touch() ? `Open ${where}, press and hold in the message box, tap Paste, then send.` : `Paste it into ${where} (${isMac ? '⌘V' : 'Ctrl+V'}), check it, then send.`);
const pasteKeys = () => (touch() ? 'press and hold, then Paste' : isMac ? '⌘V' : 'Ctrl+V');

// After a hand-off, a small card stays on the Sedi tab: what was copied, where it went, and "Copy again" in
// case something else landed on the clipboard in between. It goes away when you're done with it.
let pasteCard = null;
function showPasteCard(text, where, { failed = false, openLink = null } = {}) {
  pasteCard?.remove();
  const count = (text.match(/^\s*(?:\d+\.|- \[[ x]\])\s/gm) || []).length;
  const what = count > 1 ? `${count} tasks` : 'the message';
  const preview = h('textarea', { class: 'pc-text', readonly: true, rows: 6, 'aria-label': 'The message' });
  preview.value = text;
  preview.hidden = !failed;
  const copyBtn = h('button', { class: `btn sm ${failed ? 'primary' : 'ghost'}`, type: 'button', onclick: () => {
    const ok = copyPlainNow(text);
    if (failed && openLink) window.open(openLink, '_blank', 'noopener');
    say(ok ? `Copied ${what}. ${pasteHow(where)}` : 'Your browser blocked copying. Select the text below and copy it.');
    if (!ok) { preview.hidden = false; preview.focus(); preview.select(); }
  } }, icon('copy'), failed && openLink ? `Copy and open ${where}` : 'Copy again');
  const showBtn = h('button', { class: 'btn sm ghost', type: 'button', onclick: () => { preview.hidden = !preview.hidden; showBtn.textContent = preview.hidden ? 'Show text' : 'Hide text'; } }, failed ? 'Hide text' : 'Show text');
  const msg = h('p', { class: 'pc-msg' });
  const say = t => (msg.textContent = t);
  say(failed ? `Your browser didn’t let Sedi copy on its own. Tap below to copy ${what}, then paste into ${where}.` : `Copied ${what}. ${pasteHow(where)}`);
  pasteCard = h('div', { class: 'paste-card', role: 'status' },
    h('div', { class: 'pc-row' }, h('span', { class: 'pc-ic' }, icon('send')), msg,
      h('button', { class: 'icon-btn xs pc-x', type: 'button', 'aria-label': 'Done', onclick: () => { pasteCard?.remove(); pasteCard = null; } }, icon('x'))),
    preview,
    h('div', { class: 'pc-actions' }, copyBtn, showBtn));
  document.body.append(pasteCard);
  clearTimeout(showPasteCard.t);
  showPasteCard.t = setTimeout(() => { pasteCard?.remove(); pasteCard = null; }, 5 * 60e3);
}

function sendTo(target, text) {
  store.setPref('builderTarget', target.id);
  const copied = copyPlainNow(text);
  if (!target.base) { if (copied) toast('Copied. Paste it wherever you like.'); else showPasteCard(text, 'the app you use', { failed: true }); return; }
  const fits = target.open && text.length <= LIMIT;
  const link = fits ? target.open(text) : target.base;
  // If the copy failed and the app can't be pre-filled, don't open a blank chat: copy with the next click first.
  if (!copied && !fits) { showPasteCard(text, target.label, { failed: true, openLink: link }); return; }
  window.open(link, '_blank', 'noopener');
  if (fits) toast(`Opened ${target.label} with it typed in. If the box is empty, paste it (${pasteKeys()}). Then send.`, { duration: 7000 });
  else showPasteCard(text, target.label);
}

/** The "Hand off to…" menu. The last choice comes first, so it's one tap next time. */
export function openSendMenu(anchor, getText, { title = 'Hand off to' } = {}) {
  const last = store.pref('builderTarget', 'claude');
  const order = [...TARGETS].sort((a, b) => (b.id === last) - (a.id === last));
  popover(anchor, h('div', { class: 'send-menu' },
    h('p', { class: 'send-head' }, title),
    ...order.map(t => h('button', { class: `send-item ${t.id === last ? 'last' : ''}`, type: 'button', onclick: () => { closePopovers(); sendTo(t, getText()); } },
      h('span', {}, t.label), t.id === last ? h('small', {}, 'Last used') : null)),
    h('p', { class: 'send-note' }, 'Opens the app with this typed in. You press send there; Sedi sends nothing itself.')), { className: 'send-pop' });
}

export const sendButton = (getText, label = 'Hand off to an AI app') => h('button', {
  class: 'card-tool card-send', type: 'button', 'aria-label': label, title: label,
  onclick: e => { e.stopPropagation(); openSendMenu(e.currentTarget, getText); },
}, icon('send'));

/** Turning it on the first time says plainly what it does and doesn't do. */
export function toggleBuilder(onChange) {
  if (builderOn()) { store.setPref('builderMode', false); onChange?.(); return; }
  modal({
    title: 'Builder mode',
    body: h('div', { class: 'builder-intro' },
      h('p', {}, 'For people who build software. Plan in Sedi, build anywhere.'),
      h('ul', {},
        h('li', {}, 'Each project can name its repo, like ', h('code', {}, 'yourname/app'), '.'),
        h('li', {}, h('b', {}, 'Ship'), ' on a task sends it, with its notes and the repo, to the chat that builds the project.'),
        h('li', {}, h('b', {}, 'Ship all'), ' does the same for every open task in a project.'),
        h('li', {}, h('b', {}, 'Ship settings'), ' on a project: paste the link of your Claude chat for that repo, and add instructions that go with every ship.')),
      h('p', { class: 'muted small' }, 'You read the message and press send yourself. Sedi doesn’t connect to those apps, store any keys, or send anything on its own. The work happens in your own account there.')),
    actions: [{ label: 'Not now', kind: 'ghost' }, { label: 'Turn on', kind: 'primary', onClick: () => { store.setPref('builderMode', true); onChange?.(); } }],
  });
}

/** Any list, written as a plain Markdown checklist, for any AI app (or anywhere you paste it). */
export function listMarkdown(name, cards) {
  const lines = cards.map(c => {
    const d = details(c);
    return `- [${c.meta?.done ? 'x' : ' '}] ${fullTitle(c)}${d ? `\n  ${d}` : ''}`;
  }).join('\n');
  return `Here is my list "${name}" from Sedi:\n\n${lines}\n\n`;
}
/** A quiet "Send list" button: opens Claude, ChatGPT or another app with the list typed in, or copies it. */
export const sendListButton = (name, getCards, cls = '') => h('button', {
  class: `icon-btn xs send-list ${cls}`, type: 'button', 'aria-label': `Hand off “${name}” to an AI app, or copy it`, title: 'Hand off: open this list in Claude, ChatGPT… or copy it',
  onpointerdown: e => e.stopPropagation(),
  onclick: e => {
    e.stopPropagation();
    const cards = getCards();
    if (!cards.length) { toast('Nothing in this list yet.'); return; }
    openSendMenu(e.currentTarget, () => listMarkdown(name, getCards()), { title: `Hand off “${name}” (${cards.length}) to` });
  },
}, icon('send'));

// ---------- Ship: a project's tickets go to the chat that works on it ----------
// Each project can name the exact chat that builds it (a Claude chat or Claude Code session, a ChatGPT chat):
// paste that chat's link once. Ship then opens that chat with the ticket ready to paste. Chat apps only let a
// link type into a *new* chat, so for a specific chat Sedi copies the message and you paste and send.
// No link set: Ship works like Hand off and opens a new chat with the message typed in.
const SAFE_LINK = /^https:\/\/[^\s/$.?#][^\s]*$/i;
export const shipLabel = ct => {
  if (!ct?.shipUrl) return 'a new chat';
  try { const host = new URL(ct.shipUrl).hostname.replace(/^www\./, ''); return host.includes('claude') ? 'your Claude chat' : host.includes('chatgpt') ? 'your ChatGPT chat' : host.includes('gemini') ? 'your Gemini chat' : host; } catch { return 'your chat'; }
};
export function ship(ct, getText, anchor, { title } = {}) {
  if (!ct?.shipUrl) return openSendMenu(anchor, getText, { title: title || 'Ship to' });
  const text = getText();
  const where = shipLabel(ct);
  // A link to one particular chat can't be typed into by anyone but you, so the message goes on the clipboard
  // first (synchronously, inside this click) and stays one tap away on the Sedi tab.
  const copied = copyPlainNow(text);
  if (!copied) { showPasteCard(text, where, { failed: true, openLink: ct.shipUrl }); return; }
  window.open(ct.shipUrl, '_blank', 'noopener');
  showPasteCard(text, where);
}
export const shipButton = (getCt, getText, label) => h('button', {
  class: 'card-tool card-send', type: 'button', 'aria-label': label, title: label,
  onclick: e => { e.stopPropagation(); ship(getCt(), getText, e.currentTarget); },
}, icon('send'));
/** Where a project ships, its repo, and the instructions that go with every ship. */
export function openShipSettings(anchor, ct, onSave) {
  const repo = h('input', { class: 'field-input sm', value: ct.repo || '', placeholder: 'yourname/app', spellcheck: false });
  const link = h('input', { class: 'field-input sm', value: ct.shipUrl || '', placeholder: 'https://claude.ai/chat/…', spellcheck: false, inputmode: 'url' });
  const note = h('textarea', { class: 'field-input sm', rows: 3, placeholder: 'For example: Work on a branch. Show me a sandbox preview before merging.' });
  note.value = ct.shipNote || '';
  const err = h('p', { class: 'small ship-err', hidden: true }, 'That needs to be a full https:// link.');
  [repo, link, note].forEach(i => i.addEventListener('keydown', e => e.stopPropagation()));
  const save = () => {
    const url = link.value.trim();
    if (url && !SAFE_LINK.test(url)) { err.hidden = false; link.focus(); return; }
    onSave({ repo: repo.value.trim() || undefined, shipUrl: url || undefined, shipNote: note.value.trim() || undefined });
    closePopovers();
    toast(url ? `${ct.name} now ships to ${shipLabel({ shipUrl: url })}.` : `${ct.name} ships to a new chat.`);
  };
  popover(anchor, h('div', { class: 'ship-set' },
    h('strong', {}, `Ship settings · ${ct.name}`),
    h('label', { class: 'field-label' }, 'Repo'), repo,
    h('label', { class: 'field-label' }, 'The chat that builds it'), link,
    h('p', { class: 'muted small' }, 'Open the Claude chat or Claude Code session that works on this repo, copy the link from the address bar, and paste it here. Leave it empty to start a new chat each time.'),
    err,
    h('label', { class: 'field-label' }, 'Instructions for every ship'), note,
    h('div', { class: 'ship-actions' }, h('button', { class: 'btn primary sm', type: 'button', onclick: save }, 'Save'))), { className: 'ship-pop' });
}
