// =============================================================================
//  PUNTO DE ACCESO (HOTSPOT)  —  crea una WiFi en la PC para que entren los celus
// -----------------------------------------------------------------------------
//  Opcional (--hotspot). En vez de depender de un router, la PC del maestro PUEDE
//  levantar su propia red WiFi: los alumnos se unen a ella y abren la app. Es la
//  pieza que faltaba para que el salón funcione SIN ninguna red previa.
//
//  Es "el mejor esfuerzo" y depende del sistema/adaptador:
//    · Windows: usa el "Mobile hotspot" nativo (WinRT, SIN admin) y, si no, intenta
//      `netsh` (SoftAP, ideal offline pero pide admin). Todo va en win-hotspot.ps1.
//    · Linux:   NetworkManager (`nmcli device wifi hotspot`) — pide sudo y un
//      adaptador compatible con modo AP.
//    · macOS:   no hay forma fiable por CLI → modo ASISTIDO: se guía al maestro a
//      activar "Compartir Internet" y se le da el SSID/clave + QR para unirse.
//
//  Si no se puede crear automáticamente, NUNCA rompe el arranque: devuelve
//  `assisted:true` con instrucciones, y la app sigue sirviéndose igual.
// =============================================================================

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const PS1 = path.join(ROOT, 'scripts', 'win-hotspot.ps1');

/** Ejecuta un comando (sin shell) y captura salida con tope de tiempo. */
function run(cmd, args, { timeoutMs = 25000 } = {}) {
  return new Promise((resolve) => {
    let out = ''; let err = ''; let done = false;
    let child;
    const finish = (code) => { if (done) return; done = true; resolve({ code, out, err }); };
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch (e) {
      return resolve({ code: -1, out: '', err: String(e.message || e) });
    }
    const timer = setTimeout(() => { try { child.kill(); } catch { /* ya murió */ } finish(-2); }, timeoutMs);
    child.stdout?.on('data', (d) => { out += d; });
    child.stderr?.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); err += String(e.message || e); finish(-1); });
    child.on('close', (code) => { clearTimeout(timer); finish(code); });
  });
}

/** ¿Existe un binario en el PATH? (para detectar nmcli en Linux). */
async function has(bin) {
  const probe = process.platform === 'win32' ? ['where', [bin]] : ['which', [bin]];
  const { code } = await run(probe[0], probe[1], { timeoutMs: 4000 });
  return code === 0;
}

/**
 * Carga útil de un QR "WIFI:" para que el celular se UNA a la red con un escaneo.
 * Formato estándar reconocido por las cámaras de Android/iOS.
 */
export function wifiQrPayload(ssid, password) {
  const esc = (s) => String(s ?? '').replace(/([\\;,:"])/g, '\\$1');
  const auth = password ? 'WPA' : 'nopass';
  return `WIFI:T:${auth};S:${esc(ssid)};${password ? `P:${esc(password)};` : ''}H:false;;`;
}

const winInstructions =
  'Para crear la WiFi sin internet hace falta permiso de Administrador y un adaptador WiFi compatible. Actívalo a mano: Inicio → Configuración → Red e Internet → Zona con cobertura inalámbrica móvil (o ejecuta  start ms-settings:network-mobilehotspot ).';

// ---- Windows: red hospedada offline (netsh, con elevación) → mobile hotspot → asistido ----
async function startWindows({ ssid, password, log }) {
  // Tiempo amplio: puede aparecer el aviso de Windows (UAC) y esperar al maestro.
  const { code, out, err } = await run(
    'powershell',
    ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Action', 'start', '-Ssid', ssid, '-Password', password],
    { timeoutMs: 120000 },
  );
  let parsed = null;
  // El script imprime una línea JSON: { ok, method, message, hint }.
  for (const line of String(out).split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith('{') && t.endsWith('}')) { try { parsed = JSON.parse(t); } catch { /* sigue */ } }
  }
  if (parsed?.ok) {
    log?.(`📶 Punto de acceso ACTIVO ("${ssid}") por ${parsed.method}.`);
    return { active: true, assisted: false, method: parsed.method || 'windows', ssid, password, message: parsed.message || '' };
  }
  const why = [parsed?.message, parsed?.hint].filter(Boolean).join(' ') || err || `powershell devolvió ${code}. ${winInstructions}`;
  log?.(`📶 No se pudo crear el punto de acceso automáticamente.`);
  return { active: false, assisted: true, method: 'manual', ssid, password, message: why };
}

// ---- Linux: NetworkManager ----
async function startLinux({ ssid, password, log }) {
  if (!(await has('nmcli'))) {
    return { active: false, assisted: true, method: 'manual', ssid, password,
      message: 'No encontré NetworkManager (nmcli). Crea el hotspot desde tu entorno de escritorio y comparte el SSID/clave.' };
  }
  const { code, err } = await run('nmcli', ['device', 'wifi', 'hotspot', 'ssid', ssid, 'password', password], { timeoutMs: 20000 });
  if (code === 0) {
    log?.(`📶 Punto de acceso ACTIVO ("${ssid}") por nmcli.`);
    return { active: true, assisted: false, method: 'nmcli', ssid, password, message: '' };
  }
  const why = (err || `nmcli devolvió ${code}`).trim();
  log?.(`📶 nmcli no pudo crear el hotspot (${why}). ¿Falta sudo o el adaptador no soporta modo AP?`);
  return { active: false, assisted: true, method: 'manual', ssid, password,
    message: `${why}. Prueba con sudo, o crea el hotspot desde tu escritorio.` };
}

// ---- macOS: solo asistido ----
function startMac({ ssid, password }) {
  return { active: false, assisted: true, method: 'manual', ssid, password,
    message: 'En Mac: Ajustes del Sistema → General → Compartir → activa "Compartir Internet" por Wi-Fi. macOS no permite crearlo por software; usa el SSID/clave y el QR de abajo.' };
}

/**
 * Intenta crear el punto de acceso. Nunca lanza: devuelve un estado uniforme.
 * @returns {{active:boolean, assisted:boolean, method:string, ssid:string, password:string, message:string}}
 */
export async function startHotspot({ ssid, password, log }) {
  try {
    if (process.platform === 'win32') return await startWindows({ ssid, password, log });
    if (process.platform === 'linux') return await startLinux({ ssid, password, log });
    if (process.platform === 'darwin') return startMac({ ssid, password });
  } catch (e) {
    return { active: false, assisted: true, method: 'manual', ssid, password, message: String(e.message || e) };
  }
  return { active: false, assisted: true, method: 'manual', ssid, password,
    message: 'Sistema no soportado para crear el hotspot automáticamente.' };
}

/** Apaga el punto de acceso si lo habíamos encendido (mejor esfuerzo). */
export async function stopHotspot({ method, log } = {}) {
  try {
    if (process.platform === 'win32' && method && method !== 'manual') {
      await run('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', PS1, '-Action', 'stop'], { timeoutMs: 15000 });
      log?.('📶 Punto de acceso detenido.');
    } else if (process.platform === 'linux' && method === 'nmcli') {
      await run('nmcli', ['connection', 'down', 'Hotspot'], { timeoutMs: 10000 });
      log?.('📶 Punto de acceso (nmcli) detenido.');
    }
  } catch { /* mejor esfuerzo */ }
}
