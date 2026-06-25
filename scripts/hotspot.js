// =============================================================================
//  HOTSPOT (CLI)  —  enciende/apaga el punto de acceso WiFi de la PC a mano
// -----------------------------------------------------------------------------
//  Útil para probar el punto de acceso por separado del nodo. Lo normal es usar
//  `node src/node-app.js --hotspot` (lo crea y lo apaga solo al salir).
//
//  Uso:
//    node scripts/hotspot.js start [--ap-ssid=edu-mesh] [--ap-pass=clave1234]
//    node scripts/hotspot.js stop
//    node scripts/hotspot.js qr        # solo imprime el QR de "únete a la red"
//    (alias: npm run hotspot -- start)
// =============================================================================

import qrcode from 'qrcode-terminal';
import { startHotspot, stopHotspot, wifiQrPayload } from '../src/net/hotspot.js';
import { AP_SSID, AP_PASS } from '../src/config.js';

const action = (process.argv[2] || 'start').toLowerCase();
const method = process.platform === 'win32' ? 'mobile-hotspot' : 'nmcli';

function printJoin() {
  console.log(`  Red (SSID): ${AP_SSID}`);
  console.log(`  Clave:      ${AP_PASS}`);
  console.log('  Escanea para unirte a la red:');
  qrcode.generate(wifiQrPayload(AP_SSID, AP_PASS), { small: true }, (q) => console.log('\n' + q));
}

if (action === 'stop') {
  await stopHotspot({ method, log: console.log });
  console.log('✓ Si el punto de acceso estaba activo, se detuvo.');
} else if (action === 'qr') {
  printJoin();
} else {
  console.log(`📶 Creando el punto de acceso "${AP_SSID}"…\n`);
  const r = await startHotspot({ ssid: AP_SSID, password: AP_PASS, log: console.log });
  console.log('');
  if (r.active) console.log('✓ Punto de acceso ACTIVO. Que los alumnos se unan:');
  else { console.log('⚠ No se pudo crear automáticamente. Actívalo a mano y usa estos datos:'); if (r.message) console.log(`  ${r.message}`); }
  printJoin();
  if (r.active) console.log('\n  (déjalo encendido durante la clase · apágalo con: npm run hotspot -- stop)');
}
