// Noticias: listado con filtro por categoría (chips), destacadas urgentes, lectura offline y detalle.
import { html, raw, $, $$, formatDate } from './ui.js';
import { icons } from './icons.js';
import { cachedGet } from './api.js';
import { all, clear, get, getSetting, put, setSetting } from './db.js';
import { isLoggedIn } from './auth.js';

async function loadCategories() {
  try {
    const res = await cachedGet('/api/categories', {
      save: (cats) => setSetting('categoriesCache', cats),
      fallback: () => getSetting('categoriesCache', [])
    });
    return res.data;
  } catch {
    return await getSetting('categoriesCache', []);
  }
}

async function loadNews() {
  try {
    const res = await cachedGet('/api/news', {
      save: async (list) => {
        await clear('news');
        for (const item of list) {
          await put('news', { ...item, catIds: (item.categorias || []).map((c) => c.id) });
        }
      },
      fallback: () => all('news')
    });
    return { items: res.data.sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id), fromCache: res.fromCache };
  } catch {
    const items = (await all('news')).sort((a, b) => (b.fecha || '').localeCompare(a.fecha || '') || b.id - a.id);
    return { items, fromCache: true };
  }
}

const newsImg = (url) => (url && /^https:\/\//i.test(url) ? `/api/news/image?url=${encodeURIComponent(url)}` : url);

function newsCard(n) {
  return html`
    <article class="card ${n.urgente ? 'urgent' : ''}">
      <div class="row spread" style="margin-bottom:.4rem">
        <div class="row">
          ${n.urgente ? html`<span class="badge badge-negro">${raw(icons.alert)} Urgente</span>` : ''}
          ${(n.categorias || []).map((c) => html`<span class="badge badge-outline">${c.nombre}</span>`)}
        </div>
        <span class="small muted">${formatDate(n.fecha)}</span>
      </div>
      <div class="row" style="align-items:flex-start;gap:1rem">
        ${n.imagenUrl ? html`<img src="${newsImg(n.imagenUrl)}" alt="${n.titulo}" style="width:92px;height:92px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--negro-20)" loading="lazy">` : ''}
        <div style="flex:1;min-width:190px">
          <h3 style="margin:0 0 .35rem"><a href="/noticias/${n.id}">${n.titulo}</a></h3>
          ${n.resumen ? html`<p class="small" style="margin:0">${n.resumen}</p>` : ''}
        </div>
      </div>
    </article>`;
}

export async function renderNewsHome(host) {
  const [categories, { items, fromCache }] = await Promise.all([loadCategories(), loadNews()]);
  let selectedCat = '';

  const drawList = () => {
    const filtered = selectedCat
      ? items.filter((n) => (n.categorias || []).some((c) => String(c.id) === selectedCat))
      : items;
    $('#news-list', host).innerHTML = filtered.length
      ? filtered.map(newsCard).join('')
      : html`<p class="empty">No hay noticias en esta categoría.</p>`.toString();
  };

  host.innerHTML = html`
    <div class="row spread" style="margin-bottom:.75rem">
      <h2 style="margin:0">Noticias UPTC</h2>
      ${isLoggedIn() ? html`<a class="btn btn-ghost btn-sm" href="/preferencias">${raw(icons.bell)} Preferencias</a>` : ''}
    </div>
    ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado.</p>` : ''}
    <div class="row" role="group" aria-label="Filtrar por categoría" style="margin-bottom:1rem">
      <button type="button" class="chip" data-cat="" aria-pressed="true">Todas</button>
      ${categories.map((c) => html`<button type="button" class="chip" data-cat="${c.id}" aria-pressed="false">${c.nombre}</button>`)}
    </div>
    <div id="news-list"></div>`.toString();

  $$('.chip', host).forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedCat = btn.dataset.cat;
      $$('.chip', host).forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
      drawList();
    });
  });

  drawList();
}

export async function renderNewsPage(main) {
  main.innerHTML = '<div id="news-wrap"></div>';
  await renderNewsHome($('#news-wrap', main));
}

export async function renderNewsDetail(main, { id }) {
  let item = null;
  let fromCache = false;
  try {
    const res = await cachedGet(`/api/news/${id}`, {
      save: (n) => put('news', { ...n, catIds: (n.categorias || []).map((c) => c.id), leida: true }),
      fallback: () => get('news', Number(id))
    });
    item = res.data;
    fromCache = res.fromCache;
  } catch {
    item = await get('news', Number(id));
    fromCache = true;
  }

  if (!item) {
    main.innerHTML = html`<section class="card"><h1>Noticia no encontrada</h1><p><a href="/">Volver a Noticias</a></p></section>`.toString();
    return;
  }

  const paragraphs = String(item.contenido || item.resumen || '').split(/\n{2,}/).filter(Boolean);

  main.innerHTML = html`
    <article class="card ${item.urgente ? 'urgent' : 'card-accent'}">
      <div class="row spread" style="margin-bottom:.75rem">
        <a class="btn btn-ghost btn-sm" href="/">← Noticias</a>
        <div class="row">
          ${item.urgente ? html`<span class="badge badge-negro">${raw(icons.alert)} Urgente</span>` : ''}
          ${(item.categorias || []).map((c) => html`<span class="badge badge-outline">${c.nombre}</span>`)}
        </div>
      </div>
      ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado.</p>` : ''}
      <h1>${item.titulo}</h1>
      <p class="small muted">Publicado el ${formatDate(item.fecha)}</p>
      ${item.imagenUrl ? html`<img src="${newsImg(item.imagenUrl)}" alt="${item.titulo}" style="width:100%;max-height:360px;object-fit:cover;border-radius:var(--radius);margin:.75rem 0;border:1px solid var(--negro-20)">` : ''}
      <div class="stack" style="margin-top:.75rem">
        ${paragraphs.map((p) => html`<p>${p}</p>`)}
      </div>
      ${item.fuenteUrl ? html`<p class="small muted" style="margin-top:1.25rem;border-top:1px solid var(--negro-20);padding-top:.75rem">Fuente original UPTC: <a href="${item.fuenteUrl}" target="_blank" rel="noopener noreferrer">${item.fuenteUrl}</a></p>` : ''}
    </article>`.toString();
}
