// =============================================================================
//  SINCRONIZACIÓN AUTOMÁTICA  — el nodo se mantiene al día con el hub, solo
// -----------------------------------------------------------------------------
//  Programa una sincronización periódica contra el hub en línea:
//   - Una primera pasada poco después de arrancar (sin bloquear el boot).
//   - Luego cada `intervalMs`.
//   - Sin solapes: si una pasada sigue corriendo, no lanza otra.
//   - Backoff ante fallos de red: el intervalo se alarga tras errores seguidos
//     y vuelve a la normalidad al primer éxito.
//   - Avisa con onChange() cuando llegó contenido nuevo (para refrescar la UI).
//
//  Es OPCIONAL: solo se activa si se configura un hub (--sync-from=URL). Si no,
//  el nodo funciona igual que siempre (100% offline en la LAN).
// =============================================================================

import { syncOnce } from './sync-core.js';

/**
 * @param {object}  p
 * @param {string}  p.from         URL base del paquete del hub.
 * @param {number}  p.intervalMs   Milisegundos entre sincronizaciones.
 * @param {object}  p.cat          DAO de openCatalog().
 * @param {string}  p.cacheDir     Carpeta de caché del nodo.
 * @param {string}  [p.home]
 * @param {Function}[p.log]
 * @param {(result:object)=>void} [p.onChange]  Se llama cuando hubo cambios reales.
 * @returns {{ runNow:Function, getStatus:Function, stop:Function }}
 */
export function startAutoSync({ from, intervalMs, cat, cacheDir, home, log, onChange }) {
  const MIN_INTERVAL = 15 * 1000; // nunca más seguido que cada 15 s
  intervalMs = Math.max(MIN_INTERVAL, Number(intervalMs) || 15 * 60 * 1000);

  let timer = null;
  let running = false;
  let stopped = false;
  let failStreak = 0;

  const status = {
    enabled: true,
    from,
    intervalMin: Math.round(intervalMs / 60000),
    running: false,
    lastSyncAt: null,
    lastResult: null,   // { changed, bajados, saltados, ... }
    error: null,
    nextAt: null,
  };

  function schedule() {
    clearTimeout(timer);
    if (stopped) return;
    // Backoff lineal y acotado: el intervalo se multiplica por la racha de fallos (máx ×6).
    const factor = Math.min(1 + failStreak, 6);
    const delay = intervalMs * factor;
    status.nextAt = new Date(Date.now() + delay).toISOString();
    timer = setTimeout(runNow, delay);
  }

  async function runNow() {
    if (running || stopped) return status;
    running = true; status.running = true; status.error = null;
    try {
      const r = await syncOnce({ base: from, cat, cacheDir, home, log });
      status.lastResult = r;
      status.lastSyncAt = r.at;
      failStreak = 0;
      if (r.changed) {
        log?.(`🔄 Sincronización automática: ${r.bajados} archivo(s) nuevo(s), ${r.saltados} ya estaban.`);
        try { onChange?.(r); } catch { /* el callback no debe tumbar el ciclo */ }
      }
    } catch (e) {
      failStreak++;
      status.error = e.message;
      log?.(`⚠ Auto-sync falló (intento ${failStreak}): ${e.message}`);
    } finally {
      running = false; status.running = false;
      schedule();
    }
    return status;
  }

  // Primera pasada a los 2 s (deja que el servidor web/semilla terminen de subir).
  timer = setTimeout(runNow, 2000);
  status.nextAt = new Date(Date.now() + 2000).toISOString();
  log?.(`🛰  Sincronización automática ACTIVA con ${from} (cada ${status.intervalMin} min).`);

  return {
    runNow,                                   // fuerza una pasada ya (lo usa el botón del maestro)
    getStatus: () => ({ ...status }),
    stop: () => { stopped = true; clearTimeout(timer); },
  };
}
