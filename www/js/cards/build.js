// www/js/cards/build.js
// CCC-001: arma una Card normalizada (misma forma que produce `normCard()` en cards/parse.js) a partir
// de las elecciones del creador/editor de personajes: pills de personalidad + texto libre guiado. Puro,
// sin DOM — la UI (www/js/ui/character-editor.js) le pasa los valores del formulario y guarda el
// resultado con `saveCharacter()`, exactamente como una card importada (docs/CONTRACT-CHARACTER-CREATOR.md §4).

import { personalityTextFromTags, sanitizePersonalityTags } from '../personality-tags.js';

export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 300;
export const SCENARIO_MAX = 200;
export const FIRST_MES_MAX = 400;
export const MES_EXAMPLE_MAX = 300;
// Tope generoso para personalidad en texto libre (card importada sin etiquetas, editada a mano).
export const PERSONALITY_TEXT_MAX = 400;
// CCC-002: reglas de comportamiento del personaje (no son personalidad ni descripción). Se guardan en
// `post_history_instructions`, un campo de la card Tavern V2 que ya existía reservado sin interfaz
// propia (ver api/prompt.js: ya se incluye en el prompt en ambos modos, plain y plantilla).
export const INSTRUCTIONS_MAX = 300;

/**
 * Recorta espacios sobrantes (incluidos saltos de línea, que estos campos no usan) y el tope de
 * caracteres. No reescribe el contenido del usuario más allá de eso.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function cleanText(value, max) {
  if (typeof value !== 'string') return '';
  const flat = value.replace(/\s+/g, ' ').trim();
  return flat.length > max ? flat.slice(0, max).trimEnd() : flat;
}

/**
 * Como `cleanText`, y además capitaliza el inicio de la oración (la primera letra). Para los campos
 * narrativos (descripción, escenario, saludo, ejemplo); el nombre usa `cleanText` a secas.
 * @param {unknown} value
 * @param {number} max
 * @returns {string}
 */
export function normalizeField(value, max) {
  const flat = cleanText(value, max);
  return flat ? flat.charAt(0).toUpperCase() + flat.slice(1) : flat;
}

/**
 * Arma una Card normalizada a partir de los campos del creador/editor.
 * `personalityTags` (si trae alguna) manda sobre `personalityText`: la personalidad final se
 * ensambla desde las etiquetas. Sin etiquetas, se usa el texto libre tal cual (card importada sin
 * etiquetas, o el usuario editándola como texto).
 * @param {{
 *   name?: string,
 *   personalityTags?: string[],
 *   personalityText?: string,
 *   description?: string,
 *   scenario?: string,
 *   firstMes?: string,
 *   mesExample?: string,
 *   instructions?: string,
 * }} fields
 * @returns {import('../state.js').Card}
 */
export function buildCharacterCard(fields = {}) {
  const tags = sanitizePersonalityTags(fields.personalityTags);
  const personality = tags.length
    ? personalityTextFromTags(tags)
    : cleanText(fields.personalityText, PERSONALITY_TEXT_MAX);

  return {
    name: cleanText(fields.name, NAME_MAX) || 'Sin nombre',
    description: normalizeField(fields.description, DESCRIPTION_MAX),
    personality,
    scenario: normalizeField(fields.scenario, SCENARIO_MAX),
    first_mes: normalizeField(fields.firstMes, FIRST_MES_MAX),
    mes_example: normalizeField(fields.mesExample, MES_EXAMPLE_MAX),
    system_prompt: '',
    post_history_instructions: normalizeField(fields.instructions, INSTRUCTIONS_MAX),
    alternate_greetings: [],
    character_book: null,
  };
}
