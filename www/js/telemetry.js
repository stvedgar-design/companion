// www/js/telemetry.js
// TEL-001: registro de eventos de uso, local y privado, para que el arquitecto tenga datos reales del
// pacto de 7 días sin depender de que el usuario narre todo a mano (docs/NOTES.md, "CCC/TEL"). Vive en
// SU PROPIA base de datos IndexedDB (`companion-telemetry`), separada de los datos reales del usuario —
// mismo espíritu que la base aislada de UI-005 (`diagnostics/isolated.js`): si esto se corrompe o se
// borra, no toca chats, personajes ni ajustes. Append-only: nunca se edita ni se borra un evento ya
// guardado (no hay `update`/`remove`, a propósito).
//
// Cada evento guarda SOLO: marca de tiempo, tipo, y datos mínimos ya de por sí no sensibles (ids
// opacos de personaje/chat —nunca su nombre—, conteos, categorías fijas). `sanitizeEventData` es una
// segunda barrera (además de que cada punto de registro solo manda esos campos): descarta cualquier
// valor que no sea número/booleano/string corto, así que aunque algún punto de registro se equivocara
// y mandara un texto largo, este módulo nunca lo guardaría.
//
// Mejor esfuerzo real: `logEvent` NUNCA lanza y nunca se espera desde el flujo que dispara el evento
// (fire-and-forget) — una escritura de telemetría que falla no debe interrumpir ni retrasar la acción
// real del usuario. Empieza a registrar desde que este contrato se implementó: no hay forma de
// reconstruir el historial de días anteriores (se documenta así en HISTORIAL.md a propósito).

/** Tipos de evento — usar estas constantes en vez de escribir el string a mano, para no errar el nombre. */
export const TEL_EVENTS = Object.freeze({
  MEMORY_CREATED: 'memory_created',
  MEMORY_MERGED: 'memory_merged',
  MEMORY_EDITED: 'memory_edited',
  MEMORY_DELETED: 'memory_deleted',
  CONTINUITY_UPDATED: 'continuity_updated',
  RELATIONSHIP_LEVEL_CHANGED: 'relationship_level_changed',
  EXPERIMENTAL_SETTING_CHANGED: 'experimental_setting_changed',
  CHARACTER_CREATED: 'character_created',
  APPEARANCE_EDITED: 'appearance_edited',
  MESSAGE: 'message',
});

/** Tope de una cadena dentro de los datos de un evento: alcanza de sobra para un id, una categoría o el nombre de un ajuste. */
const MAX_STRING_FIELD_CHARS = 40;

/**
 * Descarta cualquier campo que no sea un número finito, un booleano o una cadena corta (recortada al
 * tope). Nunca lanza. Es la segunda barrera de privacidad: aunque un punto de registro se equivocara y
 * mandara un objeto o un texto largo, acá se pierde, no llega a guardarse.
 * @param {unknown} data
 * @returns {object}
 */
export function sanitizeEventData(data) {
  const out = {};
  if (!data || typeof data !== 'object') return out;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else if (typeof value === 'string') out[key] = value.slice(0, MAX_STRING_FIELD_CHARS);
  }
  return out;
}

/**
 * Crea una instancia de telemetría ligada a `backend` ({ add(value), getAll() }).
 */
export function createTelemetry(backend) {
  async function logEvent(type, data) {
    if (typeof type !== 'string' || !type) return;
    try {
      await backend.add({ ts: Date.now(), type, ...sanitizeEventData(data) });
    } catch {
      // mejor esfuerzo: una falla al registrar nunca debe notarse fuera de este módulo
    }
  }

  async function listEvents() {
    try {
      const all = await backend.getAll();
      return Array.isArray(all) ? all : [];
    } catch {
      return [];
    }
  }

  return { logEvent, listEvents };
}

// ---------- backend de IndexedDB (uso real en la app) ----------

export const TELEMETRY_DB_NAME = 'companion-telemetry';
const STORE = 'events';

function openTelemetryDb(dbName) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** Backend real, otra base de datos IndexedDB con un único almacén append-only. */
export function createIndexedDbTelemetryBackend(dbName = TELEMETRY_DB_NAME) {
  let dbPromise = null;
  const getDb = () => (dbPromise || (dbPromise = openTelemetryDb(dbName)));

  return {
    async add(value) {
      const db = await getDb();
      await new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add(value);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async getAll() {
      const db = await getDb();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
  };
}

// Instancia por defecto, creada de forma perezosa (igual que state.js): importar este módulo en Node
// (tests) no falla; solo falla si de verdad se usan estas funciones sin IndexedDB.
let defaultInstance = null;
function getDefaultInstance() {
  if (!defaultInstance) {
    if (typeof indexedDB === 'undefined') {
      // Sin IndexedDB (no debería pasar en la app real): registrar se vuelve un no-op silencioso en vez
      // de lanzar, para no arriesgar romper el flujo que lo dispara.
      defaultInstance = createTelemetry({ async add() {}, async getAll() { return []; } });
    } else {
      defaultInstance = createTelemetry(createIndexedDbTelemetryBackend());
    }
  }
  return defaultInstance;
}

/** Registra un evento (mejor esfuerzo; nunca lanza). Úsalo SIN `await` en el flujo que dispara el evento. */
export const logEvent = (type, data) => getDefaultInstance().logEvent(type, data);
/** Todos los eventos guardados, para armar el informe de uso. */
export const listEvents = () => getDefaultInstance().listEvents();
