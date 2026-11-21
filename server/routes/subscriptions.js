import { Router } from 'express';
import db from '../db/sqlite.js';
import { requireUser } from '../middleware/user.js';
import { fieldError } from '../services/auth.js';

const router = Router();
router.use(requireUser);

function parseSubscription(body) {
  const sub = body?.subscription || body;
  const endpoint = String(sub?.endpoint ?? '');
  const keys = sub?.keys;
  if (!/^https:\/\//.test(endpoint) || endpoint.length > 1000) throw fieldError('Suscripción push inválida.', { subscription: 'Endpoint inválido.' }, 422);
  return { endpoint, keys };
}

function cleanCategorias(value) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw fieldError('categorias debe ser un arreglo.', { categorias: 'Formato inválido.' }, 422);
  const ids = [...new Set(value.map(Number).filter(Number.isInteger))];
  const valid = new Set(db.prepare('SELECT id FROM categories').all().map((c) => c.id));
  return ids.filter((id) => valid.has(id));
}

const view = (row) => ({ endpoint: row.endpoint, categorias: JSON.parse(row.categoriasJson), activo: Boolean(row.activo) });

// Estado de la suscripción de este dispositivo
router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM subscriptions WHERE endpoint = ? AND userId = ?').get(String(req.query.endpoint ?? ''), req.user.id);
  res.json(row ? view(row) : { endpoint: null, categorias: [], activo: false });
});

// Alta: { subscription, categorias }
router.post('/', (req, res, next) => {
  try {
    const { endpoint, keys } = parseSubscription(req.body);
    if (!keys?.p256dh || !keys?.auth) throw fieldError('Suscripción push inválida.', { subscription: 'Faltan las claves.' }, 422);
    const categorias = cleanCategorias(req.body.categorias) ?? [];
    db.prepare(`INSERT INTO subscriptions (userId, endpoint, keysJson, categoriasJson, activo) VALUES (?,?,?,?,1)
      ON CONFLICT(endpoint) DO UPDATE SET userId = excluded.userId, keysJson = excluded.keysJson, categoriasJson = excluded.categoriasJson, activo = 1`)
      .run(req.user.id, endpoint, JSON.stringify(keys), JSON.stringify(categorias));
    res.status(201).json(view(db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint)));
  } catch (e) { next(e); }
});

// Cambiar categorías: { endpoint | subscription, categorias }
router.put('/', (req, res, next) => {
  try {
    const { endpoint } = parseSubscription(req.body);
    const categorias = cleanCategorias(req.body.categorias);
    if (categorias === undefined) throw fieldError('Indica las categorías.', { categorias: 'Obligatorio.' }, 422);
    const info = db.prepare('UPDATE subscriptions SET categoriasJson = ? WHERE endpoint = ? AND userId = ?').run(JSON.stringify(categorias), endpoint, req.user.id);
    if (!info.changes) return res.status(404).json({ error: 'No hay una suscripción de este dispositivo para tu cuenta.' });
    res.json(view(db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint)));
  } catch (e) { next(e); }
});

// Apagar notificaciones en este dispositivo (el cliente conserva las categorías elegidas)
router.delete('/', (req, res, next) => {
  try {
    const { endpoint } = parseSubscription(req.body);
    db.prepare('DELETE FROM subscriptions WHERE endpoint = ? AND userId = ?').run(endpoint, req.user.id);
    res.sendStatus(204);
  } catch (e) { next(e); }
});

// Al iniciar sesión: vincula la suscripción del dispositivo al usuario.
// Si el dispositivo pertenecía a otro usuario, se reinician las categorías (no heredar preferencias ajenas).
router.post('/link', (req, res, next) => {
  try {
    const { endpoint } = parseSubscription(req.body);
    const row = db.prepare('SELECT * FROM subscriptions WHERE endpoint = ?').get(endpoint);
    if (!row) return res.json({ vinculada: false, categorias: [] });
    const same = row.userId === req.user.id || row.prevUserId === req.user.id;
    db.prepare('UPDATE subscriptions SET userId = ?, prevUserId = NULL, categoriasJson = ? WHERE id = ?')
      .run(req.user.id, same ? row.categoriasJson : '[]', row.id);
    res.json({ vinculada: true, categorias: same ? JSON.parse(row.categoriasJson) : [] });
  } catch (e) { next(e); }
});

export default router;
