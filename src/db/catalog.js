// =============================================================================
//  ACCESO A DATOS (DAO) DEL CATÁLOGO  — sobre node-sqlite3-wasm
// -----------------------------------------------------------------------------
//  SQLite real corriendo en WebAssembly, con acceso DIRECTO al archivo en disco.
//  Ventaja clave: NO compila binarios nativos → "clonar y correr" funciona en
//  CUALQUIER máquina y CUALQUIER versión de Node, sin prebuilds ni Visual Studio.
//
//  `openCatalog(dbPath)` abre/crea la base, aplica el esquema y devuelve el DAO.
//  Usamos los métodos convenientes db.run/get/all (preparan y liberan solos).
//  IMPORTANTE: hay que llamar cat.close() en los scripts (los procesos largos,
//  como node-app, la mantienen abierta hasta Ctrl+C).
// =============================================================================

import nodeSqlite from 'node-sqlite3-wasm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const { Database } = nodeSqlite;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/**
 * Abre el catálogo en `dbPath` y devuelve el DAO.
 * @param {string} dbPath
 */
export function openCatalog(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.exec(SCHEMA); // crea tablas/índices (foreign keys van activas por defecto)

  const dao = {
    db,

    // ---- Altas (las usa el curador / el importador de manifiesto) ----
    insertEscuela: (nombre, localidad) =>
      db.run('INSERT INTO escuelas (nombre, localidad) VALUES (?, ?)', [nombre, localidad]).lastInsertRowid,

    insertMateria: (escuelaId, nombre, grado) =>
      db.run('INSERT INTO materias (escuela_id, nombre, grado) VALUES (?, ?, ?)', [escuelaId, nombre, grado]).lastInsertRowid,

    insertLeccion: (materiaId, titulo, descripcion, orden = 0) =>
      db.run('INSERT INTO lecciones (materia_id, titulo, descripcion, orden) VALUES (?, ?, ?, ?)', [materiaId, titulo, descripcion, orden]).lastInsertRowid,

    // ---- Buscar-o-crear (las usa la publicación desde el navegador) ----
    findOrCreateEscuela: (nombre) => {
      const row = db.get('SELECT id FROM escuelas WHERE nombre = ?', [nombre]);
      return row ? row.id : db.run('INSERT INTO escuelas (nombre) VALUES (?)', [nombre]).lastInsertRowid;
    },
    findOrCreateMateria: (escuelaId, nombre) => {
      const row = db.get('SELECT id FROM materias WHERE escuela_id = ? AND nombre = ?', [escuelaId, nombre]);
      return row ? row.id : db.run('INSERT INTO materias (escuela_id, nombre) VALUES (?, ?)', [escuelaId, nombre]).lastInsertRowid;
    },
    findOrCreateLeccion: (materiaId, titulo, orden = 0) => {
      const row = db.get('SELECT id FROM lecciones WHERE materia_id = ? AND titulo = ?', [materiaId, titulo]);
      return row ? row.id : db.run('INSERT INTO lecciones (materia_id, titulo, orden) VALUES (?, ?, ?)', [materiaId, titulo, orden]).lastInsertRowid;
    },

    // ---- Metadatos al importar un PLAN de estudios (estructura sin archivos) ----
    //  Completan la descripción/orden/localidad/grado de nodos ya existentes. Solo
    //  escriben la localidad/grado si vienen vacíos (no pisan lo que el maestro puso).
    setEscuelaLocalidad: (escuelaId, localidad) =>
      db.run("UPDATE escuelas SET localidad = ? WHERE id = ? AND (localidad IS NULL OR localidad = '')", [localidad, escuelaId]),

    setMateriaGrado: (materiaId, grado) =>
      db.run("UPDATE materias SET grado = ? WHERE id = ? AND (grado IS NULL OR grado = '')", [grado, materiaId]),

    /** id de una lección por (materia, título), o null si aún no existe. */
    getLeccionId: (materiaId, titulo) => {
      const row = db.get('SELECT id FROM lecciones WHERE materia_id = ? AND titulo = ?', [materiaId, titulo]);
      return row ? row.id : null;
    },

    /** Fija descripción (si viene) y orden de una lección importada de un plan. */
    updateLeccionMeta: (leccionId, descripcion, orden = 0) =>
      db.run(
        "UPDATE lecciones SET descripcion = COALESCE(NULLIF(?, ''), descripcion), orden = ? WHERE id = ?",
        [descripcion, orden, leccionId]
      ),

    /** Inserta un archivo firmado; si el hash ya existe, solo actualiza el estado. */
    upsertArchivo: ({ leccionId, nombre, mime, tamano, contentHash, chunkSize, chunksRoot, firma, firmaKeyId, estado = 'pendiente' }) =>
      db.run(
        `INSERT INTO archivos
           (leccion_id, nombre, mime, tamano, content_hash, chunk_size, chunks_root, firma, firma_key_id, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(content_hash) DO UPDATE SET estado = excluded.estado`,
        [leccionId, nombre, mime, tamano, contentHash, chunkSize, chunksRoot, firma, firmaKeyId, estado]
      ),

    // ---- Consultas (las usan los nodos en ejecución) ----
    findArchivoByHash: (hash) =>
      db.get('SELECT * FROM archivos WHERE content_hash = ?', [hash]),

    /** Lista plana de archivos con su contexto (escuela/materia/lección). */
    listArchivos: () =>
      db.all(`
        SELECT a.*, l.titulo AS leccion, m.nombre AS materia, e.nombre AS escuela
        FROM archivos a
        JOIN lecciones l ON l.id = a.leccion_id
        JOIN materias  m ON m.id = l.materia_id
        JOIN escuelas  e ON e.id = m.escuela_id
        ORDER BY e.nombre, m.nombre, l.orden, a.nombre
      `),

    setEstado: (hash, estado) =>
      db.run('UPDATE archivos SET estado = ? WHERE content_hash = ?', [estado, hash]),

    /** Borra todo el catálogo (para re-importar un manifiesto limpio). */
    reset: () => {
      db.exec('DELETE FROM archivos; DELETE FROM lecciones; DELETE FROM materias; DELETE FROM escuelas;');
    },

    /** Exporta el catálogo como árbol anidado (lo consume build-manifest/pack). */
    exportTree: () => {
      const escuelas = db.all('SELECT * FROM escuelas ORDER BY nombre');
      return escuelas.map((e) => ({
        nombre: e.nombre,
        localidad: e.localidad,
        materias: db.all('SELECT * FROM materias WHERE escuela_id = ? ORDER BY nombre', [e.id]).map((m) => ({
          nombre: m.nombre,
          grado: m.grado,
          lecciones: db.all('SELECT * FROM lecciones WHERE materia_id = ? ORDER BY orden', [m.id]).map((l) => ({
            titulo: l.titulo,
            descripcion: l.descripcion,
            orden: l.orden,
            archivos: db.all('SELECT * FROM archivos WHERE leccion_id = ? ORDER BY nombre', [l.id]).map((a) => ({
              nombre: a.nombre,
              mime: a.mime,
              tamano: a.tamano,
              contentHash: a.content_hash,
              chunkSize: a.chunk_size,
              chunksRoot: a.chunks_root,
              firma: a.firma,
              firmaKeyId: a.firma_key_id,
            })),
          })),
        })),
      }));
    },

    close: () => db.close(),
  };

  return dao;
}
