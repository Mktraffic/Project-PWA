import { Router } from 'express';
import db from '../db/sqlite.js';
import { requireUser } from '../middleware/user.js';
import { createReport, serializeReport } from '../services/reports.js';
import { reportUpload, validateFiles } from '../services/uploads.js';

const router = Router();

// Mis reportes (solo del usuario autenticado; los eliminados lógicamente no se muestran)
router.get('/', requireUser, (req, res) => {
  const rows = db.prepare('SELECT * FROM reports WHERE userId = ? AND activo = 1 ORDER BY creadoEn DESC').all(req.user.id);
  res.json(rows.map((r) => serializeReport(r)));
});

router.get('/:id', requireUser, (req, res) => {
  const row = db.prepare('SELECT * FROM reports WHERE id = ?').get(req.params.id);
  if (!row || (row.userId !== req.user.id && req.user.rol !== 'admin')) return res.status(404).json({ error: 'Reporte no encontrado.' });
  res.json(serializeReport(row, { withAuthor: req.user.rol === 'admin' }));
});

// Crear (multipart): campos de texto + fotos[] (1–3) + audio opcional
router.post('/', requireUser, reportUpload, (req, res, next) => {
  try {
    const files = validateFiles(req.files, { minPhotos: 1 });
    const { report, duplicate } = createReport(req.user.id, req.body, files);
    res.status(duplicate ? 200 : 201).json({ ...report, duplicate });
  } catch (error) { next(error); }
});

export default router;
