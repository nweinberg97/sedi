// Sedi — Unload: turn a stretch of rambling speech into suggested cards. Pure functions (no DOM), so they
// can be tested on their own. Suggestions are only suggestions: the person keeps, moves or dismisses each one.
// Everything runs on the device; nothing here needs an AI model.

import { spokenToTyped, extractWhen, parseCommands, looksLikeCommand } from './commands.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// Where one thought ends and the next begins, in the way people talk.
const BREAKS = [
  /\s*[.!?]+\s+/g,
  /\s*;\s*/g,
  /,?\s+(?:and then|and also|oh and|oh also|also|plus|another thing is|another thing|the other thing is|anyway|anyways|besides that)\s+/gi,
  /,?\s+(?:and|but|so)\s+(?=(?:i|i'?ll|i'?ve|i'?m|we|we'?ll)\s+(?:need|have|should|gotta|got|want|wanna|must|will|am going|'m going|plan|hope|really)\b)/gi,
  /,?\s+(?:and|but|so)\s+(?=(?:remember|don'?t forget|make sure)\b)/gi,
  /,?\s+(?:and|but|so|then)\s+(?=(?:remind me|add (?:a|an|the)?|schedule|make a|put|create|book)\b)/gi,
  /,\s+(?=(?:i|i'?ll|i'?ve|i'?m|we|we'?ll)\s+(?:need|have|should|gotta|got|want|wanna|must|will|am going|'m going|plan|hope|really)\b)/gi,
  /,\s+(?=(?:i\s+)?(?:need|needs|gotta|have|has|should|must|got) to\b)/gi,
  /,\s*so(?:\s+yeah)?,?\s+(?=(?:call|email|e-mail|text|buy|book|pay|send|finish|fix|clean|water|walk|feed|write|order|renew|cancel|pick up|drop off|ask|tell)\b)/gi,
  /,?\s+and\s+(?=(?:the|our|my)\s+[\w' -]{2,30}?\s+(?:is|are|isn'?t|aren'?t|needs?|looks?|feels?)\b)/gi,
  /,?\s+and\s+(?=(?:call|email|e-mail|text|message|buy|book|pay|send|finish|fix|clean|schedule|write|order|renew|cancel|reply to|follow up|submit|return|drop off|update|review|ask|tell|invite)\b)/gi,
];
export function splitThoughts(text) {
  let s = ` ${spokenToTyped(text)} `
    .replace(/\b(?:an? )?idea for (?:the |my |our )?([\w' ]{2,30}?):\s*/gi, 'idea: $1, ')
    .replace(/(^|[.!?]\s+)[\w' ]{2,25}?(?:stuff|things|wise|-wise|list|related):\s*/gi, '$1');
  for (const re of BREAKS) s = s.replace(re, ' | ');
  return s.split('|').map(t => t.trim().replace(/^[,.\s]+|[,.\s]+$/g, '')).filter(t => t.split(/\s+/).length >= 2);
}

const INTENT = /^(?:(?:so|and|but|okay|ok|also)\s+)?(?:(?:i|we)\s*)?(?:really\s+|also\s+|still\s+)?(?:need to|have to|gotta|got to|'?ve got to|should(?: probably)?|must|ought to|remember to|want to remember to|don'?t forget to|make sure (?:i |to |that i )?|'?ll|will|am going to|'m going to|im going to|going to|have got to|need(?=\s+(?:a|an|some|more|to)\b))\s+(.+)$/i;
const GOAL = /^(?:(?:so|and|but|also)\s+)?(?:i\s*)?(?:really\s+)?(?:want to|wanna|would (?:really )?like to|'d (?:really )?like to|'d love to|would love to|love to|hope to|plan to|aim to|my goal is to|the goal is to|goal is to|i'?m (?:trying|working) (?:to|on)|'?m going to try (?:and|to)|am going to try (?:and|to)|going to try (?:and|to)|wanna try (?:and|to)|want to try (?:and|to)|this year i want to|someday i want to|one day i want to|eventually i want to|want to get better at|wanna get better at)\s+(.+)$/i;
const WHAT_IF = /\bwhat if\s+(.+)$/i;
const SELF_NOTE = /^(?:(?:so|and|also)\s+)?(?:note to self|quick note|just a note|for the record|fyi)[,:]?\s+(.+)$/i;
const DONT_FORGET = /^(?:(?:so|and|also)\s+)?(?:don'?t forget|remember|make sure to remember)(?: that)?\s+(.+)$/i;
const IDEA = /^(?:(?:so|and|but|also)\s+)?(?:(?:i (?:had|have) )?an? idea(?: for)?(?: is)?[:,]?|idea[:,]|what if|maybe (?:we|i) (?:could|should)|it would be (?:cool|nice|great|fun) (?:to|if)|i was thinking(?: about| that)?(?: it would be (?:cool|nice|great|fun) (?:to|if))?|i'?ve been thinking(?: about| that)?(?: it would be (?:cool|nice|great|fun) (?:to|if))?|(?:wouldn'?t it be|it'?d be) (?:cool|nice|great|fun) (?:to|if)|i wonder (?:if|whether)(?: (?:we|i) (?:should|could))?|i was wondering (?:if|whether)(?: (?:we|i) (?:should|could))?)\s+(.+)$/i;
const ACTION = /^(?:call|phone|email|e-mail|text|message|dm|buy|get|grab|pick up|book|pay|send|finish|fix|clean|tidy|schedule|write|read|order|renew|cancel|check|reply to|respond to|follow up|sign up|submit|prepare|prep|plan|organize|return|drop off|wash|update|review|research|ask|tell|sort out|look into|set up|move|file|print|post|ship|make|bake|cook|water|walk|feed|clear|back up|install|charge|invite|thank)\b/i;
const EVENTISH = /\b(?:meeting|meet(?:ing)? (?:with|up)|appointment|lunch|dinner|breakfast|coffee|drinks|call with|class|session|interview|party|wedding|birthday|flight|game|concert|doctor|dentist|haircut|practice|lesson|rehearsal|training|match|gym|yoga class|appointment|date night|playdate|recital|shift)\b/i;

const TAB_HINTS = [
  ['Health', /\b(?:run|running|gym|workout|exercise|sleep|eat|diet|weight|yoga|walk|health|meditat|stretch|marathon|10k|5k|swim|bike|doctor|therapy)/i],
  ['Relationships', /\b(?:mom|dad|mum|parents|family|friend|friends|partner|wife|husband|girlfriend|boyfriend|kids|son|daughter|date|wedding|birthday|call (?:my )?(?:sister|brother))/i],
  ['Work', /\b(?:work|job|career|client|boss|team|project|launch|deck|meeting|product|startup|business|promotion|resume|portfolio|code|ship)/i],
  ['Chores', /\b(?:clean|laundry|dishes|groceries|grocery|vacuum|garden|trash|recycling|tidy|fix the|repair|car wash)/i],
  ['Admin', /\b(?:tax|taxes|bill|bills|bank|insurance|passport|license|licence|rent|lease|form|paperwork|renew|appointment|subscription)/i],
];
export const guessTab = (title, tabs = []) => {
  for (const [name, re] of TAB_HINTS) if (re.test(title) && tabs.some(t => t.name.toLowerCase() === name.toLowerCase())) return name;
  return null;
};

/** Clean a spoken fragment into a card title. */
export function tidyTitle(t) {
  let s = String(t || '')
    .replace(/^(?:to|that|i|and|so|but|also|then|like|just|basically|actually)\s+/i, '')
    .replace(/^(?:to|that|i|just)\s+/i, '')
    .replace(/^(?:i'?m|i am|we'?re|we are)\s+(?=\w+ing\b)/i, '')
    .replace(/^(?:i\s+)?(?:have|got|'ve got)\s+(?:a|an|the|my)\s+/i, '')     // "I have a dentist appointment" → "Dentist appointment"
    .replace(/^(?:there'?s|there is)\s+(?:a|an)\s+/i, '')
    .replace(/^add\s+(?=\S+\s+(?:and|,)\s)/i, '')                           // "add milk, eggs and bread…" → "milk, eggs and bread"
    .replace(/\s+(?:to|on)\s+(?:my|the)\s+(?:to[\s-]?do\s+|shopping\s+|grocery\s+)?list$/i, '')
    .replace(/\s+(?:and stuff|or something|or whatever|and things|and that|you know|too|as well|also|at some point|soon|asap|this week)$/i, '')
    .replace(/\b(?:my|our)\s+(?=\w)/gi, m => m) // keep possessives: "renew my passport" reads naturally
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[\s,]+(?:before|by|on|at|until|for|in|from|this|next|around|after|every|each)$/i, '') // "pay the bill before (Monday)"
    .trim();
  if (s.length > 80) s = s.slice(0, 77).replace(/\s+\S*$/, '') + '…';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
}

// Shopping said sideways: "we're out of milk", "we need more dish soap".
const OUT_OF = /^(?:(?:and|so|also)\s+)?(?:we'?re|we are|i'?m|i am|we'?ve run|we ran|i ran|we'?re running|i'?m running)\s+(?:all\s+)?(?:out of|low on|almost out of)\s+(.+)$/i;
const NEED_MORE = /^(?:(?:and|so|also)\s+)?(?:we|i)\s+(?:need|could use)\s+(more|some more|new|a new)\s+(.+)$/i;
// "the car needs an oil change" → "Oil change for the car"
const THING_NEEDS = /^(?:(?:so|and|also|basically)\s+)?((?:the|my|our)\s+[\w' -]{2,30}?)\s+(?:needs|need)\s+(?:(?:a|an|some|to be)\s+)?(.+)$/i;
// "I'm going to the gym on Monday at 7" → an event called "Gym"
const GOING_TO = /^(?:(?:so|and|also)\s+)?(?:i'?m|i am|we'?re|we are)\s+(?:going|heading)\s+to\s+(?:the\s+)?(.+)$/i;
// "the kids have soccer practice every Tuesday"
const HAVE_EVENT = /^(?:(?:so|and|also)\s+)?(?:i|we|the kids|my \w+|\w+)\s+(?:has|have|'ve got|got)\s+(?:a\s+|an\s+|their\s+|his\s+|her\s+|my\s+|our\s+)?(.+)$/i;
// A thing noticed about a project: "the pricing section is confusing" → a note.
const OBSERVATION = /^(?:(?:so|and|also|basically)\s+)?((?:the|our|my)\s+.+?\s+(?:is|are|isn'?t|aren'?t|feels?|looks?|seems?)\s+(?:a bit\s+|kind of\s+|really\s+|too\s+|so\s+|pretty\s+)?(?:confusing|broken|slow|wrong|missing|off|ugly|unclear|messy|cluttered|buggy|outdated|long|short|hard to \w+|not working|empty|full|late|great|good|nice|perfect).*)$/i;
// Habits are goals, not one-off tasks: "every morning", "three times a week", "more".
const VISIT = /\b(?:is|'s|are|'re)\s+(?:coming(?: over| to visit| to stay| round)?|visiting|arriving|flying in|in town|staying)\b/i;
const FACT = /^(?:don'?t forget|remember|keep in mind|fyi|note)(?: that)?\s+(.+\b(?:is|are|isn'?t|has|have|likes|loves|hates|was|were|can'?t|doesn'?t)\b.+)$/i;
const HABIT = /\b(?:every (?:day|morning|night|evening|week|weekday)|each (?:day|morning|week)|daily|(?:once|twice|\w+ times) a (?:day|week|month)|more often|regularly|again)\b|\b(?:read|walk|sleep|drink water|exercise|move|stretch|save) more\b|^(?:stop|quit|cut (?:back|down) on|get better at|be (?:more|less))\b/i;

// Turn "calling" into "call", so a title reads like an instruction.
const E_STEMS = new Set(['mak', 'tak', 'writ', 'schedul', 'prepar', 'chang', 'mov', 'sav', 'giv', 'driv', 'updat', 'creat', 'organiz', 'clos', 'shar', 'bak', 'hik', 'danc', 'practic', 'exercis', 'plac', 'pric', 'us', 'leav', 'com', 'los', 'choos', 'car', 'scrap', 'recycl', 'renam', 'figur', 'tidy', 'purchas', 'replac', 'arrang', 'manag', 'handl', 'settl', 'sort', 'continu', 'complet', 'declutt']);
const NOUN_ING = /^(?:meeting|wedding|morning|evening|building|ceiling|clothing|painting|spring|thing|something|nothing|everything|king|ring|sing|bring|string|swing|wing|ping|evening|ding)$/i;
function baseVerb(w) {
  if (!/ing$/i.test(w) || w.length < 5) return w;
  let st = w.slice(0, -3);
  if (/([bdgmnprt])\1$/i.test(st) && !/(ll|ss)$/i.test(st)) st = st.slice(0, -1);
  else if (E_STEMS.has(st.toLowerCase())) st += 'e';
  return st;
}
/** Make a spoken fragment read like a card: drop the run-up ("get around to", "start"), the reasons
 *  ("because…"), and the asides ("like maybe…"). */
export function shorten(t, type = 'task') {
  let s = String(t || '').trim()
    .replace(/^(?:also|and|so|but|then|okay|ok|yeah|like|basically|honestly|actually|anyway)[,\s]+/i, '')
    .replace(/^(?:don'?t forget(?: that)?|remember(?: that)?|make sure(?: that)?(?: i| to)?)\s+/i, '')
    .replace(/^(?:probably|definitely|really|finally|maybe|just|also|actually|seriously)\s+/i, '')
    .replace(/^(?:get around to|get to|go ahead and|try (?:and|to)|remember to|be sure to|make time to|find time to|get on|deal with)\s+/i, '')
    .replace(/^(?:start|begin)(?: to)?\s+/i, m => (type === 'goal' ? m : ''))
    .replace(/\s+(?:because|cause|'cause|cos|since|so that|so i can|so we can|which|which is|that way|otherwise|before it'?s too late|if i can|if possible|when i get a chance|when i have time|at some point|like maybe|maybe|or so|or something|or whatever|i guess|i think|you know|for real|honestly|to see (?:if|whether|when|what)|to check (?:if|whether)|to find out (?:if|whether)|before that|after that)\b.*$/i, '')
    .replace(/,\s*(?:like|it'?s|its|that'?s|thats|and it|but|which|so|he|she|they|it|mine|ours|theirs|his|hers|this|there|we|i)\b.*$/i, '')
    .replace(/\s+is$/i, '').replace(/[\s,;:–-]+$/, '')
    .replace(/\s+on the (?:first|1st|second|third|last day)(?: of the month)?$/i, '')
    .trim();
  if (type !== 'note' && type !== 'event') s = s.replace(/^(\w+)/, w => (NOUN_ING.test(w) ? w : baseVerb(w)));
  return s.replace(/\bfor (The|My|Our)\b/, (a, b) => `for ${b.toLowerCase()}`);
}

/**
 * Suggestions for one chunk of speech. Each is
 * { type: 'task'|'reminder'|'event'|'goal'|'note', title, when?, tab?, sure } where sure means a
 * clear signal (a command, a date, an intention) rather than a guess.
 */
export function suggest(text, { now = new Date(), tabs = [], cards = [], plan = {} } = {}) {
  const out = [];
  const ctx = { now, tabs, cards, plan };
  for (const raw of splitThoughts(text)) {
    let s = null;
    // 1. Said like a command ("remind me to…", "add a task…"): Sedi's own reader knows exactly what to do.
    if (looksLikeCommand(raw) && !/^(?:make sure|make time|make it)\b/i.test(raw)) {
      const c = parseCommands(raw, ctx).find(x => x.kind === 'create' && x.title);
      if (c) {
        const type = c.tool === 'boardly' && c.type === 'goal' ? 'goal' : c.tool === 'brainly' ? 'note' : c.tool === 'timely' ? (c.reminder ? 'reminder' : 'event') : 'task';
        s = { type, title: tidyTitle(shorten(c.title)) || c.title, when: c.when || null, tab: c.tabName || null, sure: true };
        // "book flights to Lisbon" reads like scheduling, but with no day or time it's something to do.
        if (type === 'event' && !extractWhen(raw, now).when && ACTION.test(raw.replace(/^(?:i\s+)?(?:need to|have to|gotta|should)\s+/i, ''))) s = { ...s, type: 'task', when: null, title: tidyTitle(raw.replace(/^(?:i\s+)?(?:need to|have to|gotta|should)\s+/i, '')) };
      }
    }
    if (!s) {
      const ew = extractWhen(raw.replace(/\b(?:on )?the (\d{1,2})(?:st|nd|rd|th)\b(?! of)/i, (a, d) => {
        const day = +d; if (day < 1 || day > 31) return a;
        const t = new Date(now); if (day < t.getDate()) t.setMonth(t.getMonth() + 1);
        return `on ${MONTHS[t.getMonth()]} ${day}`;
      }), now);
      let when = ew.when;
      // "by the end of the month / week" is a due date.
      const eo = /\s*\b(?:by|before|at) the end of (?:the |this )?(month|week)\b/i.exec(ew.rest);
      if (eo && !when) {
        const d = new Date(now);
        if (/month/i.test(eo[1])) { d.setMonth(d.getMonth() + 1, 0); } else { d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); }
        when = { date: keyOf(d) };
        ew.rest = ew.rest.replace(eo[0], '');
      }
      const rest = ew.rest
        .replace(/^(?:(?:this|next) (?:week|month|year|weekend)|this morning|this afternoon|tonight|today|tomorrow)[,\s]+/i, '')
        .replace(/^(?:i|we) (?:keep|always) forget(?:ting)? to\s+/i, 'I need to ');
      let m, type = null, title = null, sure = false;
      if ((m = SELF_NOTE.exec(rest))) { type = 'note'; title = m[1]; sure = true; }
      else if (!when && (m = FACT.exec(rest))) { type = 'note'; title = m[1]; sure = true; }
      else if (when && VISIT.test(rest)) { type = 'event'; title = rest.replace(/^(?:my|our)\s+/i, ''); sure = true; }
      else if ((m = WHAT_IF.exec(rest))) { type = 'note'; title = `What if ${m[1]}`; sure = true; }
      // "don't forget the rent is due on the first": something with a due date is a reminder
      else if ((m = DONT_FORGET.exec(rest)) && /\b(?:due|deadline|expires?|renew|on the \w+|by \w+)\b/i.test(m[1])) { type = 'reminder'; title = m[1]; sure = true; }
      else if ((m = GOAL.exec(rest))) { type = 'goal'; title = m[1]; sure = true; }
      else if ((m = IDEA.exec(rest))) { type = 'note'; title = m[1]; sure = true; }
      else if ((m = OUT_OF.exec(rest))) { type = 'task'; title = `Buy ${m[1]}`; sure = true; }
      else if ((m = NEED_MORE.exec(rest))) { type = 'task'; title = `Buy ${m[1]} ${m[2]}`; sure = true; }
      else if (when && (m = GOING_TO.exec(rest)) && !/^(?:try|have|need|be|do|get|make|start)\b/i.test(m[1])) { type = 'event'; title = m[1]; sure = true; }
      else if ((m = INTENT.exec(rest))) { type = HABIT.test(m[1]) && !when?.date ? 'goal' : 'task'; title = m[1]; sure = true; }
      else if ((m = THING_NEEDS.exec(rest)) && !/^(?:the|my|our)\s+(?:kids?|baby|dog|cat)\b/i.test(m[1])) { type = 'task'; title = `${m[2]} for ${m[1]}`; sure = true; }
      else if (ACTION.test(shorten(rest))) { type = 'task'; title = rest; }
      else if (when && EVENTISH.test(rest)) { type = 'event'; title = (HAVE_EVENT.exec(rest)?.[1]) || rest; sure = true; }
      else if ((m = OBSERVATION.exec(rest))) { type = 'note'; title = m[1]; }
      if (type && when && (when.date || when.start != null)) {
        if (type === 'task') type = EVENTISH.test(title) ? 'event' : 'reminder';
        else if (type === 'note') type = 'reminder';
        sure = true;
      }
      title = tidyTitle(shorten(tidyTitle(title), type));
      if (type && title && title.split(/\s+/).length <= 14) s = { type, title, when: type === 'goal' ? null : when, tab: null, sure };
    }
    if (!s) continue;
    s.raw = raw; // the words as said, for guessing where it belongs
    if (s.type === 'goal' && !s.tab) s.tab = guessTab(s.title, tabs);
    if (!out.some(o => o.title.toLowerCase() === s.title.toLowerCase())) out.push(s);
  }
  return out;
}

const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
/** Words for a date and time that Sedi's command reader understands. */
export function whenWords(when, now = new Date()) {
  if (!when) return '';
  const parts = [];
  if (when.date) {
    const today = keyOf(now), t = new Date(now); t.setDate(t.getDate() + 1);
    if (when.date === today) parts.push('today');
    else if (when.date === keyOf(t)) parts.push('tomorrow');
    else { const [y, m, d] = when.date.split('-').map(Number); parts.push(`on ${MONTHS[m - 1]} ${d}`); }
  }
  if (when.start != null) {
    const h = Math.floor(when.start / 60), mi = when.start % 60;
    parts.push(`at ${h % 12 || 12}${mi ? `:${pad(mi)}` : ''}${h < 12 ? 'am' : 'pm'}`);
  } else if (when.slot) parts.push(`in the ${when.slot === 'night' ? 'evening' : when.slot}`);
  return parts.join(' ');
}

/** The command that creates a suggestion where it's headed, in Sedi's own command words. */
export function commandFor(s, now = new Date()) {
  const w = whenWords(s.when, now);
  switch (s.type) {
    case 'reminder': return `remind me to ${s.title}${w ? ` ${w}` : ''}`;
    case 'event': return `schedule ${s.title}${w ? ` ${w}` : ''}`;
    case 'goal': return `make a goal in Boardly${s.tab ? ` ${s.tab}` : ''} called ${s.title}`;
    case 'note': return `make a note in Brainly called ${s.title}`;
    default: return `add a task to To do called ${s.title}`;
  }
}

export const TYPE_LABEL = { task: 'Task', reminder: 'Reminder', event: 'Event', goal: 'Goal', note: 'Note' };
export const TYPE_HOME = { task: 'Taskly · To do', reminder: 'Timely · Reminder', event: 'Timely', goal: 'Boardly', note: 'Brainly' };
