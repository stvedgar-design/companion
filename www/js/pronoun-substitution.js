// www/js/pronoun-substitution.js
// CCC-005: sustitución de pronombres para las plantillas del creador (arquetipos y botones "Ejemplo").
// Módulo puro, sin DOM. El texto base se escribe UNA sola vez con pronombres neutros ("they/their/them")
// y, según el género elegido, se convierte a "she/her" o "he/his" al precargar los campos. No hay copias
// del texto por género.
//
// Es una LISTA CERRADA de palabras, no procesamiento de lenguaje natural. Cubre (en minúsculas; las
// mayúsculas se conservan: They→She, THEY→SHE):
//   they → she / he            their → her / his            theirs → hers / his
//   them → her / him           themselves, themself → herself / himself
//   they're → she's / he's     they've → she's / he's   (ver abajo)  they'll → she'll / he'll
//   they'd → she'd / he'd      they are → she is / he is  they have → she has / he has
//   they don't → she doesn't / he doesn't   they do → she does / he does
//   they aren't → she isn't    they haven't → she hasn't   they were → she was / he was
//   they weren't → she wasn't
// Límites conocidos (por eso los textos base de la app están escritos para respetarlos):
//   - Un verbo en presente suelto después de "they" ("they want", "they care") NO se conjuga: saldría
//     "she want". Los textos base usan después de "they" solo: pasado, auxiliares de la lista, o
//     modales (can, will, would, could, should, might, must). Un test lo vigila para todas las plantillas.
//   - "they've" es ambiguo ("she's" = "she has"); se usa solo como auxiliar ("they've been").
//   - "them" va a "her"/"him" siempre (no distingue "them" = varias personas); los textos base solo lo
//     usan para el propio personaje.
//   - No toca "{{char}}", "{{user}}" ni nombres propios; no traduce al español.

export const GENDERS = ['female', 'male', 'neutral'];
export const DEFAULT_GENDER = 'neutral';

/** Etiquetas para la interfaz, en el orden en que se muestran. */
export const GENDER_LABELS = [
  { id: 'female', label: 'Femenino' },
  { id: 'male', label: 'Masculino' },
  { id: 'neutral', label: 'Sin especificar' },
];

/** Devuelve 'female' | 'male' | 'neutral'; cualquier otra cosa cae a 'neutral'. */
export function sanitizeGender(raw) {
  return GENDERS.includes(raw) ? raw : DEFAULT_GENDER;
}

// [neutro, mujer, hombre]. Las frases largas van ANTES que las palabras sueltas.
const TABLE = [
  ["they weren't", "she wasn't", "he wasn't"],
  ["they aren't", "she isn't", "he isn't"],
  ["they haven't", "she hasn't", "he hasn't"],
  ["they don't", "she doesn't", "he doesn't"],
  ["they were", 'she was', 'he was'],
  ["they are", 'she is', 'he is'],
  ["they have", 'she has', 'he has'],
  ["they do", 'she does', 'he does'],
  ["they're", "she's", "he's"],
  ["they've", "she's", "he's"],
  ["they'll", "she'll", "he'll"],
  ["they'd", "she'd", "he'd"],
  ['themselves', 'herself', 'himself'],
  ['themself', 'herself', 'himself'],
  ['theirs', 'hers', 'his'],
  ['their', 'her', 'his'],
  ['them', 'her', 'him'],
  ['they', 'she', 'he'],
];

const PATTERN = new RegExp(
  `(?<![A-Za-z'’])(${TABLE.map(([neutral]) => neutral.replace(/'/g, "['’]").replace(/ /g, '\\s+')).join('|')})(?![A-Za-z])`,
  'gi'
);

function matchCase(source, replacement) {
  if (source.length > 1 && source === source.toUpperCase() && /[A-Z]/.test(source)) return replacement.toUpperCase();
  if (source.charAt(0) !== source.charAt(0).toLowerCase()) return replacement.charAt(0).toUpperCase() + replacement.slice(1);
  return replacement;
}

/**
 * Sustituye los pronombres neutros de `text` según el género. 'neutral' (o cualquier valor
 * desconocido) devuelve el texto tal cual. Pura.
 * @param {string} text
 * @param {'female'|'male'|'neutral'} gender
 * @returns {string}
 */
export function applyGender(text, gender) {
  if (typeof text !== 'string' || !text) return '';
  const g = sanitizeGender(gender);
  if (g === 'neutral') return text;
  const col = g === 'female' ? 1 : 2;
  return text.replace(PATTERN, (found) => {
    const key = found.toLowerCase().replace(/’/g, "'").replace(/\s+/g, ' ');
    const row = TABLE.find(([neutral]) => neutral === key);
    return row ? matchCase(found, row[col]) : found;
  });
}

/**
 * Aplica `applyGender` a los campos de texto de un arquetipo (no toca id, label, tagline ni etiquetas).
 * @template {{ description: string, scenario: string, firstMes: string, mesExample: string }} T
 * @param {T} archetype
 * @param {'female'|'male'|'neutral'} gender
 * @returns {T}
 */
export function archetypeForGender(archetype, gender) {
  return {
    ...archetype,
    description: applyGender(archetype.description, gender),
    scenario: applyGender(archetype.scenario, gender),
    firstMes: applyGender(archetype.firstMes, gender),
    mesExample: applyGender(archetype.mesExample, gender),
  };
}
