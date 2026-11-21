// IndexedDB (librería idb). Compartido por la página y el service worker.
import { openDB } from 'idb';

export const DB_NAME = 'campusalerta-db';
export const DB_VERSION = 3; // v3: modelo aprobacion/estado, audio/fotos Blob, incidents, session, notifications

let dbPromise;

export function getDb() {
  dbPromise ??= openDB(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion, _newVersion, tx) {
      // Los esquemas anteriores (v1/v2) guardaban otro modelo de reporte: se recrean los stores de datos.
      if (oldVersion > 0 && oldVersion < 3) {
        for (const name of ['reports', 'outbox', 'news', 'incidents']) {
          if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
        }
      }
      const ensure = (name, options) => (db.objectStoreNames.contains(name) ? tx.objectStore(name) : db.createObjectStore(name, options));

      const reports = ensure('reports', { keyPath: 'localId' }); // { localId, serverId, titulo, descripcion, categoria, lat, lng, referencia, fotos: Blob[], audio: Blob|null, aprobacion, estado, synced, creadoEn }
      if (!reports.indexNames.contains('synced')) reports.createIndex('synced', 'synced');
      if (!reports.indexNames.contains('estado')) reports.createIndex('estado', 'estado');
      if (!reports.indexNames.contains('serverId')) reports.createIndex('serverId', 'serverId');

      const outbox = ensure('outbox', { keyPath: 'localId' }); // { localId, intentos, creadoEn }
      if (!outbox.indexNames.contains('creadoEn')) outbox.createIndex('creadoEn', 'creadoEn');

      const news = ensure('news', { keyPath: 'id' });
      if (!news.indexNames.contains('fecha')) news.createIndex('fecha', 'fecha');
      if (!news.indexNames.contains('categorias')) news.createIndex('categorias', 'categorias', { multiEntry: true });

      ensure('incidents', { keyPath: 'id' }); // caché de incidentes públicos
      ensure('session', { keyPath: 'clave' }); // { clave:'current', valor:{ token, user } }
      ensure('settings', { keyPath: 'clave' }); // categoriasSuscritas, pushActivo, ultimaSync
      const notifs = ensure('notifications', { keyPath: 'id', autoIncrement: true }); // bandeja (opcional)
      if (!notifs.indexNames.contains('fecha')) notifs.createIndex('fecha', 'fecha');
    }
  });
  return dbPromise;
}

export async function get(store, key) { return (await getDb()).get(store, key); }
export async function put(store, value) { return (await getDb()).put(store, value); }
export async function del(store, key) { return (await getDb()).delete(store, key); }
export async function all(store) { return (await getDb()).getAll(store); }
export async function clear(store) { return (await getDb()).clear(store); }

export async function getSetting(clave, fallback = null) {
  const row = await get('settings', clave);
  return row ? row.valor : fallback;
}
export async function setSetting(clave, valor) { return put('settings', { clave, valor }); }
