// Sedi — AI engines. The core is the open model that runs on this device (Sovereign Brain).
// Anyone who wants more can add their own engine: Claude (Anthropic API key), or any service that speaks
// the common "OpenAI-compatible" format (OpenAI, OpenRouter, or a model running locally in Ollama).
// Keys live only on this device (never in exports). Every answer is labelled with the engine that wrote it.
// "Ask Claude" is a free hand-off: it opens Claude.ai in a new tab with the question already typed,
// so you use the Claude plan you already pay for.

import * as store from './store.js';
import { h, icon, modal, toast } from './util.js';
import * as brain from './brain.js';

const DEFAULTS = {
  active: 'local',
  claudeModel: 'claude-haiku-5-5',
  compatLabel: 'Ollama on this Mac',
  compatBase: 'http://localhost:11434/v1',
  compatModel: 'llama3.2',
  transcribe: { enabled: false, base: 'https://api.openai.com/v1', model: 'whisper-1' },
};
export const engineConfig = () => ({ ...DEFAULTS, ...(store.pref('engine') || {}) });
const saveConfig = patch => store.setPref('engine', { ...engineConfig(), ...patch });

export function engineLabel(id = engineConfig().active) {
  const cfg = engineConfig();
  return { local: 'On-device model', claude: 'Claude', compat: cfg.compatLabel || 'Custom engine' }[id] || 'On-device model';
}
/** Is the chosen engine ready to answer without a big surprise download? */
export function available() {
  const cfg = engineConfig();
  if (cfg.active === 'claude') return !!store.secret('claudeKey');
  if (cfg.active === 'compat') return !!cfg.compatBase && !!cfg.compatModel;
  return brain.isEnabled();
}
/** Summaries run quietly in the background, so they only use an engine that's already warm. */
export function canSummarize() {
  const cfg = engineConfig();
  if (cfg.active !== 'local') return available();
  return brain.isEnabled() && brain.brainState().status === 'ready';
}

/** One call for every engine. messages: [{role:'user'|'assistant', content}] */
export async function chat({ system, messages, maxTokens = 500, onToken }) {
  const cfg = engineConfig();
  if (cfg.active === 'claude') {
    const key = store.secret('claudeKey');
    if (!key) throw new Error('Add your Anthropic API key in Menu → AI engines.');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
      body: JSON.stringify({ model: cfg.claudeModel, max_tokens: maxTokens, system, messages }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `Claude returned ${res.status}`);
    return { text: (j.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n').trim(), engine: engineLabel('claude') };
  }
  if (cfg.active === 'compat') {
    const key = store.secret('compatKey');
    const res = await fetch(`${cfg.compatBase.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(key ? { authorization: `Bearer ${key}` } : {}) },
      body: JSON.stringify({ model: cfg.compatModel, max_tokens: maxTokens, messages: [...(system ? [{ role: 'system', content: system }] : []), ...messages] }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j?.error?.message || `${engineLabel('compat')} returned ${res.status}`);
    return { text: (j.choices?.[0]?.message?.content || '').trim(), engine: engineLabel('compat') };
  }
  const text = await brain.complete([...(system ? [{ role: 'system', content: system }] : []), ...messages], { maxTokens: Math.min(maxTokens, 320), onToken });
  return { text, engine: engineLabel('local') };
}

/** Free hand-off to Claude.ai with the question and the relevant Sedi cards typed in. */
export function askClaudeUrl(question, cards = []) {
  const ctx = cards.slice(0, 8).map(c => `- ${c.title}${c.where ? ` (${c.where})` : ''}${c.text ? `: ${c.text.slice(0, 160)}` : ''}`).join('\n');
  const prompt = `${question}${ctx ? `\n\nHere are related items from my planner (Sedi):\n${ctx}` : ''}`;
  return `https://claude.ai/new?q=${encodeURIComponent(prompt.slice(0, 3500))}`;
}

// The assistant remembers your latest question (and the cards it matched) so Settings can hand it to Claude.
let lastAsk = { q: '', cards: [] };
export const rememberAsk = (q, cards = []) => { lastAsk = { q, cards }; };
export const forgetAsk = () => { lastAsk = { q: '', cards: [] }; };

// ---------- Settings panel ----------
export function openEnginesPanel() {
  const cfg = engineConfig();
  let choice = cfg.active;
  const opt = (id, title, sub) => h('button', { class: `engine-opt ${id === choice ? 'on' : ''}`, type: 'button', dataset: { id },
    onclick: e => { choice = id; opts.querySelectorAll('.engine-opt').forEach(b => b.classList.toggle('on', b.dataset.id === id)); paint(); } },
  h('strong', {}, title), h('small', {}, sub));
  const opts = h('div', { class: 'engine-opts' },
    opt('local', 'On-device (default)', 'Open model in your browser. Free, private, works offline.'),
    opt('claude', 'Claude', 'Your own Anthropic API key. Billed per use by Anthropic.'),
    opt('compat', 'Other engine', 'OpenAI, OpenRouter, or a model in Ollama on your Mac.'));
  const claudeKey = h('input', { class: 'field-input', type: 'password', autocomplete: 'off', placeholder: store.secret('claudeKey') ? 'Saved on this device (type to replace)' : 'sk-ant-…', 'aria-label': 'Anthropic API key' });
  const claudeModel = h('input', { class: 'field-input', value: cfg.claudeModel, 'aria-label': 'Claude model' });
  const compatLabel = h('input', { class: 'field-input', value: cfg.compatLabel, 'aria-label': 'Name' });
  const compatBase = h('input', { class: 'field-input', value: cfg.compatBase, 'aria-label': 'Address' });
  const compatModel = h('input', { class: 'field-input', value: cfg.compatModel, 'aria-label': 'Model' });
  const compatKey = h('input', { class: 'field-input', type: 'password', autocomplete: 'off', placeholder: store.secret('compatKey') ? 'Saved on this device (type to replace)' : 'Leave empty for Ollama', 'aria-label': 'API key' });
  const trOn = h('input', { type: 'checkbox', checked: !!cfg.transcribe.enabled, 'aria-label': 'Use a transcription service' });
  const trBase = h('input', { class: 'field-input', value: cfg.transcribe.base, 'aria-label': 'Transcription address' });
  const trModel = h('input', { class: 'field-input', value: cfg.transcribe.model, 'aria-label': 'Transcription model' });
  const trKey = h('input', { class: 'field-input', type: 'password', autocomplete: 'off', placeholder: store.secret('transcribeKey') ? 'Saved on this device (type to replace)' : 'API key', 'aria-label': 'Transcription key' });
  const status = h('p', { class: 'muted small engine-status' });
  const lab = (t, el) => h('label', { class: 'mini-field' }, h('span', { class: 'field-label' }, t), el);
  const claudeBox = h('div', { class: 'engine-fields' }, lab('Anthropic API key', claudeKey), lab('Model', claudeModel),
    h('p', { class: 'muted small' }, 'Get a key at console.anthropic.com. It’s separate from a Claude Pro/Max plan, which Anthropic doesn’t let other apps use.'));
  const compatBox = h('div', { class: 'engine-fields' }, lab('Name', compatLabel), lab('Address', compatBase), lab('Model', compatModel), lab('API key', compatKey),
    h('p', { class: 'muted small' }, 'Ollama: install it on your Mac, run “ollama pull llama3.2”, and allow this site (OLLAMA_ORIGINS). Hosted services need their own key.'));
  const paint = () => { claudeBox.hidden = choice !== 'claude'; compatBox.hidden = choice !== 'compat'; };
  paint();
  const save = () => {
    if (claudeKey.value.trim()) store.setSecret('claudeKey', claudeKey.value.trim());
    if (compatKey.value.trim()) store.setSecret('compatKey', compatKey.value.trim());
    if (trKey.value.trim()) store.setSecret('transcribeKey', trKey.value.trim());
    saveConfig({
      active: choice, claudeModel: claudeModel.value.trim() || DEFAULTS.claudeModel,
      compatLabel: compatLabel.value.trim() || 'Custom engine', compatBase: compatBase.value.trim(), compatModel: compatModel.value.trim(),
      transcribe: { enabled: trOn.checked, base: trBase.value.trim(), model: trModel.value.trim() || 'whisper-1' },
    });
  };
  const askQ = h('input', { class: 'field-input', value: lastAsk.q, placeholder: 'What do you want to ask Claude?', 'aria-label': 'Question for Claude' });
  const askSection = h('div', { class: 'engine-section ask-claude-section' },
    h('strong', {}, 'Ask Claude (with your own Claude plan)'),
    h('p', { class: 'muted small' }, 'Opens Claude.ai in a new tab with your question and the related Sedi cards typed in. Nothing is sent until you press send there.'),
    h('div', { class: 'ask-row' }, askQ,
      h('button', { class: 'btn sm primary', type: 'button', onclick: () => {
        const q = askQ.value.trim();
        if (!q) { askQ.focus(); return; }
        window.open(askClaudeUrl(q, q === lastAsk.q ? lastAsk.cards : []), '_blank', 'noopener');
      } }, 'Open in Claude ↗')),
    lastAsk.q ? h('p', { class: 'muted small' }, `Filled in with your last question to the assistant${lastAsk.cards.length ? ` and ${lastAsk.cards.length} related card${lastAsk.cards.length === 1 ? '' : 's'}` : ''}.`) : null);
  modal({
    title: 'AI engines', wide: true,
    body: h('div', { class: 'editor' },
      h('p', {}, 'Sedi’s assistant and note summaries run on an open model on this device by default. Nothing you type leaves your device unless you pick another engine here. With Claude or another online engine, each message is sent along with the titles of your 40 most recent cards, so it can tell which card you mean.'),
      opts, claudeBox, compatBox,
      h('div', { class: 'engine-section' },
        h('strong', {}, 'Voice transcription (optional)'),
        h('p', { class: 'muted small' }, 'Sedi turns your speech into text on this device by default (see Voice and hearing in the assistant’s menu). Wispr Flow and similar apps also work in any Sedi text box. To send recordings to a Whisper-style service instead, turn this on.'),
        h('label', { class: 'check-row' }, trOn, ' Use a transcription service'),
        h('div', { class: 'engine-fields' }, lab('Address', trBase), lab('Model', trModel), lab('API key', trKey))),
      askSection,
      h('p', { class: 'muted small' }, 'Keys are stored only in this browser on this device and are never included in “Download data”.'),
      status),
    actions: [
      { label: 'Remove saved keys', kind: 'ghost', onClick: () => { ['claudeKey', 'compatKey', 'transcribeKey'].forEach(k => store.setSecret(k, '')); toast('Removed saved keys from this device'); return true; } },
      { label: 'Test', kind: 'ghost', onClick: async () => {
        save();
        status.textContent = 'Testing…';
        try { const r = await chat({ system: 'Reply with exactly: ready', messages: [{ role: 'user', content: 'Say ready.' }], maxTokens: 10 }); status.textContent = `${r.engine} answered: “${r.text.slice(0, 60)}”`; }
        catch (err) { status.textContent = `That didn’t work: ${err.message || err}`; }
        return true;
      } },
      { label: 'Save', kind: 'primary', onClick: () => { save(); toast(`Assistant engine: ${engineLabel()}`); } },
    ],
  });
}

export { icon };
