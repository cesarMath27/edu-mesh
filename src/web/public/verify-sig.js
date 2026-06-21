// =============================================================================
//  VERIFICACIÓN Ed25519 EN EL NAVEGADOR
// -----------------------------------------------------------------------------
//  El celular verifica POR SÍ MISMO que el registro de cada archivo
//  ({contentHash, chunksRoot, size, chunkSize}) está firmado por una autoridad
//  confiable — no se "fía" del nodo central. Esto protege incluso el contenido
//  que llega de OTROS compañeros por WebRTC: un bloque malicioso no pasa, porque
//  su chunks_root está anclado a una firma Ed25519 que se verifica aquí.
//
//  Usa TweetNaCl (JS puro, auditado, incluye SHA-512) → funciona por http en la
//  LAN, donde crypto.subtle (Ed25519 nativo) no está disponible.
// =============================================================================

import { stableStringify } from './stable-json.js';

const b64ToBytes = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

/** Extrae la llave pública Ed25519 cruda (32 bytes) de un PEM SPKI. */
function pemToRawEd25519(pem) {
  const body = pem.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = b64ToBytes(body);
  return der.slice(der.length - 32); // en SPKI Ed25519, la llave son los últimos 32 bytes
}

/**
 * @param {object} file  archivo del catálogo: { hash, chunksRoot, tamano, chunkSize, firma, firmaKeyId }
 * @param {object} authoritiesByKeyId  { keyId: { publicKey, revoked } }
 * @returns {boolean} true si la firma es válida y la autoridad es confiable (no revocada)
 */
export function verifyFileRecord(file, authoritiesByKeyId) {
  try {
    const auth = authoritiesByKeyId[file.firmaKeyId];
    if (!auth || auth.revoked) return false;
    const record = {
      contentHash: file.hash,
      chunksRoot: file.chunksRoot,
      size: file.tamano,
      chunkSize: file.chunkSize,
    };
    const msg = new TextEncoder().encode(stableStringify(record));
    const sig = b64ToBytes(file.firma);
    const pub = pemToRawEd25519(auth.publicKey);
    return globalThis.nacl.sign.detached.verify(msg, sig, pub);
  } catch {
    return false;
  }
}
