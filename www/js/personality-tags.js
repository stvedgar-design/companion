// www/js/personality-tags.js
// CCC-001: lista curada de rasgos de personalidad para el creador/editor de personajes, en forma de
// etiquetas (pills) togglables. En inglés, como el resto del contenido narrativo de las cards (ver
// docs/HISTORIAL.md, "Propuesta: creador de personajes guiado"). Módulo puro, sin DOM.

/** Tope de etiquetas elegibles a la vez (mantiene `personality` corto y barato en contexto). */
export const MAX_PERSONALITY_TAGS = 6;

// id (lo que se guarda) -> etiqueta visible (mismo texto, con mayúscula inicial). Un solo adjetivo por
// etiqueta, sin combinaciones: cubre los rasgos más comunes en personajes de rol.
const TAGS = [
  'shy', 'bold', 'clingy', 'playful', 'dominant', 'submissive',
  'caring', 'sarcastic', 'jealous', 'affectionate', 'reserved', 'protective',
  'curious', 'flirty', 'stubborn', 'cheerful', 'calm', 'anxious',
  'confident', 'mysterious', 'loyal', 'blunt', 'gentle', 'mischievous',
];

const TAG_SET = new Set(TAGS);

/** Lista completa de etiquetas disponibles, en el orden en que se muestran. */
export const PERSONALITY_TAGS = TAGS.map((id) => ({ id, label: id.charAt(0).toUpperCase() + id.slice(1) }));

/**
 * Valida una lista de etiquetas (guardadas o venidas de un formulario): solo ids conocidos, sin
 * duplicados, hasta `MAX_PERSONALITY_TAGS`. Cualquier otra cosa se descarta en silencio.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function sanitizePersonalityTags(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const value of raw) {
    if (typeof value !== 'string' || !TAG_SET.has(value) || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
    if (out.length >= MAX_PERSONALITY_TAGS) break;
  }
  return out;
}

/**
 * Ensambla las etiquetas elegidas en una frase legible para `Card.personality` (no una lista de
 * palabras sueltas pegadas). P. ej. `['shy','bold','caring']` -> `"Shy, bold, and caring."`.
 * @param {unknown} tags
 * @returns {string}
 */
export function personalityTextFromTags(tags) {
  const clean = sanitizePersonalityTags(tags);
  if (!clean.length) return '';
  // Mayúscula solo al empezar la oración (como cualquier frase), el resto de las etiquetas en minúscula.
  const labels = [clean[0].charAt(0).toUpperCase() + clean[0].slice(1), ...clean.slice(1)];
  if (labels.length === 1) return `${labels[0]}.`;
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}.`;
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}.`;
}
