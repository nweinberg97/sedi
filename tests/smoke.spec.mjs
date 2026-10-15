// Sedi smoke test: proves the core loop still works and that old (v1) data still loads.
// Each test gets a fresh browser profile, so IndexedDB and localStorage start empty.

import { test, expect } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(HERE, 'fixtures', 'v1-export.json');
const SHOTS = path.join(HERE, 'screenshots', process.env.SEDI_SHOTS || 'current');
mkdirSync(SHOTS, { recursive: true });

// ---------- helpers ----------

/** Block every non-local request (weather, CDN) so runs are deterministic and offline-safe. */
async function offline(page) {
  await page.route(url => !/^(localhost|127\.0\.0\.1)$/.test(url.hostname), r => r.abort());
}

/** Collect real errors; aborted third-party requests are expected noise. */
function watchErrors(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
  page.on('console', m => {
    if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  return errors;
}

async function open(page, route) {
  await page.goto(`/#/${route}`);
  await expect(page.locator('#view')).toBeVisible();
  await page.waitForTimeout(250);
}

/** Talk to the live store module (same instance the app uses). */
const counts = page => page.evaluate(async () => {
  const store = await import('/js/store.js');
  const by = {};
  for (const c of store.allCards()) by[c.tool] = (by[c.tool] || 0) + 1;
  return { total: store.allCards().length, by };
});
const cardByTitle = (page, title) => page.evaluate(async t => {
  const store = await import('/js/store.js');
  return store.allCards().find(c => c.title === t) || null;
}, title);

/** Drag with real pointer events (Sedi's dnd engine is pointer-based). */
async function drag(page, from, to, { hold = 0 } = {}) {
  const a = await from.boundingBox();
  const b = await to.boundingBox();
  const sx = a.x + a.width / 2, sy = a.y + a.height / 2;
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 12, sy + 12, { steps: 3 });
  await page.mouse.move(b.x + b.width / 2, b.y + Math.min(b.height / 2, 60), { steps: 12 });
  if (hold) await page.waitForTimeout(hold);
  await page.mouse.up();
  await page.waitForTimeout(150);
}

async function shot(page, name) {
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
}

async function loadFixture(page) {
  await page.locator('.menu-btn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import data/ }).click();
  await (await chooser).setFiles(FIXTURE);
  await page.getByRole('dialog', { name: 'Import data' }).getByRole('button', { name: 'Replace' }).click();
  await page.waitForTimeout(300);
}

async function timelyTab(page, label) {
  await page.locator('.timely-head').getByRole('tab', { name: label, exact: true }).click();
  await page.waitForTimeout(200);
}

const VIEWS = async (page, prefix) => {
  await open(page, 'home'); await shot(page, `${prefix}-home`);
  await open(page, 'taskly'); await shot(page, `${prefix}-taskly`);
  await open(page, 'boardly'); await shot(page, `${prefix}-boardly`);
  await open(page, 'timely');
  await timelyTab(page, 'Scheduling');
  for (const v of ['Daily', 'Weekly', 'Monthly', 'Reminders']) { await timelyTab(page, v); await shot(page, `${prefix}-timely-${v.toLowerCase()}`); }
  await timelyTab(page, 'Planning'); await timelyTab(page, 'Projects'); await shot(page, `${prefix}-timely-planning`);
  await timelyTab(page, 'Scheduling'); await timelyTab(page, 'Daily');
  await open(page, 'brainly'); await shot(page, `${prefix}-brainly`);
};

test.beforeEach(async ({ page }) => { await offline(page); });

// ---------- 1. First run boots cleanly; screenshot every main view ----------
test('first run: boots with no errors, every view renders', async ({ page }) => {
  const errors = watchErrors(page);
  await page.clock.setFixedTime(new Date('2026-10-12T10:30:00'));
  await open(page, 'home');
  await expect(page.locator('.clock-time')).toHaveText(/\d{1,2}:\d{2}/);
  await VIEWS(page, 'seed');
  // Timely Daily at narrower widths (SD-B1 squish check).
  for (const [w, hgt] of [[1024, 768], [390, 844]]) {
    await page.setViewportSize({ width: w, height: hgt });
    await open(page, 'timely'); await timelyTab(page, 'Daily');
    await shot(page, `seed-timely-daily-${w}`);
  }
  expect(errors).toEqual([]);
});

// ---------- 2. v1 fixture: old data must keep loading in every phase ----------
test('v1 fixture loads into a fresh profile and renders everywhere', async ({ page }) => {
  const errors = watchErrors(page);
  const fixture = JSON.parse(readFileSync(FIXTURE, 'utf8'));
  await page.clock.setFixedTime(new Date('2026-10-12T10:30:00'));
  await open(page, 'home');
  await loadFixture(page);
  const c = await counts(page);
  expect(c.total).toBe(fixture.cards.length);
  for (const tool of ['taskly', 'boardly', 'timely', 'brainly', 'universal']) {
    expect(c.by[tool], tool).toBe(fixture.cards.filter(x => x.tool === tool).length);
  }
  // Every fixture card that should be visible shows up in its tool.
  await open(page, 'taskly');
  for (const t of ['call the dentist', 'write report', 'review budget', 'paid rent', 'learn piano']) await expect(page.getByText(`Fixture: ${t}`)).toBeVisible();
  await open(page, 'boardly');
  await expect(page.getByText('Fixture: run a 10K')).toBeVisible();
  await open(page, 'timely'); await timelyTab(page, 'Scheduling'); await timelyTab(page, 'Daily');
  await expect(page.locator('.event-block', { hasText: 'Fixture: daily standup' })).toBeVisible();
  await timelyTab(page, 'Reminders');
  await expect(page.getByText('Fixture: water the plants')).toBeVisible();
  await timelyTab(page, 'Planning'); await timelyTab(page, 'Projects');
  await expect(page.getByText('Fixture: sketch milestone')).toBeVisible();
  await timelyTab(page, 'Scheduling'); await timelyTab(page, 'Daily');
  await open(page, 'brainly');
  await expect(page.locator('.b-note', { hasText: 'Fixture: welcome note' })).toBeVisible();
  // Link folders are squares; opening one shows its links in the glass folder view.
  await page.locator('.lf-tile').first().click();
  await expect(page.locator('.glass-item', { hasText: 'Fixture: MDN' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.glass-backdrop')).toHaveCount(0);
  // Platform-wide search (Brainly search bar) reaches every tool and the Universal Board.
  const search = page.getByRole('searchbox', { name: 'Search everything' });
  for (const [q, tool] of [['dentist', 'Taskly'], ['standup', 'Timely'], ['10K', 'Boardly'], ['in transit', 'Universal Board']]) {
    await search.fill(q);
    await expect(page.locator('.search-results .result', { hasText: tool }).first(), `search "${q}"`).toBeVisible();
  }
  // Brainly's own matches filter in place (SD-S1): the folder holding the pancake note stays, the rest hides.
  await search.fill('pancake');
  await expect(page.locator('.b-folder', { hasText: 'Recipes' })).toBeVisible();
  await expect(page.locator('.b-note', { hasText: 'Fixture: welcome note' })).toHaveCount(0);
  await expect(page.locator('.search-results .result-note')).toContainText('1 match in Brainly');
  await search.fill('');
  await expect(page.locator('.b-note', { hasText: 'Fixture: welcome note' })).toBeVisible();
  await VIEWS(page, 'fixture');
  // Survives a reload.
  await page.reload();
  expect((await counts(page)).total).toBe(fixture.cards.length);
  expect(errors).toEqual([]);
});

// ---------- 3. Card lifecycle across tools ----------
test('create, edit, drag between tools via the Universal Board, delete with Undo, persist', async ({ page }) => {
  const errors = watchErrors(page);
  await open(page, 'taskly');

  // Create in Taskly
  await page.getByRole('button', { name: 'Add a task to To do' }).click();
  await page.locator('.task-input').fill('Smoke task');
  await page.locator('.task-input').press('Enter');
  await expect(page.locator('.task-card', { hasText: 'Smoke task' })).toBeVisible();

  // Edit it
  await page.locator('.task-card', { hasText: 'Smoke task' }).dblclick();
  const dlg = page.getByRole('dialog', { name: 'Edit task' });
  await dlg.locator('.title-input').fill('Smoke task edited');
  await dlg.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('.task-card', { hasText: 'Smoke task edited' })).toBeVisible();
  await expect(page.locator('.modal-backdrop')).toHaveCount(0);

  // Drag between columns
  await drag(page, page.locator('.task-card', { hasText: 'Smoke task edited' }), page.locator('.taskly-col[data-col="review"] .col-body'));
  expect((await cardByTitle(page, 'Smoke task edited')).meta.columnId).toBe('review');

  // Create in Boardly
  await open(page, 'boardly');
  await page.getByRole('button', { name: /New Task/ }).click();
  await expect(page.locator('.tile .editing')).toBeFocused();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Smoke board task');
  await page.keyboard.press('Enter');
  await expect(page.locator('.tile', { hasText: 'Smoke board task' })).toBeVisible();

  // Create in Timely (reminder)
  await open(page, 'timely'); await timelyTab(page, 'Scheduling'); await timelyTab(page, 'Reminders');
  await page.getByPlaceholder('Remind me to…').fill('Smoke reminder');
  await page.getByPlaceholder('Remind me to…').press('Enter');
  await expect(page.locator('.sticky', { hasText: 'Smoke reminder' })).toBeVisible();

  // Create in Brainly
  await open(page, 'brainly');
  await page.locator('.brain-actions').getByRole('button', { name: 'Note' }).click();
  await page.locator('.note-modal .title-input').fill('Smoke note');
  await page.locator('.note-modal .rich-editor').click();
  await page.keyboard.type('Body of the smoke note');
  await page.locator('.note-modal').getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.b-note', { hasText: 'Smoke note' })).toBeVisible();

  // Taskly → Universal Board → Brainly
  await open(page, 'taskly');
  await page.locator('.universal-trigger').click();
  await drag(page, page.locator('.task-card', { hasText: 'Smoke task edited' }), page.locator('.uni-list'));
  expect((await cardByTitle(page, 'Smoke task edited')).tool).toBe('universal');
  await open(page, 'brainly');
  await expect(page.locator('.universal')).toHaveClass(/open/);
  await drag(page, page.locator('.uni-card', { hasText: 'Smoke task edited' }), page.locator('.brain-canvas'));
  const moved = await cardByTitle(page, 'Smoke task edited');
  expect(moved.tool).toBe('brainly');
  expect(moved.type).toBe('note');

  // Delete with Undo
  await page.locator('.universal-trigger').click();
  await drag(page, page.locator('.b-note', { hasText: 'Smoke note' }), page.locator('.trash'));
  await expect(page.locator('.toast', { hasText: 'Deleted' })).toBeVisible();
  expect(await cardByTitle(page, 'Smoke note')).toBeNull();
  await page.locator('.toast-action', { hasText: 'Undo' }).click();
  await expect(page.locator('.b-note', { hasText: 'Smoke note' })).toBeVisible();

  // Persist across reload
  await page.reload();
  await page.waitForTimeout(300);
  for (const t of ['Smoke task edited', 'Smoke board task', 'Smoke reminder', 'Smoke note']) {
    expect(await cardByTitle(page, t), t).not.toBeNull();
  }
  expect(errors).toEqual([]);
});

// ---------- 4. Export → clear → import round trip ----------
test('export, clear storage, import: counts match', async ({ page }) => {
  await open(page, 'home');
  await loadFixture(page);
  await page.evaluate(async () => { const s = await import('/js/store.js'); s.setPref('smokePref', 42); });
  const before = await counts(page);

  await page.locator('.menu-btn').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /Download data/ }).click();
  const file = path.join(test.info().outputDir, 'export.json');
  await (await dl).saveAs(file);
  const exported = JSON.parse(readFileSync(file, 'utf8'));
  expect(exported.cards.length).toBe(before.total);

  await page.locator('.menu-btn').click();
  await page.getByRole('button', { name: /Clear storage/ }).click();
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByPlaceholder('Type ERASE to confirm').fill('ERASE');
  await Promise.all([page.waitForEvent('load'), page.getByRole('button', { name: 'Erase everything', exact: true }).click()]);
  await page.waitForTimeout(400);
  expect((await counts(page)).total).not.toBe(before.total); // fresh (re-seeded) profile

  await page.locator('.menu-btn').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /Import data/ }).click();
  await (await chooser).setFiles(file);
  await page.getByRole('dialog', { name: 'Import data' }).getByRole('button', { name: 'Replace' }).click();
  await page.waitForTimeout(300);
  const after = await counts(page);
  expect(after).toEqual(before);
  expect(await page.evaluate(async () => (await import('/js/store.js')).pref('smokePref'))).toBe(42);
  const recs = await page.evaluate(async () => { const s = await import('/js/store.js'); return Object.keys(s.exportAll().records).sort(); });
  expect(recs).toEqual(Object.keys(exported.records).sort());
});

// ---------- 5. Assistant: chat, voice, commands ----------
test.describe('assistant', () => {
  test.beforeEach(async ({ page }) => {
    // Fake speech in and out so voice paths run headless. Transcripts are taken from window.__heard.
    await page.addInitScript(() => {
      window.__heard = [];
      window.__spoken = [];
      class FakeSR {
        start() {
          setTimeout(() => {
            const t = window.__heard.shift();
            if (t) this.onresult?.({ resultIndex: 0, results: [Object.assign([{ transcript: t }], { isFinal: true })] });
            this.onend?.();
          }, 60);
        }
        stop() {}
      }
      window.SpeechRecognition = FakeSR;
      window.webkitSpeechRecognition = FakeSR;
      if (window.speechSynthesis) {
        speechSynthesis.speak = u => { window.__spoken.push(u.text); setTimeout(() => u.onend?.(), 20); };
        speechSynthesis.cancel = () => {};
      }
    });
  });

  test('⌘K opens chat and answers', async ({ page }) => {
    await open(page, 'home');
    await loadFixture(page);
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.locator('.assistant-tray')).toBeVisible();
    await page.locator('.as-input').fill('summary');
    await page.locator('.as-input').press('Enter');
    await expect(page.locator('.as-msg.bot').last()).toContainText('Taskly');
    await page.locator('.as-input').fill('dentist');
    await page.locator('.as-input').press('Enter');
    await expect(page.locator('.as-msg.bot').last()).toContainText('Fixture: call the dentist');
    await shot(page, 'assistant-chat');
  });

  test('text commands: create, move, delete across tools with confirmation and logging', async ({ page }) => {
    await open(page, 'home');
    await loadFixture(page);
    await page.keyboard.press('ControlOrMeta+k');
    const say = async text => {
      await page.locator('.as-input').fill(text);
      await page.locator('.as-input').press('Enter');
      const box = page.locator('.as-msg.bot').last();
      await expect(box.locator('.as-confirm')).toBeVisible();
      await box.getByRole('button', { name: /Confirm|Do all/ }).click();
      await expect(box).toContainText('Done');
    };
    await say('add smoke milk to my to do list');
    expect((await cardByTitle(page, 'Smoke milk')).tool).toBe('taskly');
    await say('move smoke milk to boardly');
    expect((await cardByTitle(page, 'Smoke milk')).tool).toBe('boardly');
    await say('move smoke milk to timely');
    expect((await cardByTitle(page, 'Smoke milk')).tool).toBe('timely');
    await say('move smoke milk to brainly');
    expect((await cardByTitle(page, 'Smoke milk')).tool).toBe('brainly');
    await say('delete smoke milk');
    expect(await cardByTitle(page, 'Smoke milk')).toBeNull();
    const log = await page.evaluate(async () => (await import('/js/store.js')).get('commandLog', []));
    expect(log.filter(e => /smoke milk/i.test(e.text)).length).toBe(5);
  });

  test('misheard voice commands still land in the right place', async ({ page }) => {
    await open(page, 'home');
    const out = await page.evaluate(async () => {
      const { parseCommands } = await import('/js/commands.js');
      const ctx = { cards: [], tabs: [{ id: 't1', name: 'Work' }], plan: { projects: [], goals: [] }, now: new Date() };
      return ['make a note in Boardly called review Sedi', 'Make a note in Bordly called, review SETI.', 'make a note in bored lee called review seti', 'add a task to taskly called call the dentist']
        .map(t => parseCommands(t, ctx)[0]).map(c => `${c.tool}:${c.type}:${c.title}`);
    });
    expect(out).toEqual(['boardly:note:Review Sedi', 'boardly:note:Review Sedi', 'boardly:note:Review Sedi', 'taskly:task:Call the dentist']);
  });

  test('voice chat answers out loud; voice command confirms by voice', async ({ page }) => {
    await open(page, 'home');
    await loadFixture(page);
    // These tests stand in for the browser's ears (the private model can't download here).
    await page.evaluate(async () => (await import('/js/store.js')).setPref('hearing', 'browser'));
    // Voice first: tapping the atom opens the assistant already listening.
    await page.evaluate(() => window.__heard.push('summary'));
    await page.locator('.assistant-token').click();
    await expect(page.locator('.assistant-tray')).toHaveAttribute('data-view', 'voice');
    await expect(page.locator('.as-msg.bot').last()).toContainText('Taskly');
    await expect.poll(() => page.evaluate(() => window.__spoken.length)).toBeGreaterThan(0);
    // After answering it listens again; hearing nothing, it goes quiet.
    await expect(page.locator('.assistant-tray')).toHaveAttribute('data-state', 'idle');
    // Voice command: speak it, hear the confirmation, answer "yes" by voice.
    await page.evaluate(() => window.__heard.push('remind me to smoke stretch tomorrow at 9am', 'yes'));
    await page.locator('.as-orb').click();
    await expect.poll(() => page.evaluate(() => window.__spoken.join(' | '))).toMatch(/Should I go ahead.*Done/);
    const card = await cardByTitle(page, 'Smoke stretch');
    expect(card?.meta?.kind).toBe('reminder');
    // Typing is one tap away.
    await page.getByRole('button', { name: 'Type instead' }).click();
    await expect(page.locator('.as-input')).toBeFocused();
    // Clearing the conversation forgets what was said, including the command history.
    await page.getByRole('button', { name: 'More' }).click();
    await page.locator('.as-menu-item', { hasText: 'Clear conversation' }).click();
    expect(await page.evaluate(async () => (await import('/js/store.js')).get('commandLog', []).length)).toBe(0);
    await expect(page.locator('.as-msg')).toHaveCount(0);
  });
});
