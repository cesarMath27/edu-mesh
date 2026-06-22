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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Trae UN bloque YA VERIFICADO: primero de compañeros (WebRTC), si no, del nodo
 * central (HTTP). Si el central va saturado responde 503 → esperamos (Retry-After)
 * y reintentamos un par de veces; así la carga se reparte y la descarga es ligera.
 * Lo comparten la descarga completa y la VISTA PREVIA por bloques.
 * @returns {Promise<{buf:ArrayBuffer, src:'peer'|'central'}>}
 */
export async function fetchVerifiedChunk(hash, index, chunkHashes) {
  await ensureMesh();
  // 1) Compañeros (mesh WebRTC).
  const peers = await mesh.lookup(hash, index);
  for (const pid of peers) {
    try {
      const b = await mesh.requestChunk(pid, hash, index);
      if (b && b.byteLength && (await sha256hex(b)) === chunkHashes[index]) return { buf: b, src: 'peer' };
    } catch { /* probamos el siguiente compañero */ }
  }
  // 2) Respaldo: nodo central por HTTP (respetando el límite de carga).
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(`/api/chunk?hash=${encodeURIComponent(hash)}&index=${index}`);
    if (r.status === 503) { // central ocupado: espera y reintenta
      const wait = (Number(r.headers.get('Retry-After')) || 0) * 1000 || 600;
      await sleep(wait + Math.random() * 400);
      continue;
    }
    if (!r.ok) throw new Error('http');
    const b = await r.arrayBuffer();
    if ((await sha256hex(b)) !== chunkHashes[index]) throw new Error('corrupto');
    return { buf: b, src: 'central' };
  }
  throw new Error('central ocupado');
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
      try {
        // Trae y VERIFICA el bloque (compañeros primero, central como respaldo).
        const { buf, src } = await fetchVerifiedChunk(hash, i, info.chunkHashes);
        // Guardar + anunciar (me vuelvo seeder) + reportar avance al tablero.
        await store.putChunk(hash, i, buf);
        mesh.announce(hash, i);
        completed++; stats[src]++;
        mesh.progress(hash, completed, total);
        onProgress?.({ type: 'chunk', index: i, src, completed, total, stats });
      } catch (e) {
        if (attempts[i] < 6) { queue.push(i); continue; } // reintenta (incluye 503 del central)
        throw new Error(`no se pudo descargar el bloque ${i}: ${e.message}`);
      }
    }
  }

  const workers = Math.max(1, Math.min(4, queue.length || 1));
  await Promise.all(Array.from({ length: workers }, () => worker()));

  const blob = await assembleBlob(hash, total, mime);
  onProgress?.({ type: 'done', total, stats });
  return blob;
}
