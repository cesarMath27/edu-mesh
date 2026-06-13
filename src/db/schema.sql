-- =============================================================================
--  ESQUEMA DEL CATÁLOGO LOCAL DE LECCIONES (SQLite)
-- -----------------------------------------------------------------------------
--  Jerarquía:  escuelas -> materias -> lecciones -> archivos
--  Cada archivo guarda su huella (content_hash), la raíz de bloques (chunks_root)
--  y la firma de autorización (firma + firma_key_id) emitida por una autoridad.
-- =============================================================================

PRAGMA journal_mode = WAL;     -- mejor concurrencia lectura/escritura
PRAGMA foreign_keys = ON;      -- integridad referencial

CREATE TABLE IF NOT EXISTS escuelas (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  localidad  TEXT,
  creado_en  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS materias (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  escuela_id  INTEGER NOT NULL REFERENCES escuelas(id) ON DELETE CASCADE,
  nombre      TEXT NOT NULL,
  grado       TEXT,
  creado_en   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lecciones (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  materia_id   INTEGER NOT NULL REFERENCES materias(id) ON DELETE CASCADE,
  titulo       TEXT NOT NULL,
  descripcion  TEXT,
  orden        INTEGER NOT NULL DEFAULT 0,
  creado_en    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS archivos (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  leccion_id    INTEGER NOT NULL REFERENCES lecciones(id) ON DELETE CASCADE,
  nombre        TEXT    NOT NULL,                 -- nombre legible, p.ej. leccion.pdf
  mime          TEXT,                             -- application/pdf, video/mp4, ...
  tamano        INTEGER NOT NULL,                 -- tamaño en bytes
  content_hash  TEXT    NOT NULL UNIQUE,          -- SHA-256 hex = ID único del archivo
  chunk_size    INTEGER NOT NULL,                 -- tamaño de bloque usado
  chunks_root   TEXT    NOT NULL,                 -- raíz de los hashes de bloque (firmada)
  firma         TEXT    NOT NULL,                 -- firma Ed25519 (base64) del registro
  firma_key_id  TEXT    NOT NULL,                 -- keyId de la autoridad que firmó
  estado        TEXT    NOT NULL DEFAULT 'pendiente',  -- pendiente | disponible | corrupto
  creado_en     TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- El lookup P2P busca por hash constantemente -> lo indexamos.
CREATE INDEX IF NOT EXISTS idx_archivos_hash ON archivos(content_hash);
