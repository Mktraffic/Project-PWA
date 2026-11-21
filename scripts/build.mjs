// Build: empaqueta el cliente con esbuild a client/dist, copia estÃ¡ticos y genera el service worker versionado.
import esbuild from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const out = 'client/dist';
await fs.rm(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
await fs.mkdir(`${out}/assets`, { recursive: true });

// 1) AplicaciÃ³n (ESM con divisiÃ³n de cÃ³digo; Leaflet se carga bajo demanda)
await esbuild.build({
  entryPoints: { app: 'client/js/app.js' }, bundle: true, format: 'esm', splitting: true, minify: true,
  outdir: `${out}/assets`, entryNames: '[name]', chunkNames: 'chunk-[hash]', sourcemap: false, target: 'es2020', logLevel: 'warning'
});

// 2) EstÃ¡ticos
await fs.cp('client/css', `${out}/css`, { recursive: true });
await fs.cp('client/icons', `${out}/icons`, { recursive: true });
await fs.cp('client/img', `${out}/img`, { recursive: true });
for (const f of ['offline.html', 'manifest.webmanifest', 'robots.txt', 'index.html']) await fs.copyFile(`client/${f}`, `${out}/${f}`);
await fs.mkdir(`${out}/fonts`, { recursive: true });
for (const style of ['400-normal', '400-italic', '700-normal', '700-italic']) {
  await fs.copyFile(`node_modules/@fontsource/tinos/files/tinos-latin-${style}.woff2`, `${out}/fonts/tinos-latin-${style}.woff2`);
}
// Si existe la fuente oficial licenciada en client/fonts, tambiÃ©n se incluye.
try { await fs.cp('client/fonts', `${out}/fonts`, { recursive: true }); } catch { /* opcional */ }
await fs.mkdir(`${out}/vendor/leaflet/images`, { recursive: true });
await fs.copyFile('node_modules/leaflet/dist/leaflet.css', `${out}/vendor/leaflet/leaflet.css`);
await fs.cp('node_modules/leaflet/dist/images', `${out}/vendor/leaflet/images`, { recursive: true });

// 3) Lista de precachÃ© y versiÃ³n (hash del contenido)
async function walk(dir) {
  const files = [];
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files.push(...(await walk(p))); else files.push(p);
  }
  return files;
}
const all = (await walk(out)).map((p) => p.replace(/\\/g, '/'));
const urlOf = (p) => `/${p.slice(out.length + 1)}`;
const precache = ['/', ...all.map(urlOf).filter((u) => !/\.map$|^\/robots\.txt$/.test(u) && !u.startsWith('/vendor/leaflet/images/layers-2x'))];
const hash = crypto.createHash('sha256');
for (const p of all.sort()) hash.update(p).update(await fs.readFile(p));
const version = hash.digest('hex').slice(0, 10);

// 4) Service worker (iife, con idb incluido para leer el token / outbox en segundo plano)
await esbuild.build({
  entryPoints: ['client/sw.js'], bundle: true, format: 'iife', minify: true, outfile: `${out}/sw.js`, target: 'es2020', logLevel: 'warning',
  define: { __VERSION__: JSON.stringify(version), __PRECACHE__: JSON.stringify(precache) }
});
console.log(`Build completado Â· versiÃ³n ${version} Â· ${precache.length} recursos en precachÃ©`);

