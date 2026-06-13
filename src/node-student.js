// =============================================================================
//  NODO ALUMNO  (el que NAVEGA el catálogo offline, BUSCA y DESCARGA)
// -----------------------------------------------------------------------------
//  Flujo:
//    1) Abre su catálogo local (importado de un manifiesto firmado y verificado).
//    2) Elige un archivo objetivo: por --hash=... o el primero que le falte.
//    3) Descarga ROBUSTA: bloques en paralelo desde varias semillas, con
//       verificación por bloque y reanudación  (ver download-manager.js).
//    4) El gestor ya valida autenticidad (firma) + integridad por bloque + hash
//       global. Si todo cuadra, el archivo queda en su caché y marcamos estado.
//
//  Ejecución (ejemplo):
//    npm run student -- --home=nodes/alumno --name=Luis
//    npm run student -- --home=nodes/alumno --name=Luis --hash=<sha256>
// =============================================================================

import path from 'node:path';
import fs from 'node:fs';

import { openCatalog } from './db/catalog.js';
import { robustDownload } from './p2p/download-manager.js';
import { DB_PATH, CACHE_DIR, NODE_NAME } from './config.js';
import { makeLogger } from './util/log.js';

const log = makeLogger(`ALUMNO:${NODE_NAME}`, 'cyan');
const cacheFile = (hash) => path.join(CACHE_DIR, hash);

fs.mkdirSync(CACHE_DIR, { recursive: true });
const cat = openCatalog(DB_PATH);

// 1) Elegir el archivo objetivo.
const hashArg = process.argv.find((a) => a.startsWith('--hash='))?.slice('--hash='.length);
const target = hashArg
  ? cat.findArchivoByHash(hashArg)
  : cat.listArchivos().find((a) => !fs.existsSync(cacheFile(a.content_hash)));

if (!target) {
  log('No hay archivos pendientes por descargar. El catálogo local está completo. ✅');
  process.exit(0);
}

log(`Objetivo: "${target.nombre}"  (${target.materia} / ${target.leccion})`);
log(`ID de contenido (hash): ${target.content_hash}`);

try {
  // 2-4) Descarga robusta (descubre, valida, baja por bloques en paralelo, ensambla).
  const r = await robustDownload({ target, cacheDir: CACHE_DIR, log });

  cat.setEstado(target.content_hash, 'disponible');
  log(`✅ ACEPTADO y guardado: ${path.relative(process.cwd(), cacheFile(target.content_hash))}`);
  log(`   Bloques: ${r.total} (descargados ${r.descargados}, reanudados ${r.reanudados}).`);
  log(`   Reparto por semilla: ${JSON.stringify(r.porPeer)}`);
  log('   Autenticidad ✔ · Verificación por bloque ✔ · Hash global ✔ · Contenido curado y legal.');
  log('   (Este dispositivo ya puede sembrar el archivo para otros compañeros.)');
  process.exit(0);
} catch (err) {
  cat.setEstado(target.content_hash, 'corrupto');
  log(`🛑 RECHAZADO → ${err.message}`);
  process.exit(2);
}
