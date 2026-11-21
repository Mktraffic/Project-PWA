import webpush from 'web-push';
import db from '../db/sqlite.js';
import { config } from '../config.js';
import { ESTADO_LABEL } from '../../shared/constants.js';

if (config.vapid.publicKey && config.vapid.privateKey) {
  webpush.setVapidDetails(config.vapid.subject, config.vapid.publicKey, config.vapid.privateKey);
}

// Remitente reemplazable (tests): por defecto web-push real.
let sender = (subscription, payload) => webpush.sendNotification(subscription, payload, { TTL: 60 * 60 * 24 });
export function setSender(fn) { sender = fn; }

const toWebPush = (row) => ({ endpoint: row.endpoint, keys: JSON.parse(row.keysJson) });

/** Envía el payload a cada suscripción (sin duplicar endpoints). Si el servicio responde 404/410 la elimina. */
export async function deliver(rows, payload) {
  const unique = [...new Map(rows.map((r) => [r.endpoint, r])).values()];
  const body = JSON.stringify(payload);
  const result = { enviados: 0, eliminados: 0, fallidos: 0, endpoints: [] };
  await Promise.all(unique.map(async (row) => {
    try {
      await sender(toWebPush(row), body);
      result.enviados++; result.endpoints.push(row.endpoint);
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        db.prepare('DELETE FROM subscriptions WHERE id = ?').run(row.id);
        result.eliminados++;
      } else { result.fallidos++; console.warn('push falló:', error.statusCode || error.message); }
    }
  }));
  return result;
}

/** Noticia nueva: SOLO a suscripciones activas de usuarios con sesión suscritos a alguna de sus categorías. */
export async function notifyNews(news, categoryIds) {
  const wanted = new Set(categoryIds.map(Number));
  const rows = db.prepare('SELECT * FROM subscriptions WHERE activo = 1 AND userId IS NOT NULL').all()
    .filter((r) => JSON.parse(r.categoriasJson).some((id) => wanted.has(Number(id))));
  return deliver(rows, {
    title: `${news.urgente ? '⚠ URGENTE: ' : ''}${news.titulo}`,
    body: news.resumen || 'Nueva noticia en CampusAlerta',
    url: `/noticias/${news.id}`,
    tag: `news-${news.id}`,
    tipo: 'noticia', urgente: Boolean(news.urgente), refId: news.id
  });
}

/** Cambio en un reporte: SOLO al autor (todas sus suscripciones vinculadas). */
export async function notifyReportAuthor(report, { evento, detalle = '' }) {
  const rows = db.prepare('SELECT * FROM subscriptions WHERE activo = 1 AND userId = ?').all(report.userId);
  const textos = {
    aprobado: 'Aprobado: tu reporte ahora es un incidente público.',
    rechazado: `Desaprobado${detalle ? `: ${detalle}` : '.'}`,
    en_proceso: 'Nuevo estado: En proceso.',
    finalizada: `Nuevo estado: Finalizada${detalle ? `. ${detalle}` : '.'}`,
    impedimento: `Nuevo estado: Impedimento${detalle ? `: ${detalle}` : '.'}`,
    pendiente: `Nuevo estado: ${ESTADO_LABEL.pendiente}.`
  };
  return deliver(rows, {
    title: `Reporte: ${report.titulo}`,
    body: textos[evento] || `Nuevo estado: ${evento}`,
    url: `/reportes/${report.id}`,
    tag: `report-${report.id}`,
    tipo: 'reporte', refId: report.id, evento
  });
}
