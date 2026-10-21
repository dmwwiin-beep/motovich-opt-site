/* MOTOVICH PWA service worker: offline shell + Web Push notifications. */
'use strict';
const CACHE = 'motovich-shell-v15';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon.svg',
  './advanced.js',
  './pro.js',
  './cloud-sync.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE)
      .then(cache => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith('motovich-shell-') && key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).then(response => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put('./index.html', copy)).catch(() => {});
        }
        return response;
      }).catch(() => caches.match('./index.html').then(cached => cached || caches.match('./')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (response && response.ok && response.type === 'basic') {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy)).catch(() => {});
        }
        return response;
      });
    })
  );
});

self.addEventListener('push', event => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed
      : { body: parsed == null ? '' : String(parsed) };
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }

  event.waitUntil(self.registration.showNotification(
    String(data.title || 'MOTOVICH').slice(0, 80),
    {
      body: String(data.body || 'Пора заглянуть в свой план и сделать следующий шаг.').slice(0, 240),
      icon: './icon.svg',
      badge: './icon.svg',
      tag: String(data.tag || 'motovich-reminder').slice(0, 80),
      renotify: false,
      data: { url: safeAppPath(data.url) }
    }
  ));
});

function safeAppPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return './';
  return value;
}

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = safeAppPath(event.notification.data && event.notification.data.url);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clients => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target).catch(() => {});
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});
