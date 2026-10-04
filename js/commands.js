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
const DEFAULT_TOOL = { task: 'taskly', note: 'brainly', goal: 'boardly', event: 'timely', reminder: 'timely', link: 'brainly', card: 'universal' };
const NATIVE_TYPE = { taskly: 'task', timely: 'event', brainly: 'note', universal: 'note' };
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const NUM_WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, a: 1, an: 1 };
const SLOT_WORDS = { morning: 'morning', 'this morning': 'morning', noon: 'noon', lunch: 'noon', lunchtime: 'noon', afternoon: 'afternoon', 'this afternoon': 'afternoon', evening: 'evening', 'this evening': 'evening', night: 'night', tonight: 'evening' };

const CREATE_VERBS = 'create|add|make|new|put|write down|write|jot down|jot|capture|note down|log|save|set up|set|schedule|book|plan';
const MOVE_VERBS = 'move|send|shift|bump|push|reschedule|drag|put';
const CMD_START = new RegExp(`^(?:${CREATE_VERBS}|${MOVE_VERBS}|remind me|delete|remove|trash|get rid of|throw away|complete|finish|finished|check off|tick off|mark|rename|open|go to|go|show me|switch to|take me to|i finished|i did|i completed)\\b`, 'i');

const pad = n => String(n).padStart(2, '0');
const key = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d, n) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; };
const cap = s => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Strip politeness and assistant-addressing so "hey sedi, could you please add milk" → "add milk". */
export function normalize(raw) {
  return String(raw || '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .trim()
    .replace(/^(?:hey|hi|ok|okay)?\s*(?:sedi|seti|setty|cd)[,:]?\s+/i, '')
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

// ---------- Destinations (tool, column, Boardly tab) ----------
function extractDest(text, ctx) {
  let rest = text;
  const dest = {};
  let m;
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
  const words = p.split(' ').filter(w => w.length > 1 && !['the', 'my', 'to', 'a', 'an', 'and', 'of'].includes(w));
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
    return { kind: 'create', type: 'event', reminder: true, tool: 'timely', title, when: when || null };
  }

  // Create
  if ((m = new RegExp(`^(?:${CREATE_VERBS})\\s+(.+)$`, 'i').exec(text))) {
    let body = m[1];
    let type = null;
    const typeRe = new RegExp(`^(?:(?:a|an|the|another)\\s+)?(?:new\\s+)?(${Object.keys(TYPE_WORDS).sort((a, b) => b.length - a.length).map(esc).join('|')})\\b\\s*(?:called|titled|named|that says|saying|for|to|about|:|-)?\\s*`, 'i');
    const tm = typeRe.exec(body);
    if (tm) {
      type = TYPE_WORDS[tm[1].toLowerCase()];
      const after = body.slice(tm[0].length);
      // Keep descriptive nouns in the title: "a meeting with Sam" → "Meeting with Sam".
      if (/^(meeting|appointment|idea|call)$/i.test(tm[1]) && /\b(with|about|for|at)\s*$/i.test(tm[0])) body = `${tm[1]} ${tm[0].match(/\b(with|about|for|at)\s*$/i)[1]} ${after}`;
      else if (/^(meeting|appointment|idea)$/i.test(tm[1]) && /^(with|about|for|at)\b/i.test(after)) body = `${tm[1]} ${after}`;
      else body = after;
    }
    const { dest, rest } = extractDest(body, ctx);
    const { when, rest: rest2 } = extractWhen(rest, now);
    const title = cleanTitle(rest2);
    if (!title) return null;
    const verb = text.split(/\s+/)[0].toLowerCase();
    if (!type && ['schedule', 'book'].includes(verb)) type = 'event';
    if (!type) type = dest.tool === 'boardly' ? 'note' : 'card';
    let tool = dest.tool || (when ? 'timely' : DEFAULT_TOOL[type]);
    if (tool === 'home') tool = 'universal';
    const reminder = type === 'reminder';
    const finalType = tool === 'boardly' ? (['goal', 'task', 'note'].includes(type) ? type : 'note') : NATIVE_TYPE[tool] || type;
    return {
      kind: 'create', type: finalType, reminder, tool, title, column: dest.column || null,
      tabId: dest.tabId || null, tabName: dest.tabName || null,
      when: tool === 'timely' ? (when || (reminder ? null : { date: key(now) })) : null,
      explicit: !!(tm || dest.tool || when || ['create', 'add', 'schedule', 'book', 'jot', 'capture', 'remind'].includes(verb)),
    };
  }
  return null;
}
function stripQuotes(s) { return s.replace(/^["']|["']$/g, '').trim(); }
function cleanTitle(s) {
  return cap(stripQuotes(String(s || '')
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
