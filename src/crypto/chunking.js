// =============================================================================
//  CHUNKING — División en bloques + verificación por bloque anclada a una raíz
// -----------------------------------------------------------------------------
//  Para transferencia robusta dividimos cada archivo en bloques (chunks) de
//  tamaño fijo y calculamos el SHA-256 de cada uno. Inspirado en las "piece
//  hashes" de BitTorrent:
//
//      chunkHashes = [ sha256(bloque_0), sha256(bloque_1), ... ]
//      chunksRoot  = sha256( chunkHashes.join('') )
//
//  `chunksRoot` es un compromiso único de TODA la lista de hashes de bloque.
//  Si firmamos `chunksRoot` (lo hace la autoridad, ver manifest/keystore),
//  entonces:
//    1) La lista de hashes recibida de un peer se valida contra `chunksRoot`.
//    2) Cada bloque descargado se valida contra su hash de la lista (ya confiable).
//  => Verificación por bloque con raíz de confianza firmada.
// =============================================================================

import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { CHUNK_SIZE } from '../config.js';

/** SHA-256 (hex) de un buffer de bloque. */
export function hashChunkBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Raíz que compromete toda la lista de hashes de bloque. */
export function chunksRootOf(chunkHashes) {
  return createHash('sha256').update(chunkHashes.join('')).digest('hex');
}

/** Cantidad de bloques para un tamaño dado. */
export function chunkCount(size, chunkSize = CHUNK_SIZE) {
  return Math.max(1, Math.ceil(size / chunkSize));
}

/** Calcula hashes de bloque a partir de un Buffer en memoria. */
export function chunkInfoFromBuffer(buf, chunkSize = CHUNK_SIZE) {
  const chunkHashes = [];
  for (let pos = 0; pos < buf.length; pos += chunkSize) {
    chunkHashes.push(hashChunkBuffer(buf.subarray(pos, pos + chunkSize)));
  }
  if (chunkHashes.length === 0) chunkHashes.push(hashChunkBuffer(Buffer.alloc(0)));
  return { size: buf.length, chunkSize, chunkHashes, chunksRoot: chunksRootOf(chunkHashes) };
}

/** Calcula hashes de bloque leyendo un archivo por trozos (no carga todo a RAM). */
export async function computeChunkHashes(filePath, chunkSize = CHUNK_SIZE) {
  const size = fs.statSync(filePath).size;
  const chunkHashes = [];
  const fd = await fs.promises.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(chunkSize);
    let pos = 0;
    while (pos < size) {
      const { bytesRead } = await fd.read(buf, 0, chunkSize, pos);
      if (bytesRead <= 0) break;
      chunkHashes.push(hashChunkBuffer(buf.subarray(0, bytesRead)));
      pos += bytesRead;
    }
  } finally {
    await fd.close();
  }
  if (chunkHashes.length === 0) chunkHashes.push(hashChunkBuffer(Buffer.alloc(0)));
  return { size, chunkSize, chunkHashes, chunksRoot: chunksRootOf(chunkHashes) };
}

/**
 * Devuelve la info de bloques de un archivo, usando un "sidecar" en caché
 * (`<archivo>.chunks.json`) para no recalcular en cada solicitud de un peer.
 */
export async function getOrBuildChunkInfo(filePath, chunkSize = CHUNK_SIZE) {
  const sidecar = `${filePath}.chunks.json`;
  if (fs.existsSync(sidecar)) {
    try {
      const cached = JSON.parse(fs.readFileSync(sidecar, 'utf8'));
      if (cached.chunkSize === chunkSize) return cached;
    } catch { /* sidecar corrupto -> se recalcula */ }
  }
  const info = await computeChunkHashes(filePath, chunkSize);
  fs.writeFileSync(sidecar, JSON.stringify(info));
  return info;
}
