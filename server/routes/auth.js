import { Router } from 'express';
import db from '../db/sqlite.js';
import { login, register } from '../services/auth.js';
import { requireUser } from '../middleware/user.js';

const router = Router();
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next);

router.post('/register', wrap(async (req, res) => res.status(201).json(await register(req.body))));
router.post('/login', wrap(async (req, res) => res.json(await login(req.body))));
router.get('/me', requireUser, (req, res) => res.json({ user: req.user }));

// Cerrar sesión: desvincula del usuario la suscripción push de ESTE dispositivo (endpoint).
router.post('/logout', requireUser, (req, res) => {
  const endpoint = typeof req.body?.endpoint === 'string' ? req.body.endpoint : null;
  if (endpoint) db.prepare('UPDATE subscriptions SET prevUserId = userId, userId = NULL WHERE endpoint = ? AND userId = ?').run(endpoint, req.user.id);
  res.sendStatus(204);
});

export default router;
