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
  /,?\s+and\s+(?=(?:call|email|e-mail|text|message|buy|book|pay|send|finish|fix|clean|schedule|write|order|renew|cancel|reply to|follow up|submit|return|drop off|update|review|ask|tell|invite)\b)/gi,
];
export function splitThoughts(text) {
  let s = ` ${spokenToTyped(text)} `;
  for (const re of BREAKS) s = s.replace(re, ' | ');
  return s.split('|').map(t => t.trim().replace(/^[,.\s]+|[,.\s]+$/g, '')).filter(t => t.split(/\s+/).length >= 2);
}

const INTENT = /^(?:(?:so|and|but|okay|ok|also)\s+)?(?:i\s+)?(?:really\s+|also\s+|still\s+)?(?:need to|have to|gotta|got to|'?ve got to|should(?: probably)?|must|ought to|remember to|want to remember to|don'?t forget to|make sure (?:i |to |that i )?|'?ll|will|am going to|'m going to|im going to|going to|have got to|need(?=\s+(?:a|an|some|more|to)\b))\s+(.+)$/i;
const GOAL = /^(?:(?:so|and|but|also)\s+)?(?:i\s+)?(?:really\s+)?(?:want to|wanna|would (?:really )?like to|'d (?:really )?like to|hope to|plan to|aim to|my goal is to|the goal is to|goal is to|i'?m (?:trying|working) (?:to|on)|this year i want to|someday i want to|one day i want to|eventually i want to)\s+(.+)$/i;
const WHAT_IF = /\bwhat if\s+(.+)$/i;
const IDEA = /^(?:(?:so|and|but|also)\s+)?(?:(?:i (?:had|have) )?an? idea(?: for)?(?: is)?[:,]?|idea[:,]|what if|maybe (?:we|i) (?:could|should)|it would be (?:cool|nice|great|fun) (?:to|if)|i was thinking(?: about| that)?|i'?ve been thinking(?: about| that)?)\s+(.+)$/i;
const ACTION = /^(?:call|phone|email|e-mail|text|message|dm|buy|get|grab|pick up|book|pay|send|finish|fix|clean|tidy|schedule|write|read|order|renew|cancel|check|reply to|respond to|follow up|sign up|submit|prepare|prep|plan|organize|return|drop off|wash|update|review|research|ask|tell|sort out|look into|set up|move|file|print|post|ship|make|bake|cook|water|walk|feed|clear|back up|install|charge|invite|thank)\b/i;
const EVENTISH = /\b(?:meeting|meet(?:ing)? (?:with|up)|appointment|lunch|dinner|breakfast|coffee|drinks|call with|class|session|interview|party|wedding|birthday|flight|game|concert|doctor|dentist|haircut)\b/i;

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
    .replace(/^(?:i\s+)?(?:have|got|'ve got)\s+(?:a|an|the|my)\s+/i, '')     // "I have a dentist appointment" → "Dentist appointment"
    .replace(/^(?:there'?s|there is)\s+(?:a|an)\s+/i, '')
    .replace(/\s+(?:and stuff|or something|or whatever|and things|and that|you know|too|as well|also|at some point|soon|asap|this week)$/i, '')
    .replace(/\b(?:my|our)\s+(?=\w)/gi, m => m) // keep possessives: "renew my passport" reads naturally
    .replace(/\s{2,}/g, ' ')
    .trim()
    .replace(/[\s,]+(?:before|by|on|at|until|for|in|from|this|next|around|after)$/i, '') // "pay the bill before (Monday)"
    .trim();
  if (s.length > 80) s = s.slice(0, 77).replace(/\s+\S*$/, '') + '…';
  return s ? s[0].toUpperCase() + s.slice(1) : '';
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
    if (looksLikeCommand(raw)) {
      const c = parseCommands(raw, ctx).find(x => x.kind === 'create' && x.title);
      if (c) {
        const type = c.tool === 'boardly' && c.type === 'goal' ? 'goal' : c.tool === 'brainly' ? 'note' : c.tool === 'timely' ? (c.reminder ? 'reminder' : 'event') : 'task';
        s = { type, title: c.title, when: c.when || null, tab: c.tabName || null, sure: true };
      }
    }
    if (!s) {
      const { when, rest } = extractWhen(raw, now);
      let m, type = null, title = null, sure = false;
      if ((m = WHAT_IF.exec(rest))) { type = 'note'; title = `What if ${m[1]}`; sure = true; }
      else if ((m = GOAL.exec(rest))) { type = 'goal'; title = m[1]; sure = true; }
      else if ((m = IDEA.exec(rest))) { type = 'note'; title = m[1]; sure = true; }
      else if ((m = INTENT.exec(rest))) { type = 'task'; title = m[1]; sure = true; }
      else if (ACTION.test(rest)) { type = 'task'; title = rest; }
      else if (when && EVENTISH.test(rest)) { type = 'event'; title = rest; sure = true; }
      if (type && when && (when.date || when.start != null)) {
        if (type === 'task') type = EVENTISH.test(title) ? 'event' : 'reminder';
        else if (type === 'note') type = 'reminder';
        sure = true;
      }
      title = tidyTitle(title);
      if (type && title && title.split(/\s+/).length <= 14) s = { type, title, when: type === 'goal' ? null : when, tab: null, sure };
    }
    if (!s) continue;
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
