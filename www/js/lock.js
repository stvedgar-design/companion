// www/js/lock.js
// Hash del PIN para el bloqueo opcional de la app (ver settings.js / main.js).
// Puro: usa Web Crypto (SubtleCrypto), disponible tanto en el navegador
// como en la WebView de Android, sin dependencias.

const encoder = new TextEncoder();

function randomSalt() {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hashPin(pin, salt) {
  const data = encoder.encode(salt + ':' + pin);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Genera { salt, hash } para guardar en Settings a partir de un PIN nuevo.
 * @param {string} pin
 * @returns {Promise<{ salt: string, hash: string }>}
 */
export async function createPinHash(pin) {
  const salt = randomSalt();
  const hash = await hashPin(pin, salt);
  return { salt, hash };
}

/**
 * Compara un PIN ingresado contra el hash guardado en Settings.
 * @param {string} pin
 * @param {string} salt
 * @param {string} expectedHash
 * @returns {Promise<boolean>}
 */
export async function verifyPin(pin, salt, expectedHash) {
  if (!expectedHash) return false;
  const hash = await hashPin(pin, salt || '');
  return hash === expectedHash;
}
