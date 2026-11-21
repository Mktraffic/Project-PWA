import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { config } from './config.js';
import { user } from './middleware/user.js';
import authRoutes from './routes/auth.js';
import reportRoutes from './routes/reports.js';
import incidentRoutes from './routes/incidents.js';
import newsRoutes from './routes/news.js';
import categoryRoutes from './routes/categories.js';
import subscriptionRoutes from './routes/subscriptions.js';
import adminRoutes from './routes/admin.js';
import { UPLOAD_DIR } from './services/uploads.js';
import { ensureAdminSeed, ensureDefaultCategories } from './services/auth.js';

const app = express();
const root = path.resolve('client/dist');

app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(compression());
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org', 'https://www.uptc.edu.co'],
      mediaSrc: ["'self'", 'blob:'],
      connectSrc: ["'self'", 'https://tile.openstreetmap.org', 'https://*.tile.openstreetmap.org'],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'"],
      workerSrc: ["'self'"],
      manifestSrc: ["'self'"],
      frameAncestors: ["'none'"]
    }
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  crossOriginEmbedderPolicy: false
}));
app.use((req, res, next) => {
  res.set('Permissions-Policy', 'microphone=(self), geolocation=(self), camera=(self)');
  next();
});
app.use(express.json({ limit: '100kb' }));
app.use(user);

// Rate limiting en login: solo cuenta los intentos fallidos.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: Number(process.env.LOGIN_RATE_LIMIT || 10),
  skipSuccessfulRequests: true,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos de acceso. Intenta de nuevo en 15 minutos.' }
});

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.get('/api/vapid-public-key', (_req, res) => res.json({ key: config.vapid.publicKey }));
app.use('/api/incidents', incidentRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/news', newsRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/subscriptions', subscriptionRoutes);
app.use('/api/admin', adminRoutes);
// Archivos subidos (nombres aleatorios). Audio: sin Cache API en el SW; Express soporta Range.
app.use('/uploads', express.static(UPLOAD_DIR, { index: false, maxAge: '7d', setHeaders: (res) => res.set('X-Content-Type-Options', 'nosniff') }));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

if (fs.existsSync(root)) {
  app.use(express.static(root, {
    index: false,
    setHeaders(res, file) {
      const name = path.basename(file);
      // El service worker y el HTML nunca deben quedar en cachÃ© HTTP; los archivos con hash son inmutables.
      if (name === 'sw.js' || name.endsWith('.html') || name === 'manifest.webmanifest') res.set('Cache-Control', 'no-cache');
      else if (/-[A-Z0-9]{8}\.(js|css)$/.test(name) || file.includes(`${path.sep}fonts${path.sep}`)) res.set('Cache-Control', 'public, max-age=31536000, immutable');
    }
  }));
  // Fallback de la SPA (rutas como /noticias/12 o /reportes/5).
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'index.html')));
}

// Manejador global de errores: { error, fields } con el estado adecuado.
app.use((err, _req, res, _next) => {
  const status = err.status || (err.name === 'MulterError' ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.expose ? 'Error interno del servidor.' : err.message, fields: err.fields });
});

export async function start(port = config.port) {
  await ensureAdminSeed();
  ensureDefaultCategories();
  return new Promise((resolve) => {
    const server = app.listen(port, () => {
      console.log(`CampusAlerta en http://localhost:${server.address().port}`);
      resolve(server);
    });
  });
}

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await start();
}

