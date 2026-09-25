// www/js/api/variety.js — FMT-004: detector de repetición temática del personaje.
// Puro: no importa nada, no toca el DOM ni la red. Sirve para cualquier personaje:
// NO hay lista de palabras fija; las "palabras temáticas" se derivan comparando los
// últimos turnos del propio personaje entre sí.

/** Cuántos turnos previos del personaje se comparan para derivar sus palabras temáticas. */
export const VARIETY_RECENT_TURNS = 3;
/** Una palabra es "temática" si aparece en al menos tantos de esos turnos. */
export const VARIETY_MIN_TURNS_WITH_WORD = 2;
/** Una respuesta es repetitiva si reutiliza al menos tantas palabras temáticas distintas. */
export const VARIETY_MIN_HITS = 2;

/**
 * Nota breve y genérica que se añade al FINAL del prompt (solo en el prompt construido, nunca se
 * guarda ni se muestra). No nombra al personaje ni su card: sirve igual con cualquiera.
 */
export const VARIETY_NOTE =
  'Note: vary your wording compared with your last replies; avoid reusing the same words or themes unless they truly fit what was just said.';

const MIN_WORD_LEN = 4;

const STOPWORDS = new Set([
  'that', 'this', 'with', 'from', 'have', 'has', 'had', 'been', 'were', 'was', 'are', 'will', 'would', 'could',
  'should', 'your', 'you', 'they', 'them', 'their', 'there', 'then', 'than', 'what', 'when', 'where', 'which',
  'while', 'about', 'into', 'just', 'like', 'some', 'more', 'most', 'very', 'much', 'many', 'also', 'even',
  'only', 'over', 'such', 'each', 'both', 'does', 'did', 'done', 'doing', 'here', 'want', 'wants', 'know',
  'because', 'really', 'still', 'again', 'maybe', 'yeah', 'well', 'okay', 'thing', 'things', 'don\'t', 'it\'s',
  'para', 'pero', 'como', 'esta', 'este', 'esto', 'esos', 'esas', 'porque', 'cuando', 'donde', 'aunque', 'sobre',
  'entre', 'desde', 'hasta', 'todo', 'todos', 'todas', 'tiene', 'tienen', 'muy', 'algo', 'ahora', 'tambien',
]);

function fold(text) {
  return String(text == null ? '' : text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

// Raíz aproximada, SOLO para comparar: junta "explore/explores/exploring/explored".
function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 4 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

function nameWords(names) {
  const set = new Set();
  for (const n of names || []) for (const w of fold(n).split(/[^\p{L}\p{N}]+/u)) if (w) set.add(w);
  return set;
}

/**
 * Palabras de contenido (raíces) de un texto: 4+ letras, sin stopwords ni nombres.
 * @param {string} text
 * @param {string[]} [names]  nombres del personaje y del usuario (no cuentan).
 * @returns {Set<string>}
 */
export function contentStems(text, names = []) {
  const skip = nameWords(names);
  const out = new Set();
  for (const raw of fold(text).split(/[^\p{L}\p{N}']+/u)) {
    const token = raw.replace(/^'+|'+$/g, '');
    if (token.length < MIN_WORD_LEN || STOPWORDS.has(token) || skip.has(token)) continue;
    const s = stem(token);
    if (s.length >= MIN_WORD_LEN - 1) out.add(s);
  }
  return out;
}

/**
 * Palabras temáticas: las que aparecen en al menos VARIETY_MIN_TURNS_WITH_WORD de los últimos
 * VARIETY_RECENT_TURNS turnos del personaje. Con menos de VARIETY_RECENT_TURNS turnos no hay
 * suficiente historia y devuelve [].
 * @param {string[]} charTurns  Textos de los turnos del personaje, del más antiguo al más reciente.
 * @param {string[]} [names]
 * @returns {string[]}
 */
export function themeWords(charTurns, names = []) {
  const turns = (Array.isArray(charTurns) ? charTurns : []).slice(-VARIETY_RECENT_TURNS);
  if (turns.length < VARIETY_RECENT_TURNS) return [];
  const counts = new Map();
  for (const t of turns) for (const w of contentStems(t, names)) counts.set(w, (counts.get(w) || 0) + 1);
  return [...counts].filter(([, n]) => n >= VARIETY_MIN_TURNS_WITH_WORD).map(([w]) => w);
}

/**
 * ¿La respuesta nueva reutiliza las palabras temáticas de los turnos previos?
 * @param {string[]} previousCharTurns  Turnos del personaje ANTERIORES a la respuesta.
 * @param {string} reply
 * @param {string[]} [names]
 * @returns {{ repetitive: boolean, theme: string[], hits: string[] }}
 */
export function detectRepetition(previousCharTurns, reply, names = []) {
  const theme = themeWords(previousCharTurns, names);
  if (!theme.length) return { repetitive: false, theme, hits: [] };
  const present = contentStems(reply, names);
  const hits = theme.filter((w) => present.has(w));
  return { repetitive: hits.length >= VARIETY_MIN_HITS, theme, hits };
}

/**
 * Modo proactivo: ¿el ÚLTIMO turno del personaje ya fue repetitivo respecto de los tres anteriores?
 * Si sí, la respuesta siguiente lleva la nota de variedad.
 * @param {{ role: string, text: string }[]} messages  Historial del chat (roles 'user' | 'char').
 * @param {string[]} [names]
 * @returns {boolean}
 */
export function varietyNeeded(messages, names = []) {
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && m.role === 'char' && typeof m.text === 'string')
    .map((m) => m.text);
  if (turns.length < VARIETY_RECENT_TURNS + 1) return false;
  const last = turns[turns.length - 1];
  return detectRepetition(turns.slice(0, -1), last, names).repetitive;
}
