import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.env.DATA_DIR || 'server/db/data');
fs.mkdirSync(dataDir, { recursive: true });

const db = new Database(process.env.DB_FILE || path.join(dataDir, 'campusalerta.sqlite'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL,
  codigo TEXT NOT NULL UNIQUE,
  cargo TEXT NOT NULL CHECK(cargo IN ('docente','funcionario','estudiante')),
  correo TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  rol TEXT NOT NULL DEFAULT 'usuario' CHECK(rol IN ('usuario','admin')),
  creadoEn INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER NOT NULL REFERENCES users(id),
  titulo TEXT NOT NULL,
  descripcion TEXT,
  categoria TEXT NOT NULL,
  lat REAL, lng REAL, referencia TEXT,
  aprobacion TEXT NOT NULL DEFAULT 'por_revisar' CHECK(aprobacion IN ('por_revisar','aprobado','rechazado')),
  motivoRechazo TEXT,
  estado TEXT NOT NULL DEFAULT 'pendiente' CHECK(estado IN ('pendiente','en_proceso','finalizada','impedimento')),
  motivoImpedimento TEXT,
  solucionTexto TEXT,
  activo INTEGER NOT NULL DEFAULT 1,
  eliminadoEn INTEGER,
  creadoEn INTEGER NOT NULL,
  actualizadoEn INTEGER NOT NULL,
  clientId TEXT
);

CREATE TABLE IF NOT EXISTS report_media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reportId INTEGER NOT NULL REFERENCES reports(id),
  tipo TEXT NOT NULL CHECK(tipo IN ('imagen','audio')),
  rol TEXT NOT NULL CHECK(rol IN ('descripcion','solucion')),
  ruta TEXT NOT NULL,
  mime TEXT,
  creadoEn INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS news (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT NOT NULL,
  resumen TEXT,
  contenido TEXT,
  urgente INTEGER NOT NULL DEFAULT 0,
  fecha TEXT,
  fuenteUrl TEXT NOT NULL UNIQUE,
  imagenUrl TEXT,
  publicada INTEGER NOT NULL DEFAULT 1,
  creadoEn INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS news_categories (
  newsId INTEGER NOT NULL REFERENCES news(id),
  categoryId INTEGER NOT NULL REFERENCES categories(id),
  PRIMARY KEY (newsId, categoryId)
);

-- userId es NULL cuando el dispositivo no tiene sesión (cerrar sesión desvincula la suscripción).
CREATE TABLE IF NOT EXISTS subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  userId INTEGER REFERENCES users(id),
  prevUserId INTEGER,
  endpoint TEXT NOT NULL UNIQUE,
  keysJson TEXT NOT NULL,
  categoriasJson TEXT NOT NULL DEFAULT '[]',
  activo INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  adminId INTEGER,
  accion TEXT NOT NULL,
  entidad TEXT NOT NULL,
  entidadId INTEGER,
  fecha INTEGER NOT NULL
);
`);

// Migración ligera para BD creadas antes de agregar clientId (idempotencia de la cola offline).
if (!db.prepare("PRAGMA table_info(reports)").all().some((c) => c.name === 'clientId')) db.exec('ALTER TABLE reports ADD COLUMN clientId TEXT');
if (!db.prepare("PRAGMA table_info(subscriptions)").all().some((c) => c.name === 'prevUserId')) db.exec('ALTER TABLE subscriptions ADD COLUMN prevUserId INTEGER');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_reports_client ON reports(userId, clientId) WHERE clientId IS NOT NULL');

export default db;
