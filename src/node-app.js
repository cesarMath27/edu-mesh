// =============================================================================
//  NODO APP  — el producto por dispositivo: SEMILLA P2P + UI web local
// -----------------------------------------------------------------------------
//  Un solo proceso que:
//    1) Abre el catálogo y la caché del dispositivo.
//    2) Actúa como SEMILLA: comparte por bloques lo que tiene y responde al
//       descubrimiento de la LAN (igual que node-seed.js).
//    3) Sirve la UI web local (catálogo navegable + descarga con progreso).
//
//  Así cada alumno corre `node src/node-app.js` y obtiene navegador de catálogo,
//  descargas P2P verificadas, y a la vez siembra para sus compañeros.
//
//  Ejecución (ejemplo):
//    node src/node-app.js --home=nodes/alumno --name=Luis --web-port=8080
// =============================================================================

import path from 'node:path';
import fs from 'node:fs';

import { openCatalog } from './db/catalog.js';
import { startFileServer } from './p2p/server.js';
import { startDiscoveryResponder } from './p2p/discovery.js';
import { startWebServer } from './web/server.js';
import { getOrBuildChunkInfo } from './crypto/chunking.js';
import { DB_PATH, CACHE_DIR, NODE_NAME, CHUNK_SIZE, WEB_PORT } from './config.js';
import { makeLogger } from './util/log.js';

const log = makeLogger(`APP:${NODE_NAME}`, 'magenta');

const cacheFile = (hash) => path.join(CACHE_DIR, hash);
const hasHash = (hash) => fs.existsSync(cacheFile(hash));

fs.mkdirSync(CACHE_DIR, { recursive: true });
const cat = openCatalog(DB_PATH);

// Sincroniza estados con la caché real.
for (const a of cat.listArchivos()) {
  cat.setEstado(a.content_hash, hasHash(a.content_hash) ? 'disponible' : 'pendiente');
}

/** Info de bloques de un hash (chunk_size según el catálogo). */
async function getChunkInfo(hash) {
  if (!hasHash(hash)) return null;
  const row = cat.findArchivoByHash(hash);
  return getOrBuildChunkInfo(cacheFile(hash), row?.chunk_size || CHUNK_SIZE);
}

// Pre-calcula sidecars de lo que ya tenemos (para sembrar al instante).
await Promise.all(cat.listArchivos().filter((a) => hasHash(a.content_hash)).map((a) => getChunkInfo(a.content_hash)));

const resolveHashToFile = (h) => (hasHash(h) ? cacheFile(h) : null);

// 1) Semilla P2P entre nodos (TCP de bloques + descubrimiento UDP).
const { port } = await startFileServer({ resolveHashToFile, getChunkInfo, log });
startDiscoveryResponder({ hasHash, getTcpPort: () => port, nodeName: NODE_NAME, log });

// 2) Servidor de UI web local + broker de señalización WebRTC (mesh de navegadores).
//    (startWebServer arranca también el broker y el tablero del maestro.)
await startWebServer({
  cat, cacheDir: CACHE_DIR, nodeName: NODE_NAME, getChunkInfo, resolveHashToFile, log,
});

log('');
log(`  Abre la app del catálogo en:  http://localhost:${WEB_PORT}`);
log('  Este dispositivo también está sembrando para sus compañeros. (Ctrl+C para salir)');
