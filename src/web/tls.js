// =============================================================================
//  CERTIFICADO TLS AUTOFIRMADO  (para el modo HTTPS opcional, --tls)
// -----------------------------------------------------------------------------
//  Genera (una vez) un certificado autofirmado y lo guarda en keys/, con las IPs
//  locales como SAN para que el navegador al menos coincida la dirección.
//  El navegador mostrará un aviso de "no confiable" (es autofirmado) — el
//  operador acepta una vez. A cambio: el transporte va CIFRADO.
// =============================================================================

import fs from 'node:fs';
import selfsigned from 'selfsigned';
import { lanAddresses } from '../util/netinfo.js';
import { TLS_CERT, TLS_KEY, KEYS_DIR } from '../config.js';

export async function ensureTlsCert({ log } = {}) {
  if (fs.existsSync(TLS_CERT) && fs.existsSync(TLS_KEY)) {
    return { cert: fs.readFileSync(TLS_CERT), key: fs.readFileSync(TLS_KEY) };
  }
  const altNames = [
    { type: 2, value: 'localhost' },
    { type: 7, ip: '127.0.0.1' },
    ...lanAddresses().map((a) => ({ type: 7, ip: a.address })),
  ];
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'edu-mesh' }], {
    days: 3650,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{ name: 'subjectAltName', altNames }],
  });
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  fs.writeFileSync(TLS_CERT, pems.cert);
  fs.writeFileSync(TLS_KEY, pems.private);
  log?.('🔒 Certificado TLS autofirmado generado en keys/ (válido 10 años).');
  return { cert: pems.cert, key: pems.private };
}
