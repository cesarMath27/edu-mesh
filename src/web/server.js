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
//    GET /api/file?hash=…        -> sirve el archivo cacheado (inline, con Range)
//    GET /api/stream?hash=…      -> VISTA PREVIA por streaming (HTTP Range: solo
//                                   los bytes/bloques que el visor pide → ligero)
//    GET /api/chunks?hash=…      -> lista de hashes de bloque (descarga navegador)
//    GET /api/chunk?hash=&index= -> UN bloque (con límite de carga: 503 si saturado)
//    GET /api/sync/status        -> estado de la sincronización automática + versión
//    POST /api/sync/now          -> (maestro) fuerza una sincronización ya
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
import { createLimiter } from '../util/limiter.js';
import { lanAddresses, bestLan } from '../util/netinfo.js';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import QRCode from 'qrcode';
import {
  WEB_PORT, TEACHER_PIN, TEACHER_PIN_IS_GENERATED, CHUNK_SIZE, ROOT, MAX_UPLOAD_MB, TLS,
  SERVE_CONCURRENCY, SERVE_QUEUE, SYNC_FROM, SYNC_INTERVAL_MIN, DISCOVERY_PORT,
} from '../config.js';

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

/** Lee el cuerpo de una petición como texto, con tope de tamaño. */
function readBody(req, maxBytes = 256 * 1024) {
  return new Promise((resolve, reject) => {
    let body = ''; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > maxBytes) { reject(new Error('cuerpo demasiado grande')); req.destroy(); } else body += c; });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/** Valida y SANEA un cuestionario enviado por el maestro. Devuelve {game} o {error}. */
function validateQuiz(payload) {
  const clip = (s, n) => String(s ?? '').replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '').slice(0, n).trim();
  const title = clip(payload.title, 80) || 'Cuestionario';
  const raw = Array.isArray(payload.questions) ? payload.questions : [];
  if (raw.length < 1) return { error: 'Agrega al menos una pregunta.' };
  if (raw.length > 50) return { error: 'Máximo 50 preguntas por partida.' };
  const questions = [];
  for (const [i, q] of raw.entries()) {
    const text = clip(q.q, 300);
    if (!text) return { error: `La pregunta ${i + 1} está vacía.` };
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => clip(o, 120));
    if (options.length > 4) options.length = 4;
    if (options.length < 2) return { error: `La pregunta ${i + 1} necesita al menos 2 opciones.` };
    if (options.some((o) => !o)) return { error: `Completa todas las opciones de la pregunta ${i + 1}.` };
    const correct = Number(q.correct) | 0;
    if (correct < 0 || correct >= options.length) return { error: `Marca la respuesta correcta de la pregunta ${i + 1}.` };
    const time = Math.max(5, Math.min(120, Number(q.time) | 0 || 20));
    questions.push({ q: text, options, correct, time });
  }
  return { game: { title, questions } };
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
 * Sirve un archivo del disco SOPORTANDO HTTP Range (descarga parcial).
 * Es la pieza clave de la "vista previa por bloques": el visor del navegador
 * (PDF nativo, <video>, <audio>) pide solo los rangos que necesita ver, así que
 * NO hace falta descargar el archivo completo → reproducción/lectura ultra ligera.
 */
function serveFile(req, res, filePath, mime, name) {
  const size = fs.statSync(filePath).size;
  const safeName = (name || 'archivo').replace(/[^\w.\- ]+/g, '_');
  const headers = {
    'Content-Type': mime || 'application/octet-stream',
    'Content-Disposition': `inline; filename="${safeName}"`,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'public, max-age=86400',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    return res.end();
  }

  const range = req.headers.range;
  const m = range && /^bytes=(\d*)-(\d*)$/.exec(range.trim());
  if (m) {
    let start = m[1] === '' ? null : Number(m[1]);
    let end = m[2] === '' ? null : Number(m[2]);
    if (start === null) {                       // sufijo "bytes=-N" → últimos N bytes
      start = Math.max(0, size - (end || 0)); end = size - 1;
    } else if (end === null || end >= size) {   // "bytes=start-" o fin fuera de rango
      end = size - 1;
    }
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= size) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` });
      return res.end();
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    const s = fs.createReadStream(filePath, { start, end });
    res.on('close', () => s.destroy());
    return s.pipe(res);
  }

  res.writeHead(200, { ...headers, 'Content-Length': size });
  const s = fs.createReadStream(filePath);
  res.on('close', () => s.destroy());
  return s.pipe(res);
}

/**
 * Arranca el servidor web.
 * @param {object} p
 * @param {object} p.cat        DAO de openCatalog().
 * @param {string} p.cacheDir
 * @param {string} p.nodeName
 * @param {Function} [p.log]
 */
export async function startWebServer({
  cat, cacheDir, nodeName, getChunkInfo, resolveHashToFile, log,
  getSyncStatus, runSyncNow, getCatalogVersion, onCatalogChanged, quizStore,
}) {
  const activeDownloads = new Set(); // evita descargas duplicadas del mismo hash
  let brokerState = () => [];         // lo fija attachSignaling tras escuchar
  let quizGame = null;                // juego de cuestionario en vivo (lo fija el broker)

  // Limitador de carga: el central solo sirve N bloques a la vez (resto en cola;
  // si la cola se llena, responde 503 y los celulares se apoyan en sus compañeros).
  const chunkLimiter = createLimiter({ concurrency: SERVE_CONCURRENCY, maxQueue: SERVE_QUEUE });

  // --- Autenticación del maestro: PIN -> token de sesión (el PIN NUNCA va en la URL) ---
  const tokens = new Map();                 // token -> expira (ms)
  const TOKEN_TTL = 8 * 60 * 60 * 1000;     // 8 horas
  const fails = new Map();                  // ip -> { count, until } (anti fuerza bruta)
  const pinDigest = createHash('sha256').update(String(TEACHER_PIN)).digest();
  const clientIp = (req) => req.socket.remoteAddress || 'desconocido';
  // ¿La petición viene del MISMO equipo (loopback)? Sirve para que el panel del
  // maestro de ESTE equipo pueda auto-entrar y ver el PIN, sin exponerlo a la LAN.
  const isLoopback = (req) => {
    const a = req.socket.remoteAddress || '';
    return a === '::1' || a === '::ffff:127.0.0.1' || a.startsWith('127.');
  };
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

    // ---- API: info de red (pública) — URLs para que entren los celulares ----
    if (route === '/api/net') {
      const proto = TLS ? 'https' : 'http';
      const best = bestLan();
      return sendJson(res, 200, {
        proto, port: WEB_PORT, tls: TLS, name: nodeName,
        best: best ? `${proto}://${best.address}:${WEB_PORT}` : null,
        urls: lanAddresses().map((a) => ({ url: `${proto}://${a.address}:${WEB_PORT}`, iface: a.iface })),
      });
    }

    // ---- API: presencia (pública, solo el CONTEO) — alumnos conectados ----
    if (route === '/api/presence') {
      return sendJson(res, 200, { count: brokerState().length });
    }

    // ---- API: QR del enlace de ingreso como SVG (público) ----
    //  Por defecto apunta a la mejor IP de la LAN; ?url= permite forzar otra.
    if (route === '/api/qr.svg') {
      const proto = TLS ? 'https' : 'http';
      const best = bestLan();
      const fallback = best ? `${proto}://${best.address}:${WEB_PORT}` : `${proto}://localhost:${WEB_PORT}`;
      const target = url.searchParams.get('url') || fallback;
      try {
        const svg = await QRCode.toString(target, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
        res.writeHead(200, { 'Content-Type': 'image/svg+xml; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(svg);
      } catch {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('No se pudo generar el QR');
      }
    }

    // ---- API Maestro: bootstrap (SOLO LOCALHOST) ----
    //  Entrega el PIN y los ajustes en curso para que el PANEL del maestro de
    //  ESTE equipo auto-entre y los muestre. Nunca se expone a la LAN: otros
    //  dispositivos reciben 403 y deben teclear el PIN como siempre.
    if (route === '/api/teacher/info') {
      if (!isLoopback(req)) return sendJson(res, 403, { error: 'Solo disponible en este equipo (localhost).' });
      const proto = TLS ? 'https' : 'http';
      const best = bestLan();
      return sendJson(res, 200, {
        pin: String(TEACHER_PIN),
        pinIsGenerated: TEACHER_PIN_IS_GENERATED,
        settings: {
          name: nodeName,
          proto, port: WEB_PORT, tls: TLS,
          url: `${proto}://localhost:${WEB_PORT}`,
          lan: best ? `${proto}://${best.address}:${WEB_PORT}` : null,
          syncFrom: SYNC_FROM || null,
          syncIntervalMin: SYNC_INTERVAL_MIN,
          maxUploadMb: MAX_UPLOAD_MB,
          serveConcurrency: SERVE_CONCURRENCY,
          serveQueue: SERVE_QUEUE,
          chunkSizeKiB: Math.round(CHUNK_SIZE / 1024),
          discoveryPort: DISCOVERY_PORT,
        },
      });
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

    // ---- API: servir el archivo cacheado (inline, con Range) ----
    //  /api/file  = abrir el archivo completo (compatibilidad).
    //  /api/stream = VISTA PREVIA por streaming: el visor pide rangos y solo se
    //                cargan los bloques que se ven (sin descargar todo).
    if (route === '/api/file' || route === '/api/stream') {
      const hash = url.searchParams.get('hash');
      const row = hash && cat.findArchivoByHash(hash);
      const full = row && path.join(cacheDir, hash);
      if (!row || !fs.existsSync(full)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Archivo no disponible en este dispositivo');
      }
      return serveFile(req, res, full, row.mime, row.nombre);
    }

    // ---- API: lista de bloques (para la descarga en el navegador) ----
    if (route === '/api/chunks') {
      const hash = url.searchParams.get('hash');
      const info = hash && getChunkInfo ? await getChunkInfo(hash) : null;
      if (!info) return sendJson(res, 404, { found: false });
      return sendJson(res, 200, { found: true, size: info.size, chunkSize: info.chunkSize, chunkHashes: info.chunkHashes });
    }

    // ---- API: UN bloque por HTTP (origen / respaldo del mesh) ----
    //  Pasa por el limitador de carga: si el central está saturado responde 503
    //  (Retry-After) y el celular reintenta o se apoya en sus compañeros (mesh).
    if (route === '/api/chunk') {
      const hash = url.searchParams.get('hash');
      const i = Number(url.searchParams.get('index'));
      const file = hash && resolveHashToFile ? resolveHashToFile(hash) : null;
      const info = hash && getChunkInfo ? await getChunkInfo(hash) : null;
      if (!file || !info || !Number.isInteger(i)) { res.writeHead(404); return res.end(); }
      const start = i * info.chunkSize;
      if (start >= info.size) { res.writeHead(416); return res.end(); }
      const end = Math.min(start + info.chunkSize, info.size); // exclusivo
      try {
        await chunkLimiter.runOrBusy(() => new Promise((resolve, reject) => {
          res.writeHead(200, {
            'Content-Type': 'application/octet-stream',
            'Content-Length': end - start,
            'X-Edu-Load': `${chunkLimiter.stats().active}/${SERVE_CONCURRENCY}`,
          });
          const s = fs.createReadStream(file, { start, end: end - 1 });
          s.on('error', reject);
          s.on('end', resolve);
          res.on('close', () => { s.destroy(); resolve(); });
          s.pipe(res);
        }));
      } catch (e) {
        if (e && e.busy) { res.writeHead(503, { 'Retry-After': '1' }); return res.end('ocupado'); }
        if (!res.headersSent) res.writeHead(500);
        return res.end();
      }
      return;
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

          onCatalogChanged?.(); // sube la versión del catálogo → las apps se refrescan solas
          log?.(`📤 Maestro publicó "${nombre}" (${info.size} B) en ${materia} / ${leccion}`);
          sendJson(res, 200, { ok: true, hash: contentHash, nombre, size: info.size });
        } catch (err) {
          fs.rmSync(tmp, { force: true });
          sendJson(res, 500, { error: err.message });
        }
      });
      return;
    }

    // ---- API: estado de la sincronización automática (público, de solo lectura) ----
    //  Incluye catalogVersion para que la app detecte contenido nuevo y se refresque
    //  sola (tanto si llegó por sincronización como si el maestro publicó algo).
    if (route === '/api/sync/status') {
      const s = getSyncStatus ? getSyncStatus() : { enabled: false };
      return sendJson(res, 200, { ...s, catalogVersion: getCatalogVersion ? getCatalogVersion() : 0 });
    }

    // ---- API Maestro: forzar una sincronización ahora ----
    if (route === '/api/sync/now' && req.method === 'POST') {
      if (!isTeacher(req)) return sendJson(res, 401, { error: 'No autorizado' });
      if (!runSyncNow) return sendJson(res, 400, { error: 'La sincronización automática no está activada en este nodo (usa --sync-from=URL).' });
      runSyncNow(); // dispara en segundo plano; el cliente sigue el avance con /api/sync/status
      return sendJson(res, 200, { ok: true, status: getSyncStatus ? getSyncStatus() : null });
    }

    // ---- API Maestro: cuestionario en vivo ("Kahoot") ----
    //  El maestro controla la partida por HTTP (autenticado); los alumnos juegan
    //  por WebSocket. Todas las rutas requieren sesión de maestro.
    if (route.startsWith('/api/quiz/')) {
      if (!isTeacher(req)) return sendJson(res, 401, { error: 'No autorizado' });

      // -- Guardar / cargar (no necesitan partida activa) --
      if (route === '/api/quiz/saved' && req.method === 'GET') {
        return sendJson(res, 200, { quizzes: quizStore ? quizStore.list() : [] });
      }
      if (route === '/api/quiz/load' && req.method === 'GET') {
        const q = quizStore && quizStore.load(url.searchParams.get('id'));
        if (!q) return sendJson(res, 404, { error: 'Cuestionario no encontrado' });
        return sendJson(res, 200, q);
      }
      // -- Estado de la partida en vivo --
      if (route === '/api/quiz/state') {
        if (!quizGame) return sendJson(res, 503, { error: 'El broker aún no está listo.' });
        return sendJson(res, 200, quizGame.hostState());
      }
      if (req.method !== 'POST') return sendJson(res, 405, { error: 'Método no permitido' });

      let payload = {};
      try { const b = await readBody(req); payload = b ? JSON.parse(b) : {}; }
      catch { return sendJson(res, 400, { error: 'Cuerpo inválido' }); }

      if (route === '/api/quiz/save') {
        const v = validateQuiz(payload);
        if (v.error) return sendJson(res, 400, { error: v.error });
        if (!quizStore) return sendJson(res, 500, { error: 'Este nodo no guarda cuestionarios.' });
        return sendJson(res, 200, quizStore.save({ id: payload.id, ...v.game }));
      }
      if (route === '/api/quiz/delete') {
        if (quizStore) quizStore.remove(payload.id);
        return sendJson(res, 200, { ok: true });
      }

      // -- Control de la partida en vivo (requiere broker) --
      if (!quizGame) return sendJson(res, 503, { error: 'El broker aún no está listo.' });
      if (route === '/api/quiz/start') {
        const v = validateQuiz(payload);
        if (v.error) return sendJson(res, 400, { error: v.error });
        return sendJson(res, 200, quizGame.start(v.game));
      }
      if (route === '/api/quiz/next') return sendJson(res, 200, quizGame.next() || { state: 'idle' });
      if (route === '/api/quiz/reveal') return sendJson(res, 200, quizGame.reveal());
      if (route === '/api/quiz/end') return sendJson(res, 200, quizGame.end() || { state: 'idle' });
      if (route === '/api/quiz/cancel') { quizGame.cancel(); return sendJson(res, 200, { ok: true }); }
      return sendJson(res, 404, { error: 'Ruta de cuestionario desconocida' });
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
      const broker = attachSignaling(server, { log }); // broker WebRTC + distribución + quiz
      brokerState = broker.getState;
      quizGame = broker.quiz;
      log?.(`🌐 UI disponible en ${TLS ? 'https' : 'http'}://localhost:${WEB_PORT}`);
      resolve({ server, port: WEB_PORT });
    });
  });
}
