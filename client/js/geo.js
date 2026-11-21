// Geolocalización envuelta en Promise.
export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(Object.assign(new Error('Tu navegador no admite geolocalización.'), { code: 'UNSUPPORTED' }));
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, precision: pos.coords.accuracy }),
      (err) => {
        const messages = {
          1: 'Permiso de ubicación denegado. Puedes escribir una referencia manual (por ejemplo «Bloque B, piso 2»).',
          2: 'No se pudo determinar tu ubicación. Escribe una referencia manual.',
          3: 'Se agotó el tiempo para obtener la ubicación. Intenta de nuevo o escribe una referencia.'
        };
        reject(Object.assign(new Error(messages[err.code] || 'No se pudo obtener la ubicación.'), { code: err.code }));
      },
      { enableHighAccuracy: true, timeout, maximumAge: 30000 }
    );
  });
}
