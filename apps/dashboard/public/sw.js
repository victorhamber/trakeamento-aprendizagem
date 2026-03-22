/* global self, clients */

self.addEventListener('push', (event) => {
  let payload = { title: '💰 Venda recebida', body: 'Nova venda', data: {} };
  try {
    if (event.data) {
      const parsed = event.data.json();
      if (parsed && typeof parsed === 'object') payload = { ...payload, ...parsed };
    }
  } catch {
    try {
      const t = event.data?.text();
      if (t) payload.body = t;
    } catch {
      /* ignore */
    }
  }

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: '/fiveicon.png',
        badge: '/fiveicon.png',
        data: payload.data || {},
        vibrate: [120, 40, 120],
        tag: 'sale',
        renotify: true,
      });

      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        client.postMessage({ type: 'trajettu-sale', payload });
      }
    })()
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      const url = new URL('/', self.location.origin).href;
      for (const c of windowClients) {
        if (c.url.startsWith(self.location.origin) && 'focus' in c) {
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
    })
  );
});
