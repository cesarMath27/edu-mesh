// =============================================================================
//  CUESTIONARIO EN VIVO — pantalla del ALUMNO (estilo "Kahoot")
// -----------------------------------------------------------------------------
//  Aparece SOLO cuando el maestro lanza una partida (llega por WebSocket). El
//  alumno ve la pregunta, toca una de las 4 fichas de colores, y recibe al
//  instante si acertó, sus puntos (según la rapidez) y su posición. Con sonido
//  sintetizado, animaciones y confeti en el podio.
//
//  Si ESTE navegador es el que hospeda la partida (el maestro), se ignora todo
//  para no taparle su panel de control.
// =============================================================================

import { mesh } from './download.js';
import { play, unlock, toggleMuted, isMuted } from './sfx.js';
import { confetti } from './confetti.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Las 4 fichas estilo Kahoot: forma + color (fijos, no dependen del tema).
const TILES = [
  { shape: '▲', color: '#e21b3c' },
  { shape: '◆', color: '#1368ce' },
  { shape: '●', color: '#d89e00' },
  { shape: '■', color: '#26890c' },
];

let hosting = false;
/** El maestro llama a esto para que su propio navegador NO muestre la vista de alumno. */
export function setHosting(v) { hosting = !!v; if (v) hide(); }

let overlay = null;
let body = null;    // contenedor del contenido (se reemplaza por pantalla)
let cur = null;     // { options, correctIndex, myAnswer, total, index }
let timerId = null;

function el() {
  if (overlay) return overlay;
  overlay = document.createElement('div');
  overlay.className = 'quiz-overlay';
  overlay.hidden = true;
  overlay.innerHTML = `<button class="quiz-mute" id="quizMute" type="button" aria-label="Silenciar"></button><div class="quiz-content"></div>`;
  document.body.appendChild(overlay);
  body = overlay.querySelector('.quiz-content');
  const mute = overlay.querySelector('#quizMute');
  const paint = () => { mute.textContent = isMuted() ? '🔇' : '🔊'; };
  paint();
  mute.addEventListener('click', () => { toggleMuted(); paint(); unlock(); });
  return overlay;
}
function show() { el().hidden = false; document.body.classList.add('modal-open'); unlock(); }
function hide() {
  if (overlay) overlay.hidden = true;
  document.body.classList.remove('modal-open');
  stopTimer();
}
function stopTimer() { clearInterval(timerId); timerId = null; }

function startTimer(seconds, onTick) {
  stopTimer();
  const end = Date.now() + seconds * 1000;
  let lastSec = -1;
  const tick = () => {
    const left = Math.max(0, end - Date.now());
    const secs = Math.ceil(left / 1000);
    onTick(left / (seconds * 1000), secs);
    if (secs !== lastSec) {
      lastSec = secs;
      if (secs > 0 && secs <= 3 && cur && cur.myAnswer === null) play('tick');
    }
    if (left <= 0) stopTimer();
  };
  tick();
  timerId = setInterval(tick, 100);
}

// ---------- Pantallas ----------
function renderLobby(title, count) {
  show();
  play('start');
  body.innerHTML = `
    <div class="quiz-box quiz-center quiz-pop">
      <div class="quiz-spinner" aria-hidden="true"></div>
      <h2 class="quiz-big">¡Prepárate!</h2>
      <p class="quiz-title">${esc(title)}</p>
      <p class="quiz-muted">${count} pregunta(s) · espera a que el maestro empiece</p>
    </div>`;
}

function renderQuestion(msg) {
  show();
  play('start');
  cur = { options: msg.options, total: msg.total, index: msg.index, myAnswer: null, correctIndex: null };
  const tiles = msg.options.map((opt, i) => {
    const t = TILES[i] || TILES[0];
    return `<button class="quiz-tile" data-i="${i}" style="--tile:${t.color};--d:${i * 60}ms" type="button">
      <span class="quiz-shape">${t.shape}</span><span class="quiz-opt">${esc(opt)}</span>
    </button>`;
  }).join('');

  body.innerHTML = `
    <div class="quiz-box quiz-q">
      <div class="quiz-qhead">
        <span class="quiz-pill">Pregunta ${msg.index + 1}/${msg.total}</span>
        <span class="quiz-pill quiz-timer" id="qTimer">${msg.time}</span>
      </div>
      <div class="quiz-timerbar"><div class="quiz-timerbar-fill" id="qTimerBar"></div></div>
      <p class="quiz-question quiz-pop">${esc(msg.q)}</p>
      <div class="quiz-grid">${tiles}</div>
      <p class="quiz-status" id="qStatus"></p>
    </div>`;

  const bar = body.querySelector('#qTimerBar');
  const tnum = body.querySelector('#qTimer');
  startTimer(msg.time, (frac, secs) => {
    bar.style.width = `${Math.round(frac * 100)}%`;
    bar.classList.toggle('low', frac <= 0.25);
    tnum.textContent = secs;
    if (frac <= 0 && cur && cur.myAnswer === null) setStatus('¡Se acabó el tiempo!');
  });

  body.querySelectorAll('.quiz-tile').forEach((b) => b.addEventListener('click', () => answer(Number(b.dataset.i))));
}

function setStatus(text) { const s = body.querySelector('#qStatus'); if (s) s.textContent = text; }

function answer(i) {
  if (!cur || cur.myAnswer !== null) return;
  cur.myAnswer = i;
  play('click');
  mesh.quizAnswer(i);
  body.querySelectorAll('.quiz-tile').forEach((b) => {
    b.disabled = true;
    if (Number(b.dataset.i) === i) b.classList.add('chosen');
  });
  setStatus('✓ Respuesta enviada · esperando a los demás…');
}

function onAnswersCount(msg) {
  if (cur && cur.myAnswer !== null) setStatus(`✓ Respuesta enviada · ${msg.count}/${msg.players} ya respondieron`);
}

function onReveal(msg) {
  if (!cur) return;
  cur.correctIndex = msg.correct;
  stopTimer();
  play('reveal');
  body.querySelectorAll('.quiz-tile').forEach((b) => {
    const i = Number(b.dataset.i);
    b.disabled = true;
    if (i === msg.correct) b.classList.add('correct');
    else if (i === cur.myAnswer) b.classList.add('wrong');
    else b.classList.add('faded');
  });
}

function renderResult(msg) {
  show();
  play(msg.correct ? 'correct' : 'wrong');
  const correctText = cur && cur.options && cur.correctIndex != null ? cur.options[cur.correctIndex] : '';
  const ok = msg.correct;
  const head = !msg.answered ? 'Sin respuesta' : ok ? '¡Correcto!' : 'Incorrecto';
  body.innerHTML = `
    <div class="quiz-box quiz-center quiz-result ${ok ? 'is-ok' : 'is-bad'}">
      <div class="quiz-emoji quiz-pop">${ok ? '✓' : '✕'}</div>
      <h2 class="quiz-big">${head}</h2>
      ${ok ? `<p class="quiz-gain" id="quizGain">+0 pts</p>` : (correctText ? `<p class="quiz-muted">Respuesta correcta: <b>${esc(correctText)}</b></p>` : '')}
      <div class="quiz-scoreline">
        <span><b>${msg.score}</b> pts</span>
        <span>Posición <b>#${msg.rank}</b> de ${msg.players}</span>
      </div>
      <p class="quiz-muted">Espera la siguiente pregunta…</p>
    </div>`;
  if (ok) countUp(body.querySelector('#quizGain'), msg.gain);
}

function countUp(node, to, ms = 650) {
  if (!node) return;
  const start = performance.now();
  const step = (now) => {
    const p = Math.min(1, (now - start) / ms);
    node.textContent = `+${Math.round(to * p)} pts`;
    if (p < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function renderPodium(msg) {
  show();
  play('podium');
  const medals = ['🥇', '🥈', '🥉'];
  const top = (msg.ranking || []).slice(0, 3);
  const rest = (msg.ranking || []).slice(3, 10);
  const me = mesh.id;
  body.innerHTML = `
    <div class="quiz-box quiz-center">
      <h2 class="quiz-big">🏁 ${esc(msg.title || 'Resultados')}</h2>
      <div class="quiz-podium">
        ${top.map((r, i) => `
          <div class="quiz-pod quiz-pod-${i} ${r.id === me ? 'me' : ''}">
            <div class="quiz-medal">${medals[i]}</div>
            <div class="quiz-pod-name">${esc(r.name)}</div>
            <div class="quiz-pod-score">${r.score}</div>
          </div>`).join('')}
      </div>
      ${rest.length ? `<ol class="quiz-ranklist" start="4">${rest.map((r) => `<li class="${r.id === me ? 'me' : ''}"><span>${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>` : ''}
      <button class="btn primary" id="quizClose" type="button">Cerrar</button>
    </div>`;
  body.querySelector('#quizClose').addEventListener('click', hide);
  confetti(overlay);
}

// ---------- Enrutador de mensajes ----------
function onQuiz(msg) {
  if (hosting) return; // el maestro no ve la pantalla de alumno
  switch (msg.t) {
    case 'quiz:lobby': renderLobby(msg.title, msg.count); break;
    case 'quiz:question': renderQuestion(msg); break;
    case 'quiz:answers': onAnswersCount(msg); break;
    case 'quiz:reveal': onReveal(msg); break;
    case 'quiz:result': renderResult(msg); break;
    case 'quiz:podium': renderPodium(msg); break;
    case 'quiz:cancel': hide(); break;
  }
}

/** Conecta el receptor de mensajes del cuestionario. */
export function initQuizPlayer() {
  mesh.onQuiz = onQuiz;
  // El audio necesita un gesto del usuario para sonar: lo desbloqueamos al primer toque.
  window.addEventListener('pointerdown', unlock, { passive: true });
}
