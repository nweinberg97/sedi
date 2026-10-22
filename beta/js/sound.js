// Procedural "crunch" for the trash bin — generated live with the Web Audio API, no audio files.

let ctx = null;
const getCtx = () => {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

export function crunch() {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const out = ac.createGain();
  out.gain.value = 0.55;
  out.connect(ac.destination);

  // 1) Paper-crumple: several short bursts of filtered noise with jittered timing.
  const len = Math.floor(ac.sampleRate * 0.45);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

  const bursts = 7;
  for (let i = 0; i < bursts; i++) {
    const start = t0 + i * 0.038 + Math.random() * 0.02;
    const src = ac.createBufferSource();
    src.buffer = buf;
    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400 + Math.random() * 2600;
    bp.Q.value = 0.9 + Math.random() * 1.4;
    const g = ac.createGain();
    const peak = 0.5 * (1 - i / (bursts + 2));
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(peak, start + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, start + 0.05 + Math.random() * 0.04);
    src.connect(bp).connect(g).connect(out);
    src.start(start, Math.random() * 0.3, 0.12);
  }

  // 2) A soft low thump as the item lands in the bin.
  const osc = ac.createOscillator();
  osc.type = 'sine';
  osc.frequency.setValueAtTime(140, t0 + 0.02);
  osc.frequency.exponentialRampToValueAtTime(48, t0 + 0.22);
  const og = ac.createGain();
  og.gain.setValueAtTime(0.0001, t0 + 0.02);
  og.gain.exponentialRampToValueAtTime(0.45, t0 + 0.035);
  og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.28);
  osc.connect(og).connect(out);
  osc.start(t0 + 0.02);
  osc.stop(t0 + 0.3);
}

/** A tiny tick used for confirmations (assistant command executed, etc). */
export function tick() {
  const ac = getCtx();
  if (!ac) return;
  const t0 = ac.currentTime;
  const o = ac.createOscillator();
  const g = ac.createGain();
  o.type = 'triangle';
  o.frequency.setValueAtTime(880, t0);
  o.frequency.exponentialRampToValueAtTime(1320, t0 + 0.06);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  o.connect(g).connect(ac.destination);
  o.start(t0); o.stop(t0 + 0.14);
}
