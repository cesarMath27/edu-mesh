// =============================================================================
//  CONSTRUIR Y FIRMAR EL MANIFIESTO DEL CATÁLOGO  (rol curador, Feature 1)
// -----------------------------------------------------------------------------
//  Lee el catálogo de un "home" (normalmente el del curador/semilla), construye
//  el árbol completo y lo FIRMA con una autoridad. El manifiesto resultante puede
//  distribuirse offline (USB/P2P) y cada dispositivo lo verifica antes de importar.
//
//  Uso:
//    npm run manifest -- --home=nodes/semilla [--key=<keyId>] [--out=manifest.json]
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { buildManifest } from '../src/catalog/manifest.js';
import { pickSigningKeyId } from '../src/crypto/keystore.js';
import { DB_PATH, ROOT } from '../src/config.js';

const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const signingKeyId = val('key') || pickSigningKeyId();
if (!signingKeyId) {
  console.error('❌ No hay autoridad con llave privada para firmar. Corre: npm run keys');
  process.exit(1);
}

const out = path.resolve(ROOT, val('out') || 'manifest.json');

const cat = openCatalog(DB_PATH);
const tree = cat.exportTree();
cat.close();

const manifest = buildManifest(tree, signingKeyId);
fs.writeFileSync(out, JSON.stringify(manifest, null, 2));

const nArchivos = tree.flatMap((e) => e.materias).flatMap((m) => m.lecciones).flatMap((l) => l.archivos).length;
console.log('✅ Manifiesto firmado generado.');
console.log(`   archivo : ${path.relative(ROOT, out)}`);
console.log(`   firmado por: ${signingKeyId}`);
console.log(`   contenido: ${tree.length} escuela(s), ${nArchivos} archivo(s).`);
