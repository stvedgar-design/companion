// www/js/character-appearance.js
// MEM-009 / PARETO-002: ficha de apariencia de un personaje por capas (Capa 0: cuerpo, Capa 1: lencería,
// Capa 2: atuendo exterior, Capa 3: accesorios/regalos). Propia de la app, sin alterar la character card V2.

/** Tope de caracteres de los rasgos fijos (mantiene bajo el costo en contexto de la cabecera). */
export const APPEARANCE_FIXED_MAX = 200;
/** Tope de caracteres de la ropa/estado actual (va al final del prompt en cada respuesta). */
export const APPEARANCE_CURRENT_MAX = 100;
/** Tope de caracteres de ropa interior / lencería (Capa 1). */
export const APPEARANCE_UNDERWEAR_MAX = 80;
/** Tope de caracteres de accesorios y regalos (Capa 3). */
export const APPEARANCE_ACCESSORIES_MAX = 100;

/** @typedef {{ fixed: string, current: string, underwear?: string, accessories?: string, updated: number }} Appearance */

const clean = (value, max) => {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
};

/** Ficha vacía (valor por defecto de todo personaje). */
export function emptyAppearance() {
  return { fixed: '', current: '', underwear: '', accessories: '', updated: 0 };
}

/**
 * Valida una ficha guardada o venida de una copia de seguridad: textos en una sola línea, recortados a su tope; updated numérico o 0.
 * @param {unknown} raw
 * @returns {Appearance}
 */
export function sanitizeAppearance(raw) {
  if (!raw || typeof raw !== 'object') return emptyAppearance();
  const fixed = clean(raw.fixed, APPEARANCE_FIXED_MAX);
  const current = clean(raw.current, APPEARANCE_CURRENT_MAX);
  const underwear = clean(raw.underwear, APPEARANCE_UNDERWEAR_MAX);
  const accessories = clean(raw.accessories, APPEARANCE_ACCESSORIES_MAX);
  const updated = Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : 0;
  const hasAny = fixed || current || underwear || accessories;
  return { fixed, current, underwear, accessories, updated: hasAny ? updated : 0 };
}

/**
 * Ensambla en una frase natural y compacta las capas activas (exterior, íntima y accesorios).
 * @param {{ current?: string, underwear?: string, accessories?: string }|null|undefined} look
 * @returns {string}
 */
export function buildLayeredLookText(look) {
  if (!look || typeof look !== 'object') return '';
  const current = clean(look.current, APPEARANCE_CURRENT_MAX);
  const underwear = clean(look.underwear, APPEARANCE_UNDERWEAR_MAX);
  const accessories = clean(look.accessories, APPEARANCE_ACCESSORIES_MAX);
  const parts = [];
  if (current && underwear) {
    parts.push(`${current} over ${underwear}`);
  } else if (current) {
    parts.push(current);
  } else if (underwear) {
    parts.push(`wearing ${underwear}`);
  }
  if (accessories) {
    parts.push(`Wearing ${accessories}`);
  }
  return parts.join('. ');
}

/**
 * Ficha lista para pasar a extras.appearance de los prompts, o null si el personaje no tiene nada escrito.
 * @param {{ appearance?: unknown }|null|undefined} character
 * @returns {{ fixed: string, current: string, underwear: string, accessories: string }|null}
 */
export function appearanceOf(character) {
  const a = sanitizeAppearance(character && character.appearance);
  return a.fixed || a.current || a.underwear || a.accessories
    ? { fixed: a.fixed, current: a.current, underwear: a.underwear, accessories: a.accessories }
    : null;
}

/** ¿No hay nada escrito? (entonces el prompt queda idéntico al de antes). */
export function isAppearanceEmpty(appearance) {
  const a = sanitizeAppearance(appearance);
  return !a.fixed && !a.current && !a.underwear && !a.accessories;
}
