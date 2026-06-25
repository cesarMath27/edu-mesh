// =============================================================================
//  IMPORTAR UN PLAN DE ESTUDIOS  (configuración externa de curso)
// -----------------------------------------------------------------------------
//  Mezcla la estructura de un plan (escuelas → materias → lecciones) en el
//  catálogo de un home SIN borrar lo que ya tenga: añade lo nuevo y completa la
//  descripción/orden de las lecciones que coincidan por nombre. El plan también
//  se guarda en HOME/plans para que el panel del maestro muestre qué falta llenar.
//
//  No requiere firmas: un plan es solo la ESTRUCTURA del curso (sin archivos).
//  Para que la estructura se propague a otros nodos por sincronización, vuelve a
//  firmar el catálogo después con:  npm run manifest
//
//  Uso:
//    node scripts/import-plan.js --home=nodes/semilla [--plan=plan.json]
//    (alias: npm run plan:import)
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';

import { openCatalog } from '../src/db/catalog.js';
import { validatePlan, importPlan } from '../src/catalog/plan.js';
import { createPlanStore } from '../src/catalog/plan-store.js';
import { DB_PATH, ROOT, HOME } from '../src/config.js';

const val = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const planPath = path.resolve(ROOT, val('plan') || 'plan.json');
if (!fs.existsSync(planPath)) {
  console.error(`❌ No existe el plan: ${planPath}. Genera uno con: npm run plan:export`);
  process.exit(1);
}

let raw;
try { raw = JSON.parse(fs.readFileSync(planPath, 'utf8')); }
catch { console.error('🛑 El archivo no es un JSON válido.'); process.exit(2); }

const v = validatePlan(raw);
if (v.error) { console.error(`🛑 RECHAZADO: ${v.error}`); process.exit(2); }

const cat = openCatalog(DB_PATH);
try {
  const r = importPlan(v.plan, cat);
  createPlanStore(path.join(HOME, 'plans')).save(v.plan);
  console.log(`✅ Plan "${v.plan.nombre}" importado (mezclado, sin borrar nada).`);
  console.log(`   home: ${path.dirname(DB_PATH)}`);
  console.log(`   ${r.materias} materia(s), ${r.lecciones} lección(es) (${r.leccionesNuevas} nueva(s)).`);
  console.log('   Sube tu material en cada lección (Modo Maestro o npm run content).');
  console.log('   Para propagarlo a otros nodos: npm run manifest');
} catch (err) {
  console.error(`🛑 No se pudo importar: ${err.message}`);
  process.exitCode = 2;
} finally {
  cat.close();
}
