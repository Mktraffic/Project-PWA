// Pestaña Inicio: panel superior con Noticias · Reportes · Incidentes.
// Las secciones se registran desde sus módulos (news.js, reports.js, incidents.js) en fases posteriores.
import { html, raw, $, $$ } from './ui.js';
import { icons } from './icons.js';

export const homeSections = {
  noticias: { icon: 'news', label: 'Noticias', render: async (host) => { host.innerHTML = html`<p class="empty">Las noticias publicadas aparecerán aquí.</p>`.toString(); } },
  reportes: { icon: 'doc', label: 'Reportes', render: async (host) => { host.innerHTML = html`<p class="empty">Aquí podrás crear un reporte y ver «Mis reportes».</p>`.toString(); } },
  incidentes: { icon: 'alert', label: 'Incidentes', render: async (host) => { host.innerHTML = html`<p class="empty">Los incidentes aprobados por el administrador aparecerán aquí.</p>`.toString(); } }
};

export async function renderHome(main, { section = 'noticias', navigate } = {}) {
  const keys = Object.keys(homeSections);
  if (!keys.includes(section)) section = 'noticias';
  main.innerHTML = html`
    <div class="page-head"><h1>Inicio</h1><p class="muted">Novedades, reportes e incidentes del campus.</p></div>
    <div class="section-switch" role="tablist" aria-label="Secciones de inicio">
      ${keys.map((k) => html`<button role="tab" data-section="${k}" aria-selected="${k === section}"><span class="ico">${raw(icons[homeSections[k].icon])}</span>${homeSections[k].label}</button>`)}
    </div>
    <div id="home-body" role="tabpanel"></div>`.toString();
  $$('.section-switch button', main).forEach((b) => b.addEventListener('click', () => navigate(`/?seccion=${b.dataset.section}`)));
  await homeSections[section].render($('#home-body', main), { navigate });
}
