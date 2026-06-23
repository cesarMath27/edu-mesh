// =============================================================================
//  CUESTIONARIO EN VIVO — panel del MAESTRO (crear + guardar/cargar + controlar)
// -----------------------------------------------------------------------------
//  El maestro escribe las preguntas en el navegador, las GUARDA/CARGA en el nodo,
//  lanza la partida y la controla (siguiente / mostrar respuesta / terminar).
//  Controla por HTTP autenticado; el estado en vivo se consulta con /api/quiz/state.
//  Con sonido y confeti en la pantalla proyectada.
// =============================================================================

import { setHosting } from './quiz-player.js';
import { play, unlock, toggleMuted, isMuted } from './sfx.js';
import { confetti } from './confetti.js';

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
  let lastKey = null;
  let savedList = [];
  const stopPoll = () => { clearInterval(poll); poll = null; };

  const startPoll = () => {
    stopPoll();
    poll = setInterval(async () => {
      let st;
      try { st = await api('/api/quiz/state'); } catch { stopPoll(); return; }
      if (st.state === 'idle') { stopPoll(); setHosting(false); lastKey = null; renderEditor(); return; }
      const key = `${st.state}:${st.current}`;
      if (key !== lastKey) {
        lastKey = key;
        if (st.state === 'question') play('start');
        else if (st.state === 'reveal') play('reveal');
        else if (st.state === 'ended') { play('podium'); setTimeout(() => confetti(container.querySelector('.quiz-host') || container), 60); }
      }
      renderControl(st);
    }, 1200);
  };

  // ---------- Sonido: botón de silencio ----------
  function muteButton() { return `<button class="quiz-mute dark" id="qhMute" type="button" aria-label="Silenciar"></button>`; }
  function bindMute() {
    const b = container.querySelector('#qhMute'); if (!b) return;
    const paint = () => { b.textContent = isMuted() ? '🔇' : '🔊'; };
    paint();
    b.addEventListener('click', () => { toggleMuted(); paint(); unlock(); });
  }

  // ---------- Guardar / cargar ----------
  function fillLoadSelect() {
    const sel = container.querySelector('#qhLoad');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">Cargar guardado…</option>` +
      savedList.map((q) => `<option value="${esc(q.id)}">${esc(q.title)} (${q.count})</option>`).join('');
    if (savedList.some((q) => q.id === cur)) sel.value = cur;
  }
  async function refreshSaved() {
    try { savedList = (await api('/api/quiz/saved')).quizzes || []; fillLoadSelect(); } catch { /* sesión caída */ }
  }
  async function doSave() {
    const status = container.querySelector('#qhStatus');
    try {
      status.textContent = 'Guardando…';
      const r = await api('/api/quiz/save', { id: draft.id, title: draft.title, questions: draft.questions });
      draft.id = r.id;
      status.textContent = `✓ Guardado "${r.title}".`;
      await refreshSaved();
    } catch (e) { status.textContent = '✗ ' + e.message; }
  }
  async function doLoad(id) {
    if (!id) return;
    try { const q = await api('/api/quiz/load?id=' + encodeURIComponent(id)); draft = { id: q.id, title: q.title, questions: q.questions }; renderEditor(); }
    catch (e) { const s = container.querySelector('#qhStatus'); if (s) s.textContent = '✗ ' + e.message; }
  }
  async function doDelete(id) {
    if (!id) return;
    try { await api('/api/quiz/delete', { id }); if (draft && draft.id === id) draft.id = undefined; await refreshSaved(); }
    catch { /* ignore */ }
  }

  // ---------- Editor de preguntas ----------
  function renderEditor() {
    const d = ensureDraft();
    container.innerHTML = `
      <div class="quiz-host">
        <div class="qh-bar">
          <select id="qhLoad" class="qh-time"><option value="">Cargar guardado…</option></select>
          <button class="btn ghost" id="qhSaveBtn" type="button">${icon('i-download')} Guardar</button>
          <button class="qh-del" id="qhDelBtn" type="button" title="Borrar el seleccionado">${icon('i-x')}</button>
          ${muteButton()}
        </div>
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
    container.querySelector('#qhSaveBtn').addEventListener('click', doSave);
    container.querySelector('#qhLoad').addEventListener('change', (e) => doLoad(e.target.value));
    container.querySelector('#qhDelBtn').addEventListener('click', () => doDelete(container.querySelector('#qhLoad').value));
    bindMute();
    bindQuestionEditors();
    fillLoadSelect();
    refreshSaved();
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
    container.querySelectorAll('.qh-time[data-qi]').forEach((s) => s.addEventListener('change', (e) => { d.questions[+e.target.dataset.qi].time = +e.target.value; }));
    container.querySelectorAll('input[type="radio"]').forEach((r) => r.addEventListener('change', (e) => { d.questions[+e.target.dataset.qi].correct = +e.target.dataset.oi; }));
    container.querySelectorAll('.qh-del[data-qi]').forEach((b) => b.addEventListener('click', (e) => {
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
      unlock();
      await api('/api/quiz/start', { title: draft.title, questions: draft.questions });
      setHosting(true);
      lastKey = null;
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
          ${muteButton()}
        </div>
        ${middle}
        ${st.state !== 'ended' ? `<button class="btn ghost" id="cCancel" type="button">Cancelar partida</button>` : ''}
      </div>`;

    bindMute();
    container.querySelector('#cNext')?.addEventListener('click', () => { unlock(); api('/api/quiz/next').catch(() => {}); });
    container.querySelector('#cReveal')?.addEventListener('click', () => api('/api/quiz/reveal').catch(() => {}));
    container.querySelector('#cCancel')?.addEventListener('click', async () => { await api('/api/quiz/cancel').catch(() => {}); setHosting(false); stopPoll(); lastKey = null; renderEditor(); });
    container.querySelector('#cNew')?.addEventListener('click', async () => { await api('/api/quiz/cancel').catch(() => {}); setHosting(false); stopPoll(); lastKey = null; renderEditor(); });
  }

  function scoreboard(list, medals = false) {
    if (!list || !list.length) return '<p class="quiz-muted">Sin puntajes todavía.</p>';
    const m = ['🥇', '🥈', '🥉'];
    return `<ol class="qh-scores">${list.map((r, i) => `<li><span>${medals && i < 3 ? m[i] + ' ' : ''}${esc(r.name)}</span><b>${r.score}</b></li>`).join('')}</ol>`;
  }

  // Arranque: si ya hay una partida en curso (reabrir el panel), retoma el control.
  api('/api/quiz/state')
    .then((st) => { if (st.state && st.state !== 'idle') { setHosting(true); lastKey = `${st.state}:${st.current}`; renderControl(st); startPoll(); } else renderEditor(); })
    .catch(() => renderEditor());

  return { stop: stopPoll };
}
