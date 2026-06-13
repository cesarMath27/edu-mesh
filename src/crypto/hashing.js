// =============================================================================
//  HASHING — "Content Hash" (la huella digital / ID único de cada archivo)
// -----------------------------------------------------------------------------
//  Usamos SHA-256. El hash es el IDENTIFICADOR del archivo dentro de toda la red:
//    - El catálogo guarda este hash.
//    - La caché guarda el archivo con este hash como nombre (content-addressed).
//    - El descubrimiento P2P pregunta a la red "¿quién tiene este hash?".
//    - La validación recalcula el hash del archivo recibido y lo compara.
//
//  Si dos archivos tienen el mismo contenido, tienen el mismo hash. Si alguien
//  altera un solo bit, el hash cambia por completo -> detectamos la manipulación.
// =============================================================================

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** Hash SHA-256 (hex) de un Buffer en memoria. */
export function hashBuffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Hash SHA-256 (hex) de un archivo, leyéndolo por streaming.
 * Importante para archivos pesados (videos): no carga todo en memoria.
 */
export function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}
