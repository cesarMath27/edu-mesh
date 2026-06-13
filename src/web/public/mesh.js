// =============================================================================
//  MESH WebRTC en el navegador  (cada celular es peer: pide Y sirve bloques)
// -----------------------------------------------------------------------------
//  - Se conecta al broker (WebSocket) para descubrir compañeros y señalizar.
//  - Abre DataChannels WebRTC DIRECTOS a otros navegadores (sin pasar por el
//    servidor) para pedir/enviar bloques.
//  - En la misma LAN, WebRTC conecta con candidatos de host (IP local), por lo
//    que funciona 100% OFFLINE: no usamos STUN/TURN ni internet.
//
//  Protocolo del DataChannel (por bloque, serializado por peer):
//    pide:    "{ t:'req', hash, index }"        (texto)
//    sirve:   "{ t:'res', hash, index, len }"   (texto) + <bytes>  (binario)
// =============================================================================

export class Mesh {
  constructor() {
    this.id = null;
    this.ws = null;
    this.peers = new Map();         // peerId -> { pc, dc, ready, _ready, lock, pending }
    this._lookups = new Map();      // rid -> resolve
    this.serveChunk = async () => null;   // la app lo define: (hash,index) -> ArrayBuffer|null
    this.onPeers = () => {};        // notifica cambios en nº de compañeros
  }

  connect() {
    return new Promise((resolve) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      this.ws = new WebSocket(`${proto}://${location.host}/ws`);
      this._welcome = resolve;
      this.ws.onmessage = (e) => this._onWs(JSON.parse(e.data));
      this.ws.onclose = () => { /* prototipo: sin reconexión automática */ };
      this.ws.onerror = () => {};
    });
  }

  _send(o) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(o)); }

  announce(hash, index) { this._send({ t: 'have', hash, index }); }

  lookup(hash, index) {
    return new Promise((resolve) => {
      const rid = Math.random().toString(36).slice(2);
      this._lookups.set(rid, resolve);
      this._send({ t: 'lookup', hash, index, rid });
      setTimeout(() => { if (this._lookups.delete(rid)) resolve([]); }, 1500);
    });
  }

  _onWs(msg) {
    if (msg.t === 'welcome') { this.id = msg.id; this._welcome?.(msg.id); return; }
    if (msg.t === 'peers') { const r = this._lookups.get(msg.rid); if (r) { this._lookups.delete(msg.rid); r(msg.peers); } return; }
    if (msg.t === 'signal') { this._onSignal(msg.from, msg.data); return; }
  }

  _peer(peerId, initiator) {
    let p = this.peers.get(peerId);
    if (p) return p;
    const pc = new RTCPeerConnection({ iceServers: [] }); // LAN: candidatos de host, sin internet
    p = { pc, dc: null, ready: null, _ready: null, lock: Promise.resolve(), pending: null };
    p.ready = new Promise((res) => { p._ready = res; });
    pc.onicecandidate = (e) => { if (e.candidate) this._send({ t: 'signal', to: peerId, data: { candidate: e.candidate } }); };
    pc.onconnectionstatechange = () => {
      if (['failed', 'closed', 'disconnected'].includes(pc.connectionState)) { this.peers.delete(peerId); this.onPeers(this.peers.size); }
    };
    if (initiator) this._setupDC(p, pc.createDataChannel('chunks'));
    else pc.ondatachannel = (e) => this._setupDC(p, e.channel);
    this.peers.set(peerId, p);
    this.onPeers(this.peers.size);
    return p;
  }

  _setupDC(p, dc) {
    dc.binaryType = 'arraybuffer';
    p.dc = dc;
    dc.onopen = () => p._ready(dc);
    dc.onmessage = (e) => this._onDC(p, e.data);
  }

  async _onSignal(from, data) {
    let p = this.peers.get(from);
    if (data.sdp) {
      if (data.sdp.type === 'offer') {
        p = this._peer(from, false);
        await p.pc.setRemoteDescription(data.sdp);
        const ans = await p.pc.createAnswer();
        await p.pc.setLocalDescription(ans);
        this._send({ t: 'signal', to: from, data: { sdp: p.pc.localDescription } });
      } else if (p) {
        await p.pc.setRemoteDescription(data.sdp);
      }
    } else if (data.candidate) {
      if (!p) p = this._peer(from, false);
      try { await p.pc.addIceCandidate(data.candidate); } catch { /* candidato tardío */ }
    }
  }

  async _connectTo(peerId) {
    let p = this.peers.get(peerId);
    if (p && p.dc && p.dc.readyState === 'open') return p;
    p = this._peer(peerId, true);
    const offer = await p.pc.createOffer();
    await p.pc.setLocalDescription(offer);
    this._send({ t: 'signal', to: peerId, data: { sdp: p.pc.localDescription } });
    await Promise.race([p.ready, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout conexión')), 6000))]);
    return p;
  }

  // Atiende peticiones entrantes de bloques (yo sirvo a otros).
  async _onDC(p, raw) {
    if (typeof raw === 'string') {
      const m = JSON.parse(raw);
      if (m.t === 'req') {
        const buf = await this.serveChunk(m.hash, m.index);
        if (buf) { p.dc.send(JSON.stringify({ t: 'res', hash: m.hash, index: m.index, len: buf.byteLength })); p.dc.send(buf); }
        else p.dc.send(JSON.stringify({ t: 'res', hash: m.hash, index: m.index, len: 0 }));
      } else if (m.t === 'res' && m.len === 0 && p.pending) {
        const cb = p.pending; p.pending = null; cb.reject(new Error('el compañero no tiene el bloque'));
      }
      // si len>0, los bytes llegan en el siguiente mensaje binario
    } else if (p.pending) {
      const cb = p.pending; p.pending = null; cb.resolve(raw); // ArrayBuffer
    }
  }

  // Pide UN bloque a un compañero (serializado por peer con un mini-mutex).
  async requestChunk(peerId, hash, index) {
    const p = await this._connectTo(peerId);
    const prev = p.lock;
    let release;
    p.lock = new Promise((r) => { release = r; });
    await prev;
    try {
      return await new Promise((resolve, reject) => {
        const to = setTimeout(() => { p.pending = null; reject(new Error('timeout bloque')); }, 6000);
        p.pending = { resolve: (v) => { clearTimeout(to); resolve(v); }, reject: (e) => { clearTimeout(to); reject(e); } };
        p.dc.send(JSON.stringify({ t: 'req', hash, index }));
      });
    } finally { release(); }
  }
}
