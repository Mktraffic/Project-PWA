import { requireUser } from './user.js';

/** Todas las rutas admin pasan por aquí: valida JWT y rol === 'admin' en el servidor. */
export function requireAdmin(req, res, next) {
  requireUser(req, res, () => {
    if (req.user.rol !== 'admin') return res.status(403).json({ error: 'Esta acción requiere el rol de administrador.' });
    next();
  });
}
