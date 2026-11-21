import { Router } from 'express';
import db from '../db/sqlite.js';
import { requireAdmin } from '../middleware/admin.js';
import { fieldError } from '../services/auth.js';
import { applyEstado, audit, serializeReport, validateEstadoUpdate } from '../services/reports.js';
import { reportUpload, validateFiles } from '../services/uploads.js';
import { fetchArticleContent, fetchUptcNews, isAllowedUrl, ScrapeError } from '../services/scraper.js';
import { notifyNews, notifyReportAuthor } from '../services/push.js';
import { serializeNews } from './news.js';
import { MOTIVO_MAX } from '../../shared/constants.js';

const router = Router();
router.use(requireAdmin); // TODAS las rutas admin validan JWT + rol en el servidor

/* ------------------------------ Noticias ------------------------------ */

router.get('/uptc-news', async (req, res, next) => {
  try {
    const raw = req.query.limit === undefined ? 5 : Number(req.query.limit);
    if (!Number.isInteger(raw) || raw < 1 || raw > 20) throw fieldError('La cantidad debe ser un número entero entre 1 y 20.', { limit: 'Debe estar entre 1 y 20.' }, 422);
    const { items, cached, aviso } = await fetchUptcNews(raw);
    const published = new Map(db.prepare('SELECT fuenteUrl, id, publicada FROM news').all().map((n) => [n.fuenteUrl, n]));
    res.json({ items: items.map((i) => ({ ...i, publicadaId: published.get(i.fuenteUrl)?.publicada ? published.get(i.fuenteUrl).id : null })), cached, aviso });
  } catch (e) { next(e instanceof ScrapeError ? Object.assign(e, { status: e.status }) : e); }
});

router.get('/news', (_req, res) => {
  res.json(db.prepare('SELECT * FROM news WHERE publicada = 1 ORDER BY fecha DESC, id DESC').all().map(serializeNews));
});

// Publicar: { fuenteUrl, titulo, resumen, fecha, imagenUrl, categorias:[ids], urgente }
router.post('/news', async (req, res, next) => {
  try {
    const b = req.body || {};
    const errors = {};
    const titulo = String(b.titulo ?? '').trim();
    const fuenteUrl = String(b.fuenteUrl ?? '').trim();
    if (!titulo) errors.titulo = 'El título es obligatorio.';
    if (!isAllowedUrl(fuenteUrl)) errors.fuenteUrl = 'La URL de origen debe ser de uptc.edu.co (HTTPS).';
    const wanted = [...new Set((Array.isArray(b.categorias) ? b.categorias : []).map(Number).filter(Number.isInteger))];
    const valid = new Set(db.prepare('SELECT id FROM categories').all().map((c) => c.id));
    const categorias = wanted.filter((id) => valid.has(id));
    if (!categorias.length) errors.categorias = 'Asigna al menos una categoría.';
    const imagenUrl = b.imagenUrl && isAllowedUrl(String(b.imagenUrl)) ? String(b.imagenUrl) : null;
    if (Object.keys(errors).length) throw fieldError('Revisa los campos marcados.', errors, 422);

    const prev = db.prepare('SELECT * FROM news WHERE fuenteUrl = ?').get(fuenteUrl);
    if (prev?.publicada) throw fieldError('Esta noticia ya está publicada.', { fuenteUrl: 'Ya publicada.' }, 409);

    const resumen = String(b.resumen ?? '').trim();
    const contenido = String(b.contenido ?? '').trim() || (await fetchArticleContent(fuenteUrl)) || resumen;
    const fecha = /^\d{4}-\d{2}-\d{2}$/.test(String(b.fecha)) ? b.fecha : new Date().toISOString().slice(0, 10);
    const urgente = b.urgente ? 1 : 0;
    const now = Date.now();

    const id = db.transaction(() => {
      let newsId;
      if (prev) {
        newsId = prev.id;
        db.prepare('UPDATE news SET titulo=?,resumen=?,contenido=?,urgente=?,fecha=?,imagenUrl=?,publicada=1 WHERE id=?').run(titulo, resumen, contenido, urgente, fecha, imagenUrl, newsId);
        db.prepare('DELETE FROM news_categories WHERE newsId = ?').run(newsId);
      } else {
        newsId = Number(db.prepare('INSERT INTO news (titulo,resumen,contenido,urgente,fecha,fuenteUrl,imagenUrl,publicada,creadoEn) VALUES (?,?,?,?,?,?,?,1,?)')
          .run(titulo, resumen, contenido, urgente, fecha, fuenteUrl, imagenUrl, now).lastInsertRowid);
      }
      const link = db.prepare('INSERT INTO news_categories (newsId, categoryId) VALUES (?,?)');
      for (const c of categorias) link.run(newsId, c);
      return newsId;
    })();
    audit(req.user.id, 'publicar', 'noticia', id);
    const news = serializeNews(db.prepare('SELECT * FROM news WHERE id = ?').get(id));
    const push = await notifyNews(news, categorias).catch((e) => ({ error: e.message }));
    res.status(201).json({ news, push });
  } catch (e) { next(e); }
});

// Despublicar
router.delete('/news/:id', (req, res) => {
  const info = db.prepare('UPDATE news SET publicada = 0 WHERE id = ? AND publicada = 1').run(req.params.id);
  if (!info.changes) return res.status(404).json({ error: 'Noticia no encontrada o ya despublicada.' });
  audit(req.user.id, 'despublicar', 'noticia', Number(req.params.id));
  res.sendStatus(204);
});

/* ------------------------------ Reportes ------------------------------ */

router.get('/reports', (req, res) => {
  const where = [];
  const args = [];
  const eliminados = req.query.eliminados === 'true';
  where.push(eliminados ? 'activo = 0' : 'activo = 1');
  for (const [key, col] of [['estado', 'estado'], ['categoria', 'categoria'], ['aprobacion', 'aprobacion']]) {
    if (req.query[key]) { where.push(`${col} = ?`); args.push(String(req.query[key])); }
  }
  const day = (s) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s)) ? new Date(`${s}T00:00:00`).getTime() : null);
  const desde = day(req.query.desde), hasta = day(req.query.hasta);
  if (desde) { where.push('creadoEn >= ?'); args.push(desde); }
  if (hasta) { where.push('creadoEn < ?'); args.push(hasta + 86400000); }
  const rows = db.prepare(`SELECT * FROM reports WHERE ${where.join(' AND ')} ORDER BY creadoEn DESC`).all(...args);
  res.json(rows.map((r) => serializeReport(r, { withAuthor: true })));
});

const findReport = (id) => db.prepare('SELECT * FROM reports WHERE id = ?').get(id);

// Aprobar / Desaprobar
router.patch('/reports/:id/aprobacion', async (req, res, next) => {
  try {
    const report = findReport(req.params.id);
    if (!report || !report.activo) return res.status(404).json({ error: 'Reporte no encontrado.' });
    const aprobacion = String(req.body?.aprobacion ?? '');
    if (!['aprobado', 'rechazado'].includes(aprobacion)) throw fieldError('Indica aprobado o rechazado.', { aprobacion: 'Valor inválido.' }, 422);
    const motivo = String(req.body?.motivoRechazo ?? '').trim();
    if (aprobacion === 'rechazado' && !motivo) throw fieldError('Las observaciones de rechazo son obligatorias.', { motivoRechazo: 'Escribe las observaciones del rechazo.' }, 422);
    if (motivo.length > MOTIVO_MAX) throw fieldError(`Máximo ${MOTIVO_MAX} caracteres.`, { motivoRechazo: `Máximo ${MOTIVO_MAX} caracteres (texto corto).` }, 422);
    db.prepare('UPDATE reports SET aprobacion = ?, motivoRechazo = ?, actualizadoEn = ? WHERE id = ?')
      .run(aprobacion, aprobacion === 'rechazado' ? motivo || null : null, Date.now(), report.id);
    audit(req.user.id, aprobacion === 'aprobado' ? 'aprobar' : 'desaprobar', 'reporte', report.id);
    const updated = findReport(report.id);
    const push = await notifyReportAuthor(updated, { evento: aprobacion, detalle: motivo }).catch((e) => ({ error: e.message }));
    res.json({ report: serializeReport(updated, { withAuthor: true }), push });
  } catch (e) { next(e); }
});

// Actualizar estado (multipart por la solución en audio/imágenes)
router.patch('/reports/:id/estado', reportUpload, async (req, res, next) => {
  try {
    const report = findReport(req.params.id);
    if (!report || !report.activo) return res.status(404).json({ error: 'Reporte no encontrado.' });
    if (report.aprobacion !== 'aprobado') throw fieldError('Solo se puede actualizar el estado de reportes aprobados.', { estado: 'Primero aprueba el reporte.' }, 409);
    const files = validateFiles(req.files, { minPhotos: req.body?.estado === 'finalizada' ? 1 : 0 });
    const data = validateEstadoUpdate(req.body || {}, files);
    applyEstado(report.id, data, files);
    audit(req.user.id, `estado:${data.estado}`, 'reporte', report.id);
    const updated = findReport(report.id);
    const detalle = data.estado === 'impedimento' ? data.motivo : data.estado === 'finalizada' ? data.solucionTexto.slice(0, 120) : '';
    const push = await notifyReportAuthor(updated, { evento: data.estado, detalle }).catch((e) => ({ error: e.message }));
    res.json({ report: serializeReport(updated, { withAuthor: true }), push });
  } catch (e) { next(e); }
});

// Eliminar (borrado lógico): SOLO aprobado + finalizada
router.delete('/reports/:id', (req, res, next) => {
  try {
    const report = findReport(req.params.id);
    if (!report || !report.activo) return res.status(404).json({ error: 'Reporte no encontrado.' });
    if (report.aprobacion !== 'aprobado' || report.estado !== 'finalizada') {
      throw fieldError('Solo se pueden eliminar reportes aprobados y en estado finalizada.', {}, 409);
    }
    db.prepare('UPDATE reports SET activo = 0, eliminadoEn = ?, actualizadoEn = ? WHERE id = ?').run(Date.now(), Date.now(), report.id);
    audit(req.user.id, 'eliminar', 'reporte', report.id);
    res.sendStatus(204);
  } catch (e) { next(e); }
});

router.get('/audit', (_req, res) => res.json(db.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 100').all()));

export default router;
