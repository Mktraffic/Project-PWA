// Capturas de pantallas para verificar la identidad visual. Uso: node scripts/shots.mjs
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { chromium } from '@playwright/test';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ca-shots-'));
process.env.DB_FILE = path.join(tmp, 's.sqlite');
process.env.DATA_DIR = tmp;
const { start } = await import('../server/index.js');
const server = await start(0);
const base = `http://localhost:${server.address().port}`;
const out = 'docs/evidencias/capturas';
fs.mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ channel: 'chrome' });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const shot = async (name, full = true) => { await page.waitForTimeout(500); await page.screenshot({ path: `${out}/${name}.png`, fullPage: full }); };

await page.goto(base + '/ingresar'); await page.waitForSelector('#auth-form'); await shot('fase1-login-movil');
await page.click('#tab-register'); await page.click('button[type=submit]'); await shot('fase1-registro-errores-movil');
await page.goto(base + '/ingresar');
await page.fill('#f-correo', 'pepito.perez@uptc.edu.co'); await page.fill('#f-password', 'Pepito123'); await page.click('button[type=submit]');
await page.waitForSelector('.section-switch'); await shot('fase1-inicio-movil', false);
await page.goto(base + '/perfil'); await page.waitForSelector('.profile-grid'); await shot('fase1-perfil-movil', false);

await page.setViewportSize({ width: 1280, height: 800 });
await page.goto(base + '/'); await page.waitForSelector('.section-switch'); await shot('fase1-inicio-escritorio', false);
await page.evaluate(() => document.querySelector('#logout, a[href="/perfil"]')); 
await browser.close(); server.close();
console.log('Capturas en', out);
