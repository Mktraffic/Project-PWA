import db from '../db/sqlite.js';
import { fieldError } from './auth.js';
import { saveFile } from './uploads.js';
import { DESC_MAX, ESTADOS, MOTIVO_MAX, REPORT_CATEGORIES, TITLE_MAX } from '../../shared/constants.js';

const mediaOf = (reportId) => db.prepare('SELECT * FROM report_media WHERE reportId = ? ORDER BY id').all(reportId);

function shapeMedia(rows) {
  const pick = (tipo, rol) => rows.filter((m) => m.tipo === tipo && m.rol === rol).map((m) => m.ruta);
  return {
    imagenes: pick('imagen', 'descripcion'),
    audio: pick('audio', 'descripcion')[0] || null,
    solucionImagenes: pick('imagen', 'solucion'),
    solucionAudio: pick('audio', 'solucion')[0] || null
  };
}

/** Reporte completo (autor/admin). */
export function serializeReport(row, { withAuthor = false } = {}) {
  if (!row) return null;
  const out = { ...row, activo: Boolean(row.activo), media: shapeMedia(mediaOf(row.id)) };
  if (withAuthor) {
    const u = db.prepare('SELECT nombre, correo, codigo FROM users WHERE id = ?').get(row.userId);
    out.autor = u || null;
  }
  return out;
}

/** Incidente público: sin datos del autor ni observaciones internas. */
export function serializeIncident(row) {
  const { id, titulo, descripcion, categoria, lat, lng, referencia, estado, motivoImpedimento, solucionTexto, creadoEn, actualizadoEn } = row;
  return { id, titulo, descripcion, categoria, lat, lng, referencia, estado, motivoImpedimento, solucionTexto, creadoEn, actualizadoEn, media: shapeMedia(mediaOf(id)) };
}

const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export function validateNewReport(body, files) {
  const errors = {};
  const titulo = String(body.titulo ?? '').trim();
  const categoria = String(body.categoria ?? '').trim();
  const descripcion = String(body.descripcion ?? '').trim();
  const referencia = String(body.referencia ?? '').trim();
  const lat = num(body.lat), lng = num(body.lng);
  if (!titulo) errors.titulo = 'El nombre del incidente es obligatorio.';
  else if (titulo.length > TITLE_MAX) errors.titulo = `Máximo ${TITLE_MAX} caracteres.`;
  if (!REPORT_CATEGORIES.includes(categoria)) errors.categoria = 'Selecciona una categoría válida.';
  if (!descripcion && !files.audio) errors.descripcion = 'Describe el incidente con texto o con un audio.';
  if (descripcion.length > DESC_MAX) errors.descripcion = `Máximo ${DESC_MAX} caracteres.`;
  if ((lat === null) !== (lng === null)) errors.ubicacion = 'La ubicación debe incluir latitud y longitud.';
  else if (lat !== null && (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180)) errors.ubicacion = 'Coordenadas inválidas.';
  if (referencia.length > 200) errors.referencia = 'Máximo 200 caracteres.';
  if (Object.keys(errors).length) throw fieldError('Revisa los campos marcados.', errors, 422);
  return { titulo, categoria, descripcion: descripcion || null, referencia: referencia || null, lat, lng };
}

export function createReport(userId, body, { photos, audio }) {
  const data = validateNewReport(body, { audio });
  const clientId = body.clientId ? String(body.clientId).slice(0, 64) : null;
  if (clientId) { // idempotencia: reintentos de la cola offline no duplican
    const prev = db.prepare('SELECT * FROM reports WHERE userId = ? AND clientId = ?').get(userId, clientId);
    if (prev) return { report: serializeReport(prev), duplicate: true };
  }
  const now = Date.now();
  const tx = db.transaction(() => {
    const info = db.prepare(`INSERT INTO reports (userId,titulo,descripcion,categoria,lat,lng,referencia,creadoEn,actualizadoEn,clientId)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(userId, data.titulo, data.descripcion, data.categoria, data.lat, data.lng, data.referencia, now, now, clientId);
    const id = Number(info.lastInsertRowid);
    const insertMedia = db.prepare('INSERT INTO report_media (reportId,tipo,rol,ruta,mime,creadoEn) VALUES (?,?,?,?,?,?)');
    for (const f of photos) { const s = saveFile(f); insertMedia.run(id, 'imagen', 'descripcion', s.ruta, s.mime, now); }
    if (audio) { const s = saveFile(audio); insertMedia.run(id, 'audio', 'descripcion', s.ruta, s.mime, now); }
    return id;
  });
  const id = tx();
  return { report: serializeReport(db.prepare('SELECT * FROM reports WHERE id = ?').get(id)), duplicate: false };
}

/** Datos de la actualización de estado (admin). Devuelve { estado, motivoImpedimento, solucionTexto, media? } */
export function validateEstadoUpdate(body, { photos, audio }) {
  const estado = String(body.estado ?? '');
  const errors = {};
  if (!ESTADOS.includes(estado)) errors.estado = 'Estado inválido.';
  const motivo = String(body.motivoImpedimento ?? '').trim();
  const solucionTexto = String(body.solucionTexto ?? '').trim();
  if (estado === 'impedimento' && motivo.length > MOTIVO_MAX) {
    errors.motivoImpedimento = `Máximo ${MOTIVO_MAX} caracteres (texto corto).`;
  }
  if (estado === 'finalizada') {
    if (!solucionTexto && !audio) errors.solucion = 'Describe la solución con texto o con un audio.';
    if (photos.length < 1) errors.fotos = 'Adjunta de 1 a 3 imágenes de evidencia de la solución.';
  }
  if (Object.keys(errors).length) throw fieldError('Revisa los campos marcados.', errors, 422);
  return { estado, motivo, solucionTexto };
}

export function applyEstado(id, data, { photos, audio }) {
  const now = Date.now();
  db.transaction(() => {
    db.prepare('UPDATE reports SET estado=?, motivoImpedimento=?, solucionTexto=?, actualizadoEn=? WHERE id=?')
      .run(data.estado, data.estado === 'impedimento' ? data.motivo : null, data.estado === 'finalizada' ? data.solucionTexto || null : null, now, id);
    // Reemplaza la solución anterior si se vuelve a finalizar o se cambia a otro estado
    db.prepare("DELETE FROM report_media WHERE reportId = ? AND rol = 'solucion'").run(id);
    if (data.estado === 'finalizada') {
      const ins = db.prepare('INSERT INTO report_media (reportId,tipo,rol,ruta,mime,creadoEn) VALUES (?,?,?,?,?,?)');
      for (const f of photos) { const s = saveFile(f); ins.run(id, 'imagen', 'solucion', s.ruta, s.mime, now); }
      if (audio) { const s = saveFile(audio); ins.run(id, 'audio', 'solucion', s.ruta, s.mime, now); }
    }
  })();
}

export function audit(adminId, accion, entidad, entidadId) {
  db.prepare('INSERT INTO audit_log (adminId,accion,entidad,entidadId,fecha) VALUES (?,?,?,?,?)').run(adminId, accion, entidad, entidadId ?? null, Date.now());
}
