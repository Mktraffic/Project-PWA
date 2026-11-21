// Service worker de CampusAlerta.
// Estrategias:
//  · App Shell, íconos, logos, fuentes, offline.html → Cache First (precaché versionado)
//  · /api/auth/*, /api/admin/uptc-news y toda escritura → Network Only
//  · /api/incidents, /api/news, /api/reports, /api/categories → Network First; sin red responde 503 {offline:true}
//    y el cliente usa su respaldo en IndexedDB
//  · Imágenes (noticias y evidencias) → Stale-While-Revalidate · tiles del mapa → SWR con límite de entradas
//  · Audio → SIN Cache API (problemas con peticiones Range): red, y offline desde el Blob en IndexedDB
import { openDB } from 'idb';

const VERSION = __VERSION__;
const PRECACHE = __PRECACHE__;
const SHELL_CACHE = `campusalerta-shell-${VERSION}`;
const IMAGE_CACHE = `campusalerta-img-${VERSION}`;
const TILE_CACHE = `campusalerta-tiles-${VERSION}`;
const KNOWN_CACHES = [SHELL_CACHE, IMAGE_CACHE, TILE_CACHE];
const MAX_TILES = 150;
const MAX_IMAGES = 120;

const DB_NAME = 'campusalerta-db';
const DB_VERSION = 3;

function getDb() {
  return openDB(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains('reports')) db.createObjectStore('reports', { keyPath: 'localId' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'localId' });
      if (!db.objectStoreNames.contains('news')) db.createObjectStore('news', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('incidents')) db.createObjectStore('incidents', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('session')) db.createObjectStore('session', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'clave' });
      if (!db.objectStoreNames.contains('notifications')) db.createObjectStore('notifications', { keyPath: 'id', autoIncrement: true });
    }
  });
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    await cache.addAll(PRECACHE);
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('campusalerta-') && !KNOWN_CACHES.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

const isAudio = (request, url) => request.destination === 'audio' || request.headers.has('range') || /\.(webm|ogg|oga|mp3|m4a|wav|aac)$/i.test(url.pathname);

async function trimCache(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request, cacheName = SHELL_CACHE) {
  const cached = await caches.match(request, { ignoreSearch: false });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(cacheName)).put(request, response.clone());
  return response;
}

async function networkFirstApi(request) {
  try {
    return await fetch(request);
  } catch {
    return new Response(JSON.stringify({ error: 'Sin conexión.', offline: true }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
}

async function staleWhileRevalidate(request, cacheName, max) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request).then((response) => {
    if (response.ok || response.type === 'opaque') { cache.put(request, response.clone()).then(() => trimCache(cacheName, max)); }
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET') return;

  if (url.origin === location.origin) {
    if (url.pathname === '/api/news/image') {
      event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, MAX_IMAGES));
      return;
    }
    if (url.pathname.startsWith('/api/auth/') || url.pathname.startsWith('/api/admin/uptc-news')) return;
    if (url.pathname.startsWith('/api/')) {
      if (/^\/api\/(incidents|news|reports|categories)/.test(url.pathname)) event.respondWith(networkFirstApi(request));
      return;
    }
    if (isAudio(request, url)) return;
    if (request.mode === 'navigate') {
      event.respondWith((async () => {
        try {
          return (await caches.match('/index.html')) || (await fetch(request));
        } catch {
          return (await caches.match('/offline.html')) || Response.error();
        }
      })());
      return;
    }
    if (request.destination === 'image' && url.pathname.startsWith('/uploads/')) {
      event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, MAX_IMAGES));
      return;
    }
    event.respondWith(cacheFirst(request).catch(() => caches.match('/offline.html')));
    return;
  }

  if (/tile\.openstreetmap\.org$/.test(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request, TILE_CACHE, MAX_TILES));
    return;
  }
  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, MAX_IMAGES));
  }
});

/* ---------- Background Sync (sync-reports) ---------- */
async function syncReportsFromSw() {
  const db = await getDb();
  const queue = (await db.getAll('outbox')).sort((a, b) => a.creadoEn - b.creadoEn);
  if (!queue.length) return;

  const sess = (await db.get('session', 'current'))?.valor;
  const token = sess?.token;
  if (!token) {
    await notifyClients({ type: 'sync-auth-required' });
    return;
  }

  let enviados = 0;
  let authExpired = false;
  for (const item of queue) {
    const record = await db.get('reports', item.localId);
    if (!record) { await db.delete('outbox', item.localId); continue; }

    const fd = new FormData();
    fd.append('titulo', record.titulo);
    fd.append('categoria', record.categoria);
    if (record.descripcion) fd.append('descripcion', record.descripcion);
    if (record.referencia) fd.append('referencia', record.referencia);
    if (record.lat != null && record.lng != null) {
      fd.append('lat', String(record.lat));
      fd.append('lng', String(record.lng));
    }
    fd.append('clientId', record.localId);
    (record.fotos || []).forEach((blob, i) => fd.append('fotos', blob, `evidencia-${i + 1}.jpg`));
    if (record.audio) fd.append('audio', record.audio, 'descripcion.webm');

    try {
      const res = await fetch('/api/reports', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd
      });
      if (res.status === 401) { authExpired = true; break; }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const body = await res.json();
      await db.put('reports', {
        ...record,
        serverId: body.id,
        aprobacion: body.aprobacion,
        estado: body.estado,
        synced: true,
        media: body.media
      });
      await db.delete('outbox', item.localId);
      enviados++;
    } catch {
      await db.put('outbox', { ...item, intentos: (item.intentos || 0) + 1 });
    }
  }

  if (enviados > 0) {
    const msg = enviados === 1 ? '1 reporte enviado.' : `${enviados} reportes enviados.`;
    await self.registration.showNotification('CampusAlerta · Sincronización', {
      body: msg,
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: '/?seccion=reportes' }
    });
    await notifyClients({ type: 'sync-reports-done', enviados });
  }
  if (authExpired) {
    await self.registration.showNotification('CampusAlerta · Sesión expirada', {
      body: 'Tu sesión expiró. Abre la app e inicia sesión para enviar tus reportes pendientes.',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { url: '/ingresar' }
    });
    await notifyClients({ type: 'sync-auth-required' });
  }
}

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  clients.forEach((c) => c.postMessage(message));
}

self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-reports') event.waitUntil(syncReportsFromSw());
});

/* ---------- Push + bandeja local en IndexedDB ---------- */
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil((async () => {
    try {
      const db = await getDb();
      await db.add('notifications', {
        title: data.title || 'CampusAlerta',
        body: data.body || '',
        url: data.url || '/',
        tipo: data.tipo || 'general',
        urgente: Boolean(data.urgente),
        leida: false,
        fecha: Date.now()
      });
      await notifyClients({ type: 'push-received', data });
    } catch { /* no bloquear la notificación */ }
    await self.registration.showNotification(data.title || 'CampusAlerta', {
      body: data.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      tag: data.tag,
      data: { url: data.url || '/' }
    });
  })());
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if ('focus' in client) { await client.focus(); client.postMessage({ type: 'navigate', url: target }); return; }
    }
    await self.clients.openWindow(target);
  })());
});
