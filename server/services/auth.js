import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import db from '../db/sqlite.js';
import { config } from '../config.js';
import { validateLogin, validateRegistration } from '../../shared/validators.js';

export { validateRegistration, validateLogin };

const BCRYPT_ROUNDS = 12;
const TOKEN_TTL = '12h';

/** Error de validación con mensajes por campo (el manejador global responde 4xx con { error, fields }). */
export function fieldError(message, fields = {}, status = 400) {
  return Object.assign(new Error(message), { fields, status });
}

export function publicUser(row) {
  return { id: row.id, nombre: row.nombre, codigo: row.codigo, cargo: row.cargo, correo: row.correo, rol: row.rol };
}

export function issueToken(user) {
  return jwt.sign({ sub: user.id, rol: user.rol, correo: user.correo }, config.jwtSecret, { expiresIn: TOKEN_TTL, issuer: 'campusalerta' });
}

export function verifyToken(token) {
  try { return jwt.verify(token, config.jwtSecret, { issuer: 'campusalerta' }); } catch { return null; }
}

export async function register(input) {
  const { errors, values } = validateRegistration(input);
  if (Object.keys(errors).length) throw fieldError('Revisa los campos marcados.', errors, 422);

  const duplicates = db.prepare('SELECT codigo, correo FROM users WHERE codigo = ? OR correo = ?').all(values.codigo, values.correo);
  for (const row of duplicates) {
    if (row.codigo === values.codigo) errors.codigo = 'Este código ya está registrado.';
    if (row.correo === values.correo) errors.correo = 'Este correo ya está registrado.';
  }
  if (Object.keys(errors).length) throw fieldError('No fue posible crear la cuenta.', errors, 409);

  const passwordHash = await bcrypt.hash(values.password, BCRYPT_ROUNDS);
  // El rol siempre es 'usuario': el único admin es el sembrado.
  const info = db.prepare('INSERT INTO users (nombre,codigo,cargo,correo,passwordHash,rol,creadoEn) VALUES (?,?,?,?,?,?,?)')
    .run(values.nombre, values.codigo, values.cargo, values.correo, passwordHash, 'usuario', Date.now());
  const user = publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(info.lastInsertRowid));
  return { token: issueToken(user), user };
}

// Hash ficticio para igualar tiempos cuando el correo no existe.
const DUMMY_HASH = bcrypt.hashSync('no-existe', 4);

export async function login(input) {
  const { errors, values } = validateLogin(input);
  if (Object.keys(errors).length) throw fieldError('Revisa los campos marcados.', errors, 422);
  const row = db.prepare('SELECT * FROM users WHERE correo = ?').get(values.correo);
  const ok = await bcrypt.compare(values.password, row?.passwordHash || DUMMY_HASH);
  if (!row || !ok) throw fieldError('Correo o contraseña incorrectos.', { password: 'Verifica tus credenciales.' }, 401);
  const user = publicUser(row);
  return { token: issueToken(user), user };
}

export function getUserById(id) {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  return row ? publicUser(row) : null;
}

/** Usuario administrador sembrado. Idempotente: no duplica ni cambia la contraseña si ya existe. */
export async function ensureAdminSeed() {
  const seed = { nombre: 'Pepito Perez', codigo: '202624255', cargo: 'estudiante', correo: 'pepito.perez@uptc.edu.co', password: 'Pepito123' };
  const existing = db.prepare('SELECT id, rol FROM users WHERE correo = ?').get(seed.correo);
  if (existing) {
    if (existing.rol !== 'admin') db.prepare("UPDATE users SET rol = 'admin' WHERE id = ?").run(existing.id);
  } else {
    const passwordHash = await bcrypt.hash(seed.password, BCRYPT_ROUNDS);
    db.prepare('INSERT INTO users (nombre,codigo,cargo,correo,passwordHash,rol,creadoEn) VALUES (?,?,?,?,?,?,?)')
      .run(seed.nombre, seed.codigo, seed.cargo, seed.correo, passwordHash, 'admin', Date.now());
  }
  // Garantiza que Pepito sea el ÚNICO admin.
  db.prepare("UPDATE users SET rol = 'usuario' WHERE rol = 'admin' AND correo <> ?").run(seed.correo);
}

export function ensureDefaultCategories() {
  const insert = db.prepare('INSERT OR IGNORE INTO categories (nombre) VALUES (?)');
  for (const nombre of ['Académico', 'Bienestar', 'Eventos', 'Investigación', 'Institucional']) insert.run(nombre);
}
