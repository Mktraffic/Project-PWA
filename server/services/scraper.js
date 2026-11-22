// Scraping de noticias oficiales de la UPTC con cheerio.
// Selectores definidos inspeccionando el HTML real (ver docs/fixtures/uptc-index.html):
//   lista:    ul.list-entries > li.list-entry   (8 por página; paginación ?reloaded&sort=date_desc&page=N)
//   título:   .heading .headline         resumen: .teaser-text       fecha: .teaser-date (dd/mm/aaaa)
//   imagen:   .visual img[src]           enlace:  .heading a[href]
//   detalle:  .detail-content .text.body p   (contenido completo)
import * as cheerio from 'cheerio';
import { config } from '../config.js';

export const SOURCE_URL = 'https://www.uptc.edu.co/sitio/portal/cal_not_eve/cal_not/index.html';
const ORIGIN = 'https://www.uptc.edu.co';
const TTL_MS = 5 * 60 * 1000;
const PER_PAGE = 8;
const UA = 'Mozilla/5.0 (compatible; CampusAlerta-proyecto-academico)';

export class ScrapeError extends Error {
  constructor(message, status = 502) { super(message); this.status = status; this.expose = true; }
}

let fetcher = async (url) => {
  const res = await fetch(url, {
    headers: {
      'User-Agent': UA,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'es-CO,es;q=0.9,en;q=0.8'
    },
    signal: AbortSignal.timeout(25000)
  });
  if (!res.ok) throw new ScrapeError(`El sitio de la UPTC respondió con el estado ${res.status}.`);
  return res.text();
};
export function setFetcher(fn) { fetcher = fn; cache.clear(); } // pruebas

const cache = new Map(); // clave -> { at, data }

export function isAllowedUrl(value) {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && config.allowedHosts.includes(u.hostname.toLowerCase());
  } catch { return false; }
}

const abs = (href) => (href ? new URL(href, ORIGIN).href : null);
const clean = (t) => String(t || '').replace(/\s+/g, ' ').trim();

function toIsoDate(text) {
  const m = clean(text).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}` : null;
}

export function parseList(html) {
  const $ = cheerio.load(html);
  const items = [];
  $('ul.list-entries > li.list-entry').each((_, el) => {
    const $el = $(el);
    const titulo = clean($el.find('.heading .headline').first().text() || $el.find('.heading a').attr('title'));
    const url = abs($el.find('.heading a').attr('href'));
    if (!titulo || !url) return;
    items.push({
      titulo,
      resumen: clean($el.find('.teaser-text').first().text()),
      fecha: toIsoDate($el.find('.teaser-date').first().text()),
      imagenUrl: abs($el.find('.visual img').first().attr('src')),
      fuenteUrl: url
    });
  });
  return items;
}

export function parseDetail(html) {
  const $ = cheerio.load(html);
  const paragraphs = $('.type-article .body .text p, .detail-content .body .text p, .body.default .text p')
    .map((_, p) => clean($(p).text()))
    .get()
    .filter(Boolean);
  if (paragraphs.length) return paragraphs.join('\n\n');
  // Respaldo: JSON-LD articleBody si existe
  for (const el of $('script[type="application/ld+json"]').toArray()) {
    try {
      const data = JSON.parse($(el).text());
      const body = Array.isArray(data.articleBody) ? data.articleBody.join('\n') : data.articleBody;
      if (body) return cheerio.load(String(body))('p').map((_, p) => clean($(p).text())).get().filter(Boolean).join('\n\n') || clean(body);
    } catch { /* ignorar */ }
  }
  return '';
}

/** Lista las últimas `limit` noticias (1–20), con caché de unos minutos. */
export async function fetchUptcNews(limit = 5) {
  const n = Math.min(20, Math.max(1, Number(limit) || 5));
  const pages = Math.ceil(n / PER_PAGE);
  const key = `list:${pages}`;
  let all = cache.get(key);
  const fresh = all && Date.now() - all.at < TTL_MS;
  if (!fresh) {
    try {
      const results = [];
      for (let page = 1; page <= pages; page++) {
        const html = await fetcher(`${SOURCE_URL}?reloaded&sort=date_desc&page=${page}`);
        const items = parseList(html);
        if (!items.length && page === 1) throw new ScrapeError('No se encontraron noticias: es posible que la estructura del sitio de la UPTC haya cambiado. Revisa los selectores en server/services/scraper.js.', 502);
        results.push(...items);
      }
      all = { at: Date.now(), data: results };
      cache.set(key, all);
    } catch (error) {
      if (all) return { items: all.data.slice(0, n), cached: true, aviso: 'No se pudo actualizar desde la UPTC; se muestran datos en caché.' };
      if (error instanceof ScrapeError) throw error;
      const reason = error.cause?.code || error.cause?.message || error.message;
      console.warn('Scraper UPTC error:', reason);
      throw new ScrapeError(`No se pudo consultar el sitio de la UPTC (${reason}). Verifica tu conexión e inténtalo de nuevo.`, 502);
    }
  }
  return { items: all.data.slice(0, n), cached: Boolean(fresh) };
}

/** Contenido completo de una noticia (mejor esfuerzo; si falla se usará el resumen). */
export async function fetchArticleContent(url) {
  if (!isAllowedUrl(url)) return '';
  try { return parseDetail(await fetcher(url)); } catch { return ''; }
}
