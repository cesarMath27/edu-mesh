// =============================================================================
//  ALMACÉN DE PLANES IMPORTADOS  — guarda las plantillas de curso del maestro
// -----------------------------------------------------------------------------
//  Persiste en disco (HOME/plans, un JSON por plan) los planes de estudio que el
//  maestro importa. El catálogo ya recibe la estructura al importar; aquí se
//  conserva ADEMÁS el plan tal cual (con sus recursos sugeridos) para mostrar el
//  "esqueleto" en el panel del maestro: qué lecciones faltan por llenar de material.
//
//  Mismo espíritu que quiz-store.js: persistencia simple, un archivo por plan.
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const SAFE_ID = /^[a-z0-9_-]{1,72}$/;

/** Convierte un nombre en un id legible y seguro para nombre de archivo. */
function slug(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'plan';
}

export function createPlanStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (id) => path.join(dir, `${id}.json`);

  /** Cuenta materias/lecciones de un plan (para los resúmenes). */
  function totals(plan) {
    let materias = 0; let lecciones = 0;
    for (const e of plan.escuelas ?? []) {
      for (const m of e.materias ?? []) { materias++; lecciones += (m.lecciones?.length ?? 0); }
    }
    return { materias, lecciones };
  }

  /** Lista de planes guardados (resumen), más recientes primero. */
  function list() {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* sin carpeta */ }
    const out = [];
    for (const f of files) {
      try {
        const p = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({ id: p.id, nombre: p.nombre, fuente: p.fuente ?? null, importadoEn: p.importadoEn, ...totals(p) });
      } catch { /* archivo corrupto: lo ignoramos */ }
    }
    return out.sort((a, b) => String(b.importadoEn).localeCompare(String(a.importadoEn)));
  }

  /** Carga un plan completo por id (o null si no existe). */
  function load(id) {
    if (!SAFE_ID.test(String(id || ''))) return null;
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch { return null; }
  }

  /** El plan importado más recientemente (o null). */
  function latest() {
    const [top] = list();
    return top ? load(top.id) : null;
  }

  /** Guarda un plan YA VALIDADO. Devuelve su resumen. */
  function save(plan) {
    const id = `${slug(plan.nombre)}-${randomBytes(3).toString('hex')}`;
    const rec = { id, importadoEn: new Date().toISOString(), ...plan };
    fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2));
    return { id, nombre: rec.nombre, fuente: rec.fuente ?? null, importadoEn: rec.importadoEn, ...totals(plan) };
  }

  /** Borra un plan guardado (solo el esqueleto: el catálogo no se toca). */
  function remove(id) {
    if (!SAFE_ID.test(String(id || ''))) return false;
    try { fs.rmSync(fileFor(id), { force: true }); return true; } catch { return false; }
  }

  return { list, load, latest, save, remove };
}
