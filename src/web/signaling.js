// =============================================================================
//  BROKER DE SEÑALIZACIÓN WebRTC  (el nodo central como "intermediario")
// -----------------------------------------------------------------------------
//  Los navegadores no pueden descubrirse solos: necesitan un punto que les
//  presente y les pase el "handshake" de WebRTC (ofertas/answers/ICE). El nodo
//  central —que ya está siempre encendido sirviendo la app— hace de broker por
//  WebSocket. NO transporta el archivo: solo conecta a los celulares entre sí.
//
//  Protocolo (JSON sobre WebSocket en /ws):
//    server→peer  { t:'welcome', id }
//    peer→server  { t:'have',   hash, index }          // "tengo este bloque"
//    peer→server  { t:'lookup', hash, index, rid }     // "¿quién tiene este bloque?"
//    server→peer  { t:'peers',  rid, peers:[id…] }
//    peer→server  { t:'signal', to, data }             // handshake WebRTC dirigido
//    server→peer  { t:'signal', from, data }
//
//  Una vez conectados por WebRTC, los bloques viajan DIRECTO navegador↔navegador.
// =============================================================================

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';

export function attachSignaling(httpServer, { log } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const peers = new Map();          // peerId -> ws
  const index = new Map();          // hash -> Map(index -> Set(peerId))

  const ensure = (hash) => { if (!index.has(hash)) index.set(hash, new Map()); return index.get(hash); };
  const announce = (peerId, hash, i) => { const m = ensure(hash); if (!m.has(i)) m.set(i, new Set()); m.get(i).add(peerId); };
  const providers = (hash, i) => { const s = index.get(hash)?.get(i); return s ? [...s] : []; };
  const removePeer = (peerId) => { peers.delete(peerId); for (const m of index.values()) for (const s of m.values()) s.delete(peerId); };

  wss.on('connection', (ws) => {
    const id = randomUUID();
    peers.set(id, ws);
    ws.send(JSON.stringify({ t: 'welcome', id }));
    log?.(`🔌 navegador conectado al broker: ${id.slice(0, 8)} (total ${peers.size})`);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      switch (msg.t) {
        case 'have':
          announce(id, msg.hash, msg.index | 0);
          break;
        case 'lookup': {
          const list = providers(msg.hash, msg.index | 0).filter((p) => p !== id);
          ws.send(JSON.stringify({ t: 'peers', rid: msg.rid, peers: list }));
          break;
        }
        case 'signal': {
          const target = peers.get(msg.to);
          if (target && target.readyState === 1) target.send(JSON.stringify({ t: 'signal', from: id, data: msg.data }));
          break;
        }
      }
    });

    ws.on('close', () => { removePeer(id); log?.(`navegador desconectado: ${id.slice(0, 8)}`); });
    ws.on('error', () => {});
  });

  log?.('🛰  Broker de señalización WebRTC activo en /ws');
  return wss;
}
