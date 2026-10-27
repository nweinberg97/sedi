# Home: the living, weather-aware sky

The Home background follows the real **time of day** and the real **weather**. It's one of the things the owner loves most about Sedi, so keep its feel when changing Home.

## What it does

**Time of day** (from the device clock):

| Sky | Hours | Look |
|---|---|---|
| `dawn` | 5–8am | soft blue → lavender → peach |
| `day` | 8am–5pm | Sedi's blue sky |
| `dusk` | 5–8pm | indigo → rose → warm orange |
| `night` | 8pm–5am | deep navy with stars |

**Weather** (from the Open-Meteo weather Home already fetches; nothing new is sent):

| Kind | Open-Meteo codes | Look |
|---|---|---|
| `clear` | 0 | warm sun glow in the top corner by day, a crescent moon at night, a low warm glow at dusk |
| `partly` | 1, 2 | the clear look plus a few soft clouds |
| `cloudy` | 3 | more clouds, a slightly greyer sky |
| `fog` | 45, 48 | slow bands of mist |
| `rain` | 51–67, 80–82 | fine, light rain at a slight angle, a cooler sky |
| `storm` | 95–99 | heavier rain, a darker sky, an occasional soft lightning flash |
| `snow` | 71–77, 85, 86 | small flakes drifting and swaying |

On clear or partly cloudy days, temperature nudges the tint: 26° or more warms it, 0° or below cools it. With no weather set (weather is opt-in), the sky shows `clear`.

## The feel to protect

- **Calm.** Effects are quiet and slow: few, soft clouds; fine, faint rain. Never busy or cartoonish.
- **The liquid-glass clock** (`.clock-glass`, a rounded rectangle) sits on top. The time itself (font, size, thin weight, small "am") must not change.
- **Glass on bright skies vs dark skies:**
  - **Dark skies** (`data-tone="dark"`): the glass is drawn with white light (rim, inner glow), which reads crisply against the dark.
  - **Bright skies** (`data-tone="light"`, day/dawn): white can't show against white, so the glass gets a *faint smoky tint* a touch darker than the sky. Its white rim and top highlight then read crisply, like at night. Don't add white haze on bright skies; it looks milky.
- Text, the top bar and the phone tab bar switch to light-on-dark whenever `data-tone="dark"`.

## How it works

- `js/home.js`, inside `tickClock()` (runs every second):
  - sets `body[data-sky]` (time of day)
  - sets `body[data-tone]` (`dark` at dusk, at night, or in a storm; otherwise `light`)
  - calls `setSky({ kind, sky, temp })` only when the sky or weather changes
  - `unmount()` calls `clearSky()`
- `js/skyfx.js` draws the weather on one full-screen `<canvas class="sky-fx">` behind the page (`z-index: -1`, no pointer events):
  - It runs only while Home is open and the tab is visible.
  - With "reduce motion" on, it draws one still frame.
  - `weatherKind(code)` maps Open-Meteo codes to the kinds above.
- `styles.css`:
  - "Home v2" block: the four sky gradients and stars, the dark-sky text and glass, the bright-sky smoky glass, the settle-in animation and the minute fade
  - "Home v3" block: the `.sky-fx` layer, and the same dark styles keyed on `data-tone="dark"`
- `sw.js`: `js/skyfx.js` is in the offline shell; bump `VERSION` when these files change.
- Preview hooks: setting `window.__sky = 'dusk'` or `window.__wx = 'rain'` pins a sky or weather (handy for screenshots); leave them unset in normal use.

## Rules for changes

- Ask the owner before changing the look; show changes in a sandbox preview first.
- Never push to `main` without the owner's explicit "merge it".
