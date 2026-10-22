// Sedi — liquid glass. Bends the backdrop near an element's edges (like a thick lens), adds a
// faint chromatic fringe, and lets a specular highlight follow the pointer.
// Edge refraction needs Chromium (SVG filters inside backdrop-filter); other browsers get the
// same highlights and rim over a clear blur.

let counter = 0;
const SVG_NS = 'http://www.w3.org/2000/svg';
const isChromium = () => !!navigator.userAgentData?.brands?.some(b => /Chromium|Google Chrome|Microsoft Edge/i.test(b.brand))
  || (/Chrome\//.test(navigator.userAgent) && !/Edg\/|OPR\//.test(navigator.userAgent) && !/Safari\/(?!537)/.test(navigator.userAgent));

function defsHost() {
  let svg = document.getElementById('sedi-glass-defs');
  if (!svg) {
    svg = document.createElementNS(SVG_NS, 'svg');
    svg.id = 'sedi-glass-defs';
    svg.setAttribute('aria-hidden', 'true');
    Object.assign(svg.style, { position: 'absolute', width: '0', height: '0', overflow: 'hidden' });
    document.body.append(svg);
  }
  return svg;
}

/** Signed distance from point to a rounded rectangle (negative inside). */
function sdRoundRect(px, py, w, h, r) {
  const qx = Math.abs(px - w / 2) - (w / 2 - r);
  const qy = Math.abs(py - h / 2) - (h / 2 - r);
  const ox = Math.max(qx, 0), oy = Math.max(qy, 0);
  return Math.hypot(ox, oy) + Math.min(Math.max(qx, qy), 0) - r;
}

/** Build an RG displacement map: neutral in the middle, pulling inward near the rim. */
function buildMap(w, h, radius, edge) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const dist = -sdRoundRect(x + 0.5, y + 0.5, w, h, radius); // distance inside the edge
      let r = 128, g = 128;
      if (dist >= 0 && dist < edge) {
        const gx = sdRoundRect(x + 1.5, y + 0.5, w, h, radius) - sdRoundRect(x - 0.5, y + 0.5, w, h, radius);
        const gy = sdRoundRect(x + 0.5, y + 1.5, w, h, radius) - sdRoundRect(x + 0.5, y - 0.5, w, h, radius);
        const len = Math.hypot(gx, gy) || 1;
        const t = 1 - dist / edge;
        const k = t * t * (3 - 2 * t); // smoothstep: strongest at the rim, fading inward
        r = 128 - (gx / len) * k * 127;
        g = 128 - (gy / len) * k * 127;
      }
      d[i] = r; d[i + 1] = g; d[i + 2] = 128; d[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}

export function mountLiquidGlass(el, { strength = 64, edge = 42, refract = true } = {}) {
  if (!el) return () => {};
  const id = `sedi-lg-${++counter}`;
  const chromium = refract && isChromium();
  let filter = null;

  if (chromium) {
    filter = document.createElementNS(SVG_NS, 'filter');
    filter.id = id;
    filter.setAttribute('color-interpolation-filters', 'sRGB');
    filter.setAttribute('x', '-50%'); filter.setAttribute('y', '-50%');
    filter.setAttribute('width', '200%'); filter.setAttribute('height', '200%');
    const channels = [['R', 1, '1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0'], ['G', 1.07, '0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0'], ['B', 1.14, '0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0']];
    filter.innerHTML = `<feImage result="map" x="0" y="0" preserveAspectRatio="none"/>`
      + channels.map(([c, mult, m]) => `<feDisplacementMap in="SourceGraphic" in2="map" scale="${strength * mult}" xChannelSelector="R" yChannelSelector="G" result="d${c}"/><feColorMatrix in="d${c}" type="matrix" values="${m}" result="c${c}"/>`).join('')
      + '<feBlend in="cR" in2="cG" mode="screen" result="rg"/><feBlend in="rg" in2="cB" mode="screen"/>';
    defsHost().append(filter);
  }

  const paint = () => {
    const r = el.getBoundingClientRect();
    const w = Math.round(r.width), hgt = Math.round(r.height);
    if (!w || !hgt) return;
    if (filter) {
      const radius = parseFloat(getComputedStyle(el).borderTopLeftRadius) || 32;
      const img = filter.querySelector('feImage');
      // Chromium positions backdrop-filter primitives from the content box, so shift the map back by the padding.
      const cs = getComputedStyle(el);
      img.setAttribute('x', -(parseFloat(cs.paddingLeft) + parseFloat(cs.borderLeftWidth)) || 0); img.setAttribute('y', -(parseFloat(cs.paddingTop) + parseFloat(cs.borderTopWidth)) || 0);
      img.setAttribute('width', w); img.setAttribute('height', hgt);
      const url = buildMap(w, hgt, Math.min(radius, hgt / 2), Math.min(edge, hgt / 3));
      img.setAttribute('href', url);
      // The map decodes asynchronously and Chromium won't repaint the filter on its own, so re-apply once it's ready.
      const probe = new Image();
      probe.src = url;
      probe.decode().catch(() => {}).then(() => {
        el.style.backdropFilter = 'none';
        void el.offsetWidth;
        requestAnimationFrame(() => {
          el.style.backdropFilter = `url(#${id}) blur(1px) saturate(1.15) brightness(1.05)`;
          if (!getComputedStyle(el).backdropFilter.includes('url')) el.style.backdropFilter = '';
        });
      });
    }
  };
  paint();
  el.classList.add(chromium ? 'lg-refract' : 'lg-fallback');
  const ro = new ResizeObserver(() => { clearTimeout(ro._t); ro._t = setTimeout(paint, 120); });
  ro.observe(el);

  // Specular highlight follows the pointer across the glass (and drifts home when it leaves).
  const move = e => {
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${((e.clientX - r.left) / r.width) * 100}%`);
    el.style.setProperty('--my', `${((e.clientY - r.top) / r.height) * 100}%`);
  };
  const leave = () => { el.style.removeProperty('--mx'); el.style.removeProperty('--my'); };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);

  return () => { ro.disconnect(); filter?.remove(); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
}
