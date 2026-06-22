// =============================================================================
//  VISTA PREVIA POR BLOQUES  (ver el archivo ANTES de descargarlo entero)
// -----------------------------------------------------------------------------
//  Dos estrategias, según el tipo de archivo, para que mirar sea "ultra ligero":
//
//   A) STREAMING por rangos (PDF, video, audio):
//      El visor nativo del navegador pide al central solo los RANGOS (bloques)
//      que necesita mostrar — /api/stream soporta HTTP Range. Así puedes ver la
//      primera página de un PDF o adelantar un video SIN bajar el archivo entero.
//
//   B) PROGRESIVA VERIFICADA (imágenes, texto):
//      Trae bloque por bloque desde compañeros/central, VERIFICA cada uno contra
//      la lista firmada (mismo motor que la descarga real) y va mostrando el
//      avance "bloque k/N". Para texto basta con los primeros bloques.
//
//  En ambos casos NO se guarda nada en el dispositivo: es solo una mirada. El
//  botón "Descargar y guardar" lanza la descarga P2P completa y verificada.
// =============================================================================

import { ensureMesh, fetchVerifiedChunk } from './download.js';

const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`);
const kind = (mime = '') => {
  if (mime === 'application/pdf') return 'pdf';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'video';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json' || /(markdown|xml)/.test(mime)) return 'text';
  return 'other';
};

let _objectUrls = [];
const trackUrl = (u) => { _objectUrls.push(u); return u; };

/** ¿Tiene el central este archivo para servirlo por streaming (Range)? */
async function streamAvailable(hash) {
  try {
    const r = await fetch(`/api/stream?hash=${encodeURIComponent(hash)}`, { method: 'HEAD' });
    return r.ok && r.headers.get('accept-ranges') === 'bytes';
  } catch { return false; }
}

/** Abre el modal de vista previa para un archivo del catálogo. */
export async function openPreview(file, { onDownload } = {}) {
  const overlay = document.createElement('div');
  overlay.className = 'modal';
  overlay.innerHTML = `
    <div class="modal-card" role="dialog" aria-modal="true" aria-label="Vista previa de ${esc(file.nombre)}">
      <div class="modal-head">
        <div class="modal-title">
          ${icon('i-eye')}
          <div>
            <p class="modal-name">${esc(file.nombre)}</p>
            <p class="modal-sub">${fmt(file.tamano)} · ${file.bloques} bloque(s) · vista previa (no se descarga todo)</p>
          </div>
        </div>
        <button class="icon-btn" id="pvClose" type="button" aria-label="Cerrar vista previa">${icon('i-x')}</button>
      </div>
      <div class="modal-body" id="pvBody"><p class="muted pv-center">Preparando vista previa…</p></div>
      <div class="modal-foot">
        <div class="pv-meter">
          <div class="bar"><div class="bar-fill" id="pvFill"></div></div>
          <span class="pv-status" id="pvStatus">Cargando bloques…</span>
        </div>
        <div class="modal-actions">
          <button class="btn primary" id="pvDownload" type="button">${icon('i-download')} Descargar y guardar</button>
          <button class="btn ghost" id="pvCloseBtn" type="button">Cerrar</button>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);
  document.body.classList.add('modal-open');

  const body = overlay.querySelector('#pvBody');
  const fill = overlay.querySelector('#pvFill');
  const status = overlay.querySelector('#pvStatus');

  const close = () => {
    document.body.classList.remove('modal-open');
    overlay.remove();
    for (const u of _objectUrls) URL.revokeObjectURL(u);
    _objectUrls = [];
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  overlay.querySelector('#pvClose').addEventListener('click', close);
  overlay.querySelector('#pvCloseBtn').addEventListener('click', close);
  overlay.querySelector('#pvDownload').addEventListener('click', () => { close(); onDownload?.(); });

  const setMeter = (have, total, text) => {
    fill.style.width = `${total ? Math.round((have / total) * 100) : 0}%`;
    if (text) status.textContent = text;
  };

  try {
    await render({ file, body, setMeter });
  } catch (err) {
    body.innerHTML = `<p class="pv-center pv-error">${icon('i-alert')} No se pudo cargar la vista previa: ${esc(err.message)}</p>`;
    setMeter(0, 1, 'Error');
  }
}

async function render({ file, body, setMeter }) {
  const k = kind(file.mime);
  const url = `/api/stream?hash=${encodeURIComponent(file.hash)}`;

  // --- A) Tipos que el navegador reproduce por rangos (streaming nativo) ---
  if ((k === 'pdf' || k === 'video' || k === 'audio') && (await streamAvailable(file.hash))) {
    if (k === 'pdf') {
      body.innerHTML = `<iframe class="pv-frame" src="${url}#view=FitH" title="Vista previa PDF"></iframe>`;
    } else if (k === 'video') {
      body.innerHTML = `<video class="pv-media" src="${url}" controls preload="metadata" playsinline></video>`;
    } else {
      body.innerHTML = `<div class="pv-center"><audio class="pv-audio" src="${url}" controls preload="metadata"></audio></div>`;
    }
    setMeter(1, 1, 'Streaming por rangos · solo se cargan las partes que ves');
    return;
  }

  // --- B) Resto: progresiva VERIFICADA bloque por bloque ---
  await ensureMesh();
  const info = await fetch(`/api/chunks?hash=${encodeURIComponent(file.hash)}`).then((r) => r.json()).catch(() => null);
  if (!info || !info.found) {
    // Sin lista de bloques (y sin streaming): no hay forma segura de previsualizar.
    body.innerHTML = `<p class="pv-center muted">No hay vista previa disponible para este archivo.<br>Usa <b>Descargar y guardar</b> para obtenerlo verificado.</p>`;
    setMeter(0, 1, 'Sin vista previa');
    return;
  }
  const total = info.chunkHashes.length;

  if (k === 'text') {
    // Para texto basta con los primeros bloques (vista previa parcial liviana).
    const want = Math.min(total, 6);
    const parts = [];
    for (let i = 0; i < want; i++) {
      const { buf } = await fetchVerifiedChunk(file.hash, i, info.chunkHashes);
      parts.push(buf);
      setMeter(i + 1, want, `Cargando texto · bloque ${i + 1}/${want}`);
    }
    const text = new TextDecoder().decode(await new Blob(parts).arrayBuffer());
    const partial = want < total ? `\n\n… (vista previa parcial: primeros ${want} de ${total} bloques)` : '';
    body.innerHTML = `<pre class="pv-text">${esc(text)}${esc(partial)}</pre>`;
    setMeter(1, 1, want < total ? 'Vista previa parcial' : 'Texto completo');
    return;
  }

  if (k === 'image') {
    // Una imagen necesita todos sus bloques para decodificarse; los traemos
    // verificados mostrando el avance "bloque k/N".
    const parts = [];
    for (let i = 0; i < total; i++) {
      const { buf } = await fetchVerifiedChunk(file.hash, i, info.chunkHashes);
      parts.push(buf);
      setMeter(i + 1, total, `Cargando imagen · bloque ${i + 1}/${total}`);
    }
    const blobUrl = trackUrl(URL.createObjectURL(new Blob(parts, { type: file.mime })));
    body.innerHTML = `<div class="pv-center"><img class="pv-img" src="${blobUrl}" alt="${esc(file.nombre)}"></div>`;
    setMeter(1, 1, 'Imagen verificada por bloques');
    return;
  }

  // Tipo desconocido: ofrecer la descarga (no intentamos adivinar el visor).
  body.innerHTML = `<p class="pv-center muted">No hay un visor para este tipo de archivo.<br>Usa <b>Descargar y guardar</b> para obtenerlo verificado y abrirlo con tu app.</p>`;
  setMeter(0, 1, 'Sin visor para este tipo');
}
