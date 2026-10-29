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
const details = c => {
  const d = flatten(c).replace(/\s+/g, ' ').trim();
  return d && d !== c.title ? d : '';
};
/** One task, written so the AI has what it needs. */
export function taskPrompt(c, ct) {
  const d = details(c);
  return `I'm working on ${ct?.name || 'a project'}${repoLine(ct)}. Please help with this task:\n\n${c.title}${d ? `\n${d}` : ''}\n\n`
    + `${ct?.repo ? 'Work in that repo. ' : ''}When you're done, summarize what you changed and anything I should check.${standing(ct)}`;
}
// A project's standing instructions ride along with every ship ("work on a branch, sandbox preview first").
const standing = ct => (ct?.shipNote?.trim() ? `\n\n${ct.shipNote.trim()}` : '');
/** Every open task in a list, in order. */
export function listPrompt(ct, cards) {
  const open = cards.filter(c => !c.meta?.done);
  const lines = open.map((c, i) => { const d = details(c); return `${i + 1}. ${c.title}${d ? ` - ${d}` : ''}`; }).join('\n');
  return `I'm working on ${ct.name}${repoLine(ct)}. Here are the open tasks, in order:\n\n${lines}\n\n`
    + `${ct.repo ? 'Work in that repo. ' : ''}Go through them one at a time. After each one, summarize what you changed and anything I should check before moving on.${standing(ct)}`;
}

/** Copy right away, inside the click, so it works in every browser. */
function copyText(text) {
  try { navigator.clipboard?.writeText(text).catch(() => {}); return true; } catch { return false; }
}
function sendTo(target, text) {
  store.setPref('builderTarget', target.id);
  copyText(text);
  if (!target.base) { toast('Copied. Paste it wherever you like.'); return; }
  const fits = target.open && text.length <= LIMIT;
  window.open(fits ? target.open(text) : target.base, '_blank', 'noopener');
  toast(fits ? `Opened ${target.label} with it typed in. Check it, then press send there.` : `Copied. Paste it into ${target.label}, check it, then press send.`, { duration: 6000 });
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
    return `- [${c.meta?.done ? 'x' : ' '}] ${c.title}${d ? `\n  ${d}` : ''}`;
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
  copyText(text);
  window.open(ct.shipUrl, '_blank', 'noopener');
  toast(`Copied and opened ${shipLabel(ct)}. Paste it in (⌘V or Ctrl V), check it, then send.`, { duration: 7000 });
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
