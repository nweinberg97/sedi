// Sedi — Google account (optional). Lets Brainly create a Google Doc from a note and upload a PDF to Drive.
// Uses Google's own sign-in window (Google Identity Services) with the narrow "drive.file" permission:
// Sedi can only see files it created, nothing else in your Drive. Nothing loads until you press Connect.
// One-time setup: a free Google Cloud "OAuth client ID" for this site (steps in the panel).

import * as store from './store.js';
import { h, icon, modal, toast } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
// Calendar: the narrowest permission Google offers. Sedi can make its own "Sedi" calendar and manage the events
// on it, and nothing else: it can't see or touch your other calendars.
export const CAL_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created';
const tokens = {}; // scope → { token, exp }
let gisLoading = null;

// Sedi's own Google client ID for this site. With it, people just press Connect (no Google Cloud setup).
// Empty until the site owner creates one; a client ID pasted in the Google panel still works as before.
export const SEDI_CLIENT_ID = '';
export const clientId = () => store.pref('googleClientId', '') || SEDI_CLIENT_ID;
export const isSetUp = () => !!clientId();

function loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  if (gisLoading) return gisLoading;
  gisLoading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('Couldn’t reach Google. Check your connection.')); };
    document.head.append(s);
  });
  return gisLoading;
}

/** Ask Google for a short-lived access token (shows Google's sign-in window the first time). */
export async function getToken(scope = SCOPE) {
  const t = tokens[scope];
  if (t && Date.now() < t.exp - 60e3) return t.token;
  if (!isSetUp()) { openGooglePanel(); throw new Error('Set up your Google account first.'); }
  await loadGis();
  const seenKey = scope === SCOPE ? 'googleConnected' : 'googleCalConnected';
  return new Promise((resolve, reject) => {
    const client = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope, include_granted_scopes: true,
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        if (window.google.accounts.oauth2.hasGrantedAllScopes && !window.google.accounts.oauth2.hasGrantedAllScopes(r, scope)) return reject(new Error('Google didn’t give Sedi permission. Try again and tick the box.'));
        tokens[scope] = { token: r.access_token, exp: Date.now() + (r.expires_in || 3600) * 1000 };
        store.setPref(seenKey, true);
        resolve(r.access_token);
      },
      error_callback: e => reject(new Error(e?.type === 'popup_closed' ? 'Google sign-in was closed' : e?.message || 'Google sign-in was closed')),
    });
    client.requestAccessToken({ prompt: store.pref(seenKey) ? '' : 'consent' });
  });
}
export const calConnected = () => !!store.pref('googleCalConnected');

// ---------- Google Calendar: send a schedule to a "Sedi" calendar ----------
const CAL_API = 'https://www.googleapis.com/calendar/v3';
async function gfetch(path, { method = 'GET', body } = {}) {
  const t = await getToken(CAL_SCOPE);
  const res = await fetch(CAL_API + path, { method, headers: { authorization: `Bearer ${t}`, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  if (res.status === 204) return { ok: true, status: 204 };
  const j = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, j };
}
/** The "Sedi" calendar in the person's Google account: made the first time, then remembered. */
async function sediCalendar() {
  const saved = store.pref('gcalId');
  if (saved) { const r = await gfetch(`/calendars/${encodeURIComponent(saved)}`); if (r.ok) return saved; }
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const r = await gfetch('/calendars', { method: 'POST', body: { summary: 'Sedi', description: 'Your schedule from Sedi. Press Send in Sedi to update it.', ...(tz ? { timeZone: tz } : {}) } });
  if (!r.ok) throw new Error(r.j?.error?.message || `Google returned ${r.status}`);
  store.setPref('gcalId', r.j.id);
  return r.j.id;
}
/**
 * Send events to the Sedi calendar. Each has a fixed id, so sending again updates it instead of adding a copy.
 * `byDate` lists, per date sent, the ids that belong there now: anything Sedi sent to that date before and
 * isn't there anymore (deleted, moved to another day) is taken off, so the calendar matches Sedi.
 * events: [{ id, summary, description, start, end, reminder }]
 */
export async function sendToGoogleCalendar(events, byDate, onProgress) {
  const cal = encodeURIComponent(await sediCalendar());
  const sent = { ...(store.pref('gcalSent', {}) || {}) };
  let done = 0, failed = 0, removed = 0;
  const upsert = async ev => {
    const body = { ...ev, status: 'confirmed', reminders: ev.reminder ? { useDefault: false, overrides: [{ method: 'popup', minutes: 0 }] } : { useDefault: true } };
    delete body.reminder;
    let r = await gfetch(`/calendars/${cal}/events`, { method: 'POST', body });
    if (r.status === 409) r = await gfetch(`/calendars/${cal}/events/${ev.id}`, { method: 'PUT', body });
    r.ok ? done++ : failed++;
    onProgress?.(done + failed, events.length);
  };
  const queue = [...events];
  await Promise.all(Array.from({ length: 4 }, async () => { while (queue.length) await upsert(queue.shift()); }));
  for (const [date, ids] of Object.entries(byDate)) {
    const gone = (sent[date] || []).filter(id => !ids.includes(id));
    for (const id of gone) { const r = await gfetch(`/calendars/${cal}/events/${id}`, { method: 'DELETE' }); if (r.ok || r.status === 404 || r.status === 410) removed++; }
    sent[date] = ids;
  }
  // Keep the memory small: only dates from the last two weeks on.
  const cutoff = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  store.setPref('gcalSent', Object.fromEntries(Object.entries(sent).filter(([d]) => d >= cutoff)));
  return { done, failed, removed };
}

async function multipartUpload(metadata, blob) {
  const t = await getToken();
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', blob);
  const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink', {
    method: 'POST', headers: { authorization: `Bearer ${t}` }, body: form,
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(j?.error?.message || `Google returned ${res.status}`);
  return j;
}

/** SD-A2: create a real Google Doc (title + the note's text) and return its link. */
export async function createDoc(title, text) {
  const j = await multipartUpload({ name: title || 'Untitled', mimeType: 'application/vnd.google-apps.document' }, new Blob([text || ''], { type: 'text/plain' }));
  return j.webViewLink || `https://docs.google.com/document/d/${j.id}/edit`;
}
/** SD-A3: upload a PDF to Drive and return its link. */
export async function uploadToDrive(name, blob) {
  const j = await multipartUpload({ name: name || 'Document.pdf' }, blob);
  return j.webViewLink || `https://drive.google.com/file/d/${j.id}/view`;
}

export function openGooglePanel({ purpose = 'docs' } = {}) {
  const input = h('input', { class: 'field-input', value: clientId(), placeholder: '1234567890-abc123.apps.googleusercontent.com', 'aria-label': 'Google OAuth client ID' });
  const status = h('p', { class: 'muted small' }, isSetUp() ? (store.pref('googleConnected') ? 'Connected before. Google may ask you to confirm again after an hour.' : 'Client ID saved. Press Connect to sign in.') : 'Not set up yet.');
  modal({
    title: 'Google account', wide: true,
    body: h('div', { class: 'editor' },
      ...(purpose === 'calendar' ? [
        h('p', {}, 'Connect Google once, and “Send to calendar” puts your schedule straight into a “Sedi” calendar in your Google account. Sedi can only touch that one calendar, never your others.'),
        h('p', {}, h('b', {}, 'No setup? '), 'Apple Calendar works right away from the same menu.'),
      ] : [
        h('p', {}, h('b', {}, 'You don’t need this to use Google Docs. '), 'In any Brainly note, “Open as Google Doc” copies the note and opens a new doc for you to paste into. No setup.'),
        h('p', {}, 'Connecting is optional and for people comfortable with Google Cloud: Sedi then creates the doc with your text already in it, and can save PDFs to Drive. It only gets access to files it creates.'),
      ]),
      h('p', { class: 'muted small' }, 'Because Sedi has no server, Google needs a one-time “client ID” for your copy of Sedi (free, about 10 minutes):'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Go to console.cloud.google.com, create a project (any name), and enable the “Google Drive API” and the “Google Calendar API”.'),
        h('li', {}, 'APIs & Services → OAuth consent screen: choose External, add your own email as a test user.'),
        h('li', {}, `Credentials → Create credentials → OAuth client ID → Web application. Under “Authorized JavaScript origins” add ${location.origin}.`),
        h('li', {}, 'Copy the client ID and paste it below, then press Connect.')),
      h('label', { class: 'field-label' }, 'OAuth client ID'), input, status),
    actions: [
      ...(isSetUp() ? [{ label: 'Disconnect', kind: 'ghost', onClick: () => { try { Object.values(tokens).forEach(t => window.google?.accounts?.oauth2?.revoke?.(t.token)); } catch {} for (const k in tokens) delete tokens[k]; store.setPref('googleClientId', ''); store.setPref('googleConnected', false); store.setPref('googleCalConnected', false); toast('Disconnected Google'); } }] : []),
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Connect', kind: 'primary', onClick: async () => {
        store.setPref('googleClientId', input.value.trim());
        if (!input.value.trim()) { status.textContent = 'Paste a client ID first.'; return true; }
        status.textContent = 'Opening Google sign-in…';
        try { await getToken(purpose === 'calendar' ? CAL_SCOPE : SCOPE); status.textContent = 'Connected.'; toast('Google connected'); }
        catch (err) { status.textContent = `Couldn’t connect: ${err.message}`; return true; }
      } },
    ],
  });
}

export { icon };
