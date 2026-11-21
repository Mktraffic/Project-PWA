import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

// BD temporal y límite de login bajo para probar el rate limiting
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campusalerta-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.DATA_DIR = tmp;
process.env.NODE_ENV = 'test';
process.env.LOGIN_RATE_LIMIT = '6';

const { start, app } = await import('../index.js');
const { default: db } = await import('../db/sqlite.js');
const { ensureAdminSeed } = await import('../services/auth.js');
const { requireAdmin } = await import('../middleware/admin.js');

let server, base;
before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
after(() => { server.close(); });

const post = (url, body, token) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const valid = { nombre: 'Ana María Pérez', codigo: '202624257', cargo: 'estudiante', correo: 'ana.perez@uptc.edu.co', password: 'Clave2026' };

test('seed: admin Pepito Perez existe, es único y es idempotente', async () => {
  await ensureAdminSeed(); await ensureAdminSeed();
  const admins = db.prepare("SELECT * FROM users WHERE rol='admin'").all();
  assert.equal(admins.length, 1);
  assert.equal(admins[0].correo, 'pepito.perez@uptc.edu.co');
  assert.equal(admins[0].codigo, '202624255');
  assert.notEqual(admins[0].passwordHash, 'Pepito123'); // solo hash bcrypt
  assert.match(admins[0].passwordHash, /^\$2[aby]\$/);
});

const cases = [
  ['nombre con una sola palabra', { nombre: 'Ana' }, 'nombre'],
  ['nombre con números', { nombre: 'Ana 2 Pérez' }, 'nombre'],
  ['nombre vacío', { nombre: '' }, 'nombre'],
  ['código con letras', { codigo: '2026abc57' }, 'codigo'],
  ['código de 7 dígitos', { codigo: '2026242' }, 'codigo'],
  ['código de 11 dígitos', { codigo: '20262425799' }, 'codigo'],
  ['cargo inválido', { cargo: 'rector' }, 'cargo'],
  ['correo no institucional', { correo: 'ana@gmail.com' }, 'correo'],
  ['correo con subdominio falso', { correo: 'ana@uptc.edu.co.evil.com' }, 'correo'],
  ['contraseña corta', { password: 'Ab1' }, 'password'],
  ['contraseña sin mayúscula', { password: 'clave2026' }, 'password'],
  ['contraseña sin minúscula', { password: 'CLAVE2026' }, 'password'],
  ['contraseña sin número', { password: 'ClaveClave' }, 'password']
];
for (const [name, patch, field] of cases) {
  test(`registro rechaza: ${name}`, async () => {
    const res = await post('/api/auth/register', { ...valid, ...patch });
    assert.equal(res.status, 422);
    const body = await res.json();
    assert.ok(body.fields[field], `debe haber mensaje para ${field}`);
  });
}

test('registro válido crea rol usuario (no admin) y guarda hash', async () => {
  const res = await post('/api/auth/register', { ...valid, rol: 'admin' }); // intento de escalar rol
  assert.equal(res.status, 201);
  const body = await res.json();
  assert.equal(body.user.rol, 'usuario');
  assert.ok(body.token);
  const row = db.prepare('SELECT passwordHash FROM users WHERE correo = ?').get(valid.correo);
  assert.match(row.passwordHash, /^\$2[aby]\$/);
});

test('código y correo duplicados dan error claro por campo', async () => {
  const res = await post('/api/auth/register', valid);
  assert.equal(res.status, 409);
  const { fields } = await res.json();
  assert.match(fields.codigo, /ya está registrado/);
  assert.match(fields.correo, /ya está registrado/);
  const res2 = await post('/api/auth/register', { ...valid, correo: 'otro.correo@uptc.edu.co' });
  assert.match((await res2.json()).fields.codigo, /ya está registrado/);
});

test('login correcto, /me y rol', async () => {
  const res = await post('/api/auth/login', { correo: 'pepito.perez@uptc.edu.co', password: 'Pepito123' });
  assert.equal(res.status, 200);
  const { token, user } = await res.json();
  assert.equal(user.rol, 'admin');
  const me = await fetch(base + '/api/auth/me', { headers: { Authorization: `Bearer ${token}` } });
  assert.equal((await me.json()).user.correo, 'pepito.perez@uptc.edu.co');
  assert.equal((await fetch(base + '/api/auth/me')).status, 401);
});

test('requireAdmin: usuario normal recibe 403, admin pasa, sin token 401', async () => {
  const run = (user) => new Promise((resolve) => {
    const res = { status(c) { this.code = c; return this; }, json() { resolve(this.code); } };
    requireAdmin({ user }, res, () => resolve('next'));
  });
  assert.equal(await run(null), 401);
  assert.equal(await run({ rol: 'usuario' }), 403);
  assert.equal(await run({ rol: 'admin' }), 'next');
});

test('logout desvincula la suscripción push del dispositivo', async () => {
  const { token, user } = await (await post('/api/auth/login', { correo: valid.correo, password: valid.password })).json();
  db.prepare("INSERT INTO subscriptions (userId,endpoint,keysJson,categoriasJson) VALUES (?,?,?,?)").run(user.id, 'https://push.test/abc', '{}', '[]');
  const res = await post('/api/auth/logout', { endpoint: 'https://push.test/abc' }, token);
  assert.equal(res.status, 204);
  assert.equal(db.prepare('SELECT userId FROM subscriptions WHERE endpoint = ?').get('https://push.test/abc').userId, null);
});

test('rate limiting en /api/auth/login tras intentos fallidos', async () => {
  let last;
  for (let i = 0; i < 8; i++) last = await post('/api/auth/login', { correo: 'x@uptc.edu.co', password: 'mala' });
  assert.equal(last.status, 429);
});
