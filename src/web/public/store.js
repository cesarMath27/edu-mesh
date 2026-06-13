// =============================================================================
//  ALMACÉN LOCAL DEL NAVEGADOR (IndexedDB)
// -----------------------------------------------------------------------------
//  Cada celular guarda los bloques que descarga para (a) abrir el archivo offline
//  y (b) RE-COMPARTIRLOS con sus compañeros. Guardamos bloque por bloque para
//  poder compartir fragmentos parciales (no hace falta tener el archivo completo).
// =============================================================================

const DB_NAME = 'edu-mesh';
const STORE = 'chunks';
let _db = null;

function open() {
  return new Promise((resolve, reject) => {
    if (_db) return resolve(_db);
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

const key = (hash, i) => `${hash}:${i}`;

export async function putChunk(hash, i, arrayBuffer) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(arrayBuffer, key(hash, i));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getChunk(hash, i) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).get(key(hash, i));
    rq.onsuccess = () => resolve(rq.result || null);
    rq.onerror = () => reject(rq.error);
  });
}

/** Conjunto de índices de bloque que este navegador ya tiene de un archivo. */
export async function getIndices(hash) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const rq = tx.objectStore(STORE).getAllKeys();
    rq.onsuccess = () => {
      const set = new Set();
      for (const k of rq.result) {
        const s = String(k);
        const sep = s.lastIndexOf(':');
        if (s.slice(0, sep) === hash) set.add(Number(s.slice(sep + 1)));
      }
      resolve(set);
    };
    rq.onerror = () => reject(rq.error);
  });
}
