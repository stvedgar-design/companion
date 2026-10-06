// www/js/character-appearance.js
// MEM-009: ficha de apariencia de un personaje, PROPIA de la app (no forma parte de la character card `chara_card_v2`, que no describe el
// aspecto físico y no se toca). Dos partes:
//   fixed   rasgos que no cambian (complexión, pelo/ojos, rasgo distintivo). Va en la CABECERA del prompt, junto a los recuerdos "siempre
//           presentes" y a la relación: es estable, así que cambiarlo cuesta como cualquier edición de esa zona (una respuesta lenta).
//   current ropa o estado de apariencia del momento. Va al FINAL del prompt, junto al bloque "por tema": cambia más seguido y su costo es
//           bajo (1-3 s).
// Módulo puro, sin DOM ni almacenamiento (lo usan state.js, api/prompt.js y la hoja de edición).

/** Tope de caracteres de los rasgos fijos (mantiene bajo el costo en contexto de la cabecera). */
export const APPEARANCE_FIXED_MAX = 200;
/** Tope de caracteres de la ropa/estado actual (va al final del prompt en cada respuesta). */
export const APPEARANCE_CURRENT_MAX = 100;

/** @typedef {{ fixed: string, current: string, updated: number }} Appearance */

const clean = (value, max) => {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
};

/** Ficha vacía (valor por defecto de todo personaje, también de los guardados antes de MEM-009). */
export function emptyAppearance() {
  return { fixed: '', current: '', updated: 0 };
}

/**
 * Valida una ficha guardada o venida de una copia de seguridad: textos en una sola línea, recortados a su tope; `updated` numérico o 0.
 * Cualquier cosa que no sea un objeto da la ficha vacía.
 * @param {unknown} raw
 * @returns {Appearance}
 */
export function sanitizeAppearance(raw) {
  if (!raw || typeof raw !== 'object') return emptyAppearance();
  const fixed = clean(raw.fixed, APPEARANCE_FIXED_MAX);
  const current = clean(raw.current, APPEARANCE_CURRENT_MAX);
  const updated = Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : 0;
  return { fixed, current, updated: fixed || current ? updated : 0 };
}

/**
 * Ficha lista para pasar a `extras.appearance` de los prompts, o `null` si el personaje no tiene nada escrito (entonces no se pasa nada).
 * @param {{ appearance?: unknown }|null|undefined} character
 * @returns {{ fixed: string, current: string }|null}
 */
export function appearanceOf(character) {
  const a = sanitizeAppearance(character && character.appearance);
  return a.fixed || a.current ? { fixed: a.fixed, current: a.current } : null;
}

/** ¿No hay nada escrito? (entonces el prompt queda idéntico al de antes). */
export function isAppearanceEmpty(appearance) {
  const a = sanitizeAppearance(appearance);
  return !a.fixed && !a.current;
}
