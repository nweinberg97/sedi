// Sedi — browser speech: dictation (Web Speech API) and spoken replies (speechSynthesis).
// Note: in Chrome, speech recognition is processed by the browser vendor's service and needs a
// connection. Spoken replies use voices installed on your device and work offline.

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;
export const canSpeak = 'speechSynthesis' in window;

/** Start dictation. Returns { stop }. Callbacks: onInterim(text), onFinal(text), onEnd(), onError(msg). */
export function listen({ onInterim, onFinal, onEnd, onError, continuous = true } = {}) {
  if (!SR) { onError?.('Voice input isn’t supported in this browser. Try Chrome or Safari.'); onEnd?.(); return { stop() {} }; }
  const rec = new SR();
  rec.lang = navigator.language || 'en-US';
  rec.interimResults = true;
  rec.continuous = continuous;
  let stopped = false;
  rec.onresult = e => {
    let interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) onFinal?.(r[0].transcript.trim());
      else interim += r[0].transcript;
    }
    onInterim?.(interim);
  };
  rec.onerror = e => {
    const msg = {
      'not-allowed': 'Microphone access is blocked. Allow it in your browser’s site settings.',
      'network': 'Voice input needs an internet connection in this browser.',
      'no-speech': 'Didn’t catch anything. Try again.',
      'audio-capture': 'No microphone found.',
    }[e.error] || `Voice input stopped (${e.error}).`;
    if (e.error !== 'aborted') onError?.(msg);
  };
  rec.onend = () => { if (!stopped && continuous) { try { rec.start(); return; } catch {} } onEnd?.(); };
  try { rec.start(); } catch (err) { onError?.(err.message); onEnd?.(); }
  return { stop() { stopped = true; try { rec.stop(); } catch {} } };
}

let voice = null;
function pickVoice() {
  if (voice || !canSpeak) return voice;
  const voices = speechSynthesis.getVoices();
  const lang = (navigator.language || 'en').slice(0, 2);
  voice = voices.find(v => v.localService && v.lang.startsWith(lang) && /Samantha|Daniel|Karen|Moira|Ava|Allison|Natural|Aria/i.test(v.name))
    || voices.find(v => v.localService && v.lang.startsWith(lang))
    || voices.find(v => v.lang.startsWith(lang)) || voices[0] || null;
  return voice;
}
if (canSpeak) speechSynthesis.onvoiceschanged = () => { voice = null; pickVoice(); };

export function speak(text) {
  if (!canSpeak || !text) return;
  speechSynthesis.cancel();
  const clean = text.replace(/[*_#`>]/g, '').replace(/\n+/g, '. ').slice(0, 600);
  const u = new SpeechSynthesisUtterance(clean);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.03;
  speechSynthesis.speak(u);
}
export const stopSpeaking = () => canSpeak && speechSynthesis.cancel();
