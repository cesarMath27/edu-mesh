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

    <section class="card quiz-card">
      <h3 class="card-title">${icon('i-board')} Cuestionario en vivo (juego)</h3>
      <p class="muted small">Crea preguntas y juega estilo Kahoot: los alumnos responden desde su celular en tiempo real.</p>
      <div id="quizHostWrap"></div>
    </section>`;

  panel.querySelector('#maestroBack').addEventListener('click', close);
  panel.querySelector('#upBtn').addEventListener('click', () => publish(panel));
  panel.querySelector('#maestroSync').addEventListener('click', () => syncNow(panel));
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
