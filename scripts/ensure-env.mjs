import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import webpush from 'web-push';

// Crea .env en el primer arranque (claves VAPID y secreto JWT) y completa lo que falte.
const file = '.env';
let content = '';
try { content = await fs.readFile(file, 'utf8'); } catch { /* primera vez */ }
const has = (key) => new RegExp(`^${key}=.+`, 'm').test(content);
const lines = [];

if (!has('PORT')) lines.push('PORT=3000');
if (!has('NODE_ENV')) lines.push('NODE_ENV=production');
if (!has('JWT_SECRET')) lines.push(`JWT_SECRET=${crypto.randomBytes(48).toString('base64url')}`);
if (!has('VAPID_PUBLIC_KEY') || !has('VAPID_PRIVATE_KEY')) {
  const keys = webpush.generateVAPIDKeys();
  lines.push(`VAPID_PUBLIC_KEY=${keys.publicKey}`, `VAPID_PRIVATE_KEY=${keys.privateKey}`);
}
if (!has('VAPID_SUBJECT')) lines.push('VAPID_SUBJECT=mailto:admin@example.com');
if (!has('ALLOWED_NEWS_HOSTS')) lines.push('ALLOWED_NEWS_HOSTS=uptc.edu.co,www.uptc.edu.co');

if (lines.length) {
  await fs.writeFile(file, `${content.trimEnd()}${content ? '\n' : ''}${lines.join('\n')}\n`);
  console.log('.env actualizado:', lines.map((l) => l.split('=')[0]).join(', '));
}
