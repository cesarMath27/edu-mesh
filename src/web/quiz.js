// =============================================================================
//  JUEGO DE CUESTIONARIO EN VIVO  (estilo "Kahoot") — lógica del servidor
// -----------------------------------------------------------------------------
//  Una partida en tiempo real coordinada por el nodo central, montada sobre el
//  MISMO broker WebSocket que ya usa el mesh. El maestro controla la partida por
//  HTTP (autenticado); los alumnos juegan por WebSocket.
//
//  Máquina de estados:  idle → lobby → question ↔ reveal → … → ended
//
//  Mensajes que EMITE a los navegadores (broadcast / por jugador):
//    quiz:lobby    { title, count }                      (a todos: ¡prepárense!)
//    quiz:question { index, total, q, options[], time }  (a todos: ¡a responder!)
//    quiz:answers  { count, players }                    (a todos: cuántos van)
//    quiz:ack      { index }                             (al alumno: recibido)
//    quiz:reveal   { index, total, correct, tally[], scoreboard[] }
//    quiz:result   { answered, correct, gain, score, rank, players }  (por alumno)
//    quiz:podium   { title, ranking[] }                  (a todos: fin + podio)
//    quiz:cancel   {}                                    (a todos: cancelada)
//
//  Puntuación tipo Kahoot: acertar da hasta 1000 pts según la RAPIDEZ (mínimo
//  500 si aciertas justo al final), con un pequeño bono por racha de aciertos.
//  Todo es EFÍMERO (en memoria): la partida no se persiste.
// =============================================================================

const POINTS_MAX = 1000;
const STREAK_BONUS = 50; // por acierto consecutivo (desde el 2º), tope 5

/**
 * @param {object} p
 * @param {(obj:object)=>void} p.broadcast            Envía a TODOS los navegadores.
 * @param {(peerId:string, obj:object)=>void} p.sendTo Envía a un navegador.
 * @param {()=>Array<{id:string,name:string}>} p.getPlayers Jugadores conectados.
 * @param {Function} [p.log]
 */
export function createQuiz({ broadcast, sendTo, getPlayers, log }) {
  let g = null;       // partida actual (o null si idle)
  let timer = null;   // auto-cierre de la pregunta al acabar el tiempo

  const clearTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const nameOf = (pid) => getPlayers().find((p) => p.id === pid)?.name || `Alumno-${pid.slice(0, 4)}`;
  const ranked = () => [...g.scores.entries()]
    .map(([id, s]) => ({ id, name: s.name, score: s.score }))
    .sort((a, b) => b.score - a.score);
  const rankOf = (pid) => { const r = ranked(); const i = r.findIndex((x) => x.id === pid); return i < 0 ? r.length + 1 : i + 1; };

  /** Arranca una partida nueva (entra en "lobby", esperando a empezar). */
  function start({ title, questions }) {
    clearTimer();
    g = {
      title: title || 'Cuestionario',
      questions,
      current: -1,
      state: 'lobby',
      scores: new Map(),    // peerId -> { name, score, streak, lastGain }
      answers: new Map(),   // peerId -> { index, at }
      startedAt: 0,
    };
    broadcast({ t: 'quiz:lobby', title: g.title, count: g.questions.length });
    log?.(`🎯 Cuestionario "${g.title}" creado (${g.questions.length} preguntas).`);
    return hostState();
  }

  /** Pasa a la siguiente pregunta (o termina si ya no hay más). */
  function next() {
    if (!g) return null;
    clearTimer();
    g.current++;
    if (g.current >= g.questions.length) return end();
    g.state = 'question';
    g.answers = new Map();
    g.startedAt = Date.now();
    const q = g.questions[g.current];
    broadcast({ t: 'quiz:question', index: g.current, total: g.questions.length, q: q.q, options: q.options, time: q.time });
    timer = setTimeout(() => reveal(), q.time * 1000 + 250);
    log?.(`▶ Pregunta ${g.current + 1}/${g.questions.length}: ${q.q}`);
    return hostState();
  }

  /** Un alumno responde (solo cuenta la PRIMERA respuesta). */
  function submitAnswer(peerId, index) {
    if (!g || g.state !== 'question' || g.answers.has(peerId)) return;
    const q = g.questions[g.current];
    index = index | 0;
    if (index < 0 || index >= q.options.length) return;
    g.answers.set(peerId, { index, at: Date.now() });
    sendTo(peerId, { t: 'quiz:ack', index });
    broadcast({ t: 'quiz:answers', count: g.answers.size, players: getPlayers().length });
    // Si ya respondieron todos los conectados, cerramos antes de tiempo.
    if (g.answers.size >= getPlayers().length && getPlayers().length > 0) reveal();
  }

  /** Cierra la pregunta, puntúa y revela la respuesta + marcador. */
  function reveal() {
    if (!g || g.state !== 'question') return hostState();
    clearTimer();
    g.state = 'reveal';
    const q = g.questions[g.current];
    const limitMs = q.time * 1000;
    const tally = q.options.map(() => 0);

    for (const p of getPlayers()) {
      const a = g.answers.get(p.id);
      const sc = g.scores.get(p.id) || { name: p.name, score: 0, streak: 0, lastGain: 0 };
      sc.name = p.name;
      if (a) {
        tally[a.index]++;
        if (a.index === q.correct) {
          const taken = Math.max(0, Math.min(limitMs, a.at - g.startedAt));
          const base = Math.round(POINTS_MAX * (1 - (taken / limitMs) / 2)); // 1000…500
          sc.streak += 1;
          const bonus = Math.min(sc.streak - 1, 5) * STREAK_BONUS;
          sc.lastGain = base + bonus;
          sc.score += sc.lastGain;
        } else {
          sc.streak = 0; sc.lastGain = 0;
        }
      } else {
        sc.streak = 0; sc.lastGain = 0; // no respondió
      }
      g.scores.set(p.id, sc);
    }

    const scoreboard = ranked().slice(0, 5);
    broadcast({ t: 'quiz:reveal', index: g.current, total: g.questions.length, correct: q.correct, tally, scoreboard });
    // Resultado personalizado para cada alumno.
    for (const p of getPlayers()) {
      const a = g.answers.get(p.id);
      const sc = g.scores.get(p.id) || { score: 0, lastGain: 0 };
      sendTo(p.id, {
        t: 'quiz:result',
        answered: !!a,
        correct: !!a && a.index === q.correct,
        gain: sc.lastGain || 0,
        score: sc.score || 0,
        rank: rankOf(p.id),
        players: getPlayers().length,
      });
    }
    return hostState();
  }

  /** Termina la partida y muestra el podio. */
  function end() {
    if (!g) return null;
    clearTimer();
    g.state = 'ended';
    const ranking = ranked();
    broadcast({ t: 'quiz:podium', title: g.title, ranking });
    log?.(`🏁 Cuestionario terminado. Ganador: ${ranking[0]?.name || '—'}`);
    return hostState();
  }

  /** Cancela y limpia (vuelve a idle). */
  function cancel() {
    clearTimer();
    g = null;
    broadcast({ t: 'quiz:cancel' });
  }

  /** Estado para la pantalla del maestro (incluye la respuesta correcta). */
  function hostState() {
    if (!g) return { state: 'idle' };
    const base = {
      state: g.state, title: g.title,
      current: g.current, total: g.questions.length,
      answers: g.answers ? g.answers.size : 0,
      players: getPlayers().length,
      scoreboard: g.scores.size ? ranked().slice(0, 8) : [],
    };
    if (g.state === 'question' || g.state === 'reveal') {
      const q = g.questions[g.current];
      Object.assign(base, { q: q.q, options: q.options, correct: q.correct, time: q.time });
    }
    if (g.state === 'ended') base.ranking = ranked();
    return base;
  }

  return { start, next, reveal, end, cancel, submitAnswer, hostState, isActive: () => !!g };
}
