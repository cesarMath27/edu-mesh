// =============================================================================
//  ORQUESTADOR DE DESCARGA EN EL NAVEGADOR  (mesh-first, con respaldo HTTP)
// -----------------------------------------------------------------------------
//  Reproduce la descarga robusta de Node, pero corriendo en el celular:
//   1) Pide la lista de hashes de bloque al nodo central (/api/chunks).
//   2) Para cada bloque que falte: pregunta al broker quién lo tiene; si un
//      COMPAÑERO lo tiene, lo trae por WebRTC; si no, lo baja del nodo central
//      por HTTP (/api/chunk).  ← alivia al equipo central.
//   3) Verifica CADA bloque con SHA-256 (nativo) contra la lista firmada.
//   4) Lo guarda en IndexedDB y AVISA al broker "yo ya lo tengo" → se vuelve
//      seeder para los siguientes compañeros.
//   5) Ensambla, verifica el hash global y entrega un Blob para abrir el PDF.
//
//  Confianza: la lista de hashes viene del nodo central (que ya verificó la
//  firma Ed25519 del manifiesto). Cada bloque se ancla a esa lista con SHA-256.
// =============================================================================

import { Mesh } from './mesh.js';
import * as store from './store.js';
import { sha256hex as sha256js } from './sha256.js';

export const mesh = new Mesh();
let _connected = null;
export function ensureMesh() { if (!_connected) _connected = mesh.connect(); return _connected; }

// Cada navegador SIRVE desde su IndexedDB lo que tenga.
mesh.serveChunk = async (hash, index) => store.getChunk(hash, index);

// crypto.subtle SOLO existe en contexto seguro (HTTPS o localhost). Por http en
// la LAN (como entran los celulares) no está → caemos al SHA-256 en JS puro.
async function sha256hex(buf) {
  if (globalThis.crypto && crypto.subtle && crypto.subtle.digest) {
    const d = await crypto.subtle.digest('SHA-256', buf);
    return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  return sha256js(buf);
}

/** ¿Cuántos bloques de este archivo tiene ya ESTE navegador? */
export async function localAvailability(hash, totalChunks) {
  const idx = await store.getIndices(hash);
  return { have: idx.size, total: totalChunks, complete: totalChunks > 0 && idx.size >= totalChunks };
}

/** Anuncia al broker todos los bloques que este navegador ya posee (para servir). */
export async function announceLocal(hash) {
  const idx = await store.getIndices(hash);
  for (const i of idx) mesh.announce(hash, i);
  return idx.size;
}

/** Reensambla el archivo desde IndexedDB y verifica el hash global. */
export async function assembleBlob(hash, totalChunks, mime) {
  const parts = [];
  for (let i = 0; i < totalChunks; i++) {
    const c = await store.getChunk(hash, i);
    if (!c) throw new Error(`falta el bloque ${i}`);
    parts.push(c);
  }
  const blob = new Blob(parts, { type: mime || 'application/octet-stream' });
  const whole = await sha256hex(await blob.arrayBuffer());
  if (whole !== hash) throw new Error('el hash global no coincide');
  return blob;
}

export async function downloadFile(hash, mime, onProgress) {
  await ensureMesh();
  const info = await fetch(`/api/chunks?hash=${encodeURIComponent(hash)}`).then((r) => r.json());
  if (!info.found) throw new Error('el nodo central no tiene información de bloques');
  const total = info.chunkHashes.length;

  const present = await store.getIndices(hash);
  for (const i of present) mesh.announce(hash, i);
  let completed = present.size;
  const stats = { peer: 0, central: 0 };
  onProgress?.({ type: 'chunks', total, completed, stats });

  const queue = [];
  for (let i = 0; i < total; i++) if (!present.has(i)) queue.push(i);
  const attempts = {};

  async function worker() {
    while (queue.length) {
      const i = queue.shift();
      if (i === undefined) break;
      attempts[i] = (attempts[i] || 0) + 1;
      let buf = null; let src = 'central';

      // 1) Intentar con compañeros (WebRTC).
      const peers = await mesh.lookup(hash, i);
      for (const pid of peers) {
        try { const b = await mesh.requestChunk(pid, hash, i); if (b && b.byteLength) { buf = b; src = 'peer'; break; } } catch { /* siguiente */ }
      }
      // 2) Respaldo: nodo central por HTTP.
      if (!buf) {
        try {
          buf = await fetch(`/api/chunk?hash=${encodeURIComponent(hash)}&index=${i}`).then((r) => { if (!r.ok) throw new Error('http'); return r.arrayBuffer(); });
          src = 'central';
        } catch {
          if (attempts[i] < 5) { queue.push(i); continue; }
          throw new Error(`no se pudo descargar el bloque ${i}`);
        }
      }
      // 3) Verificación por bloque.
      if (await sha256hex(buf) !== info.chunkHashes[i]) {
        if (attempts[i] < 5) { queue.push(i); continue; }
        throw new Error(`bloque ${i} corrupto`);
      }
      // 4) Guardar + anunciar (me vuelvo seeder) + reportar avance al tablero.
      await store.putChunk(hash, i, buf);
      mesh.announce(hash, i);
      completed++; stats[src]++;
      mesh.progress(hash, completed, total);
      onProgress?.({ type: 'chunk', index: i, src, completed, total, stats });
    }
  }

  const workers = Math.max(1, Math.min(4, queue.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const blob = await assembleBlob(hash, total, mime);
  onProgress?.({ type: 'done', total, stats });
  return blob;
}
