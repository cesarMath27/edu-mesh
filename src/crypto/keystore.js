// =============================================================================
//  KEYSTORE — Almacén de confianza con MÚLTIPLES autoridades y ROTACIÓN
// -----------------------------------------------------------------------------
//  Evoluciona el modelo de "una sola llave" a un TRUST STORE:
//
//   - Varias autoridades curadoras pueden firmar contenido (p.ej. SEP estatal,
//     una universidad, una ONG). Cada una tiene su par de llaves Ed25519.
//   - Cada llave se identifica por su KEY ID (huella = SHA-256 de la pública).
//   - Las firmas son "detached" y llevan el keyId, así el verificador sabe qué
//     llave pública usar.
//   - ROTACIÓN/REVOCACIÓN: una llave puede marcarse como `revoked`. A partir de
//     ahí toda firma hecha con ella se considera inválida (rota la confianza).
//
//  Archivos en disco:
//    keys/trust-store.json          -> públicas + metadatos (se distribuye)
//    keys/private/<keyId>.private.pem -> privadas (SOLO en el curador)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createHash, sign as cryptoSign, verify as cryptoVerify } from 'node:crypto';

import { TRUST_STORE_PATH, PRIVATE_KEYS_DIR, KEYS_DIR } from '../config.js';
import { generateAuthorityKeys } from './signature.js';

// --- Caché del trust store en memoria (consistente dentro de un proceso) -----
let _store = null;

function emptyStore() {
  return { version: 1, authorities: {} };
}

/** Carga (y cachea) el trust store desde disco. */
export function loadTrustStore() {
  if (_store) return _store;
  if (fs.existsSync(TRUST_STORE_PATH)) {
    _store = JSON.parse(fs.readFileSync(TRUST_STORE_PATH, 'utf8'));
  } else {
    _store = emptyStore();
  }
  return _store;
}

/** Fuerza recarga desde disco (útil tras cambios externos). */
export function reloadTrustStore() {
  _store = null;
  return loadTrustStore();
}

function saveTrustStore() {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(TRUST_STORE_PATH, JSON.stringify(_store, null, 2));
}

/** Huella corta y estable de una llave pública. */
export function keyId(publicKeyPem) {
  return createHash('sha256').update(publicKeyPem.trim()).digest('hex').slice(0, 16);
}

/**
 * Da de alta una nueva autoridad: genera par de llaves, guarda la privada y
 * registra la pública (confiable) en el trust store.
 * @returns {{keyId:string, label:string, publicKeyPem:string}}
 */
export function addAuthority(label = 'Autoridad Curadora') {
  const ts = loadTrustStore();
  const { publicKeyPem, privateKeyPem } = generateAuthorityKeys();
  const kid = keyId(publicKeyPem);

  fs.mkdirSync(PRIVATE_KEYS_DIR, { recursive: true });
  fs.writeFileSync(path.join(PRIVATE_KEYS_DIR, `${kid}.private.pem`), privateKeyPem);

  ts.authorities[kid] = {
    label,
    publicKey: publicKeyPem,
    addedAt: new Date().toISOString(),
    revoked: false,
    hasPrivate: true,
  };
  saveTrustStore();
  return { keyId: kid, label, publicKeyPem };
}

/** Marca una autoridad como revocada (sus firmas dejan de ser válidas). */
export function revokeAuthority(kid) {
  const ts = loadTrustStore();
  if (!ts.authorities[kid]) throw new Error(`No existe la autoridad ${kid}`);
  ts.authorities[kid].revoked = true;
  ts.authorities[kid].revokedAt = new Date().toISOString();
  saveTrustStore();
}

/** Lista de autoridades (para inspección/CLI). */
export function listAuthorities() {
  const ts = loadTrustStore();
  return Object.entries(ts.authorities).map(([kid, a]) => ({ keyId: kid, ...a }));
}

/** ¿Es confiable esta llave AHORA mismo? (existe y no está revocada) */
export function isTrusted(kid) {
  const a = loadTrustStore().authorities[kid];
  return !!a && !a.revoked;
}

/** Elige una llave para FIRMAR: la primera no revocada cuya privada tengamos. */
export function pickSigningKeyId() {
  const ts = loadTrustStore();
  for (const [kid, a] of Object.entries(ts.authorities)) {
    if (a.revoked) continue;
    if (fs.existsSync(path.join(PRIVATE_KEYS_DIR, `${kid}.private.pem`))) return kid;
  }
  return null;
}

function loadPrivateKeyPem(kid) {
  const p = path.join(PRIVATE_KEYS_DIR, `${kid}.private.pem`);
  if (!fs.existsSync(p)) throw new Error(`No tengo la llave privada de ${kid}`);
  return fs.readFileSync(p, 'utf8');
}

/**
 * Firma `dataStr` (string canónico) con la autoridad `kid`.
 * @returns {{keyId:string, signature:string}}  firma detached en base64.
 */
export function signDetached(dataStr, kid) {
  const privateKeyPem = loadPrivateKeyPem(kid);
  const signature = cryptoSign(null, Buffer.from(dataStr, 'utf8'), privateKeyPem);
  return { keyId: kid, signature: signature.toString('base64') };
}

/**
 * Verifica una firma detached contra el trust store.
 * Falla si la llave es desconocida, está revocada, o la firma no cuadra.
 * @returns {boolean}
 */
export function verifyDetached(dataStr, { keyId: kid, signature } = {}) {
  try {
    if (!kid || !signature) return false;
    if (!isTrusted(kid)) return false; // desconocida o revocada
    const publicKeyPem = loadTrustStore().authorities[kid].publicKey;
    return cryptoVerify(null, Buffer.from(dataStr, 'utf8'), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}
