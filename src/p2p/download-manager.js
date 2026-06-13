// =============================================================================
//  GESTOR DE DESCARGA ROBUSTA  (Feature 2)
// -----------------------------------------------------------------------------
//  Orquesta una descarga resistente y eficiente:
//
//   1) AUTENTICIDAD: verifica la firma del registro del archivo (trust store).
//   2) DESCUBRE compañeros en la LAN que tienen el hash.
//   3) Obtiene la LISTA de hashes de bloque y la valida contra `chunks_root`
//      (que viene firmado) -> la lista pasa a ser confiable.
//   4) REANUDACIÓN: revisa qué bloques ya están bajados y válidos en el .partial.
//   5) PARALELO MULTI-SEMILLA: un pool de workers reparte los bloques faltantes
//      entre TODOS los compañeros, reintentando en otro peer si uno falla.
//   6) Verifica CADA bloque contra su hash (verificación por bloque).
//   7) Ensambla, verifica el hash del archivo COMPLETO y publica en la caché.
//
//  `onProgress(evento)` permite a una UI (web/SSE) seguir la descarga en vivo.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createWriteStream } from 'node:fs';

import { lookupPeers } from './discovery.js';
import { fetchChunkList, fetchChunk } from './client.js';
import { hashChunkBuffer, chunksRootOf } from '../crypto/chunking.js';
import { hashFile } from '../crypto/hashing.js';
import { verifyFileRecordSignature } from '../crypto/validation.js';
import { CONCURRENCY, LOOKUP_TIMEOUT_MS } from '../config.js';

const cacheFileFor = (cacheDir, hash) => path.join(cacheDir, hash);
const partialDirFor = (cacheDir, hash) => path.join(cacheDir, '.partial', hash);

/**
 * @param {object} p
 * @param {object} p.target       Fila del catálogo (content_hash, chunks_root, chunk_size, tamano, firma, firma_key_id…).
 * @param {string} p.cacheDir
 * @param {number} [p.concurrency]
 * @param {Function} [p.log]
 * @param {(evt:object)=>void} [p.onProgress]  Eventos: authenticated|peers|chunks|resumed|block|assembling.
 * @returns {Promise<{total:number, descargados:number, reanudados:number, porPeer:object}>}
 */
export async function robustDownload({ target, cacheDir, concurrency = CONCURRENCY, log, onProgress = () => {} }) {
  const hash = target.content_hash;

  // --- 1) Autenticidad del registro (firma de autoridad confiable) ---
  if (!verifyFileRecordSignature(target)) {
    throw new Error('Firma del registro inválida o de autoridad no confiable/revocada. Descarga abortada.');
  }
  log?.('✔ Registro del archivo autenticado por la autoridad curadora.');
  onProgress({ type: 'authenticated' });

  // --- 2) Descubrir compañeros ---
  const peers = await lookupPeers(hash, { timeout: LOOKUP_TIMEOUT_MS, log });
  if (peers.length === 0) throw new Error('Ningún compañero en la red local tiene este archivo.');
  log?.(`👥 ${peers.length} compañero(s) disponibles: ${peers.map((p) => p.node).join(', ')}`);
  onProgress({ type: 'peers', peers: peers.map((p) => p.node) });

  // --- 3) Lista de bloques confiable (validada contra chunks_root firmado) ---
  let chunkHashes = null;
  for (const peer of peers) {
    try {
      const list = await fetchChunkList(peer, hash);
      if (list.chunkSize === target.chunk_size && chunksRootOf(list.chunkHashes) === target.chunks_root) {
        chunkHashes = list.chunkHashes;
        break;
      }
      log?.(`⚠ Lista de bloques de ${peer.node} no coincide con la raíz firmada; pruebo otro.`);
    } catch { /* siguiente peer */ }
  }
  if (!chunkHashes) throw new Error('No se obtuvo una lista de bloques auténtica (raíz no coincide).');
  const total = chunkHashes.length;
  log?.(`🧩 Archivo en ${total} bloques de ${target.chunk_size} B. Verificación por bloque activa.`);
  onProgress({ type: 'chunks', total, chunkSize: target.chunk_size });

  // --- 4) Reanudación: ¿qué bloques ya tengo válidos? ---
  const partDir = partialDirFor(cacheDir, hash);
  fs.mkdirSync(partDir, { recursive: true });
  const pending = [];
  let resumed = 0;
  for (let i = 0; i < total; i++) {
    const cf = path.join(partDir, String(i));
    if (fs.existsSync(cf) && hashChunkBuffer(fs.readFileSync(cf)) === chunkHashes[i]) {
      resumed++;
    } else {
      pending.push(i);
    }
  }
  if (resumed > 0) log?.(`↻ Reanudando: ${resumed}/${total} bloques ya estaban descargados y válidos.`);
  let completed = resumed;
  onProgress({ type: 'resumed', resumed, total, completed });

  // --- 5) Pool de workers en paralelo, repartiendo entre semillas ---
  const queue = [...pending];
  const porPeer = {};
  let nextPeer = 0;

  async function worker() {
    while (queue.length) {
      const i = queue.shift();
      if (i === undefined) break;
      let ok = false;
      for (let attempt = 0; attempt < peers.length && !ok; attempt++) {
        const peer = peers[nextPeer++ % peers.length];
        try {
          const buf = await fetchChunk(peer, hash, i);
          // ---- 6) Verificación por bloque ----
          if (hashChunkBuffer(buf) !== chunkHashes[i]) {
            log?.(`✘ bloque ${i} de ${peer.node} corrupto; reintento en otro peer.`);
            continue;
          }
          fs.writeFileSync(path.join(partDir, String(i)), buf);
          porPeer[peer.node] = (porPeer[peer.node] || 0) + 1;
          completed++;
          ok = true;
          log?.(`✔ bloque ${i + 1}/${total} ← ${peer.node}`);
          onProgress({ type: 'block', index: i, from: peer.node, completed, total });
        } catch {
          /* probamos el siguiente peer */
        }
      }
      if (!ok) throw new Error(`No se pudo descargar el bloque ${i} de ningún compañero.`);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, queue.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  // --- 7) Ensamblar + verificar el archivo completo + publicar ---
  onProgress({ type: 'assembling' });
  const tmp = cacheFileFor(cacheDir, hash) + '.part';
  const ws = createWriteStream(tmp);
  for (let i = 0; i < total; i++) {
    ws.write(fs.readFileSync(path.join(partDir, String(i))));
  }
  await new Promise((res) => ws.end(res));

  const whole = await hashFile(tmp);
  if (whole !== hash) {
    fs.rmSync(tmp, { force: true });
    throw new Error(`Integridad global fallida: hash ensamblado ${whole.slice(0, 12)}… ≠ ${hash.slice(0, 12)}…`);
  }

  fs.renameSync(tmp, cacheFileFor(cacheDir, hash));
  fs.rmSync(partDir, { recursive: true, force: true });

  return { total, descargados: pending.length, reanudados: resumed, porPeer };
}
