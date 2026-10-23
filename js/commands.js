// Sedi — natural-language commands. Pure functions (no DOM) so they can be tested in isolation.
// parseCommands(text, ctx) → array of commands; ctx = { cards, tabs, columns, now }.

const COLUMN_WORDS = {
  'to do': 'todo', todo: 'todo', 'to-do': 'todo', 'in progress': 'inprogress', doing: 'inprogress',
  review: 'review', completed: 'completed', complete: 'completed', done: 'completed', backlog: 'backlog', later: 'backlog',
};
const TOOL_WORDS = {
  taskly: 'taskly', 'task list': 'taskly', tasks: 'taskly', 'to do list': 'taskly', 'todo list': 'taskly',
  boardly: 'boardly', board: 'boardly', 'vision board': 'boardly',
  timely: 'timely', calendar: 'timely', schedule: 'timely', planner: 'timely',
  brainly: 'brainly', notes: 'brainly', 'my notes': 'brainly',
  'universal board': 'universal', universal: 'universal', inbox: 'universal',
  home: 'home',
};
const TYPE_WORDS = {
  card: 'card', item: 'card', task: 'task', 'to do': 'task', todo: 'task', 'to-do': 'task', note: 'note', idea: 'note',
  goal: 'goal', event: 'event', meeting: 'event', appointment: 'event', block: 'event', 'time block': 'event',
  reminder: 'reminder', link: 'link',
};
// A bare "add buy milk" is a task for To do; say "to the universal board" or "to my inbox" to capture it there instead.
const DEFAULT_TOOL = { task: 'taskly', note: 'brainly', goal: 'boardly', event: 'timely', reminder: 'timely', link: 'brainly', card: 'taskly' };
const NATIVE_TYPE = { taskly: 'task', timely: 'event', brainly: 'note', universal: 'note' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1 };
const SLOT_WORDS = { morning: 'morning', 'this morning': 'morning', noon: 'noon', lunch: 'noon', lunchtime: 'noon', afternoon: 'afternoon', 'this afternoon': 'afternoon', evening: 'evening', 'this evening': 'evening', night: 'night', tonight: 'evening' };

const CREATE_VERBS = 'block out|block off|block|set aside|reserve|create|add|make|new|put|write down|write|jot down|jot|capture|note down|log|save|set up|set|schedule|book|plan';
const MOVE_VERBS = 'move|send|shift|bump|push|reschedule|drag|put';
const CMD_START = new RegExp(`^(?:${CREATE_VERBS}|${MOVE_VERBS}|remind me|delete|remove|trash|get rid of|throw away|complete|finish|finished|check off|tick off|mark|rename|open|go to|go|show me|switch to|take me to|i finished|i did|i completed)\\b`, 'i');

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Speech recognisers rarely know Sedi's own words. Put back the ones they commonly mishear. */
export function fixVocabulary(raw) {
  return String(raw || '')
    .replace(/\bbo(?:a|u|o)?re?d[\s-]?(?:ly|lee|ley|li|lie|ie|y)\b/gi, 'Boardly')
    .replace(/\bbrain[\s-]?(?:ly|lee|ley|li|lie|ie)\b/gi, 'Brainly')
    .replace(/\btask[\s-]?(?:ly|lee|ley|li|lie|ie)\b/gi, 'Taskly')
    .replace(/\btime[\s-](?:lee|ley|li|lie)\b/gi, 'Timely')
    .replace(/\b(?:sedi|seti|setti|setty|sedie|sedy|seddy|sedee|cedi|ceddy)\b/gi, 'Sedi')
    .replace(/\b(called|named|titled|saying)\s*[,:;–—-]\s*/gi, '$1 ');
}

/**
 * Speech comes out the way people talk: fillers, "nine a m", "seven in the morning", "twelve thirty".
 * Rewrite it the way people type, so spoken commands are understood as well as typed ones.
 * Number words only become times next to "at" or a part of the day, so "call two people" stays as is.
 */
const HOUR_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const UNIT_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
function minuteWords(w) {
  const t = w.toLowerCase().replace(/-/g, ' ').trim();
  if (/^oh /.test(t)) return UNIT_WORDS[t.slice(3)] || 0;
  const [tens, unit] = t.split(/\s+/);
  const base = { ten: 10, fifteen: 15, twenty: 20, thirty: 30, forty: 40, fifty: 50 }[tens] || 0;
  return base + (unit ? UNIT_WORDS[unit] || 0 : 0);
}
export function spokenToTyped(raw) {
  const H = Object.keys(HOUR_WORDS).join('|');
  const M = `oh (?:${Object.keys(UNIT_WORDS).join('|')})|fifteen|(?:twenty|thirty|forty|fifty)(?:[ -](?:${Object.keys(UNIT_WORDS).join('|')}))?|ten|o'?clock`;
  const PART = `a\\.?\\s?m\\.?|p\\.?\\s?m\\.?|in the morning|in the afternoon|in the evening|at night|tonight`;
  return String(raw || '')
    .replace(/\b(?:u+m+|u+h+|e+r+m*|h+m+)\b[,.]?\s*/gi, '')
    .replace(/\b(?:you know|i mean)\b,?\s*/gi, '')
    .replace(/^\s*(?:(?:okay|ok|alright|all right|so|well|right|yeah|and)[,.]?\s+)+/i, '')
    .replace(/\b(\d{1,2}(?::\d{2})?)\s*([ap])\.?\s?m\b\.?/gi, '$1$2m')
    .replace(new RegExp(`\\b(at\\s+)?(${H})(?:\\s+(${M}))?(?:\\s+(${PART}))?(?![a-z])`, 'gi'), (all, at, hw, mw, part) => {
      if (!at && !part) return all;
      const min = mw && !/clock/i.test(mw) ? minuteWords(mw) : 0;
      const ampm = !part ? '' : /^a|morning/i.test(part) ? 'am' : 'pm';
      return `${at || ''}${HOUR_WORDS[hw.toLowerCase()]}${min ? `:${String(min).padStart(2, '0')}` : ''}${ampm}${/tonight/i.test(part || '') ? ' tonight' : ''}`;
    })
    .replace(/\bat\s+(\d{1,2}(?::\d{2})?)\s+(in the morning)\b/gi, 'at $1am')
    .replace(/\bat\s+(\d{1,2}(?::\d{2})?)\s+(in the (?:afternoon|evening)|at night)\b/gi, 'at $1pm')
    .replace(/\bto[\s-]?do list\b/gi, 'to do');
}

/** Strip politeness and assistant-addressing so "hey sedi, could you please add milk" → "add milk". */
export function normalize(raw) {
  return fixVocabulary(spokenToTyped(raw))
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .trim()
    .replace(/^(?:hey|hi|ok|okay)?\s*(?:sedi|cd)[,:]?\s+/i, '')
    .replace(/^(?:can you|could you|would you|will you|please|i want you to|i'd like you to|i need you to|i want to|i need to|let's|lets)\s+/i, '')
    .replace(/^(?:please)\s+/i, '')
    .replace(/[\s,]*(?:please|for me|thanks|thank you)[.!?]*$/i, '')
    .replace(/[.!?]+$/, '')
    .trim();
}

/** Split a spoken or typed list into separate commands without breaking titles like "bread and milk". */
export function splitCommands(text) {
  const verbs = `(?:${CREATE_VERBS}|${MOVE_VERBS}|remind|delete|remove|complete|finish|mark|rename|open|trash)`;
  return String(text || '')
    .split(new RegExp(`\\s*(?:\\n+|;|\\.\\s+(?=[a-z])|,?\\s+and then\\s+|,?\\s+then\\s+(?=${verbs}\\b)|,?\\s+and\\s+(?=${verbs}\\b)|,\\s+(?=${verbs}\\b))\\s*`, 'i'))
    .map(s => s.trim()).filter(Boolean);
}

// ---------- Dates and times ----------
function parseTime(s) {
  let m;
  if ((m = /\b(?:at\s+)?(noon|midday)\b/i.exec(s))) return { start: 12 * 60, match: m[0] };
  if ((m = /\b(?:at\s+)?midnight\b/i.exec(s))) return { start: 0, match: m[0] };
  if ((m = /\b(?:at\s+|@\s*)?(\d{1,2})(?:[:.](\d{2}))?\s*(a\.?\s?m\.?|p\.?\s?m\.?)(?![a-z])/i.exec(s))) {
    let h = +m[1] % 12; const min = +(m[2] || 0);
    if (/p/i.test(m[3])) h += 12;
    if (h < 24 && min < 60) return { start: h * 60 + min, match: m[0] };
  }
  if ((m = /\b(?:at\s+)?(\d{1,2}):(\d{2})\b/i.exec(s))) {
    const h = +m[1], min = +m[2];
    if (h < 24 && min < 60) return { start: (h < 7 && h !== 0 ? h + 12 : h) * 60 + min, match: m[0] };
  }
  if ((m = new RegExp(`\\bat\\s+(\\d{1,2}|${Object.keys(NUM_WORDS).filter(w => w.length > 2).join('|')})(?:\\s+o'?clock)?\\b(?!\\s*(?:days?|weeks?|minutes?|hours?))`, 'i').exec(s))) {
    let h = /\d/.test(m[1]) ? +m[1] : NUM_WORDS[m[1].toLowerCase()];
    if (h >= 1 && h <= 23) { if (h < 7) h += 12; return { start: h * 60, match: m[0] }; }
  }
  return null;
}

function parseDate(s, now) {
  let m;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if ((m = /\b(?:on\s+)?(?:the\s+)?day after tomorrow\b/i.exec(s))) return { date: key(addDays(today, 2)), match: m[0] };
  if ((m = /\b(?:for\s+|on\s+)?tomorrow(?:\s+(morning|afternoon|evening|night))?\b/i.exec(s))) return { date: key(addDays(today, 1)), slot: m[1] && SLOT_WORDS[m[1].toLowerCase()], match: m[0] };
  if ((m = /\b(?:for\s+)?tonight\b/i.exec(s))) return { date: key(today), slot: 'evening', match: m[0] };
  if ((m = /\b(?:for\s+|on\s+)?today\b/i.exec(s))) return { date: key(today), match: m[0] };
  if ((m = /\bthis\s+(morning|afternoon|evening)\b/i.exec(s))) return { date: key(today), slot: SLOT_WORDS[m[1].toLowerCase()], match: m[0] };
  if ((m = new RegExp(`\\bin\\s+(\\d+|${Object.keys(NUM_WORDS).join('|')})\\s+(days?|weeks?)\\b`, 'i').exec(s))) {
    const n = /\d/.test(m[1]) ? +m[1] : NUM_WORDS[m[1].toLowerCase()];
    return { date: key(addDays(today, /week/i.test(m[2]) ? n * 7 : n)), match: m[0] };
  }
  if ((m = /\bnext week\b/i.exec(s))) return { date: key(addDays(today, ((8 - today.getDay()) % 7) || 7)), match: m[0] };
  if ((m = new RegExp(`\\b(?:on\\s+|for\\s+)?(?:(this|next)\\s+)?(${DAYS.join('|')})(?:\\s+(morning|afternoon|evening|night))?\\b`, 'i').exec(s))) {
    const target = DAYS.indexOf(m[2].toLowerCase());
    // "Friday" and "next Friday" both mean the coming one; naming today's weekday means a week out.
    const diff = (target - today.getDay() + 7) % 7 || 7;
    return { date: key(addDays(today, diff)), slot: m[3] && SLOT_WORDS[m[3].toLowerCase()], match: m[0] };
  }
  if ((m = new RegExp(`\\b(?:on\\s+|for\\s+)?(${MONTHS.join('|')})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i').exec(s))) {
    const mo = MONTHS.indexOf(m[1].toLowerCase().slice(0, 3));
    let d = new Date(today.getFullYear(), mo, +m[2]);
    if (d < today) d = new Date(today.getFullYear() + 1, mo, +m[2]);
    return { date: key(d), match: m[0] };
  }
  if ((m = new RegExp(`\\b(?:on\\s+)?(?:the\\s+)?(\\d{1,2})(?:st|nd|rd|th)\\s+(?:of\\s+)?(${MONTHS.join('|')})[a-z]*\\b`, 'i').exec(s))) {
    const mo = MONTHS.indexOf(m[2].toLowerCase().slice(0, 3));
    let d = new Date(today.getFullYear(), mo, +m[1]);
    if (d < today) d = new Date(today.getFullYear() + 1, mo, +m[1]);
    return { date: key(d), match: m[0] };
  }
  return null;
}

/** Pull date/time/part-of-day phrases out of text. Returns { when, rest }. */
export function extractWhen(text, now = new Date()) {
  let rest = text;
  const when = {};
  const d = parseDate(rest, now);
  if (d) { when.date = d.date; if (d.slot) when.slot = d.slot; rest = rest.replace(d.match, ' '); }
  const t = parseTime(rest);
  if (t) { when.start = t.start; delete when.slot; rest = rest.replace(t.match, ' '); }
  let m;
  if (when.start == null && (m = /\b(?:in the|this)\s+(morning|afternoon|evening)\b|\bat (night|noon|lunch(?:time)?)\b/i.exec(rest))) {
    const word = (m[1] || m[2]).toLowerCase();
    if (word === 'noon') when.start = 12 * 60; else when.slot = SLOT_WORDS[word] || word;
    rest = rest.replace(m[0], ' ');
  }
  if (when.start != null && !when.date) when.date = key(now);
  if (when.slot && !when.date) when.date = key(now);
  return { when: Object.keys(when).length ? when : null, rest: tidy(rest) };
}

const tidy = s => s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();

/** "for 2 hours", "90 minutes", "half an hour" → minutes. */
export function extractDur(text) {
  const n = w => (/\d/.test(w) ? parseFloat(w) : NUM_WORDS[w.toLowerCase()]);
  let m;
  if ((m = /\b(?:for\s+)?(?:a\s+)?half(?:\s+an)?\s+hour\b/i.exec(text))) return { dur: 30, rest: tidy(text.replace(m[0], ' ')) };
  if ((m = new RegExp(`\\b(?:for\\s+)?(\\d+(?:\\.\\d+)?|${Object.keys(NUM_WORDS).join('|')})\\s*(hours?|hrs?|h|minutes?|mins?|m)\\b`, 'i').exec(text))) {
    const v = n(m[1]);
    if (v) return { dur: Math.round(/^h/i.test(m[2]) ? v * 60 : v), rest: tidy(text.replace(m[0], ' ')) };
  }
  return { dur: null, rest: text };
}

// ---------- Destinations (tool, column, Boardly tab) ----------
function extractDest(text, ctx) {
  let rest = text;
  const dest = {};
  let m;
  // Timely plans: "to this week's plan", "on my weekly plan", "for the month plan"
  if ((m = /\b(?:to|on|onto|in|into|for)\s+(?:the\s+|my\s+)?(?:(?:this|next)\s+)?(week|weekly|month|monthly)(?:'?s)?\s+(?:plan|plans|list|goals)\b|\b(?:to|on|in|into|for)\s+(?:the\s+|my\s+)?plan\s+for\s+(?:this|the)\s+(week|month)\b/i.exec(rest))) {
    dest.tool = 'timely'; dest.plan = /week/i.test(m[1] || m[2]) ? 'weekplan' : 'monthplan';
    return { dest, rest: tidy(rest.replace(m[0], ' ')) };
  }
  // Timely projects and goals by name: "to the Garden project", "to project Garden", "under my Health goal"
  const plan = ctx.plan || {};
  for (const [board, word] of [['projects', 'project|list'], ['goals', 'goal']]) {
    const list = (plan[board] || []).filter(x => x.name);
    if (!list.length) continue;
    const names = list.map(x => esc(x.name)).sort((a, b) => b.length - a.length).join('|');
    const re = new RegExp(`\\b(?:to|in|into|on|onto|under|for)\\s+(?:the\\s+|my\\s+)?(?:(?:${word})\\s+(${names})|(${names})\\s+(?:${word}))\\b`, 'i');
    if ((m = re.exec(rest))) {
      const name = (m[1] || m[2]).toLowerCase();
      const ct = list.find(x => x.name.toLowerCase() === name);
      dest.tool = 'timely'; dest.board = board; dest.containerId = ct.id; dest.containerName = ct.name;
      return { dest, rest: tidy(rest.replace(m[0], ' ')) };
    }
  }
  // Boardly tabs right after the tool: "to boardly work", "on the board health"
  const tabsAll = ctx.tabs || [];
  if (tabsAll.length && (m = new RegExp(`\\b(?:in|to|into|on|onto|under)\\s+(?:the\\s+|my\\s+)?(?:boardly|board)\\s+(${tabsAll.map(t => esc(t.name)).join('|')})\\b`, 'i').exec(rest))) {
    const tab = tabsAll.find(t => t.name.toLowerCase() === m[1].toLowerCase());
    dest.tool = 'boardly'; dest.tabId = tab.id; dest.tabName = tab.name;
    return { dest, rest: tidy(rest.replace(m[0], ' ')) };
  }
  const toolRe = new RegExp(`\\b(?:in|to|into|on|onto|under|for)\\s+(?:the\\s+|my\\s+)?(${Object.keys(TOOL_WORDS).sort((a, b) => b.length - a.length).map(esc).join('|')})\\b`, 'i');
  if ((m = toolRe.exec(rest))) {
    const tool = TOOL_WORDS[m[1].toLowerCase()];
    dest.tool = tool; rest = rest.replace(m[0], ' ');
  }
  const colRe = new RegExp(`\\b(?:in|to|into|under|on|onto)\\s+(?:the\\s+|my\\s+)?(${Object.keys(COLUMN_WORDS).map(esc).join('|')})(?:\\s+column)?(?:\\s+(?:in|on)\\s+(?:taskly|my task list|tasks))?\\b`, 'i');
  m = colRe.exec(rest);
  if (m && (!dest.tool || dest.tool === 'taskly') && (m[1].toLowerCase() !== 'done' || /column|taskly|tasks/i.test(m[0]))) {
    dest.tool = 'taskly'; dest.column = COLUMN_WORDS[m[1].toLowerCase()]; rest = rest.replace(m[0], ' ');
  }
  const tabs = ctx.tabs || [];
  if (tabs.length && (!dest.tool || dest.tool === 'boardly')) {
    const tabRe = new RegExp(`\\b(?:in|to|into|under|on)\\s+(?:the\\s+|my\\s+)?(${tabs.map(t => esc(t.name)).join('|')})(?:\\s+(?:tab|category|board|section))?\\b`, 'i');
    if ((m = tabRe.exec(rest))) {
      const tab = tabs.find(t => t.name.toLowerCase() === m[1].toLowerCase());
      dest.tool = 'boardly'; dest.tabId = tab.id; dest.tabName = tab.name; rest = rest.replace(m[0], ' ');
    }
  }
  return { dest, rest: tidy(rest) };
}

// ---------- Finding an existing card ----------
const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
export function findCard(phrase, cards) {
  const p = norm(phrase).replace(/^(?:the|my|a|an|that|this)\s+/, '').replace(/\s+(?:card|task|note|goal|event|reminder|item|one)$/, '').trim();
  if (!p) return null;
  const words = p.split(' ').filter(w => w.length > 1 && !['the', 'my', 'to', 'a', 'an', 'and', 'of', 'thing', 'things', 'stuff', 'one', 'card', 'task', 'note', 'item'].includes(w)); // "the passport thing" → passport
  let best = null, bestScore = 0;
  for (const c of cards) {
    const t = norm(c.title);
    if (!t) continue;
    let s = 0;
    if (t === p) s = 100;
    else if (t.includes(p)) s = 60 + p.length / t.length * 20;
    else if (p.includes(t) && t.length > 3) s = 50;
    else if (words.length) {
      const hits = words.filter(w => t.split(' ').some(tw => tw === w || (w.length > 3 && (tw.startsWith(w) || w.startsWith(tw))))).length;
      s = (hits / words.length) * 45;
    }
    if (s > bestScore || (s === bestScore && best && c.updatedAt > best.updatedAt)) { bestScore = s; best = c; }
  }
  return bestScore >= 30 ? best : null;
}

// ---------- Parse one command ----------
export function parseCommand(raw, ctx = {}) {
  const now = ctx.now || new Date();
  const cards = ctx.cards || [];
  const text = normalize(raw);
  if (!text) return null;
  let m;

  if ((m = /^(?:open|go to|go|show me|show|switch to|take me to)\s+(?:the\s+|my\s+)?(home|taskly|boardly|timely|brainly|calendar|notes|tasks|board)\b/i.exec(text))) {
    const route = { calendar: 'timely', notes: 'brainly', tasks: 'taskly', board: 'boardly' }[m[1].toLowerCase()] || m[1].toLowerCase();
    return { kind: 'open', route };
  }
  if (/^go home$/i.test(text)) return { kind: 'open', route: 'home' };

  if ((m = /^rename\s+(.+?)\s+(?:to|as)\s+(.+)$/i.exec(text))) {
    const card = findCard(m[1], cards);
    return card ? { kind: 'rename', card, title: cap(stripQuotes(m[2])) } : notFound(m[1]);
  }

  if ((m = /^(?:delete|remove|trash|get rid of|throw away|throw out|bin)\s+(.+?)(?:\s+from\s+(?:the\s+|my\s+)?\w+(?:\s+board)?)?$/i.exec(text))) {
    const card = findCard(m[1], cards);
    return card ? { kind: 'delete', card } : notFound(m[1]);
  }

  if ((m = /^(?:complete|finish|finished|check off|tick off|cross off|mark|i finished|i did|i completed|done with)\s+(.+?)(?:\s+(?:as\s+)?(?:done|complete|completed|finished))?$/i.exec(text))) {
    const card = findCard(m[1], cards);
    return card ? { kind: 'complete', card } : notFound(m[1]);
  }

  // Move: try each "to/into/in/for" split; the left side must match a card, the right side a destination.
  if ((m = new RegExp(`^(?:${MOVE_VERBS})\\s+(.+)$`, 'i').exec(text))) {
    const body = m[1];
    const re = /\s+(?:to|into|in|onto|on|for|until|till)\s+/gi;
    let hit;
    while ((hit = re.exec(body))) {
      const left = body.slice(0, hit.index), right = body.slice(hit.index);
      const card = findCard(left, cards);
      if (!card) continue;
      const { dest, rest } = extractDest(right, ctx);
      const { when, rest: rest2 } = extractWhen(rest, now);
      if ((dest.tool || when) && rest2.replace(/\b(?:to|into|in|on|for|the|my|at)\b/gi, '').trim().length < 3) {
        return { kind: 'move', card, ...dest, when, tool: dest.tool || (when ? 'timely' : card.tool) };
      }
    }
    if (/^(?:reschedule|bump|push)\b/i.test(text)) {
      const { when, rest } = extractWhen(body, now);
      const card = findCard(rest.replace(/\s+(?:to|for|until)$/i, ''), cards);
      if (card && when) return { kind: 'move', card, tool: 'timely', when };
    }
    if (!/^put\b/i.test(text)) return notFound(body.split(/\s+(?:to|into|in)\s+/i)[0]);
  }

  // Reminders
  if ((m = /^(?:remind me|set a reminder|add a reminder|create a reminder|make a reminder)\s+(?:to\s+|that\s+|about\s+|for\s+)?(.+)$/i.exec(text))) {
    const { when, rest } = extractWhen(m[1], now);
    const title = cleanTitle(rest);
    if (!title) return null;
    // "Remind me…" is unmistakably a command, so it runs from Chat and Voice too, not only Command mode.
    return { kind: 'create', type: 'event', reminder: true, tool: 'timely', title, when: when || null, explicit: true };
  }

  // Create
  if ((m = new RegExp(`^(?:${CREATE_VERBS})\\s+(.+)$`, 'i').exec(text))) {
    let body = m[1];
    let type = null;
    const typeRe = new RegExp(`^(?:(?:a|an|the|another)\\s+)?(?:new\\s+)?(${Object.keys(TYPE_WORDS).sort((a, b) => b.length - a.length).map(esc).join('|')})\\b\\s*(?:called|titled|named|that says|saying|for|to|about|:|-)?\\s*`, 'i');
    const tm = typeRe.exec(body);
    if (tm) {
      type = TYPE_WORDS[tm[1].toLowerCase()];
      let after = body.slice(tm[0].length);
      // "a task to Taskly called…": that "to" introduced the destination, not the title. Give it back.
      const destWords = [...Object.keys(TOOL_WORDS), ...Object.keys(COLUMN_WORDS), ...(ctx.tabs || []).map(t => t.name)].sort((a, b) => b.length - a.length).map(esc).join('|');
      if (/(?:^|\s)(?:to|for|in|into|on)\s*$/i.test(tm[0]) && new RegExp(`^(?:the\\s+|my\\s+)?(?:${destWords})\\b`, 'i').test(after)) after = `to ${after}`;
      // Keep descriptive nouns in the title: "a meeting with Sam" → "Meeting with Sam".
      if (/^(meeting|appointment|idea|call)$/i.test(tm[1]) && /\b(with|about|for|at)\s*$/i.test(tm[0])) body = `${tm[1]} ${tm[0].match(/\b(with|about|for|at)\s*$/i)[1]} ${after}`;
      else if (/^(meeting|appointment|idea)$/i.test(tm[1]) && /^(with|about|for|at)\b/i.test(after)) body = `${tm[1]} ${after}`;
      else body = after;
    }
    const { dest, rest: rest0 } = extractDest(body, ctx);
    const { dur, rest } = extractDur(rest0);
    const { when, rest: rest2 } = extractWhen(rest, now);
    const title = cleanTitle(rest2);
    if (!title) return null;
    const verb = text.split(/\s+/)[0].toLowerCase();
    if (!type && (['schedule', 'book', 'block', 'reserve'].includes(verb) || /^set aside/i.test(text) || dur)) type = 'event';
    if (dest.plan || dest.board) {
      return { kind: 'create', tool: 'timely', type: dest.board === 'goals' ? 'goal' : 'task', title, plan: dest.plan || null, board: dest.board || null, containerId: dest.containerId || null, containerName: dest.containerName || null, when: null, explicit: true };
    }
    if (!type) type = dest.tool === 'boardly' ? 'note' : 'card';
    let tool = dest.tool || (when ? 'timely' : DEFAULT_TOOL[type]);
    if (tool === 'home') tool = 'universal';
    const reminder = type === 'reminder';
    const finalType = tool === 'boardly' ? (['goal', 'task', 'note'].includes(type) ? type : 'note') : NATIVE_TYPE[tool] || type;
    return {
      kind: 'create', type: finalType, reminder, tool, title, column: dest.column || null,
      tabId: dest.tabId || null, tabName: dest.tabName || null,
      when: tool === 'timely' ? (when || (reminder ? null : { date: key(now) })) : null,
      dur: tool === 'timely' ? dur : null,
      explicit: !!(tm || dest.tool || when || dur || ['create', 'add', 'schedule', 'book', 'jot', 'capture', 'remind', 'block', 'reserve'].includes(verb)),
    };
  }
  return null;
}
function stripQuotes(s) { return s.replace(/^["']|["']$/g, '').trim(); }
function cleanTitle(s) {
  return cap(stripQuotes(String(s || '')
    .replace(/^[\s:,;–—-]+/, '')
    .replace(/^(?:(?:a|an|the)\s+)?(?:called|titled|named|that says|saying|to|for|about|:|-)\s+/i, '')
    .replace(/\s+(?:to|in|on|into|for|at|by|called|titled)$/i, '')
    .trim()));
}
const notFound = phrase => ({ kind: 'error', message: `I couldn’t find a card matching “${phrase.trim()}”.` });

/** Parse a whole utterance (possibly several commands). */
export function parseCommands(raw, ctx = {}) {
  const parts = splitCommands(normalize(raw));
  return parts.map(p => parseCommand(p, ctx)).filter(Boolean);
}
export const looksLikeCommand = raw => CMD_START.test(normalize(raw));
