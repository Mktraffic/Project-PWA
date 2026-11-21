// Panel de administración (solo rol === 'admin'). Todas las rutas validan requireAdmin en el servidor.
import { html, raw, $, $$, toast, formatDate } from './ui.js';
import { icons } from './icons.js';
import { api } from './api.js';
import { photoPicker } from './camera.js';
import { audioRecorder } from './audio.js';
import { mapView } from './map.js';
import { aprobacionBadge, bindGallery, estadoBadge, galleryHtml } from './viewer.js';
import { MOTIVO_MAX, REPORT_CATEGORIES } from '../../shared/constants.js';

export async function renderAdmin(main, { tab = 'noticias' } = {}) {
  main.innerHTML = html`
    <div class="page-head">
      <h1>Panel de administración</h1>
      <p class="muted">Gestión de noticias oficiales UPTC, categorías y reportes del campus.</p>
    </div>
    <div class="seg" role="tablist" aria-label="Módulos de administración" style="max-width:28rem">
      <button role="tab" data-tab="noticias" aria-selected="${tab === 'noticias'}">Gestionar noticias</button>
      <button role="tab" data-tab="reportes" aria-selected="${tab === 'reportes'}">Gestionar reportes</button>
    </div>
    <div id="admin-body" role="tabpanel"></div>`.toString();

  const body = $('#admin-body', main);
  const switchTab = async (t) => {
    $$('.seg button', main).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
    if (t === 'noticias') await renderAdminNews(body);
    else await renderAdminReports(body);
  };
  $$('.seg button', main).forEach((b) => b.addEventListener('click', () => switchTab(b.dataset.tab)));
  await switchTab(tab);
}

/* ==========================================================================
   A) Gestionar noticias y categorías
   ========================================================================== */
async function renderAdminNews(host) {
  const [categories, published] = await Promise.all([api('/api/categories'), api('/api/admin/news')]);
  let scraped = null;

  host.innerHTML = html`
    <section class="card card-accent">
      <h2>Importar noticias oficiales UPTC</h2>
      <p class="small muted">Consulta el portal de noticias de la UPTC, elige cuáles publicar, asigna categorías y márcalas como urgentes si aplica.</p>
      <form id="scrape-form" class="row" novalidate style="align-items:flex-end">
        <div class="field" style="margin:0;max-width:12rem">
          <label for="news-limit"><span class="label">Cantidad de noticias (1–20)</span></label>
          <input id="news-limit" name="limit" type="number" min="1" max="20" value="5" required>
        </div>
        <button type="submit" class="btn" id="btn-scrape">Consultar noticias</button>
      </form>
      <div id="scrape-status" style="margin-top:.75rem"></div>
      <div id="scrape-list" class="stack" style="margin-top:.75rem"></div>
    </section>

    <section class="card">
      <h2>Noticias publicadas (${published.length})</h2>
      <div id="pub-list" class="stack">
        ${published.length ? published.map((n) => html`
          <article class="card ${n.urgente ? 'urgent' : ''}" style="margin:0">
            <div class="row spread">
              <div>
                <strong>${n.titulo}</strong>
                <div class="small muted">${formatDate(n.fecha)} · ${(n.categorias || []).map((c) => c.nombre).join(', ')}${n.urgente ? ' · URGENTE' : ''}</div>
              </div>
              <button type="button" class="btn btn-dark btn-sm" data-unpub="${n.id}">Despublicar</button>
            </div>
          </article>`) : html`<p class="empty small">No hay noticias publicadas.</p>`}
      </div>
    </section>

    <section class="card">
      <h2>Categorías de noticias</h2>
      <form id="new-cat-form" class="row" style="margin-bottom:.75rem">
        <input id="new-cat-name" type="text" maxlength="40" placeholder="Nueva categoría" style="flex:1;min-width:160px;min-height:44px;padding:.5rem .75rem;border:2px solid var(--negro-40);border-radius:var(--radius)" required>
        <button type="submit" class="btn btn-sm">Crear categoría</button>
      </form>
      <div class="stack" id="cat-admin-list">
        ${categories.map((c) => html`
          <form class="row cat-edit-form" data-id="${c.id}">
            <input type="text" value="${c.nombre}" maxlength="40" style="flex:1;min-width:140px;min-height:40px;padding:.35rem .6rem;border:1px solid var(--negro-40);border-radius:var(--radius)" required aria-label="Nombre de categoría ${c.nombre}">
            <button type="submit" class="btn btn-ghost btn-sm">Guardar</button>
          </form>`)}
      </div>
    </section>`.toString();

  const drawScraped = () => {
    const listEl = $('#scrape-list', host);
    if (!scraped) { listEl.innerHTML = ''; return; }
    listEl.innerHTML = scraped.map((item, idx) => html`
      <article class="card" style="margin:0;${item.publicadaId ? 'opacity:.65;background:var(--negro-10)' : ''}">
        <div class="row" style="align-items:flex-start;gap:.75rem">
          ${item.imagenUrl ? html`<img src="/api/news/image?url=${encodeURIComponent(item.imagenUrl)}" alt="" style="width:72px;height:72px;object-fit:cover;border-radius:var(--radius)">` : ''}
          <div style="flex:1;min-width:200px">
            <strong>${idx + 1}. ${item.titulo}</strong>
            <p class="small muted" style="margin:.2rem 0">${formatDate(item.fecha)} · ${item.resumen || ''}</p>
            ${item.publicadaId
              ? html`<span class="badge badge-amarillo">${raw(icons.check)} Ya publicada</span>`
              : html`
                <div class="row" style="margin:.5rem 0;gap:.5rem .9rem">
                  ${categories.map((c) => html`
                    <label class="ui small" style="display:inline-flex;align-items:center;gap:.3rem;cursor:pointer">
                      <input type="checkbox" class="sc-cat" data-idx="${idx}" value="${c.id}"> ${c.nombre}
                    </label>`)}
                </div>
                <div class="row spread">
                  <label class="ui small" style="display:inline-flex;align-items:center;gap:.35rem;cursor:pointer">
                    <input type="checkbox" class="sc-urg" data-idx="${idx}"> Marcar como urgente
                  </label>
                  <button type="button" class="btn btn-sm sc-pub" data-idx="${idx}">Publicar y notificar</button>
                </div>`}
          </div>
        </div>
      </article>`).join('');

    $$('.sc-pub', listEl).forEach((btn) => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.idx);
        const item = scraped[idx];
        const cats = $$(`.sc-cat[data-idx="${idx}"]:checked`, listEl).map((i) => Number(i.value));
        const urgente = $(`.sc-urg[data-idx="${idx}"]`, listEl).checked;
        if (!cats.length) { toast('Asigna al menos una categoría antes de publicar.'); return; }
        btn.disabled = true;
        try {
          const res = await api('/api/admin/news', { method: 'POST', body: { ...item, categorias: cats, urgente } });
          toast(`Noticia publicada. Push enviados: ${res.push?.enviados ?? 0}.`);
          await renderAdminNews(host);
        } catch (e) {
          toast(e.message);
          btn.disabled = false;
        }
      });
    });
  };

  $('#scrape-form', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const n = Number($('#news-limit', host).value);
    if (!Number.isInteger(n) || n < 1 || n > 20) {
      toast('La cantidad de noticias debe ser un entero entre 1 y 20.');
      return;
    }
    const btn = $('#btn-scrape', host);
    const status = $('#scrape-status', host);
    btn.disabled = true;
    status.innerHTML = '<p class="small muted">Consultando portal UPTC…</p>';
    try {
      const data = await api(`/api/admin/uptc-news?limit=${n}`);
      scraped = data.items;
      status.innerHTML = data.aviso
        ? html`<p class="notice">${data.aviso}</p>`.toString()
        : data.cached ? '<p class="small muted">Mostrando resultado en caché reciente.</p>' : '';
      drawScraped();
    } catch (err) {
      scraped = null;
      drawScraped();
      status.innerHTML = html`<p class="notice">${err.message}</p>`.toString();
    } finally {
      btn.disabled = false;
    }
  });

  $$('[data-unpub]', host).forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/admin/news/${btn.dataset.unpub}`, { method: 'DELETE' });
        toast('Noticia despublicada.');
        await renderAdminNews(host);
      } catch (e) { toast(e.message); }
    });
  });

  $('#new-cat-form', host).addEventListener('submit', async (e) => {
    e.preventDefault();
    const nombre = $('#new-cat-name', host).value.trim();
    if (!nombre) return;
    try {
      await api('/api/categories', { method: 'POST', body: { nombre } });
      toast('Categoría creada.');
      await renderAdminNews(host);
    } catch (err) { toast(err.message); }
  });

  $$('.cat-edit-form', host).forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const nombre = form.querySelector('input').value.trim();
      try {
        await api(`/api/categories/${form.dataset.id}`, { method: 'PUT', body: { nombre } });
        toast('Categoría actualizada.');
        await renderAdminNews(host);
      } catch (err) { toast(err.message); }
    });
  });
}

/* ==========================================================================
   B) Gestionar reportes (activos y eliminados)
   ========================================================================== */
async function renderAdminReports(host) {
  let subTab = 'activos';
  let filters = { estado: '', categoria: '', desde: '', hasta: '' };
  let activeDetailId = null;
  let detailCleanup = [];

  const cleanup = () => { detailCleanup.forEach((fn) => fn?.()); detailCleanup = []; };

  const loadList = async () => {
    if (subTab === 'eliminados') return api('/api/admin/reports?eliminados=true');
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) if (v) q.set(k, v);
    return api(`/api/admin/reports?${q.toString()}`);
  };

  const draw = async () => {
    cleanup();
    const items = await loadList();
    const detail = activeDetailId ? items.find((r) => r.id === activeDetailId) : null;

    host.innerHTML = html`
      <div class="row" style="margin-bottom:.75rem">
        <button type="button" class="chip" data-sub="activos" aria-pressed="${subTab === 'activos'}">Reportes activos</button>
        <button type="button" class="chip" data-sub="eliminados" aria-pressed="${subTab === 'eliminados'}">Reportes eliminados (consulta)</button>
      </div>

      ${subTab === 'activos' ? html`
        <form id="rep-filters" class="card row" style="gap:.6rem;align-items:flex-end">
          <label class="ui small">Estado<br>
            <select name="estado" style="min-height:38px;padding:.25rem .5rem;border:1px solid var(--negro-40);border-radius:var(--radius)">
              <option value="">Todos</option>
              <option value="pendiente" ${filters.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
              <option value="en_proceso" ${filters.estado === 'en_proceso' ? 'selected' : ''}>En proceso</option>
              <option value="finalizada" ${filters.estado === 'finalizada' ? 'selected' : ''}>Finalizada</option>
              <option value="impedimento" ${filters.estado === 'impedimento' ? 'selected' : ''}>Impedimento</option>
            </select>
          </label>
          <label class="ui small">Categoría<br>
            <select name="categoria" style="min-height:38px;padding:.25rem .5rem;border:1px solid var(--negro-40);border-radius:var(--radius)">
              <option value="">Todas</option>
              ${REPORT_CATEGORIES.map((c) => html`<option value="${c}" ${filters.categoria === c ? 'selected' : ''}>${c}</option>`)}
            </select>
          </label>
          <label class="ui small">Desde<br><input name="desde" type="date" value="${filters.desde}" style="min-height:38px;padding:.25rem .5rem;border:1px solid var(--negro-40);border-radius:var(--radius)"></label>
          <label class="ui small">Hasta<br><input name="hasta" type="date" value="${filters.hasta}" style="min-height:38px;padding:.25rem .5rem;border:1px solid var(--negro-40);border-radius:var(--radius)"></label>
          <button type="submit" class="btn btn-sm">Filtrar</button>
        </form>` : html`<p class="small muted">Solo lectura. Aquí permanecen los reportes eliminados lógicamente.</p>`}

      <div id="admin-rep-detail"></div>

      <div class="stack" id="admin-rep-list">
        ${items.length ? items.map((r) => html`
          <article class="card" style="margin:0">
            <div class="row spread">
              <div class="row">
                <span class="badge badge-outline">${r.categoria}</span>
                ${aprobacionBadge(r.aprobacion)}
                ${r.aprobacion === 'aprobado' ? estadoBadge(r.estado) : ''}
              </div>
              <span class="small muted">${formatDate(r.creadoEn)}</span>
            </div>
            <h3 style="margin:.45rem 0 .2rem">${r.titulo}</h3>
            <p class="small muted" style="margin:0">Autor: ${r.autor?.nombre || '—'} (${r.autor?.codigo || '—'})</p>
            <div class="row" style="margin-top:.6rem">
              <button type="button" class="btn btn-ghost btn-sm" data-open="${r.id}">Ver detalle y gestionar</button>
            </div>
          </article>`) : html`<p class="empty small">No hay reportes que coincidan.</p>`}
      </div>`.toString();

    $$('[data-sub]', host).forEach((b) => b.addEventListener('click', () => { subTab = b.dataset.sub; activeDetailId = null; draw(); }));
    $('#rep-filters', host)?.addEventListener('submit', (e) => {
      e.preventDefault();
      filters = Object.fromEntries(new FormData(e.currentTarget));
      activeDetailId = null;
      draw();
    });
    $$('[data-open]', host).forEach((b) => b.addEventListener('click', () => { activeDetailId = Number(b.dataset.open); draw(); }));

    if (detail) await renderAdminReportDetail($('#admin-rep-detail', host), detail, subTab === 'eliminados', detailCleanup, () => { activeDetailId = null; draw(); }, draw);
  };

  await draw();
}

async function renderAdminReportDetail(slot, r, readOnly, cleanups, onClose, onReload) {
  const solState = { fotos: [], audio: null };
  const canDelete = r.aprobacion === 'aprobado' && r.estado === 'finalizada';

  slot.innerHTML = html`
    <article class="card card-accent" style="margin-bottom:1rem">
      <div class="row spread" style="margin-bottom:.5rem">
        <h2 style="margin:0">Detalle del reporte #${r.id}</h2>
        <button type="button" class="btn btn-ghost btn-sm" id="adm-close">Cerrar</button>
      </div>
      <div class="row" style="margin-bottom:.5rem">
        <span class="badge badge-outline">${r.categoria}</span>
        ${aprobacionBadge(r.aprobacion)}
        ${r.aprobacion === 'aprobado' ? estadoBadge(r.estado) : ''}
      </div>
      <h3>${r.titulo}</h3>
      <p class="small muted">Autor: ${r.autor?.nombre || '—'} · Código ${r.autor?.codigo || '—'} · ${r.autor?.correo || ''} · ${formatDate(r.creadoEn)}</p>
      ${r.referencia ? html`<p class="small"><strong>Referencia:</strong> ${r.referencia}</p>` : ''}
      ${r.descripcion ? html`<p>${r.descripcion}</p>` : ''}
      ${r.media?.audio ? html`<audio controls src="${r.media.audio}" style="width:100%;margin:.5rem 0"></audio>` : ''}
      ${galleryHtml(r.media?.imagenes || [], 'Evidencia')}
      ${r.lat != null && r.lng != null ? html`<div id="adm-map" style="height:220px;margin:.75rem 0;border-radius:var(--radius)"></div>` : ''}

      ${r.motivoRechazo ? html`<p class="notice"><strong>Motivo de rechazo:</strong> ${r.motivoRechazo}</p>` : ''}
      ${r.motivoImpedimento ? html`<p class="notice"><strong>Motivo de impedimento:</strong> ${r.motivoImpedimento}</p>` : ''}
      ${r.solucionTexto || r.media?.solucionImagenes?.length ? html`
        <div class="card" style="background:var(--amarillo-10)">
          <strong>Solución registrada:</strong>
          ${r.solucionTexto ? html`<p>${r.solucionTexto}</p>` : ''}
          ${r.media?.solucionAudio ? html`<audio controls src="${r.media.solucionAudio}" style="width:100%"></audio>` : ''}
          ${galleryHtml(r.media?.solucionImagenes || [], 'Solución')}
        </div>` : ''}

      ${!readOnly ? html`
        <hr style="border:0;border-top:1px solid var(--negro-20);margin:1rem 0">
        <h3>1. Aprobación</h3>
        <div class="row" style="margin-bottom:.75rem">
          <button type="button" class="btn btn-sm" id="adm-approve">${raw(icons.check)} Aprobar (publicar incidente)</button>
        </div>
        <form id="adm-reject-form" class="row" style="align-items:flex-end;margin-bottom:1rem" novalidate>
          <div class="field" style="flex:1;min-width:200px;margin:0">
            <label for="adm-reject-reason"><span class="label">Observaciones de rechazo *</span></label>
            <input id="adm-reject-reason" type="text" maxlength="${MOTIVO_MAX}" placeholder="Motivo corto para el autor" required>
          </div>
          <button type="submit" class="btn btn-dark btn-sm">${raw(icons.x)} Desaprobar</button>
        </form>

        ${r.aprobacion === 'aprobado' ? html`
          <h3>2. Actualizar estado</h3>
          <form id="adm-estado-form" class="stack">
            <div class="field" style="margin:0">
              <label for="adm-estado"><span class="label">Nuevo estado</span></label>
              <select id="adm-estado" name="estado">
                <option value="pendiente" ${r.estado === 'pendiente' ? 'selected' : ''}>Pendiente</option>
                <option value="en_proceso" ${r.estado === 'en_proceso' ? 'selected' : ''}>En proceso</option>
                <option value="finalizada" ${r.estado === 'finalizada' ? 'selected' : ''}>Finalizada</option>
                <option value="impedimento" ${r.estado === 'impedimento' ? 'selected' : ''}>Impedimento</option>
              </select>
            </div>
            <div id="adm-sol-box" hidden class="stack">
              <div class="field" style="margin:0">
                <label for="adm-sol-text"><span class="label">Solución en texto (o graba un audio abajo)</span></label>
                <textarea id="adm-sol-text" rows="2" placeholder="Describe la solución aplicada…">${r.solucionTexto || ''}</textarea>
              </div>
              <div id="adm-sol-audio"></div>
              <div id="adm-sol-photos"></div>
            </div>
            <div class="row spread">
              <button type="submit" class="btn btn-sm">Guardar estado y notificar</button>
              ${canDelete ? html`<button type="button" class="btn btn-dark btn-sm" id="adm-delete">${raw(icons.trash)} Eliminar (borrado lógico)</button>` : html`<span class="small muted">Solo se puede eliminar cuando está aprobado y finalizado.</span>`}
            </div>
          </form>` : html`<p class="small muted">Aprueba el reporte para poder cambiar su estado o publicarlo como incidente.</p>`}
      ` : ''}
    </article>`.toString();

  bindGallery(slot, r.media?.imagenes || [], 'Evidencia');
  if (r.lat != null && r.lng != null) {
    const m = await mapView($('#adm-map', slot), { lat: r.lat, lng: r.lng });
    cleanups.push(() => m.destroy());
  }
  $('#adm-close', slot).onclick = onClose;
  if (readOnly) return;

  $('#adm-approve', slot).onclick = async () => {
    try {
      await api(`/api/admin/reports/${r.id}/aprobacion`, { method: 'PATCH', body: { aprobacion: 'aprobado' } });
      toast('Reporte aprobado y publicado como incidente.');
      await onReload();
    } catch (e) { toast(e.message); }
  };

  $('#adm-reject-form', slot).onsubmit = async (e) => {
    e.preventDefault();
    const input = $('#adm-reject-reason', slot);
    const motivoRechazo = input.value.trim();
    if (!motivoRechazo) { toast('Las observaciones de rechazo son obligatorias.'); input.focus(); return; }
    try {
      await api(`/api/admin/reports/${r.id}/aprobacion`, { method: 'PATCH', body: { aprobacion: 'rechazado', motivoRechazo } });
      toast('Reporte desaprobado.');
      await onReload();
    } catch (err) { toast(err.message); }
  };

  if (r.aprobacion === 'aprobado') {
    const sel = $('#adm-estado', slot);
    const solBox = $('#adm-sol-box', slot);
    const pCtrl = photoPicker($('#adm-sol-photos', slot), solState, { min: 1, max: 3, label: 'Evidencias de la solución *' });
    const aCtrl = audioRecorder($('#adm-sol-audio', slot), solState, { label: 'Solución en audio (opcional si escribes texto)' });
    cleanups.push(() => pCtrl.destroy(), () => aCtrl.destroy());

    const syncBoxes = () => { solBox.hidden = sel.value !== 'finalizada'; };
    sel.addEventListener('change', syncBoxes);
    syncBoxes();

    $('#adm-estado-form', slot).onsubmit = async (e) => {
      e.preventDefault();
      const fd = new FormData();
      fd.append('estado', sel.value);
      if (sel.value === 'finalizada') {
        const txt = $('#adm-sol-text', slot).value.trim();
        if (txt) fd.append('solucionTexto', txt);
        solState.fotos.forEach((b, i) => fd.append('fotos', b, `sol-${i + 1}.jpg`));
        if (solState.audio) fd.append('audio', solState.audio, 'solucion.webm');
      }
      try {
        await api(`/api/admin/reports/${r.id}/estado`, { method: 'PATCH', formData: fd });
        toast('Estado actualizado y autor notificado.');
        await onReload();
      } catch (err) { toast(err.message); }
    };

    $('#adm-delete', slot)?.addEventListener('click', async () => {
      try {
        await api(`/api/admin/reports/${r.id}`, { method: 'DELETE' });
        toast('Reporte eliminado lógicamente.');
        onClose();
      } catch (err) { toast(err.message); }
    });
  }
}
