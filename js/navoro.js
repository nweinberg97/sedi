// Sedi — Navoro install: in-app guidance that answers "how do I…?" from docs/help-center.md
// and points at the real control. Read-only: it never acts on Sedi for you.
//
// The SDK is loaded from a Navoro server. Defaults:
//   - on localhost / 127.0.0.1 → a local Navoro at http://localhost:4400 (development environment)
//   - anywhere else (e.g. GitHub Pages) → off until you host Navoro and set the origin below,
//     or store it on the device: localStorage.setItem('sedi.navoro', JSON.stringify({ origin: 'https://…', key: 'nav_pk_…' }))
// Add ?navoro=off to the URL to disable it for one visit.

const DEFAULTS = {
  localOrigin: 'http://localhost:4400',
  // Public key registered in the Navoro dashboard (an identifier, not a secret). The seeded
  // Navoro demo workspace already includes Sedi under this key.
  key: 'nav_pk_demo_sedi_dev',
  // Set to your hosted Navoro origin to enable guidance on the published site.
  productionOrigin: '',
};

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

const cfg = config();
if (cfg) {
  const script = document.createElement('script');
  script.src = `${cfg.origin}/sdk/v1/navoro.js`;
  script.defer = true;
  script.dataset.navoroKey = cfg.key;
  script.dataset.navoroEnv = cfg.env;
  // Quietly skip when the Navoro server isn't running; Sedi works fully without it.
  script.onerror = () => console.info(`[Sedi] Navoro guidance unavailable (no server at ${cfg.origin}).`);
  document.head.append(script);
}
