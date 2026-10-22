// Sedi — note summaries for hover previews (SD-I2, SD-B5).
// Uses whichever AI engine is ready; otherwise a quick summary from the note's first sentences.
// AI summaries are cached on the note (meta.summary) and only regenerated when the note's text changes.

import * as store from './store.js';
import { stripHtml, hashStr } from './util.js';
import { canSummarize, chat } from './engines.js';

const inflight = new Set();
export const noteText = c => (/<\/?[a-z][\s\S]*>/i.test(c.description || '') ? stripHtml(c.description) : (c.description || '')).trim();
const signature = c => hashStr(`${c.title}\n${noteText(c)}`).toString(36);

const STOP = new Set('the a an and or but if then of to in on for with at by from is are was were be been am i me my you your it its this that these those as so do does did not no can will just about into over than too very what how why when who which there their they we our us he she his her them also more most some any all each'.split(' '));
/** No AI needed: pick the one or two sentences that carry the note's most repeated ideas, in their original order. */
function quickSummary(c) {
  const text = noteText(c).replace(/\s+/g, ' ').trim();
  if (!text) return 'Empty note.';
  if (text.length <= 200) return text;
  const sentences = (text.match(/[^.!?]+[.!?]?/g) || [text]).map(x => x.trim()).filter(Boolean);
  if (sentences.length <= 2) return text.length > 220 ? `${text.slice(0, 210).trim()}…` : text;
  const words = s => s.toLowerCase().match(/[a-z0-9']+/g)?.filter(w => w.length > 2 && !STOP.has(w)) || [];
  const freq = {};
  words(`${c.title} ${text}`).forEach(w => { freq[w] = (freq[w] || 0) + 1; });
  const titleWords = new Set(words(c.title));
  const scored = sentences.map((s, i) => {
    const ws = words(s);
    const score = ws.reduce((a, w) => a + (freq[w] || 0) + (titleWords.has(w) ? 2 : 0), 0) / Math.sqrt(ws.length || 1) + (i === 0 ? 1.5 : 0);
    return { s, i, score };
  });
  const pick = scored.slice().sort((a, b) => b.score - a.score).slice(0, 2).sort((a, b) => a.i - b.i);
  let out = pick.map(p => p.s).join(' ');
  if (out.length > 240) out = `${pick[0].s.slice(0, 230).trim()}…`;
  return out;
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
