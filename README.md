# Sedi

> 🚧 **Status: actively in development.** It works well overall, but visual polish and some features are still being refined — not yet a finished product.

A local-first workspace that runs entirely in your browser: tasks (Taskly), life goals (Boardly), time (Timely) and notes (Brainly), connected by one card system. No accounts, no server. Your data lives on your device.

## Run it

**Hosted (recommended, enables offline mode):** turn on GitHub Pages for this repo (Settings → Pages → Deploy from a branch → `main` / root). Open `https://<your-username>.github.io/sedi/` once while online; after that it works with no connection.

**Locally:** from this folder run `python3 -m http.server 8000` and open `http://localhost:8000`. Double-clicking `index.html` won't work: browsers block the modules and offline caching for files opened from disk.

## How it works

- **One card, everywhere.** Every task, goal, note, event and link shares one schema (`id, type, title, description, tool, createdAt, updatedAt, meta`). Drag a card onto the Universal Board (top-right circle) and it's flattened to plain text; drag it out in another tool and it becomes that tool's native type.
- **Drag to do things.** Reorder, move between tools, or drop on the trash (bottom right) to delete, with a crunch and an Undo.
- **Navigation.** The triangle on the right edge opens the tool switcher. While dragging, hover it to open, then hover a tool to jump there. The atom logo goes Home. Refreshing keeps you on the page you were on (`#/taskly`, `#/timely`…).
- **Constraints on purpose.** Taskly columns and the Universal Board don't scroll; when they fill up, finish, move or delete something. Boardly has at most 10 categories.
- **Timely looks forward.** Past one-off items move to an Archive for 30 days, then delete themselves. Export single items or a whole day as `.ics` for your calendar.
- **Apple Reminders.** “Send to Reminders” hands a card to an Apple Shortcut. Setup steps are in the menu → Apple Reminders.
- **Assistant (atom at the bottom, or ⌘K / Ctrl K).** Chat searches and summarizes your Sedi. Voice uses your browser's speech recognition and reads replies aloud with your system voice. Command turns “create task call the dentist in Taskly” or “move call the dentist to Boardly” into a change you confirm; every command is logged permanently.
- **Sovereign Brain (menu → Sovereign Brain).** An opt-in coach that runs a small language model in your browser (WebGPU, or CPU fallback) and answers from a built-in library of habit, focus and communication frameworks (`brain/master_library.json`). One-time download (about 500 MB Light, 1.2 GB Full), then fully offline. Nothing you type leaves your device.
- **Your data.** Menu → Download data saves everything as `.json`; Import data merges or replaces from a file; Clear storage erases this device after two confirmations.

## Privacy notes

- Card data is stored in IndexedDB; small UI settings in localStorage.
- Weather comes from Open-Meteo using your approximate location (rounded), cached for 30 minutes.
- In Chrome, voice dictation is processed by Google's speech service and needs a connection. Spoken replies use voices installed on your device.

## Files

```
index.html          app shell
styles.css          all styles
app.js              boot, routing, render loop
js/store.js         IndexedDB + localStorage persistence, export/import
js/cards.js         shared card schema, Universal Board flattening, editor
js/dnd.js           pointer-based drag engine
js/shell.js         header, menu, navigator, Universal Board, trash
js/home.js          clock, weather, Next up, Recent activity
js/taskly.js        kanban
js/boardly.js       category canvases, SMART goals
js/timely.js        day/week/month/reminders, archive, .ics, planning boards
js/brainly.js       search, links, notes, folders, dictation
js/assistant.js     chat / voice / command
js/brain.js         Sovereign Brain (retrieval + on-device model)
sw.js               offline cache
```

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
