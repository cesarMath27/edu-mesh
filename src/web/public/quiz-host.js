// =============================================================================
//  CUESTIONARIO EN VIVO — panel del MAESTRO (crear + controlar la partida)
// -----------------------------------------------------------------------------
//  El maestro escribe las preguntas en el navegador, lanza la partida y la
//  controla (siguiente / mostrar respuesta / terminar). Controla por HTTP
//  autenticado; el estado en vivo se consulta con /api/quiz/state.
// =============================================================================

import { setHosting } from './quiz-player.js';

const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const token = () => sessionStorage.getItem('edu-token') || '';
const SHAPES = ['▲', '◆', '●', '■'];
const COLORS = ['#e21b3c', '#1368ce', '#d89e00', '#26890c'];

// Borrador en memoria (sobrevive a cerrar/abrir el panel mientras no se recargue).
let draft = null;
const blankQuestion = () => ({ q: '', options: ['', '', '', ''], correct: 0, time: 20 });
const ensureDraft = () => { if (!draft) draft = { title: '', questions: [blankQuestion()] }; return draft; };

async function api(path, body) {
  const r = await fetch(path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token(), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `error ${r.status}`);
  return j;
}

export function initQuizHost(container) {
  let poll = null;
  const stopPoll = () => { clearInterval(poll); poll = null; };

  const startPoll = () => {
    stopPoll();
    poll = setInterval(async () => {
      try { const st = await api('/api/quiz/state'); if (st.state === 'idle') { stopPoll(); setHosting(false); renderEditor(); } else renderControl(st); }
      catch { /* sesión caída: detén el sondeo */ stopPoll(); }
    }, 1200);
  };

  // ---------- Editor de preguntas ----------
  function renderEditor() {
    const d = ensureDraft();
    container.innerHTML = `
      <div class="quiz-host">
        <label class="qh-title">Título del cuestionario
          <input type="text" id="qhTitle" maxlength="80" placeholder="Repaso de Ciencias" value="${esc(d.title)}">
        </label>
        <div id="qhList">${d.questions.map(questionEditor).join('')}</div>
        <div class="qh-actions">
          <button class="btn ghost" id="qhAdd" type="button">+ Agregar pregunta</button>
          <button class="btn primary" id="qhLaunch" type="button">${icon('i-board')} Lanzar partida</button>
        </div>
        <p class="up-status muted small" id="qhStatus"></p>
      </div>`;

    container.querySelector('#qhTitle').addEventListener('input', (e) => { d.title = e.target.value; });
    container.querySelector('#qhAdd').addEventListener('click', () => { d.questions.push(blankQuestion()); renderEditor(); });
    container.querySelector('#qhLaunch').addEventListener('click', launch);
    bindQuestionEditors();
  }

  function questionEditor(q, qi) {
    return `
      <div class="qh-q" data-qi="${qi}">
        <div class="qh-q-head">
          <span class="qh-qnum">Pregunta ${qi + 1}</span>
          <select class="qh-time" data-qi="${qi}" title="Segundos para responder">
            ${[10, 15, 20, 30, 45, 60].map((s) => `<option value="${s}" ${q.time === s ? 'selected' : ''}>${s}s</option>`).join('')}
          </select>
          <button class="qh-del" data-qi="${qi}" type="button" title="Quitar pregunta">${icon('i-x')}</button>
        </div>
        <input class="qh-qtext" data-qi="${qi}" type="text" maxlength="300" placeholder="Escribe la pregunta…" value="${esc(q.q)}">
        <div class="qh-opts">
          ${q.options.map((opt, oi) => `
            <div class="qh-opt" style="--tile:${COLORS[oi]}">
              <span class="qh-shape">${SHAPES[oi]}</span>
              <input class="qh-otext" data-qi="${qi}" data-oi="${oi}" type="text" maxlength="120" placeholder="Opción ${oi + 1}" value="${esc(opt)}">
              <label class="qh-correct" title="Marcar como correcta">
                <input type="radio" name="correct-${qi}" data-qi="${qi}" data-oi="${oi}" ${q.correct === oi ? 'checked' : ''}> correcta
              </label>
              ${q.options.length > 2 ? `<button class="qh-delopt" data-qi="${qi}" data-oi="${oi}" type="button" title="Quitar opción">${icon('i-x')}</button>` : ''}
            </div>`).join('')}
        </div>
        ${q.options.length < 4 ? `<button class="qh-addopt" data-qi="${qi}" type="button">+ Opción</button>` : ''}
      </div>`;
  }

  function bindQuestionEditors() {
    const d = draft;
    container.querySelectorAll('.qh-qtext').forEach((i) => i.addEventListener('input', (e) => { d.questions[+e.target.dataset.qi].q = e.target.value; }));
    container.querySelectorAll('.qh-otext').forEach((i) => i.addEventListener('input', (e) => { d.questions[+e.target.dataset.qi].options[+e.target.dataset.oi] = e.target.value; }));
    container.querySelectorAll('.qh-time').forEach((s) => s.addEventListener('change', (e) => { d.questions[+e.target.dataset.qi].time = +e.target.value; }));
    container.querySelectorAll('input[type="radio"]').forEach((r) => r.addEventListener('change', (e) => { d.questions[+e.target.dataset.qi].correct = +e.target.dataset.oi; }));
    container.querySelectorAll('.qh-del').forEach((b) => b.addEventListener('click', (e) => {
      const qi = +e.currentTarget.dataset.qi;
      if (d.questions.length > 1) d.questions.splice(qi, 1); renderEditor();
    }));
    container.querySelectorAll('.qh-addopt').forEach((b) => b.addEventListener('click', (e) => {
      const q = d.questions[+e.currentTarget.dataset.qi]; if (q.options.length < 4) q.options.push(''); renderEditor();
    }));
    container.querySelectorAll('.qh-delopt').forEach((b) => b.addEventListener('click', (e) => {
      const qi = +e.currentTarget.dataset.qi; const oi = +e.currentTarget.dataset.oi; const q = d.questions[qi];
      if (q.options.length > 2) { q.options.splice(oi, 1); if (q.correct >= q.options.length) q.correct = 0; }
      renderEditor();
    }));
  }

  async function launch() {
    const status = container.querySelector('#qhStatus');
    try {
      status.textContent = 'Lanzando partida…';
      await api('/api/quiz/start', draft);
      setHosting(true);
      startPoll();
    } catch (e) {
      status.textContent = '✗ ' + e.message;
    }
  }

  // ---------- Control de la partida en vivo ----------
  function renderControl(st) {
    const last = st.current + 1 >= st.total;
    let middle = '';
    if (st.state === 'lobby') {
      middle = `<p class="quiz-muted">Sala lista · <b>${st.total}</b> pregunta(s) · <b>${st.players}</b> alumno(s) conectado(s).</p>
        <button class="btn primary" id="cNext" type="button">Empezar ▶</button>`;
    } else if (st.state === 'question') {
      middle = `
        <p class="qh-live-q">${esc(st.q)}</p>
        <div class="qh-live-opts">${st.options.map((o, i) => `<span class="qh-live-opt ${i === st.correct ? 'ok' : ''}" style="--tile:${COLORS[i]}">${SHAPES[i]} ${esc(o)}</span>`).join('')}</div>
        <p class="quiz-muted">Respondieron <b>${st.answers}</b> de <b>${st.players}</b></p>
        <button class="btn primary" id="cReveal" type="button">Mostrar respuesta</button>`;
    } else if (st.state === 'reveal') {
      middle = `
        <p class="quiz-muted">Respuesta correcta: <b>${esc(st.options[st.correct])}</b></p>
        ${scoreboard(st.scoreboard)}
        <button class="btn primary" id="cNext" type="button">${last ? 'Terminar y ver podio 🏁' : 'Siguiente pregunta ▶'}</button>`;
    } else if (st.state === 'ended') {
      middle = `<h3 class="card-title">🏁 Resultados</h3>${scoreboard(st.ranking, true)}
        <button class="btn primary" id="cNew" type="button">Nuevo cuestionario</button>`;
    }

    container.innerHTML = `
      <div class="quiz-host">
        <div class="qh-live-head">
          <span class="qh-qnum">${esc(st.title)}</span>
          ${st.state !== 'ended' ? `<span class="quiz-pill">${st.state === 'lobby' ? 'En sala' : `Pregunta ${st.current + 1}/${st.total}`}</span>` : ''}
        </div>
        ${middle}
        ${st.state !== 'ended' ? `<button class="btn ghost" id="cCancel" type="button">Cancelar partida</button>` : ''}
      </div>`;

    container.querySelector('#cNext')?.addEventListener('click', () => api('/api/quiz/next').catch(() => {}));
    container.querySelector('#cReveal')?.addEventListener('click', () => api('/api/quiz/reveal').catch(() => {}));
    container.querySelector('#cCancel')?.addEventListener('click', async () => { await api('/api/quiz/cancel').catch(() => {}); setHosting(false); stopPoll(); renderEditor(); });
    container.querySelector('#cNew')?.addEventListener('click', async () => { await api('/api/quiz/cancel').catch(() => {}); setHosting(false); stopPoll(); renderEditor(); });
  }

  function scoreboard(list, medals = false) {
    if (!list || !list.length) return '<p class="quiz-muted">Sin puntajes todavía.</p>';
    const m = ['🥇', '🥈', '🥉'];
    return `<ol class="qh-scores">${list.map((r, i) => `<li><span>${medals && i < 3 ? m[i] + ' ' : ''}${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>`;
  }

  // Arranque: si ya hay una partida en curso (reabrir el panel), retoma el control.
  api('/api/quiz/state')
    .then((st) => { if (st.state && st.state !== 'idle') { setHosting(true); renderControl(st); startPoll(); } else renderEditor(); })
    .catch(() => renderEditor());

  return { stop: stopPoll };
}
