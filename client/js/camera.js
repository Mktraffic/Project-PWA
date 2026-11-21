// Captura y compresión de imágenes (canvas) + selector de fotos (cámara o archivo).
import { html, raw, $, $$, toast } from './ui.js';
import { icons } from './icons.js';
import { PHOTO_INPUT_MAX_BYTES, PHOTO_MAX_BYTES, PHOTO_MAX_WIDTH } from '../../shared/limits.js';

async function toBitmap(file) {
  if ('createImageBitmap' in window) { try { return await createImageBitmap(file); } catch { /* cae al <img> */ } }
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = URL.createObjectURL(file);
  });
}
const toBlob = (canvas, quality) => new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));

/** Reduce a máx. ~800 px de ancho con canvas y devuelve un Blob JPEG ≤ PHOTO_MAX_BYTES. */
export async function compressImage(file) {
  const bmp = await toBitmap(file);
  let width = Math.min(PHOTO_MAX_WIDTH, bmp.width);
  for (let attempt = 0; attempt < 4; attempt++) {
    const scale = width / bmp.width;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
    for (const q of [0.8, 0.7, 0.6, 0.5, 0.4]) {
      const blob = await toBlob(canvas, q);
      if (blob && blob.size <= PHOTO_MAX_BYTES) return blob;
    }
    width = Math.round(width * 0.8);
  }
  throw new Error('No se pudo comprimir la imagen al tamaño permitido.');
}

/**
 * Selector de imágenes. `state.fotos` es un Blob[] (1..max). Botones: «Tomar foto» (cámara) y «Elegir archivo».
 */
export function photoPicker(host, state, { max = 3, min = 1, label = 'Evidencias', onChange } = {}) {
  state.fotos ??= [];
  let urls = [];
  host.innerHTML = html`
    <div class="field" data-field="fotos">
      <span class="label">${label} <span class="muted">(mínimo ${min}, máximo ${max})</span></span>
      <div class="row">
        <label class="btn btn-ghost btn-sm" for="cam-input">${raw(icons.camera)} Tomar foto</label>
        <label class="btn btn-ghost btn-sm" for="file-input">${raw(icons.upload)} Elegir archivo</label>
        <span class="small muted" id="photo-count" aria-live="polite"></span>
      </div>
      <input id="cam-input" class="sr-only" type="file" accept="image/*" capture="environment">
      <input id="file-input" class="sr-only" type="file" accept="image/*" multiple>
      <div class="thumbs" id="thumbs"></div>
      <span class="field-error" role="alert"></span>
    </div>`.toString();

  const draw = () => {
    urls.forEach(URL.revokeObjectURL);
    urls = state.fotos.map((b) => URL.createObjectURL(b));
    $('#photo-count', host).textContent = `${state.fotos.length}/${max}`;
    $('#thumbs', host).innerHTML = state.fotos.map((_, i) => html`
      <figure class="thumb"><img src="${urls[i]}" alt="Evidencia ${i + 1}">
        <button type="button" class="thumb-remove" data-i="${i}" aria-label="Quitar imagen ${i + 1}">${raw(icons.x)}</button></figure>`.toString()).join('');
    const full = state.fotos.length >= max;
    $$('input[type=file]', host).forEach((i) => { i.disabled = full; });
    $$('label.btn', host).forEach((l) => l.setAttribute('aria-disabled', String(full)));
    onChange?.(state.fotos);
  };

  async function add(files) {
    for (const file of files) {
      if (state.fotos.length >= max) { toast(`Máximo ${max} imágenes.`); break; }
      if (!file.type.startsWith('image/')) { toast('Solo se admiten imágenes.'); continue; }
      if (file.size > PHOTO_INPUT_MAX_BYTES) { toast('Una imagen supera los 10 MB.'); continue; }
      try { state.fotos.push(await compressImage(file)); } catch (e) { toast(e.message); }
    }
    draw();
  }
  host.addEventListener('change', async (e) => { if (e.target.type === 'file') { await add([...e.target.files]); e.target.value = ''; } });
  host.addEventListener('click', (e) => { const b = e.target.closest('.thumb-remove'); if (b) { state.fotos.splice(Number(b.dataset.i), 1); draw(); } });
  draw();
  return { refresh: draw, destroy: () => urls.forEach(URL.revokeObjectURL) };
}
