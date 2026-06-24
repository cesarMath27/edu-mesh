// =============================================================================
//  BROKER DE SEÑALIZACIÓN WebRTC + ESTADO DE DISTRIBUCIÓN
// -----------------------------------------------------------------------------
//  Además de conectar a los navegadores por WebRTC, el broker sabe en todo
//  momento QUIÉN está conectado y CUÁNTO lleva descargado de cada archivo
//  (por los mensajes `hello` y `progress`). Eso alimenta el tablero del maestro.
//
//  Protocolo (JSON sobre WebSocket en /ws):
//    server→peer  { t:'welcome', id }
//    peer→server  { t:'hello',    name }                 // "me llamo así"
//    peer→server  { t:'progress', hash, have, total }    // "llevo have/total"
//    peer→server  { t:'have',     hash, index }          // "tengo este bloque"
//    peer→server  { t:'lookup',   hash, index, rid }     // "¿quién tiene…?"
//    server→peer  { t:'peers',    rid, peers:[id…] }
//    peer→server  { t:'signal',   to, data }             // handshake WebRTC
//    server→peer  { t:'signal',   from, data }
// =============================================================================

import { WebSocketServer } from 'ws';
import { randomUUID } from 'node:crypto';
import { createQuiz } from './quiz.js';

export function attachSignaling(httpServer, { log } = {}) {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const peers = new Map();          // peerId -> ws
  const meta = new Map();           // peerId -> { name, prog: Map(hash -> {have,total}) }
  const index = new Map();          // hash -> Map(index -> Set(peerId))   (para el mesh)

  const ensure = (hash) => { if (!index.has(hash)) index.set(hash, new Map()); return index.get(hash); };
  const announce = (peerId, hash, i) => { const m = ensure(hash); if (!m.has(i)) m.set(i, new Set()); m.get(i).add(peerId); };
  const providers = (hash, i) => { const s = index.get(hash)?.get(i); return s ? [...s] : []; };
  const removePeer = (peerId) => { peers.delete(peerId); meta.delete(peerId); for (const m of index.values()) for (const s of m.values()) s.delete(peerId); };

  // --- Cuestionario en vivo ("Kahoot"): se monta sobre estas mismas conexiones ---
  const broadcast = (obj) => { const s = JSON.stringify(obj); for (const w of peers.values()) if (w.readyState === 1) w.send(s); };
  const sendTo = (pid, obj) => { const w = peers.get(pid); if (w && w.readyState === 1) w.send(JSON.stringify(obj)); };
  const getPlayers = () => [...meta.entries()].map(([id, m]) => ({ id, name: m.name || `Alumno-${id.slice(0, 4)}` }));
  const quiz = createQuiz({ broadcast, sendTo, getPlayers, log });

  wss.on('connection', (ws) => {
    const id = randomUUID();
    peers.set(id, ws);
    meta.set(id, { name: null, prog: new Map() });
    ws.send(JSON.stringify({ t: 'welcome', id }));
    log?.(`🔌 navegador conectado al broker: ${id.slice(0, 8)} (total ${peers.size})`);

    ws.on('message', (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const m = meta.get(id);
      switch (msg.t) {
        case 'hello':
          if (m) { m.name = String(msg.name || '').slice(0, 40); m.role = msg.role === 'teacher' ? 'teacher' : null; }
          break;
        case 'progress':
          if (m) m.prog.set(msg.hash, { have: msg.have | 0, total: msg.total | 0 });
          break;
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
        case 'quiz:answer':
          quiz.submitAnswer(id, msg.index | 0);
          break;
      }
    });

    ws.on('close', () => { removePeer(id); log?.(`navegador desconectado: ${id.slice(0, 8)}`); });
    ws.on('error', () => {});
  });

  log?.('🛰  Broker de señalización WebRTC activo en /ws');

  // Estado para el tablero del maestro: alumnos conectados + su avance por archivo.
  //  Excluye al propio maestro (role:'teacher') para no contarlo como alumno.
  function getState() {
    return [...meta.entries()].filter(([, m]) => m.role !== 'teacher').map(([id, m]) => ({
      id,
      name: m.name || `Alumno-${id.slice(0, 4)}`,
      files: Object.fromEntries([...m.prog.entries()]),
    }));
  }

  return { wss, getState, quiz };
}
