// Cola offline (outbox) y sincronización de reportes.
// El service worker ejecuta la sincronización cuando hay Background Sync (tag: 'sync-reports');
// en navegadores sin Background Sync o cuando vuelve la conexión, la página dispara la misma lógica.
import { all, del, get, put } from './db.js';
import { authHeader, isExpired, session } from './auth.js';
import { toast } from './ui.js';

let syncing = false;

/** Muestra una notificación local (via Service Worker si está disponible, o Notification API). */
export async function showLocalNotification(title, body, url = '/?seccion=reportes') {
  try {
    if (!('Notification' in window) || Notification.permission !== 'granted') return;
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(title, { body, icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', data: { url } });
      return;
    }
    new Notification(title, { body, icon: '/icons/icon-192.png' });
  } catch { /* sin permiso o no soportado */ }
}

/** Guarda un reporte en IndexedDB (reports + outbox) y registra Background Sync. */
export async function enqueueReport(reportData) {
  const localId = crypto.randomUUID();
  const now = Date.now();
  const record = {
    localId,
    serverId: null,
    titulo: reportData.titulo,
    categoria: reportData.categoria,
    descripcion: reportData.descripcion || '',
    lat: reportData.lat ?? null,
    lng: reportData.lng ?? null,
    referencia: reportData.referencia || '',
    fotos: reportData.fotos || [], // Blob[]
    audio: reportData.audio || null, // Blob|null
    aprobacion: 'por_revisar',
    motivoRechazo: null,
    estado: 'pendiente',
    motivoImpedimento: null,
    solucionTexto: null,
    synced: false,
    creadoEn: now
  };
  await put('reports', record);
  await put('outbox', { localId, intentos: 0, creadoEn: now });
  return record;
}

export function buildReportFormData(record) {
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
  return fd;
}

/** Envía un solo reporte al servidor y actualiza IndexedDB si responde OK. */
export async function sendReportRecord(record) {
  const res = await fetch('/api/reports', {
    method: 'POST',
    headers: { ...authHeader() },
    body: buildReportFormData(record)
  });
  if (res.status === 401) throw Object.assign(new Error('Sesión expirada.'), { status: 401 });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || 'No se pudo enviar el reporte.'), { status: res.status });
  await put('reports', {
    ...record,
    serverId: body.id,
    aprobacion: body.aprobacion,
    estado: body.estado,
    synced: true,
    media: body.media
  });
  await del('outbox', record.localId);
  return body;
}

/** Registra sync-reports en el SW o sincroniza inmediatamente si no hay Background Sync. */
export async function requestBackgroundSync() {
  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      if ('sync' in reg) { await reg.sync.register('sync-reports'); return true; }
    }
  } catch { /* fallback al evento online */ }
  return false;
}

/** Procesa la cola outbox en orden cronológico. Devuelve { enviados, authExpired, pendientes }. */
export async function syncOutbox({ silent = false } = {}) {
  if (syncing || !navigator.onLine) return { enviados: 0, authExpired: false, pendientes: (await all('outbox')).length };
  const queue = (await all('outbox')).sort((a, b) => a.creadoEn - b.creadoEn);
  if (!queue.length) return { enviados: 0, authExpired: false, pendientes: 0 };

  if (!session()?.token || isExpired()) {
    if (!silent) toast('Tienes reportes pendientes. Inicia sesión para sincronizarlos.');
    return { enviados: 0, authExpired: true, pendientes: queue.length };
  }

  syncing = true;
  let enviados = 0;
  let authExpired = false;
  try {
    for (const item of queue) {
      const record = await get('reports', item.localId);
      if (!record) { await del('outbox', item.localId); continue; }
      try {
        await sendReportRecord(record);
        enviados++;
      } catch (err) {
        if (err.status === 401) { authExpired = true; break; }
        await put('outbox', { ...item, intentos: (item.intentos || 0) + 1 });
      }
    }
    if (enviados > 0) {
      const msg = enviados === 1 ? '1 reporte enviado.' : `${enviados} reportes enviados.`;
      toast(msg);
      await showLocalNotification('CampusAlerta · Sincronización', msg, '/?seccion=reportes');
      dispatchEvent(new CustomEvent('reports:synced', { detail: { enviados } }));
    }
    if (authExpired && !silent) toast('Tu sesión expiró; inicia sesión para enviar los reportes pendientes.');
  } finally {
    syncing = false;
  }
  return { enviados, authExpired, pendientes: (await all('outbox')).length };
}
