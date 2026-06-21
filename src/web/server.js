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
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { robustDownload } from '../p2p/download-manager.js';
import { attachSignaling } from './signaling.js';
import { ensureTlsCert } from './tls.js';
import { listAuthorities, pickSigningKeyId, signDetached } from '../crypto/keystore.js';
import { computeChunkHashes } from '../crypto/chunking.js';
import { hashFile } from '../crypto/hashing.js';
import { buildManifest } from '../catalog/manifest.js';
import { stableStringify } from '../util/stable-json.js';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { WEB_PORT, TEACHER_PIN, CHUNK_SIZE, ROOT, MAX_UPLOAD_MB, TLS } from '../config.js';

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
      // Datos para que el NAVEGADOR verifique la firma Ed25519 por sí mismo:
      chunksRoot: a.chunks_root,
      chunkSize: a.chunk_size,
      firma: a.firma,
      firmaKeyId: a.firma_key_id,
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
export async function startWebServer({ cat, cacheDir, nodeName, getChunkInfo, resolveHashToFile, log }) {
  const activeDownloads = new Set(); // evita descargas duplicadas del mismo hash
  let brokerState = () => [];         // lo fija attachSignaling tras escuchar

  // --- Autenticación del maestro: PIN -> token de sesión (el PIN NUNCA va en la URL) ---
  const tokens = new Map();                 // token -> expira (ms)
  const TOKEN_TTL = 8 * 60 * 60 * 1000;     // 8 horas
  const fails = new Map();                  // ip -> { count, until } (anti fuerza bruta)
  const pinDigest = createHash('sha256').update(String(TEACHER_PIN)).digest();
  const clientIp = (req) => req.socket.remoteAddress || 'desconocido';
  const lockedOut = (req) => { const r = fails.get(clientIp(req)); return !!r && r.until > Date.now(); };
  const recordFail = (req) => {
    const k = clientIp(req); const r = fails.get(k) || { count: 0, until: 0 };
    r.count++; if (r.count >= 5) { r.until = Date.now() + 60000; r.count = 0; } // 5 fallos -> 1 min
    fails.set(k, r);
  };
  const issueToken = () => { const t = randomBytes(24).toString('hex'); tokens.set(t, Date.now() + TOKEN_TTL); return t; };
  const isTeacher = (req) => {
    const h = req.headers.authorization || '';
    const t = h.startsWith('Bearer ') ? h.slice(7) : '';
    const exp = tokens.get(t);
    if (!exp) return false;
    if (Date.now() > exp) { tokens.delete(t); return false; }
    return true;
  };

  const handler = async (req, res) => {
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

    // ---- API Maestro: login (PIN -> token). Comparación en tiempo constante. ----
    if (route === '/api/login' && req.method === 'POST') {
      if (lockedOut(req)) return sendJson(res, 429, { error: 'Demasiados intentos. Espera 1 minuto.' });
      let body = '';
      req.on('data', (c) => { body += c; if (body.length > 1000) req.destroy(); });
      req.on('end', () => {
        let pin = '';
        try { pin = String(JSON.parse(body || '{}').pin || ''); } catch { /* cuerpo inválido */ }
        const ok = timingSafeEqual(createHash('sha256').update(pin).digest(), pinDigest);
        if (!ok) { recordFail(req); return sendJson(res, 401, { error: 'PIN incorrecto' }); }
        fails.delete(clientIp(req));
        sendJson(res, 200, { token: issueToken() });
      });
      return;
    }

    // ---- API Maestro: tablero de distribución (¿quién ya lo tiene?) ----
    if (route === '/api/distribution') {
      if (!isTeacher(req)) return sendJson(res, 401, { error: 'No autorizado' });
      const alumnos = brokerState();
      const catalogo = cat.listArchivos().map((a) => ({
        hash: a.content_hash,
        nombre: a.nombre,
        materia: a.materia,
        leccion: a.leccion,
        bloques: Math.max(1, Math.ceil(a.tamano / a.chunk_size)),
      }));
      return sendJson(res, 200, { alumnos, catalogo });
    }

    // ---- API Maestro: publicar un archivo (firmado) desde el navegador ----
    if (route === '/api/upload' && req.method === 'POST') {
      if (!isTeacher(req)) return sendJson(res, 401, { error: 'No autorizado' });
      const maxBytes = MAX_UPLOAD_MB * 1024 * 1024;
      if (Number(req.headers['content-length'] || 0) > maxBytes) {
        return sendJson(res, 413, { error: `archivo demasiado grande (máx ${MAX_UPLOAD_MB} MB)` });
      }
      const q = url.searchParams;
      const nombre = (q.get('nombre') || '').replace(/[\\/\x00-\x1f]/g, '_').slice(0, 150);
      const escuela = q.get('escuela') || 'Sin escuela';
      const materia = q.get('materia') || 'General';
      const leccion = q.get('leccion') || 'Sin lección';
      const orden = Number(q.get('orden') || 0);
      const mime = q.get('mime') || 'application/octet-stream';
      if (!nombre) return sendJson(res, 400, { error: 'falta el nombre del archivo' });
      const signingKeyId = pickSigningKeyId();
      if (!signingKeyId) return sendJson(res, 500, { error: 'el nodo no tiene llave para firmar' });

      // Recibimos el archivo como cuerpo crudo (sin multipart) → a un temporal,
      // abortando si supera el límite de tamaño.
      const tmp = path.join(cacheDir, `.upload-${Date.now()}`);
      const out = fs.createWriteStream(tmp);
      let received = 0; let aborted = false;
      req.on('data', (c) => {
        received += c.length;
        if (received > maxBytes && !aborted) {
          aborted = true; req.destroy(); out.destroy(); fs.rmSync(tmp, { force: true });
          sendJson(res, 413, { error: `archivo demasiado grande (máx ${MAX_UPLOAD_MB} MB)` });
        }
      });
      req.pipe(out);
      req.on('error', () => { if (!aborted) { out.destroy(); fs.rmSync(tmp, { force: true }); } });
      out.on('finish', async () => {
        if (aborted) return;
        try {
          const info = await computeChunkHashes(tmp, CHUNK_SIZE);
          const contentHash = await hashFile(tmp);
          const record = { contentHash, chunksRoot: info.chunksRoot, size: info.size, chunkSize: info.chunkSize };
          const { keyId, signature } = signDetached(stableStringify(record), signingKeyId);

          const escuelaId = cat.findOrCreateEscuela(escuela);
          const materiaId = cat.findOrCreateMateria(escuelaId, materia);
          const leccionId = cat.findOrCreateLeccion(materiaId, leccion, orden);
          cat.upsertArchivo({
            leccionId, nombre, mime, tamano: info.size,
            contentHash, chunkSize: info.chunkSize, chunksRoot: info.chunksRoot,
            firma: signature, firmaKeyId: keyId, estado: 'disponible',
          });

          const dest = path.join(cacheDir, contentHash);
          if (fs.existsSync(dest)) fs.rmSync(tmp, { force: true });
          else fs.renameSync(tmp, dest);
          fs.writeFileSync(`${dest}.chunks.json`, JSON.stringify(info));

          // Regeneramos el manifiesto firmado para que otros nodos re-sincronicen.
          fs.writeFileSync(path.join(ROOT, 'manifest.json'),
            JSON.stringify(buildManifest(cat.exportTree(), signingKeyId), null, 2));

          log?.(`📤 Maestro publicó "${nombre}" (${info.size} B) en ${materia} / ${leccion}`);
          sendJson(res, 200, { ok: true, hash: contentHash, nombre, size: info.size });
        } catch (err) {
          fs.rmSync(tmp, { force: true });
          sendJson(res, 500, { error: err.message });
        }
      });
      return;
    }

    // ---- Estáticos ----
    if (req.method === 'GET') return serveStatic(res, route);
    res.writeHead(405, { 'Content-Type': 'text/plain' });
    res.end('Método no permitido');
  };

  // HTTPS si --tls (token y datos cifrados en la LAN); si no, HTTP.
  const server = TLS
    ? https.createServer(await ensureTlsCert({ log }), handler)
    : http.createServer(handler);

  return new Promise((resolve) => {
    server.listen(WEB_PORT, () => {
      const broker = attachSignaling(server, { log }); // broker WebRTC + estado de distribución
      brokerState = broker.getState;
      log?.(`🌐 UI disponible en ${TLS ? 'https' : 'http'}://localhost:${WEB_PORT}`);
      resolve({ server, port: WEB_PORT });
    });
  });
}
