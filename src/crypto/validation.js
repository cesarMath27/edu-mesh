// =============================================================================
//  VALIDACIÓN DE PROCEDENCIA  (firma del registro de archivo)
// -----------------------------------------------------------------------------
//  Cada archivo del catálogo lleva una firma "detached" de una autoridad sobre
//  un REGISTRO canónico que ata su identidad y su estructura de bloques:
//
//      registro = { contentHash, chunksRoot, size, chunkSize }
//
//  Firmar el `chunksRoot` (no solo el contentHash) permite verificar bloque a
//  bloque durante una descarga por trozos, con la raíz anclada a la autoridad.
//
//  La verificación de INTEGRIDAD (hash real == esperado) y por BLOQUE ocurre en
//  el gestor de descargas (download-manager.js / chunking.js). Aquí validamos la
//  AUTENTICIDAD del registro contra el trust store.
// =============================================================================

import { verifyDetached } from './keystore.js';
import { stableStringify } from '../util/stable-json.js';

/** Construye el registro canónico que la autoridad firma, a partir de una fila. */
export function fileRecord(archivo) {
  return {
    contentHash: archivo.content_hash,
    chunksRoot: archivo.chunks_root,
    size: archivo.tamano,
    chunkSize: archivo.chunk_size,
  };
}

/** ¿La firma del registro es válida y de una autoridad confiable (no revocada)? */
export function verifyFileRecordSignature(archivo) {
  return verifyDetached(stableStringify(fileRecord(archivo)), {
    keyId: archivo.firma_key_id,
    signature: archivo.firma,
  });
}
