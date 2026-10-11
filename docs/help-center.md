# Sedi Help Center

Sedi is a local-first workspace that runs entirely in your browser: tasks (Taskly), life goals (Boardly), time (Timely) and notes (Brainly), connected by one card system. Nothing you add leaves your device.

## Feature: Cards

Every task, goal, note, event and link is a card with the same shape: a title, an optional description and the tool it lives in. Drag a card between tools and it becomes that tool's native type. Double-click a card to edit it.

## Feature: Universal Board

The Universal Board is a holding area for cards in transit. Open it from the circle in the top right, drop cards in, switch tools, then drag them out. It does not scroll: when it is full, route or clear a card first.

## Feature: Tool switcher

The triangle on the right edge opens the tool switcher with Taskly, Boardly, Home, Timely and Brainly. While dragging a card, hover the triangle to open it and hover a tool to jump there.

## How to create a task

Prerequisites: None.

1. Click **Switch tool** on the right edge of the screen.
2. Choose **Taskly**.
3. Click **Add to To do** at the top of the To do column.
4. Type the task into **New task title** and press Enter.

## How to capture something to the Universal Board

1. Click **Universal Board** in the top right.
2. Type into **Add to Universal Board** and press Enter.
3. Switch to another tool and drag the card out to make it a task, goal, note or event.

## How to add a reminder

Prerequisites: Reminders are for today or later.

1. Click **Switch tool** on the right edge.
2. Choose **Timely**.
3. Click the **Reminders** tab.
4. Type what to remember into **New reminder**.
5. Pick a **Due date** and an optional **Due time**, then press Enter.

## How to add a goal category in Boardly

Prerequisites: Boardly has at most 10 categories.

1. Click **Switch tool** on the right edge.
2. Choose **Boardly**.
3. Click **Add category** at the end of the category tabs and name it.

## How to save a link in Brainly

1. Click **Switch tool** on the right edge.
2. Choose **Brainly**.
3. Paste the URL into **Paste a link** in the My links panel and press Enter.

## How to search everything in Sedi

1. Click **Switch tool** on the right edge.
2. Choose **Brainly**.
3. Type into **Search everything**. Results include tasks, goals, notes, events and links.

## How to download your data

1. Click **Open menu** in the top right.
2. Click **Download data**. Sedi saves everything as a .json file on your device.

## How to import data

Prerequisites: A .json file exported from Sedi.

1. Click **Open menu** in the top right.
2. Click **Import data** and choose the file.
3. Choose Merge to keep your current cards, or Replace to swap everything for the file's contents.

## How to talk to the assistant

1. Click **Open assistant (⌘K)** at the bottom of the screen, or press ⌘K / Ctrl K.
2. Type a question or a command into **Message the assistant**, for example "create task call the dentist in Taskly".
3. Click **Send**. Commands show a change for you to confirm; every command is logged.

## How to delete a card

1. Drag the card onto the **Trash** bin in the bottom right.
2. Click Undo in the toast if you change your mind.

## Troubleshooting: This column is full. Finish, move or delete a card first. (TASKLY_COLUMN_FULL)

Taskly columns never scroll; the number of cards that fit depends on your window height, shown as a count in the column header.

Resolution: Finish or delete a card, drag one to another column, or park it on the **Universal Board** to make room.

## Troubleshooting: The board is full. Route or clear a card first. (UNIVERSAL_FULL)

The Universal Board holds only as many cards as fit on screen.

Resolution: Open **Universal Board** and drag cards out into a tool, or drop them on the **Trash** bin.

## Troubleshooting: That file isn't a Sedi export. (IMPORT_NOT_SEDI)

Import only accepts .json files created by Sedi's Download data.

Resolution: Click **Open menu**, then **Download data** on the device that has your cards, and import that file.

## Glossary

- **Taskly** — The kanban with five fixed columns: To do, In progress, Review, Completed and Backlog.
- **Boardly** — Category canvases for life goals, with SMART goal details.
- **Timely** — Daily, weekly and monthly views, reminders, an archive, and planning boards.
- **Brainly** — Search, links, notes and folders, with dictation.
- **Universal Board** — The in-transit area for moving cards between tools.
- **Sovereign Brain** — An opt-in coach that runs a small language model in your browser and never sends what you type anywhere.
