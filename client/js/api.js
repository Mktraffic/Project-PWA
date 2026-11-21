// Capa de red del cliente. Las escrituras y /api/auth/* son Network Only; las lecturas públicas
// (incidentes, noticias, reportes) usan Network First con respaldo en IndexedDB (ver cachedGet).
import { authHeader, dropSession, session } from './auth.js';

export async function api(url, { method = 'GET', body, headers = {}, formData } = {}) {
  const init = { method, headers: { ...authHeader(), ...headers } };
  if (formData) init.body = formData;
  else if (body !== undefined) { init.headers['Content-Type'] = 'application/json'; init.body = JSON.stringify(body); }
  const response = await fetch(url, init);
  if (response.status === 401 && session()) await dropSession();
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), { status: response.status, fields: data.fields || {}, offline: data.offline === true });
  }
  return response.status === 204 ? null : response.json();
}

/**
 * Network First con respaldo local: intenta la red; si falla (sin conexión), usa `fallback()`
 * (lectura de IndexedDB). `save(data)` persiste la respuesta fresca. Devuelve { data, fromCache }.
 */
export async function cachedGet(url, { save, fallback } = {}) {
  try {
    const data = await api(url);
    await save?.(data);
    return { data, fromCache: false };
  } catch (error) {
    if (error.status && error.status < 500 && !error.offline) throw error; // error real del servidor
    const data = await fallback?.();
    if (data === undefined || data === null) throw error;
    return { data, fromCache: true };
  }
}
