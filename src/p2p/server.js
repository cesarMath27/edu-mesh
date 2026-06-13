// =============================================================================
//  SERVIDOR DE TRANSFERENCIA POR BLOQUES  (TCP / net) — el nodo que ENVÍA
// -----------------------------------------------------------------------------
//  Protocolo (una petición por conexión; así es trivial paralelizar):
//
//    A) Lista de bloques
//       Cliente  → { "type":"MANIFEST", "hash":H }\n
//       Servidor → { "found":true, "size":N, "chunkSize":C, "chunkHashes":[...] }\n  (y cierra)
//
//    B) Un bloque concreto
//       Cliente  → { "type":"CHUNK", "hash":H, "index":i }\n
//       Servidor → { "found":true, "index":i, "length":L }\n + <L bytes…>          (y cierra)
//
//  Los bytes de cada bloque se leen del archivo con offset (createReadStream
//  {start,end}) y se canalizan al socket -> soporta archivos pesados sin RAM.
// =============================================================================

import net from 'node:net';
import fs from 'node:fs';
import { createReadStream } from 'node:fs';
import { TCP_PORT } from '../config.js';

/**
 * Arranca el servidor TCP de bloques.
 * @param {object} p
 * @param {(hash:string)=>(string|null)} p.resolveHashToFile  hash -> ruta local (o null).
 * @param {(hash:string)=>Promise<object|null>} p.getChunkInfo hash -> {size,chunkSize,chunkHashes}.
 * @param {Function} [p.log]
 * @returns {Promise<{server: import('node:net').Server, port: number}>}
 */
export function startFileServer({ resolveHashToFile, getChunkInfo, log }) {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let handled = false;

    socket.on('data', async (chunk) => {
      if (handled) return;
      buffer = Buffer.concat([buffer, chunk]);
      const nl = buffer.indexOf(0x0a);
      if (nl === -1) return;
      handled = true;

      let req;
      try { req = JSON.parse(buffer.slice(0, nl).toString('utf8')); }
      catch { return socket.end(); }

      const filePath = req?.hash ? resolveHashToFile(req.hash) : null;
      if (!filePath || !fs.existsSync(filePath)) {
        return socket.end(JSON.stringify({ found: false }) + '\n');
      }
      const info = await getChunkInfo(req.hash);
      if (!info) return socket.end(JSON.stringify({ found: false }) + '\n');

      // ---- A) Lista de bloques ----
      if (req.type === 'MANIFEST') {
        socket.end(JSON.stringify({
          found: true,
          size: info.size,
          chunkSize: info.chunkSize,
          chunkHashes: info.chunkHashes,
        }) + '\n');
        log?.(`📋 Enviada lista de ${info.chunkHashes.length} bloques de ${req.hash.slice(0, 12)}…`);
        return;
      }

      // ---- B) Un bloque concreto ----
      if (req.type === 'CHUNK') {
        const i = req.index | 0;
        const start = i * info.chunkSize;
        if (start >= info.size) return socket.end(JSON.stringify({ found: false }) + '\n');
        const end = Math.min(start + info.chunkSize, info.size); // exclusivo
        socket.write(JSON.stringify({ found: true, index: i, length: end - start }) + '\n');
        const fileStream = createReadStream(filePath, { start, end: end - 1 }); // end inclusivo en fs
        fileStream.pipe(socket);
        fileStream.on('end', () => log?.(`⬆  bloque ${i} (${end - start} B) → ${socket.remoteAddress}`));
        fileStream.on('error', () => socket.destroy());
        return;
      }

      socket.end(); // tipo desconocido
    });

    socket.on('error', () => { /* el cliente cerró; sin ruido */ });
  });

  return new Promise((resolve) => {
    server.listen(TCP_PORT, () => {
      const port = server.address().port;
      log?.(`🚀 Servidor de transferencia TCP escuchando en el puerto ${port}`);
      resolve({ server, port });
    });
  });
}
