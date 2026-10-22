// Builds welcome/by-design.html — the "By Design" learning library — from brain/library.json.
// One lesson per book: Resource → Principle → Framework → System → Reflect → Practice → In Sedi.
// Run: node scripts/build-book-notes.mjs
import { readFileSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const lib = JSON.parse(readFileSync(new URL('brain/library.json', root), 'utf8'));
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// **bold** inside strings, nothing else.
// [1] or [1,3] → footnote links to the current lesson's sources.
const md = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/\[(\d+(?:,\s*\d+)*)\]/g, (_, n) => cite(n.split(/,\s*/).map(Number)));
const pad = n => String(n).padStart(2, '0');
let cur = null; // current book while rendering, for footnote links
const cite = src => (src?.length ? `<sup class="fn">${src.map(n => `<a href="#${cur.id}-s${n}" aria-label="Source ${n}">${n}</a>`).join(',')}</sup>` : '');
const origin = o => (o ? `<span class="origin" title="Our application of the author's ideas, not the author's own framework">${esc(o)}</span>` : '');
const list = (items, cls = '') => `<ul class="${cls}">${items.map(i => `<li>${md(i)}</li>`).join('')}</ul>`;

function bookChip(b) {
  // A typographic stand-in for the cover: we don't reproduce cover art.
  return `<div class="chip-book" aria-hidden="true"><span class="cb-emoji">${b.emoji}</span><span class="cb-title">${esc(b.title)}</span><span class="cb-author">${esc(b.author)}</span></div>`;
}

function lesson(b, i) {
  cur = b;
  const g = i % 2 ? 'g2' : 'g1';
  const f = b.framework;
  const parts = f.parts.map((p, n) => `
      <article class="part">
        <div class="part-num">${n + 1}</div>
        <div class="part-body">
          <h4>${esc(p.name)}${cite(p.src)}</h4>
          ${p.tagline ? `<p class="tag">${md(p.tagline)}</p>` : ''}
          ${p.what ? `<p>${md(p.what)}</p>` : ''}
          ${p.how?.length ? `<p class="mini">How to design for it</p>${list(p.how)}` : ''}
          ${p.examples?.length ? `<div class="ex">${p.examples.map(e => `<div><span>${esc(e.label)}</span><p>${md(e.text)}</p></div>`).join('')}</div>` : ''}
        </div>
      </article>`).join('');
  const s = b.system;
  return `
<section class="lesson ${g}" id="${b.id}" aria-labelledby="${b.id}-t">
  <div class="slide cover">
    <div class="wrap two">
      <div>
        <p class="eyebrow">Lesson ${pad(i + 1)} · ${esc(b.discipline)}</p>
        <h2 id="${b.id}-t">${esc(b.title)}</h2>
        <p class="by">${esc(b.author)} · ${b.year}</p>
        <p class="about">${md(b.about)}</p>
        ${b.authorBio ? `<p class="bio">${md(b.authorBio)}</p>` : ''}
      </div>
      ${bookChip(b)}
    </div>
  </div>

  <div class="slide">
    <div class="wrap">
      <p class="kicker">Principle</p>
      <p class="principle">${esc(b.principle.name)}${cite(b.principle.src)} ${origin(b.principle.origin)}</p>
      <p class="lead">${md(b.principle.body)}</p>
    </div>
  </div>

  <div class="slide">
    <div class="wrap">
      <p class="kicker">Framework</p>
      <h3>${esc(f.name)}${cite(f.src)} ${origin(f.origin)}</h3>
      ${f.formula ? `<p class="formula">${esc(f.formula)}</p>` : ''}
      ${f.intro ? `<p class="lead">${md(f.intro)}</p>` : ''}
      <div class="parts">${parts}</div>
      ${f.note ? `<p class="note"><b>Note:</b> ${md(f.note)}</p>` : ''}
    </div>
  </div>

  <div class="slide">
    <div class="wrap">
      <p class="kicker">System</p>
      <h3>${esc(s.name)}${cite(s.src)} ${origin(s.origin)}</h3>
      ${s.intro ? `<p class="lead">${md(s.intro)}</p>` : ''}
      <ol class="steps">${s.steps.map(st => `<li><b>${esc(st.name)}${cite(st.src)}</b><span>${md(st.detail)}</span></li>`).join('')}</ol>
      ${s.example ? `<div class="worked"><p class="mini">Example: ${esc(s.example.title)}</p>${list(s.example.items)}</div>` : ''}
    </div>
  </div>

  <div class="slide split">
    <div class="wrap two">
      <div>
        <p class="kicker">Reflect</p>
        <div class="reflect">${b.reflect.map(q => `<p>${md(q)}</p>`).join('')}</div>
      </div>
      <div class="practice">
        <p class="kicker">Practice <span class="pill">${esc(b.practice.time)}</span>${cite(b.practice.src)} ${origin(b.practice.origin)}</p>
        <ol>${b.practice.steps.map(x => `<li>${md(x)}</li>`).join('')}</ol>
        ${b.inSedi ? `<p class="insedi"><b>In Sedi:</b> ${md(b.inSedi)}</p>` : ''}
      </div>
    </div>
  </div>

  <footer class="credit"><div class="wrap">
    <p>Based on <i>${esc(b.title)}</i> by ${esc(b.author)} (${esc(b.publisher)}, ${b.year}), summarized in our own words. Items marked <span class="origin">By Design</span> are our application of the book's ideas, not the author's. This is a starting point, not a substitute: <b>read the book</b> for the research, stories and nuance behind every idea here.</p>
    <p class="mini-h">Sources</p>
    <ol class="sources">${b.sources.map((x, n) => `<li id="${b.id}-s${n + 1}">${md(x.text)}${x.url ? ` <a href="${esc(x.url)}" rel="noopener">${esc(x.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : ''}</li>`).join('')}</ol>
  </div></footer>
</section>`;
}

const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>By Design · Sedi</title>
<meta name="description" content="Free lessons on behavior design from great books: one principle, one framework, one system and one practice per book, with full credit to every author.">
<link rel="icon" href="../icon.svg">
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Jost:ital,wght@0,300;0,400;0,500;0,700;1,300;1,400;1,600&display=swap">
<style>
:root{
  --violet:#8b5cf6; --violet-2:#8f58f9; --sky:#53b3fb; --aqua:#60e0e6;
  --g1:linear-gradient(100deg,#8b54ff 0%,#7e8cf4 45%,#5fe1e6 100%);
  --g2:linear-gradient(100deg,#52b4fd 0%,#7a84ef 55%,#925ce6 100%);
  --ink:#fff; --ink-2:rgba(255,255,255,.86); --ink-3:rgba(255,255,255,.7);
  --card:rgba(255,255,255,.14); --card-line:rgba(255,255,255,.28);
  --bg:#0f1024; --paper:#fff; --text:#16162a; --muted:#5f6274;
  --f:"Jost","Futura","Avenir Next",system-ui,sans-serif;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark){ :root:not([data-theme="light"]){ --paper:#14152b; --text:#eceaf7; --muted:#a6a8bd; } }
:root[data-theme="dark"]{ --paper:#14152b; --text:#eceaf7; --muted:#a6a8bd; }
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--text);font:400 18px/1.55 var(--f);-webkit-font-smoothing:antialiased}
.wrap{max-width:1040px;margin:0 auto;padding:0 24px}
.two{display:grid;grid-template-columns:1.6fr 1fr;gap:48px;align-items:center}

/* Intro */
.hero{background:var(--g1);color:var(--ink);padding:96px 0 72px;text-align:center}
.hero h1{font-weight:700;font-size:clamp(64px,12vw,148px);line-height:.95;letter-spacing:-.02em;margin:0}
.hero .sub{font-style:italic;font-weight:500;font-size:clamp(20px,3vw,30px);margin:18px 0 0}
.hero .intent{max-width:760px;margin:40px auto 0;font-weight:300;font-size:clamp(19px,2.2vw,24px);font-style:italic;color:var(--ink-2)}
.shape{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:28px 0 0;padding:0;list-style:none}
.shape li{border:1px solid var(--card-line);background:var(--card);border-radius:999px;padding:6px 16px;font-size:15px}
.toolbar{display:flex;gap:10px;justify-content:center;flex-wrap:wrap;margin-top:34px}
.btn{font:500 16px var(--f);color:#2b1f64;background:#fff;border:0;border-radius:999px;padding:12px 22px;cursor:pointer;text-decoration:none}
.btn.ghost{background:transparent;color:#fff;border:1px solid rgba(255,255,255,.6)}
.toc{background:var(--paper);padding:40px 0 8px}
.toc ol{list-style:none;margin:0;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.toc a{display:flex;gap:12px;align-items:baseline;padding:14px 16px;border-radius:14px;border:1px solid color-mix(in srgb,var(--text) 12%,transparent);color:var(--text);text-decoration:none}
.toc a:hover{border-color:var(--violet)}
.toc .n{font-weight:700;color:var(--violet);font-size:14px}
.toc b{display:block;font-weight:500}
.toc small{color:var(--muted)}
.how{padding:24px 0 48px;color:var(--muted);font-size:16px}
.how b{color:var(--text)}

/* Lesson slides */
.lesson{color:var(--ink);margin:0 0 4px}
.lesson.g1 .slide{background:var(--g1)}
.lesson.g2 .slide{background:var(--g2)}
.slide{padding:80px 0;position:relative}
.slide + .slide{border-top:1px solid rgba(255,255,255,.18)}
.eyebrow,.kicker{font-weight:500;letter-spacing:.14em;text-transform:uppercase;font-size:14px;color:var(--ink-3);margin:0 0 14px}
.kicker{font-size:15px}
.cover h2{font-weight:700;font-size:clamp(48px,7vw,88px);line-height:1;margin:0;letter-spacing:-.015em}
.by{font-weight:500;font-size:22px;margin:12px 0 22px}
.about{font-weight:300;font-size:clamp(20px,2.3vw,26px);line-height:1.45;margin:0}
.bio{font-weight:300;font-size:16px;color:var(--ink-3);margin:18px 0 0}
.chip-book{aspect-ratio:2/3;max-width:260px;justify-self:end;width:100%;border-radius:10px 18px 18px 10px;background:rgba(255,255,255,.96);color:#1c1640;padding:26px 22px;display:flex;flex-direction:column;box-shadow:0 30px 60px -20px rgba(30,10,80,.45), inset 10px 0 0 rgba(0,0,0,.06)}
.cb-emoji{font-size:44px}
.cb-title{font-weight:700;font-size:28px;line-height:1.05;margin-top:auto}
.cb-author{font-weight:500;font-size:15px;color:#5b4fa8;margin-top:10px}
h3{font-weight:700;font-size:clamp(34px,4.6vw,56px);line-height:1.05;margin:0 0 14px;letter-spacing:-.01em}
.principle{font-weight:400;font-size:clamp(40px,6vw,72px);line-height:1.05;margin:0 0 26px;letter-spacing:-.01em}
.lead{font-weight:300;font-size:clamp(19px,2.1vw,24px);line-height:1.5;max-width:820px;margin:0 0 8px;color:var(--ink-2)}
.formula{font-weight:700;font-size:clamp(40px,6vw,72px);margin:0 0 10px;color:#fff;background:linear-gradient(90deg,#fff,#e2d6ff);-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
.parts{display:grid;gap:14px;margin-top:30px}
.part{display:grid;grid-template-columns:56px 1fr;gap:18px;background:var(--card);border:1px solid var(--card-line);border-radius:20px;padding:24px 26px;backdrop-filter:blur(6px)}
.part-num{font-weight:300;font-size:48px;line-height:1}
.part h4{font-weight:700;font-size:26px;margin:2px 0 4px}
.part .tag{font-style:italic;font-weight:300;font-size:20px;margin:0 0 10px;color:var(--ink-2)}
.part p{margin:0 0 10px;font-weight:300}
.mini{font-weight:600 !important;font-size:14px;letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3);margin:16px 0 6px !important}
.part ul,.worked ul{margin:0;padding-left:20px;font-weight:300}
.part li,.worked li{margin:0 0 6px}
.part b,.lead b,.worked b,.steps b{font-weight:600}
.ex{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-top:14px}
.ex div{background:rgba(255,255,255,.12);border-radius:14px;padding:12px 14px}
.ex span{display:block;font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--ink-3);margin-bottom:4px}
.ex p{font-style:italic;font-size:16px;margin:0}
.note{font-style:italic;font-weight:300;font-size:17px;max-width:760px;margin:22px 0 0;color:var(--ink-2)}
.steps{list-style:none;counter-reset:s;margin:26px 0 0;padding:0;display:grid;gap:12px}
.steps li{counter-increment:s;display:grid;grid-template-columns:56px 1fr;column-gap:16px;align-items:baseline;font-size:20px}
.steps li::before{content:counter(s);grid-row:span 2;font-weight:300;font-size:44px;line-height:1}
.steps b{font-size:24px}
.steps span{font-weight:300;color:var(--ink-2)}
.worked{margin-top:28px;background:rgba(255,255,255,.95);color:#1c1640;border-radius:18px;padding:20px 24px}
.worked .mini{color:#6a5bc4 !important;margin-top:0 !important}
.reflect p{font-style:italic;font-weight:300;font-size:clamp(22px,2.6vw,30px);line-height:1.35;margin:0 0 18px}
.practice{background:rgba(255,255,255,.95);color:#1c1640;border-radius:22px;padding:28px}
.practice .kicker{color:#6a5bc4;display:flex;align-items:center;gap:10px}
.pill{background:#efe9ff;color:#4b3aa8;border-radius:999px;padding:3px 10px;font-size:13px;letter-spacing:.04em}
.practice ol{margin:0;padding-left:22px;font-size:18px}
.practice li{margin:0 0 10px}
.insedi{margin:18px 0 0;padding-top:14px;border-top:1px solid #e6e1f6;font-size:16px;color:#3b356a}
.credit{background:var(--paper);color:var(--muted);font-size:15px;padding:22px 0 30px}
.credit b{color:var(--text)}
.mini-h{font-weight:600;font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--text);margin:18px 0 6px}
.sources{margin:0;padding-left:22px;font-size:14px;line-height:1.5}
.sources li{margin:0 0 5px}
.sources a{color:var(--violet);word-break:break-word}
sup.fn{font-size:.45em;font-weight:500;vertical-align:super;margin-left:3px;letter-spacing:0}
sup.fn a{color:inherit;opacity:.75;text-decoration:none}
sup.fn a:hover{opacity:1;text-decoration:underline}
.origin{display:inline-block;vertical-align:middle;font:500 12px var(--f);letter-spacing:.06em;text-transform:uppercase;border:1px solid currentColor;border-radius:999px;padding:2px 9px;opacity:.85}
.credit .origin{font-size:11px;padding:1px 7px}
.end{padding:56px 0 80px}
.end h2{font-weight:700;font-size:40px;margin:0 0 12px}
.end ol{padding-left:22px}.end li{margin:0 0 6px}
.end .muted{color:var(--muted);font-size:15px}
a{color:inherit}

@media (max-width:760px){
  body{font-size:17px}
  .wrap{padding:0 16px}
  .two{grid-template-columns:1fr;gap:28px}
  .chip-book{justify-self:start;max-width:170px;padding:16px 14px}
  .cb-emoji{font-size:30px}.cb-title{font-size:20px}.cb-author{font-size:13px}
  .slide{padding:52px 0}
  .hero{padding:72px 0 52px}
  .part{grid-template-columns:1fr;gap:4px;padding:20px}
  .part-num{font-size:32px}
  .ex{grid-template-columns:1fr}
  .steps li{grid-template-columns:40px 1fr;font-size:18px}
  .steps li::before{font-size:32px}
  .steps b{font-size:20px}
  .practice{padding:22px}
}
@media print{
  *{-webkit-print-color-adjust:exact;print-color-adjust:exact}
  .toolbar,.toc,.how{display:none}
  .slide{padding:36px 0;break-inside:avoid}
  .lesson{break-before:page}
  .part,.worked,.practice{break-inside:avoid}
  @page{margin:0;size:A4 landscape}
}
</style></head>
<body>
<header class="hero">
  <div class="wrap">
    <h1>By Design</h1>
    <p class="sub">Building a future that is more human</p>
    <p class="intent">Weekly lessons for designers and design thinkers. Each one takes a book from a different discipline and turns it into something you can use: one principle, one framework, one system, and a practice to try today.</p>
    <ul class="shape"><li>Learn frameworks, principles + systems</li><li>Put ideas into practice</li><li>Share and learn from others</li><li>Build a contributory culture</li></ul>
    <div class="toolbar"><button class="btn" onclick="print()">Print or save as PDF</button><a class="btn ghost" href="./">About Sedi</a></div>
  </div>
</header>
<nav class="toc" aria-label="Lessons"><div class="wrap"><ol>
${lib.books.map((b, i) => `<li><a href="#${b.id}"><span class="n">${pad(i + 1)}</span><span><b>${esc(b.title)}</b><small>${esc(b.author)}</small></span></a></li>`).join('\n')}
</ol></div></nav>
<p class="how"><span class="wrap" style="display:block">Every lesson follows the same shape. <b>Principle</b>: the one idea to remember. <b>Framework</b>: the book's model, piece by piece. <b>System</b>: a repeatable way to apply it. <b>Reflect</b> and <b>Practice</b>: make it yours. These are our own summaries, written to send you to the books, not to replace them.</span></p>
${lib.books.map(lesson).join('\n')}
<section class="end" id="credits"><div class="wrap">
  <h2>Read the originals</h2>
  <ol>${lib.books.map(b => `<li>${esc(b.author)}, <i>${esc(b.title)}</i>. ${esc(b.publisher)}, ${b.year}.</li>`).join('')}</ol>
  <p class="muted">These lessons summarize and apply ideas from the books above in our own words. Named frameworks belong to their authors. Sedi and By Design aren't affiliated with, sponsored by or endorsed by any author or publisher.</p>
</div></section>
</body></html>
`;
writeFileSync(new URL('welcome/by-design.html', root), html);
console.log('wrote welcome/by-design.html with', lib.books.length, 'lessons');
