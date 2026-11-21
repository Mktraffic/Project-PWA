import { Router } from 'express';
import db from '../db/sqlite.js';
import { serializeIncident } from '../services/reports.js';

const router = Router();
const visible = "aprobacion = 'aprobado' AND activo = 1";

// Públicas (sin sesión): solo reportes aprobados y no eliminados
router.get('/', (_req, res) => {
  res.json(db.prepare(`SELECT * FROM reports WHERE ${visible} ORDER BY creadoEn DESC`).all().map(serializeIncident));
});
router.get('/:id', (req, res) => {
  const row = db.prepare(`SELECT * FROM reports WHERE id = ? AND ${visible}`).get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Incidente no encontrado.' });
  res.json(serializeIncident(row));
});

export default router;
