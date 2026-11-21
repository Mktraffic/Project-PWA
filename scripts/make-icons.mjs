// Genera Ã­conos PWA a partir del isotipo OFICIAL del Ã¡guila (versiÃ³n negativa/blanca) sobre #1A1A1A.
// El trazado se copia tal cual de client/img/uptc-blanco.svg: solo se escala uniformemente y se centra.
// NOTA DE MARCA: el uso del isotipo solo (sin logotipo) como Ã­cono de app debe confirmarse con el
// Manual de Identidad GrÃ¡fica 2022 / DIRCOM-UPTC. Es un proyecto acadÃ©mico.
import fs from 'node:fs/promises';
import { chromium } from '@playwright/test';

const svg = await fs.readFile('client/img/uptc-blanco.svg', 'utf8');
const eagle = [...svg.matchAll(/<path class="fil\d" d="(M2300 1637[^"]+)"/g)][0]?.[1];
if (!eagle) throw new Error('No se encontrÃ³ el trazado del Ã¡guila en el logo oficial.');

const browser = await chromium.launch({ channel: 'chrome' });
const page = await browser.newPage();
await page.setContent(`<svg id="s" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 15521 7269"><path id="p" d="${eagle}"/></svg>`);
const bbox = await page.evaluate(() => { const b = document.getElementById('p').getBBox(); return { x: b.x, y: b.y, w: b.width, h: b.height }; });

const BG = '#1A1A1A', FG = '#FEFEFE';
// scale = fracciÃ³n del lienzo que ocupa el isotipo (zona segura maskable â‰ˆ 60%)
const icon = (size, scale, rounded = false) => {
  const s = (size * scale) / Math.max(bbox.w, bbox.h);
  const tx = (size - bbox.w * s) / 2 - bbox.x * s;
  const ty = (size - bbox.h * s) / 2 - bbox.y * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">`
    + `<rect width="${size}" height="${size}" ${rounded ? `rx="${size * 0.18}"` : ''} fill="${BG}"/>`
    + `<g transform="translate(${tx} ${ty}) scale(${s})" fill="${FG}"><path d="${eagle}"/></g></svg>`;
};

async function png(file, size, scale) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0}</style>${icon(size, scale)}`);
  await page.screenshot({ path: file, omitBackground: false, clip: { x: 0, y: 0, width: size, height: size } });
}

await fs.mkdir('client/icons', { recursive: true });
await png('client/icons/icon-192.png', 192, 0.78);
await png('client/icons/icon-512.png', 512, 0.78);
await png('client/icons/icon-maskable-512.png', 512, 0.56); // zona segura: contenido dentro del 80% central
await png('client/icons/apple-touch-icon.png', 180, 0.78);
await png('client/icons/badge-96.png', 96, 0.78);
await fs.writeFile('client/icons/favicon.svg', icon(64, 0.78, true));
await fs.writeFile('client/icons/isotipo-negativo.svg', icon(512, 0.78, true));
await browser.close();
console.log('Ãconos generados. bbox Ã¡guila:', bbox);


