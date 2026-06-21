// =============================================================================
//  SINCRONIZAR DESDE EL HUB EN LÍNEA  (lo que hace la escuela UNA vez con internet)
// -----------------------------------------------------------------------------
//  Baja un paquete publicado (manifest + contenido), VERIFICA las firmas contra
//  el trust store, importa el catálogo y descarga cada archivo comprobando su
//  hash. Después, el nodo distribuye todo OFFLINE por el mesh.
//
//  Confianza: si aún no conoces a la autoridad del paquete, se acepta su llave
//  pública por primera vez (TOFU) imprimiendo su huella para que la verifiques
//  por un canal aparte. Si ya la conocías, se valida normal.
//
//  Uso:
//    node scripts/sync.js --from=https://tusitio/pack --home=nodes/semilla
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { importManifest } from '../src/catalog/manifest.js';
import { isTrusted, addTrustedPublic, reloadTrustStore } from '../src/crypto/keystore.js';
import { hashBuffer } from '../src/crypto/hashing.js';
import { chunkInfoFromBuffer } from '../src/crypto/chunking.js';
import { DB_PATH, CACHE_DIR } from '../src/config.js';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const base = (arg('from') || '').replace(/\/$/, '');
if (!base) { console.error('❌ Falta --from=<url-del-paquete>'); process.exit(1); }

const getJson = async (url) => { const r = await fetch(url); if (!r.ok) throw new Error(`HTTP ${r.status} en ${url}`); return r.json(); };

console.log(`🌐 Sincronizando desde ${base} …`);
const manifest = await getJson(`${base}/manifest.json`);

// --- Confianza en la autoridad (TOFU si es nueva) ---
const authKid = manifest.manifestSig?.keyId;
if (!authKid) { console.error('❌ El manifiesto no indica autoridad firmante.'); process.exit(1); }
if (!isTrusted(authKid)) {
  let ts; try { ts = await getJson(`${base}/trust-store.json`); } catch { ts = null; }
  const auth = ts?.authorities?.[authKid];
  if (!auth) { console.error('❌ No conozco a la autoridad y el paquete no publica su llave. Abortado.'); process.exit(2); }
  console.warn(`⚠ Primera vez que confío en la autoridad "${auth.label}".`);
  console.warn(`  Huella (keyId): ${authKid}  ← verifícala por un canal aparte si te importa la seguridad.`);
  addTrustedPublic({ keyId: authKid, publicKey: auth.publicKey, label: auth.label });
  reloadTrustStore();
}

// --- Verificar + importar el catálogo (firma global + por archivo) ---
const cat = openCatalog(DB_PATH);
let r;
try { r = importManifest(manifest, cat); }
catch (err) { console.error(`🛑 RECHAZADO: ${err.message}`); process.exit(2); }
console.log(`✔ Catálogo verificado e importado: ${r.escuelas} escuela(s), ${r.archivos} archivo(s).`);

// --- Descargar el contenido, verificando cada archivo por su hash ---
fs.mkdirSync(CACHE_DIR, { recursive: true });
let bajados = 0; let saltados = 0;
for (const a of cat.listArchivos()) {
  const dest = path.join(CACHE_DIR, a.content_hash);
  if (fs.existsSync(dest)) { saltados++; continue; }
  const url = `${base}/content/${a.content_hash}`;
  const res = await fetch(url);
  if (!res.ok) { console.error(`❌ No se pudo bajar "${a.nombre}" (${res.status}).`); process.exit(1); }
  const buf = Buffer.from(await res.arrayBuffer());
  if (hashBuffer(buf) !== a.content_hash) { console.error(`🛑 Hash no coincide en "${a.nombre}". Abortado.`); process.exit(2); }
  fs.writeFileSync(dest, buf);
  fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(chunkInfoFromBuffer(buf, a.chunk_size)));
  bajados++;
  console.log(`  ⬇ ${a.materia} / ${a.leccion} / ${a.nombre}  (${(a.tamano / 1048576).toFixed(2)} MB)`);
}
cat.close();

console.log(`\n✅ Sincronización completa: ${bajados} bajado(s), ${saltados} ya estaban.`);
console.log('   Ahora arranca el nodo central para repartir OFFLINE:');
console.log(`     node src/node-app.js --home=${path.basename(path.dirname(DB_PATH))} --name=Central`);
