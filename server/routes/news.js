import { Router } from 'express';
import db from '../db/sqlite.js';
import { fetchArticleContent, isAllowedUrl } from '../services/scraper.js';
import { uptcGet } from '../services/uptcFetch.js';

export function serializeNews(row) {
  const categorias = db.prepare('SELECT c.id, c.nombre FROM categories c JOIN news_categories nc ON nc.categoryId = c.id WHERE nc.newsId = ? ORDER BY c.nombre').all(row.id);
  return { ...row, urgente: Boolean(row.urgente), publicada: Boolean(row.publicada), categorias };
}

const router = Router();

// Proxy seguro de imágenes oficiales UPTC (evita bloqueo por Referer/hotlink y usa el CA intermedio).
router.get('/image', async (req, res) => {
  const url = String(req.query.url ?? '').trim();
  if (!isAllowedUrl(url)) return res.status(400).end();
  try {
    const upstream = await uptcGet(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; CampusAlerta-proyecto-academico)', Referer: 'https://www.uptc.edu.co/' },
      timeoutMs: 15000
    });
    const type = String(upstream.headers['content-type'] || '');
    if (!upstream.ok || !type.startsWith('image/')) return res.status(502).end();
    res.set({ 'Content-Type': type, 'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' });
    res.send(upstream.buffer);
  } catch {
    res.status(502).end();
  }
});

// Públicas: solo noticias publicadas. ?categoria= acepta id o nombre.
router.get('/', (req, res) => {
  const cat = String(req.query.categoria ?? '').trim();
  let rows;
  if (cat) {
    rows = db.prepare(`SELECT DISTINCT n.* FROM news n JOIN news_categories nc ON nc.newsId = n.id JOIN categories c ON c.id = nc.categoryId
      WHERE n.publicada = 1 AND (c.id = ? OR c.nombre = ? COLLATE NOCASE) ORDER BY n.fecha DESC, n.id DESC`).all(Number(cat) || -1, cat);
  } else rows = db.prepare('SELECT * FROM news WHERE publicada = 1 ORDER BY fecha DESC, id DESC').all();
  res.json(rows.map(serializeNews));
});

router.get('/:id', async (req, res) => {
  const row = db.prepare('SELECT * FROM news WHERE id = ? AND publicada = 1').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Noticia no encontrada.' });
  if ((!row.contenido || row.contenido === row.resumen) && isAllowedUrl(row.fuenteUrl)) {
    const full = await fetchArticleContent(row.fuenteUrl);
    if (full && full.length > (row.contenido || '').length) {
      db.prepare('UPDATE news SET contenido = ? WHERE id = ?').run(full, row.id);
      row.contenido = full;
    }
  }
  res.json(serializeNews(row));
});

export default router;
