// Sedi — one dictation helper for every text field. Uses the browser's Web Speech API directly
// (never the Sovereign Brain), so it's instant: tap the mic, talk, and words land at the cursor.

import { h, icon, toast } from './util.js';
import { listen, canListen } from './speech.js';

let active = null; // { btn, session, target, bubble }

export function stopMic() {
  if (!active) return;
  const a = active;
  active = null;
  a.session?.stop();
  cleanup(a);
}
function cleanup(a) {
  a.btn.classList.remove('on');
  a.btn.setAttribute('aria-pressed', 'false');
  a.bubble?.remove();
  a.target.classList?.remove('dictating');
}

/** Insert text at the caret of an input, textarea or contenteditable, and fire `input`. */
export function insertAtCaret(target, text) {
  if (!text) return;
  if (target.isContentEditable) {
    target.focus();
    const sel = getSelection();
    if (!target.contains(sel.anchorNode)) {
      const r = document.createRange(); r.selectNodeContents(target); r.collapse(false);
      sel.removeAllRanges(); sel.addRange(r);
    }
    const before = (sel.anchorNode?.textContent || '').slice(0, sel.anchorOffset);
    document.execCommand('insertText', false, joinSpace(before, text));
    return;
  }
  const start = target.selectionStart ?? target.value.length;
  const end = target.selectionEnd ?? target.value.length;
  const before = target.value.slice(0, start);
  const piece = joinSpace(before, text);
  target.setRangeText(piece, start, end, 'end');
  target.dispatchEvent(new Event('input', { bubbles: true }));
}
function joinSpace(before, text) {
  const needsSpace = before && !/\s$/.test(before);
  const sentenceStart = !before.trim() || /[.!?]\s*$/.test(before);
  const t = sentenceStart ? text.charAt(0).toUpperCase() + text.slice(1) : text;
  return (needsSpace ? ' ' : '') + t;
}

/**
 * A mic button bound to a text target. The button never steals focus, so quick-add inputs that
 * save on blur keep working. Options: { size: 'sm' | 'xs', label }.
 */
export function micFor(target, { size = 'sm', label = 'Dictate' } = {}) {
  const btn = h('button', {
    class: `icon-btn ${size} mic-btn no-drag`, type: 'button', 'aria-label': label, 'aria-pressed': 'false',
    title: canListen ? `${label} (speech to text)` : 'Voice input isn’t supported in this browser. Try Chrome or Safari.',
  }, icon('mic'));
  btn.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); });
  btn.addEventListener('mousedown', e => e.preventDefault());
  btn.addEventListener('click', e => {
    e.preventDefault(); e.stopPropagation();
    if (!canListen) { toast('Voice input isn’t supported in this browser. Try Chrome or Safari.'); return; }
    const t = typeof target === 'function' ? target() : target;
    if (!t) return;
    if (active?.btn === btn) { stopMic(); return; }
    stopMic();
    start(btn, t);
  });
  return btn;
}

function start(btn, target) {
  btn.classList.add('on');
  btn.setAttribute('aria-pressed', 'true');
  target.classList?.add('dictating');
  if (document.activeElement !== target) target.focus?.();
  const bubble = h('div', { class: 'mic-bubble', role: 'status' },
    h('span', { class: 'wave', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i')),
    h('span', { class: 'mic-bubble-text' }, 'Listening…'));
  document.body.append(bubble);
  const place = () => {
    const r = btn.getBoundingClientRect();
    const bw = bubble.offsetWidth;
    bubble.style.left = `${Math.max(8, Math.min(innerWidth - bw - 8, r.left + r.width / 2 - bw / 2))}px`;
    bubble.style.top = `${r.top - bubble.offsetHeight - 8 < 8 ? r.bottom + 8 : r.top - bubble.offsetHeight - 8}px`;
  };
  place();
  const a = { btn, target, bubble, session: null };
  active = a;
  a.session = listen({
    onInterim: t => { bubble.lastChild.textContent = t || 'Listening…'; place(); },
    onFinal: t => { insertAtCaret(target, t); bubble.lastChild.textContent = 'Listening…'; place(); },
    onError: msg => toast(msg),
    onEnd: () => { if (active === a) active = null; cleanup(a); },
  });
}

// Stop dictating when you leave the page or press Escape.
addEventListener('hashchange', stopMic);
document.addEventListener('keydown', e => { if (e.key === 'Escape' && active) stopMic(); }, true);

/** Wrap a single-line input so a small mic sits inside its right edge. */
export function withMic(input, opts = {}) {
  const wrap = h('div', { class: 'mic-field' }, input, micFor(input, { size: 'xs', ...opts }));
  return wrap;
}
