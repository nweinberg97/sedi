// Sedi — Boardly's dot pattern, drawn on a canvas so it can react to you.
// Dots drift away from the pointer and spring back; a click on empty board sends out a soft ripple.
// Cheap by design: the loop only runs while something is moving, and stops when the tab is hidden.

const SPACING = 26, OFFSET = 13, RADIUS = 130, PUSH = 24, RIPPLE_SPEED = 0.9, RIPPLE_LIFE = 900;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

function parseColor(str) {
  const s = (str || '').trim();
  let m = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (m) {
    let x = m[1]; if (x.length === 3) x = x.split('').map(c => c + c).join('');
    return [parseInt(x.slice(0, 2), 16), parseInt(x.slice(2, 4), 16), parseInt(x.slice(4, 6), 16)];
  }
  m = s.match(/rgba?\(([^)]+)\)/);
  if (m) return m[1].split(',').slice(0, 3).map(v => parseFloat(v));
  return [142, 155, 201];
}
// The same tint the CSS pattern used: the board colour, about a third strength over white.
const tint = ([r, g, b], k) => [r * k + 255 * (1 - k), g * k + 255 * (1 - k), b * k + 255 * (1 - k)].map(Math.round);

export function attachDots(host) {
  const cv = document.createElement('canvas');
  cv.className = 'dot-field';
  cv.setAttribute('aria-hidden', 'true');
  const ctx = cv.getContext('2d');
  let w = 0, h = 0, dpr = 1, n = 0, bx, by, dx, dy, vx, vy;
  let px = null, py = null, raf = 0, ripples = [], color = [142, 155, 201], restC = [200, 205, 225], hotC = [120, 130, 180], rest = 'rgb(200,205,225)';

  function build() {
    const r = host.getBoundingClientRect();
    w = Math.round(r.width); h = Math.round(r.height);
    if (!w || !h) return;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    cv.width = w * dpr; cv.height = h * dpr;
    cv.style.width = w + 'px'; cv.style.height = h + 'px';
    const cols = Math.ceil((w - OFFSET) / SPACING) + 1, rows = Math.ceil((h - OFFSET) / SPACING) + 1;
    n = cols * rows;
    bx = new Float32Array(n); by = new Float32Array(n); dx = new Float32Array(n); dy = new Float32Array(n); vx = new Float32Array(n); vy = new Float32Array(n);
    let i = 0;
    for (let y = 0; y < rows; y++) for (let x = 0; x < cols; x++) { bx[i] = OFFSET + x * SPACING; by[i] = OFFSET + y * SPACING; i++; }
    draw();
  }

  function recolor() {
    color = parseColor(getComputedStyle(host).getPropertyValue('--tab-color'));
    restC = tint(color, 0.34); hotC = tint(color, 0.95);
    rest = `rgb(${restC})`;
    draw();
  }

  function draw() {
    if (!n) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // Two passes keep it fast: all resting dots in one path, moving dots individually.
    ctx.fillStyle = rest;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      if (Math.abs(dx[i]) + Math.abs(dy[i]) > 0.6) continue;
      ctx.moveTo(bx[i] + 1.3, by[i]); ctx.arc(bx[i], by[i], 1.3, 0, 6.2832);
    }
    ctx.fill();
    for (let i = 0; i < n; i++) {
      const m = Math.abs(dx[i]) + Math.abs(dy[i]);
      if (m <= 0.6) continue;
      const k = Math.min(1, m / (PUSH * 0.7));
      ctx.fillStyle = `rgb(${restC.map((v, j) => Math.round(v + (hotC[j] - v) * k))})`;
      ctx.beginPath(); ctx.arc(bx[i] + dx[i], by[i] + dy[i], 1.3 + 1.5 * k, 0, 6.2832); ctx.fill();
    }
  }

  function step(t) {
    raf = 0;
    let moving = false;
    const now = t || performance.now();
    ripples = ripples.filter(r => now - r.t0 < RIPPLE_LIFE);
    for (let i = 0; i < n; i++) {
      let fx = -dx[i] * 0.09, fy = -dy[i] * 0.09; // spring home
      if (px !== null) {
        const ox = bx[i] - px, oy = by[i] - py, d2 = ox * ox + oy * oy;
        if (d2 < RADIUS * RADIUS) {
          const d = Math.sqrt(d2) || 1, f = (1 - d / RADIUS) ** 2 * PUSH;
          fx += (ox / d * f - dx[i]) * 0.16; fy += (oy / d * f - dy[i]) * 0.16;
        }
      }
      for (const r of ripples) {
        const ox = bx[i] - r.x, oy = by[i] - r.y, d = Math.sqrt(ox * ox + oy * oy) || 1;
        const front = (now - r.t0) * RIPPLE_SPEED, band = Math.abs(d - front);
        if (band < 26) { const f = (1 - band / 26) * (1 - (now - r.t0) / RIPPLE_LIFE) * 3.2; fx += ox / d * f; fy += oy / d * f; }
      }
      vx[i] = (vx[i] + fx) * 0.8; vy[i] = (vy[i] + fy) * 0.8;
      dx[i] += vx[i]; dy[i] += vy[i];
      if (Math.abs(dx[i]) + Math.abs(dy[i]) + Math.abs(vx[i]) + Math.abs(vy[i]) > 0.05) moving = true;
      else { dx[i] = dy[i] = vx[i] = vy[i] = 0; }
    }
    draw();
    if (moving || px !== null || ripples.length) kick();
  }
  const kick = () => { if (!raf && !document.hidden) raf = requestAnimationFrame(step); };

  const local = e => { const r = host.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  const onMove = e => { if (e.pointerType === 'touch' && !e.isPrimary) return; [px, py] = local(e); kick(); };
  const onLeave = () => { px = py = null; kick(); };
  const onDown = e => {
    if (e.target.closest('.tile, .note-tile, .vtools, button, input, textarea')) return;
    const [x, y] = local(e); ripples.push({ x, y, t0: performance.now() }); kick();
  };

  const ro = new ResizeObserver(() => build());
  ro.observe(host);
  if (!reduced()) {
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);
  }
  requestAnimationFrame(() => { build(); recolor(); });

  return {
    el: cv,
    recolor,
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); host.removeEventListener('pointermove', onMove); host.removeEventListener('pointerleave', onLeave); host.removeEventListener('pointerdown', onDown); },
  };
}
