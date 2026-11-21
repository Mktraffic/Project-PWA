import { Router } from 'express';
import db from '../db/sqlite.js';
import { requireAdmin } from '../middleware/admin.js';
import { audit } from '../services/reports.js';
import { fieldError } from '../services/auth.js';

const router = Router();
const list = () => db.prepare('SELECT id, nombre FROM categories ORDER BY nombre').all();

function cleanName(body) {
  const nombre = String(body?.nombre ?? '').trim().replace(/\s+/g, ' ');
  if (!nombre) throw fieldError('El nombre es obligatorio.', { nombre: 'El nombre es obligatorio.' }, 422);
  if (nombre.length > 40) throw fieldError('Máximo 40 caracteres.', { nombre: 'Máximo 40 caracteres.' }, 422);
  return nombre;
}
const exists = (nombre, exceptId = 0) => db.prepare('SELECT id FROM categories WHERE nombre = ? COLLATE NOCASE AND id <> ?').get(nombre, exceptId);

router.get('/', (_req, res) => res.json(list()));

router.post('/', requireAdmin, (req, res, next) => {
  try {
    const nombre = cleanName(req.body);
    if (exists(nombre)) throw fieldError('Ya existe una categoría con ese nombre.', { nombre: 'Ya existe una categoría con ese nombre.' }, 409);
    const id = Number(db.prepare('INSERT INTO categories (nombre) VALUES (?)').run(nombre).lastInsertRowid);
    audit(req.user.id, 'crear', 'categoria', id);
    res.status(201).json({ id, nombre });
  } catch (e) { next(e); }
});

router.put('/:id', requireAdmin, (req, res, next) => {
  try {
    const id = Number(req.params.id);
    if (!db.prepare('SELECT id FROM categories WHERE id = ?').get(id)) return res.status(404).json({ error: 'Categoría no encontrada.' });
    const nombre = cleanName(req.body);
    if (exists(nombre, id)) throw fieldError('Ya existe una categoría con ese nombre.', { nombre: 'Ya existe una categoría con ese nombre.' }, 409);
    db.prepare('UPDATE categories SET nombre = ? WHERE id = ?').run(nombre, id);
    audit(req.user.id, 'editar', 'categoria', id);
    res.json({ id, nombre });
  } catch (e) { next(e); }
});

export default router;
