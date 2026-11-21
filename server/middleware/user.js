import { getUserById, verifyToken } from '../services/auth.js';

/** Lee el JWT (si viene) y adjunta req.user con datos frescos de la BD (el rol nunca se toma solo del token). */
export function user(req, res, next) {
  const token = req.get('authorization')?.replace(/^Bearer\s+/i, '');
  const payload = token ? verifyToken(token) : null;
  req.user = payload ? getUserById(payload.sub) : null;
  next();
}

export function requireUser(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Inicia sesión con tu cuenta institucional UPTC.', code: 'AUTH_REQUIRED' });
  next();
}
