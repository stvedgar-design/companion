// www/js/api/relationship.js
// MEM-006 (versión final): "Estado de la relación", armado LOCALMENTE con lo que ya existe en el lorebook del
// personaje. NO usa el modelo ni el servidor y no inventa nada: una frase fija según cuántos recuerdos hay,
// los recuerdos "siempre presentes" tal cual, y cuándo se tocó la memoria por última vez. Puro (sin DOM ni red).
// (Se probó primero pedirle un resumen al modelo y inventaba datos: ver "MEM-006" en docs/HISTORIAL.md.)

/** Hasta este número de recuerdos (incluido): "pocos". */
export const RELATIONSHIP_FEW_MAX = 4;
/** Desde este número de recuerdos: "muchos". Entre ambos: "varios". (El lorebook admite hasta 24.) */
export const RELATIONSHIP_MANY_MIN = 12;

/** Frase fija por nivel. `none` = todavía no hay ningún recuerdo (no se afirma nada de la relación). */
export const RELATIONSHIP_PHRASES = Object.freeze({
  none: 'Todavía no hay recuerdos guardados.',
  few: 'Todavía se están conociendo.',
  several: 'Ya han compartido bastante.',
  many: 'Tienen una relación con mucha historia acumulada.',
});

/**
 * @param {number} total  cantidad de recuerdos
 * @returns {'none'|'few'|'several'|'many'}
 */
export function relationshipLevel(total) {
  if (!(total > 0)) return 'none';
  if (total <= RELATIONSHIP_FEW_MAX) return 'few';
  if (total >= RELATIONSHIP_MANY_MIN) return 'many';
  return 'several';
}

/**
 * Resumen local del estado de la relación a partir del lorebook (siempre presentes + por tema).
 * @param {import('../state.js').LoreEntry[]} entries
 * @returns {{
 *   total: number,
 *   always: { id: string, content: string }[],
 *   lastUpdated: number,
 *   level: 'none'|'few'|'several'|'many',
 *   phrase: string,
 * }}  `lastUpdated` = la fecha más reciente entre los recuerdos (ms; 0 si no hay ninguna).
 */
export function relationshipSummary(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && typeof e.content === 'string' && e.content.trim()
  );
  const always = list.filter((e) => e.always === true).map((e) => ({ id: String(e.id || ''), content: e.content.trim() }));
  const lastUpdated = list.reduce((max, e) => (Number.isFinite(e.updated) && e.updated > max ? e.updated : max), 0);
  const level = relationshipLevel(list.length);
  return { total: list.length, always, lastUpdated, level, phrase: RELATIONSHIP_PHRASES[level] };
}

/**
 * "hace 2 días", en lenguaje llano ('' si no hay fecha).
 * @param {number} at  ms desde epoch
 * @param {number} [now]
 * @returns {string}
 */
export function relationshipAgeText(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '';
  const mins = Math.floor(Math.max(0, now - at) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} minuto${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months === 1 ? '' : 'es'}`;
}
