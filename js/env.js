// Sedi — which copy is running. The sandbox preview lives under /beta/ and keeps its own
// database, settings and offline cache, so testing it never touches your real data.
// (Downloaded voice and AI models are shared: they're the same files, so they download only once.)
// A page can also mark itself as a sandbox (the in-chat preview does) with window.SEDI_SANDBOX = true.
export const IS_BETA = /\/beta\//.test(location.pathname) || !!window.SEDI_SANDBOX;
export const NS = IS_BETA ? 'sedi-beta' : 'sedi';
