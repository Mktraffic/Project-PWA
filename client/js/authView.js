// Pantalla de login / registro con validación en cliente (misma lógica que el servidor).
import { html, raw, $, $$, toast } from './ui.js';
import { login, register } from './auth.js';
import { passwordChecks, validateLogin, validateRegistration } from '../../shared/validators.js';

const field = (name, label, control, hint = '') => html`
  <div class="field" data-field="${name}">
    <label for="f-${name}"><span class="label">${label}</span></label>
    ${raw(control)}
    ${hint ? html`<div class="hint" id="h-${name}">${hint}</div>` : ''}
    <span class="field-error" id="e-${name}" role="alert"></span>
  </div>`;

const input = (name, type, attrs = '') => `<input id="f-${name}" name="${name}" type="${type}" aria-describedby="e-${name}" ${attrs}>`;

function loginForm() {
  return html`
    <form id="auth-form" novalidate data-mode="login">
      ${field('correo', 'Correo institucional', input('correo', 'email', 'autocomplete="username" placeholder="nombre.apellido@uptc.edu.co" required'))}
      ${field('password', 'Contraseña', input('password', 'password', 'autocomplete="current-password" required'))}
      <button class="btn btn-block" type="submit">Ingresar</button>
      <div class="demo-box"><strong>Cuenta de demostración (admin):</strong><br>pepito.perez@uptc.edu.co · Pepito123</div>
    </form>`;
}

function registerForm() {
  return html`
    <form id="auth-form" novalidate data-mode="register">
      ${field('nombre', 'Nombre completo', input('nombre', 'text', 'autocomplete="name" placeholder="Nombre Apellido" required'), 'Al menos un nombre y un apellido; solo letras, tildes y espacios.')}
      ${field('codigo', 'Código', input('codigo', 'text', 'inputmode="numeric" autocomplete="off" maxlength="10" required'), 'Solo dígitos, entre 8 y 10.')}
      ${field('cargo', 'Cargo', `<select id="f-cargo" name="cargo" aria-describedby="e-cargo" required>
        <option value="">Selecciona una opción</option><option value="docente">Docente</option>
        <option value="funcionario">Funcionario</option><option value="estudiante">Estudiante</option></select>`)}
      ${field('correo', 'Correo institucional', input('correo', 'email', 'autocomplete="username" placeholder="nombre.apellido@uptc.edu.co" required'), 'Debe terminar en @uptc.edu.co.')}
      ${field('password', 'Contraseña', input('password', 'password', 'autocomplete="new-password" required'))}
      <ul class="pw-rules" id="pw-rules" aria-label="Requisitos de la contraseña">
        <li data-r="longitud">8+ caracteres</li><li data-r="mayuscula">Una mayúscula</li>
        <li data-r="minuscula">Una minúscula</li><li data-r="numero">Un número</li>
      </ul>
      <br>
      <button class="btn btn-block" type="submit">Crear cuenta</button>
    </form>`;
}

function showErrors(root, errors) {
  $$('.field', root).forEach((f) => {
    const msg = errors[f.dataset.field] || '';
    f.classList.toggle('invalid', Boolean(msg));
    $('.field-error', f).textContent = msg;
    const control = $('input,select', f);
    control?.setAttribute('aria-invalid', msg ? 'true' : 'false');
  });
  const first = Object.keys(errors)[0];
  if (first) $(`#f-${first}`, root)?.focus();
}

export function renderAuth(main, { onSuccess, mode = 'login', notice = '' } = {}) {
  main.innerHTML = html`
    <section class="auth-wrap">
      <!-- Logo oficial, versión positiva sobre fondo blanco, sin modificar -->
      <img class="auth-logo" src="/img/uptc-color.svg" alt="Universidad Pedagógica y Tecnológica de Colombia" width="352" height="165">
      <h1 class="auth-title"><span class="brand-word">CampusAlerta</span></h1>
      <p class="auth-title muted">Reportes y noticias para la comunidad UPTC</p>
      ${notice ? html`<p class="notice" role="status">${notice}</p>` : ''}
      <div class="card card-accent">
        <div class="seg" role="tablist" aria-label="Acceso">
          <button role="tab" id="tab-login" aria-selected="${mode === 'login'}" data-mode="login">Ingresar</button>
          <button role="tab" id="tab-register" aria-selected="${mode === 'register'}" data-mode="register">Crear cuenta</button>
        </div>
        <div id="auth-body"></div>
      </div>
      <p class="auth-title legal">Vigilada Mineducación</p>
    </section>`.toString();

  const body = $('#auth-body', main);

  const draw = (m) => {
    $$('.seg button', main).forEach((b) => b.setAttribute('aria-selected', String(b.dataset.mode === m)));
    body.innerHTML = (m === 'login' ? loginForm() : registerForm()).toString();
    const form = $('#auth-form', body);

    if (m === 'register') {
      const pw = $('#f-password', form);
      pw.addEventListener('input', () => {
        const checks = passwordChecks(pw.value);
        $$('#pw-rules li', form).forEach((li) => li.classList.toggle('ok', checks[li.dataset.r]));
      });
      // Validación por campo al salir del control
      form.addEventListener('focusout', (e) => {
        const name = e.target.name;
        if (!name || !e.target.value) return;
        const { errors } = validateRegistration(Object.fromEntries(new FormData(form)));
        const f = $(`[data-field="${name}"]`, form);
        f.classList.toggle('invalid', Boolean(errors[name]));
        $('.field-error', f).textContent = errors[name] || '';
      });
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      const { errors } = (m === 'login' ? validateLogin : validateRegistration)(values);
      showErrors(form, errors);
      if (Object.keys(errors).length) return;
      const button = $('button[type=submit]', form);
      button.disabled = true;
      try {
        await (m === 'login' ? login : register)(values);
        toast(m === 'login' ? 'Sesión iniciada.' : 'Cuenta creada. ¡Bienvenido a CampusAlerta!');
        onSuccess?.();
      } catch (error) {
        if (error.status === undefined && !navigator.onLine) toast('Necesitas conexión para iniciar sesión o registrarte.');
        else toast(error.message);
        if (error instanceof TypeError) toast('No se pudo contactar al servidor. Revisa tu conexión.');
        showErrors(form, error.fields || {});
      } finally { button.disabled = false; }
    });
    $('input,select', form)?.focus();
  };

  $$('.seg button', main).forEach((b) => b.addEventListener('click', () => draw(b.dataset.mode)));
  draw(mode);
}
