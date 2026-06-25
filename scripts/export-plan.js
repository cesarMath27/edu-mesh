// =============================================================================
//  EXPORTAR EL CATÁLOGO COMO PLAN DE ESTUDIOS  (plantilla de curso portable)
// -----------------------------------------------------------------------------
//  Toma la ESTRUCTURA del catálogo de un home (escuelas → materias → lecciones,
//  con los nombres de archivo como "recursos sugeridos") y la guarda como un plan
//  JSON, SIN contenido ni firmas. Una escuela o sistema puede compartir ese plan
//  para que cualquier maestro lo importe a su edu-mesh y lo adapte.
//
//  Uso:
//    node scripts/export-plan.js --home=nodes/semilla [--out=plan.json] \
//      [--nombre="Programa SEP 5º"] [--fuente="Secretaría X"]
//    (alias: npm run plan:export)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { buildPlan } from '../src/catalog/plan.js';
import { DB_PATH, ROOT, NODE_NAME } from '../src/config.js';

const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const out = path.resolve(ROOT, val('out') || 'plan.json');
const nombre = val('nombre') || `Plan de ${NODE_NAME}`;
const fuente = val('fuente') || NODE_NAME;

const cat = openCatalog(DB_PATH);
try {
  const tree = cat.exportTree();
  const plan = buildPlan(tree, { nombre, fuente });
  fs.writeFileSync(out, JSON.stringify(plan, null, 2));

  let materias = 0; let lecciones = 0;
  for (const e of plan.escuelas) for (const m of e.materias) { materias++; lecciones += m.lecciones.length; }
  console.log(`✅ Plan exportado: ${out}`);
  console.log(`   ${plan.escuelas.length} escuela(s), ${materias} materia(s), ${lecciones} lección(es).`);
  console.log('   Compártelo para que otro maestro lo importe (npm run plan:import).');
} catch (err) {
  console.error(`🛑 No se pudo exportar: ${err.message}`);
  process.exitCode = 2;
} finally {
  cat.close();
}
