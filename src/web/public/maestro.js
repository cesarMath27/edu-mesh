// =============================================================================
//  MODO MAESTRO (frontend) — ajustes + tablero "¿quién ya lo tiene?" + publicar
// -----------------------------------------------------------------------------
//  Protegido por PIN (se valida en el nodo central). El maestro:
//   - Ve los AJUSTES de la sesión (PIN, enlaces, QR, configuración) — solo si el
//     panel se abre en ESTE equipo (localhost); desde la LAN no se revela el PIN.
//   - Ve los alumnos conectados y cuánto lleva cada quien de cada lección.
//   - Publica un archivo (PDF/video…) que el nodo central firma y distribuye.
//
//  El iniciador abre este panel en la pantalla del maestro con `?maestro=1`, que
//  AUTO-ENTRA usando el PIN local (vía /api/teacher/info, solo loopback).
// =============================================================================

import { initQuizHost } from './quiz-host.js';

const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const token = () => sessionStorage.getItem('edu-token') || '';
let quizHost = null;
let teacherInfo = null; // { pin, settings } cuando el panel corre en este equipo

// Canjea el PIN por un token de sesión (el PIN NO viaja en la URL ni se guarda).
async function login(pinValue) {
  const r = await fetch('/api/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: pinValue }),
  });
  if (r.status === 429) throw new Error('Demasiados intentos. Espera un minuto.');
  if (!r.ok) throw new Error('PIN incorrecto.');
  sessionStorage.setItem('edu-token', (await r.json()).token);
}

// Bootstrap local (solo loopback): trae el PIN y los ajustes de ESTA sesión.
// Devuelve null si el servidor responde 403 (estamos entrando desde la LAN).
async function fetchTeacherInfo() {
  try {
    const r = await fetch('/api/teacher/info');
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// En el equipo del maestro: entra solo, sin teclear el PIN.
async function autoLogin() {
  teacherInfo = await fetchTeacherInfo();
  if (teacherInfo?.pin && !token()) await login(teacherInfo.pin);
  return !!teacherInfo;
}

async function fetchDist() {
  const r = await fetch('/api/distribution', { headers: { Authorization: 'Bearer ' + token() } });
  if (r.status === 401) throw new Error('NO_AUTH');
  return r.json();
}

export function initMaestro() {
  const btn = document.getElementById('maestroBtn');
  const panel = document.getElementById('maestroPanel');
  const layout = document.querySelector('.layout');
  let timer = null;

  const close = () => { clearInterval(timer); quizHost?.stop(); panel.hidden = true; layout.hidden = false; };

  async function openPanel() {
    if (!token()) {
      // 1º intenta entrar solo (equipo del maestro); si no, pide el PIN.
      await autoLogin().catch(() => {});
      if (!token()) {
        const p = prompt('PIN de maestro:');
        if (p === null) return;
        try { await login(p); } catch (e) { alert(e.message); return; }
      }
    } else if (!teacherInfo) {
      teacherInfo = await fetchTeacherInfo(); // por si abrimos el panel ya logueados
    }
    try {
      const data = await fetchDist();
      layout.hidden = true; panel.hidden = false;
      render(panel, data, close);
      clearInterval(timer);
      timer = setInterval(async () => {
        try { renderDashboard(panel.querySelector('#dashWrap'), await fetchDist()); } catch { /* sesión expirada o sin datos */ }
      }, 3000); // el tablero se refresca solo
    } catch (e) {
      if (e.message === 'NO_AUTH') { sessionStorage.removeItem('edu-token'); alert('Sesión expirada. Vuelve a entrar con el PIN.'); }
      else alert(e.message);
    }
  }

  btn.addEventListener('click', openPanel);

  // El iniciador abre la pantalla del maestro con ?maestro=1 → auto-abre el panel.
  if (new URLSearchParams(location.search).get('maestro') === '1') {
    openPanel().catch(() => {});
  }
}

function render(panel, data, close) {
  panel.innerHTML = `
    <div class="maestro-head">
      <h2>${icon('i-board')} Modo Maestro</h2>
      <div class="maestro-head-actions">
        <button class="btn ghost" id="maestroSync" type="button">${icon('i-refresh')} Sincronizar ahora</button>
        <button class="btn ghost" id="maestroBack" type="button">Volver al catálogo</button>
      </div>
    </div>

    ${settingsHtml()}

    <div class="maestro-grid">
      <section class="card">
        <h3 class="card-title">Publicar material</h3>
        <p class="muted small">Se firma en este dispositivo y se distribuye solo.</p>
        <div class="form">
          <label>Archivo (PDF, video, audio…)<input type="file" id="upFile" /></label>
          <label>Escuela<input type="text" id="upEscuela" placeholder="Primaria Benito Juárez" /></label>
          <label>Materia<input type="text" id="upMateria" placeholder="Ciencias Naturales" /></label>
          <label>Lección<input type="text" id="upLeccion" placeholder="La Fotosíntesis" /></label>
          <label>Orden<input type="number" id="upOrden" value="0" min="0" /></label>
          <button class="btn primary" id="upBtn" type="button">${icon('i-download')} Publicar</button>
          <p class="up-status muted small" id="upStatus"></p>
        </div>
      </section>

      <section class="card">
        <h3 class="card-title">¿Quién ya lo tiene?</h3>
        <div id="dashWrap"></div>
      </section>
    </div>

    <section class="card plan-card">
      <h3 class="card-title">${icon('i-layers')} Importar configuración (plan de estudios)</h3>
      <p class="muted small">¿Tu escuela o sistema usa un programa específico? Impórtalo como
        plantilla: arma el <b>esqueleto</b> de materias y lecciones y tú solo subes tu material en cada una.
        <b>No borra</b> lo que ya tengas; mezcla y completa.</p>
      <div class="form plan-form">
        <label>Archivo del plan (.json)<input type="file" id="planFile" accept=".json,application/json" /></label>
        <label class="plan-check"><input type="checkbox" id="planQuizzes" /> Importar también los cuestionarios incluidos</label>
        <div class="plan-actions">
          <button class="btn primary" id="planImportBtn" type="button">${icon('i-download')} Importar plan</button>
          <button class="btn ghost" id="planExportBtn" type="button">${icon('i-file')} Descargar el plan de este equipo</button>
        </div>
        <p class="up-status muted small" id="planStatus"></p>
      </div>
      <div id="planView"><p class="muted small">Cargando planes importados…</p></div>
    </section>

    <section class="card quiz-card">
      <h3 class="card-title">${icon('i-board')} Cuestionario en vivo (juego)</h3>
      <p class="muted small">Crea preguntas y juega estilo Kahoot: los alumnos responden desde su celular en tiempo real.</p>
      <div id="quizHostWrap"></div>
    </section>`;

  panel.querySelector('#maestroBack').addEventListener('click', close);
  panel.querySelector('#upBtn').addEventListener('click', () => publish(panel));
  panel.querySelector('#maestroSync').addEventListener('click', () => syncNow(panel));
  panel.querySelector('#planImportBtn').addEventListener('click', () => importPlanFile(panel));
  panel.querySelector('#planExportBtn').addEventListener('click', () => exportPlan(panel));
  loadPlanView(panel).catch(() => {});
  wireSettings(panel);
  renderDashboard(panel.querySelector('#dashWrap'), data);
  quizHost?.stop();
  quizHost = initQuizHost(panel.querySelector('#quizHostWrap'));
}

// ---- Ajustes del maestro (solo en el equipo del maestro: teacherInfo != null) ----
function settingsHtml() {
  if (!teacherInfo) return '';
  const s = teacherInfo.settings || {};
  const join = s.lan || s.url || '';
  const row = (label, value) => `<div class="set-row"><span class="set-k">${esc(label)}</span><span class="set-v">${esc(value)}</span></div>`;
  return `
    <section class="card settings-card">
      <h3 class="card-title">${icon('i-shield-check')} Ajustes de esta sesión</h3>
      <div class="settings-grid">
        <div class="settings-main">
          <div class="pin-box">
            <span class="muted small">PIN del Modo Maestro</span>
            <div class="pin-row">
              <code class="pin" id="setPin">${esc(teacherInfo.pin)}</code>
              <button class="btn ghost small" id="copyPin" type="button">Copiar</button>
            </div>
            ${teacherInfo.pinIsGenerated ? '<p class="muted small">Generado para esta sesión. Para fijarlo siempre, usa el iniciador o <code>--teacher-pin=TUPIN</code>.</p>' : '<p class="muted small">Compártelo solo con quien deba publicar contenido.</p>'}
          </div>
          <div class="join-box">
            <span class="muted small">Enlace para los celulares (misma WiFi)</span>
            <div class="join-row">
              <code class="join" id="setJoin">${esc(join.replace(/^https?:\/\//, '')) || '— sin red local —'}</code>
              <button class="btn ghost small" id="copyJoin" type="button">Copiar</button>
            </div>
            <button class="btn primary small" id="openQr" type="button">${icon('i-eye')} Abrir pantalla de QR</button>
          </div>
          <div class="set-list">
            ${row('Dispositivo', s.name || '—')}
            ${row('Esta computadora', (s.url || '').replace(/^https?:\/\//, ''))}
            ${row('Cifrado HTTPS (TLS)', s.tls ? 'activado' : 'desactivado')}
            ${row('Sincronización con hub', s.syncFrom ? `${s.syncFrom} (cada ${s.syncIntervalMin} min)` : 'desactivada')}
            ${row('Tamaño máx. al publicar', `${s.maxUploadMb} MB`)}
            ${row('Bloques en paralelo', `${s.serveConcurrency} (cola ${s.serveQueue})`)}
            ${row('Tamaño de bloque', `${s.chunkSizeKiB} KiB`)}
          </div>
        </div>
        <div class="settings-qr">
          <img alt="QR de ingreso" src="/api/qr.svg?t=${Date.now()}" />
          <span class="muted small">Escanéalo para entrar</span>
        </div>
      </div>
    </section>`;
}

function wireSettings(panel) {
  if (!teacherInfo) return;
  const copy = (text, btn) => {
    navigator.clipboard?.writeText(text).then(() => {
      const old = btn.textContent; btn.textContent = '✓ Copiado';
      setTimeout(() => { btn.textContent = old; }, 1200);
    }).catch(() => {});
  };
  panel.querySelector('#copyPin')?.addEventListener('click', (e) => copy(teacherInfo.pin, e.currentTarget));
  panel.querySelector('#copyJoin')?.addEventListener('click', (e) => copy(teacherInfo.settings?.lan || teacherInfo.settings?.url || '', e.currentTarget));
  panel.querySelector('#openQr')?.addEventListener('click', () => window.open('/qr.html', 'edu-mesh-qr'));
}

// Fuerza una sincronización con el hub ahora mismo (el avance se ve en el chip "sync").
async function syncNow(panel) {
  const btn = panel.querySelector('#maestroSync');
  btn.disabled = true;
  try {
    const r = await fetch('/api/sync/now', { method: 'POST', headers: { Authorization: 'Bearer ' + token() } });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) { sessionStorage.removeItem('edu-token'); alert('Sesión expirada. Vuelve a entrar con el PIN.'); }
    else if (!r.ok) alert(j.error || 'No se pudo sincronizar.');
    else alert('Sincronización iniciada. El catálogo se actualizará solo cuando llegue contenido nuevo.');
  } catch (e) {
    alert(e.message);
  } finally {
    btn.disabled = false;
  }
}

async function publish(panel) {
  const file = panel.querySelector('#upFile').files[0];
  const status = panel.querySelector('#upStatus');
  if (!file) { status.textContent = 'Elige un archivo primero.'; return; }
  const params = new URLSearchParams({
    nombre: file.name,
    escuela: panel.querySelector('#upEscuela').value || 'Sin escuela',
    materia: panel.querySelector('#upMateria').value || 'General',
    leccion: panel.querySelector('#upLeccion').value || 'Sin lección',
    orden: panel.querySelector('#upOrden').value || '0',
    mime: file.type || 'application/octet-stream',
  });
  const btn = panel.querySelector('#upBtn');
  btn.disabled = true; status.textContent = `Subiendo y firmando "${file.name}"…`;
  try {
    const r = await fetch('/api/upload?' + params.toString(), {
      method: 'POST', headers: { Authorization: 'Bearer ' + token() }, body: file,
    });
    const j = await r.json();
    if (j.ok) {
      status.textContent = `✓ Publicado y firmado (${(j.size / 1048576).toFixed(2)} MB).`;
      panel.querySelector('#upFile').value = '';
      window.dispatchEvent(new Event('catalog-changed')); // refresca el catálogo de los alumnos/app
      try { renderDashboard(panel.querySelector('#dashWrap'), await fetchDist()); } catch { /* ignore */ }
    } else {
      status.textContent = '✗ ' + (j.error || 'no se pudo publicar');
    }
  } catch (e) {
    status.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// ---- Plan de estudios (importar/exportar una configuración externa) ----

const authHeader = () => ({ Authorization: 'Bearer ' + token() });

// Si la sesión expiró, limpia el token y avisa (mismo trato que el resto del panel).
function handleAuthExpired(r) {
  if (r.status === 401) { sessionStorage.removeItem('edu-token'); alert('Sesión expirada. Vuelve a entrar con el PIN.'); return true; }
  return false;
}

// Lee el archivo que eligió el maestro y lo envía al nodo para importarlo.
async function importPlanFile(panel) {
  const input = panel.querySelector('#planFile');
  const status = panel.querySelector('#planStatus');
  const file = input.files[0];
  if (!file) { status.textContent = 'Elige primero un archivo de plan (.json).'; return; }
  let plan;
  try { plan = JSON.parse(await file.text()); }
  catch { status.textContent = '✗ El archivo no es un JSON válido.'; return; }

  const btn = panel.querySelector('#planImportBtn');
  btn.disabled = true; status.textContent = `Importando "${file.name}"…`;
  try {
    const r = await fetch('/api/teacher/plan/import', {
      method: 'POST',
      headers: { ...authHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, importarCuestionarios: panel.querySelector('#planQuizzes').checked }),
    });
    if (handleAuthExpired(r)) return;
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { status.textContent = '✗ ' + (j.error || 'no se pudo importar'); return; }
    const s = j.resumen || {};
    const extra = s.cuestionarios ? `, ${s.cuestionarios} cuestionario(s)` : '';
    status.textContent = `✓ Plan importado: ${s.materias} materia(s), ${s.lecciones} lección(es) (${s.leccionesNuevas} nueva(s))${extra}.`;
    input.value = '';
    window.dispatchEvent(new Event('catalog-changed')); // refresca el catálogo de los alumnos/app
    await loadPlanView(panel);
  } catch (e) {
    status.textContent = '✗ ' + e.message;
  } finally {
    btn.disabled = false;
  }
}

// Descarga el catálogo de ESTE equipo como plan (plantilla) para compartirlo.
async function exportPlan(panel) {
  const status = panel.querySelector('#planStatus');
  try {
    const r = await fetch('/api/teacher/plan/export', { headers: authHeader() });
    if (handleAuthExpired(r)) return;
    if (!r.ok) { status.textContent = '✗ No se pudo exportar el plan.'; return; }
    const blob = await r.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'plan-edu-mesh.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    status.textContent = '✓ Plan descargado. Compártelo para que otro maestro lo importe.';
  } catch (e) {
    status.textContent = '✗ ' + e.message;
  }
}

// Carga la lista de planes importados y muestra el seleccionado (o el más reciente).
async function loadPlanView(panel, selectedId) {
  const wrap = panel.querySelector('#planView');
  if (!wrap) return;
  let plans = [];
  try {
    const r = await fetch('/api/teacher/plan/list', { headers: authHeader() });
    if (handleAuthExpired(r)) return;
    plans = (await r.json()).plans || [];
  } catch { wrap.innerHTML = ''; return; }

  if (!plans.length) {
    wrap.innerHTML = '<p class="muted small">Todavía no has importado ningún plan. Cuando importes uno, aquí verás sus materias y lecciones, y qué falta por llenar de material.</p>';
    return;
  }
  const id = selectedId || plans[0].id;
  let plan = null;
  try {
    const r = await fetch('/api/teacher/plan/get?id=' + encodeURIComponent(id), { headers: authHeader() });
    if (handleAuthExpired(r)) return;
    if (r.ok) plan = (await r.json()).plan;
  } catch { /* sin datos */ }

  const selector = plans.length > 1
    ? `<label class="plan-select muted small">Plan activo
        <select id="planPick">${plans.map((p) => `<option value="${esc(p.id)}" ${p.id === id ? 'selected' : ''}>${esc(p.nombre)} · ${p.lecciones} lección(es)</option>`).join('')}</select>
      </label>` : '';

  wrap.innerHTML = `<div class="plan-head">${selector}</div><div id="planTree"></div>`;
  if (plans.length > 1) {
    wrap.querySelector('#planPick').addEventListener('change', (e) => loadPlanView(panel, e.target.value));
  }
  renderPlanTree(wrap.querySelector('#planTree'), plan, panel, id);
}

// Dibuja el "esqueleto" del plan: materias → lecciones, con su estado y un botón
// que prerrellena "Publicar material" para que el maestro solo arrastre el archivo.
function renderPlanTree(wrap, plan, panel, id) {
  if (!plan) { wrap.innerHTML = '<p class="muted small">No se pudo cargar el plan.</p>'; return; }
  const pr = plan.progreso || { lecciones: 0, conMaterial: 0 };
  const pct = pr.lecciones ? Math.round((pr.conMaterial / pr.lecciones) * 100) : 0;

  const mats = [];
  for (const e of plan.escuelas || []) {
    for (const m of e.materias || []) {
      const lecs = (m.lecciones || []).map((l) => {
        const badge = l.tieneMaterial
          ? `<span class="badge ok">${icon('i-check')} con material</span>`
          : '<span class="badge bad">falta material</span>';
        const recur = l.recursos?.length
          ? `<span class="plan-rec muted small" title="Recursos sugeridos">· sugeridos: ${esc(l.recursos.map((r) => r.nombre).join(', '))}</span>` : '';
        const btn = l.tieneMaterial ? ''
          : `<button class="btn ghost small plan-add" type="button"
               data-esc="${esc(e.nombre)}" data-mat="${esc(m.nombre)}" data-lec="${esc(l.titulo)}" data-ord="${l.orden || 0}">＋ Material</button>`;
        return `<li class="plan-lec">
            <span class="plan-lec-name">${esc(l.titulo)}${l.descripcion ? ` <em class="muted">— ${esc(l.descripcion)}</em>` : ''} ${recur}</span>
            <span class="plan-lec-end">${badge}${btn}</span>
          </li>`;
      }).join('');
      mats.push(`<div class="plan-mat">
          <h4 class="plan-mat-title">${esc(m.nombre)}${m.grado ? ` <span class="muted small">(${esc(m.grado)})</span>` : ''} <span class="muted small">· ${esc(e.nombre)}</span></h4>
          <ul class="plan-lec-list">${lecs || '<li class="muted small">Sin lecciones.</li>'}</ul>
        </div>`);
    }
  }

  wrap.innerHTML = `
    <div class="plan-progress">
      <span class="muted small">${plan.nombre}${plan.fuente ? ` · ${esc(plan.fuente)}` : ''}</span>
      <span class="rb"><span class="rb-fill" style="width:${pct}%"></span></span>
      <span class="rc">${pr.conMaterial}/${pr.lecciones} con material</span>
      <button class="btn ghost small plan-del" type="button" data-id="${esc(id)}" title="Quitar este plan del panel (no borra tu material)">${icon('i-x')} Quitar</button>
    </div>
    ${mats.join('') || '<p class="muted small">Este plan no tiene materias.</p>'}`;

  // Prerrellena el formulario de "Publicar material" y baja hasta él.
  wrap.querySelectorAll('.plan-add').forEach((b) => b.addEventListener('click', () => {
    panel.querySelector('#upEscuela').value = b.dataset.esc;
    panel.querySelector('#upMateria').value = b.dataset.mat;
    panel.querySelector('#upLeccion').value = b.dataset.lec;
    panel.querySelector('#upOrden').value = b.dataset.ord || '0';
    const status = panel.querySelector('#upStatus');
    if (status) status.textContent = `Listo para subir material de "${b.dataset.lec}". Elige el archivo y pulsa Publicar.`;
    const fileInput = panel.querySelector('#upFile');
    fileInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => fileInput.focus(), 300);
  }));
  wrap.querySelector('.plan-del')?.addEventListener('click', async (e) => {
    if (!confirm('¿Quitar este plan del panel? Tu material publicado NO se borra.')) return;
    try {
      const r = await fetch('/api/teacher/plan/delete', {
        method: 'POST', headers: { ...authHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: e.currentTarget.dataset.id }),
      });
      if (handleAuthExpired(r)) return;
      await loadPlanView(panel);
    } catch { /* ignore */ }
  });
}

function renderDashboard(wrap, data) {
  const { alumnos, catalogo } = data;
  if (!alumnos.length) { wrap.innerHTML = '<p class="muted">Aún no hay alumnos conectados.</p>'; return; }

  const cell = (a, f) => {
    const p = a.files[f.hash];
    if (p && p.total > 0 && p.have >= p.total) return '<td class="ok">✓</td>';
    if (p && p.have > 0) return `<td class="part">${p.have}/${p.total}</td>`;
    return '<td class="none">—</td>';
  };
  const completos = (f) => alumnos.filter((a) => { const p = a.files[f.hash]; return p && p.total > 0 && p.have >= p.total; }).length;

  wrap.innerHTML = `
    <p class="muted small">${alumnos.length} alumno(s) conectado(s).</p>
    <div class="resumen">
      ${catalogo.map((f) => {
        const n = completos(f); const pct = Math.round((n / alumnos.length) * 100);
        return `<div class="resumen-row">
          <span class="rn">${esc(f.nombre)} <em>${esc(f.materia)} · ${esc(f.leccion)}</em></span>
          <span class="rb"><span class="rb-fill" style="width:${pct}%"></span></span>
          <span class="rc">${n}/${alumnos.length}</span>
        </div>`;
      }).join('')}
    </div>
    <div class="tabla-scroll">
      <table class="dash">
        <thead><tr><th>Alumno</th>${catalogo.map((f) => `<th title="${esc(f.materia)} · ${esc(f.leccion)}">${esc(f.nombre)}</th>`).join('')}</tr></thead>
        <tbody>
          ${alumnos.map((a) => `<tr><th>${esc(a.name)}</th>${catalogo.map((f) => cell(a, f)).join('')}</tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}
