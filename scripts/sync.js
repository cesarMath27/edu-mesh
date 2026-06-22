// =============================================================================
//  SINCRONIZAR DESDE EL HUB EN LÍNEA  (comando manual: la escuela lo corre 1 vez)
// -----------------------------------------------------------------------------
//  Baja un paquete publicado (manifest + contenido), VERIFICA las firmas contra
//  el trust store, importa el catálogo y descarga cada archivo comprobando su
//  hash. Después, el nodo distribuye todo OFFLINE por el mesh.
//
//  La lógica vive en src/sync/sync-core.js (la comparte la SINCRONIZACIÓN
//  AUTOMÁTICA del nodo: `node src/node-app.js --sync-from=URL`).
//
//  Uso:
//    node scripts/sync.js --from=https://tusitio/pack --home=nodes/semilla
// =============================================================================

import { openCatalog } from '../src/db/catalog.js';
import { syncOnce } from '../src/sync/sync-core.js';
import { DB_PATH, CACHE_DIR, HOME } from '../src/config.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = arg('from');
if (!base) { console.error('❌ Falta --from=<url-del-paquete>'); process.exit(1); }

console.log(`🌐 Sincronizando desde ${base} …`);
const cat = openCatalog(DB_PATH);
try {
  const r = await syncOnce({ base, cat, cacheDir: CACHE_DIR, home: HOME, log: console.log });
  console.log(`\n✅ Sincronización completa: ${r.bajados} bajado(s), ${r.saltados} ya estaban.`);
  if (!r.changed) console.log('   (Sin cambios desde la última vez.)');
  console.log('   Ahora arranca el nodo central para repartir OFFLINE:');
  console.log('     node src/node-app.js --home=nodes/semilla --name=Central');
} catch (err) {
  console.error(`🛑 RECHAZADO: ${err.message}`);
  cat.close();
  process.exit(2);
}
cat.close();
