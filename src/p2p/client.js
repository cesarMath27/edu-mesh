// =============================================================================
//  CLIENTE DE TRANSFERENCIA POR BLOQUES  (TCP / net) — el nodo que DESCARGA
// -----------------------------------------------------------------------------
//  Dos primitivas, una conexión por petición (fáciles de lanzar en paralelo):
//    - fetchChunkList(peer, hash)        -> { size, chunkSize, chunkHashes }
//    - fetchChunk(peer, hash, index)     -> Buffer con los bytes del bloque
// =============================================================================

import net from 'node:net';

const CONNECT_TIMEOUT_MS = 8000;

/** Pide la lista de hashes de bloque a un compañero. */
export function fetchChunkList({ host, tcpPort }, hash) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(tcpPort, host);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timeout')));
    let buf = Buffer.alloc(0);

    socket.on('connect', () => socket.write(JSON.stringify({ type: 'MANIFEST', hash }) + '\n'));
    socket.on('data', (d) => { buf = Buffer.concat([buf, d]); });
    socket.on('end', () => {
      try {
        const res = JSON.parse(buf.toString('utf8').trim());
        if (!res.found) return reject(new Error('el compañero no tiene el archivo'));
        resolve(res);
      } catch (e) { reject(e); }
    });
    socket.on('error', reject);
  });
}

/** Descarga UN bloque concreto y devuelve su Buffer. */
export function fetchChunk({ host, tcpPort }, hash, index) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(tcpPort, host);
    socket.setTimeout(CONNECT_TIMEOUT_MS, () => socket.destroy(new Error('timeout')));

    let header = null;
    let headChunks = [];
    const bodyChunks = [];

    socket.on('connect', () => socket.write(JSON.stringify({ type: 'CHUNK', hash, index }) + '\n'));

    socket.on('data', (chunk) => {
      if (!header) {
        headChunks.push(chunk);
        const b = Buffer.concat(headChunks);
        const nl = b.indexOf(0x0a);
        if (nl === -1) return;
        try { header = JSON.parse(b.slice(0, nl).toString('utf8')); }
        catch { socket.destroy(); return reject(new Error('cabecera inválida')); }
        if (!header.found) { socket.destroy(); return reject(new Error(`bloque ${index} no disponible`)); }
        const rest = b.slice(nl + 1);
        if (rest.length) bodyChunks.push(rest);
        headChunks = null;
      } else {
        bodyChunks.push(chunk);
      }
    });

    socket.on('end', () => {
      if (!header) return reject(new Error('conexión cerrada sin cabecera'));
      resolve(Buffer.concat(bodyChunks));
    });
    socket.on('error', reject);
  });
}
