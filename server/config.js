import 'dotenv/config';

const isProd = process.env.NODE_ENV === 'production';
const jwtSecret = process.env.JWT_SECRET || '';
if (isProd && jwtSecret.length < 24) {
  console.error('JWT_SECRET falta o es demasiado corto. Ejecuta `npm run setup` o define uno largo en .env.');
  process.exit(1);
}

export const config = {
  port: Number(process.env.PORT || 3000),
  isProd,
  jwtSecret: jwtSecret || 'solo-desarrollo-no-usar-en-produccion',
  vapid: {
    publicKey: process.env.VAPID_PUBLIC_KEY || '',
    privateKey: process.env.VAPID_PRIVATE_KEY || '',
    subject: process.env.VAPID_SUBJECT || 'mailto:admin@example.com'
  },
  allowedHosts: (process.env.ALLOWED_NEWS_HOSTS || 'uptc.edu.co,www.uptc.edu.co').split(',').map((x) => x.trim().toLowerCase())
};
