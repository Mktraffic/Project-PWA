import https from 'node:https';
import tls from 'node:tls';
import fs from 'node:fs';
import path from 'node:path';

// Certificado intermedio público de Sectigo para *.uptc.edu.co (el servidor UPTC no lo envía en el handshake,
// lo que en Linux/Render produce UNABLE_TO_VERIFY_LEAF_SIGNATURE). Se añade al almacén raíz sin desactivar TLS.
const caPath = path.resolve('server/certs/uptc-ca.pem');
const extraCa = fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf8') : null;
const agent = extraCa ? new https.Agent({ ca: [...tls.rootCertificates, extraCa] }) : undefined;

/** GET HTTPS con soporte de redirecciones y verificación TLS completa para uptc.edu.co. */
export function uptcGet(url, { headers = {}, timeoutMs = 25000, maxRedirects = 5 } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent, headers, timeout: timeoutMs }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && maxRedirects > 0) {
        res.resume();
        const nextUrl = new URL(res.headers.location, url).href;
        uptcGet(nextUrl, { headers, timeoutMs, maxRedirects: maxRedirects - 1 }).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          headers: res.headers,
          buffer,
          text: () => buffer.toString('utf8')
        });
      });
    });
    req.on('timeout', () => req.destroy(Object.assign(new Error('Tiempo de espera agotado.'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
  });
}
