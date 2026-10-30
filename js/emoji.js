// Sedi — the emoji picker. These are plain Unicode emoji characters, drawn by the device's own emoji font,
// so nothing is bundled or licensed: every phone and computer already has them. Grouped like a keyboard,
// searchable by a few plain words, with the ones you used recently up top.

import * as store from './store.js';
import { h, popover, closePopovers } from './util.js';

// "emoji words" — the words are what search matches.
const GROUPS = [
  ['Smileys', '😀', `😀 smile happy|😄 grin happy|😊 blush happy warm|🙂 slight smile|😉 wink|😍 love heart eyes|🥰 love hearts|😎 cool sunglasses|🤓 nerd study|🧐 curious monocle|🤔 think thinking|😌 calm relieved|😴 sleep tired|🥱 yawn tired|😅 phew sweat|😂 laugh tears|🤣 laugh rolling|😇 angel halo|🙃 upside down silly|😜 silly wink tongue|🤪 crazy zany|😋 yum tasty|🤩 star struck wow|🥳 party celebrate|😮 wow surprised|😲 shocked|🤯 mind blown|😬 grimace awkward|😐 neutral meh|😶 speechless|🙄 eye roll|😏 smirk|😔 sad pensive|😢 cry sad|😭 sob cry|😤 frustrated huff|😠 angry|😡 rage angry|🥺 pleading please|😳 flushed embarrassed|😱 scream fear|😨 fear scared|🤗 hug|🤫 shush quiet secret|🤭 oops giggle|🫡 salute respect|🤐 zip quiet|🤒 sick ill|🤧 sneeze cold|😷 mask sick|🥶 cold freezing|🥵 hot|🤠 cowboy|🥸 disguise|👻 ghost halloween|💀 skull|🤖 robot ai|👽 alien|💩 poop|😺 cat smile|🙈 see no evil monkey`],
  ['People', '👋', `👋 wave hello|👍 thumbs up yes good|👎 thumbs down no|👏 clap applause|🙌 hooray raise hands|🙏 please thanks pray|🤝 handshake deal agreement|💪 strong muscle gym|✌️ peace victory|🤞 fingers crossed luck|👌 ok perfect|👉 point right|☝️ point up one|✍️ write writing|💅 nails self care|🧠 brain mind think|👀 eyes look watch|👁️ eye see|👂 ear listen|👄 mouth|🫶 heart hands love|❤️‍🔥 passion|👶 baby|🧒 child kid|👦 boy|👧 girl|🧑 person|👩 woman|👨 man|🧓 older person|👵 grandma|👴 grandpa|👪 family|👫 couple|💑 couple love|🧑‍💻 developer coder laptop|🧑‍🏫 teacher|🧑‍🎓 student graduate|🧑‍⚕️ doctor health|🧑‍🍳 cook chef|🧑‍🎨 artist|🧑‍🔧 mechanic fix|🧑‍🌾 farmer garden|🧑‍💼 office worker business|🧑‍🚀 astronaut space|🦸 hero|🧘 meditate yoga calm|🏃 run running|🚶 walk|🚴 bike cycling|🏊 swim|🧗 climb|💃 dance|🕺 dance|🛌 sleep bed|🗣️ speak talk|👥 people team group`],
  ['Nature', '🌿', `🌿 herb leaf plant green|🌱 seedling grow sprout|🌳 tree|🌲 pine tree evergreen|🌴 palm tree beach|🌵 cactus desert|🍀 clover luck|🍁 maple leaf autumn fall|🍂 leaves autumn|🌸 blossom spring flower|🌷 tulip flower|🌹 rose flower|🌻 sunflower|🌼 flower daisy|💐 bouquet flowers|🪴 potted plant|🍄 mushroom|🌾 rice wheat grain|🌊 wave ocean sea|🏔️ mountain snow|⛰️ mountain|🌋 volcano|🏝️ island|☀️ sun sunny|🌤️ sun cloud|⛅ cloudy|🌧️ rain|⛈️ storm|❄️ snow cold winter|☃️ snowman|🌈 rainbow|🌙 moon night|⭐ star|🌟 glowing star|✨ sparkles magic|⚡ lightning energy|🔥 fire hot|💧 water drop|🌍 earth world globe|🪐 planet saturn space|☄️ comet|🐶 dog puppy|🐱 cat|🐭 mouse|🐰 rabbit bunny|🦊 fox|🐻 bear|🐼 panda|🐨 koala|🐯 tiger|🦁 lion|🐮 cow|🐷 pig|🐸 frog|🐵 monkey|🐔 chicken|🐧 penguin|🐦 bird|🦉 owl wise|🦋 butterfly|🐝 bee busy|🐞 ladybug|🐢 turtle slow|🐍 snake|🐙 octopus|🐠 fish tropical|🐬 dolphin|🐳 whale|🦈 shark|🐴 horse|🦄 unicorn|🐘 elephant|🦒 giraffe|🦔 hedgehog|🐾 paw prints pet`],
  ['Food', '🍳', `🍳 cooking egg pan breakfast|🍎 apple fruit|🍐 pear|🍊 orange|🍋 lemon|🍌 banana|🍉 watermelon|🍇 grapes|🍓 strawberry|🫐 blueberries|🍒 cherries|🍑 peach|🥭 mango|🍍 pineapple|🥥 coconut|🥝 kiwi|🍅 tomato|🥑 avocado|🍆 eggplant|🥦 broccoli|🥬 greens lettuce|🥒 cucumber|🌶️ chili pepper spicy|🌽 corn|🥕 carrot|🧄 garlic|🧅 onion|🥔 potato|🍞 bread|🥐 croissant|🥖 baguette|🥨 pretzel|🧀 cheese|🥚 egg|🥞 pancakes|🧇 waffle|🥓 bacon|🍗 chicken|🍔 burger|🍟 fries|🍕 pizza|🌭 hot dog|🥪 sandwich|🌮 taco|🌯 burrito|🥗 salad healthy|🥘 paella stew|🍝 pasta spaghetti|🍜 noodles ramen|🍲 soup pot|🍛 curry|🍣 sushi|🍱 bento lunch|🥟 dumpling|🍤 shrimp|🍚 rice|🍙 rice ball|🍰 cake|🎂 birthday cake|🧁 cupcake|🍪 cookie|🍩 donut|🍫 chocolate|🍿 popcorn movie|🍦 ice cream|☕ coffee|🍵 tea|🧋 bubble tea|🥤 drink soda|🧃 juice|🥛 milk|🍷 wine|🍺 beer|🥂 cheers toast celebrate|🍸 cocktail|🧂 salt|🥄 spoon|🍽️ dinner plate meal|🛒 groceries shopping cart`],
  ['Activity', '🎯', `🎯 target goal focus|🏆 trophy win|🥇 gold medal first|🏅 medal|🎖️ medal award|⚽ soccer football|🏀 basketball|🏈 football|⚾ baseball|🎾 tennis|🏐 volleyball|🏓 ping pong|🏸 badminton|⛳ golf|🥊 boxing|🥋 martial arts|🎿 ski|🏂 snowboard|⛸️ skate|🏋️ weights gym lift|🤸 gymnastics stretch|🧘‍♀️ yoga|🚣 rowing|🏄 surf|🎮 game video|🕹️ joystick game|🎲 dice board game|♟️ chess strategy|🧩 puzzle|🎨 art paint|🖌️ paintbrush|🎭 theatre|🎬 film movie|🎤 microphone sing|🎧 headphones music podcast|🎵 music note|🎶 music|🎹 piano|🎸 guitar|🥁 drums|🎻 violin|🎺 trumpet|📷 camera photo|📸 photo|🎟️ ticket event|🎪 circus|🎉 party celebrate|🎊 confetti|🎈 balloon|🎁 gift present|🪁 kite|🧶 yarn knit|🧵 sewing thread|🎳 bowling|🛹 skateboard|🚵 mountain bike`],
  ['Travel', '✈️', `✈️ plane flight travel trip|🚗 car drive|🚕 taxi|🚌 bus|🚆 train|🚇 metro subway|🚲 bicycle bike|🛴 scooter|🏍️ motorcycle|🚀 rocket launch|🛸 ufo|🚢 ship cruise|⛵ sailboat|🛶 canoe|🚁 helicopter|⛽ fuel gas|🚦 traffic light|🗺️ map|🧭 compass direction|🧳 luggage suitcase pack|🏕️ camping tent|🏖️ beach holiday|🏜️ desert|🏞️ national park|🏟️ stadium|🏛️ museum classical|🏠 home house|🏡 house garden|🏢 office building work|🏥 hospital|🏦 bank|🏨 hotel|🏪 store shop|🏫 school|🏰 castle|⛪ church|🗼 tower|🗽 statue liberty|🌉 bridge|🌃 night city|🌆 city sunset|🏙️ city skyline|🎡 ferris wheel|🎢 roller coaster|⛲ fountain|🛏️ bed hotel|🛎️ bell service|🗓️ calendar|🌐 globe internet|📍 pin location place|🏁 finish flag`],
  ['Objects', '💡', `💡 idea light bulb|📝 note memo write|📚 books reading library|📖 book read open|📓 notebook|📒 ledger|📔 notebook decorated|📕 book closed|🗒️ notepad|🗂️ folders dividers|📁 folder|📂 open folder|🗃️ card box archive|🗄️ file cabinet|📋 clipboard checklist|📌 pushpin pin|📎 paperclip attach|✂️ scissors cut|🖊️ pen|✏️ pencil|🖍️ crayon|📏 ruler|📐 triangle ruler|🔍 search magnify|🔎 search|🔒 lock private|🔓 unlock|🔑 key|🗝️ old key|🔨 hammer build|🛠️ tools fix|🔧 wrench|⚙️ gear settings|🧰 toolbox|🧲 magnet|🧪 test tube science|🔬 microscope research|🔭 telescope|💊 pill medicine|🩺 stethoscope health|🩹 bandage|🧴 lotion|🧼 soap clean|🧹 broom clean|🧺 basket laundry|🪣 bucket|🛁 bath|🚿 shower|🪑 chair|🛋️ couch sofa|🖼️ picture frame|🕯️ candle|💼 briefcase work|🎒 backpack school|👜 handbag|👟 shoe sneaker|👕 shirt clothes|👗 dress|🧥 coat|🕶️ sunglasses|⌚ watch time|📱 phone mobile|💻 laptop computer|🖥️ desktop computer|⌨️ keyboard|🖨️ printer|💾 save disk|💿 disc|📺 tv|📻 radio|🎙️ podcast mic|☎️ telephone|📞 call phone|📧 email|✉️ envelope letter|📨 incoming mail|📦 package box delivery|🏷️ label tag|💳 card payment|💰 money bag|💵 cash dollar|🪙 coin|🧾 receipt|📈 chart up growth|📉 chart down|📊 bar chart stats|🗳️ ballot vote|⏰ alarm clock|⏳ hourglass time|⌛ hourglass|🔔 bell notify|📣 megaphone announce|📢 loudspeaker|🔋 battery|🔌 plug|💎 gem diamond|💍 ring|🎀 ribbon|🪄 magic wand|🧸 teddy bear|🪞 mirror|🛍️ shopping bags`],
  ['Symbols', '⭐', `❤️ heart love red|🧡 orange heart|💛 yellow heart|💚 green heart|💙 blue heart|💜 purple heart|🖤 black heart|🤍 white heart|🤎 brown heart|💔 broken heart|💕 hearts|💖 sparkling heart|✅ check done yes|☑️ checkbox|✔️ check|❌ cross no|❎ cross box|⭕ circle|❗ exclamation important|❓ question|‼️ urgent|⚠️ warning|🚫 no forbidden|⛔ stop|🔴 red circle|🟠 orange circle|🟡 yellow circle|🟢 green circle|🔵 blue circle|🟣 purple circle|⚫ black circle|⚪ white circle|🟥 red square|🟧 orange square|🟨 yellow square|🟩 green square|🟦 blue square|🟪 purple square|⬛ black square|⬜ white square|🔶 diamond orange|🔷 diamond blue|➕ plus add|➖ minus|✳️ asterisk|❇️ sparkle|💯 hundred perfect|🔝 top|🆕 new|🆗 ok|🆒 cool|🆓 free|🔄 repeat cycle|🔁 repeat loop|🔀 shuffle|▶️ play|⏸️ pause|⏹️ stop|⏩ fast forward|⬆️ up|⬇️ down|⬅️ left|➡️ right|↩️ back return|💬 speech chat|💭 thought|🗯️ anger bubble|♻️ recycle|☮️ peace|☯️ yin yang balance|♾️ infinity|⚛️ atom science|🔆 bright|🎵 note|#️⃣ hash number|🔢 numbers|🔤 letters abc|ℹ️ info|🏳️ white flag|🏴 black flag|🚩 red flag|🎌 flags`],
];
const ALL = GROUPS.flatMap(([name, , list]) => list.split('|').map(s => { const [e, ...w] = s.trim().split(' '); return { e, w: w.join(' '), g: name }; }));
const RECENT_MAX = 16;
const recent = () => store.pref('recentEmoji', []);
const remember = e => store.setPref('recentEmoji', [e, ...recent().filter(x => x !== e)].slice(0, RECENT_MAX));

/** Opens the emoji picker under `anchor`; calls onPick(emoji). */
export function pickEmoji(anchor, onPick) {
  const choose = e => { remember(e); onPick(e); closePopovers(); };
  const btn = it => h('button', { class: 'emoji-opt', type: 'button', title: it.w.split(' ')[0] || '', 'aria-label': it.w.split(' ')[0] || it.e, onclick: () => choose(it.e) }, it.e);
  const body = h('div', { class: 'ep-body' });
  const search = h('input', { class: 'ep-search', type: 'search', placeholder: 'Search emoji', 'aria-label': 'Search emoji', autocomplete: 'off', spellcheck: false });
  const tabs = h('div', { class: 'ep-tabs', role: 'tablist' });
  const sections = {};
  const fill = () => {
    const q = search.value.trim().toLowerCase();
    if (q) {
      const hits = ALL.filter(it => it.w.split(' ').some(w => w.startsWith(q)) || it.w.includes(q));
      body.replaceChildren(hits.length ? h('div', { class: 'ep-grid' }, hits.slice(0, 120).map(btn)) : h('p', { class: 'ep-empty' }, 'No emoji for that word. Try another.'));
      tabs.hidden = true;
      return;
    }
    tabs.hidden = false;
    const r = recent().map(e => ALL.find(it => it.e === e) || { e, w: '' });
    const parts = [];
    if (r.length) parts.push(sections.Recent = h('section', { class: 'ep-sec' }, h('h5', {}, 'Recent'), h('div', { class: 'ep-grid' }, r.map(btn))));
    for (const [name] of GROUPS) parts.push(sections[name] = h('section', { class: 'ep-sec' }, h('h5', {}, name), h('div', { class: 'ep-grid' }, ALL.filter(it => it.g === name).map(btn))));
    body.replaceChildren(...parts);
  };
  const jump = name => { const s = sections[name]; if (s) body.scrollTo({ top: s.offsetTop - body.offsetTop, behavior: 'smooth' }); };
  tabs.append(...(recent().length ? [['Recent', '🕘']] : []).concat(GROUPS.map(([n, icon]) => [n, icon])).map(([n, ic]) => h('button', { class: 'ep-tab', type: 'button', title: n, 'aria-label': n, onclick: () => jump(n) }, ic)));
  search.addEventListener('input', fill);
  search.addEventListener('keydown', e => {
    e.stopPropagation();
    if (e.key === 'Enter') { const first = body.querySelector('.emoji-opt'); if (first) first.click(); }
  });
  fill();
  popover(anchor, h('div', { class: 'emoji-picker' }, search, tabs, body), { className: 'emoji-pop' });
  if (!matchMedia('(hover: none)').matches) setTimeout(() => search.focus(), 30);
}
