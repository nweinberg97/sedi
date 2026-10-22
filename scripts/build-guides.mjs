// Builds the By Design guides from brain/library.json:
//   welcome/by-design/<id>.html   one guide per book: six fixed A4 pages when printed
//   welcome/index.html            the guide picker between <!-- GUIDES:START --> and <!-- GUIDES:END -->
// Then render the PDFs with: python3 scripts/render-guides.py
// Run: node scripts/build-guides.mjs
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const lib = JSON.parse(readFileSync(new URL('brain/library.json', root), 'utf8'));
mkdirSync(new URL('welcome/by-design/pdf/', root), { recursive: true });

const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pad = n => String(n).padStart(2, '0');
const cite = nums => `<sup class="fn">${nums.map(n => `<a href="#s${n}">${n}</a>`).join(',')}</sup>`;
// **bold**, *italic*, and [1] / [1,3] → footnotes pointing at this guide's numbered sources
const md = s => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\*(.+?)\*/g, '<i>$1</i>')
  .replace(/\s?\[(\d+(?:,\s*\d+)*)\]/g, (_, n) => cite(n.split(/,\s*/).map(Number)));
const plain = s => String(s ?? '').replace(/\*\*?(.+?)\*\*?/g, '$1').replace(/\s?\[(\d+(?:,\s*\d+)*)\]/g, '');
const short = u => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');
const linkRow = b => {
  const L = b.links || {}, out = [];
  if (L.book) out.push(`<a href="${esc(L.book)}" rel="noopener">The book ↗</a>`);
  if (L.author) out.push(`<a href="${esc(L.author)}" rel="noopener">${esc(L.authorLabel || b.author)} ↗</a>`);
  return out.length ? `<p class="links">${out.join('')}</p>` : '';
};
const linkList = b => {
  const L = b.links || {}, rows = [];
  if (L.book) rows.push(`<li><b>The book:</b> <a href="${esc(L.book)}" rel="noopener">${esc(short(L.book))}</a></li>`);
  if (L.author) rows.push(`<li><b>${esc(L.authorLabel || b.author)}:</b> <a href="${esc(L.author)}" rel="noopener">${esc(short(L.author))}</a></li>`);
  if (L.isbn) rows.push(`<li><b>ISBN:</b> ${esc(L.isbn)}</li>`);
  return rows.length ? `<ul class="linklist">${rows.join('')}</ul>` : '';
};
const src = arr => (arr?.length ? cite(arr) : '');
const pdfName = b => `By-Design-${String(b.n).padStart(2, '0')}-${b.title.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;

const FONTS = dir => [[300, 'normal', 'Light'], [300, 'italic', 'LightItalic'], [400, 'normal', 'Regular'], [400, 'italic', 'Italic'], [500, 'normal', 'Medium'], [700, 'normal', 'Bold']]
  .map(([w, s, f]) => `@font-face{font-family:"Poppins";font-weight:${w};font-style:${s};font-display:swap;src:url(${dir}/Poppins-${f}.ttf) format("truetype")}`).join('\n');

const CSS = `
:root{
  --g1:linear-gradient(135deg,#8b54ff 0%,#7f86f5 48%,#5ddfe6 100%);
  --g2:linear-gradient(135deg,#4fb2fd 0%,#7c82ef 55%,#9459e8 100%);
  --ink:#fff; --ink-2:rgba(255,255,255,.9); --ink-3:rgba(255,255,255,.74);
  --glass:rgba(255,255,255,.14); --glass-line:rgba(255,255,255,.32);
  --deep:#1f1650; --deep-2:#4b3f8f; --accent:#6c3ff0; --soft:#efe9ff;
  --paper:#f4f2fa; --text:#1b1636;
  --f:"Poppins","Futura","Avenir Next",system-ui,sans-serif;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);font:400 16px/1.55 var(--f);-webkit-font-smoothing:antialiased}
a{color:inherit}
.topnav{max-width:840px;margin:0 auto;padding:16px;display:flex;justify-content:space-between;align-items:center;gap:12px;font-weight:500;font-size:15px}
.topnav a{text-decoration:none}
.topnav .dl{background:var(--deep);color:#fff;border-radius:999px;padding:9px 18px}
main{max-width:840px;margin:0 auto;padding:0 16px 56px;display:grid;gap:18px}

/* A page: header strip, body, footer strip. Same skeleton on every page of every guide. */
.page{color:var(--ink);border-radius:22px;display:flex;flex-direction:column;padding:30px 40px 22px;box-shadow:0 22px 50px -32px rgba(40,20,110,.55);min-height:1050px}
.g1 .page{background:var(--g1)} .g2 .page{background:var(--g2)}
.ph,.pf{display:flex;justify-content:space-between;gap:16px;font-weight:500;font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--ink-3)}
.pf{letter-spacing:.02em;text-transform:none;font-weight:400;border-top:1px solid rgba(255,255,255,.28);padding-top:10px}
.pb{flex:1;display:flex;flex-direction:column;padding:26px 0 20px}
.kick{font-weight:500;font-size:12px;letter-spacing:.16em;text-transform:uppercase;color:var(--ink-3);margin:0 0 10px}
.kick.dark{color:var(--accent)}
.sp{flex:1;min-height:18px}
h1{font-weight:700;font-size:60px;line-height:1;letter-spacing:-.02em;margin:4px 0 12px}
h2{font-weight:700;font-size:44px;line-height:1.06;letter-spacing:-.015em;margin:0 0 14px}
h3{font-weight:700;font-size:19px;line-height:1.25;margin:0 0 6px}
.subtitle{font-style:italic;font-weight:300;font-size:20px;line-height:1.4;margin:0 0 16px;color:var(--ink-2)}
.byline{font-weight:500;font-size:18px;margin:0}
.lead{font-weight:300;font-size:18px;line-height:1.6;margin:0;color:var(--ink-2)}
.formula{font-weight:700;font-size:48px;line-height:1;margin:0 0 12px}
.glass{background:var(--glass);border:1px solid var(--glass-line);border-radius:18px;padding:18px 20px}
.white{background:#fff;color:var(--deep);border-radius:18px;padding:20px 24px}
.white .muted{color:var(--deep-2)}
.num{display:inline-grid;place-items:center;width:30px;height:30px;border-radius:50%;background:rgba(255,255,255,.95);color:var(--accent);font-weight:700;font-size:14px;flex:none}
.white .num{background:var(--soft)}
.row{display:flex;gap:14px;align-items:flex-start}
.stack{display:grid;gap:12px}
p{margin:0}
ul.checks{list-style:none;margin:0;padding:0;display:grid;gap:10px}
ul.checks li{display:flex;gap:12px;align-items:flex-start;font-size:16px}
ul.checks li::before{content:"✓";flex:none;width:22px;height:22px;border-radius:50%;background:#fff;color:var(--accent);font-weight:700;font-size:13px;display:grid;place-items:center;margin-top:1px}
ol.steps{list-style:none;margin:0;padding:0;counter-reset:s;display:grid;gap:10px}
ol.steps li{counter-increment:s;display:flex;gap:12px;align-items:flex-start;font-size:15.5px;line-height:1.5}
ol.steps li::before{content:counter(s);flex:none;width:26px;height:26px;border-radius:50%;background:var(--soft);color:var(--accent);font-weight:700;font-size:13px;display:grid;place-items:center}
.tag{font-style:italic;font-weight:300;color:var(--ink-2);margin:0 0 6px}
.tip{display:inline-block;margin-top:8px;background:rgba(255,255,255,.18);border-radius:10px;padding:5px 10px;font-size:14px}
.part p,.card p{font-weight:300;font-size:15px}
.stack.compact{gap:9px}.stack.compact .glass{padding:13px 18px}.stack.compact h3{font-size:17.5px;margin-bottom:2px}.stack.compact .tag{margin-bottom:3px}.stack.compact .part p{font-size:14px}.stack.compact .tip{margin-top:5px;font-size:13px}
.reflect p{font-style:italic;font-weight:300;font-size:23px;line-height:1.35;margin:0 0 14px}
.getbook{display:flex;gap:16px;align-items:center}
.gb-emoji{font-size:40px;line-height:1}
.links{display:flex;flex-wrap:wrap;gap:6px 14px;margin-top:8px;font-size:13.5px;font-weight:500}
.links a{color:var(--accent);text-decoration:none}
.linklist{list-style:none;margin:0 0 10px;padding:0;font-size:13.5px;display:grid;gap:3px}
.linklist a{color:var(--accent);word-break:break-word}
.sources ol{margin:0;padding-left:18px;font-size:10.5px;line-height:1.45;color:var(--ink-2);columns:2;column-gap:24px}
.sources li{margin:0 0 5px;break-inside:avoid}
.sources a{color:#fff;word-break:break-word}
sup.fn{font-size:.6em;font-weight:500;vertical-align:super;line-height:0;margin-left:2px}
sup.fn a{text-decoration:none;opacity:.85}
.white sup.fn a{color:var(--accent);opacity:1}
@media (max-width:640px){
  .page{padding:22px 20px 16px;border-radius:18px;min-height:0}
  .ph span:first-child{display:none}
  h1{font-size:40px} h2{font-size:32px} .formula{font-size:36px}
  .subtitle{font-size:17px} .lead{font-size:16.5px} .reflect p{font-size:19px}
  .sources ol{columns:1}
}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  @page{size:210mm 297mm;margin:0}
  html,body{background:#fff}
  .topnav{display:none}
  main{max-width:none;padding:0;display:block}
  .page{width:210mm;height:296.5mm;min-height:0;border-radius:0;box-shadow:none;padding:14mm 16mm 10mm;break-after:page;overflow:hidden}
  .page:last-child{break-after:auto}
  .lead{font-size:20px} .part p,.card p{font-size:16px} ul.checks li{font-size:17px} ol.steps li{font-size:16.5px} h3{font-size:20px}
  .stack.compact .part p{font-size:14.5px} .stack.compact h3{font-size:18px}
}`;

function page(i, total, b, inner) {
  return `<section class="page" aria-label="Page ${i}">
  <div class="ph"><span>By Design · Free guide ${pad(b.n)}</span><span>${esc(b.title)} · ${i} / ${total}</span></div>
  <div class="pb">${inner}</div>
  <div class="pf"><span>A free guide inspired by <i>${esc(b.title)}</i> by ${esc(b.author)}. Not affiliated with the author or publisher.</span><span>Please read the book</span></div>
</section>`;
}

function guide(b) {
  const f = b.framework;
  const pages = [
    // 1 · Cover: why this book is worth your time
    `<p class="kick">${esc(b.discipline)}</p>
     <h1>${esc(b.title)}</h1>
     ${b.subtitle ? `<p class="subtitle">${esc(b.subtitle)}</p>` : ''}
     <p class="byline">${esc(b.author)} · ${b.year}</p>
     <div class="sp"></div>
     <p class="lead">${md(b.pitch)}</p>
     <div class="sp"></div>
     <p class="kick">Why read it</p>
     <ul class="checks">${b.whyRead.map(x => `<li><span>${md(x)}</span></li>`).join('')}</ul>
     <div class="sp"></div>
     <div class="white getbook"><span class="gb-emoji" aria-hidden="true">${b.emoji}</span><div><p class="kick dark">Get the book</p><p><b>${esc(b.title)}</b> by ${esc(b.author)}</p><p class="muted" style="font-size:13.5px">${md(b.publisher)}, ${b.year}. At your local bookshop, your library, or as an audiobook.</p>${linkRow(b)}</div></div>`,
    // 2 · The big idea and three lessons
    `<p class="kick">The big idea</p>
     <h2>${esc(b.bigIdea.name)}</h2>
     <p class="lead">${md(b.bigIdea.body)}</p>
     <div class="sp"></div>
     <p class="kick">Three lessons</p>
     <div class="stack">${b.learnings.map((l, i) => `<div class="glass card row"><span class="num">${i + 1}</span><div><h3>${esc(l.title)}</h3><p>${md(l.text)}</p></div></div>`).join('')}</div>`,
    // 3 · The framework
    `<p class="kick">The framework</p>
     <h2>${esc(f.name)}${src(f.src)}</h2>
     ${f.formula ? `<p class="formula">${esc(f.formula)}</p>` : ''}
     <p class="lead">${md(f.intro)}</p>
     <div class="sp"></div>
     <div class="stack${f.parts.length > 4 ? ' compact' : ''}">${f.parts.map((p, i) => `<div class="glass part row"><span class="num">${i + 1}</span><div><h3>${esc(p.name)}</h3><p class="tag">${esc(p.tagline)}</p><p>${md(p.text)}</p>${p.tip ? `<span class="tip"><b>Try:</b> ${md(p.tip)}</span>` : ''}</div></div>`).join('')}</div>`,
    // 4 · Tools from the book
    `<p class="kick">From the book</p>
     <h2>Tools to try</h2>
     <div class="sp"></div>
     <div class="stack">${b.tools.map(t => `<div class="white"><h3 style="font-size:22px">${esc(t.name)}</h3><p class="muted" style="font-size:14px;margin:0 0 12px">${md(t.note)}</p><ol class="steps">${t.steps.map(s => `<li><span>${md(s)}</span></li>`).join('')}</ol></div>`).join('')}</div>
     <div class="sp"></div>`,
    // 5 · Practice and reflection
    `<p class="kick">Make it yours</p>
     <h2>Try it ${esc(b.practice.time.charAt(0).toLowerCase() + b.practice.time.slice(1))}</h2>
     <div class="white"><ol class="steps">${b.practice.steps.map(s => `<li><span>${md(s)}</span></li>`).join('')}</ol></div>
     <div class="sp"></div>
     <p class="kick">Reflect</p>
     <div class="reflect">${b.reflect.map(q => `<p>${md(q)}</p>`).join('')}</div>
     <div class="sp"></div>
     ${b.inSedi ? `<div class="glass" style="font-size:14.5px"><b>Try it in Sedi:</b> ${md(b.inSedi)}</div>` : ''}`,
    // 6 · Read the book, a personal note, sources
    `<div class="white">
       <p class="kick dark">Read the book</p>
       <p style="font-size:19px">${b.emoji} <b>${esc(b.title)}</b></p>
       <p class="muted" style="font-size:13.5px;margin:2px 0 10px">${esc(b.author)} · ${md(b.publisher)} · ${b.year}</p>
       ${linkList(b)}
       <p style="font-size:14.5px">This guide only scratches the surface. The book has the research, the stories and the nuance behind every idea here. Buy it from an independent bookshop, borrow it from your library, or listen to the audiobook.</p>
     </div>
     <div class="sp"></div>
     <p class="kick">A note from me</p>
     <p style="font-size:15px;color:var(--ink-2)">I'm not affiliated with ${esc(b.author)} or the publisher, and this guide isn't sponsored or endorsed by them. I've learned a lot from this book, so I'm sharing what I took from it, for free, in case it helps you too. Everything here is my own summary, in my own words. The good ideas are the author's; any mistakes are mine.</p>
     <p style="font-style:italic;margin-top:8px">The maker of Sedi</p>
     <div class="sp"></div>
     <div class="sources"><p class="kick">Sources</p><ol>${b.sources.map((s, i) => `<li id="s${i + 1}">${md(s.text)}${s.url ? ` <a href="${esc(s.url)}" rel="noopener">${esc(s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</li>`).join('')}</ol></div>`,
  ];
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(b.title)} · By Design</title>
<meta name="description" content="A free guide to ${esc(b.title)} by ${esc(b.author)}: the big idea, the framework, tools to try and a practice. Not affiliated with the author or publisher.">
<link rel="icon" href="../../icon.svg">
<style>${FONTS('../fonts')}${CSS}</style></head>
<body class="${b.n % 2 ? 'g1' : 'g2'}">
<nav class="topnav"><a href="../#guides">← All guides</a><a class="dl" href="pdf/${pdfName(b)}" download>Download PDF</a></nav>
<main>
${pages.map((inner, i) => page(i + 1, pages.length, b, inner)).join('\n')}
</main>
</body></html>`;
}

/* ---------- The picker on the landing page ---------- */
function picker() {
  const rows = lib.books.map(b => `
          <li><label class="gp-row">
            <input type="checkbox" value="${b.id}" data-pdf="by-design/pdf/${pdfName(b)}" data-title="${esc(b.title)}">
            <span class="gp-emoji" aria-hidden="true">${b.emoji}</span>
            <span class="gp-text"><b>${esc(b.title)}</b><small>${esc(b.author)} · ${esc(b.discipline)}</small><small class="gp-idea">${esc(b.bigIdea.name)}</small></span>
            <a class="gp-read" href="by-design/${b.id}.html" target="_blank" rel="noopener">Preview</a>
          </label></li>`).join('');
  return `<!-- GUIDES:START (generated by scripts/build-guides.mjs; edit brain/library.json instead) -->
  <section class="band" id="guides" aria-labelledby="guides-title">
    <div class="wrap guides-wrap">
      <div class="head"><span class="label">Free guides</span><h2 id="guides-title">Learn from the books that shaped Sedi.</h2>
        <p class="lede">Short guides to great books on habits, attention, wellbeing and each other. Each one has the big idea, the author's framework, tools to try and a practice for this week, with every source cited. Pick the ones you want and download them.</p></div>
      <div class="gp-box">
        <div class="gp-bar"><label class="gp-all"><input type="checkbox" id="gp-all"> Select all</label><span class="gp-count" aria-live="polite">${lib.books.length} guides</span></div>
        <ul class="gp-list">${rows}
        </ul>
        <div class="gp-foot"><button class="btn btn-primary btn-sm" id="gp-dl" type="button" disabled>Download</button><span class="gp-hint">One guide downloads as a PDF. Several download as one .zip.</span></div>
      </div>
      <p class="gp-note">I'm not affiliated with any of these authors or publishers, and nothing here is sponsored or endorsed by them. I've learned a lot from these books, and I'm offering what I took from them for free because they helped me. Each guide is my own summary with numbered sources. Please read the books.</p>
    </div>
  </section>
  <!-- GUIDES:END -->`;
}

lib.books.forEach((b, i) => { b.n = i + 1; });
for (const b of lib.books) writeFileSync(new URL(`welcome/by-design/${b.id}.html`, root), guide(b));
writeFileSync(new URL('welcome/by-design/pdfs.json', root), JSON.stringify(lib.books.map(b => ({ id: b.id, html: `${b.id}.html`, pdf: pdfName(b) })), null, 1) + '\n');
const indexUrl = new URL('welcome/index.html', root);
let index = readFileSync(indexUrl, 'utf8');
const re = /<!-- GUIDES:START[\s\S]*?<!-- GUIDES:END -->/;
if (!re.test(index)) throw new Error('welcome/index.html has no GUIDES markers');
index = index.replace(re, picker());
writeFileSync(indexUrl, index);
console.log(`wrote ${lib.books.length} guides and the landing-page picker`);
export { plain };
