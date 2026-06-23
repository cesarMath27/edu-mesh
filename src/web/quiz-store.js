// =============================================================================
//  ALMACÉN DE CUESTIONARIOS  — guardar / cargar partidas del maestro
// -----------------------------------------------------------------------------
//  Persiste los cuestionarios en disco, en la carpeta del nodo (HOME/quizzes),
//  un archivo JSON por cuestionario. Así el maestro no tiene que volver a
//  escribirlos: los guarda una vez y los carga cuando quiera.
//
//  Los datos del juego en vivo siguen siendo efímeros; esto solo guarda las
//  PREGUNTAS (la plantilla del cuestionario).
// =============================================================================

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const SAFE_ID = /^[a-z0-9_-]{1,64}$/;

/** Convierte un título en un id legible y seguro para nombre de archivo. */
function slug(s) {
  return String(s || '')
    .toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'quiz';
}

export function createQuizStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const fileFor = (id) => path.join(dir, `${id}.json`);

  /** Lista de cuestionarios guardados (resumen), más recientes primero. */
  function list() {
    let files = [];
    try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { /* sin carpeta */ }
    const out = [];
    for (const f of files) {
      try {
        const q = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        out.push({ id: q.id, title: q.title, count: Array.isArray(q.questions) ? q.questions.length : 0, savedAt: q.savedAt });
      } catch { /* archivo corrupto: lo ignoramos */ }
    }
    return out.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  }

  /** Carga un cuestionario completo por id (o null si no existe). */
  function load(id) {
    if (!SAFE_ID.test(String(id || ''))) return null;
    try { return JSON.parse(fs.readFileSync(fileFor(id), 'utf8')); } catch { return null; }
  }

  /** Guarda (o sobrescribe) un cuestionario ya validado. Devuelve su resumen. */
  function save({ id, title, questions }) {
    if (!id || !SAFE_ID.test(id)) id = `${slug(title)}-${randomBytes(3).toString('hex')}`;
    const rec = { id, title, questions, savedAt: new Date().toISOString() };
    fs.writeFileSync(fileFor(id), JSON.stringify(rec, null, 2));
    return { id, title, count: questions.length, savedAt: rec.savedAt };
  }

  /** Borra un cuestionario guardado. */
  function remove(id) {
    if (!SAFE_ID.test(String(id || ''))) return false;
    try { fs.rmSync(fileFor(id), { force: true }); return true; } catch { return false; }
  }

  return { list, load, save, remove };
}
