// =============================================================================
//  edu-mesh · App del catálogo (vanilla JS, sin dependencias)
// =============================================================================

const state = { tree: [], node: null, selected: null };

const $ = (sel, root = document) => root.querySelector(sel);
const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- Tema claro/oscuro ----------
function resolvedDark() {
  const t = document.documentElement.dataset.theme;
  if (t === 'dark') return true;
  if (t === 'light') return false;
  return matchMedia('(prefers-color-scheme: dark)').matches;
}
function initTheme() {
  const saved = localStorage.getItem('edu-theme');
  if (saved) document.documentElement.dataset.theme = saved;
  $('#themeToggle').addEventListener('click', () => {
    const next = resolvedDark() ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('edu-theme', next);
  });
}

// ---------- Carga de datos ----------
async function load() {
  const [node, catalog] = await Promise.all([
    fetch('/api/node').then((r) => r.json()),
    fetch('/api/catalog').then((r) => r.json()),
  ]);
  state.node = node;
  state.tree = catalog.tree;
  renderNode();
  renderTree();
}

function renderNode() {
  $('#nodeName').textContent = state.node.name;
  const activos = state.node.authorities.filter((a) => !a.revoked);
  $('#authCount').textContent = `${activos.length} autoridad${activos.length === 1 ? '' : 'es'}`;
  $('#authChip').title = 'Autoridades de confianza: ' + activos.map((a) => a.label).join(', ');
}

// ---------- Árbol (sidebar) ----------
function renderTree() {
  const nav = $('#tree');
  if (!state.tree.length) { nav.innerHTML = '<p class="muted">El catálogo está vacío.</p>'; return; }
  // Mantener selección si sigue existiendo; si no, la primera materia.
  const exists = state.selected && state.tree.some((e) => e.escuela === state.selected.escuela
    && e.materias.some((m) => m.materia === state.selected.materia));
  if (!exists) state.selected = { escuela: state.tree[0].escuela, materia: state.tree[0].materias[0].materia };

  nav.innerHTML = state.tree.map((e) => `
    <div class="tree-escuela">
      <p class="tree-escuela-title">${icon('i-layers')} ${esc(e.escuela)}</p>
      ${e.materias.map((m) => {
        const on = state.selected.escuela === e.escuela && state.selected.materia === m.materia;
        return `<button class="tree-materia" type="button" aria-current="${on}"
                  data-escuela="${esc(e.escuela)}" data-materia="${esc(m.materia)}">
                  ${icon('i-book')}<span>${esc(m.materia)}</span>
                </button>`;
      }).join('')}
    </div>`).join('');

  nav.querySelectorAll('.tree-materia').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selected = { escuela: btn.dataset.escuela, materia: btn.dataset.materia };
      renderTree();
      renderContent();
    });
  });
  renderContent();
}

// ---------- Contenido (materia seleccionada) ----------
function renderContent() {
  const root = $('#content');
  const escuela = state.tree.find((e) => e.escuela === state.selected.escuela);
  const materia = escuela?.materias.find((m) => m.materia === state.selected.materia);
  if (!materia) { root.innerHTML = ''; return; }

  const nArchivos = materia.lecciones.reduce((s, l) => s + l.archivos.length, 0);
  root.innerHTML = `
    <div class="section-head">
      <h2>${esc(materia.materia)}</h2>
      <p>${esc(escuela.escuela)} · ${materia.lecciones.length} lección(es) · ${nArchivos} archivo(s)</p>
    </div>
    ${materia.lecciones.map((l) => `
      <div class="leccion">
        <h3 class="leccion-title">${icon('i-book')} ${esc(l.leccion)}</h3>
        ${l.archivos.map(cardHtml).join('')}
      </div>`).join('')}`;

  root.querySelectorAll('[data-action="download"]').forEach((btn) =>
    btn.addEventListener('click', () => startDownload(btn.dataset.hash)));
  root.querySelectorAll('[data-action="open"]').forEach((btn) =>
    btn.addEventListener('click', () => window.open(`/api/file?hash=${btn.dataset.hash}`, '_blank')));
}

function badgeHtml(file) {
  if (file.cached) return `<span class="badge ok">${icon('i-check')} En este dispositivo</span>`;
  if (file.estado === 'corrupto') return `<span class="badge bad">${icon('i-alert')} Verificación fallida</span>`;
  return `<span class="badge net">${icon('i-wifi')} Disponible en la red</span>`;
}
function trustHtml(file) {
  return file.autoridadRevocada
    ? `<span class="trust bad">${icon('i-shield-alert')} Firma no confiable (${esc(file.autoridad)})</span>`
    : `<span class="trust ok">${icon('i-shield-check')} Firmado por ${esc(file.autoridad)}</span>`;
}
function actionHtml(file) {
  return file.cached
    ? `<button class="btn primary" type="button" data-action="open" data-hash="${file.hash}">${icon('i-file')} Abrir PDF</button>`
    : `<button class="btn primary" type="button" data-action="download" data-hash="${file.hash}">${icon('i-download')} Descargar de la red</button>`;
}
function cardHtml(file) {
  return `
    <article class="card" id="card-${file.hash}">
      <div class="card-top">
        <div class="file-ic">${icon('i-file')}</div>
        <div class="card-main">
          <p class="card-name">${esc(file.nombre)}</p>
          <div class="card-meta">
            <span>${formatBytes(file.tamano)} · ${file.bloques} bloque(s)</span>
            ${trustHtml(file)}
          </div>
        </div>
        ${badgeHtml(file)}
      </div>
      <div class="actions">${actionHtml(file)}</div>
      <div class="progress" data-progress="${file.hash}">
        <div class="bar"><div class="bar-fill"></div></div>
        <div class="progress-meta"><span class="p-status">Iniciando…</span><span class="p-count"></span></div>
        <div class="seeds"></div>
      </div>
    </article>`;
}

// ---------- Descarga con progreso (SSE) ----------
function startDownload(hash) {
  const card = $(`#card-${CSS.escape(hash)}`);
  const btn = card.querySelector('[data-action="download"]');
  const prog = card.querySelector('[data-progress]');
  const fill = prog.querySelector('.bar-fill');
  const status = prog.querySelector('.p-status');
  const count = prog.querySelector('.p-count');
  const seeds = prog.querySelector('.seeds');

  btn.disabled = true;
  prog.classList.add('show');
  let total = 0;
  const tally = {};
  let finished = false;

  const setBar = (done) => {
    if (!total) return;
    fill.style.width = `${Math.round((done / total) * 100)}%`;
    count.textContent = `bloque ${done}/${total}`;
  };
  const renderSeeds = () => {
    seeds.innerHTML = Object.entries(tally)
      .map(([n, c]) => `<span class="seed-chip">${esc(n)} <b>${c}</b></span>`).join('');
  };

  const es = new EventSource(`/api/download?hash=${encodeURIComponent(hash)}`);
  es.onmessage = (e) => {
    const evt = JSON.parse(e.data);
    switch (evt.type) {
      case 'authenticated': status.textContent = 'Firma de la autoridad verificada…'; break;
      case 'peers': status.textContent = `Compañeros encontrados: ${evt.peers.join(', ')}`; break;
      case 'chunks': total = evt.total; status.textContent = 'Descargando bloques en paralelo…'; setBar(0); break;
      case 'resumed': if (evt.resumed > 0) { status.textContent = `Reanudando (${evt.resumed} ya estaban)…`; setBar(evt.completed); } break;
      case 'block': tally[evt.from] = (tally[evt.from] || 0) + 1; setBar(evt.completed); renderSeeds(); break;
      case 'assembling': status.textContent = 'Ensamblando y verificando integridad…'; break;
      case 'done':
        finished = true; es.close();
        fill.style.width = '100%';
        status.textContent = '✓ Verificado y guardado en este dispositivo';
        setTimeout(refresh, 700);
        break;
      case 'error':
        finished = true; es.close();
        showError(prog, evt.message); btn.disabled = false;
        break;
    }
  };
  es.onerror = () => {
    if (finished) return;
    finished = true; es.close();
    showError(prog, 'Se interrumpió la conexión con la red local.');
    btn.disabled = false;
  };
}

function showError(prog, message) {
  let el = prog.querySelector('.progress-error');
  if (!el) { el = document.createElement('div'); el.className = 'progress-error'; prog.appendChild(el); }
  el.innerHTML = `${icon('i-alert')} ${esc(message)}`;
}

async function refresh() {
  const catalog = await fetch('/api/catalog').then((r) => r.json());
  state.tree = catalog.tree;
  renderContent();
}

initTheme();
load().catch((err) => { $('#content').innerHTML = `<p class="muted">Error al cargar: ${esc(err.message)}</p>`; });
