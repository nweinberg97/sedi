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
    + `${ct?.repo ? 'Work in that repo. ' : ''}When you're done, summarize what you changed and anything I should check.`;
}
/** Every open task in a list, in order. */
export function listPrompt(ct, cards) {
  const open = cards.filter(c => !c.meta?.done);
  const lines = open.map((c, i) => { const d = details(c); return `${i + 1}. ${c.title}${d ? ` - ${d}` : ''}`; }).join('\n');
  return `I'm working on ${ct.name}${repoLine(ct)}. Here are the open tasks, in order:\n\n${lines}\n\n`
    + `${ct.repo ? 'Work in that repo. ' : ''}Go through them one at a time. After each one, summarize what you changed and anything I should check before moving on.`;
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

/** The "Send to…" menu. The last choice comes first, so it's one tap next time. */
export function openSendMenu(anchor, getText, { title = 'Send to' } = {}) {
  const last = store.pref('builderTarget', 'claude');
  const order = [...TARGETS].sort((a, b) => (b.id === last) - (a.id === last));
  popover(anchor, h('div', { class: 'send-menu' },
    h('p', { class: 'send-head' }, title),
    ...order.map(t => h('button', { class: `send-item ${t.id === last ? 'last' : ''}`, type: 'button', onclick: () => { closePopovers(); sendTo(t, getText()); } },
      h('span', {}, t.label), t.id === last ? h('small', {}, 'Last used') : null)),
    h('p', { class: 'send-note' }, 'Opens the app with this typed in. You press send there; Sedi sends nothing itself.')), { className: 'send-pop' });
}

export const sendButton = (getText, label = 'Send to an AI app') => h('button', {
  class: 'card-tool card-send', type: 'button', 'aria-label': label, title: label,
  onpointerdown: e => e.stopPropagation(),
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
        h('li', {}, h('b', {}, 'Send to…'), ' on a task opens Claude, ChatGPT or another AI app with the task, its notes and the repo typed in.'),
        h('li', {}, h('b', {}, 'Send all'), ' does the same for every open task in a project.')),
      h('p', { class: 'muted small' }, 'You read the message and press send yourself. Sedi doesn’t connect to those apps, store any keys, or send anything on its own. The work happens in your own account there.')),
    actions: [{ label: 'Not now', kind: 'ghost' }, { label: 'Turn on', kind: 'primary', onClick: () => { store.setPref('builderMode', true); onChange?.(); } }],
  });
}
