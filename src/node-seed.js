// =============================================================================
//  NODO SEMILLA  (el alumno que YA tiene el archivo y lo COMPARTE)
// -----------------------------------------------------------------------------
//  Responsabilidades:
//    1) Abrir su catálogo local y su carpeta de caché (content-addressed).
//    2) Pre-calcular la info de bloques (sidecar) de cada archivo que comparte.
//    3) Levantar el servidor TCP de transferencia POR BLOQUES.
//    4) Levantar el responder UDP de descubrimiento ("yo tengo este hash").
//
//  Ejecución (ejemplo):
//    npm run seed -- --home=nodes/semilla --name=Ana
// =============================================================================

import path from 'node:path';
import fs from 'node:fs';

import { openCatalog } from './db/catalog.js';
import { startFileServer } from './p2p/server.js';
import { startDiscoveryResponder } from './p2p/discovery.js';
import { getOrBuildChunkInfo } from './crypto/chunking.js';
import { DB_PATH, CACHE_DIR, NODE_NAME, CHUNK_SIZE } from './config.js';
import { makeLogger } from './util/log.js';

const log = makeLogger(`SEMILLA:${NODE_NAME}`, 'green');

// Caché "content-addressed": el archivo se guarda con su hash como nombre.
const cacheFile = (hash) => path.join(CACHE_DIR, hash);
const hasHash = (hash) => fs.existsSync(cacheFile(hash));

fs.mkdirSync(CACHE_DIR, { recursive: true });
const cat = openCatalog(DB_PATH);

// Sincronizamos el estado del catálogo con lo que realmente hay en caché.
for (const a of cat.listArchivos()) {
  cat.setEstado(a.content_hash, hasHash(a.content_hash) ? 'disponible' : 'pendiente');
}

/** Info de bloques de un hash, usando el chunk_size que fijó el catálogo. */
async function getChunkInfo(hash) {
  if (!hasHash(hash)) return null;
  const row = cat.findArchivoByHash(hash);
  const chunkSize = row?.chunk_size || CHUNK_SIZE;
  return getOrBuildChunkInfo(cacheFile(hash), chunkSize);
}

// Pre-calculamos sidecars al arrancar (para responder MANIFEST al instante).
const compartidos = cat.listArchivos().filter((a) => hasHash(a.content_hash));
await Promise.all(compartidos.map((a) => getChunkInfo(a.content_hash)));

// 1) Servidor TCP de bloques (puerto automático si TCP_PORT=0).
const { port } = await startFileServer({
  resolveHashToFile: (h) => (hasHash(h) ? cacheFile(h) : null),
  getChunkInfo,
  log,
});

// 2) Responder UDP de descubrimiento.
startDiscoveryResponder({ hasHash, getTcpPort: () => port, nodeName: NODE_NAME, log });

// 3) Reportamos qué compartimos.
if (compartidos.length === 0) {
  log('⚠ No hay archivos en la caché de este nodo. ¿Corriste "npm run setup"?');
} else {
  log('Compartiendo en la red local:');
  for (const a of compartidos) {
    log(`  • ${a.materia} / ${a.leccion} → ${a.nombre}  [${a.content_hash.slice(0, 12)}…]`);
  }
}
log('Nodo semilla listo. Esperando solicitudes de compañeros…  (Ctrl+C para salir)');
