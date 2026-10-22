// Sedi — the little moment when you finish something: a check pop, a burst of particles, and a chime.

let ctx = null;
const audio = () => {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
};

/** Two soft bell notes, a fifth apart. `big` adds a third note for finishing a whole list. */
export function chime(big = false) {
  const ac = audio();
  if (!ac) return;
  const t0 = ac.currentTime;
  const notes = big ? [784, 1047, 1319] : [880, 1319];
  notes.forEach((f, i) => {
    const t = t0 + i * 0.075;
    for (const [mult, vol] of [[1, 0.16], [2.01, 0.05], [3.0, 0.02]]) {
      const o = ac.createOscillator();
      const g = ac.createGain();
      o.type = 'sine';
      o.frequency.value = f * mult;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + (big ? 0.9 : 0.55));
      o.connect(g).connect(ac.destination);
      o.start(t); o.stop(t + 1);
    }
  });
}

const COLORS = ['#86AE95', '#7584c4', '#c29a5b', '#9a88c4', '#C98E8E', '#7FAEBE'];

/** Particle burst from the centre of `el` (usually the checkbox). */
export function burst(el, { count = 14, spread = 46, big = false } = {}) {
  if (!el?.getBoundingClientRect || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const n = big ? count * 2 : count;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'confetti';
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const dist = (big ? spread * 1.8 : spread) * (0.55 + Math.random() * 0.6);
    const size = 4 + Math.random() * 4;
    Object.assign(p.style, {
      left: `${cx - size / 2}px`, top: `${cy - size / 2}px`, width: `${size}px`, height: `${size * (Math.random() > 0.5 ? 1 : 0.45)}px`,
      background: COLORS[i % COLORS.length], borderRadius: Math.random() > 0.5 ? '50%' : '2px',
    });
    document.body.append(p);
    const dx = Math.cos(angle) * dist, dy = Math.sin(angle) * dist;
    p.animate([
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy + 18}px) scale(0.6) rotate(${Math.random() * 360}deg)`, opacity: 0 },
    ], { duration: 560 + Math.random() * 260, easing: 'cubic-bezier(.15,.7,.3,1)' }).onfinish = () => p.remove();
  }
}

/** Everything at once: pop the checkbox, burst, chime. */
export function celebrate(checkEl, { big = false } = {}) {
  checkEl?.classList.remove('pop');
  void checkEl?.offsetWidth;
  checkEl?.classList.add('pop');
  burst(checkEl, { big });
  chime(big);
}
