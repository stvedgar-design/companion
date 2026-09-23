// www/js/ui/format.js
// Utilidades puras de formateo de texto para la pantalla de chat.
// Sin DOM, sin dependencias externas.

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa caracteres especiales de HTML. Es la única función que debe usarse
 * antes de insertar texto de usuario, modelo o card como HTML.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

/**
 * Convierte texto crudo de un mensaje en HTML seguro para mostrar en una burbuja.
 * - Escapa primero (nunca interpreta HTML del texto original).
 * - `**negrita**` -> <strong>, `*acción*` -> <em>, saltos de línea -> <br>.
 * - Si el texto termina con un asterisco sin su cierre (streaming en curso),
 *   ese tramo final se formatea igualmente como cursiva.
 * - Un asterisco aislado que no forma parte de un par ni de un cierre en curso
 *   (p. ej. "5 * 3") se deja tal cual, sin romper el resto del texto.
 * No interpreta guiones bajos, backticks ni ningún otro markdown.
 * @param {string} text
 * @returns {string}
 */
export function formatMessage(text) {
  let s = escapeHtml(text);

  // Negrita: pares **...** sin asteriscos dentro.
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Cursiva: pares *...* sin asteriscos dentro (ya consumidos los de negrita).
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Asterisco sin cerrar al final del texto (streaming): solo si arranca
  // pegado a una palabra (sin espacio inmediatamente después), para no
  // capturar asteriscos aislados como en "5 * 3".
  s = s.replace(/\*(\S[^*]*)$/, '<em>$1</em>');

  return s.replace(/\n/g, '<br>');
}
