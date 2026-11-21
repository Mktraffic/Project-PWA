import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'campusalerta-flows-'));
process.env.DB_FILE = path.join(tmp, 'test.sqlite');
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');
process.env.NODE_ENV = 'test';

const { start } = await import('../index.js');
const { default: db } = await import('../db/sqlite.js');
const push = await import('../services/push.js');
const scraper = await import('../services/scraper.js');

let server, base;
const sent = []; // { endpoint, payload }
const dead = new Set(); // endpoints que responden 410
push.setSender(async (sub, body) => {
  if (dead.has(sub.endpoint)) throw Object.assign(new Error('gone'), { statusCode: 410 });
  sent.push({ endpoint: sub.endpoint, payload: JSON.parse(body) });
});

before(async () => { server = await start(0); base = `http://localhost:${server.address().port}`; });
after(() => server.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(200, 1)]);
const call = async (method, url, { token, json, form } = {}) => {
  const headers = token ? { Authorization: `Bearer ${token}` } : {};
  let body;
  if (json !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(json); }
  if (form) body = form;
  const res = await fetch(base + url, { method, headers, body });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
};
const reportForm = (over = {}, { fotos = 1, audio = false } = {}) => {
  const f = new FormData();
  const data = { titulo: 'Bombillo fundido', categoria: 'Iluminación', descripcion: 'Pasillo del bloque B sin luz', ...over };
  for (const [k, v] of Object.entries(data)) if (v !== undefined && v !== null) f.append(k, v);
  for (let i = 0; i < fotos; i++) f.append('fotos', new Blob([PNG], { type: 'image/png' }), `f${i}.png`);
  if (audio) f.append('audio', new Blob([Buffer.alloc(500, 3)], { type: 'audio/webm' }), 'a.webm');
  return f;
};
const estadoForm = (data, fotos = 0, audio = false) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(data)) f.append(k, v);
  for (let i = 0; i < fotos; i++) f.append('fotos', new Blob([PNG], { type: 'image/png' }), `s${i}.png`);
  if (audio) f.append('audio', new Blob([Buffer.alloc(500, 3)], { type: 'audio/webm' }), 's.webm');
  return f;
};

const users = {};
async function mkUser(key, n) {
  const r = await call('POST', '/api/auth/register', { json: { nombre: `Usuario ${key === 'a' ? 'Alfa' : key === 'b' ? 'Beta' : key === 'c' ? 'Gamma' : 'Delta'}`, codigo: `2026000${n}0`, cargo: 'docente', correo: `${key}.user@uptc.edu.co`, password: 'Clave2026x' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  users[key] = { token: r.body.token, id: r.body.user.id };
}
let admin;
const subscribe = (key, n, categorias) => call('POST', '/api/subscriptions', { token: users[key].token, json: { subscription: { endpoint: `https://push.test/${key}${n}`, keys: { p256dh: 'p', auth: 'a' } }, categorias } });
const cats = {};

test('preparación: usuarios, admin y categorías', async () => {
  for (const [i, k] of ['a', 'b', 'c', 'd'].entries()) await mkUser(k, i + 1);
  const r = await call('POST', '/api/auth/login', { json: { correo: 'pepito.perez@uptc.edu.co', password: 'Pepito123' } });
  admin = r.body.token;
  for (const c of (await call('GET', '/api/categories')).body) cats[c.nombre] = c.id;
  assert.ok(cats['Académico'] && cats['Eventos'] && cats['Bienestar']);
});

test('rutas admin: sin token 401 y usuario normal 403 en TODAS', async () => {
  const routes = [['GET', '/api/admin/uptc-news'], ['GET', '/api/admin/news'], ['POST', '/api/admin/news'], ['DELETE', '/api/admin/news/1'],
    ['GET', '/api/admin/reports'], ['GET', '/api/admin/reports?eliminados=true'], ['PATCH', '/api/admin/reports/1/aprobacion'], ['PATCH', '/api/admin/reports/1/estado'], ['DELETE', '/api/admin/reports/1']];
  for (const [m, u] of routes) {
    assert.equal((await call(m, u, { json: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 401, `${m} ${u} sin token`);
    assert.equal((await call(m, u, { token: users.a.token, json: m === 'GET' || m === 'DELETE' ? undefined : {} })).status, 403, `${m} ${u} usuario`);
  }
  assert.equal((await call('POST', '/api/categories', { token: users.a.token, json: { nombre: 'X' } })).status, 403);
  assert.equal((await call('PUT', '/api/categories/1', { token: users.a.token, json: { nombre: 'X' } })).status, 403);
});

test('categorías: crear y editar (admin) con duplicados rechazados', async () => {
  const c = await call('POST', '/api/categories', { token: admin, json: { nombre: 'Deportes' } });
  assert.equal(c.status, 201);
  assert.equal((await call('POST', '/api/categories', { token: admin, json: { nombre: 'deportes' } })).status, 409);
  const e = await call('PUT', `/api/categories/${c.body.id}`, { token: admin, json: { nombre: 'Deportes y recreación' } });
  assert.equal(e.body.nombre, 'Deportes y recreación');
  assert.equal((await call('POST', '/api/categories', { token: admin, json: { nombre: '' } })).status, 422);
  cats['Deportes y recreación'] = c.body.id;
});

/* ----------------------------- Scraping ----------------------------- */
test('scraper: parsea el HTML real guardado y valida la cantidad (1–20)', async () => {
  const page = fs.readFileSync('docs/fixtures/uptc-index.html', 'utf8');
  const p2 = fs.readFileSync('docs/fixtures/uptc-p2.html', 'utf8');
  const det = fs.readFileSync('docs/fixtures/uptc-detalle.html', 'utf8');
  const full = scraper.parseDetail(det);
  assert.ok(full.length > 1000 && full.includes('Comunicado N° 290'), 'parseDetail debe extraer el contenido completo');
  scraper.setFetcher(async (url) => (url.includes('page=2') ? p2 : page));
  const r = await call('GET', '/api/admin/uptc-news?limit=5', { token: admin });
  assert.equal(r.status, 200);
  assert.equal(r.body.items.length, 5);
  const it = r.body.items[0];
  assert.ok(it.titulo && it.resumen && /^\d{4}-\d{2}-\d{2}$/.test(it.fecha) && it.imagenUrl.startsWith('https://www.uptc.edu.co') && it.fuenteUrl.startsWith('https://www.uptc.edu.co'));
  assert.equal((await call('GET', '/api/admin/uptc-news?limit=12', { token: admin })).body.items.length, 12);
  assert.equal((await call('GET', '/api/admin/uptc-news', { token: admin })).body.items.length, 5); // por defecto 5
  for (const bad of ['0', '21', 'abc', '2.5']) assert.equal((await call('GET', `/api/admin/uptc-news?limit=${bad}`, { token: admin })).status, 422, bad);
});

test('scraper: cambio de estructura y caída de red dan mensaje claro', async () => {
  scraper.setFetcher(async () => '<html><body><p>nueva estructura</p></body></html>');
  const r = await call('GET', '/api/admin/uptc-news?limit=3', { token: admin });
  assert.equal(r.status, 502);
  assert.match(r.body.error, /estructura/);
  scraper.setFetcher(async () => { throw new Error('ECONNRESET'); });
  const r2 = await call('GET', '/api/admin/uptc-news?limit=4', { token: admin });
  assert.equal(r2.status, 502);
  assert.match(r2.body.error, /No se pudo consultar/);
  scraper.setFetcher(async (url) => fs.readFileSync('docs/fixtures/uptc-index.html', 'utf8'));
});

/* --------------------- Noticias + push por categoría --------------------- */
test('noticia por categoría: push SOLO a suscritos, sin duplicados, urgente marcada', async () => {
  // a: Académico+Eventos (2 coincidencias) · b: Eventos · c: Bienestar (no coincide) · d: Académico pero con sesión cerrada
  assert.equal((await subscribe('a', 1, [cats['Académico'], cats['Eventos']])).status, 201);
  assert.equal((await subscribe('b', 1, [cats['Eventos']])).status, 201);
  assert.equal((await subscribe('c', 1, [cats['Bienestar']])).status, 201);
  assert.equal((await subscribe('d', 1, [cats['Académico']])).status, 201);
  await call('POST', '/api/auth/logout', { token: users.d.token, json: { endpoint: 'https://push.test/d1' } }); // d desvinculada
  sent.length = 0;

  const list = (await call('GET', '/api/admin/uptc-news?limit=2', { token: admin })).body.items;
  const item = list[0];
  const sinCat = await call('POST', '/api/admin/news', { token: admin, json: { ...item, categorias: [] } });
  assert.equal(sinCat.status, 422);
  const urlMala = await call('POST', '/api/admin/news', { token: admin, json: { ...item, fuenteUrl: 'https://evil.com/x', categorias: [cats['Eventos']] } });
  assert.equal(urlMala.status, 422);

  const pub = await call('POST', '/api/admin/news', { token: admin, json: { ...item, categorias: [cats['Académico'], cats['Eventos']], urgente: true } });
  assert.equal(pub.status, 201);
  const targets = sent.map((s) => s.endpoint).sort();
  assert.deepEqual(targets, ['https://push.test/a1', 'https://push.test/b1']); // a UNA sola vez; c y d no
  assert.match(sent[0].payload.title, /^⚠ URGENTE: /);
  assert.equal(sent[0].payload.url, `/noticias/${pub.body.news.id}`);
  assert.equal((await call('POST', '/api/admin/news', { token: admin, json: { ...item, categorias: [cats['Eventos']] } })).status, 409); // ya publicada

  // pública con filtro por categoría
  assert.equal((await call('GET', '/api/news')).body.length, 1);
  assert.equal((await call('GET', `/api/news?categoria=${cats['Eventos']}`)).body.length, 1);
  assert.equal((await call('GET', `/api/news?categoria=${cats['Bienestar']}`)).body.length, 0);
  assert.equal((await call('GET', `/api/news/${pub.body.news.id}`)).body.fuenteUrl, item.fuenteUrl);

  // noticia normal (no urgente) de Bienestar → solo c
  sent.length = 0;
  const pub2 = await call('POST', '/api/admin/news', { token: admin, json: { ...list[1], categorias: [cats['Bienestar']] } });
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.test/c1']);
  assert.doesNotMatch(sent[0].payload.title, /URGENTE/);

  // despublicar
  assert.equal((await call('DELETE', `/api/admin/news/${pub2.body.news.id}`, { token: admin })).status, 204);
  assert.equal((await call('GET', `/api/news/${pub2.body.news.id}`)).status, 404);
});

test('push 410/404 elimina la suscripción del servidor', async () => {
  await subscribe('b', 2, [cats['Eventos']]);
  dead.add('https://push.test/b2');
  const item = (await call('GET', '/api/admin/uptc-news?limit=3', { token: admin })).body.items[2];
  await call('POST', '/api/admin/news', { token: admin, json: { ...item, categorias: [cats['Eventos']] } });
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE endpoint = ?').get('https://push.test/b2').n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE endpoint = ?').get('https://push.test/b1').n, 1);
});

test('suscripciones: PUT cambia categorías, DELETE apaga, link re-vincula', async () => {
  assert.equal((await call('PUT', '/api/subscriptions', { token: users.b.token, json: { endpoint: 'https://push.test/b1', categorias: [cats['Académico']] } })).body.categorias[0], cats['Académico']);
  assert.equal((await call('PUT', '/api/subscriptions', { token: users.c.token, json: { endpoint: 'https://push.test/b1', categorias: [] } })).status, 404); // ajena
  assert.equal((await call('DELETE', '/api/subscriptions', { token: users.b.token, json: { endpoint: 'https://push.test/b1' } })).status, 204);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM subscriptions WHERE endpoint = ?').get('https://push.test/b1').n, 0);
  // d vuelve a iniciar sesión: link conserva sus categorías (mismo usuario)
  const l = await call('POST', '/api/subscriptions/link', { token: users.d.token, json: { subscription: { endpoint: 'https://push.test/d1' } } });
  assert.deepEqual(l.body.categorias, [cats['Académico']]);
  // otro usuario en el mismo dispositivo NO hereda categorías
  await call('POST', '/api/auth/logout', { token: users.d.token, json: { endpoint: 'https://push.test/d1' } });
  const l2 = await call('POST', '/api/subscriptions/link', { token: users.a.token, json: { subscription: { endpoint: 'https://push.test/d1' } } });
  assert.deepEqual(l2.body.categorias, []);
  db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run('https://push.test/d1');
});

/* ------------------------------ Reportes ------------------------------ */
test('crear reporte: validaciones de servidor', async () => {
  const t = users.c.token;
  assert.equal((await call('POST', '/api/reports', { json: {} })).status, 401);
  const noFoto = await call('POST', '/api/reports', { token: t, form: reportForm({}, { fotos: 0 }) });
  assert.equal(noFoto.status, 422); assert.ok(noFoto.body.fields.fotos);
  const cuatro = await call('POST', '/api/reports', { token: t, form: reportForm({}, { fotos: 4 }) });
  assert.ok([400, 422].includes(cuatro.status));
  const sinDesc = await call('POST', '/api/reports', { token: t, form: reportForm({ descripcion: '' }) });
  assert.ok(sinDesc.body.fields.descripcion);
  const sinTitulo = await call('POST', '/api/reports', { token: t, form: reportForm({ titulo: '  ', categoria: 'Nada' }) });
  assert.ok(sinTitulo.body.fields.titulo && sinTitulo.body.fields.categoria);
  const gps = await call('POST', '/api/reports', { token: t, form: reportForm({ lat: '4.7' }) });
  assert.ok(gps.body.fields.ubicacion);
  const pdf = new FormData(); pdf.append('titulo', 'x'); pdf.append('fotos', new Blob(['x'], { type: 'application/pdf' }), 'a.pdf');
  assert.equal((await call('POST', '/api/reports', { token: t, form: pdf })).status, 422);
  const falsa = new FormData(); falsa.append('titulo', 'x'); falsa.append('categoria', 'Otro'); falsa.append('descripcion', 'd');
  falsa.append('fotos', new Blob(['no soy imagen'], { type: 'image/png' }), 'a.png');
  assert.equal((await call('POST', '/api/reports', { token: t, form: falsa })).status, 422); // firma inválida
});

let rep; // reporte con audio + 3 fotos y ubicación
test('crear reporte con audio y 3 fotos; idempotente por clientId; nace por_revisar/pendiente', async () => {
  db.prepare('DELETE FROM subscriptions WHERE endpoint = ?').run('https://push.test/c1');
  await subscribe('c', 2, []); // autor con push sin categorías (recibe cambios de su reporte)
  const form = () => reportForm({ descripcion: undefined, lat: '5.5353', lng: '-73.3678', referencia: 'Bloque B', clientId: 'abc-123' }, { fotos: 3, audio: true });
  const r = await call('POST', '/api/reports', { token: users.c.token, form: form() });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  rep = r.body;
  assert.equal(rep.aprobacion, 'por_revisar'); assert.equal(rep.estado, 'pendiente'); assert.equal(rep.activo, true);
  assert.equal(rep.media.imagenes.length, 3); assert.ok(rep.media.audio);
  const again = await call('POST', '/api/reports', { token: users.c.token, form: form() });
  assert.equal(again.status, 200); assert.equal(again.body.id, rep.id); assert.equal(again.body.duplicate, true);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM reports').get().n, 1);
  // archivo servido
  assert.equal((await fetch(base + rep.media.imagenes[0])).status, 200);
});

test('visibilidad: por_revisar NO es incidente público; "mis reportes" solo del autor', async () => {
  assert.equal((await call('GET', '/api/incidents')).body.length, 0);
  assert.equal((await call('GET', `/api/incidents/${rep.id}`)).status, 404);
  assert.equal((await call('GET', '/api/reports', { token: users.c.token })).body.length, 1);
  assert.equal((await call('GET', '/api/reports', { token: users.a.token })).body.length, 0);
  assert.equal((await call('GET', `/api/reports/${rep.id}`, { token: users.a.token })).status, 404);
  assert.equal((await call('GET', '/api/admin/reports', { token: admin })).body.length, 1);
});

test('estado solo se cambia en reportes aprobados', async () => {
  const r = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'en_proceso' }) });
  assert.equal(r.status, 409);
});

test('aprobar: pasa a incidente público y push SOLO al autor', async () => {
  sent.length = 0;
  await subscribe('a', 3, []); await subscribe('b', 3, []); // otros usuarios con push: no deben recibir
  const r = await call('PATCH', `/api/admin/reports/${rep.id}/aprobacion`, { token: admin, json: { aprobacion: 'aprobado' } });
  assert.equal(r.status, 200); assert.equal(r.body.report.aprobacion, 'aprobado');
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.test/c2']);
  assert.match(sent[0].payload.title, /Bombillo fundido/); assert.match(sent[0].payload.body, /Aprobado/);
  assert.equal(sent[0].payload.url, `/reportes/${rep.id}`);
  const pub = await call('GET', `/api/incidents/${rep.id}`);
  assert.equal(pub.status, 200); assert.equal(pub.body.categoria, 'Iluminación'); assert.equal(pub.body.estado, 'pendiente');
  assert.equal(pub.body.userId, undefined); assert.equal(pub.body.autor, undefined); // sin datos del autor
  assert.equal((await call('GET', '/api/incidents')).body.length, 1);
});

test('en proceso → push al autor con el nuevo estado', async () => {
  sent.length = 0;
  const r = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'en_proceso' }) });
  assert.equal(r.status, 200); assert.equal(r.body.report.estado, 'en_proceso');
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.test/c2']);
  assert.match(sent[0].payload.body, /En proceso/);
});

test('impedimento actualiza estado sin exigir campo de motivo', async () => {
  const largo = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'impedimento', motivoImpedimento: 'x'.repeat(300) }) });
  assert.equal(largo.status, 422);
  sent.length = 0;
  const ok = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'impedimento' }) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.report.estado, 'impedimento');
  assert.match(sent[0].payload.body, /Impedimento/);
});

test('eliminar NO permitido hasta aprobado + finalizada', async () => {
  assert.equal((await call('DELETE', `/api/admin/reports/${rep.id}`, { token: admin })).status, 409);
});

test('finalizada exige solución (texto o audio) + 1–3 imágenes; push incluye resumen', async () => {
  const sinSol = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'finalizada' }, 1) });
  assert.ok(sinSol.body.fields.solucion);
  const sinFoto = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'finalizada', solucionTexto: 'Cambiado' }) });
  assert.equal(sinFoto.status, 422); assert.ok(sinFoto.body.fields.fotos);
  sent.length = 0;
  const ok = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'finalizada', solucionTexto: 'Se cambió el bombillo' }, 2) });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.report.media.solucionImagenes.length, 2);
  assert.equal(ok.body.report.motivoImpedimento, null); // limpia el impedimento previo
  assert.match(sent[0].payload.body, /Finalizada\. Se cambió el bombillo/);
  const conAudio = await call('PATCH', `/api/admin/reports/${rep.id}/estado`, { token: admin, form: estadoForm({ estado: 'finalizada' }, 1, true) });
  assert.equal(conAudio.status, 200); assert.ok(conAudio.body.report.media.solucionAudio);
});

test('filtros del admin por estado, categoría y fecha', async () => {
  const q = (s) => call('GET', `/api/admin/reports?${s}`, { token: admin }).then((r) => r.body.length);
  assert.equal(await q('estado=finalizada'), 1);
  assert.equal(await q('estado=pendiente'), 0);
  assert.equal(await q('categoria=Iluminaci%C3%B3n'), 1);
  assert.equal(await q('categoria=Seguridad'), 0);
  const hoy = new Date().toLocaleDateString('en-CA');
  assert.equal(await q(`desde=${hoy}`), 1);
  assert.equal(await q('desde=2999-01-01'), 0);
});

test('desaprobar con observaciones: push al autor con el motivo (y segundo reporte rechazado)', async () => {
  const r2 = (await call('POST', '/api/reports', { token: users.c.token, form: reportForm({ titulo: 'Grafiti', categoria: 'Otro' }) })).body;
  sent.length = 0;
  const bad = await call('PATCH', `/api/admin/reports/${r2.id}/aprobacion`, { token: admin, json: { aprobacion: 'rechazado', motivoRechazo: 'x'.repeat(400) } });
  assert.equal(bad.status, 422);
  const r = await call('PATCH', `/api/admin/reports/${r2.id}/aprobacion`, { token: admin, json: { aprobacion: 'rechazado', motivoRechazo: 'Falta evidencia clara' } });
  assert.equal(r.body.report.aprobacion, 'rechazado'); assert.equal(r.body.report.motivoRechazo, 'Falta evidencia clara');
  assert.deepEqual(sent.map((s) => s.endpoint), ['https://push.test/c2']);
  assert.match(sent[0].payload.body, /Desaprobado: Falta evidencia clara/);
  assert.equal((await call('GET', `/api/incidents/${r2.id}`)).status, 404);
  // "Mis reportes" muestra el rechazo y las observaciones
  const mine = (await call('GET', '/api/reports', { token: users.c.token })).body.find((x) => x.id === r2.id);
  assert.equal(mine.motivoRechazo, 'Falta evidencia clara');
  // sin observaciones debe rechazarse (observaciones obligatorias)
  const r3 = (await call('POST', '/api/reports', { token: users.c.token, form: reportForm({ titulo: 'Otro', categoria: 'Otro' }) })).body;
  const sinObs = await call('PATCH', `/api/admin/reports/${r3.id}/aprobacion`, { token: admin, json: { aprobacion: 'rechazado' } });
  assert.equal(sinObs.status, 422);
  assert.ok(sinObs.body.fields.motivoRechazo);
});

test('eliminación lógica: desaparece de vistas normales y queda inactivo en la BD', async () => {
  const del = await call('DELETE', `/api/admin/reports/${rep.id}`, { token: admin });
  assert.equal(del.status, 204);
  const row = db.prepare('SELECT activo, eliminadoEn FROM reports WHERE id = ?').get(rep.id);
  assert.equal(row.activo, 0); assert.ok(row.eliminadoEn);
  assert.equal((await call('GET', '/api/incidents')).body.length, 0);
  assert.equal((await call('GET', `/api/incidents/${rep.id}`)).status, 404);
  assert.ok(!(await call('GET', '/api/reports', { token: users.c.token })).body.some((x) => x.id === rep.id));
  assert.ok(!(await call('GET', '/api/admin/reports', { token: admin })).body.some((x) => x.id === rep.id));
  assert.ok((await call('GET', '/api/admin/reports?eliminados=true', { token: admin })).body.some((x) => x.id === rep.id));
  assert.equal((await call('GET', '/api/admin/reports?eliminados=true', { token: users.a.token })).status, 403);
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE accion = 'eliminar'").get().n >= 1);
});

test('reporte con audio de descripción (sin texto) es válido', async () => {
  const r = await call('POST', '/api/reports', { token: users.a.token, form: reportForm({ descripcion: '' }, { audio: true }) });
  assert.equal(r.status, 201); assert.ok(r.body.media.audio);
});
