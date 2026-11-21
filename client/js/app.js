import { $, html, raw, toast, watchConnection } from './ui.js';
import { icons } from './icons.js';
import { currentUser, isAdmin, isLoggedIn, restoreSession } from './auth.js';
import { renderAuth } from './authView.js';
import { homeSections, renderHome } from './home.js';
import { renderAbout, renderProfile } from './profile.js';
import { renderNewsDetail, renderNewsHome, renderNewsPage } from './news.js';
import { renderIncidentDetail, renderIncidentsHome, renderIncidentsPage } from './incidents.js';
import { renderMyReports, renderNewReport, renderReportDetail, renderReportsHome } from './reports.js';
import { renderPreferences, renderNotificationsPage, unreadCount } from './notifications.js';
import { renderAdmin } from './admin.js';
import { syncOutbox } from './sync.js';

const main = $('#main');

homeSections.noticias.render = (host, ctx) => renderNewsHome(host, ctx);
homeSections.reportes.render = (host, ctx) => renderReportsHome(host, ctx);
homeSections.incidentes.render = (host, ctx) => renderIncidentsHome(host, ctx);

/* ---------- Router (History API) ---------- */
// access: false = pública · 'user' = requiere sesión (redirige al login y vuelve) · 'admin' = solo admin
export const routes = [
  { path: /^\/$/, access: false, render: (m, ctx) => renderHome(m, { section: ctx.query.get('seccion') || 'noticias', navigate }) },
  { path: /^\/ingresar$/, access: false, render: (m, ctx) => renderAuth(m, { mode: ctx.query.get('modo') || 'login', notice: ctx.query.get('aviso') || '', onSuccess: async () => { drawChrome(); await syncOutbox({ silent: true }); navigate(ctx.query.get('volver') || '/'); } }) },
  { path: /^\/noticias$/, access: false, render: (m) => renderNewsPage(m) },
  { path: /^\/noticias\/(\d+)$/, access: false, render: (m, ctx) => renderNewsDetail(m, { id: ctx.match[1] }) },
  { path: /^\/incidentes$/, access: false, render: (m) => renderIncidentsPage(m) },
  { path: /^\/incidentes\/(\d+)$/, access: false, render: (m, ctx) => renderIncidentDetail(m, { id: ctx.match[1] }) },
  { path: /^\/reportes$/, access: 'user', render: (m) => renderMyReports(m, { navigate }) },
  { path: /^\/reportes\/nuevo$/, access: 'user', render: (m) => renderNewReport(m, { navigate }) },
  { path: /^\/reportes\/local\/([^/]+)$/, access: 'user', render: (m, ctx) => renderReportDetail(m, { localId: decodeURIComponent(ctx.match[1]) }) },
  { path: /^\/reportes\/(\d+)$/, access: 'user', render: (m, ctx) => renderReportDetail(m, { id: ctx.match[1] }) },
  { path: /^\/preferencias$/, access: 'user', render: (m) => renderPreferences(m) },
  { path: /^\/notificaciones$/, access: 'user', render: (m) => renderNotificationsPage(m) },
  { path: /^\/admin$/, access: 'admin', render: (m, ctx) => renderAdmin(m, { tab: ctx.query.get('tab') || 'noticias' }) },
  { path: /^\/perfil$/, access: 'user', render: (m) => renderProfile(m, { navigate, onLogout: () => { drawChrome(); navigate('/ingresar'); } }) },
  { path: /^\/acerca-de$/, access: false, render: (m) => renderAbout(m) }
];

export function navigate(path, { replace = false } = {}) {
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  return route();
}

async function route() {
  const url = new URL(location.href);
  const pathname = url.pathname.replace(/\/+$/, '') || '/';
  const found = routes.find((r) => r.path.test(pathname));
  if (!found) {
    main.innerHTML = html`<section class="card"><h1>Página no encontrada</h1><p><a href="/">Volver al inicio</a></p></section>`.toString();
    return;
  }
  if (found.access && !isLoggedIn()) {
    return navigate(`/ingresar?aviso=${encodeURIComponent('Inicia sesión para continuar.')}&volver=${encodeURIComponent(pathname + url.search)}`, { replace: true });
  }
  if (found.access === 'admin' && !isAdmin()) {
    main.innerHTML = html`<section class="card"><h1>Acceso restringido</h1><p>Esta sección es solo para administradores.</p></section>`.toString();
    return;
  }
  drawChrome(pathname);
  try {
    await found.render(main, { match: pathname.match(found.path), query: url.searchParams, pathname });
  } catch (error) {
    console.error(error);
    main.innerHTML = html`<section class="card"><h1>Ocurrió un problema</h1><p>${error.message}</p></section>`.toString();
  }
  main.focus({ preventScroll: true });
  scrollTo(0, 0);
}

/* ---------- Cabecera y pestañas (negras con detalles amarillos) ---------- */
function drawChrome(pathname = location.pathname) {
  const user = currentUser();
  const tabs = [
    { href: '/', icon: 'home', label: 'Inicio', match: /^\/($|noticias|incidentes)/ },
    { href: '/reportes/nuevo', icon: 'plus', label: 'Reportar', match: /^\/reportes/ },
    ...(isAdmin() ? [{ href: '/admin', icon: 'tools', label: 'Admin', match: /^\/admin/ }] : [])
  ];
  $('#tabbar').innerHTML = tabs.map((t) =>
    html`<a href="${t.href}" ${raw(t.match.test(pathname) ? 'aria-current="page"' : '')}><span class="ico">${raw(icons[t.icon])}</span><span>${t.label}</span></a>`.toString()).join('');
  $('#header-account').innerHTML = user
    ? html`<a class="btn btn-sm" href="/perfil">${raw(icons.user)} <span>${user.nombre.split(' ')[0]}</span></a>`.toString()
    : html`<a class="btn btn-sm" href="/ingresar">${raw(icons.key)} <span>Ingresar</span></a>`.toString();
  const inst = $('#install');
  if (inst && !inst.innerHTML) inst.innerHTML = icons.download;
  updateBell();
}

async function updateBell() {
  const bell = $('#notif-bell');
  if (!bell) return;
  if (!isLoggedIn()) { bell.hidden = true; return; }
  bell.hidden = false;
  const count = await unreadCount();
  bell.innerHTML = `${icons.bell}${count > 0 ? `<span class="bell-count">${count > 99 ? '99+' : count}</span>` : ''}`;
  bell.setAttribute('aria-label', count > 0 ? `Notificaciones (${count} sin leer)` : 'Notificaciones');
}

/* ---------- Enlaces internos sin recargar ---------- */
document.addEventListener('click', (event) => {
  const a = event.target.closest('a[href]');
  if (!a || a.target || a.origin !== location.origin || event.metaKey || event.ctrlKey || event.shiftKey || a.hasAttribute('download')) return;
  event.preventDefault();
  navigate(a.pathname + a.search);
});
addEventListener('popstate', route);

/* ---------- Instalación (beforeinstallprompt) ---------- */
let deferredPrompt;
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  deferredPrompt = event;
});
$('#install').addEventListener('click', async () => {
  if (!deferredPrompt) {
    toast('Para instalar, usa el ícono de instalar en la barra de direcciones o el menú del navegador (⋮ → Instalar app).');
    return;
  }
  deferredPrompt.prompt();
  await deferredPrompt.userChoice;
  deferredPrompt = null;
});
addEventListener('appinstalled', () => { deferredPrompt = null; toast('CampusAlerta instalada.'); });

/* ---------- Arranque ---------- */
async function boot() {
  watchConnection((online) => { if (online) syncOutbox(); });
  addEventListener('reports:synced', () => {
    if (location.pathname === '/' || location.pathname.startsWith('/reportes')) route();
  });
  addEventListener('notifications:changed', updateBell);

  await restoreSession();
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('/sw.js');
      navigator.serviceWorker.addEventListener('message', (event) => {
        const msg = event.data || {};
        if (msg.type === 'navigate' && msg.url) {
          const u = new URL(msg.url);
          navigate(u.pathname + u.search);
        } else if (msg.type === 'sync-reports-done') {
          toast(msg.enviados === 1 ? '1 reporte enviado.' : `${msg.enviados} reportes enviados.`);
          route();
        } else if (msg.type === 'sync-auth-required') {
          toast('Tu sesión expiró; inicia sesión para enviar tus reportes pendientes.');
        } else if (msg.type === 'push-received') {
          updateBell();
        }
      });
    } catch (error) { console.warn('SW no registrado', error); }
  }

  await route();
  if (navigator.onLine && isLoggedIn()) syncOutbox({ silent: true });

  const splash = $('#splash');
  splash.classList.add('hide');
  setTimeout(() => splash.remove(), 400);
}
boot();
