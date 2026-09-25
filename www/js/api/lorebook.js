// www/js/api/lorebook.js
// Subsistema de memoria/lorebook automático (ver docs/CONTRACT-LOREBOOK.md).
// Puro: no importa nada, no toca el DOM ni hace peticiones de red. Arma el
// prompt de extracción, parsea/valida la respuesta del modelo y decide qué
// entradas se inyectan en el prompt real de roleplay.

/**
 * @typedef {Object} LoreEntry
 * @property {string} id
 * @property {string[]} keys        // palabras/frases que activan esta entrada
 * @property {string} content       // el hecho en sí, en texto plano, conciso
 * @property {number} updated       // ms desde epoch
 * @property {'auto'|'manual'} source  // 'auto' = generado por este sistema
 * @property {boolean} [always]     // MEM-004: siempre presente (sin keys); implica source:'manual'
 */

// Cada cuántos mensajes nuevos de un chat se dispara una actualización
// automática del lorebook de su personaje. Único lugar donde vive este
// número. Bajó de 40 a 20 (MEM-001 v2) para que cada actualización trabaje
// con una ventana pequeña: el servidor real (ver docs/NOTES.md, "Perfil del
// servidor") responde a lo sumo 160 tokens por petición.
export const LOREBOOK_UPDATE_EVERY_MESSAGES = 20;

// Máximo de mensajes (los más recientes) que ve una extracción, sea
// automática o manual ("Actualizar memoria ahora").
export const LOREBOOK_EXTRACT_WINDOW_MESSAGES = 20;

// Una extracción pide como máximo estas entradas nuevas o actualizadas, cada
// una de a lo más LOREBOOK_EXTRACT_ENTRY_CHARS caracteres (en el prompt; el
// tope duro al guardar sigue siendo LOREBOOK_MAX_ENTRY_CHARS).
export const LOREBOOK_EXTRACT_MAX_NEW_ENTRIES = 3;
export const LOREBOOK_EXTRACT_ENTRY_CHARS = 140;

// Tokens de salida que se piden. MEDIDO (docs/NOTES.md, Paso 0 de MEM-001
// v2): el servidor del usuario corta CADA respuesta a 160 tokens
// (--genlimit 160) sin importar el max_length pedido, y en /api/v1/generate
// corta además en el primer salto de línea.
export const LOREBOOK_EXTRACT_MAX_TOKENS = 160;

// Estimación CONSERVADORA de caracteres por token para armar la ventana
// (prompt.js usa 3.3 para el chat; aquí 3.0 para no pasarnos del contexto).
export const LOREBOOK_EXTRACT_CHARS_PER_TOKEN = 3;
const EXTRACT_SAFETY_TOKENS = 64;

// "Actualizar memoria ahora" no hace nada útil con menos mensajes que estos.
export const LOREBOOK_MANUAL_MIN_MESSAGES = 4;

// El prompt termina con este texto ya escrito ("prefill") para que el modelo
// siga en la MISMA línea: si empieza con un salto de línea, el servidor corta
// la respuesta ahí y no llega nada (medido: 5 de 6 respuestas quedaron
// vacías con el prompt anterior, que terminaba en "JSON:").
export const LOREBOOK_EXTRACT_PREFILL = '[';

// Tope de entradas guardadas por personaje (compartidas entre todos sus
// chats) y de caracteres por entrada: evita que el lorebook crezca sin
// límite y se coma el presupuesto de contexto.
export const LOREBOOK_MAX_ENTRIES = 24;
export const LOREBOOK_MAX_ENTRY_CHARS = 320;

// Tope duro de caracteres inyectados en el prompt real por turno para las
// entradas "por tema" (~250-300 tokens con la heurística CHARS_PER_TOKEN de
// prompt.js). Es el tope máximo: con recuerdos "siempre presentes" en uso se
// reduce para que la suma no pase de LOREBOOK_TOTAL_CHAR_BUDGET (ver
// `loreTopicBudget`); sin ellos, todo sigue exactamente como antes.
export const LOREBOOK_INJECT_CHAR_BUDGET = 1000;

// MEM-004. Tope de caracteres de los recuerdos "siempre presentes" (estables,
// van en cada turno) y suma máxima de ambos bloques (~340 tokens).
export const LOREBOOK_ALWAYS_CHAR_BUDGET = 500;
export const LOREBOOK_TOTAL_CHAR_BUDGET = 1200;

// Cuántos de los últimos mensajes se escanean buscando coincidencias de
// `keys` antes de armar cada respuesta (no todo el historial: sería caro).
export const LOREBOOK_SCAN_LAST_MESSAGES = 3;

// Temperatura baja para la llamada de extracción: acá se busca extracción
// confiable de hechos, no creatividad, independiente de settings.temp.
export const LOREBOOK_EXTRACT_TEMP = 0.3;

/**
 * Decide si toca disparar, a partir de este chat, una actualización del
 * lorebook (compartido) de su personaje.
 * @param {{ lorebookMessageCount?: number }} chat
 * @param {number} messageCount  Cantidad de mensajes que tiene el chat ahora.
 * @returns {boolean}
 */
export function shouldUpdateLorebook(chat, messageCount) {
  const since = (messageCount || 0) - ((chat && chat.lorebookMessageCount) || 0);
  return since >= LOREBOOK_UPDATE_EVERY_MESSAGES;
}

function collapse(text) {
  return String(text || '').replace(/\s+/g, ' ').trim();
}

function normKey(k) {
  return collapse(k).toLowerCase();
}

function newLoreId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dedupeKey(content) {
  return collapse(content).toLowerCase();
}

/* ---------- prompt de extracción (aditivo, una línea, corto) ---------- */

/**
 * Recorta una lista de líneas de transcripción dejando las MÁS RECIENTES que
 * entran en `budgetChars` (descarta desde la más antigua). Si ni la última
 * entra, devuelve esa última recortada (nunca devuelve una ventana vacía
 * habiendo mensajes). Pura.
 * @param {string[]} lines
 * @param {number} budgetChars
 * @returns {string[]}
 */
export function fitExtractionWindow(lines, budgetChars) {
  const list = Array.isArray(lines) ? lines : [];
  const kept = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const cost = list[i].length + 1;
    if (used + cost > budgetChars) break;
    used += cost;
    kept.unshift(list[i]);
  }
  if (!kept.length && list.length) {
    kept.push(list[list.length - 1].slice(-Math.max(200, budgetChars)));
  }
  return kept;
}

function transcriptLines(messages, charName, userName) {
  return (messages || []).map((m) => `${m.role === 'user' ? userName : charName}: ${collapse(m.text)}`);
}

const KNOWN_KEYS_MAX_CHARS = 600;

/**
 * Arma el prompt (texto simple, para una llamada de completado sin
 * streaming) que le pide al modelo hasta LOREBOOK_EXTRACT_MAX_NEW_ENTRIES
 * entradas NUEVAS en UNA sola línea (arreglo JSON compacto con campos cortos
 * `k`/`c`). Es aditivo: el modelo no reescribe la lista, y las entradas ya
 * existentes solo entran como lista de keys para evitar duplicados.
 *
 * Solo incluye los mensajes de `windowMessages` (máx.
 * LOREBOOK_EXTRACT_WINDOW_MESSAGES, los más recientes), recortados desde el
 * más antiguo para que todo quepa en `settings.ctx` reservando la salida
 * (LOREBOOK_EXTRACT_MAX_TOKENS) y un margen. El texto termina con
 * LOREBOOK_EXTRACT_PREFILL: quien llama debe anteponerlo a la respuesta
 * antes de parsear (ver `parseExtractionResponse`).
 *
 * @param {import('../state.js').Character} character
 * @param {import('../state.js').Settings} settings
 * @param {import('../state.js').Message[]} windowMessages
 * @param {LoreEntry[]} [existingEntries]
 * @returns {string}
 */
export function buildExtractionPrompt(character, settings, windowMessages, existingEntries = []) {
  const N = character.card.name;
  const U = (settings && settings.user) || 'User';
  const ctx = (settings && settings.ctx) || 4096;

  const known = (existingEntries || [])
    .map((e) => (Array.isArray(e.keys) ? e.keys.join(', ') : ''))
    .filter(Boolean)
    .join(' | ')
    .slice(0, KNOWN_KEYS_MAX_CHARS);

  const head = [
    `You extract long-term memory notes from a roleplay chat between ${N} and ${U}.`,
    `From the excerpt below, write up to ${LOREBOOK_EXTRACT_MAX_NEW_ENTRIES} NEW concrete facts worth remembering: ` +
      `specific things that happened or that ${U} said about ${U}'s real life (details, tastes, people, pets, places, dates, plans), ` +
      `or a specific moment that changed how ${U} and ${N} relate. ` +
      `Skip small talk, fleeting moments, vague personality traits and anything already known.`,
    `Write each fact as one complete third-person sentence that names BOTH who does or feels something and who or what it is about, ` +
      `using the real names "${U}" and "${N}" (never "I", "my", "he", "she", "they" or "the user", never a single word), ` +
      `with the concrete detail, like "${U} told ${N} that the dog Bruno is afraid of thunder". ` +
      `At most ${LOREBOOK_EXTRACT_ENTRY_CHARS} characters, in the same language as the conversation.`,
    `For each fact give 1 to 3 keywords about its topic: single lowercase words, never two words joined together (concrete nouns or topics likely to come up again in the chat). ` +
      `Then, if ${U}'s own lines in the excerpt contain a distinctive noun or verb about that fact, add 1 more keyword copied EXACTLY as ${U} wrote it; if there is no clear one, skip it. ` +
      `Never use the names "${N}" or "${U}" as keywords, nor generic words like "personality", "person", "likes" or "feelings". ` +
      `Put every keyword in double quotes.`,
    `Reply with ONE line only: a compact JSON array with no line breaks and no markdown, like ` +
      `[{"k":["bruno","thunder","hides"],"c":"${U} told ${N} that the dog Bruno is afraid of thunder"}], one fact per object. ` +
      `If there is nothing new worth remembering, reply [].`,
    known ? `Already known (keywords only, do not repeat these facts): ${known}` : '',
    'Excerpt:',
  ].filter(Boolean).join('\n\n');
  const tail = `\n\nReply:\n${LOREBOOK_EXTRACT_PREFILL}`;

  const budgetTokens = ctx - LOREBOOK_EXTRACT_MAX_TOKENS - EXTRACT_SAFETY_TOKENS;
  const budgetChars =
    Math.floor(budgetTokens * LOREBOOK_EXTRACT_CHARS_PER_TOKEN) - head.length - tail.length - 2;

  const recent = (windowMessages || []).slice(-LOREBOOK_EXTRACT_WINDOW_MESSAGES);
  const lines = fitExtractionWindow(transcriptLines(recent, N, U), budgetChars);

  return `${head}\n${lines.join('\n')}${tail}`;
}

/* ---------- parseo tolerante de la respuesta ---------- */

const KEYS_FIELDS = ['keys', 'k', 'key', 'keywords'];
const CONTENT_FIELDS = ['content', 'c', 'fact', 'text'];
const WRAPPER_FIELDS = ['entries', 'lorebook', 'facts', 'items'];

function pickField(obj, names) {
  for (const n of names) if (obj[n] !== undefined) return obj[n];
  return undefined;
}

function isEntryLike(obj) {
  return !!obj && typeof obj === 'object' && !Array.isArray(obj) &&
    pickField(obj, KEYS_FIELDS) !== undefined && pickField(obj, CONTENT_FIELDS) !== undefined;
}

// Aplana un valor ya parseado a una lista de entradas crudas normalizadas al
// nombre largo de campo. Acepta un arreglo, un objeto suelto o un envoltorio
// `{"entries":[…]}`. No valida el contenido de los campos.
function collectEntries(value) {
  if (Array.isArray(value)) return value.flatMap(collectEntries);
  if (!value || typeof value !== 'object') return [];
  if (isEntryLike(value)) {
    return [{ keys: pickField(value, KEYS_FIELDS), content: pickField(value, CONTENT_FIELDS) }];
  }
  for (const w of WRAPPER_FIELDS) {
    if (Array.isArray(value[w])) return collectEntries(value[w]);
  }
  return [];
}

// Índice del `}` que cierra el `{` de `start`, o -1 si el texto se corta
// antes. Respeta comillas y escapes de cadenas JSON.
function findObjectEnd(text, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === '\\') escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}

// Pone comillas a los elementos de un arreglo de keys que el modelo escribió
// sin ellas. Solo se usa como último recurso, cuando el JSON no parseó.
function repairBareKeys(objText) {
  return objText.replace(/("(?:k|keys|key|keywords)"\s*:\s*\[)([^\]]*)\]/g, (m, head, body) => {
    const items = body.split(',').map((x) => x.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
    return head + items.map((x) => JSON.stringify(x)).join(',') + ']';
  });
}

// Rescata los objetos COMPLETOS de un texto que puede estar cortado a la
// mitad (el servidor corta a 160 tokens o en el primer salto de línea). Un
// `{` que nunca cierra se salta para mirar adentro (envoltorio truncado).
function rescueObjects(text) {
  const found = [];
  let i = 0;
  while (i < text.length) {
    if (text[i] !== '{') {
      i++;
      continue;
    }
    const end = findObjectEnd(text, i);
    if (end < 0) {
      i++;
      continue;
    }
    const candidate = text.slice(i, end + 1);
    try {
      found.push(JSON.parse(candidate));
      i = end + 1;
    } catch {
      // Error típico del modelo: keys sin comillas (`"k":[Laura, sister]`).
      try {
        found.push(JSON.parse(repairBareKeys(candidate)));
        i = end + 1;
      } catch {
        i++;
      }
    }
  }
  return found;
}

/**
 * Parsea la respuesta cruda del modelo (ya con el prefill antepuesto) a
 * entradas crudas `{ keys, content }`. Nunca lanza. Acepta: arreglo en una
 * línea, `{"entries":[…]}`, un objeto suelto, nombres de campo cortos
 * (`k`/`c`) y largos (`keys`/`content`), texto alrededor, y un arreglo
 * TRUNCADO (rescata los objetos completos). `[]` es una respuesta válida
 * ("sin novedades") y devuelve `[]`.
 * @param {string} rawText
 * @returns {{keys: any, content: any}[]|null} null = respuesta no reconocible ("sin cambios").
 */
export function parseExtractionResponse(rawText) {
  const text = String(rawText || '').trim();
  if (!text) return null;

  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return collectEntries(value);
    const entries = collectEntries(value);
    if (entries.length) return entries;
    if (value && typeof value === 'object' && WRAPPER_FIELDS.some((w) => Array.isArray(value[w]))) return [];
  } catch {
    // no es JSON completo: se intenta rescatar objetos sueltos
  }

  const rescued = rescueObjects(text).flatMap(collectEntries);
  if (rescued.length) return rescued;

  // Un `[]` (con texto alrededor) también es "sin novedades", no "no entendida".
  if (/\[\s*\]/.test(text) && !/[{]/.test(text)) return [];
  return null;
}

/* ---------- aplicación aditiva ---------- */

const MAX_KEYS_PER_ENTRY = 6;
const MAX_KEY_CHARS = 40;
const MERGE_MIN_OVERLAP = 0.5;

/* ---------- MEM-003: higiene de keys, comparación de contenido y fusión ---------- */

// Máximo de keys de una entrada AUTOMÁTICA tras la higiene (las manuales no se tocan).
export const LOREBOOK_KEYS_MAX = 4;

// Fusión de casi-duplicados: dos entradas `auto` se fusionan si comparten al
// menos LOREBOOK_MERGE_MIN_SHARED palabras de contenido Y esas palabras son al
// menos LOREBOOK_MERGE_OVERLAP de las de la entrada más corta (coeficiente de
// solapamiento). Valor final 0,6 (el sugerido): con los 4 recuerdos reales de
// "physical touch" da 0,67 y 1,0; con hechos distintos, 0 a 0,25. Ver HISTORIAL.
export const LOREBOOK_MERGE_OVERLAP = 0.6;
export const LOREBOOK_MERGE_MIN_SHARED = 2;

// Un hecho automático con menos palabras que esto ("Laura") no es un recuerdo.
export const LOREBOOK_MIN_CONTENT_WORDS = 3;

// Palabras que NO sirven como keys: aparecen en casi cualquier conversación
// (o describen "tipo de dato" en vez de un tema). Se escriben en forma base,
// en minúsculas y sin acentos; `isGenericWord` también reconoce sus plurales y
// conjugaciones simples (loves, loved, enjoys, traits…).
export const LORE_GENERIC_KEYWORDS = Object.freeze([
  'personality', 'person', 'people', 'user', 'character', 'characteristic', 'trait', 'fact', 'emotion',
  'feeling', 'feel', 'thing', 'like', 'love', 'enjoy', 'memory', 'note', 'info', 'information',
  'personalidad', 'persona', 'usuario', 'personaje', 'caracteristica', 'rasgo', 'hecho', 'emocion',
  'sentimiento', 'cosa', 'gusta', 'gustan', 'encanta', 'encantan', 'disfruta', 'quiere',
]);
const GENERIC_WORDS = new Set(LORE_GENERIC_KEYWORDS);

// Stopwords básicas (inglés y español), sin acentos. Solo importan las de 3+
// letras: las más cortas ya se descartan por longitud.
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'his', 'her', 'has', 'have', 'was', 'were', 'are', 'from',
  'their', 'they', 'about', 'into', 'who', 'which', 'been', 'also', 'when', 'what', 'where', 'while', 'than',
  'then', 'them', 'its', 'but', 'not', 'can', 'will', 'would', 'could', 'should', 'does', 'did', 'how', 'why',
  'our', 'your', 'you', 'she', 'him', 'other', 'others', 'some', 'any', 'each', 'very', 'more', 'most', 'over',
  'under', 'after', 'before', 'because', 'too', 'out', 'off', 'again', 'once', 'him', 'himself', 'herself',
  'los', 'las', 'una', 'uno', 'unos', 'unas', 'por', 'con', 'que', 'del', 'sus', 'para', 'como', 'esta', 'este',
  'son', 'sobre', 'entre', 'desde', 'hasta', 'pero', 'muy', 'mas', 'cuando', 'donde', 'todo', 'todos', 'todas',
  'tiene', 'tienen', 'ser', 'fue', 'era', 'ese', 'esa', 'eso', 'les', 'nos', 'algo', 'otro', 'otra', 'otros',
  'otras', 'cada', 'tambien', 'porque', 'sin', 'ella', 'ellos', 'ellas', 'mis', 'tus', 'suyo', 'suya',
]);

// Sujetos que, solos y sin ningún nombre propio en la frase, no dicen de quién se habla.
// La primera persona (I, my, yo, mi…) se añadió tras medirla contra el servidor real:
// el modelo a veces copia la frase del usuario ("My neighbor lent me her ladder").
const SUBJECT_PRONOUNS = new Set([
  'he', 'she', 'they', 'él', 'ella', 'ellos', 'ellas',
  'i', 'we', 'my', 'our', 'yo', 'mi', 'mis', 'nosotros', 'nosotras',
]);

const WORD_SPLIT = /[^\p{L}\p{N}\p{M}]+/u;

// Minúsculas y sin acentos, solo para COMPARAR (lo guardado conserva sus acentos).
function foldText(text) {
  return String(text == null ? '' : text).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '').normalize('NFC');
}

function isLatinWord(word) {
  return /^[\p{Script=Latin}\p{N}\p{M}]+$/u.test(word);
}

function hasNonLatinLetter(text) {
  for (const ch of String(text || '')) {
    if (/\p{L}/u.test(ch) && !/\p{Script=Latin}/u.test(ch)) return true;
  }
  return false;
}

function baseForms(word) {
  const forms = [word];
  for (const suffix of ['s', 'es', 'd', 'ed', 'ing']) {
    if (word.length - suffix.length >= 3 && word.endsWith(suffix)) forms.push(word.slice(0, -suffix.length));
  }
  return forms;
}

/**
 * ¿Es una palabra demasiado genérica para servir de key? (`word` ya sin
 * acentos y en minúsculas; reconoce plurales y conjugaciones simples).
 * @param {string} word
 * @returns {boolean}
 */
export function isGenericWord(word) {
  return baseForms(word).some((f) => GENERIC_WORDS.has(f));
}

function nameWordSet(names) {
  const set = new Set();
  for (const name of names || []) {
    for (const w of foldText(name).split(WORD_SPLIT)) if (w) set.add(w);
  }
  return set;
}

// Palabras "usables" de un texto (para keys o para comparar contenido): sin
// stopwords, nombres ni genéricas y con 3+ letras. Las palabras de escrituras
// no latinas (japonés, coreano…) no se pueden filtrar así y se dejan tal cual.
// Devuelve [{ text (minúsculas, con acentos), folded, pos }] en orden de aparición.
function usableWords(text, nameWords) {
  const out = [];
  const seen = new Set();
  const lower = String(text || '').toLowerCase().normalize('NFC');
  let pos = 0;
  for (const token of lower.split(WORD_SPLIT)) {
    if (!token) continue;
    pos++;
    let folded = token;
    if (isLatinWord(token)) {
      folded = foldText(token);
      if (folded.length < 3 || STOPWORDS.has(folded) || nameWords.has(folded) || isGenericWord(folded)) continue;
    }
    if (seen.has(folded)) continue;
    seen.add(folded);
    out.push({ text: token, folded, pos });
  }
  return out;
}

// Deriva hasta 2 keys de las palabras de contenido más distintivas (las más
// largas; a igual largo, las más tardías, que en una frase suelen ser el
// sustantivo), devueltas en su orden de aparición.
function deriveKeys(content, nameWords) {
  return usableWords(content, nameWords)
    .sort((a, b) => b.folded.length - a.folded.length || b.pos - a.pos)
    .slice(0, 2)
    .sort((a, b) => a.pos - b.pos)
    .map((w) => w.text.slice(0, MAX_KEY_CHARS));
}

/**
 * Higiene DETERMINISTA de las keys de una entrada AUTOMÁTICA (no se aplica a
 * lo que el usuario escribe a mano). Divide las frases en palabras sueltas,
 * minúsculas, y quita stopwords (inglés/español), los nombres de los personajes
 * (`opts.names`), las palabras genéricas (`LORE_GENERIC_KEYWORDS`) y todo lo de
 * menos de 3 letras. Sin duplicados (sin distinguir acentos) y como máximo
 * LOREBOOK_KEYS_MAX. Si no queda ninguna, deriva 2 keys del propio `content`.
 * Las palabras de escrituras no latinas se dejan tal cual. Pura; nunca lanza.
 * @param {string[]|string} keys
 * @param {string} content
 * @param {{ names?: string[] }} [opts]
 * @returns {string[]}  [] solo si ni las keys ni el contenido aportan palabras útiles.
 */
export function normalizeLoreKeys(keys, content, opts = {}) {
  const nameWords = nameWordSet(opts.names);
  const list = Array.isArray(keys) ? keys : keys == null ? [] : [keys];
  const out = [];
  const seen = new Set();
  for (const raw of list) {
    for (const w of usableWords(raw, nameWords)) {
      if (seen.has(w.folded)) continue;
      seen.add(w.folded);
      out.push(w.text.slice(0, MAX_KEY_CHARS));
      if (out.length >= LOREBOOK_KEYS_MAX) return out;
    }
  }
  return out.length ? out : deriveKeys(content, nameWords);
}

/**
 * ¿El hecho arranca con un sujeto que es solo un pronombre ("He loves…",
 * "Ella dice…", "My neighbor…") y no nombra a nadie en toda la frase? Un recuerdo así no dice
 * de quién habla y no se guarda. ("él" con acento es pronombre; "el" sin
 * acento puede ser artículo y NO cuenta.)
 * @param {string} content
 * @param {string[]} [names]  Nombres del usuario y del personaje.
 * @returns {boolean}
 */
export function isUnnamedPronounFact(content, names = []) {
  const text = collapse(content).toLowerCase().normalize('NFC');
  const first = (text.match(/\p{L}+/u) || [''])[0];
  if (!SUBJECT_PRONOUNS.has(first)) return false;
  const nameWords = nameWordSet(names);
  const words = foldText(text).split(WORD_SPLIT);
  return !words.some((w) => nameWords.has(w));
}

// Raíz aproximada, SOLO para comparar (nunca se guarda): quita plural (`s`, `ies`), `ed`/`ing` y
// una `e` final, y desdobla la consonante doble ("stopped" → "stop"). MEM-005: sin esto
// "invite" / "invited" / "inviting" contaban como palabras distintas y dos frases del mismo hecho
// no se fusionaban. Solo se aplica a palabras latinas (las demás se comparan tal cual).
function stemLite(word) {
  let w = word;
  if (w.length > 4 && w.endsWith('ies')) w = w.slice(0, -3) + 'y';
  else if (w.length > 3 && w.endsWith('s') && !w.endsWith('ss')) w = w.slice(0, -1);
  if (w.length > 5 && w.endsWith('ing')) w = w.slice(0, -3);
  else if (w.length > 4 && w.endsWith('ed')) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  if (w.length > 3 && /([^aeiou])\1$/.test(w) && !w.endsWith('ss') && !w.endsWith('ll')) w = w.slice(0, -1);
  return w;
}

function contentWords(text, nameWords) {
  return new Set(usableWords(text, nameWords).map((w) => (isLatinWord(w.text) ? stemLite(w.folded) : w.folded)));
}

function overlapStats(a, b, nameWords) {
  const A = contentWords(a, nameWords);
  const B = contentWords(b, nameWords);
  const smaller = Math.min(A.size, B.size);
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return { shared, ratio: smaller ? shared / smaller : 0, sizeA: A.size, sizeB: B.size };
}

function wordOverlap(a, b, nameWords) {
  return overlapStats(a, b, nameWords).ratio;
}

// MEM-005: con las mismas keys (2 o más, en cualquier orden) la mitad de solapamiento ya basta.
export const LOREBOOK_MERGE_OVERLAP_SAME_KEYS = 0.5;

function keySet(keys) {
  return new Set((Array.isArray(keys) ? keys : []).map((k) => foldText(collapse(k))).filter(Boolean));
}

function haveSameKeys(keysA, keysB) {
  const A = keySet(keysA);
  const B = keySet(keysB);
  return A.size >= 2 && A.size === B.size && [...A].every((k) => B.has(k));
}

/**
 * ¿Dos contenidos hablan de lo mismo? (coeficiente de solapamiento sobre
 * palabras de contenido ≥ LOREBOOK_MERGE_OVERLAP y al menos
 * LOREBOOK_MERGE_MIN_SHARED palabras compartidas.) MEM-005: si se pasan las keys
 * de las dos entradas (`opts.keysA`, `opts.keysB`) y son las mismas (2 o más),
 * el umbral baja a LOREBOOK_MERGE_OVERLAP_SAME_KEYS.
 * @param {string} a
 * @param {string} b
 * @param {string[]} [names]
 * @param {{ keysA?: string[], keysB?: string[] }} [opts]
 * @returns {boolean}
 */
export function areNearDuplicates(a, b, names = [], opts = {}) {
  const stats = overlapStats(a, b, nameWordSet(names));
  const threshold = haveSameKeys(opts.keysA, opts.keysB) ? LOREBOOK_MERGE_OVERLAP_SAME_KEYS : LOREBOOK_MERGE_OVERLAP;
  return stats.shared >= LOREBOOK_MERGE_MIN_SHARED && stats.ratio >= threshold;
}

// Cuál de dos contenidos se conserva al fusionar: el de más palabras de
// contenido; a igualdad, el más largo; a igualdad, `a`.
function moreInformative(a, b, nameWords) {
  const wa = contentWords(a, nameWords).size;
  const wb = contentWords(b, nameWords).size;
  if (wa !== wb) return wa > wb ? a : b;
  return b.length > a.length ? b : a;
}

function sameKeys(a, b) {
  return a.length === b.length && a.every((k, i) => k === b[i]);
}

/**
 * Fusiona casi-duplicados entre las entradas `auto` de `entries` (las `manual`
 * NUNCA se tocan ni absorben a otras). La entrada que queda conserva el `id`
 * de la primera, el contenido más informativo, la unión de keys (normalizadas)
 * y `updated` = `now`. Pura; no muta lo recibido.
 * @param {LoreEntry[]} entries
 * @param {{ names?: string[], now?: number }} [opts]
 * @returns {{ entries: LoreEntry[], merged: number }}
 */
export function mergeNearDuplicates(entries, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const names = opts.names || [];
  const nameWords = nameWordSet(names);
  const out = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ ...e, keys: Array.isArray(e.keys) ? e.keys.slice() : [] }));
  let merged = 0;
  let again = true;
  while (again) {
    again = false;
    outer: for (let i = 0; i < out.length; i++) {
      if (out[i].source === 'manual') continue;
      for (let j = i + 1; j < out.length; j++) {
        if (out[j].source === 'manual') continue;
        if (!areNearDuplicates(out[i].content, out[j].content, names, { keysA: out[i].keys, keysB: out[j].keys })) continue;
        const content = moreInformative(out[i].content, out[j].content, nameWords);
        const keys = normalizeLoreKeys([...out[i].keys, ...out[j].keys], content, { names });
        out[i] = { ...out[i], content, keys: keys.length ? keys : out[i].keys, updated: now };
        out.splice(j, 1);
        merged++;
        again = true;
        break outer;
      }
    }
  }
  return { entries: out, merged };
}

/**
 * "Limpiar recuerdos": aplica la higiene de keys y la fusión de casi-duplicados
 * a las entradas `auto` EXISTENTES (las `manual` no se tocan). NUNCA borra
 * un recuerdo salvo al fusionarlo con otro. Pura.
 * @param {LoreEntry[]} entries
 * @param {{ names?: string[], now?: number }} [opts]
 * @returns {{ entries: LoreEntry[], cleaned: number, merged: number, changed: boolean }}
 *   `cleaned` = recuerdos que quedan con keys distintas; `merged` = recuerdos absorbidos por otro.
 */
export function cleanupLorebook(entries, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const names = opts.names || [];
  const original = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  const before = new Map(original.map((e) => [e.id, Array.isArray(e.keys) ? e.keys : []]));

  const normalized = original.map((e) => {
    if (e.source === 'manual') return e;
    const keys = normalizeLoreKeys(e.keys, e.content, { names });
    return keys.length ? { ...e, keys } : e;
  });
  const result = mergeNearDuplicates(normalized, { names, now });

  let cleaned = 0;
  for (const e of result.entries) {
    if (e.source === 'manual') continue;
    if (!sameKeys(e.keys, before.get(e.id) || [])) cleaned++;
  }
  return { entries: result.entries, cleaned, merged: result.merged, changed: cleaned + result.merged > 0 };
}

/**
 * Ejecuta "Limpiar recuerdos" sobre el lorebook GUARDADO: lo lee, lo limpia
 * (`cleanupLorebook`) y, SOLO si algo cambió, lo guarda pasando el estado de
 * antes como copia (`previous`), de modo que "Deshacer última actualización"
 * lo restaura. Si no hay nada que limpiar no escribe nada (así tampoco pisa la
 * copia de una actualización anterior). Si `save` falla, lanza y no queda
 * nada a medias (un solo guardado).
 * @param {{
 *   load: () => Promise<LoreEntry[]>,
 *   save: (entries: LoreEntry[], previous: LoreEntry[]) => Promise<void>,
 *   names?: string[],
 *   now?: number,
 * }} deps
 * @returns {Promise<{ cleaned: number, merged: number, changed: boolean }>}
 */
export async function cleanStoredLorebook(deps) {
  const before = await deps.load();
  const result = cleanupLorebook(before, { names: deps.names, now: deps.now });
  if (result.changed) await deps.save(result.entries, before);
  return { cleaned: result.cleaned, merged: result.merged, changed: result.changed };
}

// MEM-005: pronombres de primera persona (inglés y español). Un recuerdo escrito con ellos ("Sam told me
// that my dog…") no dice de quién habla aunque nombre a alguien, porque "yo" era el usuario o el personaje
// según quien lo copió. Las formas con acento o apóstrofe se normalizan antes de comparar.
const FIRST_PERSON_WORDS = new Set([
  'i', 'me', 'my', 'mine', 'myself', 'we', 'us', 'our', 'ours', 'ourselves',
  'yo', 'mi', 'mis', 'nosotros', 'nosotras', 'nuestro', 'nuestra', 'nuestros', 'nuestras',
]);

/**
 * ¿El hecho está escrito en primera persona (I, my, we, yo, mi…) FUERA de comillas? Lo que va entre
 * comillas es una cita textual ("Sam told Mia: \"I am afraid\"") y no cuenta. Pura.
 * @param {string} content
 * @returns {boolean}
 */
export function hasFirstPersonVoice(content) {
  const outside = String(content || '').replace(/"[^"]*"|“[^”]*”/g, ' ');
  for (const token of foldText(outside).replace(/[’‘]/g, "'").split(/[^\p{L}\p{N}']+/u)) {
    const word = token.replace(/^'+|'+$/g, '').replace(/'(m|ve|ll|d|re)$/, '');
    if (FIRST_PERSON_WORDS.has(word)) return true;
  }
  return false;
}

// Valida y acota UNA entrada cruda del modelo. null si no sirve (incluye los
// hechos sin nombre, los escritos en primera persona y los de menos de LOREBOOK_MIN_CONTENT_WORDS palabras).
function normalizeIncoming(raw, names) {
  if (!raw || typeof raw !== 'object') return null;
  const rawContent = pickField(raw, CONTENT_FIELDS);
  const content = typeof rawContent === 'string' ? collapse(rawContent).slice(0, LOREBOOK_MAX_ENTRY_CHARS) : '';
  if (!content) return null;
  if (content.split(/\s+/).length < LOREBOOK_MIN_CONTENT_WORDS) return null;
  if (isUnnamedPronounFact(content, names)) return null;
  if (hasFirstPersonVoice(content)) return null;

  let rawKeys = pickField(raw, KEYS_FIELDS);
  if (typeof rawKeys === 'string') rawKeys = [rawKeys];
  if (!Array.isArray(rawKeys)) return null;
  const keys = normalizeLoreKeys(rawKeys, content, { names });
  return keys.length ? { keys, content } : null;
}

/**
 * Aplica, de forma ADITIVA y pura, las entradas de una extracción a las
 * entradas anteriores (no modifica los arreglos recibidos):
 *  - agrega las nuevas (máx. LOREBOOK_EXTRACT_MAX_NEW_ENTRIES por llamada);
 *  - si una nueva comparte al menos una key con una entrada `auto` existente
 *    Y habla claramente de lo mismo (≥ 50 % de palabras de contenido en
 *    común), ACTUALIZA su contenido y une las keys en lugar de duplicar. Si
 *    comparte la key pero es otro hecho ("works" en "trabaja en una panadería"
 *    y en "su hermana trabaja en un hospital"), se agrega aparte: reemplazar
 *    borraría un recuerdo distinto;
 *  - NUNCA elimina ni reduce entradas, salvo al pasarse de
 *    LOREBOOK_MAX_ENTRIES: entonces descarta primero las `auto` más antiguas
 *    por `updated` (nunca las recién tocadas ni las `manual`); si no hay
 *    cuál descartar, se descartan las nuevas que no caben;
 *  - las entradas `manual` NUNCA se modifican ni eliminan.
 * Los nombres en `opts.ignoreKeys` (usuario y personaje) se quitan de las keys
 * nuevas y no cuentan para decidir si dos entradas coinciden.
 * MEM-003: las entradas nuevas pasan por `normalizeLoreKeys`; un hecho cuyo
 * sujeto es solo un pronombre ("He loves…") o de menos de 3 palabras no se
 * guarda; y una nueva que hable de lo mismo que una `auto` existente (ver
 * `areNearDuplicates`) se fusiona con ella AUNQUE no compartan keys (se
 * conserva el contenido más informativo).
 * @param {LoreEntry[]} previousEntries
 * @param {object[]} incomingEntries  Salida de `parseExtractionResponse`.
 * @param {{ now?: number, ignoreKeys?: string[] }} [opts]
 * @returns {{ entries: LoreEntry[], added: number, updated: number, changed: boolean }}
 */
export function applyExtraction(previousEntries, incomingEntries, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const names = (opts.ignoreKeys || []).map(collapse).filter(Boolean);
  const nameWords = nameWordSet(names);
  const ignoreKeys = new Set(names.map(normKey));

  const entries = (Array.isArray(previousEntries) ? previousEntries : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ ...e, keys: Array.isArray(e.keys) ? e.keys.slice() : [] }));
  const touched = new Set();
  const addedIds = [];
  let updated = 0;

  const incoming = (Array.isArray(incomingEntries) ? incomingEntries : [])
    .map((raw) => normalizeIncoming(raw, names))
    .filter(Boolean)
    .slice(0, LOREBOOK_EXTRACT_MAX_NEW_ENTRIES);

  for (const inc of incoming) {
    const incKey = dedupeKey(inc.content);
    if (entries.some((e) => dedupeKey(e.content) === incKey)) continue;

    const sharesKey = (e) => e.keys.some((k) => !ignoreKeys.has(normKey(k)) && inc.keys.includes(normKey(k)));
    const byKey = entries.find(
      (e) => e.source !== 'manual' && sharesKey(e) && wordOverlap(e.content, inc.content, nameWords) >= MERGE_MIN_OVERLAP
    );
    const match = byKey || entries.find(
      (e) => e.source !== 'manual' && areNearDuplicates(e.content, inc.content, names, { keysA: e.keys, keysB: inc.keys })
    );
    if (match) {
      // Misma key y mismo tema: el hecho nuevo reemplaza al viejo (p. ej. una
      // fecha corregida). Sin key en común: se conserva el más informativo.
      match.content = byKey ? inc.content : moreInformative(match.content, inc.content, nameWords);
      const keys = normalizeLoreKeys([...match.keys, ...inc.keys], match.content, { names });
      if (keys.length) match.keys = keys;
      match.updated = now;
      touched.add(match);
      updated++;
      continue;
    }

    const entry = { id: newLoreId(), keys: inc.keys, content: inc.content, updated: now, source: 'auto' };
    entries.push(entry);
    touched.add(entry);
    addedIds.push(entry);
  }

  let added = addedIds.length;
  while (entries.length > LOREBOOK_MAX_ENTRIES) {
    const evictable = entries
      .filter((e) => e.source !== 'manual' && !touched.has(e))
      .sort((a, b) => (a.updated || 0) - (b.updated || 0))[0];
    if (evictable) {
      entries.splice(entries.indexOf(evictable), 1);
      continue;
    }
    const lastNew = addedIds.pop();
    if (!lastNew) break; // ya no queda nada que podamos quitar sin tocar lo existente
    entries.splice(entries.indexOf(lastNew), 1);
    touched.delete(lastNew);
    added--;
  }

  return { entries, added, updated, changed: added + updated > 0 };
}

/* ---------- edición manual ---------- */

/**
 * Convierte el texto de un campo "keys" ("perro, Bruno; parque") en una lista
 * normalizada (minúsculas, sin vacíos ni repetidos, tope MAX_KEYS_PER_ENTRY).
 * @param {string} text
 * @returns {string[]}
 */
export function parseKeysInput(text) {
  const keys = [];
  for (const part of String(text || '').split(/[,;\n]/)) {
    const key = normKey(part).slice(0, MAX_KEY_CHARS);
    if (key && !keys.includes(key)) keys.push(key);
  }
  return keys.slice(0, MAX_KEYS_PER_ENTRY + 2);
}

/**
 * Devuelve una copia de `entries` con la entrada `id` editada. Una entrada
 * editada pasa a `source:'manual'`, así la extracción automática ya no la
 * toca. `patch.always` (MEM-004; `true`/`false`, opcional: si falta no se
 * cambia) la marca o desmarca como "siempre presente". Pura; devuelve `null`
 * si el `id` no existe o los datos no son válidos (contenido o keys vacíos).
 * @param {LoreEntry[]} entries
 * @param {string} id
 * @param {{ content: string, keys: string[], always?: boolean }} patch
 * @param {number} [now]
 * @returns {LoreEntry[]|null}
 */
export function editLoreEntry(entries, id, patch, now = Date.now()) {
  const list = Array.isArray(entries) ? entries : [];
  const idx = list.findIndex((e) => e && e.id === id);
  if (idx < 0) return null;
  const content = collapse(patch && patch.content).slice(0, LOREBOOK_MAX_ENTRY_CHARS);
  const keys = Array.isArray(patch && patch.keys) ? patch.keys.map(normKey).filter(Boolean) : [];
  if (!content || !keys.length) return null;
  const out = list.slice();
  const edited = { ...list[idx], content, keys, updated: now, source: 'manual' };
  if (patch && patch.always === true) edited.always = true;
  else if (patch && patch.always === false) delete edited.always;
  out[idx] = edited;
  return out;
}

/**
 * Devuelve una copia de `entries` sin la entrada `id`. Pura.
 * @param {LoreEntry[]} entries
 * @param {string} id
 * @returns {LoreEntry[]}
 */
export function removeLoreEntry(entries, id) {
  return (Array.isArray(entries) ? entries : []).filter((e) => e && e.id !== id);
}

/* ---------- actualizador: prioridad al chat, sin competir con él ---------- */

function makeGenKey() {
  return 'LORE' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Crea el actualizador de memoria (extracción automática y manual). Vive
 * aquí, y no en la UI, para poder probar sin DOM ni red que:
 *  - NO inicia una extracción mientras hay una generación de chat en curso
 *    (`isChatBusy()`); `maybeRun()` simplemente devuelve `skipped` y quien
 *    llama lo reintenta al terminar la generación;
 *  - `abort()` cancela una extracción en curso (el chat tiene prioridad) sin
 *    avanzar el marcador ni guardar nada;
 *  - una respuesta vacía, no entendida o truncada nunca reduce el lorebook;
 *  - el marcador de progreso avanza si el servidor respondió (aunque no se
 *    entienda el texto) y NO avanza si falló la llamada, hubo abort o timeout.
 * El commit vuelve a leer el lorebook justo antes de guardar, así una edición
 * manual hecha durante la extracción no se pisa.
 *
 * Resultado de `maybeRun()`/`runNow()`: `{ kind, added?, updated? }` con `kind`
 * = `ok` | `nochange` | `unparsed` | `unavailable` | `aborted` | `error` |
 * `skipped` | `busy` | `toolittle`.
 *
 * @param {{
 *   getContext: () => ({ character: object, chat: object, messages: object[], settings: object }|null),
 *   isChatBusy: () => boolean,
 *   complete: (prompt: string, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number }) => Promise<string>,
 *   loadLorebook: (characterId: string) => Promise<LoreEntry[]>,
 *   saveLorebook: (characterId: string, entries: LoreEntry[], previous: LoreEntry[]) => Promise<void>,
 *   markProgress: (chatId: string, count: number) => Promise<void>,
 *   onStatus?: (status: { kind: string, added?: number, updated?: number, at: number }) => void,
 * }} deps
 */
export function createLoreUpdater(deps) {
  let running = null;
  let status = { kind: 'idle', at: 0 };

  function setStatus(kind, extra = {}) {
    status = { kind, at: Date.now(), ...extra };
    if (deps.onStatus) {
      try {
        deps.onStatus(status);
      } catch {
        // la UI nunca debe romper la extracción
      }
    }
    return { kind, ...extra };
  }

  async function run(ctx, windowMessages) {
    const controller = new AbortController();
    running = { controller };
    const { character, chat, messages, settings } = ctx;
    const characterId = character.id;
    const chatId = chat.id;
    const targetCount = messages.length;
    try {
      let existing;
      try {
        existing = await deps.loadLorebook(characterId);
      } catch {
        return setStatus('error');
      }
      if (controller.signal.aborted) return setStatus('aborted');

      const prompt = buildExtractionPrompt(character, settings, windowMessages, existing);
      let raw;
      try {
        raw = await deps.complete(prompt, {
          signal: controller.signal,
          genkey: makeGenKey(),
          maxLen: LOREBOOK_EXTRACT_MAX_TOKENS,
          temp: LOREBOOK_EXTRACT_TEMP,
        });
      } catch {
        return setStatus(controller.signal.aborted ? 'aborted' : 'unavailable');
      }
      if (controller.signal.aborted) return setStatus('aborted');

      const incoming = parseExtractionResponse(LOREBOOK_EXTRACT_PREFILL + String(raw || ''));
      let outcome = { kind: 'unparsed' };
      try {
        if (incoming) {
          const fresh = await deps.loadLorebook(characterId);
          const applied = applyExtraction(fresh, incoming, {
            ignoreKeys: [character.card.name, settings && settings.user],
          });
          if (applied.changed) await deps.saveLorebook(characterId, applied.entries, fresh);
          outcome = applied.changed
            ? { kind: 'ok', added: applied.added, updated: applied.updated }
            : { kind: 'nochange' };
        }
        // El servidor respondió: se avanza el marcador aunque el texto no se
        // haya entendido (reintentar sin fin contra un modelo que no sigue el
        // formato es peor que perder esa ventana puntual).
        await deps.markProgress(chatId, targetCount);
      } catch {
        return setStatus('error');
      }
      return setStatus(outcome.kind, outcome);
    } finally {
      running = null;
    }
  }

  return {
    /** Extracción automática: solo si toca por conteo y el chat está libre. */
    async maybeRun() {
      if (running || deps.isChatBusy()) return { kind: 'skipped' };
      const ctx = deps.getContext();
      if (!ctx || !ctx.character || !ctx.chat || !ctx.settings) return { kind: 'skipped' };
      // MEM-002: apagado por defecto; cada extracción invalida la caché de prompt
      // del servidor y encarece la siguiente respuesta (~20 s). Solo `runNow()`
      // (manual) ignora este ajuste.
      if (ctx.settings.lorebookAuto !== true) return { kind: 'skipped' };
      if (!shouldUpdateLorebook(ctx.chat, ctx.messages.length)) return { kind: 'skipped' };
      const fresh = ctx.messages.slice(ctx.chat.lorebookMessageCount || 0);
      return run(ctx, fresh.slice(-LOREBOOK_EXTRACT_WINDOW_MESSAGES));
    },
    /** "Actualizar memoria ahora": ventana = últimos mensajes del chat. */
    async runNow() {
      if (running || deps.isChatBusy()) return { kind: 'busy' };
      const ctx = deps.getContext();
      if (!ctx || !ctx.character || !ctx.chat || !ctx.settings) return { kind: 'skipped' };
      if (ctx.messages.length < LOREBOOK_MANUAL_MIN_MESSAGES) return { kind: 'toolittle' };
      return run(ctx, ctx.messages.slice(-LOREBOOK_EXTRACT_WINDOW_MESSAGES));
    },
    /** Cancela una extracción en curso (el usuario envió un mensaje). */
    abort() {
      if (running) running.controller.abort();
    },
    isRunning() {
      return !!running;
    },
    /** Último resultado, solo en memoria. */
    getStatus() {
      return status;
    },
  };
}

// Dos palabras coinciden si son iguales o solo difieren en una `s`/`es` final
// (plural simple), siempre que la más corta tenga 3+ letras: "hand" ~ "hands".
function sameWord(a, b) {
  if (a === b) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 3 && (long === short + 's' || long === short + 'es');
}

// ¿La key (ya sin acentos ni mayúsculas, en palabras) aparece como secuencia
// contigua de palabras COMPLETAS en `tokens`?
function keyInTokens(keyWords, tokens) {
  if (!keyWords.length) return false;
  for (let i = 0; i + keyWords.length <= tokens.length; i++) {
    if (keyWords.every((w, j) => sameWord(w, tokens[i + j]))) return true;
  }
  return false;
}

/**
 * ¿Alguna key de la entrada aparece en el texto? Comparación por PALABRA
 * COMPLETA (MEM-003; antes era por subcadena, y "art" coincidía con "start"),
 * sin distinguir mayúsculas ni acentos y tolerando plurales simples (`s`/`es`).
 * Una key con letras de escrituras no latinas (sin espacios entre palabras) se
 * sigue buscando como subcadena. `text` puede ser el texto de varios mensajes.
 * @param {LoreEntry} entry
 * @param {{ raw: string, folded: string, tokens: string[] }} haystack  Ver `prepareHaystack`.
 * @returns {boolean}
 */
function entryMatches(entry, haystack) {
  if (!Array.isArray(entry.keys)) return false;
  return entry.keys.some((k) => {
    const key = String(k == null ? '' : k).toLowerCase().trim();
    if (!key) return false;
    if (hasNonLatinLetter(key)) return haystack.raw.includes(key);
    return keyInTokens(foldText(key).split(WORD_SPLIT).filter(Boolean), haystack.tokens);
  });
}

function prepareHaystack(text) {
  const raw = String(text || '').toLowerCase();
  const folded = foldText(raw);
  return { raw, folded, tokens: folded.split(WORD_SPLIT).filter(Boolean) };
}

/**
 * Selecciona, de `entries`, las que matchean por palabra clave contra el
 * texto de los últimos mensajes (estilo World Info de Tavern/SillyTavern),
 * hasta un tope de caracteres. Nunca mete todo siempre: eso desbordaría el
 * presupuesto de contexto ya ajustado del usuario. La coincidencia es por
 * palabra completa (ver `entryMatches`).
 * @param {LoreEntry[]} entries
 * @param {import('../state.js').Message[]} recentMessages
 * @param {{ scanCount?: number, charBudget?: number }} [opts]
 * @returns {LoreEntry[]}
 */
export function selectLoreEntries(entries, recentMessages, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];

  const scanCount = opts.scanCount || LOREBOOK_SCAN_LAST_MESSAGES;
  const budget = typeof opts.charBudget === 'number' ? opts.charBudget : LOREBOOK_INJECT_CHAR_BUDGET;

  const text = (recentMessages || [])
    .slice(-scanCount)
    .map((m) => String((m && m.text) || ''))
    .join('\n');
  if (!text.trim()) return [];
  const haystack = prepareHaystack(text);

  const matched = list
    .filter((e) => !e.always && entryMatches(e, haystack)) // las "siempre presentes" ya van aparte
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));

  const kept = [];
  let used = 0;
  for (const entry of matched) {
    const cost = entry.content.length + 3; // aproxima "- " + salto de línea
    if (used + cost > budget && kept.length) break;
    used += cost;
    kept.push(entry);
  }
  return kept;
}

/**
 * Arma el bloque de texto a insertar en el prompt real a partir de las
 * entradas ya seleccionadas por `selectLoreEntries`.
 * @param {LoreEntry[]} entries
 * @returns {string} '' si `entries` está vacío.
 */
export function formatLoreBlock(entries) {
  if (!entries || !entries.length) return '';
  return `Known facts (from memory):\n${entries.map((e) => `- ${e.content}`).join('\n')}`;
}

/* ---------- MEM-004: recuerdos "siempre presentes" y presupuestos ---------- */

/** Caracteres que cuesta una entrada en el prompt ("- " + salto de línea). */
export function loreEntryCost(entry) {
  return String((entry && entry.content) || '').length + 3;
}

/**
 * Selecciona los recuerdos "siempre presentes" que caben en `charBudget`
 * (por defecto LOREBOOK_ALWAYS_CHAR_BUDGET), en el orden en que están
 * guardados. Si una no cabe, ESA y las que la siguen NO se envían (así el
 * conjunto es estable y predecible). Pura.
 * @param {LoreEntry[]} entries
 * @param {{ charBudget?: number }} [opts]
 * @returns {{ entries: LoreEntry[], sent: number, total: number, used: number, requested: number, budget: number, overflow: boolean }}
 *   `requested` = caracteres de TODAS las marcadas; `used` = los que se envían.
 */
export function selectAlwaysEntries(entries, opts = {}) {
  const budget = typeof opts.charBudget === 'number' ? opts.charBudget : LOREBOOK_ALWAYS_CHAR_BUDGET;
  const marked = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && e.always === true && typeof e.content === 'string' && e.content
  );
  const kept = [];
  let used = 0;
  for (const entry of marked) {
    const cost = loreEntryCost(entry);
    if (used + cost > budget) break;
    used += cost;
    kept.push(entry);
  }
  const requested = marked.reduce((sum, e) => sum + loreEntryCost(e), 0);
  return { entries: kept, sent: kept.length, total: marked.length, used, requested, budget, overflow: kept.length < marked.length };
}

/**
 * Tope de caracteres para el bloque "por tema" dado lo que ya usan las
 * "siempre presentes": la suma nunca pasa de LOREBOOK_TOTAL_CHAR_BUDGET, y sin
 * "siempre presentes" queda en LOREBOOK_INJECT_CHAR_BUDGET (como antes).
 * @param {number} alwaysUsed
 * @returns {number}
 */
export function loreTopicBudget(alwaysUsed) {
  return Math.max(0, Math.min(LOREBOOK_INJECT_CHAR_BUDGET, LOREBOOK_TOTAL_CHAR_BUDGET - (alwaysUsed || 0)));
}

/**
 * Bloque de texto para los recuerdos "siempre presentes" ya seleccionados.
 * @param {LoreEntry[]} entries
 * @returns {string} '' si no hay ninguna.
 */
export function formatAlwaysBlock(entries) {
  if (!entries || !entries.length) return '';
  return `Always keep in mind:\n${entries.map((e) => `- ${e.content}`).join('\n')}`;
}

/**
 * Arma los dos bloques de lorebook de un turno: `always` (estable: solo cambia
 * cuando el usuario edita) y `topic` (varía con la conversación). Sin
 * entradas devuelve ambos '' y el prompt queda IDÉNTICO al de siempre.
 * @param {LoreEntry[]} entries  `character.lorebook`
 * @param {import('../state.js').Message[]} recentMessages
 * @returns {{ always: string, topic: string, alwaysSelection: ReturnType<typeof selectAlwaysEntries> }}
 */
export function buildLoreBlocks(entries, recentMessages) {
  const alwaysSelection = selectAlwaysEntries(entries);
  const topicEntries = selectLoreEntries(entries, recentMessages, {
    charBudget: loreTopicBudget(alwaysSelection.used),
  });
  return { always: formatAlwaysBlock(alwaysSelection.entries), topic: formatLoreBlock(topicEntries), alwaysSelection };
}

/**
 * Vista previa de presupuestos para la UI y para `estimateContextUsage`:
 * el bloque "siempre presentes" real y el espacio máximo que podría ocupar el
 * bloque "por tema" (el menor entre su tope y el total de sus entradas).
 * @param {LoreEntry[]} entries
 * @returns {{ alwaysBlock: string, alwaysSelection: ReturnType<typeof selectAlwaysEntries>, topicReserve: number, topicBudget: number }}
 */
export function loreBudgetPreview(entries) {
  const alwaysSelection = selectAlwaysEntries(entries);
  const topicBudget = loreTopicBudget(alwaysSelection.used);
  const topicTotal = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && !e.always && typeof e.content === 'string')
    .reduce((sum, e) => sum + loreEntryCost(e), 0);
  return {
    alwaysBlock: formatAlwaysBlock(alwaysSelection.entries),
    alwaysSelection,
    topicReserve: Math.min(topicBudget, topicTotal),
    topicBudget,
  };
}
