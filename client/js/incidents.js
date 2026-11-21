// Incidentes públicos: reportes aprobados y no eliminados (visibles sin sesión).
import { html, $, formatDate } from './ui.js';
import { cachedGet } from './api.js';
import { all, clear, get, put } from './db.js';
import { bindGallery, estadoBadge, galleryHtml } from './viewer.js';
import { mapView } from './map.js';

function incidentCard(inc) {
  const thumb = inc.media?.imagenes?.[0];
  return html`
    <article class="card">
      <div class="row spread">
        <span class="badge badge-outline">${inc.categoria}</span>
        ${estadoBadge(inc.estado)}
      </div>
      <div class="row" style="align-items:flex-start;margin-top:.6rem;gap:1rem">
        ${thumb ? html`<img src="${thumb}" alt="${inc.titulo}" style="width:76px;height:76px;object-fit:cover;border-radius:var(--radius);border:1px solid var(--negro-20)" loading="lazy">` : ''}
        <div style="flex:1;min-width:180px">
          <h3 style="margin:0 0 .25rem"><a href="/incidentes/${inc.id}">${inc.titulo}</a></h3>
          <p class="small muted" style="margin:0">${formatDate(inc.creadoEn)}${inc.referencia ? ` · ${inc.referencia}` : ''}</p>
          ${inc.descripcion ? html`<p class="small" style="margin:.35rem 0 0">${inc.descripcion.slice(0, 140)}${inc.descripcion.length > 140 ? '…' : ''}</p>` : ''}
        </div>
      </div>
    </article>`;
}

export async function renderIncidentsHome(host) {
  let items = [];
  let fromCache = false;
  try {
    const res = await cachedGet('/api/incidents', {
      save: async (list) => {
        await clear('incidents');
        for (const item of list) await put('incidents', item);
      },
      fallback: () => all('incidents')
    });
    items = res.data.sort((a, b) => b.creadoEn - a.creadoEn);
    fromCache = res.fromCache;
  } catch {
    items = (await all('incidents')).sort((a, b) => b.creadoEn - a.creadoEn);
    fromCache = true;
  }

  host.innerHTML = html`
    <div class="row spread" style="margin-bottom:.75rem">
      <h2 style="margin:0">Incidentes del campus</h2>
      <span class="small muted">${items.length} publicado${items.length === 1 ? '' : 's'}</span>
    </div>
    ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado.</p>` : ''}
    ${items.length ? items.map(incidentCard) : html`<p class="empty">No hay incidentes publicados todavía.</p>`}`.toString();
}

export async function renderIncidentsPage(main) {
  main.innerHTML = '<div id="inc-wrap"></div>';
  await renderIncidentsHome($('#inc-wrap', main));
}

export async function renderIncidentDetail(main, { id }) {
  let inc = null;
  let fromCache = false;
  try {
    const res = await cachedGet(`/api/incidents/${id}`, {
      save: (item) => put('incidents', item),
      fallback: () => get('incidents', Number(id))
    });
    inc = res.data;
    fromCache = res.fromCache;
  } catch {
    inc = await get('incidents', Number(id));
    fromCache = true;
  }

  if (!inc) {
    main.innerHTML = html`<section class="card"><h1>Incidente no encontrado</h1><p><a href="/?seccion=incidentes">Volver a Incidentes</a></p></section>`.toString();
    return;
  }

  main.innerHTML = html`
    <article class="card card-accent">
      <div class="row spread" style="margin-bottom:.75rem">
        <a class="btn btn-ghost btn-sm" href="/?seccion=incidentes">← Incidentes</a>
        ${estadoBadge(inc.estado)}
      </div>
      ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado.</p>` : ''}
      <span class="badge badge-outline">${inc.categoria}</span>
      <h1 style="margin-top:.5rem">${inc.titulo}</h1>
      <p class="small muted">${formatDate(inc.creadoEn)}${inc.referencia ? ` · ${inc.referencia}` : ''}</p>

      ${inc.estado === 'impedimento' && inc.motivoImpedimento ? html`<p class="notice"><strong>Impedimento:</strong> ${inc.motivoImpedimento}</p>` : ''}
      ${inc.descripcion ? html`<p>${inc.descripcion}</p>` : ''}
      ${inc.media?.audio ? html`<div class="stack"><strong class="ui small">Audio de descripción</strong><audio controls src="${inc.media.audio}" style="width:100%"></audio></div>` : ''}

      ${inc.media?.imagenes?.length ? html`<h2 style="margin-top:1rem">Evidencias</h2>${galleryHtml(inc.media.imagenes, 'Evidencia del incidente')}` : ''}

      ${inc.lat != null && inc.lng != null ? html`<h2 style="margin-top:1rem">Ubicación</h2><div id="inc-map" style="height:240px;border-radius:var(--radius)"></div>` : ''}

      ${inc.estado === 'finalizada' && (inc.solucionTexto || inc.media?.solucionAudio || inc.media?.solucionImagenes?.length) ? html`
        <section class="card" id="sol-box" style="margin-top:1rem;background:var(--amarillo-10)">
          <h2>Solución</h2>
          ${inc.solucionTexto ? html`<p>${inc.solucionTexto}</p>` : ''}
          ${inc.media?.solucionAudio ? html`<audio controls src="${inc.media.solucionAudio}" style="width:100%"></audio>` : ''}
          ${galleryHtml(inc.media?.solucionImagenes || [], 'Evidencia de solución')}
        </section>` : ''}
    </article>`.toString();

  bindGallery(main, inc.media?.imagenes || [], 'Evidencia del incidente');
  if (inc.media?.solucionImagenes?.length) bindGallery($('#sol-box', main), inc.media.solucionImagenes, 'Evidencia de solución');
  if (inc.lat != null && inc.lng != null) await mapView($('#inc-map', main), { lat: inc.lat, lng: inc.lng });
}
