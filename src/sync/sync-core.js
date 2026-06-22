// =============================================================================
//  NÚCLEO DE SINCRONIZACIÓN  — una pasada de "bajar del hub y verificar"
// -----------------------------------------------------------------------------
//  Lógica reutilizable que comparten el comando manual (scripts/sync.js) y la
//  SINCRONIZACIÓN AUTOMÁTICA (src/sync/auto-sync.js). Hace una sola pasada:
//
//    1) Descarga el manifiesto del hub y detecta si CAMBIÓ desde la última vez
//       (huella en <home>/last-sync.json) → si no cambió y ya tenemos todo,
//       no descarga nada (sincronizar seguido sale casi gratis).
//    2) Confía en la autoridad del paquete (TOFU la 1ª vez) y VERIFICA la firma
//       del manifiesto + la firma por archivo al importarlo.
//    3) Descarga SOLO los archivos que falten, comprobando su hash, y escribe el
//       "sidecar" de bloques para poder sembrarlos de inmediato por el mesh.
//
//  Devuelve un resumen ({ changed, bajados, saltados, escuelas, archivos, ... }).
//  No lanza por errores de red transitorios silenciosamente: los propaga para
//  que quien llama (auto-sync) los registre y reintente con backoff.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { importManifest } from '../catalog/manifest.js';
import { isTrusted, addTrustedPublic, reloadTrustStore } from '../crypto/keystore.js';
import { hashBuffer } from '../crypto/hashing.js';
import { chunkInfoFromBuffer } from '../crypto/chunking.js';
import { stableStringify } from '../util/stable-json.js';

const sha256hex = (str) => createHash('sha256').update(str).digest('hex');

async function getJson(url, fetchImpl) {
  const r = await fetchImpl(url);
  if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`);
  return r.json();
}

/**
 * Ejecuta UNA sincronización contra el hub.
 * @param {object}  p
 * @param {string}  p.base       URL base del paquete (sin barra final).
 * @param {object}  p.cat        DAO de openCatalog().
 * @param {string}  p.cacheDir   Carpeta de caché del nodo (HOME/cache).
 * @param {string}  [p.home]     Carpeta del nodo (para guardar last-sync.json). Por defecto = dirname(cacheDir).
 * @param {Function}[p.log]
 * @param {Function}[p.fetchImpl] fetch a usar (inyectable para pruebas).
 * @returns {Promise<{changed:boolean, bajados:number, saltados:number, escuelas:number, archivos:number, manifestHash:string, at:string}>}
 */
export async function syncOnce({ base, cat, cacheDir, home, log, fetchImpl = fetch }) {
  base = String(base || '').replace(/\/$/, '');
  if (!base) throw new Error('Falta la URL del hub (--sync-from / --from).');
  home = home || path.dirname(cacheDir);
  const lastPath = path.join(home, 'last-sync.json');

  // --- 1) Manifiesto + detección de cambios ---
  const manifest = await getJson(`${base}/manifest.json`, fetchImpl);
  const manifestHash = sha256hex(stableStringify(manifest));
  let last = null;
  try { last = JSON.parse(fs.readFileSync(lastPath, 'utf8')); } catch { /* primera vez */ }
  const changedManifest = !last || last.manifestHash !== manifestHash;

  // --- 2) Importar (solo si el manifiesto cambió): confianza + verificación ---
  let escuelas = last?.escuelas || 0;
  let archivos = last?.archivos || 0;
  if (changedManifest) {
    const authKid = manifest.manifestSig?.keyId;
    if (!authKid) throw new Error('El manifiesto no indica autoridad firmante.');
    if (!isTrusted(authKid)) {
      let ts = null;
      try { ts = await getJson(`${base}/trust-store.json`, fetchImpl); } catch { /* sin trust-store publicado */ }
      const auth = ts?.authorities?.[authKid];
      if (!auth) throw new Error('No conozco a la autoridad y el paquete no publica su llave. Sincronización abortada.');
      log?.(`⚠ Primera vez que confío en la autoridad "${auth.label}". Huella (keyId): ${authKid}`);
      log?.('  Verifícala por un canal aparte si te importa la seguridad.');
      addTrustedPublic({ keyId: authKid, publicKey: auth.publicKey, label: auth.label });
      reloadTrustStore();
    }
    const r = importManifest(manifest, cat); // ← lanza si firma inválida/autoridad revocada
    escuelas = r.escuelas; archivos = r.archivos;
    log?.(`✔ Catálogo verificado e importado: ${escuelas} escuela(s), ${archivos} archivo(s).`);
  }

  // --- 3) Descargar SOLO lo que falte (verificando cada hash) ---
  fs.mkdirSync(cacheDir, { recursive: true });
  let bajados = 0; let saltados = 0;
  for (const a of cat.listArchivos()) {
    const dest = path.join(cacheDir, a.content_hash);
    if (fs.existsSync(dest)) { saltados++; cat.setEstado(a.content_hash, 'disponible'); continue; }
    const url = `${base}/content/${a.content_hash}`;
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`No se pudo bajar "${a.nombre}" (HTTP ${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (hashBuffer(buf) !== a.content_hash) throw new Error(`Hash no coincide en "${a.nombre}". Sincronización abortada.`);
    fs.writeFileSync(dest, buf);
    fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(chunkInfoFromBuffer(buf, a.chunk_size)));
    cat.setEstado(a.content_hash, 'disponible');
    bajados++;
    log?.(`  ⬇ ${a.materia} / ${a.leccion} / ${a.nombre}  (${(a.tamano / 1048576).toFixed(2)} MB)`);
  }

  // --- 4) Recordar el estado para la próxima pasada ---
  const at = new Date().toISOString();
  try {
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(lastPath, JSON.stringify({ manifestHash, at, escuelas, archivos, base }, null, 2));
  } catch { /* sin permiso de escritura: no es fatal */ }

  return { changed: changedManifest || bajados > 0, bajados, saltados, escuelas, archivos, manifestHash, at };
}
