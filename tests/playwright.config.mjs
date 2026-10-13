// Playwright config for Sedi's smoke tests. Run from this folder:
//   npm install && npx playwright install chromium   (first time only)
//   npx playwright test
// Screenshots land in tests/screenshots/<SEDI_SHOTS or "current">/ so phases can be compared.

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.SEDI_PORT || 8123);

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.mjs$/,
  timeout: 60_000,
  expect: { timeout: 5_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 900 },
    // Service workers would cache across tests; every test starts from a clean profile anyway.
    serviceWorkers: 'block',
    acceptDownloads: true,
    trace: 'retain-on-failure',
  },
  webServer: {
    command: `python3 -m http.server ${PORT} --directory ..`,
    url: `http://localhost:${PORT}/index.html`,
    reuseExistingServer: true,
    timeout: 20_000,
    stdout: 'ignore',
    stderr: 'ignore',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
