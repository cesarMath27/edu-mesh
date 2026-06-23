// =============================================================================
//  SONIDO DEL CUESTIONARIO  — efectos SINTETIZADOS (Web Audio, sin archivos)
// -----------------------------------------------------------------------------
//  Genera los sonidos al vuelo con osciladores → 0 KB de assets, 100% offline.
//  Los navegadores exigen un gesto del usuario para empezar a sonar: por eso
//  unlock() se llama en el primer toque/clic.
// =============================================================================

let ctx = null;
let muted = localStorage.getItem('edu-quiz-mute') === '1';

function ac() {
  if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } }
  return ctx;
}

/** Desbloquea/reanuda el audio (llamar en un gesto del usuario). */
export function unlock() { const c = ac(); if (c && c.state === 'suspended') c.resume().catch(() => {}); }

export function isMuted() { return muted; }
export function setMuted(v) { muted = !!v; localStorage.setItem('edu-quiz-mute', v ? '1' : '0'); }
export function toggleMuted() { setMuted(!muted); return muted; }

/** Una nota con envolvente suave (ataque rápido, caída exponencial). */
function tone(c, freq, t0, dur, { type = 'sine', gain = 0.2, glideTo = null } = {}) {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t0);
  if (glideTo) o.frequency.exponentialRampToValueAtTime(glideTo, t0 + dur);
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.03);
}

/** Reproduce un efecto por nombre. */
export function play(name) {
  if (muted) return;
  const c = ac();
  if (!c) return;
  if (c.state === 'suspended') c.resume().catch(() => {});
  const t = c.currentTime;
  switch (name) {
    case 'click':   tone(c, 660, t, 0.08, { type: 'triangle', gain: 0.16 }); break;
    case 'tick':    tone(c, 1150, t, 0.05, { type: 'square', gain: 0.07 }); break;
    case 'start':   [523, 784].forEach((f, i) => tone(c, f, t + i * 0.1, 0.13, { type: 'triangle', gain: 0.18 })); break;
    case 'reveal':  tone(c, 440, t, 0.2, { type: 'sawtooth', gain: 0.12, glideTo: 660 }); break;
    case 'correct': [523, 659, 784, 1047].forEach((f, i) => tone(c, f, t + i * 0.09, 0.16, { type: 'triangle', gain: 0.2 })); break;
    case 'wrong':   tone(c, 200, t, 0.38, { type: 'sawtooth', gain: 0.2, glideTo: 110 }); break;
    case 'podium':  [523, 659, 784, 1047, 1319].forEach((f, i) => tone(c, f, t + i * 0.12, 0.26, { type: 'triangle', gain: 0.22 })); break;
  }
}
