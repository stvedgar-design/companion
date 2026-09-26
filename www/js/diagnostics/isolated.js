// www/js/diagnostics/isolated.js
// UI-005: el almacén AISLADO del banco de pruebas de estrés. Es OTRA base de datos de IndexedDB (`companion-diag`) con los mismos
// almacenes que la real, así que nada de lo que crea la prueba puede mezclarse con los personajes, chats o ajustes del usuario, ni
// aparecer en el hub o en una copia de seguridad. Limpiar = borrar esa base entera.

import { createState, createIndexedDbBackend } from '../state.js';

export const DIAG_DB_NAME = 'companion-diag';

/** `state` (misma API que la real) sobre la base de datos aislada. */
export function createDiagState() {
  return createState(createIndexedDbBackend(DIAG_DB_NAME));
}

/**
 * Borra por completo la base aislada. Si otra conexión la tiene abierta, espera un poco a que se cierre.
 * @returns {Promise<boolean>} true si quedó borrada
 */
export function wipeDiagDb(timeoutMs = 4000) {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') return resolve(true);
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const t = setTimeout(() => finish(false), timeoutMs);
    try {
      const req = indexedDB.deleteDatabase(DIAG_DB_NAME);
      req.onsuccess = () => { clearTimeout(t); finish(true); };
      req.onerror = () => { clearTimeout(t); finish(false); };
      req.onblocked = () => {}; // sigue esperando: se resuelve cuando se cierren las conexiones o venza el tiempo
    } catch {
      clearTimeout(t);
      finish(false);
    }
  });
}
