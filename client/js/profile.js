import { html, raw, $, $$ } from './ui.js';
import { currentUser, logout, isExpired } from './auth.js';

export function renderAbout(main) {
  main.innerHTML = html`
    <article class="card card-accent">
      <h1>Acerca de CampusAlerta</h1>
      <p><strong>CampusAlerta es un proyecto académico y no es una aplicación oficial de la Universidad Pedagógica y Tecnológica de Colombia (UPTC).</strong></p>
      <p>Fue desarrollado para la asignatura de Aplicaciones Web Progresivas (PWA). Permite reportar incidentes del campus (también sin conexión) y consultar noticias institucionales por categoría.</p>
      <p>Si el proyecto se publica fuera del ámbito de la clase, se debe consultar previamente a la Dirección de Comunicaciones de la UPTC (<abbr title="Dirección de Comunicaciones">DIRCOM-UPTC</abbr>) sobre el uso del nombre, el logosímbolo y la identidad gráfica.</p>
      <h2>Identidad gráfica</h2>
      <p>La interfaz sigue el Manual de Identidad Gráfica UPTC 2022: logosímbolo oficial sin modificaciones, colores amarillo (#FFCC29) y negro (#1A1A1A), y tipografía institucional serif con respaldo autoalojado.</p>
      <p class="legal">Vigilada Mineducación (Res. MEN 12220 de 2016)</p>
    </article>`.toString();
}

export function renderProfile(main, { navigate, onLogout }) {
  const user = currentUser();
  main.innerHTML = html`
    <section class="card card-accent">
      <h1>Mi perfil</h1>
      ${isExpired() ? html`<p class="notice" role="alert">Tu sesión expiró. Vuelve a ingresar para enviar reportes; los pendientes se conservan.</p>` : ''}
      <dl class="profile-grid">
        <dt>Nombre</dt><dd>${user.nombre}</dd>
        <dt>Código</dt><dd>${user.codigo}</dd>
        <dt>Cargo</dt><dd>${user.cargo}</dd>
        <dt>Correo</dt><dd>${user.correo}</dd>
        <dt>Rol</dt><dd>${user.rol === 'admin' ? html`<span class="badge badge-negro">★ Administrador (Equipo-PWA)</span>` : html`<span class="badge badge-amarillo">Usuario</span>`}</dd>
      </dl>
      <div class="row" style="margin-top:1rem">
        <a class="btn btn-ghost" href="/preferencias">Preferencias de notificaciones</a>
        <button class="btn btn-dark" id="logout" type="button">Cerrar sesión</button>
      </div>
    </section>`.toString();
  $('#logout', main).addEventListener('click', async () => { await logout(); onLogout(); });
}
