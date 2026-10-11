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

## In-app help (Navoro)

Sedi ships with [Navoro](https://github.com/nweinberg97/Navoro) installed: a **Help** button in the header (next to the menu) that answers "how do I…?" from `docs/help-center.md` and points at the actual control, step by step. It is read-only — it never changes anything in Sedi for you.

- **Locally:** run Navoro (`node start.mjs` from its download, or `npm run dev` from its repo) alongside `python3 -m http.server 8000`. Sedi is pre-registered in Navoro's demo workspace, so the launcher appears on `http://localhost:8000` with no setup. Sign in to the Navoro dashboard at `http://localhost:4400` (demo@navoro.dev / navoro-demo-2026) to edit the guidance, review what people ask, or import `http://localhost:8000/docs/help-center.md` as a documentation URL.
- **On the published site:** off until you host Navoro somewhere. Set `productionOrigin` in `js/navoro.js`, add `https://<your-username>.github.io` as a production origin in the Navoro dashboard, and publish a configuration.
- **Turn it off:** add `?navoro=off` to the URL, or remove the `js/navoro.js` script tag from `index.html`.

The controls Navoro can point at carry `data-navoro-id` attributes; the bold labels in `docs/help-center.md` match their accessible names. **What Navoro can and can't see.** It reads only the tagged controls (button and field *labels* like "Add to To do"), the route, the page title, and the fixed error toasts. It never reads anything you type, and every place your own content appears — Taskly columns, the Universal Board, Home lists, Boardly and Brainly canvases, Timely, search results, dialogs and the assistant — is marked `data-navoro-sensitive`, so the SDK skips it entirely. Headings are off for Sedi too, because Timely container names are yours. To check, open Help on localhost → **Inspect payload**. Navoro is served from its own origin, so Sedi stays fully offline-capable without it, and the Help button only appears when Navoro is actually reachable.

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
js/navoro.js        installs the Navoro in-app help SDK (optional)
docs/help-center.md Sedi's help center, the knowledge Navoro learns from
sw.js               offline cache
```

When you change app files, bump `VERSION` in `sw.js` so installed copies update.
