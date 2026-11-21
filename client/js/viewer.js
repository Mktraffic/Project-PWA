// Helpers compartidos: insignias de estado/aprobación (icono + texto + tinta) y visor de imágenes.
import { html, raw, $ } from './ui.js';
import { icons } from './icons.js';
import { APROBACION_LABEL, ESTADO_LABEL } from '../../shared/constants.js';

const ESTADO_META = {
  pendiente: { icon: 'clock', cls: 'badge-outline' },
  en_proceso: { icon: 'gear', cls: 'badge-amarillo' },
  finalizada: { icon: 'check', cls: 'badge-negro' },
  impedimento: { icon: 'block', cls: 'badge-error' }
};

const APROBACION_META = {
  por_revisar: { icon: 'clock', cls: 'badge-outline' },
  aprobado: { icon: 'check', cls: 'badge-amarillo' },
  rechazado: { icon: 'x', cls: 'badge-error' }
};

export function estadoBadge(estado) {
  const m = ESTADO_META[estado] || ESTADO_META.pendiente;
  return html`<span class="badge ${m.cls}">${raw(icons[m.icon])} ${ESTADO_LABEL[estado] || estado}</span>`;
}

export function aprobacionBadge(aprobacion) {
  const m = APROBACION_META[aprobacion] || APROBACION_META.por_revisar;
  return html`<span class="badge ${m.cls}">${raw(icons[m.icon])} ${APROBACION_LABEL[aprobacion] || aprobacion}</span>`;
}

/** Visor de imágenes (modal accesible) con cierre por botón, Escape o clic fuera. */
export function openImageViewer(urls, startIndex = 0, title = 'Evidencia') {
  if (!urls?.length) return;
  let idx = startIndex;
  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.setAttribute('aria-label', title);

  const draw = () => {
    dialog.innerHTML = html`
      <div class="lightbox-bar">
        <span class="ui small">${idx + 1} / ${urls.length}</span>
        <div class="row">
          ${urls.length > 1 ? html`
            <button type="button" class="btn btn-ghost btn-sm" id="lb-prev" aria-label="Imagen anterior">‹</button>
            <button type="button" class="btn btn-ghost btn-sm" id="lb-next" aria-label="Imagen siguiente">›</button>` : ''}
          <button type="button" class="btn btn-sm" id="lb-close" aria-label="Cerrar visor">${raw(icons.x)} Cerrar</button>
        </div>
      </div>
      <div class="lightbox-body"><img src="${urls[idx]}" alt="${title} ${idx + 1}"></div>`.toString();
    $('#lb-close', dialog).onclick = () => dialog.close();
    $('#lb-prev', dialog)?.addEventListener('click', () => { idx = (idx - 1 + urls.length) % urls.length; draw(); });
    $('#lb-next', dialog)?.addEventListener('click', () => { idx = (idx + 1) % urls.length; draw(); });
  };

  dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
  dialog.addEventListener('close', () => dialog.remove());
  document.body.appendChild(dialog);
  draw();
  dialog.showModal();
}

/** Renderiza una galería de 1–3 imágenes que abre el visor al hacer clic. */
export function galleryHtml(urls, prefix = 'Evidencia') {
  if (!urls?.length) return '';
  return html`
    <div class="gallery" data-gallery>
      ${urls.map((u, i) => html`<button type="button" class="gallery-item" data-idx="${i}" aria-label="Ampliar ${prefix} ${i + 1}"><img src="${u}" alt="${prefix} ${i + 1}" loading="lazy"></button>`)}
    </div>`;
}

export function bindGallery(container, urls, prefix = 'Evidencia') {
  container.querySelectorAll('[data-gallery] .gallery-item').forEach((btn) => {
    btn.addEventListener('click', () => openImageViewer(urls, Number(btn.dataset.idx), prefix));
  });
}
