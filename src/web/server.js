// =============================================================================
//  SERVIDOR WEB LOCAL  (capa de UI) — http nativo, sin dependencias
// -----------------------------------------------------------------------------
//  Sirve una app de catálogo navegable 100% offline (archivos estáticos locales,
//  sin CDNs) + una pequeña API JSON + un canal SSE para el progreso de descarga.
//
//  Endpoints:
//    GET /                      -> index.html (la app)
//    GET /styles.css, /app.js   -> estáticos
//    GET /api/node              -> { name, authorities[] }
//    GET /api/catalog           -> árbol escuelas→materias→lecciones→archivos + estado
//    GET /api/download?hash=…    -> (SSE) dispara descarga robusta y emite progreso
//    GET /api/file?hash=…        -> sirve el PDF cacheado (inline, para abrir/ver)
// =============================================================================

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { robustDownload } from '../p2p/download-manager.js';
import { listAuthorities } from '../crypto/keystore.js';
import { WEB_PORT } from '../config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

/** Mapa keyId -> { label, revoked } para mostrar la autoridad firmante. */
function authoritiesIndex() {
  const idx = {};
  for (const a of listAuthorities()) idx[a.keyId] = { label: a.label, revoked: a.revoked };
  return idx;
}

/** Construye el árbol del catálogo con estado por archivo (para la UI). */
function buildCatalogTree(cat, cacheDir) {
  const auth = authoritiesIndex();
  const escuelas = new Map();
  for (const a of cat.listArchivos()) {
    if (!escuelas.has(a.escuela)) escuelas.set(a.escuela, new Map());
    const materias = escuelas.get(a.escuela);
    if (!materias.has(a.materia)) materias.set(a.materia, new Map());
    const lecciones = materias.get(a.materia);
    if (!lecciones.has(a.leccion)) lecciones.set(a.leccion, []);
    const firmante = auth[a.firma_key_id];
    lecciones.get(a.leccion).push({
      nombre: a.nombre,
      mime: a.mime,
      tamano: a.tamano,
      hash: a.content_hash,
      bloques: Math.max(1, Math.ceil(a.tamano / a.chunk_size)),
      estado: a.estado,
      cached: fs.existsSync(path.join(cacheDir, a.content_hash)),
      autoridad: firmante ? firmante.label : 'desconocida',
      autoridadRevocada: firmante ? firmante.revoked : true,
    });
  }
  // Map -> arrays anidados
  return [...escuelas].map(([escuela, materias]) => ({
    escuela,
    materias: [...materias].map(([materia, lecciones]) => ({
      materia,
      lecciones: [...lecciones].map(([leccion, archivos]) => ({ leccion, archivos })),
    })),
  }));
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(body);
}

function serveStatic(res, urlPath) {
  const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const full = path.join(PUBLIC_DIR, file);
  // Evita el "path traversal": el archivo debe quedar dentro de PUBLIC_DIR.
  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || !fs.statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    return res.end('No encontrado');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
  fs.createReadStream(full).pipe(res);
}

/**
 * Arranca el servidor web.
 * @param {object} p
 * @param {object} p.cat        DAO de openCatalog().
 * @param {string} p.cacheDir
 * @param {string} p.nodeName
 * @param {Function} [p.log]
 */
export function startWebServer({ cat, cacheDir, nodeName, getChunkInfo, resolveHashToFile, log }) {
  const activeDownloads = new Set(); // evita descargas duplicadas del mismo hash

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const route = url.pathname;

    // ---- API: info del nodo ----
    if (route === '/api/node') {
      return sendJson(res, 200, { name: nodeName, authorities: listAuthorities() });
    }

    // ---- API: catálogo ----
    if (route === '/api/catalog') {
      return sendJson(res, 200, { tree: buildCatalogTree(cat, cacheDir) });
    }

    // ---- API: descarga con progreso en vivo (SSE) ----
    if (route === '/api/download') {
      const hash = url.searchParams.get('hash');
      const target = hash && cat.findArchivoByHash(hash);
      if (!target) return sendJson(res, 404, { error: 'archivo no encontrado en el catálogo' });

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const send = (evt) => res.write(`data: ${JSON.stringify(evt)}\n\n`);

      if (fs.existsSync(path.join(cacheDir, hash))) {
        send({ type: 'done', already: true });
        return res.end();
      }
      if (activeDownloads.has(hash)) {
        send({ type: 'error', message: 'Ya hay una descarga en curso para este archivo.' });
        return res.end();
      }
      activeDownloads.add(hash);

      robustDownload({
        target,
        cacheDir,
        log,
        onProgress: (evt) => send(evt),
      })
        .then((r) => {
          cat.setEstado(hash, 'disponible');
          send({ type: 'done', ...r });
        })
        .catch((err) => {
          if (/Integridad|Firma|raíz/i.test(err.message)) cat.setEstado(hash, 'corrupto');
          send({ type: 'error', message: err.message });
        })
        .finally(() => {
          activeDownloads.delete(hash);
          res.end();
        });
      return;
    }

    // ---- API: servir el archivo cacheado (inline, para abrir el PDF) ----
    if (route === '/api/file') {
      const hash = url.searchParams.get('hash');
      const row = hash && cat.findArchivoByHash(hash);
      const full = row && path.join(cacheDir, hash);
      if (!row || !fs.existsSync(full)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Archivo no disponible en este dispositivo');
      }
      const safeName = (row.nombre || 'archivo').replace(/[^\w.\- ]+/g, '_');
      res.writeHead(200, {
        'Content-Type': row.mime || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${safeName}"`,
        'Content-Length': fs.statSync(full).size,
      });
      return fs.createReadStream(full).pipe(res);
    }

    // ---- API: lista de bloques (para la descarga en el navegador) ----
    if (route === '/api/chunks') {
      const hash = url.searchParams.get('hash');
      const info = hash && getChunkInfo ? await getChunkInfo(hash) : null;
      if (!info) return sendJson(res, 404, { found: false });
      return sendJson(res, 200, { found: true, size: info.size, chunkSize: info.chunkSize, chunkHashes: info.chunkHashes });
    }

    // ---- API: UN bloque por HTTP (origen / respaldo del mesh) ----
    if (route === '/api/chunk') {
      const hash = url.searchParams.get('hash');
      const i = Number(url.searchParams.get('index'));
      const file = hash && resolveHashToFile ? resolveHashToFile(hash) : null;
      const info = hash && getChunkInfo ? await getChunkInfo(hash) : null;
      if (!file || !info || !Number.isInteger(i)) { res.writeHead(404); return res.end(); }
      const start = i * info.chunkSize;
      if (start >= info.size) { res.writeHead(416); return res.end(); }
      const end = Math.min(start + info.chunkSize, info.size); // exclusivo
      res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': end - start });
      return fs.createReadStream(file, { start, end: end - 1 }).pipe(res);
    }

    // ---- Estáticos ----
    if (req.method === 'GET') return serveStatic(res, route);
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Método no permitido');
  });

  return new Promise((resolve) => {
    server.listen(WEB_PORT, () => {
      log?.(`🌐 UI disponible en http://localhost:${WEB_PORT}`);
      resolve({ server, port: WEB_PORT });
    });
  });
}
