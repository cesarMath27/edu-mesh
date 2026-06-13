// =============================================================================
//  ACCESO A DATOS (DAO) DEL CATÁLOGO  — sobre better-sqlite3 (síncrono)
// -----------------------------------------------------------------------------
//  `openCatalog(dbPath)` abre/crea una base de datos en la ruta indicada,
//  aplica el esquema y devuelve un objeto con consultas listas para usar.
//  Recibe la ruta como parámetro para poder manejar VARIOS nodos (homes) a la vez
//  (lo aprovechan los scripts de preparación e importación de manifiesto).
// =============================================================================

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');

/**
 * Abre el catálogo en `dbPath` y devuelve el DAO.
 * @param {string} dbPath
 */
export function openCatalog(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const dao = {
    db,

    // ---- Altas (las usa el curador / el importador de manifiesto) ----
    insertEscuela: (nombre, localidad) =>
      db.prepare('INSERT INTO escuelas (nombre, localidad) VALUES (?, ?)')
        .run(nombre, localidad).lastInsertRowid,

    insertMateria: (escuelaId, nombre, grado) =>
      db.prepare('INSERT INTO materias (escuela_id, nombre, grado) VALUES (?, ?, ?)')
        .run(escuelaId, nombre, grado).lastInsertRowid,

    insertLeccion: (materiaId, titulo, descripcion, orden = 0) =>
      db.prepare('INSERT INTO lecciones (materia_id, titulo, descripcion, orden) VALUES (?, ?, ?, ?)')
        .run(materiaId, titulo, descripcion, orden).lastInsertRowid,

    /** Inserta un archivo firmado; si el hash ya existe, solo actualiza el estado. */
    upsertArchivo: ({
      leccionId, nombre, mime, tamano,
      contentHash, chunkSize, chunksRoot, firma, firmaKeyId,
      estado = 'pendiente',
    }) =>
      db.prepare(`
        INSERT INTO archivos
          (leccion_id, nombre, mime, tamano, content_hash, chunk_size, chunks_root, firma, firma_key_id, estado)
        VALUES
          (@leccionId, @nombre, @mime, @tamano, @contentHash, @chunkSize, @chunksRoot, @firma, @firmaKeyId, @estado)
        ON CONFLICT(content_hash) DO UPDATE SET estado = excluded.estado
      `).run({ leccionId, nombre, mime, tamano, contentHash, chunkSize, chunksRoot, firma, firmaKeyId, estado }),

    // ---- Consultas (las usan los nodos en ejecución) ----
    findArchivoByHash: (hash) =>
      db.prepare('SELECT * FROM archivos WHERE content_hash = ?').get(hash),

    /** Lista plana de archivos con su contexto (escuela/materia/lección). */
    listArchivos: () =>
      db.prepare(`
        SELECT a.*, l.titulo AS leccion, m.nombre AS materia, e.nombre AS escuela
        FROM archivos a
        JOIN lecciones l ON l.id = a.leccion_id
        JOIN materias  m ON m.id = l.materia_id
        JOIN escuelas  e ON e.id = m.escuela_id
        ORDER BY e.nombre, m.nombre, l.orden, a.nombre
      `).all(),

    setEstado: (hash, estado) =>
      db.prepare('UPDATE archivos SET estado = ? WHERE content_hash = ?').run(estado, hash),

    /** Borra todo el catálogo (para re-importar un manifiesto limpio). */
    reset: () => {
      db.exec('DELETE FROM archivos; DELETE FROM lecciones; DELETE FROM materias; DELETE FROM escuelas;');
    },

    /**
     * Exporta el catálogo como árbol anidado (escuelas->materias->lecciones->archivos)
     * con los nombres de campo que usa el manifiesto. Lo consume build-manifest.
     */
    exportTree: () => {
      const escuelas = db.prepare('SELECT * FROM escuelas ORDER BY nombre').all();
      return escuelas.map((e) => ({
        nombre: e.nombre,
        localidad: e.localidad,
        materias: db.prepare('SELECT * FROM materias WHERE escuela_id = ? ORDER BY nombre').all(e.id).map((m) => ({
          nombre: m.nombre,
          grado: m.grado,
          lecciones: db.prepare('SELECT * FROM lecciones WHERE materia_id = ? ORDER BY orden').all(m.id).map((l) => ({
            titulo: l.titulo,
            descripcion: l.descripcion,
            orden: l.orden,
            archivos: db.prepare('SELECT * FROM archivos WHERE leccion_id = ? ORDER BY nombre').all(l.id).map((a) => ({
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
