// Builds welcome/book-notes.html (printable, one book per page) from brain/library.json.
// Run: node scripts/build-book-notes.mjs
import { readFileSync, writeFileSync } from 'node:fs';
const root = new URL('../', import.meta.url);
const lib = JSON.parse(readFileSync(new URL('brain/library.json', root), 'utf8'));
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const sheet = b => `
<article class="sheet" id="${b.id}">
  <header><span class="emoji" aria-hidden="true">${b.emoji}</span><div><h2>${esc(b.title)}</h2><p class="by">${esc(b.author)} · ${b.year}</p></div></header>
  <p class="big">${esc(b.bigIdea)}</p>
  <h3>Key ideas</h3><ul>${b.ideas.map(i => `<li>${esc(i)}</li>`).join('')}</ul>
  <div class="cols"><section><h3>Try this</h3><p>${esc(b.tryThis)}</p></section><section><h3>In Sedi</h3><p>${esc(b.inSedi)}</p></section></div>
  <footer>Summary in Sedi’s own words of <i>${esc(b.title)}</i> by ${esc(b.author)} (${b.year}). It’s no substitute for the book. If this helped, read the original. Sedi isn’t affiliated with the author or publisher.</footer>
</article>`;
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Sedi Book Notes</title>
<meta name="description" content="Free one-page notes on books about habits, focus and wellbeing, with full credit to their authors.">
<link rel="icon" href="../icon.svg">
<style>
:root{--ink:#111;--ink-2:#4a5461;--muted:#7c8793;--line:#e5ecf2;--paper:#fff;--mist:#f4f8fb;--accent:#2e8bd0;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--ink:#eef2f6;--ink-2:#b9c3cd;--muted:#8e99a4;--line:#2a323b;--paper:#151a20;--mist:#0e1216;--accent:#6cb6ec}}
*{box-sizing:border-box}body{margin:0;background:var(--mist);color:var(--ink);font:16px/1.55 Inter,-apple-system,"Segoe UI",system-ui,sans-serif}
.wrap{max-width:820px;margin:0 auto;padding:32px 16px 64px}
.intro h1{font-size:34px;line-height:1.15;margin:0 0 8px;letter-spacing:-.02em}.intro p{color:var(--ink-2);margin:0 0 10px}
.toolbar{display:flex;flex-wrap:wrap;gap:10px;margin:18px 0 8px}.toolbar button,.toolbar a{font:inherit;font-size:14px;border:1px solid var(--line);background:var(--paper);color:var(--ink);border-radius:999px;padding:8px 16px;cursor:pointer;text-decoration:none}
.toc{display:flex;flex-wrap:wrap;gap:6px;margin:14px 0 28px;padding:0;list-style:none}.toc a{font-size:13px;color:var(--ink-2);text-decoration:none;border-radius:999px;padding:4px 10px;background:var(--paper);border:1px solid var(--line)}
.sheet{background:var(--paper);border:1px solid var(--line);border-radius:20px;padding:32px;margin:0 0 20px}
.sheet header{display:flex;gap:14px;align-items:center;margin-bottom:14px}.emoji{font-size:38px}
h2{margin:0;font-size:26px;letter-spacing:-.01em}.by{margin:2px 0 0;color:var(--muted)}
.big{font-size:18px;border-left:3px solid var(--accent);padding-left:14px;margin:0 0 18px}
h3{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:18px 0 6px}
ul{margin:0;padding-left:20px}li{margin:0 0 6px}
.cols{display:grid;grid-template-columns:1fr 1fr;gap:20px}.cols p{margin:0}
footer{margin-top:22px;padding-top:12px;border-top:1px solid var(--line);font-size:12.5px;color:var(--muted)}
.credits{font-size:14px;color:var(--ink-2)}.credits li{margin:0 0 4px}
@media (max-width:600px){.sheet{padding:22px 18px}.cols{grid-template-columns:1fr}.intro h1{font-size:28px}}
@media print{:root{--ink:#000;--ink-2:#333;--muted:#555;--line:#ccc;--paper:#fff;--mist:#fff}.toolbar,.toc,.no-print{display:none}.wrap{padding:0;max-width:none}
.sheet{border:0;border-radius:0;padding:0;margin:0;break-after:page}.big{border-color:#999}@page{margin:18mm}}
</style></head>
<body><main class="wrap">
<section class="intro">
  <h1>Book notes</h1>
  <p>One-page notes on books about habits, focus and feeling good. Each one has the big idea, a few key lessons, one thing to try today, and how to do it in Sedi.</p>
  <p>These are short summaries in our own words, with no quotations. They’re here to point you to books we love, not to replace them. Every author is credited on their page.</p>
  <div class="toolbar"><button onclick="print()">Print or save as PDF</button><a href="./">About Sedi</a></div>
  <ul class="toc">${lib.books.map(b => `<li><a href="#${b.id}">${esc(b.title)}</a></li>`).join('')}</ul>
</section>
${lib.books.map(sheet).join('\n')}
<section class="sheet credits"><h2>Credits</h2><p>Read the originals:</p><ul>${lib.books.map(b => `<li>${esc(b.author)}, <i>${esc(b.title)}</i> (${b.year}).</li>`).join('')}</ul>
<p>Sedi isn’t affiliated with, sponsored by or endorsed by these authors or their publishers. Book titles belong to their owners.</p></section>
</main></body></html>
`;
writeFileSync(new URL('welcome/book-notes.html', root), html);
console.log('wrote welcome/book-notes.html with', lib.books.length, 'books');
