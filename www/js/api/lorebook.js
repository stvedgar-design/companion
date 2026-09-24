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

// Tope duro de caracteres inyectados en el prompt real por turno (~250-300
// tokens con la heurística CHARS_PER_TOKEN de prompt.js).
export const LOREBOOK_INJECT_CHAR_BUDGET = 1000;

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
    `From the excerpt below, write up to ${LOREBOOK_EXTRACT_MAX_NEW_ENTRIES} NEW durable facts worth remembering: ` +
      `${U}'s real details, tastes, people, pets, places, dates, plans, or how the relationship between ${U} and ${N} changed. ` +
      `Skip small talk, fleeting moments and anything already known.`,
    `Do not use the names "${N}" or "${U}" as keywords. Write each fact in the same language as the conversation, ` +
      `as a complete third-person sentence that names who or what it is about (no pronouns, never a single word), ` +
      `at most ${LOREBOOK_EXTRACT_ENTRY_CHARS} characters. Put every keyword in double quotes.`,
    `Reply with ONE line only: a compact JSON array with no line breaks and no markdown, like ` +
      `[{"k":["keyword1","keyword2"],"c":"short fact"}], one fact per object. If there is nothing new worth remembering, reply [].`,
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
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'his', 'her', 'has', 'have', 'was', 'were', 'are', 'from',
  'their', 'they', 'about', 'into', 'who', 'which', 'been', 'also', 'los', 'las', 'una', 'uno', 'por', 'con',
  'que', 'del', 'sus', 'para', 'como', 'está', 'esta', 'este', 'son',
]);

function contentWords(text, ignoreWords) {
  const words = String(text || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
  return new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !ignoreWords.has(w)));
}

function wordOverlap(a, b, ignoreWords) {
  const A = contentWords(a, ignoreWords);
  const B = contentWords(b, ignoreWords);
  const smaller = Math.min(A.size, B.size);
  if (!smaller) return 0;
  let shared = 0;
  for (const w of A) if (B.has(w)) shared++;
  return shared / smaller;
}

// Valida y acota UNA entrada cruda del modelo. null si no sirve.
function normalizeIncoming(raw, ignoreKeys) {
  if (!raw || typeof raw !== 'object') return null;
  const rawContent = pickField(raw, CONTENT_FIELDS);
  const content = typeof rawContent === 'string' ? collapse(rawContent).slice(0, LOREBOOK_MAX_ENTRY_CHARS) : '';
  if (!content) return null;

  let rawKeys = pickField(raw, KEYS_FIELDS);
  if (typeof rawKeys === 'string') rawKeys = [rawKeys];
  if (!Array.isArray(rawKeys)) return null;
  const keys = [];
  for (const k of rawKeys) {
    const key = normKey(k).slice(0, MAX_KEY_CHARS);
    if (key && !ignoreKeys.has(key) && !keys.includes(key)) keys.push(key);
    if (keys.length >= MAX_KEYS_PER_ENTRY) break;
  }
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
 * @param {LoreEntry[]} previousEntries
 * @param {object[]} incomingEntries  Salida de `parseExtractionResponse`.
 * @param {{ now?: number, ignoreKeys?: string[] }} [opts]
 * @returns {{ entries: LoreEntry[], added: number, updated: number, changed: boolean }}
 */
export function applyExtraction(previousEntries, incomingEntries, opts = {}) {
  const now = typeof opts.now === 'number' ? opts.now : Date.now();
  const ignoreKeys = new Set((opts.ignoreKeys || []).map(normKey).filter(Boolean));
  const ignoreWords = new Set();
  for (const k of ignoreKeys) for (const w of k.split(/\s+/)) ignoreWords.add(w);

  const entries = (Array.isArray(previousEntries) ? previousEntries : [])
    .filter((e) => e && typeof e === 'object')
    .map((e) => ({ ...e, keys: Array.isArray(e.keys) ? e.keys.slice() : [] }));
  const touched = new Set();
  const addedIds = [];
  let updated = 0;

  const incoming = (Array.isArray(incomingEntries) ? incomingEntries : [])
    .map((raw) => normalizeIncoming(raw, ignoreKeys))
    .filter(Boolean)
    .slice(0, LOREBOOK_EXTRACT_MAX_NEW_ENTRIES);

  for (const inc of incoming) {
    const incKey = dedupeKey(inc.content);
    if (entries.some((e) => dedupeKey(e.content) === incKey)) continue;

    const match = entries.find(
      (e) =>
        e.source !== 'manual' &&
        e.keys.some((k) => !ignoreKeys.has(normKey(k)) && inc.keys.includes(normKey(k))) &&
        wordOverlap(e.content, inc.content, ignoreWords) >= MERGE_MIN_OVERLAP
    );
    if (match) {
      match.content = inc.content;
      const union = match.keys.slice();
      for (const k of inc.keys) if (!union.map(normKey).includes(k)) union.push(k);
      match.keys = union.slice(0, MAX_KEYS_PER_ENTRY + 2);
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
 * toca. Pura; devuelve `null` si el `id` no existe o los datos no son válidos
 * (contenido o keys vacíos).
 * @param {LoreEntry[]} entries
 * @param {string} id
 * @param {{ content: string, keys: string[] }} patch
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
  out[idx] = { ...list[idx], content, keys, updated: now, source: 'manual' };
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

/**
 * Selecciona, de `entries`, las que matchean por palabra clave contra el
 * texto de los últimos mensajes (estilo World Info de Tavern/SillyTavern),
 * hasta un tope de caracteres. Nunca mete todo siempre: eso desbordaría el
 * presupuesto de contexto ya ajustado del usuario.
 * @param {LoreEntry[]} entries
 * @param {import('../state.js').Message[]} recentMessages
 * @param {{ scanCount?: number, charBudget?: number }} [opts]
 * @returns {LoreEntry[]}
 */
export function selectLoreEntries(entries, recentMessages, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  if (!list.length) return [];

  const scanCount = opts.scanCount || LOREBOOK_SCAN_LAST_MESSAGES;
  const budget = opts.charBudget || LOREBOOK_INJECT_CHAR_BUDGET;

  const haystack = (recentMessages || [])
    .slice(-scanCount)
    .map((m) => String((m && m.text) || '').toLowerCase())
    .join('\n');
  if (!haystack.trim()) return [];

  const matched = list
    .filter((e) => Array.isArray(e.keys) && e.keys.some((k) => k && haystack.includes(String(k).toLowerCase())))
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
