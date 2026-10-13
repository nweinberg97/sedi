# Sedi smoke tests

Playwright tests that prove the core loop still works and that old data still loads. Nothing in this folder is part of the app.

## Run

```sh
cd tests
npm install
npx playwright install chromium   # first time only
npx playwright test
```

The config starts `python3 -m http.server` on port 8123 from the repo root. Set `SEDI_SHOTS=<name>` to save screenshots into `tests/screenshots/<name>/` (default `current`), so phases can be compared side by side.

## What it covers

- **First run**: boots with no console errors; screenshots Home, Taskly, Boardly, Timely (Daily, Weekly, Monthly, Reminders, Planning) and Brainly, plus Timely Daily at 1024 and 390 px wide.
- **v1 fixture** (`fixtures/v1-export.json`): imported into a fresh profile through Menu → Import data → Replace. Checks card counts per tool, that every card type renders, platform-wide search, and that it survives a reload. Every phase must keep this passing.
- **Card lifecycle**: create in each tool, edit, drag between Taskly columns, Taskly → Universal Board → Brainly, delete via the trash with Undo, reload and confirm it all persisted.
- **Export / clear / import**: Download data, Clear storage (both confirmations), Import data, and confirm cards, records and prefs match.
- **Assistant**: ⌘K opens chat; text commands create, move and delete across all four tools with confirmation and logging; voice chat and voice commands run against a fake speech engine (headless browsers have no microphone), including answering "yes" by voice.
