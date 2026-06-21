// =============================================================================
//  PUBLICAR UN PAQUETE DE CONTENIDO  (rol curador) — para el hub en línea
// -----------------------------------------------------------------------------
//  Empaqueta el catálogo + el contenido firmado de un nodo en una carpeta lista
//  para subir a cualquier hosting estático (GitHub Pages, Netlify, R2, B2…):
//
//    dist-pack/
//      ├── manifest.json        # catálogo firmado
//      ├── trust-store.json     # llaves PÚBLICAS de las autoridades (seguro publicar)
//      └── content/<hash>       # los archivos, nombrados por su hash
//
//  Luego cada escuela hace, UNA vez con internet:
//    node scripts/sync.js --from=<url-del-paquete> --home=nodes/semilla
//
//  Uso:
//    node scripts/build-pack.js --home=nodes/semilla [--out=dist-pack] [--key=<keyId>]
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { buildManifest } from '../src/catalog/manifest.js';
import { pickSigningKeyId } from '../src/crypto/keystore.js';
import { DB_PATH, CACHE_DIR, ROOT, TRUST_STORE_PATH } from '../src/config.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const outDir = path.resolve(ROOT, arg('out') || 'dist-pack');

const signingKeyId = arg('key') || pickSigningKeyId();
if (!signingKeyId) { console.error('❌ No hay autoridad para firmar. Corre: npm run keys'); process.exit(1); }

const cat = openCatalog(DB_PATH);
const tree = cat.exportTree();
cat.close();

const archivos = tree.flatMap((e) => e.materias).flatMap((m) => m.lecciones).flatMap((l) => l.archivos);
if (archivos.length === 0) { console.error('❌ El catálogo está vacío. Carga contenido con: npm run content'); process.exit(1); }

// Carpeta limpia.
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(path.join(outDir, 'content'), { recursive: true });

// Manifiesto firmado + trust store PÚBLICO (sin llaves privadas).
fs.writeFileSync(path.join(outDir, 'manifest.json'), JSON.stringify(buildManifest(tree, signingKeyId), null, 2));
fs.copyFileSync(TRUST_STORE_PATH, path.join(outDir, 'trust-store.json'));

// Contenido por hash.
let n = 0; let bytes = 0; const faltan = [];
for (const a of archivos) {
  const src = path.join(CACHE_DIR, a.contentHash);
  if (fs.existsSync(src)) { fs.copyFileSync(src, path.join(outDir, 'content', a.contentHash)); n++; bytes += a.tamano; }
  else faltan.push(a.nombre);
}

console.log(`✅ Paquete listo en ${path.relative(ROOT, outDir)}/`);
console.log(`   ${n} archivo(s) · ${(bytes / 1048576).toFixed(1)} MB · firmado por ${signingKeyId}`);
if (faltan.length) console.log(`   ⚠ Sin contenido en caché (no copiados): ${faltan.join(', ')}`);
console.log('   Súbelo a tu hosting estático y en cada escuela corre:');
console.log('     node scripts/sync.js --from=<url-del-paquete> --home=nodes/semilla');
