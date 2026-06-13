// =============================================================================
//  MANIFIESTO DEL CATÁLOGO FIRMADO  (Feature 1: cadena de confianza)
// -----------------------------------------------------------------------------
//  En vez de confiar archivo por archivo de forma aislada, el curador publica un
//  MANIFIESTO: el catálogo COMPLETO (escuelas/materias/lecciones/archivos) más
//  una firma de autoridad sobre todo el documento.
//
//  Ventajas:
//   - El catálogo entero puede distribuirse offline (USB, P2P) y verificarse de
//     una sola vez contra el trust store antes de importarlo.
//   - Detecta inserciones/borrados de lecciones, no solo la alteración de un PDF.
//   - Coexiste con la firma POR archivo (defensa en profundidad y validación
//     autónoma durante la transferencia P2P).
//
//  Estructura:
//    {
//      "payload": { version, generatedAt, authority, escuelas:[...árbol...] },
//      "manifestSig": { keyId, signature }   // firma de stableStringify(payload)
//    }
// =============================================================================

import { signDetached, verifyDetached } from '../crypto/keystore.js';
import { stableStringify } from '../util/stable-json.js';

/**
 * Construye y FIRMA un manifiesto a partir de un árbol de catálogo.
 * @param {Array}  tree         Árbol (ver catalog.exportTree()).
 * @param {string} signingKeyId Autoridad que firma.
 */
export function buildManifest(tree, signingKeyId) {
  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    authority: signingKeyId,
    escuelas: tree,
  };
  const manifestSig = signDetached(stableStringify(payload), signingKeyId);
  return { payload, manifestSig };
}

/**
 * Verifica la firma del manifiesto contra el trust store.
 * @returns {object} el payload si es válido.
 * @throws  si la firma es inválida o de autoridad no confiable/revocada.
 */
export function verifyManifest(manifest) {
  const ok = verifyDetached(stableStringify(manifest.payload), manifest.manifestSig);
  if (!ok) {
    throw new Error('Firma del MANIFIESTO inválida, o autoridad no confiable / revocada.');
  }
  return manifest.payload;
}

/**
 * Verifica el manifiesto e IMPORTA su contenido en un catálogo local (DAO).
 * Verifica también la firma POR archivo (a menos que se desactive).
 * @param {object} manifest
 * @param {object} cat               DAO de openCatalog().
 * @param {object} [opts]
 * @param {boolean} [opts.verifyFiles=true]
 * @param {boolean} [opts.reset=true] Limpia el catálogo antes de importar.
 * @returns {{escuelas:number, archivos:number}}
 */
export function importManifest(manifest, cat, { verifyFiles = true, reset = true } = {}) {
  const payload = verifyManifest(manifest); // ← falla aquí si la firma no cuadra
  if (reset) cat.reset();

  let nEscuelas = 0;
  let nArchivos = 0;

  for (const esc of payload.escuelas) {
    const escuelaId = cat.insertEscuela(esc.nombre, esc.localidad);
    nEscuelas++;
    for (const mat of esc.materias ?? []) {
      const materiaId = cat.insertMateria(escuelaId, mat.nombre, mat.grado);
      for (const lec of mat.lecciones ?? []) {
        const leccionId = cat.insertLeccion(materiaId, lec.titulo, lec.descripcion, lec.orden ?? 0);
        for (const arc of lec.archivos ?? []) {
          if (verifyFiles) {
            const record = {
              contentHash: arc.contentHash,
              chunksRoot: arc.chunksRoot,
              size: arc.tamano,
              chunkSize: arc.chunkSize,
            };
            const ok = verifyDetached(stableStringify(record), { keyId: arc.firmaKeyId, signature: arc.firma });
            if (!ok) throw new Error(`Firma por archivo inválida: "${arc.nombre}". Importación abortada.`);
          }
          cat.upsertArchivo({
            leccionId,
            nombre: arc.nombre,
            mime: arc.mime,
            tamano: arc.tamano,
            contentHash: arc.contentHash,
            chunkSize: arc.chunkSize,
            chunksRoot: arc.chunksRoot,
            firma: arc.firma,
            firmaKeyId: arc.firmaKeyId,
            estado: 'pendiente',
          });
          nArchivos++;
        }
      }
    }
  }
  return { escuelas: nEscuelas, archivos: nArchivos };
}
