// Verificación E2E en navegador real (Chrome vía Playwright) + capturas principales.
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-e2e-'));
process.env.DB_FILE = path.join(tmp, 'e2e.sqlite');
process.env.DATA_DIR = tmp;
process.env.UPLOAD_DIR = path.join(tmp, 'uploads');

const { start } = await import('../server/index.js');
const server = await start(0);
const base = `http://localhost:${server.address().port}`;
const out = 'docs/evidencias/capturas';
fs.mkdirSync(out, { recursive: true });

// Imagen PNG válida de prueba en disco temporal
const pngPath = path.join(tmp, 'evidencia.png');
const PNG = Buffer.concat([
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFElEQVR42mP8z8BQz0AEYBxVSF+FABJADveWkH6oAAAAAElFTkSuQmCC', 'base64')
]);
fs.writeFileSync(pngPath, PNG);

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();

// 1. Login screenshot + redirección desde /reportes/nuevo -> /ingresar -> volver tras login
await page.goto(base + '/reportes/nuevo');
await page.waitForSelector('#auth-form');
assert.ok(page.url().includes('/ingresar'));
await page.waitForTimeout(450);
await page.screenshot({ path: `${out}/login.png`, fullPage: false });

// 2. Registro de usuario nuevo (redirige de vuelta a /reportes/nuevo)
await page.click('#tab-register');
await page.fill('#f-nombre', 'Ana María Pérez');
await page.fill('#f-codigo', '202624257');
await page.selectOption('#f-cargo', 'estudiante');
await page.fill('#f-correo', 'ana.perez@uptc.edu.co');
await page.fill('#f-password', 'Clave2026');
await page.click('button[type=submit]');
await page.waitForSelector('#report-form');
assert.ok(page.url().endsWith('/reportes/nuevo'), `Esperaba /reportes/nuevo, obtuve ${page.url()}`);

// 3. Crear reporte OFFLINE -> verificar outbox en IndexedDB -> reconectar y sincronizar
await ctx.setOffline(true);
await page.fill('#r-titulo', 'Fuga de agua en bloque A');
await page.selectOption('#r-categoria', 'Infraestructura');
await page.fill('#r-descripcion', 'Tubería rota en el primer piso.');
await page.setInputFiles('#file-input', pngPath);
await page.waitForSelector('.thumb img');
await page.fill('#r-referencia', 'Bloque A, piso 1');
await page.click('#btn-submit');
await page.waitForSelector('#my-reports-list');
await page.waitForTimeout(300);
const offlineText = await page.textContent('#my-reports-list');
assert.ok(offlineText.includes('Pendiente de envío'), 'Debe mostrar indicador Pendiente de envío');
await page.screenshot({ path: `${out}/reporte-offline.png`, fullPage: false });

const outboxCount = await page.evaluate(() => new Promise((res) => {
  const req = indexedDB.open('campusalerta-db', 3);
  req.onsuccess = () => {
    const tx = req.result.transaction('outbox').objectStore('outbox').count();
    tx.onsuccess = () => res(tx.result);
  };
}));
assert.equal(outboxCount, 1, 'Debe haber 1 registro en outbox');

await ctx.setOffline(false);
await page.waitForFunction(() => new Promise((res) => {
  const req = indexedDB.open('campusalerta-db', 3);
  req.onsuccess = () => {
    const tx = req.result.transaction('outbox').objectStore('outbox').count();
    tx.onsuccess = () => res(tx.result === 0);
  };
}), { timeout: 10000 });
await page.goto(base + '/?seccion=reportes');
await page.waitForSelector('#my-reports-list');
await page.waitForTimeout(400);
const onlineText = await page.textContent('#my-reports-list');
assert.ok(!onlineText.includes('Pendiente de envío'), 'Al sincronizar desaparece Pendiente de envío');
assert.ok(onlineText.includes('Por revisar'), 'Debe aparecer Por revisar');

// 4. Login como admin -> aprobar reporte -> captura panel admin
await page.goto(base + '/perfil');
await page.waitForSelector('#logout');
await page.click('#logout');
await page.waitForSelector('#auth-form');
await page.fill('#f-correo', 'pepito.perez@uptc.edu.co');
await page.fill('#f-password', 'Pepito123');
await page.click('button[type=submit]');
await page.waitForSelector('.section-switch');

await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(base + '/');
await page.waitForSelector('.section-switch');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/inicio.png`, fullPage: false });

await page.goto(base + '/admin?tab=reportes');
await page.waitForSelector('[data-open]');
await page.click('[data-open]');
await page.waitForSelector('#adm-approve');
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/admin.png`, fullPage: false });
await page.click('#adm-approve');
await page.waitForTimeout(500);

// 5. Verificar incidente público sin sesión -> captura incidente
await page.goto(base + '/perfil');
await page.click('#logout');
await page.waitForSelector('#auth-form');
await page.goto(base + '/incidentes/1');
await page.waitForSelector('.gallery-item');
await page.waitForTimeout(400);
await page.screenshot({ path: `${out}/incidente.png`, fullPage: false });

await browser.close();
server.close();
console.log('E2E OK · Capturas en', out);
