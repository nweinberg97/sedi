"""Render each By Design guide to its PDF and check that no page overflows.
Run from the repo root with a local server on port 8800:  python3 -m http.server 8800 &  then  python3 scripts/render-guides.py"""
import json, sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:8800/welcome/by-design/'
guides = json.load(open('welcome/by-design/pdfs.json'))
problems = 0
with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page()
    for g in guides:
        page.goto(BASE + g['html'])
        page.evaluate('document.fonts.ready')
        page.emulate_media(media='print')
        page.wait_for_timeout(200)
        over = page.evaluate("""() => [...document.querySelectorAll('.page')].map((pg, i) => {
            const pf = pg.querySelector('.pf'), pb = pg.querySelector('.pb');
            const over = Math.max(pf.getBoundingClientRect().bottom - pg.getBoundingClientRect().bottom + 1, pb.scrollHeight - pb.clientHeight);
            return { i: i + 1, over: Math.round(over) }; }).filter(x => x.over > 1)""")
        fonts = page.evaluate("[...document.fonts].filter(f => f.status === 'loaded').length")
        for o in over:
            problems += 1
            print(f"OVERFLOW {g['id']} page {o['i']}: {o['over']}px")
        page.pdf(path='welcome/by-design/pdf/' + g['pdf'], prefer_css_page_size=True, print_background=True)
        import pypdf
        n = len(pypdf.PdfReader('welcome/by-design/pdf/' + g['pdf']).pages)
        if n != 6: problems += 1; print(f"PAGES {g['id']}: {n}")
        print(f"ok {g['pdf']} ({n} pages, fonts {fonts})")
    browser.close()
sys.exit(1 if problems else 0)
