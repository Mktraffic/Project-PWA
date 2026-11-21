import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { AUDIO_MAX_BYTES, MAX_PHOTOS, PHOTOS_TOTAL_MAX_BYTES, PHOTO_SERVER_MAX_BYTES } from '../../shared/limits.js';
import { fieldError } from './auth.js';

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || 'server/uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

/** Multer en memoria: se valida tipo, firma y tamaño antes de escribir a disco. */
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: AUDIO_MAX_BYTES, files: MAX_PHOTOS + 1, fields: 20, fieldSize: 8 * 1024 },
  fileFilter(_req, file, cb) {
    const okImage = file.fieldname.startsWith('fotos') && /^image\/(jpeg|png|webp)$/.test(file.mimetype);
    const okAudio = file.fieldname === 'audio' && /^audio\/(webm|ogg|mp4|mpeg|wav|x-m4a)/.test(file.mimetype);
    if (okImage || okAudio) cb(null, true);
    else cb(fieldError('Tipo de archivo no permitido.', { archivos: 'Solo imágenes JPEG/PNG/WebP y audio webm/ogg/mp4.' }, 422));
  }
});
export const reportUpload = upload.fields([{ name: 'fotos', maxCount: MAX_PHOTOS }, { name: 'audio', maxCount: 1 }]);

export function imageSignature(buffer) {
  return (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    || buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    || (buffer.subarray(0, 4).toString() === 'RIFF' && buffer.subarray(8, 12).toString() === 'WEBP');
}

/** Valida los archivos del request. min: mínimo de fotos exigido. */
export function validateFiles(files = {}, { minPhotos = 1 } = {}) {
  const photos = files.fotos || [];
  const audio = (files.audio || [])[0] || null;
  const errors = {};
  if (photos.length < minPhotos) errors.fotos = `Adjunta al menos ${minPhotos} imagen${minPhotos > 1 ? 'es' : ''} de evidencia.`;
  else if (photos.length > MAX_PHOTOS) errors.fotos = `Máximo ${MAX_PHOTOS} imágenes.`;
  else if (photos.some((f) => f.size > PHOTO_SERVER_MAX_BYTES || !imageSignature(f.buffer))) errors.fotos = 'Alguna imagen es inválida o supera el tamaño permitido.';
  else if (photos.reduce((n, f) => n + f.size, 0) > PHOTOS_TOTAL_MAX_BYTES) errors.fotos = 'Las imágenes superan el tamaño total permitido.';
  if (audio && audio.size > AUDIO_MAX_BYTES) errors.audio = 'El audio supera el tamaño máximo (2 MB).';
  if (Object.keys(errors).length) throw fieldError('Revisa los archivos adjuntos.', errors, 422);
  return { photos, audio };
}

const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a', 'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-m4a': 'm4a' };

/** Guarda un archivo con nombre aleatorio y devuelve { ruta, mime }. */
export function saveFile(file) {
  const mime = file.mimetype.split(';')[0];
  const name = `${crypto.randomUUID()}.${EXT[mime] || 'bin'}`;
  fs.writeFileSync(path.join(UPLOAD_DIR, name), file.buffer);
  return { ruta: `/uploads/${name}`, mime };
}
