// =============================================================================
//  INICIADOR DE DOS PANTALLAS  — QR para alumnos  +  Panel del maestro
// -----------------------------------------------------------------------------
//  Un solo comando que:
//    1) Arranca el nodo central (src/node-app.js) con un PIN de maestro estable.
//    2) Espera a que el servidor web responda.
//    3) Abre DOS ventanas en el navegador:
//         · Pantalla del QR  ->  /qr.html   (proyéctala: los alumnos la escanean)
//         · Panel del maestro -> /?maestro=1 (auto-entra en este equipo y muestra
//                                             PIN, enlaces y todos los ajustes)
//
//  El PIN se guarda en .teacher-pin (en la raíz del proyecto) para que sea SIEMPRE
//  el mismo entre clases. Fíjalo tú con --teacher-pin=1234 si lo prefieres.
//
//  Uso:   node scripts/launch.js  [--home=nodes/semilla] [--name=Central]
//                                 [--web-port=8080] [--teacher-pin=1234]
//                                 [--tls] [--no-browser]
// =============================================================================

import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomInt } from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

// ---- Lectura de parámetros (igual que src/config.js: --x=y > EDU_X > fallback) ----
function arg(name, fallback) {
  const pre = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(pre));
  if (hit) return hit.slice(pre.length);
  const env = process.env[`EDU_${name.toUpperCase().replace(/-/g, '_')}`];
  return env ?? fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const HOME = arg('home', 'nodes/semilla');
const NAME = arg('name', 'Central');
const PORT = Number(arg('web-port', 8080));
const TLS = flag('tls') || process.env.EDU_TLS === '1';
const NO_BROWSER = flag('no-browser');
const proto = TLS ? 'https' : 'http';

const C = { reset: '\x1b[0m', bold: '\x1b[1m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', dim: '\x1b[2m' };
const say = (s = '') => console.log(s);

// ---- Prerrequisito: dependencias instaladas ----
if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
  say(`\n${C.yellow}  Faltan las dependencias.${C.reset}`);
  say('  Ejecuta primero el INSTALADOR:');
  say('     Windows : doble clic en  Instalar-edu-mesh.bat');
  say('     Mac     : doble clic en  instalar-edu-mesh.command');
  say('     Linux   : ./instalar-edu-mesh.command   (o  npm install && npm run setup)');
  say('');
  process.exit(1);
}

// ---- PIN del maestro: estable entre clases (.teacher-pin), o forzado por bandera ----
const pinFile = path.join(ROOT, '.teacher-pin');
function resolvePin() {
  const fromArg = arg('teacher-pin', null);
  if (fromArg) { try { fs.writeFileSync(pinFile, String(fromArg)); } catch { /* solo lectura */ } return String(fromArg); }
  try {
    const saved = fs.readFileSync(pinFile, 'utf8').trim();
    if (/^\d{4,8}$/.test(saved)) return saved;
  } catch { /* aún no existe */ }
  const pin = String(randomInt(100000, 1000000));
  try { fs.writeFileSync(pinFile, pin); } catch { /* sistema de solo lectura */ }
  return pin;
}
const PIN = resolvePin();

// ---- Arranca el nodo central como proceso hijo (hereda la terminal: ves QR y logs) ----
const serverArgs = [
  path.join('src', 'node-app.js'),
  `--home=${HOME}`, `--name=${NAME}`, `--web-port=${PORT}`, `--teacher-pin=${PIN}`,
];
if (TLS) serverArgs.push('--tls');
if (flag('hotspot')) serverArgs.push('--hotspot'); // crea el punto de acceso WiFi en la PC
for (const a of process.argv.slice(2)) if (a.startsWith('--sync') || a.startsWith('--ap-')) serverArgs.push(a); // --sync-from/-interval, --ap-ssid/-pass

say(`\n${C.bold}${C.cyan}  edu-mesh · iniciando el nodo central…${C.reset}`);
say(`${C.dim}  (deja esta ventana ABIERTA durante la clase · Ctrl+C para salir)${C.reset}\n`);

const child = spawn(process.execPath, serverArgs, { cwd: ROOT, stdio: 'inherit' });

let stopping = false;
const stop = (code = 0) => { if (stopping) return; stopping = true; try { child.kill('SIGINT'); } catch { /* ya murió */ } process.exit(code); };
process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));
child.on('exit', (code) => process.exit(code ?? 0));

// ---- Espera a que el servidor web responda, luego abre las dos ventanas ----
function ping() {
  return new Promise((resolve) => {
    const lib = TLS ? https : http;
    const req = lib.get(
      { host: 'localhost', port: PORT, path: '/api/net', timeout: 1500, rejectUnauthorized: false },
      (res) => { res.resume(); resolve(res.statusCode === 200); },
    );
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function waitForServer(maxMs = 40000) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    if (await ping()) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// Abre una URL en el navegador POR DEFECTO (fiable en todas las plataformas).
function openDefault(url) {
  try {
    if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    else if (process.platform === 'darwin') spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
  } catch { /* el usuario puede abrirla a mano */ }
}

// Binarios típicos de Chrome/Edge para abrir el QR en una VENTANA tipo kiosco (--app).
function appBrowsers() {
  const env = process.env;
  if (process.platform === 'win32') {
    const pf = env['ProgramFiles'] || 'C:\\Program Files';
    const pf86 = env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const local = env['LOCALAPPDATA'] || '';
    return [
      `${pf}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Google\\Chrome\\Application\\chrome.exe`,
      local && `${local}\\Google\\Chrome\\Application\\chrome.exe`,
      `${pf86}\\Microsoft\\Edge\\Application\\msedge.exe`,
      `${pf}\\Microsoft\\Edge\\Application\\msedge.exe`,
    ].filter(Boolean);
  }
  if (process.platform === 'darwin') {
    return [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
    ];
  }
  return []; // Linux: usamos el navegador por defecto (xdg-open)
}

// Abre el QR en una ventana limpia (kiosco) si hay Chrome/Edge; si no, navegador normal.
function openQrScreen(url) {
  for (const bin of appBrowsers()) {
    try {
      if (fs.existsSync(bin)) {
        spawn(bin, [`--app=${url}`, '--new-window', '--start-fullscreen'], { detached: true, stdio: 'ignore' }).unref();
        return;
      }
    } catch { /* prueba el siguiente */ }
  }
  openDefault(url);
}

(async () => {
  const qrUrl = `${proto}://localhost:${PORT}/qr.html`;
  const panelUrl = `${proto}://localhost:${PORT}/?maestro=1`;

  const ready = await waitForServer();
  if (!ready) {
    say(`\n${C.yellow}  El servidor tardó en responder.${C.reset} Abre estas direcciones a mano:`);
    say(`     QR alumnos : ${qrUrl}`);
    say(`     Panel maestro: ${panelUrl}\n`);
    return;
  }

  if (NO_BROWSER) {
    say(`\n${C.green}  Listo.${C.reset} Abre tú las pantallas cuando quieras:`);
    say(`     QR alumnos   : ${qrUrl}`);
    say(`     Panel maestro: ${panelUrl}\n`);
    return;
  }

  say(`\n${C.green}${C.bold}  ✓ Abriendo dos pantallas…${C.reset}`);
  say(`     ${C.cyan}Pantalla 1 (alumnos):${C.reset} QR a pantalla completa`);
  say(`     ${C.cyan}Pantalla 2 (maestro):${C.reset} panel con PIN y ajustes`);
  say(`     ${C.dim}PIN del maestro: ${PIN}${C.reset}\n`);

  openQrScreen(qrUrl);           // ventana del QR (kiosco si se puede)
  setTimeout(() => openDefault(panelUrl), 700); // ventana del panel del maestro
})();
