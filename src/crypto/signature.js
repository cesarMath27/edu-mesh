// =============================================================================
//  FIRMA DIGITAL — Autenticidad y procedencia (contenido "curado y legal")
// -----------------------------------------------------------------------------
//  Usamos Ed25519 (curva moderna, firmas pequeñas y rápidas, nativo en Node).
//
//  MODELO DE CONFIANZA:
//    - Existe UNA "autoridad curadora" (p.ej. la Secretaría de Educación o la
//      ONG que aprueba el material) que posee una LLAVE PRIVADA.
//    - Esa autoridad FIRMA el content-hash de cada archivo aprobado.
//    - Todos los dispositivos llevan la LLAVE PÚBLICA de la autoridad.
//
//  Resultado: aunque el archivo viaje de alumno en alumno por la red WiFi local
//  (sin tocar internet), cualquier nodo puede demostrar que ese archivo:
//    1) NO fue alterado  (el hash coincide), y
//    2) FUE aprobado por la autoridad  (la firma del hash es válida).
//  Si alguien inyecta contenido pirata o malicioso, no tendrá una firma válida.
// =============================================================================

import { generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Genera un par de llaves Ed25519 para la autoridad curadora.
 * @returns {{publicKeyPem: string, privateKeyPem: string}}
 */
export function generateAuthorityKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  return {
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

/**
 * Firma un content-hash con la llave privada de la autoridad.
 * (En Ed25519 el algoritmo de digest es `null`: la curva ya lo gestiona.)
 * @returns {string} Firma en base64.
 */
export function signHash(contentHashHex, privateKeyPem) {
  const data = Buffer.from(contentHashHex, 'utf8');
  return sign(null, data, privateKeyPem).toString('base64');
}

/**
 * Verifica que `signatureB64` sea una firma válida de `contentHashHex`
 * hecha con la llave privada correspondiente a `publicKeyPem`.
 * @returns {boolean}
 */
export function verifyHashSignature(contentHashHex, signatureB64, publicKeyPem) {
  try {
    const data = Buffer.from(contentHashHex, 'utf8');
    const signature = Buffer.from(signatureB64, 'base64');
    return verify(null, data, publicKeyPem, signature);
  } catch {
    // Llave mal formada, firma corrupta, etc. -> tratamos como inválida.
    return false;
  }
}
