// Utilidades de interfaz: plantillas con escape automático, avisos, banner de conexión.

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw { constructor(value) { this.value = value; } toString() { return this.value; } }
/** Marca una cadena como HTML ya seguro (resultado de otra plantilla `html`). */
export const raw = (value) => new Raw(value);

/** Plantilla etiquetada: escapa todo valor interpolado salvo los marcados con raw()/html``. */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) {
      const v = values[i];
      if (Array.isArray(v)) out += v.map((x) => (x instanceof Raw ? x.value : escapeHtml(x))).join('');
      else out += v instanceof Raw ? v.value : escapeHtml(v);
    }
  });
  return new Raw(out);
}

export const $ = (selector, root = document) => root.querySelector(selector);
export const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

let toastTimer;
export function toast(message, ms = 4000) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

/** Banner de conexión online/offline que cambia en tiempo real. */
export function watchConnection(onChange) {
  const el = $('#connection');
  let wasOffline = !navigator.onLine;
  const draw = () => {
    if (!navigator.onLine) {
      el.className = 'offline';
      el.textContent = '⚠ Sin conexión: puedes seguir usando la app; tus reportes se enviarán al reconectar.';
    } else if (wasOffline) {
      el.className = 'online-back';
      el.textContent = '✓ Conexión restablecida.';
      setTimeout(() => { if (navigator.onLine) { el.className = ''; el.textContent = ''; } }, 3000);
    } else { el.className = ''; el.textContent = ''; }
    wasOffline = !navigator.onLine;
    onChange?.(navigator.onLine);
  };
  addEventListener('online', draw);
  addEventListener('offline', draw);
  draw();
}

export function formatDate(value) {
  if (!value) return '';
  const d = typeof value === 'number' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });
}
