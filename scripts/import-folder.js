// =============================================================================
//  IMPORTADOR DE CONTENIDO POR CARPETAS  (la forma práctica de "llenarlo")
// -----------------------------------------------------------------------------
//  La estructura de carpetas ES la clasificación:
//
//    contenido/<Escuela>/<Materia>/<NN - Lección>/<archivos…>
//
//  - Cada nivel es escuela → materia → lección.
//  - Un prefijo numérico ("01 - ", "1. ", "2_") en la lección define el ORDEN
//    (y se quita del título). También funciona en escuela/materia para ordenar.
//  - Cada archivo (pdf, mp4, mp3, epub, jpg…) se hashea, se firma y se registra.
//
//  La carpeta es la FUENTE DE VERDAD: el catálogo se reconstruye desde cero en
//  cada corrida, y al final se regenera el manifiesto firmado para distribuir.
//
//  Uso:
//    node scripts/import-folder.js --home=nodes/semilla [--src=contenido]
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { computeChunkHashes } from '../src/crypto/chunking.js';
import { hashFile } from '../src/crypto/hashing.js';
import { pickSigningKeyId, signDetached } from '../src/crypto/keystore.js';
import { stableStringify } from '../src/util/stable-json.js';
import { buildManifest } from '../src/catalog/manifest.js';
import { DB_PATH, CACHE_DIR, CHUNK_SIZE, ROOT } from '../src/config.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const SRC = path.resolve(ROOT, arg('src') || 'contenido');

const MIME = {
  '.pdf': 'application/pdf', '.epub': 'application/epub+zip',
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.wav': 'audio/wav',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.txt': 'text/plain', '.md': 'text/markdown',
};
const mimeOf = (f) => MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';

/** "01 - Nombre" | "1. Nombre" | "2_Nombre" -> { orden, titulo } */
function parseOrder(name) {
  const m = name.match(/^\s*(\d+)\s*[-._)]\s*(.+)$/);
  return m ? { orden: Number(m[1]), titulo: m[2].trim() } : { orden: 0, titulo: name.trim() };
}
const subdirs = (p) => fs.readdirSync(p, { withFileTypes: true })
  .filter((d) => d.isDirectory()).map((d) => d.name)
  .sort((a, b) => { const A = parseOrder(a), B = parseOrder(b); return A.orden - B.orden || A.titulo.localeCompare(B.titulo, 'es'); });
const filesIn = (p) => fs.readdirSync(p, { withFileTypes: true })
  .filter((d) => d.isFile() && !d.name.startsWith('.')).map((d) => d.name).sort((a, b) => a.localeCompare(b, 'es'));

// --- Si no existe la carpeta, dejamos un ejemplo y explicamos la estructura ---
function scaffold() {
  const ej = path.join(SRC, 'Primaria Benito Juárez', 'Ciencias Naturales', '01 - La Fotosíntesis');
  fs.mkdirSync(ej, { recursive: true });
  fs.writeFileSync(path.join(ej, 'apunte.txt'), 'Reemplaza este archivo por tu PDF/video real.\n');
  fs.writeFileSync(path.join(SRC, 'LEEME.txt'),
    'Estructura:  contenido/<Escuela>/<Materia>/<NN - Lección>/<archivos>\n' +
    'Pon prefijo numérico (01 -, 02 -) en las lecciones para ordenarlas.\n' +
    'Luego corre:  node scripts/import-folder.js --home=nodes/semilla\n');
}

const signingKeyId = pickSigningKeyId();
if (!signingKeyId) { console.error('❌ No hay autoridad para firmar. Corre primero: npm run keys'); process.exit(1); }

if (!fs.existsSync(SRC)) {
  scaffold();
  console.log(`📂 Creé la carpeta de ejemplo en "${path.relative(ROOT, SRC)}".`);
  console.log('   Mete ahí tus libros/videos (ver LEEME.txt) y vuelve a correr este comando.');
  process.exit(0);
}

const cat = openCatalog(DB_PATH);
cat.reset(); // la carpeta es la fuente de verdad
fs.mkdirSync(CACHE_DIR, { recursive: true });

let nFiles = 0; let nBytes = 0;
const tree = [];

for (const escuelaDir of subdirs(SRC)) {
  const escuela = parseOrder(escuelaDir);
  const escuelaId = cat.insertEscuela(escuela.titulo, null);
  const escuelaNode = { nombre: escuela.titulo, localidad: null, materias: [] };

  for (const materiaDir of subdirs(path.join(SRC, escuelaDir))) {
    const materia = parseOrder(materiaDir);
    const materiaId = cat.insertMateria(escuelaId, materia.titulo, null);
    const materiaNode = { nombre: materia.titulo, grado: null, lecciones: [] };

    for (const leccionDir of subdirs(path.join(SRC, escuelaDir, materiaDir))) {
      const leccion = parseOrder(leccionDir);
      const leccionId = cat.insertLeccion(materiaId, leccion.titulo, null, leccion.orden);
      const leccionNode = { titulo: leccion.titulo, descripcion: null, orden: leccion.orden, archivos: [] };
      const leccionPath = path.join(SRC, escuelaDir, materiaDir, leccionDir);

      for (const fileName of filesIn(leccionPath)) {
        const filePath = path.join(leccionPath, fileName);
        const info = await computeChunkHashes(filePath, CHUNK_SIZE); // {size, chunkSize, chunkHashes, chunksRoot}
        const contentHash = await hashFile(filePath);
        const record = { contentHash, chunksRoot: info.chunksRoot, size: info.size, chunkSize: info.chunkSize };
        const { keyId, signature } = signDetached(stableStringify(record), signingKeyId);

        cat.upsertArchivo({
          leccionId, nombre: fileName, mime: mimeOf(fileName), tamano: info.size,
          contentHash, chunkSize: info.chunkSize, chunksRoot: info.chunksRoot,
          firma: signature, firmaKeyId: keyId, estado: 'disponible',
        });

        // Caché content-addressed (no recopia si ya está) + sidecar de bloques.
        const dest = path.join(CACHE_DIR, contentHash);
        if (!fs.existsSync(dest)) fs.copyFileSync(filePath, dest);
        fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(info));

        leccionNode.archivos.push({
          nombre: fileName, mime: mimeOf(fileName), tamano: info.size,
          contentHash, chunkSize: info.chunkSize, chunksRoot: info.chunksRoot,
          firma: signature, firmaKeyId: keyId,
        });
        nFiles++; nBytes += info.size;
        console.log(`  + ${escuela.titulo} / ${materia.titulo} / ${leccion.titulo} / ${fileName}  (${(info.size / 1048576).toFixed(2)} MB)`);
      }
      materiaNode.lecciones.push(leccionNode);
    }
    escuelaNode.materias.push(materiaNode);
  }
  tree.push(escuelaNode);
}
cat.close();

// Regenerar el manifiesto firmado para distribuir.
const manifest = buildManifest(tree, signingKeyId);
fs.writeFileSync(path.join(ROOT, 'manifest.json'), JSON.stringify(manifest, null, 2));

console.log(`\n✅ ${nFiles} archivo(s) · ${(nBytes / 1048576).toFixed(1)} MB importados y firmados.`);
console.log('   Manifiesto regenerado: manifest.json');
console.log(`   Arranca el nodo central:  node src/node-app.js --home=${path.basename(path.dirname(DB_PATH))} --name=Central`);
