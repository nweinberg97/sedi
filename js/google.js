// Sedi — Google account (optional). Lets Brainly create a Google Doc from a note and upload a PDF to Drive.
// Uses Google's own sign-in window (Google Identity Services) with the narrow "drive.file" permission:
// Sedi can only see files it created, nothing else in your Drive. Nothing loads until you press Connect.
// One-time setup: a free Google Cloud "OAuth client ID" for this site (steps in the panel).

import * as store from './store.js';
import { h, icon, modal, toast } from './util.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let token = null, tokenExp = 0, gisLoading = null, tokenClient = null;

export const clientId = () => store.pref('googleClientId', '');
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
async function getToken() {
  if (token && Date.now() < tokenExp - 60e3) return token;
  if (!isSetUp()) { openGooglePanel(); throw new Error('Set up your Google account first.'); }
  await loadGis();
  return new Promise((resolve, reject) => {
    tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId(), scope: SCOPE,
      callback: r => {
        if (r.error) return reject(new Error(r.error_description || r.error));
        token = r.access_token; tokenExp = Date.now() + (r.expires_in || 3600) * 1000;
        store.setPref('googleConnected', true);
        resolve(token);
      },
      error_callback: e => reject(new Error(e?.message || 'Google sign-in was closed')),
    });
    tokenClient.requestAccessToken({ prompt: store.pref('googleConnected') ? '' : 'consent' });
  });
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

export function openGooglePanel() {
  const input = h('input', { class: 'field-input', value: clientId(), placeholder: '1234567890-abc123.apps.googleusercontent.com', 'aria-label': 'Google OAuth client ID' });
  const status = h('p', { class: 'muted small' }, isSetUp() ? (store.pref('googleConnected') ? 'Connected before. Google may ask you to confirm again after an hour.' : 'Client ID saved. Press Connect to sign in.') : 'Not set up yet.');
  modal({
    title: 'Google account', wide: true,
    body: h('div', { class: 'editor' },
      h('p', {}, h('b', {}, 'You don’t need this to use Google Docs. '), 'In any Brainly note, “Open as Google Doc” copies the note and opens a new doc for you to paste into. No setup.'),
      h('p', {}, 'Connecting is optional and for people comfortable with Google Cloud: Sedi then creates the doc with your text already in it, and can save PDFs to Drive. It only gets access to files it creates.'),
      h('p', { class: 'muted small' }, 'Because Sedi has no server, Google needs a one-time “client ID” for your copy of Sedi (free, about 10 minutes):'),
      h('ol', { class: 'steps' },
        h('li', {}, 'Go to console.cloud.google.com, create a project (any name), and enable the “Google Drive API”.'),
        h('li', {}, 'APIs & Services → OAuth consent screen: choose External, add your own email as a test user.'),
        h('li', {}, `Credentials → Create credentials → OAuth client ID → Web application. Under “Authorized JavaScript origins” add ${location.origin}.`),
        h('li', {}, 'Copy the client ID and paste it below, then press Connect.')),
      h('label', { class: 'field-label' }, 'OAuth client ID'), input, status),
    actions: [
      ...(isSetUp() ? [{ label: 'Disconnect', kind: 'ghost', onClick: () => { try { if (token) window.google?.accounts?.oauth2?.revoke?.(token); } catch {} token = null; store.setPref('googleClientId', ''); store.setPref('googleConnected', false); toast('Disconnected Google'); } }] : []),
      { label: 'Cancel', kind: 'ghost' },
      { label: 'Connect', kind: 'primary', onClick: async () => {
        store.setPref('googleClientId', input.value.trim());
        if (!input.value.trim()) { status.textContent = 'Paste a client ID first.'; return true; }
        status.textContent = 'Opening Google sign-in…';
        try { await getToken(); status.textContent = 'Connected.'; toast('Google connected'); }
        catch (err) { status.textContent = `Couldn’t connect: ${err.message}`; return true; }
      } },
    ],
  });
}

export { icon };
