// =============================================================================
//  edu-mesh · App del catálogo (módulo) — descarga en el NAVEGADOR (mesh WebRTC)
// -----------------------------------------------------------------------------
//  El celular descarga por bloques desde compañeros (WebRTC) o del nodo central
//  (HTTP de respaldo), verifica cada bloque, lo guarda en IndexedDB y se vuelve
//  seeder. La disponibilidad de cada archivo se mide en ESTE navegador.
// =============================================================================

import { mesh, ensureMesh, downloadFile, localAvailability, announceLocal, assembleBlob } from './download.js';
import { initMaestro } from './maestro.js';
import { verifyFileRecord } from './verify-sig.js';
import { openPreview } from './preview.js';

const state = { tree: [], node: null, selected: null, avail: {}, verified: {}, authIdx: {} };

const $ = (sel, root = document) => root.querySelector(sel);
const icon = (id) => `<svg class="ic" aria-hidden="true"><use href="#${id}"/></svg>`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

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

// ---------- Indicador de compañeros conectados (mesh) ----------
let peersEl;
function initPeersChip() {
  peersEl = document.createElement('span');
  peersEl.className = 'node-chip';
  peersEl.title = 'Compañeros conectados al mesh';
  peersEl.innerHTML = `${icon('i-wifi')} <span id="peerCount">malla: 0</span>`;
  $('.appbar-right').prepend(peersEl);
  mesh.onPeers = (n) => { const c = $('#peerCount'); if (c) c.textContent = `malla: ${n}`; };
}

// ---------- Indicador de sincronización automática (con el hub) ----------
//  Muestra el estado del hub y, además, detecta contenido nuevo (catalogVersion)
//  para refrescar el catálogo solo —tanto si llegó por sync como si el maestro
//  publicó algo desde otro dispositivo.
let lastCatalogVersion = null;
function timeAgo(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'recién';
  const m = Math.floor(s / 60);
  return m < 60 ? `hace ${m} min` : `hace ${Math.floor(m / 60)} h`;
}
function initSyncStatus() {
  const chip = document.createElement('span');
  chip.className = 'node-chip sync-chip';
  chip.hidden = true;
  chip.innerHTML = `${icon('i-refresh')} <span id="syncText">sync</span>`;
  $('.appbar-right').prepend(chip);
  const text = chip.querySelector('#syncText');

  const poll = async () => {
    let s;
    try { s = await fetch('/api/sync/status').then((r) => r.json()); } catch { return; }
    // Refresca el catálogo si cambió la versión (sync nuevo o publicación remota).
    if (lastCatalogVersion === null) lastCatalogVersion = s.catalogVersion;
    else if (s.catalogVersion !== lastCatalogVersion) {
      lastCatalogVersion = s.catalogVersion;
      reloadCatalog().catch(() => {});
    }
    if (!s.enabled) { chip.hidden = true; return; }
    chip.hidden = false;
    chip.classList.toggle('spin', !!s.running);
    if (s.running) text.textContent = 'sincronizando…';
    else if (s.error) text.textContent = 'sync: error';
    else text.textContent = s.lastSyncAt ? `sync ${timeAgo(s.lastSyncAt)}` : 'sync activo';
    chip.title = s.error
      ? `Última sincronización falló: ${s.error}`
      : `Sincroniza automáticamente con ${s.from} (cada ${s.intervalMin} min)`;
  };
  poll();
  setInterval(poll, 15000);
}

// ---------- Carga ----------
const flatFiles = () => state.tree.flatMap((e) => e.materias).flatMap((m) => m.lecciones).flatMap((l) => l.archivos);
const findFile = (hash) => flatFiles().find((f) => f.hash === hash);

async function load() {
  await ensureMesh(); // conecta al broker de señalización
  // Nombre del alumno (para el tablero del maestro). Se guarda local.
  const name = localStorage.getItem('edu-name') || (`Alumno-${Math.random().toString(36).slice(2, 6)}`);
  localStorage.setItem('edu-name', name);
  mesh.hello(name);

  const [node, catalog] = await Promise.all([
    fetch('/api/node').then((r) => r.json()),
    fetch('/api/catalog').then((r) => r.json()),
  ]);
  state.node = node;
  state.tree = catalog.tree;
  renderNode();
  buildAuthIndex();
  verifyAll();                   // verifica las firmas Ed25519 en ESTE navegador
  await refreshAvailability();   // qué tengo ya en ESTE navegador
  for (const f of flatFiles()) {
    announceLocal(f.hash);                                   // sirvo lo que tenga
    const av = await localAvailability(f.hash, f.bloques);
    mesh.progress(f.hash, av.have, av.total);                // reporto avance al tablero
  }
  renderTree();
}

// Recarga el catálogo completo (p.ej. cuando el maestro publica algo nuevo).
async function reloadCatalog() {
  const catalog = await fetch('/api/catalog').then((r) => r.json());
  state.tree = catalog.tree;
  verifyAll();
  await refreshAvailability();
  renderTree();
}

function renderNode() {
  $('#nodeName').textContent = state.node.name;
  const activos = state.node.authorities.filter((a) => !a.revoked);
  $('#authCount').textContent = `${activos.length} autoridad${activos.length === 1 ? '' : 'es'}`;
  $('#authChip').title = 'Autoridades de confianza: ' + activos.map((a) => a.label).join(', ');
}

async function refreshAvailability() {
  for (const f of flatFiles()) state.avail[f.hash] = (await localAvailability(f.hash, f.bloques)).complete;
}

// ---------- Verificación de firmas Ed25519 (en el navegador, con TweetNaCl) ----------
function buildAuthIndex() {
  state.authIdx = Object.fromEntries((state.node.authorities || []).map((a) => [a.keyId, { publicKey: a.publicKey, revoked: a.revoked }]));
}
function verifyAll() {
  for (const f of flatFiles()) state.verified[f.hash] = verifyFileRecord(f, state.authIdx);
}

// ---------- Árbol (sidebar) ----------
function renderTree() {
  const nav = $('#tree');
  if (!state.tree.length) { nav.innerHTML = '<p class="muted">El catálogo está vacío.</p>'; return; }
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
                  ${icon('i-book')}<span>${esc(m.materia)}</span></button>`;
      }).join('')}
    </div>`).join('');

  nav.querySelectorAll('.tree-materia').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selected = { escuela: btn.dataset.escuela, materia: btn.dataset.materia };
      renderTree();
    });
  });
  renderContent();
}

// ---------- Contenido ----------
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

  root.querySelectorAll('[data-action="download"]').forEach((b) => b.addEventListener('click', () => startDownload(b.dataset.hash)));
  root.querySelectorAll('[data-action="open"]').forEach((b) => b.addEventListener('click', () => openFile(b.dataset.hash)));
  root.querySelectorAll('[data-action="preview"]').forEach((b) => b.addEventListener('click', () =>
    openPreview(findFile(b.dataset.hash), { onDownload: () => startDownload(b.dataset.hash) })));
}

function badgeHtml(file) {
  if (state.avail[file.hash]) return `<span class="badge ok">${icon('i-check')} En este dispositivo</span>`;
  return `<span class="badge net">${icon('i-wifi')} Disponible en la red</span>`;
}
function trustHtml(file) {
  return state.verified[file.hash]
    ? `<span class="trust ok">${icon('i-shield-check')} Firma verificada · ${esc(file.autoridad)}</span>`
    : `<span class="trust bad">${icon('i-shield-alert')} Firma NO válida o autoridad no confiable</span>`;
}
function actionHtml(file) {
  // Sin firma válida verificada en el navegador, no se permite descargar ni abrir.
  if (!state.verified[file.hash]) {
    return `<span class="trust bad">${icon('i-alert')} Bloqueado por seguridad: firma no válida</span>`;
  }
  // "Vista previa" (ver por bloques, sin descargar todo) disponible siempre.
  const preview = `<button class="btn ghost" type="button" data-action="preview" data-hash="${file.hash}">${icon('i-eye')} Vista previa</button>`;
  return state.avail[file.hash]
    ? `<button class="btn primary" type="button" data-action="open" data-hash="${file.hash}">${icon('i-file')} Abrir PDF</button>
       ${preview}
       <span class="seed-chip" title="Compartiendo con tus compañeros">${icon('i-wifi')} Compartiendo</span>`
    : `<button class="btn primary" type="button" data-action="download" data-hash="${file.hash}">${icon('i-download')} Descargar de la red</button>
       ${preview}`;
}
function cardHtml(file) {
  return `
    <article class="card" id="card-${file.hash}">
      <div class="card-top">
        <div class="file-ic">${icon('i-file')}</div>
        <div class="card-main">
          <p class="card-name">${esc(file.nombre)}</p>
          <div class="card-meta"><span>${formatBytes(file.tamano)} · ${file.bloques} bloque(s)</span>${trustHtml(file)}</div>
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

// ---------- Descarga en el navegador ----------
async function startDownload(hash) {
  if (!state.verified[hash]) { alert('Firma no válida: descarga bloqueada por seguridad.'); return; }
  const file = findFile(hash);
  const card = $(`#card-${CSS.escape(hash)}`);
  const btn = card.querySelector('[data-action="download"]');
  const prog = card.querySelector('[data-progress]');
  const fill = prog.querySelector('.bar-fill');
  const status = prog.querySelector('.p-status');
  const count = prog.querySelector('.p-count');
  const seeds = prog.querySelector('.seeds');

  btn.disabled = true;
  prog.classList.add('show');
  status.textContent = 'Buscando bloques en la red local…';

  const onProgress = (evt) => {
    if (evt.type === 'chunks') { count.textContent = `bloque ${evt.completed}/${evt.total}`; }
    if (evt.type === 'chunk') {
      fill.style.width = `${Math.round((evt.completed / evt.total) * 100)}%`;
      count.textContent = `bloque ${evt.completed}/${evt.total}`;
      status.textContent = 'Descargando bloques…';
      seeds.innerHTML =
        `<span class="seed-chip">${icon('i-wifi')} de compañeros <b>${evt.stats.peer}</b></span>` +
        `<span class="seed-chip">${icon('i-layers')} del central <b>${evt.stats.central}</b></span>`;
    }
    if (evt.type === 'done') {
      fill.style.width = '100%';
      status.textContent = '✓ Verificado y guardado en este dispositivo';
    }
  };

  try {
    await downloadFile(hash, file.mime, onProgress);
    state.avail[hash] = true;
    setTimeout(renderContent, 600); // refresca la card a "Abrir / Compartiendo"
  } catch (err) {
    showError(prog, err.message);
    btn.disabled = false;
  }
}

async function openFile(hash) {
  const file = findFile(hash);
  try {
    const blob = await assembleBlob(hash, file.bloques, file.mime);
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    alert('No se pudo abrir: ' + err.message);
  }
}

function showError(prog, message) {
  let el = prog.querySelector('.progress-error');
  if (!el) { el = document.createElement('div'); el.className = 'progress-error'; prog.appendChild(el); }
  el.innerHTML = `${icon('i-alert')} ${esc(message)}`;
}

initTheme();
initPeersChip();
initSyncStatus();
initMaestro();
window.addEventListener('catalog-changed', () => reloadCatalog().catch(() => {}));
load().catch((err) => { $('#content').innerHTML = `<p class="muted">Error al cargar: ${esc(err.message)}</p>`; });
