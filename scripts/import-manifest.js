// =============================================================================
//  VERIFICAR E IMPORTAR UN MANIFIESTO EN UN DISPOSITIVO  (Feature 1)
// -----------------------------------------------------------------------------
//  Simula la "sincronización offline" del catálogo: un dispositivo recibe el
//  manifest.json (por USB, P2P, etc.) y lo importa SOLO si su firma es válida y
//  proviene de una autoridad confiable (no revocada). Si falla, no importa nada.
//
//  Uso:
//    npm run import -- --home=nodes/alumno [--manifest=manifest.json]
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { importManifest } from '../src/catalog/manifest.js';
import { DB_PATH, ROOT } from '../src/config.js';

const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const manifestPath = path.resolve(ROOT, val('manifest') || 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`❌ No existe el manifiesto: ${manifestPath}. Genera uno con: npm run manifest`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const cat = openCatalog(DB_PATH);

try {
  const r = importManifest(manifest, cat); // ← verifica firma global + por archivo
  console.log('✅ Manifiesto VERIFICADO e importado.');
  console.log(`   home: ${path.dirname(DB_PATH)}`);
  console.log(`   ${r.escuelas} escuela(s), ${r.archivos} archivo(s) en el catálogo.`);
} catch (err) {
  console.error(`🛑 RECHAZADO: ${err.message}`);
  process.exitCode = 2;
} finally {
  cat.close();
}
