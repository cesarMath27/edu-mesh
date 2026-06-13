// =============================================================================
//  DESCUBRIMIENTO EN LA LAN  (UDP / dgram)  — "¿Quién tiene este archivo?"
// -----------------------------------------------------------------------------
//  Funciona 100% dentro de la red WiFi local, sin internet:
//
//   1) El ALUMNO emite por UDP un mensaje LOOKUP { hash } (broadcast a la subred
//      + un envío directo a 127.0.0.1 para que el demo en una sola PC sea fiable).
//   2) Cada SEMILLA escucha en DISCOVERY_PORT. Si tiene ese hash en su caché,
//      responde por UDP (unicast) con HAVE { hash, tcpPort, node }.
//   3) El alumno recopila las respuestas durante una ventana de tiempo y obtiene
//      la lista de compañeros que poseen el archivo (su IP + su puerto TCP).
//
//  Solo se intercambian metadatos diminutos por UDP; los BYTES del archivo viajan
//  aparte por TCP (ver server.js / client.js).
// =============================================================================

import dgram from 'node:dgram';
import { DISCOVERY_PORT, BROADCAST_ADDR, LOOKUP_TIMEOUT_MS } from '../config.js';

/**
 * Lado SEMILLA: escucha solicitudes y responde si tiene el hash.
 * @param {object}   p
 * @param {(hash:string)=>boolean} p.hasHash      ¿Tengo este archivo en caché?
 * @param {()=>number}             p.getTcpPort   Mi puerto TCP de transferencia.
 * @param {string}                 p.nodeName
 * @param {Function}              [p.log]
 * @returns {import('node:dgram').Socket}
 */
export function startDiscoveryResponder({ hasHash, getTcpPort, nodeName, log }) {
  // reuseAddr permite que varias semillas convivan en el mismo puerto/máquina.
  const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });

  sock.on('message', (msg, rinfo) => {
    let req;
    try { req = JSON.parse(msg.toString()); } catch { return; }
    if (req.type !== 'LOOKUP' || !req.hash) return;
    if (!hasHash(req.hash)) return; // no lo tengo -> no contesto

    const reply = Buffer.from(JSON.stringify({
      type: 'HAVE',
      hash: req.hash,
      tcpPort: getTcpPort(),
      node: nodeName,
    }));
    // Respondemos directamente a quien preguntó (unicast).
    sock.send(reply, rinfo.port, rinfo.address);
    log?.(`↩  Tengo ${req.hash.slice(0, 12)}… → aviso a ${rinfo.address}:${rinfo.port}`);
  });

  sock.on('error', (err) => log?.(`Error en responder UDP: ${err.message}`));

  sock.bind(DISCOVERY_PORT, () => {
    sock.setBroadcast(true);
    log?.(`📡 Escuchando solicitudes P2P en UDP/${DISCOVERY_PORT}`);
  });

  return sock;
}

/**
 * Lado ALUMNO: pregunta por un hash y recopila los compañeros que lo tienen.
 * @param {string} hash
 * @param {object} [opts]
 * @param {number} [opts.timeout]
 * @param {Function} [opts.log]
 * @returns {Promise<Array<{host:string, tcpPort:number, node:string}>>}
 */
export function lookupPeers(hash, { timeout = LOOKUP_TIMEOUT_MS, log } = {}) {
  return new Promise((resolve) => {
    // Socket EFÍMERO propio (puerto 0): así el alumno no choca con el puerto de
    // descubrimiento que usan las semillas, y puede correr en la misma máquina.
    const sock = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const seen = new Map(); // dedupe por host:tcpPort

    sock.on('message', (msg, rinfo) => {
      let res;
      try { res = JSON.parse(msg.toString()); } catch { return; }
      if (res.type !== 'HAVE' || res.hash !== hash) return;
      const key = `${rinfo.address}:${res.tcpPort}`;
      if (seen.has(key)) return;
      seen.set(key, { host: rinfo.address, tcpPort: res.tcpPort, node: res.node });
      log?.(`✅ Compañero con el archivo: ${res.node} @ ${key}`);
    });

    sock.bind(0, () => {
      sock.setBroadcast(true);
      const payload = Buffer.from(JSON.stringify({ type: 'LOOKUP', hash }));
      // Broadcast para la LAN real + loopback directo para el demo en 1 sola PC.
      const targets = [...new Set([BROADCAST_ADDR, '127.0.0.1'])];
      for (const t of targets) {
        sock.send(payload, DISCOVERY_PORT, t, (err) => {
          if (err) log?.(`No pude enviar a ${t}: ${err.message}`);
        });
      }
      log?.(`🔎 LOOKUP de ${hash.slice(0, 12)}… enviado a [${targets.join(', ')}]:${DISCOVERY_PORT}`);
    });

    // Cerramos la ventana de escucha y devolvemos lo recopilado.
    setTimeout(() => {
      sock.close();
      resolve([...seen.values()]);
    }, timeout);
  });
}
