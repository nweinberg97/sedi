// Sedi — the weather sky. A quiet layer behind Home that shows the real weather on top of the time-of-day sky.
// Two parts, so the weather adds atmosphere without becoming busy:
//   • the mood, always on and still: a tint for the conditions, the sun's warmth or the moon, resting clouds or mist,
//     and a warmer or cooler wash for the temperature. Drawn once; nothing moves.
//   • the motion, a short moment: rain, snow, drifting clouds, moving mist or a distant flash play for a few seconds
//     when you open Home, come back after a while, or the weather changes, then settle into the still mood.
// "Weather motion" can be Moments (default), Always or Off; "reduce motion" always means still.
// Runs only while Home is open; draws nothing at all while the tab is hidden.

const KINDS = {
  clear: [0], partly: [1, 2], cloudy: [3], fog: [45, 48],
  rain: [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82], snow: [71, 73, 75, 77, 85, 86], storm: [95, 96, 99],
};
export const weatherKind = code => Object.keys(KINDS).find(k => KINDS[k].includes(code)) || 'clear';

const MOMENT_MS = 9000;   // how long the weather moves
const FADE_MS = 2500;     // the last part of the moment, easing into stillness
const AWAY_MS = 10 * 60e3; // back after this long → the moment plays again
const FRAME_MS = 1000 / 30; // 30 frames a second is plenty for slow weather and kinder to batteries

let cv, ctx, raf = 0, W = 0, H = 0, dpr = 1;
let state = { kind: 'clear', sky: 'day', temp: null };
let mode = 'moments', momentStart = 0, lastDraw = 0, hiddenAt = 0, t0 = 0;
let parts = [], clouds = [], flash = 0, nextFlash = 0;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rnd = (a, b) => a + Math.random() * (b - a);
const dark = () => state.sky === 'night' || state.sky === 'dusk' || state.kind === 'storm';

function cloudSprite(w, h, grey) {
  // a soft cumulus: a flat base with billows on top, built from many faint puffs so it has no hard edges
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const tone = grey ? '205, 214, 232' : '255, 255, 255';
  const puff = (x, y, r, a) => { const grd = g.createRadialGradient(x, y, 0, x, y, r); grd.addColorStop(0, `rgba(${tone}, ${a})`); grd.addColorStop(0.6, `rgba(${tone}, ${a * 0.45})`); grd.addColorStop(1, `rgba(${tone}, 0)`); g.fillStyle = grd; g.beginPath(); g.arc(x, y, r, 0, 7); g.fill(); };
  const base = h * 0.68;
  for (let i = 0; i < 14; i++) puff(rnd(w * 0.12, w * 0.88), base + rnd(-h * 0.04, h * 0.06), rnd(h * 0.16, h * 0.26), 0.22);
  for (let i = 0; i < 10; i++) { const x = rnd(w * 0.22, w * 0.78); puff(x, base - rnd(h * 0.12, h * 0.3) * (1 - Math.abs(x / w - 0.5)), rnd(h * 0.18, h * 0.3), 0.2); }
  return c;
}

function seed() {
  const { kind } = state;
  const small = W < 700;                       // phones: fewer drops and flakes, same look
  parts = [];
  if (kind === 'rain' || kind === 'storm') {
    const n = Math.round((kind === 'storm' ? 0.2 : 0.12) * W / (small ? 2 : 1.5)) + (kind === 'storm' ? 60 : 40);
    for (let i = 0; i < n; i++) parts.push({ x: rnd(-50, W), y: rnd(-H, H), l: rnd(10, 20), v: rnd(9, 14) * (kind === 'storm' ? 1.25 : 1), a: rnd(0.10, 0.28) });
  }
  if (kind === 'snow') for (let i = 0; i < Math.round(W / (small ? 12 : 9)) + 30; i++) parts.push({ x: rnd(0, W), y: rnd(-H, H), r: rnd(0.8, 2.6), v: rnd(0.3, 1.0), p: rnd(0, 6.28), a: rnd(0.4, 0.85) });
  const nClouds = { clear: 0, partly: 3, cloudy: 6, fog: 0, rain: 5, snow: 4, storm: 6 }[kind] ?? 0;
  clouds = [];
  for (let i = 0; i < (small ? Math.ceil(nClouds * 0.6) : nClouds); i++) {
    const w = rnd(380, 720) * (small ? 0.7 : 1), h = w * 0.36;
    clouds.push({ img: cloudSprite(Math.round(w), Math.round(h), dark() || kind === 'rain' || kind === 'storm'), x: rnd(-w, W), y: rnd(-h * 0.2, H * (kind === 'partly' ? 0.35 : 0.55)), w, h, v: rnd(0.08, 0.28), a: rnd(0.35, 0.65) * (dark() ? 0.45 : 1) });
  }
}

/** The still mood: a wash for the weather, the temperature's nudge, and the sun or the moon on clear skies. */
function mood() {
  const { kind, sky, temp } = state;
  const day = sky === 'day' || sky === 'dawn';
  const tints = {
    cloudy: day ? 'rgba(150, 165, 185, 0.20)' : 'rgba(40, 45, 60, 0.20)',
    rain: day ? 'rgba(95, 115, 140, 0.30)' : 'rgba(20, 28, 45, 0.28)',
    storm: day ? 'rgba(40, 52, 78, 0.60)' : 'rgba(10, 12, 25, 0.40)',
    snow: day ? 'rgba(210, 222, 238, 0.35)' : 'rgba(60, 70, 95, 0.25)',
    fog: day ? 'rgba(225, 232, 240, 0.35)' : 'rgba(90, 100, 120, 0.25)',
    partly: day ? 'rgba(200, 215, 230, 0.08)' : null,
  };
  if (tints[kind]) { ctx.fillStyle = tints[kind]; ctx.fillRect(0, 0, W, H); }
  if (temp != null && (kind === 'clear' || kind === 'partly')) {
    if (temp >= 26) { ctx.fillStyle = 'rgba(255, 170, 90, 0.10)'; ctx.fillRect(0, 0, W, H); }
    else if (temp <= 0) { ctx.fillStyle = 'rgba(190, 215, 255, 0.12)'; ctx.fillRect(0, 0, W, H); }
  }
  if (kind !== 'clear' && kind !== 'partly') return;
  if (day) {
    const x = W * 0.84, y = H * 0.1, r = Math.max(W, H) * 0.45;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, sky === 'dawn' ? 'rgba(255, 228, 200, 0.6)' : 'rgba(255, 255, 252, 0.75)'); g.addColorStop(0.12, sky === 'dawn' ? 'rgba(255, 228, 200, 0.3)' : 'rgba(255, 255, 250, 0.35)'); g.addColorStop(0.45, 'rgba(255, 255, 250, 0.06)'); g.addColorStop(1, 'rgba(255, 255, 250, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  } else if (sky === 'night') {
    const narrow = W < 700, x = W * (narrow ? 0.8 : 0.83), y = H * (narrow ? 0.72 : 0.15), r = Math.max(14, Math.min(W, H) * 0.022);
    const glow = ctx.createRadialGradient(x, y, r, x, y, r * 9);
    glow.addColorStop(0, 'rgba(220, 230, 255, 0.22)'); glow.addColorStop(1, 'rgba(220, 230, 255, 0)');
    ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H);
    const disc = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
    disc.addColorStop(0, 'rgba(255, 252, 240, 1)'); disc.addColorStop(1, 'rgba(225, 230, 245, 0.95)');
    ctx.save();
    ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.arc(x + r * 0.45, y - r * 0.22, r * 0.9, 0, 7); ctx.clip('evenodd');
    ctx.fillStyle = disc; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    ctx.restore();
  } else {
    const x = W * 0.5, y = H * 1.05, r = Math.max(W, H) * 0.6;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255, 190, 130, 0.45)'); g.addColorStop(1, 'rgba(255, 190, 130, 0)');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
}

/** One picture of the sky. m is how much the weather is moving: 1 in the middle of a moment, 0 when still. */
function draw(t, m) {
  const { kind, sky } = state;
  ctx.clearRect(0, 0, W, H);
  mood();
  for (const c of clouds) {
    if (m > 0) { c.x += c.v * m; if (c.x > W + 40) c.x = -c.w; }
    ctx.globalAlpha = c.a; ctx.drawImage(c.img, c.x, c.y, c.w, c.h);
  }
  ctx.globalAlpha = 1;
  if (kind === 'fog') {
    // mist always rests in bands; it drifts only while the weather is moving
    const dim = sky === 'night' || sky === 'dusk', tone = dim ? '170, 180, 200' : '255, 255, 255';
    for (let i = 0; i < 5; i++) {
      // wide, uneven banks that overlap, so it reads as haze rather than stripes; they breathe up and down while moving
      const band = H * (0.16 + (i % 3) * 0.04), y = H * (0.18 + i * 0.17) + Math.sin((t - t0) * 0.0004 + i * 1.7) * H * 0.02;
      const a = (dim ? 0.13 : 0.2) * (0.75 + (i % 2) * 0.35);
      const g = ctx.createLinearGradient(0, y - band, 0, y + band);
      g.addColorStop(0, `rgba(${tone}, 0)`); g.addColorStop(0.5, `rgba(${tone}, ${a})`); g.addColorStop(1, `rgba(${tone}, 0)`);
      ctx.fillStyle = g; ctx.fillRect(0, y - band, W, band * 2);
    }
  }
  if (m <= 0) return;
  if (kind === 'rain' || kind === 'storm') {
    ctx.lineCap = 'round'; ctx.lineWidth = 0.9;
    for (const p of parts) {
      p.y += p.v; p.x += p.v * 0.18;
      if (p.y > H) { p.y = rnd(-80, -10); p.x = rnd(-50, W); }
      ctx.strokeStyle = `rgba(220, 232, 250, ${p.a * m})`;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.l * 0.18, p.y - p.l); ctx.stroke();
    }
  }
  if (kind === 'snow') {
    for (const p of parts) {
      p.y += p.v; p.p += 0.012; p.x += Math.sin(p.p) * 0.35;
      if (p.y > H + 5) { p.y = -5; p.x = rnd(0, W); }
      ctx.fillStyle = `rgba(255, 255, 255, ${p.a * m})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 7); ctx.fill();
    }
  }
  if (kind === 'storm') {
    if (!nextFlash) nextFlash = t + rnd(1500, 3500);       // within the moment, one soft flash is enough
    if (t > nextFlash && m > 0.6) { flash = 1; nextFlash = t + rnd(5000, 11000); }
    if (flash > 0.01) { ctx.fillStyle = `rgba(230, 236, 255, ${flash * 0.22})`; ctx.fillRect(0, 0, W, H); flash *= 0.88; }
  }
}

const motionFor = t => {
  if (mode === 'off' || reduced()) return 0;
  if (mode === 'always') return 1;
  const e = t - momentStart;
  if (e >= MOMENT_MS) return 0;
  return e < MOMENT_MS - FADE_MS ? 1 : (MOMENT_MS - e) / FADE_MS;
};
function loop(t) {
  raf = 0;
  if (!cv || document.hidden) return;
  const m = motionFor(t);
  if (t - lastDraw >= FRAME_MS || m === 0) { lastDraw = t; draw(t, m); }
  if (m > 0) raf = requestAnimationFrame(loop);   // still → stop asking for frames altogether
  else document.body.dataset.wxMotion = 'still';
}
function start(moment) {
  cancelAnimationFrame(raf); raf = 0;
  const now = performance.now();
  if (moment) { momentStart = now; t0 = now; nextFlash = 0; flash = 0; }
  if (motionFor(now) > 0) { document.body.dataset.wxMotion = 'moving'; raf = requestAnimationFrame(loop); }
  else { document.body.dataset.wxMotion = 'still'; draw(now, 0); }
}
function size() {
  dpr = Math.min(2, devicePixelRatio || 1); W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cv.style.width = W + 'px'; cv.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
const onResize = () => { if (!cv) return; size(); seed(); start(false); };
const onVisible = () => {
  if (!cv) return;
  if (document.hidden) { hiddenAt = Date.now(); cancelAnimationFrame(raf); raf = 0; return; }
  start(mode === 'moments' && hiddenAt && Date.now() - hiddenAt > AWAY_MS);
};

/**
 * Show the weather sky. { kind, sky, temp } from Home; moment: true plays the weather's motion now
 * (opening Home, or the weather changed). A change of time of day alone just redraws the still mood.
 */
export function setSky(next, { moment = false } = {}) {
  const changed = !cv || next.kind !== state.kind || next.sky !== state.sky;
  state = { ...state, ...next };
  if (!cv) {
    cv = document.createElement('canvas'); cv.className = 'sky-fx'; cv.setAttribute('aria-hidden', 'true');
    document.body.prepend(cv); ctx = cv.getContext('2d'); size();
    addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', onVisible);
  }
  document.body.dataset.wx = state.kind;
  if (changed) seed();
  start(moment);
}
/** Play the weather's motion again (the "replay" in the preview, or a setting change). */
export const playMoment = () => { if (cv) start(true); };
/** 'moments' (default) | 'always' | 'off' */
export function setMotionMode(m) { mode = ['moments', 'always', 'off'].includes(m) ? m : 'moments'; if (cv) start(mode !== 'off'); }
export function clearSky() {
  cancelAnimationFrame(raf); raf = 0;
  removeEventListener('resize', onResize);
  document.removeEventListener('visibilitychange', onVisible);
  cv?.remove(); cv = null;
  delete document.body.dataset.wx; delete document.body.dataset.wxMotion;
}
