// The old /beta/ preview is gone. Anyone who still has its offline copy gets this worker once:
// it clears that copy, removes itself and sends the page to the main app.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('sedi-beta')).map(k => caches.delete(k)));
    await self.registration.unregister();
    const clients = await self.clients.matchAll({ type: 'window' });
    clients.forEach(c => c.navigate(new URL('../', self.registration.scope).href).catch(() => {}));
  })());
});
