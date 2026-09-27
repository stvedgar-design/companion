// www/js/persist.js
// QOL-002: pide al sistema almacenamiento PERSISTENTE (navigator.storage.persist()) para reducir el riesgo de que Android/Chromium purgue
// la base de datos en silencio cuando falta espacio en el teléfono. No sustituye a las copias de seguridad (BKP-001), es una capa extra.
// Nunca bloquea ni interrumpe el arranque, no muestra diálogos y no lanza errores: cualquier fallo se convierte en un resultado.
// El módulo es puro (recibe `storage` por parámetro) para poder probarlo con dobles.

/** @typedef {{ status: 'granted'|'denied'|'unsupported'|'error', at: number, alreadyPersisted?: boolean, error?: string }} PersistResult */

/** @type {PersistResult|null} */
let lastResult = null;

/**
 * Pide persistencia una vez. `storage` es `navigator.storage` (o un doble). Si ya estaba concedida, no vuelve a pedirla.
 * @param {any} storage
 * @param {() => number} [now]
 * @returns {Promise<PersistResult>}
 */
export async function requestPersistence(storage, now = Date.now) {
  let result;
  try {
    if (!storage || typeof storage.persist !== 'function') {
      result = { status: 'unsupported', at: now() };
    } else {
      let already = false;
      if (typeof storage.persisted === 'function') already = (await storage.persisted()) === true;
      const granted = already || (await storage.persist()) === true;
      result = { status: granted ? 'granted' : 'denied', at: now() };
      if (already) result.alreadyPersisted = true;
    }
  } catch (err) {
    result = { status: 'error', at: now(), error: String((err && err.message) || err) };
  }
  lastResult = result;
  try {
    console.info(`[Companion] almacenamiento persistente: ${result.status}`);
  } catch (err) {
    /* sin consola: no importa */
  }
  return result;
}

/** Último resultado de `requestPersistence` en esta sesión, o `null` si todavía no se pidió. */
export function getPersistenceResult() {
  return lastResult;
}

/** Frase corta y llana para mostrar en Ajustes → Diagnóstico. */
export function describePersistence(result) {
  if (!result) return 'Protección de datos del sistema: todavía no comprobada.';
  switch (result.status) {
    case 'granted':
      return 'Protección de datos del sistema: activa (Android no debería borrar tus chats si falta espacio).';
    case 'denied':
      return 'Protección de datos del sistema: no concedida por Android. Tus chats siguen guardados, pero conviene hacer copias de seguridad.';
    case 'unsupported':
      return 'Protección de datos del sistema: no disponible en este dispositivo.';
    default:
      return 'Protección de datos del sistema: no se pudo comprobar.';
  }
}
