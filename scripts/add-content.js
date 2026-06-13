// =============================================================================
//  AÑADIR CONTENIDO REAL AL CATÁLOGO  (rol "curador")
// -----------------------------------------------------------------------------
//  Toma un archivo real (PDF, video…), calcula su content-hash y su raíz de
//  bloques, FIRMA el registro con una autoridad y lo registra en el catálogo de
//  un nodo, copiándolo a su caché (content-addressed) con su sidecar de bloques.
//  Luego conviene regenerar el manifiesto:  npm run manifest -- --home=...
//
//  Uso:
//    npm run add -- --home=nodes/semilla \
//                   --file="C:/ruta/al/leccion.pdf" \
//                   --escuela="Escuela X" --materia="Matemáticas" \
//                   --leccion="Fracciones" [--mime=application/pdf] [--key=<keyId>]
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { computeChunkHashes } from '../src/crypto/chunking.js';
import { pickSigningKeyId, signDetached } from '../src/crypto/keystore.js';
import { stableStringify } from '../src/util/stable-json.js';
import { DB_PATH, CACHE_DIR, CHUNK_SIZE } from '../src/config.js';

const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const file = val('file');
if (!file || !fs.existsSync(file)) {
  console.error('❌ Falta --file=<ruta> o el archivo no existe.');
  process.exit(1);
}

const signingKeyId = val('key') || pickSigningKeyId();
if (!signingKeyId) {
  console.error('❌ No hay autoridad con llave privada. Corre primero: npm run keys');
  process.exit(1);
}

const escuelaNombre = val('escuela') || 'Escuela sin nombre';
const materiaNombre = val('materia') || 'General';
const leccionTitulo = val('leccion') || path.basename(file);
const mime = val('mime') || 'application/octet-stream';

// Hash + bloques + firma del registro.
const info = await computeChunkHashes(file, CHUNK_SIZE); // { size, chunkSize, chunkHashes, chunksRoot }
const { createHash } = await import('node:crypto');
const contentHash = await new Promise((resolve, reject) => {
  const h = createHash('sha256');
  const s = fs.createReadStream(file);
  s.on('data', (c) => h.update(c)); s.on('end', () => resolve(h.digest('hex'))); s.on('error', reject);
});
const record = { contentHash, chunksRoot: info.chunksRoot, size: info.size, chunkSize: info.chunkSize };
const { keyId, signature } = signDetached(stableStringify(record), signingKeyId);

// Registrar en el catálogo del home indicado.
const cat = openCatalog(DB_PATH);
const escuela = cat.insertEscuela(escuelaNombre, null);
const materia = cat.insertMateria(escuela, materiaNombre, null);
const leccion = cat.insertLeccion(materia, leccionTitulo, null, 0);
cat.upsertArchivo({
  leccionId: leccion,
  nombre: path.basename(file),
  mime,
  tamano: info.size,
  contentHash,
  chunkSize: info.chunkSize,
  chunksRoot: info.chunksRoot,
  firma: signature,
  firmaKeyId: keyId,
  estado: 'disponible',
});
cat.close();

// Copiar a la caché content-addressed + sidecar de bloques.
fs.mkdirSync(CACHE_DIR, { recursive: true });
const dest = path.join(CACHE_DIR, contentHash);
fs.copyFileSync(file, dest);
fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(info));

console.log('✅ Contenido firmado y añadido al catálogo.');
console.log(`   archivo : ${path.basename(file)} (${info.size} bytes, ${mime})`);
console.log(`   hash    : ${contentHash}`);
console.log(`   bloques : ${info.chunkHashes.length} (raíz ${info.chunksRoot.slice(0, 12)}…)`);
console.log(`   firmado : ${keyId}`);
console.log('   ➜ Regenera el manifiesto:  npm run manifest -- --home=' + path.basename(path.dirname(DB_PATH)));
