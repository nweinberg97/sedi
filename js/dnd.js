// Sedi — one pointer-based drag engine for every surface.
// Draggables: [data-drag="<kind>"][data-id]. Drop zones: [data-drop="<zone>"][data-accept="kind kind"].
// List zones add [data-list] (index computed from children), canvas zones add [data-canvas].

const handlers = new Map();   // zone -> { drop(info), accepts?(info) }
const startHooks = new Set();
const endHooks = new Set();
let drag = null;
let suppressClick = false;

export function registerDrop(zone, spec) { handlers.set(zone, typeof spec === 'function' ? { drop: spec } : spec); }
export function onDragStart(fn) { startHooks.add(fn); }
export function onDragEnd(fn) { endHooks.add(fn); }
export const isDragging = () => !!drag?.active;
export const currentDrag = () => drag;

const IGNORE = 'button, input, textarea, select, a[href], [contenteditable="true"], [contenteditable="plaintext-only"], .no-drag, .resize-handle';

export function initDnd(navigate) {
  document.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    const el = e.target.closest('[data-drag]');
    if (!el || e.target.closest(IGNORE)) return;
    const r = el.getBoundingClientRect();
    drag = {
      el, kind: el.dataset.drag, id: el.dataset.id,
      sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY,
      gx: e.clientX - r.left, gy: e.clientY - r.top,
      w: r.width, h: r.height, active: false, zone: null, pointerId: e.pointerId,
    };
  });

  document.addEventListener('pointermove', e => {
    if (!drag || e.pointerId !== drag.pointerId) return;
    drag.x = e.clientX; drag.y = e.clientY;
    if (!drag.active) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 5) return;
      begin();
    }
    e.preventDefault();
    moveGhost();
    hitTest();
    autoScroll();
  }, { passive: false });

  const finish = e => {
    if (!drag || (e.pointerId != null && e.pointerId !== drag.pointerId)) return;
    if (drag.active) { end(e.type === 'pointercancel'); suppressClick = true; setTimeout(() => (suppressClick = false), 0); }
    drag = null;
  };
  document.addEventListener('pointerup', finish);
  document.addEventListener('pointercancel', finish);
  document.addEventListener('click', e => { if (suppressClick) { e.stopPropagation(); e.preventDefault(); suppressClick = false; } }, true);
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && drag?.active) { end(true); drag = null; } });

  function begin() {
    drag.active = true;
    getSelection()?.removeAllRanges();
    startHooks.forEach(fn => fn(drag));
    // Measure again: start hooks may reshape the source (e.g. a note collapsing).
    const r = drag.el.getBoundingClientRect();
    drag.w = r.width; drag.h = r.height;
    drag.gx = Math.min(drag.gx, r.width - 8); drag.gy = Math.min(drag.gy, r.height - 8);
    const ghost = drag.el.cloneNode(true);
    ghost.classList.add('drag-ghost');
    ghost.removeAttribute('data-drag');
    ghost.querySelectorAll('[data-drag],[data-drop]').forEach(n => { n.removeAttribute('data-drag'); n.removeAttribute('data-drop'); });
    Object.assign(ghost.style, { width: r.width + 'px', height: r.height + 'px', left: '0', top: '0', position: 'fixed', margin: '0' });
    document.body.append(ghost);
    drag.ghost = ghost;
    drag.el.classList.add('drag-source');
    document.body.classList.add('is-dragging');
    drag.placeholder = Object.assign(document.createElement('div'), { className: 'drop-line' });
  }

  function moveGhost() {
    drag.ghost.style.transform = `translate(${drag.x - drag.gx}px, ${drag.y - drag.gy}px) rotate(1.5deg)`;
  }

  function findZone() {
    const stack = document.elementsFromPoint(drag.x, drag.y);
    for (const node of stack) {
      if (node.classList?.contains('drag-ghost') || drag.ghost.contains(node)) continue;
      const z = node.closest?.('[data-drop]');
      if (!z) continue;
      const accept = (z.dataset.accept || 'card').split(' ');
      if (!accept.includes(drag.kind)) continue;
      if (z === drag.el || drag.el.contains(z)) continue;
      return z;
    }
    return null;
  }

  function hitTest() {
    const z = findZone();
    if (z !== drag.zone) {
      drag.zone?.classList.remove('drop-over', 'drop-deny');
      drag.zone = z;
      clearTimeout(drag.springTimer);
      if (z) {
        const spec = handlers.get(z.dataset.drop);
        const ok = spec?.accepts ? spec.accepts(info(z)) !== false : true;
        z.classList.add(ok ? 'drop-over' : 'drop-deny');
        drag.denied = !ok;
      }
      if (!z || !z.hasAttribute('data-list')) drag.placeholder.remove();
    }
    // Spring-loaded navigation: hover a navigator pill while dragging to switch tools.
    const spring = document.elementsFromPoint(drag.x, drag.y).find(n => n.closest?.('[data-spring-route]'))?.closest('[data-spring-route]');
    if (spring !== drag.spring) {
      clearTimeout(drag.springTimer);
      drag.spring = spring;
      if (spring) drag.springTimer = setTimeout(() => navigate(spring.dataset.springRoute), 550);
    }
    if (z?.hasAttribute('data-list') && !drag.denied) placeLine(z);
  }

  function listIndex(z) {
    const items = [...z.querySelectorAll('[data-drag]')].filter(n => n !== drag.el && n.parentElement && n.closest('[data-drop]') === z);
    let idx = items.length, before = null;
    for (let i = 0; i < items.length; i++) {
      const r = items[i].getBoundingClientRect();
      if (drag.y < r.top + r.height / 2) { idx = i; before = items[i]; break; }
    }
    return { idx, before, items };
  }
  function placeLine(z) {
    const { before, items } = listIndex(z);
    const host = before ? before.parentElement : (items.at(-1)?.parentElement || z.querySelector('[data-list-body]') || z);
    if (before) host.insertBefore(drag.placeholder, before);
    else host.append(drag.placeholder);
  }

  function info(z) {
    const canvasRect = z.getBoundingClientRect();
    return {
      kind: drag.kind, id: drag.id, el: drag.el, zone: z, data: z.dataset,
      x: drag.x, y: drag.y,
      left: drag.x - drag.gx - canvasRect.left + z.scrollLeft,
      top: drag.y - drag.gy - canvasRect.top + z.scrollTop,
      w: drag.w, h: drag.h, gx: drag.gx, gy: drag.gy,
      index: z.hasAttribute('data-list') ? listIndex(z).idx : null,
      zoneRect: canvasRect,
    };
  }

  function end(cancelled) {
    clearTimeout(drag.springTimer);
    const z = drag.zone;
    let accepted = false;
    if (!cancelled && z && !drag.denied) {
      const spec = handlers.get(z.dataset.drop);
      try { accepted = spec ? spec.drop(info(z)) !== false : false; } catch (err) { console.error(err); }
    }
    z?.classList.remove('drop-over', 'drop-deny');
    drag.placeholder.remove();
    const ghost = drag.ghost, el = drag.el;
    document.body.classList.remove('is-dragging');
    if (accepted || !el.isConnected) {
      ghost.remove();
      el.classList.remove('drag-source');
    } else {
      // Snap back to where it came from.
      const r = el.getBoundingClientRect();
      ghost.style.transition = 'transform .22s cubic-bezier(.2,.8,.2,1), opacity .22s';
      ghost.style.transform = `translate(${r.left}px, ${r.top}px)`;
      ghost.style.opacity = '0.4';
      setTimeout(() => { ghost.remove(); el.classList.remove('drag-source'); }, 230);
    }
    const snapshot = { ...drag, accepted };
    endHooks.forEach(fn => fn(snapshot));
  }

  function autoScroll() {
    const z = drag.zone;
    const sc = z?.closest('[data-autoscroll]') || z?.querySelector?.('[data-autoscroll]');
    if (!sc) return;
    const r = sc.getBoundingClientRect();
    const edge = 36;
    if (drag.y < r.top + edge) sc.scrollTop -= 10;
    else if (drag.y > r.bottom - edge) sc.scrollTop += 10;
    if (sc.scrollWidth > sc.clientWidth) {
      if (drag.x < r.left + edge) sc.scrollLeft -= 10;
      else if (drag.x > r.right - edge) sc.scrollLeft += 10;
    }
  }
}
