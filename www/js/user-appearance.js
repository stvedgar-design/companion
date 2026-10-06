// www/js/user-appearance.js
// MEM-020: "Tu apariencia" — UNA línea de etiquetas sobre el usuario (en inglés, separadas por comas), global: la conocen todos los
// personajes. Vive en `Settings.userAppearance` y viaja en la CABECERA de todo prompt que continúa el prefijo del chat (ver
// `formatUserAppearance` y `headBlock` en api/prompt.js), en el lugar estable que ocupaban los recuerdos "siempre presentes" (retirados).
// Módulo puro, sin DOM ni almacenamiento (lo usan state.js, api/prompt.js y la pantalla de Ajustes).

/** Tope de caracteres del campo (mantiene bajo el costo en contexto de la cabecera: ≈ 90 tokens). */
export const USER_APPEARANCE_MAX = 300;

/**
 * Texto de UNA línea: espacios colapsados, recortado al tope. Todo lo que no sea texto da ''.
 * @param {unknown} value
 * @returns {string}
 */
export function sanitizeUserAppearance(value) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > USER_APPEARANCE_MAX ? flat.slice(0, USER_APPEARANCE_MAX).trimEnd() : flat;
}
