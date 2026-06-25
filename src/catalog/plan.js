// =============================================================================
//  PLAN DE ESTUDIOS  —  importar/exportar una CONFIGURACIÓN de curso externa
// -----------------------------------------------------------------------------
//  Un "plan" (o plantilla de curso) es la ESTRUCTURA de un programa —escuelas,
//  materias, lecciones, su orden y descripción— SIN los archivos pesados ni sus
//  firmas. Sirve para que una escuela o un sistema comparta su MODELO de curso y
//  cualquier maestro lo importe a su propio edu-mesh y lo adapte: el plan crea el
//  "esqueleto" de lecciones y el maestro solo publica su material en cada una.
//
//  A diferencia del MANIFIESTO (catálogo firmado con contenido real), el plan:
//    - NO lleva contenido ni firmas: es texto editable, fácil de compartir.
//    - Se importa MEZCLANDO (no borra lo que el maestro ya tenga): añade lo nuevo
//      y completa la descripción/orden de las lecciones que coincidan por nombre.
//    - Puede incluir RECURSOS sugeridos por lección (solo nombre y tipo) como una
//      lista de "qué material conviene subir aquí" — pistas, no archivos.
//
//  Formato (JSON portátil):
//    {
//      "tipo": "edu-mesh/plan", "version": 1,
//      "nombre": "Programa SEP 5º grado", "fuente": "Secretaría X",
//      "descripcion": "…", "generadoEn": "ISO-8601",
//      "escuelas": [ { nombre, localidad, materias:[ { nombre, grado,
//        lecciones:[ { titulo, descripcion, orden, recursos:[{nombre,mime}] } ] } ] } ],
//      "cuestionarios": [ { title, questions:[…] } ]   // opcional
//    }
//
//  También acepta un MANIFIESTO firmado como entrada (toma su payload.escuelas y
//  descarta firmas), para reutilizar un catálogo existente como plantilla.
// =============================================================================

export const PLAN_TYPE = 'edu-mesh/plan';
export const PLAN_VERSION = 1;

// Topes defensivos: un plan importado es texto externo, así que lo acotamos.
const LIMITS = {
  escuelas: 100, materias: 400, lecciones: 4000, recursos: 50,
  nombre: 120, fuente: 160, planDescripcion: 600,
  escuela: 160, localidad: 160, materia: 160, grado: 60,
  titulo: 200, descripcion: 2000, recurso: 200, mime: 120,
};

/** Limpia caracteres de control y recorta a `n` (devuelve '' si viene vacío). */
function clip(s, n) {
  return String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, n).trim();
}

/** Saca el árbol de escuelas de un plan, un manifiesto firmado o un objeto suelto. */
function extractEscuelas(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj.escuelas)) return obj.escuelas;          // plan nativo
  if (obj.payload && Array.isArray(obj.payload.escuelas)) return obj.payload.escuelas; // manifiesto
  return null;
}

/**
 * Valida y SANEA un plan recibido (de archivo o de la red). No confía en nada:
 * recorta textos, acota cantidades y descarta campos desconocidos.
 * @returns {{plan:object}|{error:string}}
 */
export function validatePlan(raw) {
  let obj = raw;
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw); } catch { return { error: 'El archivo no es un JSON válido.' }; }
  }
  const escuelasRaw = extractEscuelas(obj);
  if (!escuelasRaw) return { error: 'No reconozco este archivo como un plan de estudios (falta la lista "escuelas").' };

  let nEsc = 0; let nMat = 0; let nLec = 0;
  const escuelas = [];
  for (const e of escuelasRaw) {
    if (nEsc >= LIMITS.escuelas) break;
    const nombreE = clip(e?.nombre, LIMITS.escuela);
    if (!nombreE) continue;
    nEsc++;
    const materias = [];
    for (const m of (Array.isArray(e?.materias) ? e.materias : [])) {
      if (nMat >= LIMITS.materias) break;
      const nombreM = clip(m?.nombre, LIMITS.materia);
      if (!nombreM) continue;
      nMat++;
      const lecciones = [];
      for (const l of (Array.isArray(m?.lecciones) ? m.lecciones : [])) {
        if (nLec >= LIMITS.lecciones) break;
        const titulo = clip(l?.titulo ?? l?.nombre, LIMITS.titulo);
        if (!titulo) continue;
        nLec++;
        const recursos = [];
        for (const r of (Array.isArray(l?.recursos ?? l?.archivos) ? (l.recursos ?? l.archivos) : [])) {
          if (recursos.length >= LIMITS.recursos) break;
          const nombreR = clip(r?.nombre, LIMITS.recurso);
          if (!nombreR) continue;
          recursos.push({ nombre: nombreR, mime: clip(r?.mime, LIMITS.mime) || null });
        }
        lecciones.push({
          titulo,
          descripcion: clip(l?.descripcion, LIMITS.descripcion) || null,
          orden: Number.isFinite(Number(l?.orden)) ? (Number(l.orden) | 0) : lecciones.length,
          recursos,
        });
      }
      materias.push({ nombre: nombreM, grado: clip(m?.grado, LIMITS.grado) || null, lecciones });
    }
    escuelas.push({ nombre: nombreE, localidad: clip(e?.localidad, LIMITS.localidad) || null, materias });
  }

  if (!escuelas.length) return { error: 'El plan no contiene escuelas/materias utilizables.' };

  const plan = {
    tipo: PLAN_TYPE,
    version: PLAN_VERSION,
    nombre: clip(obj.nombre ?? obj.payload?.nombre, LIMITS.nombre) || 'Plan de estudios',
    fuente: clip(obj.fuente ?? obj.payload?.authority, LIMITS.fuente) || null,
    descripcion: clip(obj.descripcion, LIMITS.planDescripcion) || null,
    generadoEn: clip(obj.generadoEn ?? obj.payload?.generatedAt, 40) || new Date().toISOString(),
    escuelas,
  };
  return { plan, totales: { escuelas: nEsc, materias: nMat, lecciones: nLec } };
}

/**
 * Construye un plan (plantilla) a partir del árbol del catálogo (cat.exportTree()).
 * Quita hashes, firmas y tamaños: deja solo la ESTRUCTURA + los nombres de los
 * archivos como "recursos sugeridos". Sirve para que una escuela exporte su modelo.
 * @param {Array}  tree   Árbol de cat.exportTree().
 * @param {object} [meta] { nombre, fuente, descripcion }
 */
export function buildPlan(tree, meta = {}) {
  const escuelas = (tree ?? []).map((e) => ({
    nombre: e.nombre,
    localidad: e.localidad ?? null,
    materias: (e.materias ?? []).map((m) => ({
      nombre: m.nombre,
      grado: m.grado ?? null,
      lecciones: (m.lecciones ?? []).map((l) => ({
        titulo: l.titulo,
        descripcion: l.descripcion ?? null,
        orden: l.orden ?? 0,
        recursos: (l.archivos ?? []).map((a) => ({ nombre: a.nombre, mime: a.mime ?? null })),
      })),
    })),
  }));
  return {
    tipo: PLAN_TYPE,
    version: PLAN_VERSION,
    nombre: clip(meta.nombre, LIMITS.nombre) || 'Plan de estudios',
    fuente: clip(meta.fuente, LIMITS.fuente) || null,
    descripcion: clip(meta.descripcion, LIMITS.planDescripcion) || null,
    generadoEn: new Date().toISOString(),
    escuelas,
  };
}

/**
 * Importa (MEZCLANDO) la estructura de un plan YA VALIDADO en el catálogo local.
 * Usa "buscar-o-crear", así que NO borra el material del maestro: añade lo nuevo y
 * completa descripción/orden/grado donde el nombre coincide. Los recursos sugeridos
 * NO se insertan como archivos (no tienen firma); se conservan en el plan guardado.
 * @param {object} plan  Plan validado (de validatePlan().plan).
 * @param {object} cat   DAO de openCatalog().
 * @returns {{escuelas:number, materias:number, lecciones:number, leccionesNuevas:number, recursos:number}}
 */
export function importPlan(plan, cat) {
  let escuelas = 0; let materias = 0; let lecciones = 0; let leccionesNuevas = 0; let recursos = 0;
  for (const esc of plan.escuelas) {
    const escuelaId = cat.findOrCreateEscuela(esc.nombre);
    if (esc.localidad) cat.setEscuelaLocalidad(escuelaId, esc.localidad);
    escuelas++;
    for (const mat of esc.materias ?? []) {
      const materiaId = cat.findOrCreateMateria(escuelaId, mat.nombre);
      if (mat.grado) cat.setMateriaGrado(materiaId, mat.grado);
      materias++;
      for (const lec of mat.lecciones ?? []) {
        const yaExistia = cat.getLeccionId(materiaId, lec.titulo);
        const leccionId = cat.findOrCreateLeccion(materiaId, lec.titulo, lec.orden ?? 0);
        cat.updateLeccionMeta(leccionId, lec.descripcion ?? null, lec.orden ?? 0);
        lecciones++;
        if (!yaExistia) leccionesNuevas++;
        recursos += (lec.recursos?.length ?? 0);
      }
    }
  }
  return { escuelas, materias, lecciones, leccionesNuevas, recursos };
}
