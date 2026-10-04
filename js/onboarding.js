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

  // Taskly
  c({ type: 'task', tool: 'taskly', title: 'Drag me to the trash, bottom right', description: 'Drop me on the bin in the bottom-right corner to hear the crunch. Changed your mind? Hit Undo.', meta: { columnId: 'todo', order: 0 } });
  c({ type: 'task', tool: 'taskly', title: 'Double-click me to edit', description: 'Double-click any task to edit its title, details and column.', meta: { columnId: 'todo', order: 1 } });
  c({ type: 'task', tool: 'taskly', title: 'Drag me between columns', meta: { columnId: 'inprogress', order: 0 } });
  c({ type: 'task', tool: 'taskly', title: 'Columns never scroll, on purpose', description: 'When a column fills up, finish, move or delete something. Space is the constraint that keeps you focused.', meta: { columnId: 'backlog', order: 0 } });

  // Boardly
  c({
    type: 'goal', tool: 'boardly', title: 'Run a 10K this spring', meta: {
      tabId: tabs[0].id, x: 32, y: 32,
      smart: { specific: 'Run a 10K race without walking', measurable: 'Finish a timed 10K', achievable: 'Three runs a week, building 10% weekly', relevant: 'More energy and better sleep', timebound: 'By the end of May' },
    },
  });
  c({ type: 'task', tool: 'boardly', title: 'Buy running shoes', meta: { tabId: tabs[0].id, x: 32, y: 116 } });
  c({ type: 'note', tool: 'boardly', title: 'Open me with the corner icon', description: 'Notes grow to 10 lines while you write.\nClick anywhere else and I shrink back.', meta: { tabId: tabs[0].id, x: 276, y: 32 } });

  // Timely
  c({ type: 'event', tool: 'timely', title: 'Plan tomorrow', description: 'Ten minutes to pick tomorrow’s top three.', meta: { date: todayKey(), start: nextHour, dur: 30 } });
  c({ type: 'event', tool: 'timely', title: 'Try exporting me as .ics', description: 'Open my details and choose Export .ics to add me to your calendar.', meta: { kind: 'reminder', date: todayKey(), start: null } });
  c({ type: 'task', tool: 'timely', title: 'Sketch the first milestone', meta: { board: 'projects', containerId: containers.projects[0].id, order: 0 } });
  c({ type: 'goal', tool: 'timely', title: 'Sleep 7+ hours, 5 nights a week', meta: { board: 'goals', containerId: containers.goals[0].id, order: 0 } });

  // Brainly
  c({ type: 'note', tool: 'brainly', title: 'Welcome to Brainly', description: '<div>Notes stay compact until you open them.</div><div>Tap the <b>microphone</b> in a note to dictate.</div><div>Drag a note onto a folder to file it.</div>', meta: { x: 32, y: 40, emoji: '💡' } });
  c({ type: 'note', tool: 'brainly', title: 'Ideas to explore', description: '', meta: { folderId: ideas.id, emoji: '💡' } });
  c({ type: 'link', tool: 'brainly', title: 'Web Speech API', description: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API', meta: { url: 'https://developer.mozilla.org/en-US/docs/Web/API/Web_Speech_API', host: 'developer.mozilla.org', linkFolderId: reading.id, order: 0 } });

  // Universal Board
  c({ type: 'note', tool: 'universal', title: 'Drag me into Brainly', description: 'Open Brainly with the triangle on the right, then drag me out of this board onto the canvas. I’ll turn into a note.', meta: { order: 0 } });

  store.set('onboarded', true, { silent: true });
  return true;
}
