// Sedi — note summaries for hover previews (SD-I2, SD-B5).
// Uses whichever AI engine is ready; otherwise a quick summary from the note's first sentences.
// AI summaries are cached on the note (meta.summary) and only regenerated when the note's text changes.

import * as store from './store.js';
import { stripHtml, hashStr } from './util.js';
import { canSummarize, chat } from './engines.js';

const inflight = new Set();
export const noteText = c => (/<\/?[a-z][\s\S]*>/i.test(c.description || '') ? stripHtml(c.description) : (c.description || '')).trim();
const signature = c => hashStr(`${c.title}\n${noteText(c)}`).toString(36);

function quickSummary(c) {
  const text = noteText(c).replace(/\s+/g, ' ');
  if (!text) return 'Empty note.';
  const sentences = text.match(/[^.!?]+[.!?]?/g) || [text];
  let out = '';
  for (const s of sentences) { if ((out + s).length > 170) break; out += s; }
  out = (out || text.slice(0, 160)).trim();
  return out.length < text.length && !/[.!?]$/.test(out) ? `${out}…` : out;
}

/** What to show right now. { text, ai, engine } */
export function summaryFor(c) {
  const m = c.meta || {};
  if (m.summary && m.summaryOf === signature(c)) return { text: m.summary, ai: true, engine: m.summaryBy || 'AI' };
  return { text: quickSummary(c), ai: false };
}

/** Make (or refresh) the AI summary in the background if an engine is ready. Resolves to summaryFor(). */
export async function ensureSummary(c) {
  const sig = signature(c);
  if (c.meta?.summaryOf === sig || inflight.has(c.id) || !canSummarize()) return summaryFor(c);
  const text = noteText(c);
  if (text.length < 140) return summaryFor(c); // short notes are their own summary
  inflight.add(c.id);
  try {
    const r = await chat({
      system: 'You summarize personal notes. Reply with one plain sentence under 25 words. No preamble, no quotes.',
      messages: [{ role: 'user', content: `Title: ${c.title}\n\n${text.slice(0, 4000)}` }], maxTokens: 80,
    });
    const summary = r.text.replace(/^["“]|["”]$/g, '').trim();
    if (summary) store.updateCard(c.id, { meta: { summary, summaryOf: sig, summaryBy: r.engine } }, { silent: true, touch: false });
  } catch { /* fall back to the quick summary */ }
  finally { inflight.delete(c.id); }
  return summaryFor(store.getCard(c.id) || c);
}
