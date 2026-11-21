// Módulo de reportes del usuario: crear reporte (online/offline), "Mis reportes" y detalle.
import { html, raw, $, $$, toast, formatDate } from './ui.js';
import { icons } from './icons.js';
import { api, cachedGet } from './api.js';
import { all, get, put } from './db.js';
import { isLoggedIn } from './auth.js';
import { photoPicker } from './camera.js';
import { audioRecorder } from './audio.js';
import { getPosition } from './geo.js';
import { mapView } from './map.js';
import { enqueueReport, requestBackgroundSync, sendReportRecord, showLocalNotification, syncOutbox } from './sync.js';
import { aprobacionBadge, bindGallery, estadoBadge, galleryHtml } from './viewer.js';
import { DESC_MAX, REPORT_CATEGORIES, TITLE_MAX } from '../../shared/constants.js';

/** Carga "Mis reportes": Network First con respaldo en IndexedDB, más los pendientes locales (outbox). */
async function loadMyReports() {
  let serverList = [];
  let fromCache = false;
  if (isLoggedIn()) {
    try {
      const res = await cachedGet('/api/reports', {
        save: async (list) => {
          for (const item of list) {
            const existing = (await all('reports')).find((r) => r.serverId === item.id);
            await put('reports', {
              ...existing,
              ...item,
              localId: existing?.localId || `srv-${item.id}`,
              serverId: item.id,
              synced: true
            });
          }
        },
        fallback: async () => (await all('reports')).filter((r) => r.synced)
      });
      serverList = res.data.map((r) => ({ ...r, synced: true }));
      fromCache = res.fromCache;
    } catch {
      serverList = (await all('reports')).filter((r) => r.synced);
      fromCache = true;
    }
  }
  const unsynced = (await all('reports')).filter((r) => r.synced === false);
  const combined = [...unsynced, ...serverList].sort((a, b) => b.creadoEn - a.creadoEn);
  return { items: combined, fromCache };
}

function reportCard(r) {
  const href = r.serverId ? `/reportes/${r.serverId}` : `/reportes/local/${encodeURIComponent(r.localId)}`;
  return html`
    <article class="card">
      <div class="row spread">
        <span class="badge badge-outline">${r.categoria}</span>
        <div class="row">
          ${r.synced === false ? html`<span class="badge badge-negro">${raw(icons.clock)} Pendiente de envío</span>` : ''}
          ${aprobacionBadge(r.aprobacion)}
          ${r.aprobacion === 'aprobado' ? estadoBadge(r.estado) : ''}
        </div>
      </div>
      <h3 style="margin-top:.5rem"><a href="${href}">${r.titulo}</a></h3>
      <p class="small muted">${formatDate(r.creadoEn)}${r.referencia ? ` · ${r.referencia}` : ''}</p>
      ${r.aprobacion === 'rechazado' && r.motivoRechazo ? html`<p class="notice small"><strong>Observaciones:</strong> ${r.motivoRechazo}</p>` : ''}
    </article>`;
}

/** Sección Reportes dentro de la pestaña Inicio. */
export async function renderReportsHome(host, { navigate }) {
  if (!isLoggedIn()) {
    host.innerHTML = html`
      <div class="card card-accent">
        <h2>Reportar un problema en el campus</h2>
        <p class="muted">Inicia sesión con tu cuenta institucional UPTC para crear reportes y hacer seguimiento a su estado.</p>
        <a class="btn" href="/ingresar?volver=${encodeURIComponent('/reportes/nuevo')}">Ingresar para reportar</a>
      </div>`.toString();
    return;
  }

  const { items, fromCache } = await loadMyReports();
  const pending = items.filter((r) => !r.synced).length;

  host.innerHTML = html`
    <div class="row spread" style="margin-bottom:1rem">
      <div>
        <h2 style="margin:0">Mis reportes</h2>
        <p class="small muted" style="margin:0">${items.length} reporte${items.length === 1 ? '' : 's'}</p>
      </div>
      <div class="row">
        ${pending > 0 && navigator.onLine ? html`<button type="button" class="btn btn-ghost btn-sm" id="sync-now">Sincronizar (${pending})</button>` : ''}
        <a class="btn" href="/reportes/nuevo">${raw(icons.plus)} Nuevo reporte</a>
      </div>
    </div>
    ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado (sin conexión).</p>` : ''}
    <div id="my-reports-list">
      ${items.length ? items.map(reportCard) : html`<p class="empty">Aún no has creado reportes. Pulsa «Nuevo reporte» para enviar el primero.</p>`}
    </div>`.toString();

  $('#sync-now', host)?.addEventListener('click', async () => {
    await syncOutbox();
    await renderReportsHome(host, { navigate });
  });
}

/** Ruta dedicada /reportes */
export async function renderMyReports(main, ctx) {
  main.innerHTML = '<div id="reports-wrap"></div>';
  await renderReportsHome($('#reports-wrap', main), ctx);
}

/** Formulario de nuevo reporte (/reportes/nuevo). Requiere sesión. */
export async function renderNewReport(main, { navigate }) {
  const state = { fotos: [], audio: null, lat: null, lng: null };
  let picker, rec, mapCtrl;

  main.innerHTML = html`
    <section class="card card-accent">
      <div class="row spread" style="margin-bottom:.75rem">
        <h1 style="margin:0">Nuevo reporte</h1>
        <a class="btn btn-ghost btn-sm" href="/?seccion=reportes">Volver</a>
      </div>
      <form id="report-form" novalidate>
        <div class="field" data-field="titulo">
          <label for="r-titulo"><span class="label">Nombre del incidente *</span></label>
          <input id="r-titulo" name="titulo" type="text" maxlength="${TITLE_MAX}" placeholder="Ej. Bombillo fundido en Bloque B" required>
          <span class="field-error" role="alert"></span>
        </div>

        <div class="field" data-field="categoria">
          <label for="r-categoria"><span class="label">Categoría *</span></label>
          <select id="r-categoria" name="categoria" required>
            <option value="">Selecciona una categoría</option>
            ${REPORT_CATEGORIES.map((c) => html`<option value="${c}">${c}</option>`)}
          </select>
          <span class="field-error" role="alert"></span>
        </div>

        <div class="field" data-field="descripcion">
          <label for="r-descripcion"><span class="label">Descripción en texto <span class="muted">(o graba un audio abajo)</span></span></label>
          <textarea id="r-descripcion" name="descripcion" rows="3" maxlength="${DESC_MAX}" placeholder="Describe qué ocurrió y dónde..."></textarea>
          <span class="field-error" role="alert"></span>
        </div>

        <div id="audio-slot"></div>
        <div id="photos-slot"></div>

        <fieldset class="card" style="margin-bottom:1rem">
          <legend class="ui small"><strong>Ubicación (opcional)</strong></legend>
          <div class="row" style="margin-bottom:.5rem">
            <button type="button" class="btn btn-ghost btn-sm" id="btn-gps">${raw(icons.pin)} Usar mi ubicación</button>
            <button type="button" class="btn btn-ghost btn-sm" id="btn-clear-gps" hidden>Quitar punto</button>
            <span class="small muted" id="gps-status" aria-live="polite">Sin coordenadas (opcional)</span>
          </div>
          <div class="field" data-field="referencia" style="margin-bottom:.5rem">
            <label for="r-referencia"><span class="label">Referencia manual</span></label>
            <input id="r-referencia" name="referencia" type="text" maxlength="200" placeholder="Ej. Bloque B, piso 2, frente al laboratorio">
            <span class="field-error" role="alert"></span>
          </div>
          <div id="report-map" style="height:220px;border-radius:var(--radius);border:1px solid var(--negro-20)"></div>
          <p class="hint">También puedes tocar el mapa para marcar el punto exacto.</p>
        </fieldset>

        <button type="submit" class="btn btn-block" id="btn-submit">Enviar reporte</button>
      </form>
    </section>`.toString();

  picker = photoPicker($('#photos-slot', main), state, { min: 1, max: 3 });
  rec = audioRecorder($('#audio-slot', main), state);

  const updateGpsText = () => {
    const has = state.lat != null && state.lng != null;
    $('#gps-status', main).textContent = has ? `Punto marcado: ${state.lat.toFixed(5)}, ${state.lng.toFixed(5)}` : 'Sin coordenadas (opcional)';
    $('#btn-clear-gps', main).hidden = !has;
  };

  mapCtrl = await mapView($('#report-map', main), {
    pick: true,
    onPick: ({ lat, lng }) => { state.lat = lat; state.lng = lng; updateGpsText(); }
  });

  $('#btn-gps', main).addEventListener('click', async () => {
    const btn = $('#btn-gps', main);
    btn.disabled = true;
    $('#gps-status', main).textContent = 'Obteniendo ubicación…';
    try {
      const pos = await getPosition();
      state.lat = pos.lat; state.lng = pos.lng;
      mapCtrl.setPoint(pos.lat, pos.lng);
      updateGpsText();
    } catch (e) {
      toast(e.message);
      updateGpsText();
    } finally { btn.disabled = false; }
  });

  $('#btn-clear-gps', main).addEventListener('click', () => {
    state.lat = null; state.lng = null;
    updateGpsText();
  });

  const showFieldError = (name, msg) => {
    const f = $(`[data-field="${name}"]`, main);
    if (!f) return;
    f.classList.toggle('invalid', Boolean(msg));
    const e = $('.field-error', f);
    if (e) e.textContent = msg || '';
  };

  $('#report-form', main).addEventListener('submit', async (e) => {
    e.preventDefault();
    const form = e.currentTarget;
    const titulo = form.titulo.value.trim();
    const categoria = form.categoria.value.trim();
    const descripcion = form.descripcion.value.trim();
    const referencia = form.referencia.value.trim();

    const errors = {};
    if (!titulo) errors.titulo = 'El nombre del incidente es obligatorio.';
    if (!categoria) errors.categoria = 'Selecciona una categoría.';
    if (!descripcion && !state.audio) errors.descripcion = 'Escribe una descripción o graba un audio.';
    if (!state.fotos.length) errors.fotos = 'Adjunta entre 1 y 3 imágenes de evidencia.';

    ['titulo', 'categoria', 'descripcion', 'fotos'].forEach((k) => showFieldError(k, errors[k] || ''));
    if (Object.keys(errors).length) { toast('Revisa los campos obligatorios.'); return; }

    const submit = $('#btn-submit', main);
    submit.disabled = true;
    submit.textContent = 'Guardando…';

    try {
      const record = await enqueueReport({ titulo, categoria, descripcion, referencia, lat: state.lat, lng: state.lng, fotos: state.fotos, audio: state.audio });

      if (navigator.onLine) {
        try {
          await sendReportRecord(record);
          toast('Reporte enviado. Quedó pendiente de revisión.');
          navigate('/?seccion=reportes');
          return;
        } catch (err) {
          if (err.status && err.status >= 400 && err.status < 500 && err.status !== 401) {
            toast(err.message);
            submit.disabled = false;
            submit.textContent = 'Enviar reporte';
            return;
          }
          // Fallo de red o 401: queda en outbox
        }
      }

      await requestBackgroundSync();
      toast('Guardado, se enviará cuando haya conexión.');
      await showLocalNotification('CampusAlerta · Reporte guardado', 'Guardado, se enviará cuando haya conexión.', '/?seccion=reportes');
      navigate('/?seccion=reportes');
    } finally {
      picker.destroy();
      rec.destroy();
      mapCtrl.destroy();
    }
  });
}

/** Detalle de reporte propio (/reportes/:id o /reportes/local/:localId). */
export async function renderReportDetail(main, { id, localId }) {
  let report = null;
  let fromCache = false;

  if (localId) {
    report = await get('reports', localId);
  } else {
    try {
      const res = await cachedGet(`/api/reports/${id}`, {
        save: async (item) => {
          const prev = (await all('reports')).find((r) => r.serverId === item.id);
          await put('reports', { ...prev, ...item, localId: prev?.localId || `srv-${item.id}`, serverId: item.id, synced: true });
        },
        fallback: async () => (await all('reports')).find((r) => r.serverId === Number(id)) || null
      });
      report = res.data;
      fromCache = res.fromCache;
    } catch {
      report = (await all('reports')).find((r) => r.serverId === Number(id)) || null;
      fromCache = true;
    }
  }

  if (!report) {
    main.innerHTML = html`<section class="card"><h1>Reporte no encontrado</h1><p><a href="/?seccion=reportes">Volver a Mis reportes</a></p></section>`.toString();
    return;
  }

  const blobUrls = [];
  const imgUrls = report.media?.imagenes?.length
    ? report.media.imagenes
    : (report.fotos || []).map((b) => { const u = URL.createObjectURL(b); blobUrls.push(u); return u; });
  const audioUrl = report.media?.audio
    ? report.media.audio
    : (report.audio instanceof Blob ? (() => { const u = URL.createObjectURL(report.audio); blobUrls.push(u); return u; })() : null);

  main.innerHTML = html`
    <article class="card card-accent">
      <div class="row spread" style="margin-bottom:.75rem">
        <a class="btn btn-ghost btn-sm" href="/?seccion=reportes">← Mis reportes</a>
        <div class="row">
          ${!report.synced ? html`<span class="badge badge-negro">${raw(icons.clock)} Pendiente de envío</span>` : ''}
          ${aprobacionBadge(report.aprobacion)}
          ${report.aprobacion === 'aprobado' ? estadoBadge(report.estado) : ''}
        </div>
      </div>
      ${fromCache ? html`<p class="notice" role="status">Mostrando contenido guardado.</p>` : ''}
      <span class="badge badge-outline">${report.categoria}</span>
      <h1 style="margin-top:.5rem">${report.titulo}</h1>
      <p class="small muted">${formatDate(report.creadoEn)}${report.referencia ? ` · ${report.referencia}` : ''}</p>

      ${report.aprobacion === 'rechazado' ? html`
        <div class="notice"><strong>Reporte desaprobado.</strong>${report.motivoRechazo ? ` Observaciones: ${report.motivoRechazo}` : ''}</div>` : ''}

      ${report.estado === 'impedimento' && report.motivoImpedimento ? html`
        <div class="notice"><strong>Impedimento:</strong> ${report.motivoImpedimento}</div>` : ''}

      ${report.descripcion ? html`<p>${report.descripcion}</p>` : ''}
      ${audioUrl ? html`<div class="stack"><strong class="ui small">Audio de descripción</strong><audio controls src="${audioUrl}" style="width:100%"></audio></div>` : ''}

      ${imgUrls.length ? html`<h2 style="margin-top:1rem">Evidencias</h2>${galleryHtml(imgUrls, 'Evidencia del reporte')}` : ''}

      ${report.lat != null && report.lng != null ? html`<h2 style="margin-top:1rem">Ubicación</h2><div id="detail-map" style="height:240px;border-radius:var(--radius)"></div>` : ''}

      ${report.estado === 'finalizada' && (report.solucionTexto || report.media?.solucionAudio || report.media?.solucionImagenes?.length) ? html`
        <section class="card" style="margin-top:1rem;background:var(--amarillo-10)">
          <h2>Solución</h2>
          ${report.solucionTexto ? html`<p>${report.solucionTexto}</p>` : ''}
          ${report.media?.solucionAudio ? html`<audio controls src="${report.media.solucionAudio}" style="width:100%"></audio>` : ''}
          ${galleryHtml(report.media?.solucionImagenes || [], 'Evidencia de solución')}
        </section>` : ''}
    </article>`.toString();

  bindGallery(main, imgUrls, 'Evidencia del reporte');
  if (report.media?.solucionImagenes?.length) {
    const solSection = main.querySelector('section.card');
    if (solSection) bindGallery(solSection, report.media.solucionImagenes, 'Evidencia de solución');
  }
  if (report.lat != null && report.lng != null) await mapView($('#detail-map', main), { lat: report.lat, lng: report.lng });
}
