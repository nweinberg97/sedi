# Sedi

**Everything in its place.** Sedi is a calm, focused place to think: your tasks, goals, calendar and notes in one workspace that runs in your browser. No account, no server, and your data stays on your device.

- **Open Sedi:** https://nweinberg97.github.io/sedi/
- **About Sedi:** https://nweinberg97.github.io/sedi/welcome/

The name comes from two roots: Hebrew *seder* (order, things arranged in their proper place) and Latin *sedēre* (to sit, to settle).

> Sedi is used every day and actively developed. The web app is free. Native Mac and iPhone apps, and sync between devices, are in development.

## What's inside

**Home.** A clock, the weather, and the three things that come next (the top task and today's events), on a morning-sky background. Recent activity is one tab away.

**Taskly.** Five columns: To do, In progress, Review, Completed and Backlog. Columns don't scroll; when one fills up, you finish, move or delete something. Review cards count down and come back to you, and Completed clears its oldest card to make room.

**Boardly.** Up to ten boards for parts of your life (Health, Relationships, Work, Chores…), each a white canvas patterned in its tag colour. Place goals, tasks and notes anywhere; goals open into a SMART template. Shift-click or drag a box to move several at once.

**Timely.** Scheduling and planning in one tool.
- Daily, Weekly and Monthly views, with dots for what's planned and a zoom into any day or week.
- Events, meetings, appointments, routines and focus blocks, plus trips and conferences that span several days.
- Repeats: daily, weekdays, weekly, monthly, or a custom rule (every N days or weeks, on chosen days, until a date).
- A Reminders board: write a note, pick "Tonight" or "Saturday", and pin it.
- Planning boards for projects and goals, plus a plan for each week and month.
- Past one-off items move to an Archive for 30 days, then delete themselves.

**Brainly.** Notes, links, PDFs and any file up to 25 MB.
- Notes are rounded cards on a free canvas, with folders. Type or dictate into any note, and open it as a Google Doc.
- My links: paste a link or upload a file. Link folders can hold folders, and open as a frosted panel. Drag to reorder, nest, or move things back out.
- Any link or file becomes a task in one click ("Read article from…", "Review…").
- One search across everything in Sedi.

**One card, everywhere.** Every task, goal, event, note and link uses the same card. Drag a card onto the **Universal Board** (top right) and it becomes plain text; drag it into another tool and it takes that tool's shape.

**Assistant** (the atom at the bottom, or ⌘K / Ctrl K). Talk to your notes: ask about anything you've saved by typing or speaking, and Sedi answers from your own cards. Command mode creates or moves cards after you confirm, and every change is logged. Voice mode answers out loud.

**AI engines** (Menu → AI engines). The default runs on your device. You can add Claude with your own Anthropic key, or any OpenAI-compatible service (OpenAI, OpenRouter, or a local model in Ollama). Keys stay on this device and are never exported. "Ask Claude" opens Claude.ai with your question ready.

**Sovereign Brain** (Menu → Sovereign Brain). An optional small language model that runs in your browser (WebGPU, or CPU fallback), with a built-in library of habit, focus and communication frameworks (`brain/master_library.json`). One download (about 500 MB Light, 1.2 GB Full), then fully offline.

## Works with your tools

Sedi doesn't replace your other apps; it sends things on to them.
- **Calendar:** add any event to Google Calendar, or export one event or a whole day as an `.ics` file.
- **Apple Reminders:** "Send to Reminders" hands a card to an Apple Shortcut (setup in Menu → Apple Reminders).
- **Google Docs and Drive:** open a note as a Google Doc; optionally connect Google to save PDFs to Drive (Sedi can only see files it created).

## Your data

- Cards and files live in your browser's IndexedDB; small settings in localStorage. Nothing is sent to a server.
- **Menu → Download data** saves everything, including uploaded files, as a `.json` file. **Import data** merges or replaces from a file. **Clear storage** erases this device after two confirmations.
- Weather comes from Open-Meteo using your approximate location, cached for 30 minutes.
- In Chrome, voice dictation uses Google's speech service and needs a connection. Spoken replies use voices installed on your device.

## Run it

**Hosted:** GitHub Pages serves `main` from the repo root. Open the link once while online; after that Sedi works with no connection.

**Locally:** run `python3 -m http.server 8000` in this folder and open `http://localhost:8000` (the landing page is at `/welcome/`). Opening `index.html` directly won't work: browsers block modules and offline caching for files opened from disk.

## Files

```
index.html          app shell
styles.css          all styles
app.js              boot, routing, render loop
sw.js               offline cache (bump VERSION when app files change)
js/store.js         IndexedDB + localStorage persistence, files, export/import
js/cards.js         shared card schema, Universal Board flattening, editor, Move to
js/dnd.js           pointer-based drag engine
js/shell.js         header, menu, navigator, Universal Board, trash
js/home.js          clock, weather, Next up, Recent activity
js/taskly.js        kanban
js/boardly.js       boards, SMART goals
js/timely.js        day/week/month, reminders, planning, archive, calendar export
js/brainly.js       notes, links, files, folders, search
js/assistant.js     chat / voice / command
js/commands.js      command parsing and the change log
js/engines.js       AI engines (on-device, Claude, OpenAI-compatible)
js/brain.js         Sovereign Brain (retrieval + on-device model)
js/google.js        optional Google Docs / Drive connection
js/speech.js        dictation and spoken replies
welcome/            the landing page (served at /welcome/)
tests/              Playwright smoke tests (not served)
```

## Tests

From `tests/`: `npm install`, then `npx playwright test`. The suite starts a local server, loads a saved v1 data file to prove old data still opens, and covers creating, editing, dragging, deleting with Undo, reload persistence, export and import, and the assistant.
