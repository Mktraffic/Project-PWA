// Mapas con Leaflet + OpenStreetMap, cargado bajo demanda y restilizado con los colores de la marca.
let leafletPromise;
export const UPTC_TUNJA = { lat: 5.5353, lng: -73.3678 };

function loadLeaflet() {
  leafletPromise ??= (async () => {
    if (!document.querySelector('link[data-leaflet]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = '/vendor/leaflet/leaflet.css'; link.dataset.leaflet = '';
      document.head.appendChild(link);
    }
    const mod = await import('leaflet');
    return mod.default || mod;
  })();
  return leafletPromise;
}

const pinIcon = (L) => L.divIcon({ className: 'map-pin', html: '<span></span>', iconSize: [28, 38], iconAnchor: [14, 36] });

/**
 * Muestra un mapa. Con `pick: true` el usuario puede tocar el mapa/arrastrar el marcador y se llama `onPick({lat,lng})`.
 * Devuelve { setPoint(lat,lng), destroy() }.
 */
export async function mapView(el, { lat, lng, zoom = 17, pick = false, onPick } = {}) {
  el.classList.add('map');
  let L;
  try { L = await loadLeaflet(); } catch {
    el.innerHTML = '<p class="empty small">El mapa no está disponible sin conexión.</p>';
    return { setPoint() {}, destroy() {} };
  }
  const center = lat != null ? [lat, lng] : [UPTC_TUNJA.lat, UPTC_TUNJA.lng];
  const map = L.map(el, { zoomControl: true, attributionControl: true }).setView(center, lat != null ? zoom : 16);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, crossOrigin: 'anonymous', attribution: '© OpenStreetMap' }).addTo(map);
  let marker = lat != null ? L.marker(center, { icon: pinIcon(L), draggable: pick, keyboard: false }).addTo(map) : null;

  const place = (la, ln, fire = true) => {
    if (!marker) {
      marker = L.marker([la, ln], { icon: pinIcon(L), draggable: pick, keyboard: false }).addTo(map);
      marker.on('dragend', () => { const p = marker.getLatLng(); onPick?.({ lat: p.lat, lng: p.lng }); });
    } else marker.setLatLng([la, ln]);
    map.setView([la, ln], Math.max(map.getZoom(), 17));
    if (fire) onPick?.({ lat: la, lng: ln });
  };
  if (pick) {
    marker?.on('dragend', () => { const p = marker.getLatLng(); onPick?.({ lat: p.lat, lng: p.lng }); });
    map.on('click', (e) => place(e.latlng.lat, e.latlng.lng));
  }
  setTimeout(() => map.invalidateSize(), 150);
  setTimeout(() => map.invalidateSize(), 450);
  return { setPoint: (la, ln) => place(la, ln, false), destroy: () => map.remove() };
}
