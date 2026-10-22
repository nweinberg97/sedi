// Sedi — "Your data": where your Sedi lives, what can erase it, and how to keep a copy.
// Plain answers, shown from the menu, once on first use, and as a weekly backup reminder.

import * as store from './store.js';
import { h, icon, modal, toast, relTime } from './util.js';

const WEEK = 7 * 864e5;
const browserName = () => {
  const ua = navigator.userAgent;
  if (/Edg\//.test(ua)) return 'Edge';
  if (/Firefox\//.test(ua)) return 'Firefox';
  if (/Chrome\//.test(ua) && !/OPR\//.test(ua)) return 'Chrome';
  if (/Safari\//.test(ua)) return 'Safari';
  return 'this browser';
};
const isSafari = () => browserName() === 'Safari';
const installed = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

/** Call after a successful Download data, so reminders know when the last backup was. */
export function markBackedUp() { store.setPref('lastBackupAt', new Date().toISOString()); }

export async function openDataInfo({ onBackup, onImport } = {}) {
  const persisted = await navigator.storage?.persisted?.().catch(() => false);
  const est = await navigator.storage?.estimate?.().catch(() => null);
  const last = store.pref('lastBackupAt');
  const cards = store.allCards().length;
  const mb = est?.usage ? Math.max(0.1, est.usage / 1e6).toFixed(1) : null;
  const row = (ic, label, value, tone = '') => h('div', { class: `di-row ${tone}` }, icon(ic), h('span', { class: 'di-label' }, label), h('b', {}, value));
  const status = h('div', { class: 'di-status' },
    row('lock', 'Stored', `In ${browserName()} on this device`),
    row('archive', 'What’s saved', `${cards} card${cards === 1 ? '' : 's'}${mb ? ` · about ${mb} MB with downloads` : ''}`),
    row('check', 'Kept when space runs low', persisted ? 'Yes' : 'Not yet', persisted ? 'ok' : 'warn'),
    row('download', 'Last backup', last ? relTime(last) : 'Never', last && Date.now() - new Date(last) < 2 * WEEK ? 'ok' : 'warn'));
  const safariNote = isSafari() && !installed()
    ? h('p', { class: 'di-callout' }, icon('bell'), h('span', {}, h('b', {}, 'Safari tip: '), 'Safari can delete a site’s data if you haven’t opened it for about a week. To keep Sedi safe, add it to your Dock (Mac: File → Add to Dock) or Home Screen (iPhone: Share → Add to Home Screen), and keep a backup.'))
    : null;
  const qa = (q, a) => h('details', { class: 'di-qa' }, h('summary', {}, q), h('p', {}, a));
  modal({
    title: 'Your data', wide: true, className: 'data-info',
    body: h('div', { class: 'di' },
      h('p', { class: 'di-lede' }, 'Sedi has no accounts and no server. Everything you make lives in this browser on this device, which keeps it private. It also means your browser is the only copy, unless you save a backup.'),
      status, safariNote,
      h('h4', { class: 'di-h' }, 'What can erase it'),
      h('ul', { class: 'di-list' },
        h('li', {}, h('b', {}, 'Clearing site data. '), `In ${browserName() === 'this browser' ? 'your browser' : browserName()}’s settings, clearing “cookies and site data” (or “history and website data” in Safari) for this site erases Sedi. Clearing only cached images and files does not.`),
        h('li', {}, h('b', {}, 'Private or incognito windows. '), 'Anything you make there is gone when the window closes.'),
        h('li', {}, h('b', {}, 'A new browser, profile or device. '), 'Each one starts empty. Sedi doesn’t sync yet, so move your data with a backup.'),
        h('li', {}, h('b', {}, 'Clear storage in Sedi’s menu. '), 'It asks twice, then erases everything here.')),
      h('h4', { class: 'di-h' }, 'How to keep it safe'),
      h('ul', { class: 'di-list' },
        h('li', {}, h('b', {}, 'Download a backup now and then. '), 'Menu → Download data saves everything (cards, notes, plans and PDFs) as one file. Keep it somewhere you trust, like iCloud Drive or Google Drive.'),
        h('li', {}, h('b', {}, 'Restore or move. '), 'Menu → Import data loads a backup into any browser. Choose Merge to add to what’s there, or Replace to swap it in.'),
        h('li', {}, h('b', {}, 'Install Sedi. '), 'Adding it to your Dock or Home Screen makes the browser treat it like an app and keep its data.')),
      h('div', { class: 'di-faq' },
        qa('Does clearing my cache delete Sedi?', 'Usually not. Clearing “cached images and files” leaves Sedi alone. Clearing “cookies and site data”, or all history and website data, deletes it.'),
        qa('Do downloaded voice and AI models count?', 'They’re stored in the browser cache, apart from your cards. If they’re cleared, Sedi downloads them again the next time you use voice or the on-device AI. Your cards aren’t affected.'),
        qa('Can I use Sedi on my phone and my computer?', 'Yes, but each keeps its own copy for now. Move things between them with Download data and Import data. Sync is coming with the Mac and iPhone apps.'),
        qa('Does anyone else see my data?', 'No. There’s no Sedi server. Only services you connect yourself (like Google, or an AI provider with your own key) receive what you send them.'))),
    actions: [
      { label: 'Import a backup', kind: 'ghost', onClick: () => onImport?.() },
      { label: 'Download a backup', kind: 'primary', onClick: () => onBackup?.() },
    ],
  });
  if (!persisted) navigator.storage?.persist?.().catch(() => {});
  store.setPref('dataInfoSeen', true);
}

/** First use: one quiet hint. Afterwards: a weekly backup reminder once there's something worth keeping. */
export function dataNudges({ onBackup, onOpen } = {}) {
  const now = Date.now();
  if (!store.pref('firstOpenAt')) store.setPref('firstOpenAt', new Date().toISOString());
  if (!store.pref('keepCardDone')) {
    // Once, after people have had a moment to look around: how to keep Sedi (and their notes) safe.
    setTimeout(() => showKeepCard({ onBackup, onOpen }), store.pref('firstOpenAt') && now - new Date(store.pref('firstOpenAt')) > 60e3 ? 4000 : 25000);
    return;
  }
  const userCards = store.allCards().filter(c => c.createdAt > (store.pref('firstOpenAt') || '')).length;
  const last = store.pref('lastBackupAt');
  const lastNudge = store.pref('backupNudgeAt');
  const due = userCards >= 10 && (!last || now - new Date(last) > WEEK) && (!lastNudge || now - new Date(lastNudge) > WEEK)
    && now - new Date(store.pref('firstOpenAt')) > 2 * 864e5;
  if (!due) return;
  store.setPref('backupNudgeAt', new Date().toISOString());
  setTimeout(() => toast(last ? `Your last backup was ${relTime(last)}. Save a fresh copy?` : 'You haven’t saved a backup yet. Your browser holds the only copy.', { action: 'Download', onAction: onBackup, duration: 10000 }), 5000);
}

// ---------- "Keep Sedi handy" card: install / bookmark, plus where the data lives ----------
let installEvent = null;
addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvent = e; });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installHow() {
  const ua = navigator.userAgent, iOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
  const safari = /Safari\//.test(ua) && !/Chrome|CriOS|Edg|FxiOS|Firefox/.test(ua);
  if (standalone()) return null;
  if (installEvent) return { text: 'Install Sedi as an app so it’s always one tap away.', button: 'Install' };
  if (iOS) return { text: 'Add Sedi to your Home Screen: tap Share, then “Add to Home Screen”. It also stops Safari clearing your data.' };
  if (safari) return { text: 'Add Sedi to your Dock: choose File → “Add to Dock”. It also stops Safari clearing your data.' };
  return { text: `Bookmark Sedi so you can find it again (${/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl+'}D).` };
}
export function showKeepCard({ onBackup, onOpen } = {}) {
  if (document.querySelector('.keep-card') || store.pref('keepCardDone')) return;
  const how = installHow();
  const done = () => { store.setPref('keepCardDone', true); navigator.storage?.persist?.().catch(() => {}); card.classList.remove('in'); setTimeout(() => card.remove(), 250); };
  const card = h('aside', { class: 'keep-card', role: 'dialog', 'aria-label': 'Keep Sedi handy' },
    h('button', { class: 'icon-btn xs keep-x', 'aria-label': 'Dismiss', onclick: done }, icon('x')),
    h('strong', {}, 'Keep Sedi handy'),
    how ? h('p', {}, how.text) : null,
    h('p', {}, 'Everything you make lives in this browser, with no account. Download a backup now and then.'),
    h('div', { class: 'keep-actions' },
      how?.button ? h('button', { class: 'btn sm primary', onclick: async () => { installEvent?.prompt(); try { await installEvent?.userChoice; } catch {} installEvent = null; done(); } }, how.button) : null,
      h('button', { class: `btn sm ${how?.button ? 'ghost' : 'primary'}`, onclick: () => { onBackup?.(); done(); } }, 'Back up now'),
      h('button', { class: 'btn sm ghost', onclick: () => { onOpen?.(); done(); } }, 'Learn more')));
  document.body.append(card);
  requestAnimationFrame(() => card.classList.add('in'));
}
