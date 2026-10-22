// Sedi landing page scripts (kept in a file so the page can use a strict Content-Security-Policy).
(() => {
  // Only show the landing page in its own tab, never framed inside another site.
  let framed = true;
  try { framed = window.top !== window.self; } catch {}
  if (framed) {
    const a = document.createElement('a');
    a.href = location.href; a.target = '_top'; a.rel = 'noopener'; a.textContent = 'Open the Sedi page in its own tab';
    document.body.replaceChildren(a);
    return;
  }
  const top = document.getElementById('top');
  const onScroll = () => top.classList.toggle('scrolled', scrollY > 12);
  addEventListener('scroll', onScroll, { passive: true }); onScroll();

  // The problem: scattered pieces settle into order.
  const scatter = document.getElementById('scatter'), btn = document.getElementById('order-btn'), state = document.getElementById('scatter-state');
  btn.addEventListener('click', () => {
    const on = scatter.classList.toggle('ordered');
    btn.setAttribute('aria-pressed', on); btn.textContent = on ? 'Scatter them again' : 'Put them in order';
    state.textContent = on ? 'One place, in order. That’s Sedi.' : 'Five places, none of them talking.';
  });

  // Tour tabs.
  const TOUR = {
    home: ['Home', 'Your morning view: the time, the weather and the three things that come next. Nothing else competes for your attention.', 'Next up pulls the top task and today’s events from every tool.', 'Sedi’s Home view with a clock, the weather and a Next up list.'],
    taskly: ['Taskly', 'Five columns from To do to Backlog, and none of them scroll. When one fills up, you finish, move or let go of something.', 'Review cards count down and come back to you when it’s time.', 'Taskly: five columns, To do, In progress, Review, Completed and Backlog, each holding a few task cards.'],
    boardly: ['Boardly', 'A board for each part of your life: health, relationships, work, chores. Goals, tasks and notes sit wherever you put them.', 'Goals open into a SMART template when you’re ready to plan.', 'Boardly: the Health board with goal, task and note cards placed freely on a dotted canvas.'],
    timely: ['Timely', 'Day, week, month and reminders, plus planning boards for projects and goals. Timely looks forward, so past one-off items archive themselves.', 'Send any event, or a whole day, to your calendar.', 'Timely: the October month view with dots for planned items, a trip spanning several days and an October plan list.'],
    brainly: ['Brainly', 'Notes, links, PDFs and files, with folders inside folders and one search across everything in Sedi.', 'Open any note in Google Docs, or turn a link into a task in one click.', 'Brainly: a column of links and folders beside a canvas of colored note cards and folders.'],
  };
  const tabs = [...document.querySelectorAll('.tab')], stages = [...document.querySelectorAll('#tour-stages .stage')];
  const select = (tab, focus) => {
    const k = tab.dataset.k, t = TOUR[k];
    tabs.forEach(x => { const on = x === tab; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; });
    document.getElementById('tour-panel').setAttribute('aria-labelledby', tab.id);
    document.getElementById('tour-name').textContent = t[0];
    document.getElementById('tour-text').textContent = t[1];
    document.getElementById('tour-note').textContent = t[2];
    stages.forEach(st => { st.hidden = st.dataset.k !== k; });
    if (focus) tab.focus();
  };
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => select(tab));
    tab.addEventListener('keydown', e => {
      const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (d) { e.preventDefault(); select(tabs[(i + d + tabs.length) % tabs.length], true); }
    });
  });
  const copy = document.getElementById('copy-link');
  copy?.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(copy.dataset.url); copy.textContent = 'Copied'; }
    catch { copy.textContent = copy.dataset.url; }
  });
})();

// Free guides: tick the ones you want; one downloads as a PDF, several as a .zip built right here in the browser.
(() => {
  const box = document.getElementById('guides'); if (!box) return;
  const boxes = [...box.querySelectorAll('.gp-list input')], all = box.querySelector('#gp-all'), btn = box.querySelector('#gp-dl'), count = box.querySelector('.gp-count');
  const sync = () => { const n = boxes.filter(b => b.checked).length; btn.disabled = !n; btn.textContent = n > 1 ? `Download ${n} guides (.zip)` : n ? 'Download PDF' : 'Download'; count.textContent = n ? `${n} of ${boxes.length} selected` : `${boxes.length} guides`; all.checked = n === boxes.length; all.indeterminate = n > 0 && n < boxes.length; };
  boxes.forEach(b => b.addEventListener('change', sync)); all.addEventListener('change', () => { boxes.forEach(b => { b.checked = all.checked; }); sync(); });
  const save = (blob, name) => { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.append(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000); };
  // Minimal "stored" zip writer (PDFs are already compressed).
  const crcT = new Uint32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc32 = u => { let c = 0xFFFFFFFF; for (let i = 0; i < u.length; i++) c = crcT[(c ^ u[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  function zip(files) {
    const parts = [], central = []; let off = 0;
    for (const f of files) {
      const name = new TextEncoder().encode(f.name), crc = crc32(f.data), size = f.data.length;
      const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true); h.setUint32(18, size, true); h.setUint32(22, size, true); h.setUint16(26, name.length, true);
      parts.push(h, name, f.data);
      const c = new DataView(new ArrayBuffer(46)); c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true); c.setUint32(20, size, true); c.setUint32(24, size, true); c.setUint16(28, name.length, true); c.setUint32(42, off, true);
      central.push(c, name); off += 30 + name.length + size;
    }
    const cSize = central.reduce((n, x) => n + x.byteLength, 0), e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cSize, true); e.setUint32(16, off, true);
    return new Blob([...parts, ...central, e], { type: 'application/zip' });
  }
  btn.addEventListener('click', async () => {
    const picked = boxes.filter(b => b.checked); if (!picked.length) return;
    const label = btn.textContent; btn.disabled = true; btn.textContent = 'Preparing…';
    try {
      const files = await Promise.all(picked.map(async b => { const r = await fetch(b.dataset.pdf); if (!r.ok) throw new Error(b.dataset.title); return { name: b.dataset.pdf.split('/').pop(), data: new Uint8Array(await r.arrayBuffer()) }; }));
      if (files.length === 1) save(new Blob([files[0].data], { type: 'application/pdf' }), files[0].name);
      else save(zip(files), 'By-Design-Free-Guides.zip');
    } catch (e) { count.textContent = `Sorry, “${e.message}” couldn’t be downloaded. Please try again.`; }
    btn.textContent = label; btn.disabled = false;
  });
  sync();
})();
