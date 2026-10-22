// Sedi — the small moment when you finish something: the check pops, a few sparks fly, and the
// usual "done" chime plays. Used by Taskly ticks, project tasks, goal steps and reminders.

import { checkSound } from './sound.js';

const COLORS = ['#4fae7c', '#5b8def', '#c29a5b', '#9a88c4', '#e58aa5', '#56b6c2'];

/** A short burst of sparks from the centre of `el`. `big` for finishing a whole list. */
export function burst(el, { big = false } = {}) {
  if (!el?.getBoundingClientRect || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  const n = big ? 26 : 14, spread = big ? 80 : 44;
  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'spark';
    const angle = (Math.PI * 2 * i) / n + Math.random() * 0.5;
    const dist = spread * (0.55 + Math.random() * 0.6);
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

/** Pop the checkbox, burst, and chime (twice, a beat apart, when a whole list is done). */
export function celebrate(checkEl, { big = false } = {}) {
  if (checkEl) {
    checkEl.classList.remove('pop');
    void checkEl.offsetWidth;
    checkEl.classList.add('pop');
  }
  burst(checkEl, { big });
  checkSound();
  if (big) setTimeout(checkSound, 180);
}
