// =============================================================================
//  LIMITADOR DE CONCURRENCIA  — "administra la carga" del nodo central
// -----------------------------------------------------------------------------
//  Un semáforo asíncrono, diminuto y sin dependencias. Sirve para que el nodo
//  central NO se sature cuando muchos celulares piden bloques a la vez: solo
//  atiende `concurrency` lecturas en paralelo y encola el resto.
//
//  Dos formas de usarlo:
//    limiter.run(fn)        -> espera turno SIEMPRE (encola sin límite).
//    limiter.runOrBusy(fn)  -> si ya hay cola llena (maxQueue), rechaza con
//                              { busy:true } para que el cliente reintente luego
//                              o se apoye en sus compañeros (mesh). Así la carga
//                              se reparte y cada descarga se mantiene "ligera".
// =============================================================================

/**
 * @param {object} p
 * @param {number} p.concurrency  Tareas simultáneas como máximo.
 * @param {number} [p.maxQueue]   Cola máxima antes de declarar "ocupado" (Infinity = sin tope).
 */
export function createLimiter({ concurrency = 6, maxQueue = Infinity } = {}) {
  let active = 0;
  const queue = [];

  const pump = () => {
    while (active < concurrency && queue.length) {
      const job = queue.shift();
      active++;
      Promise.resolve()
        .then(job.fn)
        .then(job.resolve, job.reject)
        .finally(() => { active--; pump(); });
    }
  };

  return {
    /** Ejecuta `fn` cuando haya un hueco libre (espera su turno en la cola). */
    run(fn) {
      return new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); pump(); });
    },

    /** Como run(), pero si la cola está saturada rechaza al instante con e.busy = true. */
    runOrBusy(fn) {
      if (active >= concurrency && queue.length >= maxQueue) {
        const e = new Error('Servidor ocupado: demasiadas descargas en curso.');
        e.busy = true;
        return Promise.reject(e);
      }
      return this.run(fn);
    },

    /** Estado actual (para diagnóstico / cabeceras de carga). */
    stats() { return { active, queued: queue.length, concurrency, maxQueue }; },
  };
}
