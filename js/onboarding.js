// Sedi — first run: default structures plus cards that teach the gestures by doing them.

import * as store from './store.js';
import { uuid, todayKey } from './util.js';
import { DEFAULT_TABS } from './boardly.js';
import { DEFAULT_CONTAINERS } from './timely.js';

export function seedIfEmpty() {
  if (!store.isEmpty()) {
    // Repair missing structures without touching cards.
    if (!store.get('boardlyTabs')?.length) store.set('boardlyTabs', DEFAULT_TABS, { silent: true });
    if (!store.get('planContainers')) store.set('planContainers', DEFAULT_CONTAINERS(), { silent: true });
    return false;
  }
  const tabs = DEFAULT_TABS;
  store.set('boardlyTabs', tabs, { silent: true });
  store.setPref('boardlyTab', tabs[0].id);
  const containers = DEFAULT_CONTAINERS();
  store.set('planContainers', containers, { silent: true });
  const ideas = { id: uuid(), name: 'Ideas', color: '#A796CB', x: 300, y: 40 };
  store.set('brainFolders', [ideas], { silent: true });
  const reading = { id: uuid(), name: 'Reading' };
  store.set('linkFolders', [reading], { silent: true });

  const c = (p, o = {}) => store.createCard(p, { silent: true, log: false, ...o });
  const now = new Date();
  const nextHour = Math.min(22, now.getHours() + 1) * 60;

  // The trail: every card teaches one move and points to the next one, so a new person walks the whole app
  // by doing it. The hints match the device: tap and hold on a phone, click and double-click on a computer.
  const touch = matchMedia('(hover: none)').matches;
  const T = (tap, click) => touch ? tap : click;

  // Taskly: the first card is the top task, so it's also what Home shows under Next up.
  c({ type: 'task', tool: 'taskly', title: '1 · Start here', description: 'Drag me to In progress. These cards are a short tour: each one teaches one move, then tells you where to go next. Next: 2, just below where I was.', meta: { columnId: 'todo', order: 0 } });
  c({ type: 'task', tool: 'taskly', title: T('2 · Tap me', '2 · Double-click me'), description: 'Change my title to one real thing you want to do today, then Save. Next: 3.', meta: { columnId: 'todo', order: 1 } });
  c({ type: 'task', tool: 'taskly', title: '3 · Tick my circle', description: T('Tap', 'Click') + ' the round check on my left. Done cards slide into Completed, with a little cheer. Next: 4.', meta: { columnId: 'todo', order: 2 } });
  c({ type: 'task', tool: 'taskly', title: '4 · Trash me', description: T('Hold and drag me: a bin appears at the bottom. Drop me in it to hear the crunch. Changed your mind? Hit Undo. Next: 5, in Backlog.', 'Drop me on the bin in the bottom-right corner to hear the crunch. Changed your mind? Hit Undo. Next: 5, in Backlog.'), meta: { columnId: 'todo', order: 3 } });
  c({ type: 'task', tool: 'taskly', title: '5 · Why so small?', description: 'Columns hold what fits on screen, on purpose. When one fills up, finish, move or drop something. Small lists get done. Next: open Boardly for 6.', meta: { columnId: 'backlog', order: 0 } });

  // Boardly: life by area, one tab each.
  c({ type: 'note', tool: 'boardly', title: '6 · Life by area', description: `The tabs up top are areas of your life: Health, Relationships, Work… ${T('Tap', 'Click')} the active tab's name to rename it. Drag me anywhere on the board. Next: open the 10K goal, 7.`, meta: { tabId: tabs[0].id, x: 276, y: 32 } });
  c({
    type: 'goal', tool: 'boardly', title: '7 · Run a 10K', description: 'Open me to see a SMART goal: specific, measurable, achievable, relevant, time-bound. Next: 8, the shoes.', meta: {
      tabId: tabs[0].id, x: 32, y: 32,
      smart: { specific: 'Run a 10K race without walking', measurable: 'Finish a timed 10K', achievable: 'Three runs a week, building 10% weekly', relevant: 'More energy and better sleep', timebound: 'By the end of May' },
    },
  });
  c({ type: 'task', tool: 'boardly', title: '8 · File me', description: 'Drag me onto the Chores tab: a card dropped on a tab files itself there. Next: open Timely for 9.', meta: { tabId: tabs[0].id, x: 32, y: 116 } });

  // Timely: the day, then the plan.
  c({ type: 'event', tool: 'timely', title: '9 · Move me', description: `This is your day. Drag me to a new time, or pull my bottom edge to make me longer. ${T('Tap', 'Click')} an empty hour to add a block. Your Taskly to-dos wait in Today's plan: drag one onto an hour to give it a time. Next: 10, pinned at the top.`, meta: { date: todayKey(), start: nextHour, dur: 30 } });
  c({ type: 'event', tool: 'timely', title: '10 · Add me to a calendar', description: T('Tap me, then choose Add to calendar. Next: Planning, up top, for 11.', 'Hover me and press the calendar button, or open Details and choose Add to calendar. Next: Planning, up top, for 11.'), meta: { kind: 'reminder', date: todayKey(), start: null } });
  c({ type: 'task', tool: 'timely', title: '11 · Move me along', description: 'Drag me to In motion. Planning holds projects and goals as lists that run left to right.'+' Move cards along as the work moves. Next: open Brainly for 12.', meta: { board: 'projects', containerId: containers.projects[0].id, order: 0 } });
  c({ type: 'goal', tool: 'timely', title: 'Sleep 7+ hours, 5 nights a week', meta: { board: 'goals', containerId: containers.goals[0].id, order: 0 } });

  // Brainly: notes, folders, links.
  c({ type: 'note', tool: 'brainly', title: '12 · Open me and talk', description: `<div>Open me: notes stay small until you do.</div><div>Inside, tap the <b>microphone</b> and say a sentence: it types for you.</div><div>Next: drag 13 onto the Ideas folder.</div>`, meta: { x: 32, y: 40, emoji: '💡' } });
  c({ type: 'note', tool: 'brainly', title: '13 · File me in Ideas', description: '<div>Drag me onto the Ideas folder.</div><div>Paste any web address into Paste a link to save it for later.</div><div>Next: the Universal Board, 14.</div>', meta: { x: 32, y: 180, emoji: '🗂️' } });
  const help = new URL('welcome/help.html', location.href).href;
  c({ type: 'link', tool: 'brainly', title: 'Sedi help and FAQ', description: help, meta: { url: help, host: location.host, linkFolderId: reading.id, order: 0 } });

  // Universal Board: the pocket that follows you everywhere.
  c({ type: 'note', tool: 'universal', title: '14 · Drag me into Brainly', description: T('This board follows you to every tool, like a pocket. Hold me, drag me onto Brainly in the bar at the bottom, and let go: I turn into a note. Next: 15.', 'This board follows you to every tool, like a pocket. Drag me onto Brainly in the tool buttons on the right: I turn into a note. Next: 15.'), meta: { order: 0 } });
  c({ type: 'note', tool: 'universal', title: '15 · Meet the atom', description: `The atom at the bottom is your assistant. ${T('Tap', 'Click')} it and type “add call mom to my to do”, or hold it and say it. It always asks before changing anything. Your cards live only in this browser, so download a backup from the menu now and then. That's the tour: delete us whenever you like.`, meta: { order: 1 } });

  store.set('onboarded', true, { silent: true });
  return true;
}
