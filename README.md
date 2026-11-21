# CampusAlerta · UPTC

PWA instalable para la comunidad de la Universidad Pedagógica y Tecnológica de Colombia (UPTC), con módulo de **reportes de incidentes** (online y offline con cola y Background Sync) y **noticias institucionales** por categoría con notificaciones push VAPID.

> **Proyecto académico:** CampusAlerta es un proyecto académico y no es una aplicación oficial de la UPTC. Si se publica fuera del ámbito de la clase, se debe consultar a la Dirección de Comunicaciones (DIRCOM-UPTC). **Vigilada Mineducación** (Res. MEN 12220 de 2016).

## Requisitos e inicio rápido

- **Node.js 20+**
- Instalación y arranque:
  ```bash
  npm install
  npm start
  ```
  El script `prestart` ejecuta:
  1. `npm run setup` (`scripts/ensure-env.mjs`): genera `.env` con claves VAPID y secreto `JWT_SECRET` si no existen.
  2. `npm run build` (`scripts/build.mjs`): empaqueta el cliente en `client/dist/` y genera el service worker versionado con su precaché.
  3. `npm run seed` (`scripts/seed.mjs`): siembra las categorías base y el usuario administrador único de forma idempotente.
- Abrir `http://localhost:3000`.

### Cuenta de administrador sembrada (única)
- **Correo:** `pepito.perez@uptc.edu.co`
- **Contraseña:** `Pepito123`
- **Código:** `202624255` · **Cargo:** `estudiante` · **Rol:** `admin`

Las cuentas creadas desde el formulario de registro reciben siempre el rol `usuario`.

## Estructura principal

- `client/`: App Shell, `sw.js`, `manifest.webmanifest`, `offline.html`, `css/app.css`, `img/` (logos oficiales UPTC sin modificar), `icons/` (íconos PWA), `js/` (`app.js`, `auth.js`, `authView.js`, `api.js`, `db.js`, `sync.js`, `reports.js`, `incidents.js`, `news.js`, `notifications.js`, `admin.js`, `audio.js`, `camera.js`, `geo.js`, `map.js`, `viewer.js`, `ui.js`, `icons.js`).
- `server/`: Express + SQLite (`better-sqlite3`), `routes/` (`auth.js`, `reports.js`, `incidents.js`, `news.js`, `categories.js`, `subscriptions.js`, `admin.js`), `services/` (`auth.js`, `reports.js`, `scraper.js`, `push.js`, `uploads.js`), `middleware/` (`user.js`, `admin.js`).
- `shared/`: validadores y constantes compartidas entre cliente y servidor (`validators.js`, `constants.js`, `limits.js`).

## Pruebas y verificación

- **Pruebas unitarias y de integración (41 casos):**
  ```bash
  npm test
  ```
- **Verificación E2E en Chrome (Playwright) y capturas:**
  ```bash
  node scripts/e2e-verify.mjs
  ```
- **Auditoría Lighthouse:**
  ```bash
  node scripts/run-lighthouse.mjs
  ```
- **Guion de demostración completo:** ver [docs/GUION_DEMO.md](docs/GUION_DEMO.md).
