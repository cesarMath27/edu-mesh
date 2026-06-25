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
import { createQuizStore } from './web/quiz-store.js';
import { createPlanStore } from './catalog/plan-store.js';
import { startAutoSync } from './sync/auto-sync.js';
import { getOrBuildChunkInfo } from './crypto/chunking.js';
import { DB_PATH, CACHE_DIR, HOME, NODE_NAME, CHUNK_SIZE, WEB_PORT, TEACHER_PIN, TEACHER_PIN_IS_GENERATED, TLS, SYNC_FROM, SYNC_INTERVAL_MIN } from './config.js';
import { makeLogger } from './util/log.js';
import { lanAddresses, bestLan } from './util/netinfo.js';
import qrcode from 'qrcode-terminal';

const log = makeLogger(`APP:${NODE_NAME}`, 'magenta');

const cacheFile = (hash) => path.join(CACHE_DIR, hash);
const hasHash = (hash) => fs.existsSync(cacheFile(hash));

fs.mkdirSync(CACHE_DIR, { recursive: true });
const cat = openCatalog(DB_PATH);

/** Info de bloques de un hash (chunk_size según el catálogo). */
async function getChunkInfo(hash) {
  if (!hasHash(hash)) return null;
  const row = cat.findArchivoByHash(hash);
  return getOrBuildChunkInfo(cacheFile(hash), row?.chunk_size || CHUNK_SIZE);
}

// Versión del catálogo: sube cuando llega contenido nuevo (por sincronización o
// por publicación del maestro) → las apps de los alumnos se refrescan solas.
let catalogVersion = 1;
const bumpCatalog = () => { catalogVersion++; };

/** Pone los estados al día con la caché real y pre-calcula sidecars (sembrar ya). */
async function refreshLocalContent() {
  for (const a of cat.listArchivos()) {
    cat.setEstado(a.content_hash, hasHash(a.content_hash) ? 'disponible' : 'pendiente');
  }
  await Promise.all(cat.listArchivos().filter((a) => hasHash(a.content_hash)).map((a) => getChunkInfo(a.content_hash)));
}
await refreshLocalContent();

const resolveHashToFile = (h) => (hasHash(h) ? cacheFile(h) : null);

// 1) Semilla P2P entre nodos (TCP de bloques + descubrimiento UDP).
const { port } = await startFileServer({ resolveHashToFile, getChunkInfo, log });
startDiscoveryResponder({ hasHash, getTcpPort: () => port, nodeName: NODE_NAME, log });

// 1.5) Sincronización automática desde el hub (opcional, --sync-from=URL).
//      Baja contenido nuevo (verificando firmas) cada --sync-interval minutos.
let autoSync = null;
if (SYNC_FROM) {
  autoSync = startAutoSync({
    from: SYNC_FROM, intervalMs: SYNC_INTERVAL_MIN * 60000,
    cat, cacheDir: CACHE_DIR, home: HOME, log,
    onChange: () => { refreshLocalContent().catch(() => {}); bumpCatalog(); },
  });
}

// 2) Servidor de UI web local + broker de señalización WebRTC (mesh de navegadores).
//    (startWebServer arranca también el broker y el tablero del maestro.)
await startWebServer({
  cat, cacheDir: CACHE_DIR, nodeName: NODE_NAME, getChunkInfo, resolveHashToFile, log,
  getSyncStatus: () => (autoSync ? autoSync.getStatus() : { enabled: false }),
  runSyncNow: autoSync ? autoSync.runNow : null,
  getCatalogVersion: () => catalogVersion,
  onCatalogChanged: bumpCatalog,
  quizStore: createQuizStore(path.join(HOME, 'quizzes')),
  planStore: createPlanStore(path.join(HOME, 'plans')),
});

// Banner de conexión: URL en este equipo, IPs para los celulares y un QR.
const proto = TLS ? 'https' : 'http';
const todas = lanAddresses();
const mejor = bestLan();
log('');
log(`  App en este equipo:   ${proto}://localhost:${WEB_PORT}`);
if (todas.length) {
  log('  Para celulares/tablets en la MISMA red WiFi:');
  for (const a of todas) log(`     ${proto}://${a.address}:${WEB_PORT}   (${a.iface})`);
}
if (mejor) {
  const url = `${proto}://${mejor.address}:${WEB_PORT}`;
  log('');
  log(`  Escanea este QR desde el celular para entrar  (${url}):`);
  qrcode.generate(url, { small: true }, (q) => console.log('\n' + q));
} else {
  log('  ⚠ Conéctate a una red local (router o hotspot) para que entren los celulares.');
}
log('');
log(`  🔑 PIN del Modo Maestro: ${TEACHER_PIN}`);
if (TEACHER_PIN_IS_GENERATED) log('     (generado al azar para esta sesión · fíjalo con --teacher-pin=TUPIN)');
log('  Este equipo también siembra para sus compañeros. (Ctrl+C para salir)');
