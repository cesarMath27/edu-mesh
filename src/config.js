// =============================================================================
//  CONFIGURACIÓN CENTRAL
// -----------------------------------------------------------------------------
//  Cada "nodo" (un dispositivo de un alumno) tiene su propio HOME, que contiene:
//    - catalog.db   -> la base de datos local del catálogo (SQLite)
//    - cache/       -> los archivos que ese dispositivo ya posee y comparte
//
//  Esto permite simular VARIOS alumnos en una sola computadora: basta con lanzar
//  cada proceso apuntando a un --home distinto.
//
//  Los parámetros se pueden pasar por argumento de CLI (--home=...) o por
//  variable de entorno (EDU_HOME=...). El argumento tiene prioridad.
// =============================================================================

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del proyecto (un nivel arriba de /src). */
export const ROOT = path.resolve(__dirname, '..');

/**
 * Lee un parámetro con prioridad: --nombre=valor  >  EDU_NOMBRE  >  fallback.
 */
function arg(name, fallback) {
  const prefix = `--${name}=`;
  const fromCli = process.argv.find((a) => a.startsWith(prefix));
  if (fromCli) return fromCli.slice(prefix.length);
  const envKey = `EDU_${name.toUpperCase().replace(/-/g, '_')}`;
  return process.env[envKey] ?? fallback;
}

// --- Identidad y almacenamiento del nodo ------------------------------------
export const HOME = path.resolve(ROOT, arg('home', 'nodes/default'));
export const NODE_NAME = arg('name', path.basename(HOME));
export const DB_PATH = path.join(HOME, 'catalog.db');
export const CACHE_DIR = path.join(HOME, 'cache');

// --- Confianza criptográfica (autoridades curadoras) ------------------------
//  trust-store.json reúne las llaves PÚBLICAS de TODAS las autoridades confiables
//  (con metadatos: etiqueta, fecha, revocada). Se distribuye a cada dispositivo.
//  Las llaves PRIVADAS viven aparte y SOLO en la máquina del curador.
export const KEYS_DIR = path.join(ROOT, 'keys');
export const TRUST_STORE_PATH = path.join(KEYS_DIR, 'trust-store.json');
export const PRIVATE_KEYS_DIR = path.join(KEYS_DIR, 'private');

// --- Red P2P en la LAN ------------------------------------------------------
//  Puerto UDP donde los nodos escuchan/contestan el "¿quién tiene este hash?".
export const DISCOVERY_PORT = Number(arg('discovery-port', 41234));
//  Dirección de difusión. 255.255.255.255 = broadcast a toda la subred local.
export const BROADCAST_ADDR = arg('broadcast', '255.255.255.255');
//  Puerto TCP de transferencia de archivos. 0 = el SO asigna uno libre
//  (imprescindible para correr varios nodos semilla en la misma máquina).
export const TCP_PORT = Number(arg('tcp-port', 0));
//  Cuánto esperamos (ms) las respuestas de los compañeros tras preguntar.
export const LOOKUP_TIMEOUT_MS = Number(arg('timeout', 4000));

// --- Transferencia robusta (chunks) -----------------------------------------
//  Tamaño de cada bloque. Los archivos se dividen, verifican y transfieren por
//  trozos -> permite descarga en paralelo desde varias semillas y reanudación.
export const CHUNK_SIZE = Number(arg('chunk-size', 256 * 1024)); // 256 KiB
//  Cuántos bloques se descargan simultáneamente (workers).
export const CONCURRENCY = Number(arg('concurrency', 4));

// --- Capa de UI (servidor web local) ----------------------------------------
//  Puerto del servidor HTTP que sirve la app de catálogo navegable.
export const WEB_PORT = Number(arg('web-port', 8080));

// --- Sincronización automática desde el hub en línea ------------------------
//  Si se fija --sync-from=URL, el nodo se mantiene al día con el hub SOLO:
//  baja contenido nuevo (verificando firmas) cada --sync-interval minutos.
//  Vacío = desactivado (comportamiento clásico, 100% offline en la LAN).
export const SYNC_FROM = arg('sync-from', '');
export const SYNC_INTERVAL_MIN = Number(arg('sync-interval', 15));

// --- Administración de carga (cuánto sirve el central en paralelo) -----------
//  Para que descargar sea "ligero" aun con muchos celulares: el central solo
//  sirve SERVE_CONCURRENCY bloques a la vez; si la cola pasa de SERVE_QUEUE,
//  responde 503 (reintentar) y los celulares se apoyan más en sus compañeros.
export const SERVE_CONCURRENCY = Number(arg('serve-concurrency', 6));
export const SERVE_QUEUE = Number(arg('serve-queue', 32));

// --- Modo Maestro -----------------------------------------------------------
//  PIN que protege el tablero del maestro y la publicación de contenido, para
//  que solo el maestro (no los alumnos) pueda firmar y publicar.
//  Por SEGURIDAD: si no se fija con --teacher-pin=..., se genera uno ALEATORIO
//  de 6 dígitos en cada arranque (se imprime en pantalla). Nunca un PIN débil fijo.
const _pinArg = arg('teacher-pin');
export const TEACHER_PIN = _pinArg || String(randomInt(100000, 1000000));
export const TEACHER_PIN_IS_GENERATED = !_pinArg;
//  Tamaño máximo de un archivo publicado desde el navegador (MB).
export const MAX_UPLOAD_MB = Number(arg('max-upload-mb', 600));

// --- Cifrado del transporte (HTTPS/TLS opcional) ----------------------------
//  Con --tls la app sirve por HTTPS → token y datos CIFRADOS en la LAN. El
//  certificado es autofirmado (se genera solo en keys/): el navegador mostrará
//  un aviso la 1ª vez (Avanzado → Continuar). Bonus: HTTPS desbloquea el contexto
//  seguro (crypto.subtle nativo, WebRTC más estable, PWA).
export const TLS = process.argv.includes('--tls') || process.env.EDU_TLS === '1';
export const TLS_CERT = arg('tls-cert', path.join(KEYS_DIR, 'tls-cert.pem'));
export const TLS_KEY = arg('tls-key', path.join(KEYS_DIR, 'tls-key.pem'));
