// =============================================================================
//  PREPARACIÓN DEL DEMO  (simula varios alumnos en el mismo salón)
// -----------------------------------------------------------------------------
//  Deja todo listo para probar en una sola computadora:
//    1) Crea (si falta) una autoridad curadora en el trust store.
//    2) Genera un PDF educativo de muestra de ~1.5 MB (varios bloques) y FIRMA
//       su registro (contentHash + chunksRoot) con la autoridad.
//    3) Construye y FIRMA el MANIFIESTO del catálogo completo (manifest.json).
//    4) Crea 3 "dispositivos" importando+verificando ese manifiesto:
//         - nodes/semilla  (Ana)  -> tiene el PDF en caché  (semilla)
//         - nodes/semilla2 (Beto) -> tiene el PDF en caché  (2ª semilla)
//         - nodes/alumno   (Luis) -> solo el catálogo, sin el PDF (descargará)
//
//  Así se demuestran: manifiesto firmado (Feature 1) + descarga por bloques en
//  paralelo desde 2 semillas con reanudación (Feature 2).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { openCatalog } from '../src/db/catalog.js';
import { hashBuffer } from '../src/crypto/hashing.js';
import { chunkInfoFromBuffer } from '../src/crypto/chunking.js';
import { buildManifest, importManifest } from '../src/catalog/manifest.js';
import { pickSigningKeyId, addAuthority, signDetached } from '../src/crypto/keystore.js';
import { stableStringify } from '../src/util/stable-json.js';
import { CHUNK_SIZE } from '../src/config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- 1) Autoridad curadora ----
let signingKeyId = pickSigningKeyId();
if (!signingKeyId) {
  const a = addAuthority('SEP Oaxaca (demo)');
  signingKeyId = a.keyId;
  console.log(`🔑 Autoridad curadora creada (keyId ${a.keyId}).`);
} else {
  console.log(`🔑 Reutilizando autoridad existente (keyId ${signingKeyId}).`);
}

// ---- 2) PDF educativo de muestra (~1.5 MB => varios bloques) ----
/** PDF de 1 página + relleno como comentario (lo ignoran los lectores). */
function makeSamplePdf(title, padBytes) {
  let pdf = '%PDF-1.4\n';
  if (padBytes > 0) pdf += '%' + 'A'.repeat(padBytes) + '\n'; // comentario de relleno
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 595 842]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>',
    null,
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const text = `BT /F1 22 Tf 72 740 Td (${title}) Tj ET`;
  objects[3] = `<</Length ${text.length}>>\nstream\n${text}\nendstream`;

  const offsets = [];
  objects.forEach((obj, i) => { offsets.push(pdf.length); pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`; });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'latin1');
}

const pdf = makeSamplePdf('Leccion 1: La Fotosintesis', 1_500_000);
const contentHash = hashBuffer(pdf);
const info = chunkInfoFromBuffer(pdf, CHUNK_SIZE); // { size, chunkSize, chunkHashes, chunksRoot }

// Firma del registro por archivo (autenticidad autónoma durante la transferencia).
const record = { contentHash, chunksRoot: info.chunksRoot, size: info.size, chunkSize: info.chunkSize };
const firma = signDetached(stableStringify(record), signingKeyId);

console.log(`📄 PDF de muestra: ${info.size} bytes en ${info.chunkHashes.length} bloques de ${CHUNK_SIZE} B`);
console.log(`   content_hash: ${contentHash}`);
console.log(`   chunks_root : ${info.chunksRoot}`);

// ---- 3) Árbol del catálogo + MANIFIESTO firmado ----
const tree = [{
  nombre: 'Escuela Primaria Benito Juárez', localidad: 'Oaxaca',
  materias: [{
    nombre: 'Ciencias Naturales', grado: '5º',
    lecciones: [{
      titulo: 'La Fotosíntesis', descripcion: 'Cómo las plantas producen su alimento.', orden: 1,
      archivos: [{
        nombre: 'leccion-fotosintesis.pdf', mime: 'application/pdf', tamano: info.size,
        contentHash, chunkSize: info.chunkSize, chunksRoot: info.chunksRoot,
        firma: firma.signature, firmaKeyId: firma.keyId,
      }],
    }],
  }],
}];

const manifest = buildManifest(tree, signingKeyId);
const manifestPath = path.join(ROOT, 'manifest.json');
fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
console.log(`📜 Manifiesto firmado escrito en ${path.relative(ROOT, manifestPath)} (firmado por ${signingKeyId}).`);

// ---- 4) Construir los 3 dispositivos importando+verificando el manifiesto ----
function cleanHome(home) {
  try {
    fs.rmSync(home, { recursive: true, force: true });
  } catch (err) {
    if (err.code === 'EBUSY' || err.code === 'EPERM') {
      console.error(`\n❌ No se pudo limpiar ${path.relative(ROOT, home)}: hay archivos en uso.`);
      console.error('   Detén los nodos en ejecución (Ctrl+C en sus terminales) y reintenta "npm run setup".');
      process.exit(1);
    }
    throw err;
  }
  fs.mkdirSync(path.join(home, 'cache'), { recursive: true });
}

function buildHome(dir, { withFile }) {
  const home = path.join(ROOT, 'nodes', dir);
  cleanHome(home);
  const cat = openCatalog(path.join(home, 'catalog.db'));
  const r = importManifest(manifest, cat); // ← VERIFICA firma global + por archivo
  cat.close();
  if (withFile) {
    const dest = path.join(home, 'cache', contentHash);
    fs.writeFileSync(dest, pdf);
    fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(info)); // sidecar listo
  }
  console.log(`🏠 nodes/${dir}: catálogo verificado (${r.archivos} archivo), PDF en caché: ${withFile ? 'SÍ' : 'no'}`);
}

buildHome('semilla', { withFile: true });
buildHome('semilla2', { withFile: true });
buildHome('alumno', { withFile: false });

console.log('\n✅ Demo lista. Abre TRES terminales en la carpeta del proyecto:\n');
console.log('   Terminal 1 (semilla / Ana):');
console.log('     node src/node-seed.js --home=nodes/semilla --name=Ana\n');
console.log('   Terminal 2 (semilla / Beto):');
console.log('     node src/node-seed.js --home=nodes/semilla2 --name=Beto\n');
console.log('   Terminal 3 (alumno / Luis — descarga por bloques desde Ana y Beto):');
console.log('     node src/node-student.js --home=nodes/alumno --name=Luis\n');
console.log('   NOTA: usa "node <script> --flag", NO "npm run <script> -- --flag"');
console.log('   (npm en Windows/PowerShell no reenvía los argumentos tras "--").');
console.log('   (Con una sola semilla también funciona; con dos verás el reparto de bloques.)');
