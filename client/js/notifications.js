// Suscripciones push VAPID, pantalla "Preferencias" y bandeja local de notificaciones.
import { html, raw, $, $$, toast, formatDate } from './ui.js';
import { icons } from './icons.js';
import { api } from './api.js';
import { all, getSetting, put, setSetting } from './db.js';

function urlBase64ToUint8(base64) {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const rawStr = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(rawStr, (c) => c.charCodeAt(0));
}

async function getSwSubscription() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function getPreferences() {
  const categoriasSuscritas = await getSetting('categoriasSuscritas', []);
  const pushActivo = await getSetting('pushActivo', false);
  return { categoriasSuscritas, pushActivo };
}

export async function enablePush(categorias) {
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
    throw new Error('Este navegador no admite notificaciones push.');
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw Object.assign(new Error('Permiso de notificaciones denegado.'), { denied: true });
  }
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    const { key } = await api('/api/vapid-public-key');
    if (!key) throw new Error('El servidor no tiene configurada la clave VAPID.');
    sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8(key) });
  }
  await api('/api/subscriptions', { method: 'POST', body: { subscription: sub.toJSON(), categorias } });
  await setSetting('categoriasSuscritas', categorias);
  await setSetting('pushActivo', true);
  return sub;
}

export async function updatePushCategories(categorias) {
  await setSetting('categoriasSuscritas', categorias);
  const sub = await getSwSubscription();
  const active = await getSetting('pushActivo', false);
  if (sub && active) {
    try {
      await api('/api/subscriptions', { method: 'PUT', body: { endpoint: sub.endpoint, categorias } });
    } catch (e) {
      if (e.status === 404) await api('/api/subscriptions', { method: 'POST', body: { subscription: sub.toJSON(), categorias } });
      else throw e;
    }
  }
}

export async function disablePush() {
  const sub = await getSwSubscription();
  if (sub) {
    try { await api('/api/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }); } catch { /* ok */ }
    await sub.unsubscribe().catch(() => {});
  }
  // Se conservan categoriasSuscritas en IndexedDB para cuando se reactive.
  await setSetting('pushActivo', false);
}

export async function unreadCount() {
  try { return (await all('notifications')).filter((n) => !n.leida).length; } catch { return 0; }
}

/** Bandeja de notificaciones (/notificaciones), accesible desde la campanita superior. */
export async function renderNotificationsPage(main) {
  const inbox = (await all('notifications')).sort((a, b) => b.fecha - a.fecha).slice(0, 30);
  main.innerHTML = html`
    <section class="card card-accent">
      <div class="row spread" style="margin-bottom:.75rem">
        <h1 style="margin:0">${raw(icons.bell)} Notificaciones</h1>
        <div class="row">
          ${inbox.some((n) => !n.leida) ? html`<button type="button" class="btn btn-ghost btn-sm" id="mark-all-read">Marcar todas leídas</button>` : ''}
          <a class="btn btn-sm" href="/preferencias">Preferencias</a>
        </div>
      </div>
      <div id="notif-inbox">
        ${inbox.length ? inbox.map((n) => html`
          <div class="card ${n.leida ? '' : 'urgent'}" style="margin-bottom:.5rem;padding:.75rem">
            <div class="row spread">
              <strong>${n.title}</strong>
              <span class="small muted">${formatDate(n.fecha)}</span>
            </div>
            <p class="small" style="margin:.25rem 0">${n.body}</p>
            <div class="row spread">
              ${n.url ? html`<a class="small" href="${n.url}">Abrir</a>` : html`<span></span>`}
              ${!n.leida ? html`<button type="button" class="btn btn-ghost btn-sm" data-read="${n.id}">Marcar leída</button>` : html`<span class="small muted">Leída</span>`}
            </div>
          </div>`) : html`<p class="empty small">No tienes notificaciones en este dispositivo.</p>`}
      </div>
    </section>`.toString();

  $('#mark-all-read', main)?.addEventListener('click', async () => {
    for (const n of inbox) if (!n.leida) await put('notifications', { ...n, leida: true });
    dispatchEvent(new CustomEvent('notifications:changed'));
    await renderNotificationsPage(main);
  });

  $$('[data-read]', main).forEach((btn) => {
    btn.addEventListener('click', async () => {
      const item = inbox.find((x) => x.id === Number(btn.dataset.read));
      if (item) {
        await put('notifications', { ...item, leida: true });
        dispatchEvent(new CustomEvent('notifications:changed'));
        await renderNotificationsPage(main);
      }
    });
  });
}

/** Pantalla Preferencias (/preferencias). */
export async function renderPreferences(main) {
  const [categories, prefs, currentSub] = await Promise.all([
    api('/api/categories').catch(() => getSetting('categoriesCache', [])),
    getPreferences(),
    getSwSubscription()
  ]);
  await setSetting('categoriesCache', categories);

  let selected = [...(prefs.categoriasSuscritas || [])];
  let active = Boolean(prefs.pushActivo && currentSub);

  // Sincroniza estado si el servidor ya tiene categorías vinculadas para este dispositivo
  if (currentSub) {
    try {
      const srv = await api(`/api/subscriptions?endpoint=${encodeURIComponent(currentSub.endpoint)}`);
      if (srv.activo) {
        active = true;
        selected = srv.categorias;
        await setSetting('categoriasSuscritas', selected);
        await setSetting('pushActivo', true);
      }
    } catch { /* sin conexión */ }
  }

  const denied = 'Notification' in window && Notification.permission === 'denied';

  main.innerHTML = html`
    <section class="card card-accent">
      <h1>Preferencias de notificaciones</h1>
      <p class="muted">Elige qué categorías de noticias quieres recibir por notificación push. También recibirás avisos cuando cambie el estado de tus reportes.</p>

      <div id="perm-warning" class="notice" ${denied ? '' : 'hidden'}>
        <strong>Notificaciones bloqueadas en el navegador.</strong><br>
        Para activarlas: haz clic en el ícono de candado/ajustes junto a la barra de direcciones → <em>Permisos / Notificaciones</em> → <em>Permitir</em>, y luego recarga la página.
      </div>

      <div class="card" style="background:var(--amarillo-10)">
        <label class="row spread" style="cursor:pointer">
          <span>
            <strong class="ui">Notificaciones push en este dispositivo</strong><br>
            <span class="small muted">${active ? 'Activadas' : 'Desactivadas'}</span>
          </span>
          <input type="checkbox" id="push-master" class="switch" ${active ? 'checked' : ''}>
        </label>
      </div>

      <h2>Categorías de noticias</h2>
      <p class="small muted">Si desactivas el interruptor general, tus categorías elegidas se conservan para cuando las reactives.</p>
      <div id="cat-list" class="stack" style="margin:.75rem 0 1rem">
        ${categories.map((c) => html`
          <label class="check-row">
            <input type="checkbox" value="${c.id}" ${selected.includes(c.id) ? 'checked' : ''}>
            <span>${c.nombre}</span>
          </label>`)}
      </div>
      <div class="row">
        <button type="button" class="btn" id="save-cats">Guardar preferencias</button>
      </div>
    </section>`.toString();

  const master = $('#push-master', main);
  const readSelected = () => $$('#cat-list input:checked', main).map((i) => Number(i.value));

  master.addEventListener('change', async () => {
    master.disabled = true;
    try {
      if (master.checked) {
        await enablePush(readSelected());
        $('#perm-warning', main).hidden = true;
        toast('Notificaciones activadas.');
      } else {
        await disablePush();
        toast('Notificaciones desactivadas (se conservan tus categorías).');
      }
      await renderPreferences(main);
    } catch (e) {
      master.checked = !master.checked;
      if (e.denied || Notification.permission === 'denied') $('#perm-warning', main).hidden = false;
      toast(e.message);
    } finally {
      master.disabled = false;
    }
  });

  $('#save-cats', main).addEventListener('click', async () => {
    const cats = readSelected();
    try {
      if (master.checked) await updatePushCategories(cats);
      else await setSetting('categoriasSuscritas', cats);
      toast('Preferencias guardadas.');
    } catch (e) {
      toast(e.message);
    }
  });
}
