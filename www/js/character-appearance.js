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
/** Tope de caracteres para el estilo habitual inmutable. */
export const APPEARANCE_STYLE_MAX = 150;

/** @typedef {{ fixed: string, current: string, underwear?: string, accessories?: string, style?: string, updated: number }} Appearance */

const clean = (value, max) => {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
};

/** Ficha vacía (valor por defecto de todo personaje). */
export function emptyAppearance() {
  return { fixed: '', current: '', updated: 0 };
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
  const style = clean(raw.style, APPEARANCE_STYLE_MAX);
  const updated = Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : 0;
  const hasAny = fixed || current || underwear || accessories || style;

  const res = {
    fixed,
    current,
    updated: hasAny ? updated : 0,
  };
  if (underwear) res.underwear = underwear;
  if (accessories) res.accessories = accessories;
  if (style) res.style = style;
  return res;
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
  let accessories = clean(look.accessories, APPEARANCE_ACCESSORIES_MAX);

  let main = '';
  if (current && underwear) {
    main = `${current} over ${underwear}`;
  } else if (current) {
    main = current;
  } else if (underwear) {
    main = underwear;
  }

  let accText = '';
  if (accessories) {
    if (!accessories.endsWith('.')) accessories += '.';
    if (/^wearing\s+/i.test(accessories)) {
      accText = accessories.charAt(0).toUpperCase() + accessories.slice(1);
    } else {
      accText = `Wearing ${accessories}`;
    }
  }

  if (main && accText) {
    return `${main}. ${accText}`;
  }
  if (accText) {
    return accText;
  }
  return main;
}

/**
 * Ficha lista para pasar a extras.appearance de los prompts, o null si el personaje no tiene nada escrito.
 * @param {{ appearance?: unknown }|null|undefined} character
 * @returns {{ fixed: string, current: string, underwear?: string, accessories?: string, style?: string }|null}
 */
export function appearanceOf(character) {
  const a = sanitizeAppearance(character && character.appearance);
  if (!a.fixed && !a.current && !a.underwear && !a.accessories && !a.style) {
    return null;
  }
  const res = { fixed: a.fixed, current: a.current };
  if (a.underwear) res.underwear = a.underwear;
  if (a.accessories) res.accessories = a.accessories;
  if (a.style) res.style = a.style;
  return res;
}

/** ¿No hay nada escrito? (entonces el prompt queda idéntico al de antes). */
export function isAppearanceEmpty(appearance) {
  const a = sanitizeAppearance(appearance);
  return !a.fixed && !a.current && !a.underwear && !a.accessories && !a.style;
}
