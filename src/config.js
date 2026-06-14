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
