// www/js/variants.js
// UI-017: varias versiones (variantes) de una respuesta del personaje. Módulo puro, sin DOM ni almacenamiento.
//
// Modelo (compatible hacia atrás): un mensaje del personaje sigue teniendo `text` y `loreUsed?` y esos campos son SIEMPRE los
// de la variante activa; así el armado del prompt, el resumen de continuidad, "Copiar", la vista previa y el marcapáginas
// de memoria (UI-010) siguen leyendo `m.text`/`m.loreUsed` sin saber nada de variantes. Encima se añaden, solo cuando hay
// dos o más versiones:
//   variants:      { text: string, loreUsed?: LoreUsed[] }[]
//   activeVariant: number   (índice en `variants`)
// Un mensaje sin `variants` (todos los guardados hasta ahora) es una lista de una sola variante.
// Regla de verdad: si `variants[activeVariant]` y `text`/`loreUsed` no coinciden (p. ej. porque otra ruta editó `text`),
// manda `text`/`loreUsed` y la variante activa se corrige a su valor.

/** Cantidad de versiones del mensaje (1 si nunca se regeneró). */
export function variantCount(m) {
  return m && Array.isArray(m.variants) && m.variants.length > 1 ? m.variants.length : 1;
}

/** Índice de la versión activa (0 si el mensaje solo tiene una). */
export function activeVariantIndex(m) {
  if (variantCount(m) < 2) return 0;
  const i = m.activeVariant;
  return Number.isInteger(i) && i >= 0 && i < m.variants.length ? i : m.variants.length - 1;
}

function pickVariant(m) {
  const v = { text: m.text };
  if (Array.isArray(m.loreUsed)) v.loreUsed = m.loreUsed;
  return v;
}

/**
 * Añade una versión nueva (no borra ninguna) y la deja activa. `m.text`/`m.loreUsed` pasan a ser los de la nueva.
 * @param {object} m mensaje del personaje (tal como está: su `text` es la versión que se ve ahora)
 * @param {{ text: string, loreUsed?: object[], ts?: number }} next
 */
export function addVariant(m, next) {
  const current = variantCount(m) > 1 ? m.variants.map((v, i) => (i === activeVariantIndex(m) ? pickVariant(m) : v)) : [pickVariant(m)];
  const added = { text: next.text };
  if (Array.isArray(next.loreUsed)) added.loreUsed = next.loreUsed;
  const { loreUsed: _drop, ...base } = m;
  const out = { ...base, text: added.text, variants: [...current, added], activeVariant: current.length };
  if (added.loreUsed) out.loreUsed = added.loreUsed;
  if (typeof next.ts === 'number') out.ts = next.ts;
  return out;
}

/** Cambia la versión activa a `index` (fuera de rango o igual a la actual: devuelve el mismo mensaje). */
export function selectVariant(m, index) {
  const n = variantCount(m);
  if (n < 2 || !Number.isInteger(index) || index < 0 || index >= n || index === activeVariantIndex(m)) return m;
  const current = activeVariantIndex(m);
  const variants = m.variants.map((v, i) => (i === current ? pickVariant(m) : v));
  const target = variants[index];
  const { loreUsed: _drop, ...base } = m;
  const out = { ...base, text: target.text, variants, activeVariant: index };
  if (Array.isArray(target.loreUsed)) out.loreUsed = target.loreUsed;
  return out;
}

/** Editar el texto: cambia solo la versión activa (las demás quedan como estaban). */
export function editActiveText(m, text) {
  if (variantCount(m) < 2) return { ...m, text };
  const i = activeVariantIndex(m);
  return { ...m, text, variants: m.variants.map((v, j) => (j === i ? { ...v, text } : v)) };
}

/**
 * Valida y normaliza los campos de variantes de un mensaje leído del almacenamiento o de un archivo ajeno. Nunca lanza
 * ni descarta el mensaje: lo peor que hace es quitar `variants`/`activeVariant` y dejar `text` (la versión visible).
 * @param {object} m mensaje ya con `loreUsed` saneado
 * @param {(raw: unknown) => object[]|undefined} cleanLore saneador de `loreUsed` (el de `state.js`)
 */
export function normalizeVariants(m, cleanLore) {
  if (!m || typeof m !== 'object' || !('variants' in m || 'activeVariant' in m)) return m;
  const { variants, activeVariant, ...rest } = m;
  if (rest.role !== 'char' || !Array.isArray(variants)) return rest;
  const clean = variants
    .map((v) => {
      if (!v || typeof v !== 'object' || typeof v.text !== 'string' || !v.text) return null;
      const lore = cleanLore ? cleanLore(v.loreUsed) : undefined;
      return lore === undefined ? { text: v.text } : { text: v.text, loreUsed: lore };
    })
    .filter(Boolean);
  if (clean.length < 2) return rest;
  let active = Number.isInteger(activeVariant) && activeVariant >= 0 && activeVariant < variants.length ? activeVariant : -1;
  // `activeVariant` apunta a la lista original; si se descartaron entradas hay que reubicarlo por texto.
  if (clean.length !== variants.length || active < 0) {
    const byText = clean.findIndex((v) => v.text === rest.text);
    active = byText >= 0 ? byText : clean.length - 1;
  }
  const text = typeof rest.text === 'string' && rest.text ? rest.text : clean[active].text;
  const fixed = { text };
  if (Array.isArray(rest.loreUsed)) fixed.loreUsed = rest.loreUsed;
  clean[active] = fixed;
  return { ...rest, text, variants: clean, activeVariant: active };
}
