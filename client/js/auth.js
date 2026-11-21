// Sesión: JWT guardado en IndexedDB (store "session") para que persista offline
// y para que el service worker lo lea durante Background Sync.
import { del, get, put } from './db.js';
import { validateLogin, validateRegistration } from '../../shared/validators.js';

const KEY = 'current';
let current = null; // { token, user }

export async function restoreSession() {
  current = (await get('session', KEY))?.valor || null;
  return current;
}
export const session = () => current;
export const currentUser = () => current?.user || null;
export const isAdmin = () => current?.user?.rol === 'admin';
export const isLoggedIn = () => Boolean(current?.token);

export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return payload.exp ? payload.exp * 1000 : 0;
  } catch { return 0; }
}
/** Token vencido: la sesión se conserva (la cola offline no se pierde) pero hay que volver a ingresar. */
export const isExpired = () => !current?.token || tokenExpiry(current.token) <= Date.now();

export function authHeader() {
  return current?.token ? { Authorization: `Bearer ${current.token}` } : {};
}

async function post(url, body) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || 'No se pudo completar la solicitud.'), { fields: data.fields || {}, status: response.status });
  return data;
}

async function persist(data) {
  current = { token: data.token, user: data.user };
  await put('session', { clave: KEY, valor: current });
  await linkPushToUser();
  return data.user;
}

export async function login(values) {
  const { errors, values: clean } = validateLogin(values);
  if (Object.keys(errors).length) throw Object.assign(new Error('Revisa los campos marcados.'), { fields: errors });
  return persist(await post('/api/auth/login', clean));
}

export async function register(values) {
  const { errors, values: clean } = validateRegistration(values);
  if (Object.keys(errors).length) throw Object.assign(new Error('Revisa los campos marcados.'), { fields: errors });
  return persist(await post('/api/auth/register', clean));
}

async function deviceSubscription() {
  try {
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
    const reg = await navigator.serviceWorker.ready;
    return await reg.pushManager.getSubscription();
  } catch { return null; }
}

/** Al iniciar sesión, vincula la suscripción push de este dispositivo al usuario (si ya existe una). */
export async function linkPushToUser() {
  const sub = await deviceSubscription();
  if (!sub || !current?.token) return;
  try {
    await fetch('/api/subscriptions/link', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
  } catch { /* sin red: se vinculará en el próximo inicio */ }
}

/** Cerrar sesión: desvincula la suscripción push de este dispositivo y borra el token local. */
export async function logout() {
  const sub = await deviceSubscription();
  try {
    await fetch('/api/auth/logout', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...authHeader() },
      body: JSON.stringify({ endpoint: sub?.endpoint || null })
    });
  } catch { /* offline: el servidor desvinculará al próximo login/logout */ }
  current = null;
  await del('session', KEY);
}

/** Si la sesión local ya no es válida en el servidor (401), la limpia pero no toca la cola offline. */
export async function dropSession() { current = null; await del('session', KEY); }
