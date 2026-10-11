// Sedi — Navoro install: in-app guidance that answers "how do I…?" from docs/help-center.md
// and points at the real control. Read-only: it never acts on Sedi for you.
//
// Sedi renders its own Help button in the header (see buildHeader in shell.js); Navoro's
// floating launcher is turned off and its panel opens under the header, top right.
//
// Where the SDK comes from:
//   - on localhost / 127.0.0.1 → a local Navoro at http://localhost:4400 (development environment)
//   - anywhere else (e.g. GitHub Pages) → OFF. Sedi promises "no server"; turning Navoro on for the
//     published site means questions go to whichever server hosts Navoro. Opt in deliberately by
//     setting productionOrigin below, or per device:
//     localStorage.setItem('sedi.navoro', JSON.stringify({ origin: 'https://…', key: 'nav_pk_…' }))
// Add ?navoro=off to the URL to disable it for one visit.

const DEFAULTS = {
  localOrigin: 'http://localhost:4400',
  // Public key registered in the Navoro dashboard (an identifier, not a secret). The seeded
  // Navoro demo workspace already includes Sedi under this key.
  key: 'nav_pk_demo_sedi_dev',
  productionOrigin: '',
};
// Header height (--header-h in styles.css) + a small gap, so the panel sits just under the header.
const PANEL_OFFSET = 64;

function config() {
  const params = new URLSearchParams(location.search);
  if (params.get('navoro') === 'off') return null;
  let stored = null;
  try { stored = JSON.parse(localStorage.getItem('sedi.navoro') || 'null'); } catch { stored = null; }
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const origin = stored?.origin || (local ? DEFAULTS.localOrigin : DEFAULTS.productionOrigin);
  if (!origin) return null;
  return {
    origin: origin.replace(/\/$/, ''),
    key: stored?.key || DEFAULTS.key,
    env: stored?.env || (local ? 'development' : 'production'),
  };
}

function setExpanded(open) {
  document.querySelector('.help-btn')?.setAttribute('aria-expanded', String(open));
}

/** Opens or closes the guide. Called by the header's Help button. */
export function toggleHelp() {
  const nav = window.Navoro;
  if (!nav) return;
  if (nav.isOpen()) nav.close();
  else nav.open();
}

const cfg = config();
if (cfg) {
  const script = document.createElement('script');
  script.src = `${cfg.origin}/sdk/v1/navoro.js`;
  script.defer = true;
  script.dataset.navoroAuto = 'false'; // we initialise it below with Sedi's own launcher
  script.onload = async () => {
    const nav = window.Navoro;
    if (!nav) return;
    try {
      await nav.init({
        publicKey: cfg.key,
        environment: cfg.env,
        apiOrigin: cfg.origin,
        launcher: 'hidden',
        panelPosition: 'top-right',
        panelOffset: PANEL_OFFSET,
      });
    } catch {
      return;
    }
    // Navoro renders nothing when this origin isn't registered; only show Help if it's really there.
    if (!document.querySelector('navoro-root')) return;
    document.documentElement.classList.add('navoro-ready');
    nav.on('panel', setExpanded);
  };
  // Quietly skip when the Navoro server isn't running; Sedi works fully without it.
  script.onerror = () => console.info(`[Sedi] Navoro guidance unavailable (no server at ${cfg.origin}).`);
  document.head.append(script);
}
