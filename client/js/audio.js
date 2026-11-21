// Grabación de audio con MediaRecorder (límite 2 minutos, tamaño máximo, vista previa, permiso denegado).
import { html, raw, $, toast } from './ui.js';
import { icons } from './icons.js';
import { AUDIO_MAX_BYTES, AUDIO_MAX_SECONDS } from '../../shared/limits.js';

const pickMime = () => ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((t) => window.MediaRecorder?.isTypeSupported?.(t)) || '';
const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

/** `state.audio`: Blob|null. Devuelve { destroy }. */
export function audioRecorder(host, state, { onChange, label = 'Descripción en audio (opcional si escribes texto)' } = {}) {
  state.audio ??= null;
  let recorder, stream, timer, startedAt, chunks = [], previewUrl, bytes = 0;
  const supported = Boolean(navigator.mediaDevices?.getUserMedia) && typeof window.MediaRecorder !== 'undefined';

  host.innerHTML = html`
    <div class="field" data-field="audio">
      <span class="label">${label}</span>
      ${supported ? html`
        <div class="row">
          <button type="button" class="btn btn-ghost btn-sm" id="rec-toggle">${raw(icons.mic)} <span>Grabar audio</span></button>
          <span class="badge badge-negro" id="rec-timer" hidden role="timer" aria-live="off">0:00</span>
          <span class="small muted">Máximo ${AUDIO_MAX_SECONDS / 60} minutos</span>
        </div>` : html`<p class="hint">Tu navegador no permite grabar audio. Escribe la descripción en texto.</p>`}
      <div id="rec-preview"></div>
      <span class="field-error" role="alert" id="rec-error"></span>
    </div>`.toString();

  const err = (m) => { $('#rec-error', host).textContent = m || ''; };
  const stopTracks = () => stream?.getTracks().forEach((t) => t.stop());

  function drawPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    const box = $('#rec-preview', host);
    if (!state.audio) { box.innerHTML = ''; return; }
    previewUrl = URL.createObjectURL(state.audio);
    box.innerHTML = html`<audio controls src="${previewUrl}" aria-label="Vista previa del audio grabado"></audio>
      <button type="button" class="btn btn-ghost btn-sm" id="rec-delete">${raw(icons.trash)} Eliminar audio</button>
      <span class="small muted">${Math.round(state.audio.size / 1024)} KB</span>`.toString();
    $('#rec-delete', host).addEventListener('click', () => { state.audio = null; drawPreview(); onChange?.(null); });
  }

  async function start() {
    err('');
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      const denied = e.name === 'NotAllowedError' || e.name === 'SecurityError';
      err(denied ? 'Permiso de micrófono denegado. Actívalo en la configuración del navegador o escribe la descripción en texto.' : 'No se encontró un micrófono disponible. Escribe la descripción en texto.');
      return;
    }
    chunks = []; bytes = 0;
    const mimeType = pickMime();
    recorder = new MediaRecorder(stream, { ...(mimeType ? { mimeType } : {}), audioBitsPerSecond: 32000 });
    recorder.ondataavailable = (e) => {
      if (!e.data.size) return;
      chunks.push(e.data); bytes += e.data.size;
      if (bytes >= AUDIO_MAX_BYTES * 0.95) { toast('Se alcanzó el tamaño máximo del audio.'); stop(); }
    };
    recorder.onstop = () => {
      clearInterval(timer); stopTracks();
      $('#rec-timer', host).hidden = true;
      $('#rec-toggle span', host).textContent = 'Grabar audio';
      const blob = new Blob(chunks, { type: recorder.mimeType || mimeType || 'audio/webm' });
      if (blob.size > AUDIO_MAX_BYTES) { err('El audio supera el tamaño máximo (2 MB). Graba uno más corto.'); return; }
      if (blob.size) { state.audio = blob; drawPreview(); onChange?.(blob); }
    };
    recorder.start(1000);
    startedAt = Date.now();
    $('#rec-timer', host).hidden = false;
    $('#rec-toggle span', host).textContent = 'Detener';
    timer = setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      $('#rec-timer', host).textContent = fmt(s);
      if (s >= AUDIO_MAX_SECONDS) { toast('Límite de 2 minutos alcanzado.'); stop(); }
    }, 250);
  }
  function stop() { if (recorder?.state === 'recording') recorder.stop(); }

  $('#rec-toggle', host)?.addEventListener('click', () => (recorder?.state === 'recording' ? stop() : start()));
  drawPreview();
  return { destroy() { stop(); stopTracks(); clearInterval(timer); if (previewUrl) URL.revokeObjectURL(previewUrl); } };
}
