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
// número.
export const LOREBOOK_UPDATE_EVERY_MESSAGES = 40;

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

function transcriptFor(messages, charName, userName) {
  return (messages || [])
    .map((m) => `${m.role === 'user' ? userName : charName}: ${collapse(m.text)}`)
    .join('\n');
}

/**
 * Arma el prompt (texto simple, para una llamada de completado sin
 * streaming) que le pide al modelo actualizar el lorebook del PERSONAJE
 * (compartido entre todos sus chats) a partir de los mensajes nuevos de
 * este chat y de las entradas ya existentes.
 *
 * Cubre, cuando la conversación da material: quiénes son el usuario y el
 * personaje (aspecto, personalidad mostrada), momentos compartidos (citas,
 * intimidad, paseos, eventos), gustos/preferencias del usuario mostrados en
 * el chat y cómo el personaje los percibe, y el estado actual de la
 * relación entre ambos — sin forzar ninguna categoría si el chat todavía no
 * da pie a ella.
 *
 * @param {import('../state.js').Character} character
 * @param {import('../state.js').Settings} settings
 * @param {import('../state.js').Message[]} newMessages
 * @param {LoreEntry[]} [existingEntries]
 * @returns {string}
 */
export function buildExtractionPrompt(character, settings, newMessages, existingEntries = []) {
  const card = character.card;
  const N = card.name;
  const U = (settings && settings.user) || 'User';
  const existingJson = JSON.stringify(
    (existingEntries || []).map((e) => ({ keys: e.keys, content: e.content }))
  );

  return [
    `You maintain a long-term memory lorebook for an ongoing roleplay chat between ${N} and ${U}.`,
    `Read the conversation excerpt below and produce the UPDATED lorebook: keep entries that are still true, ` +
      `add new entries for important new facts, and drop entries that got contradicted or are no longer relevant. ` +
      `Never duplicate an existing fact under a new entry.`,
    `When the conversation gives you material for it, cover: who ${U} and ${N} are (appearance, personality traits ` +
      `actually shown, not assumed); shared moments between them (dates, intimacy, outings, events); ${U}'s tastes, ` +
      `preferences and dislikes as shown in the chat, and how ${N} feels about them; and the current status of the ` +
      `relationship between ${U} and ${N}. Skip any category the conversation has no material for.`,
    `Each entry has "keys" (1 to 4 short lowercase words or phrases that should trigger it in later messages: names, ` +
      `topics, places) and "content" (the fact itself, plain text, third person, under ${LOREBOOK_MAX_ENTRY_CHARS} characters).`,
    `Existing lorebook (JSON array, may be empty):\n${existingJson}`,
    `Conversation excerpt:\n${transcriptFor(newMessages, N, U)}`,
    `Respond with ONLY a JSON array of entries, no prose, no markdown code fences.`,
    `JSON:`,
  ].join('\n\n');
}

function tryParseEntries(text) {
  try {
    const value = JSON.parse(text);
    if (Array.isArray(value)) return value;
    if (value && typeof value === 'object') return [value];
  } catch {
    // se intenta con otra estrategia más abajo
  }
  return null;
}

// Devuelve el primer bloque balanceado `open`...`close` dentro de `text`, o
// null si no hay uno completo. Los modelos locales chicos suelen rodear el
// JSON pedido con texto extra ("Here is the updated lorebook: [...]").
function extractBalanced(text, open, close) {
  const start = text.indexOf(open);
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth++;
    else if (text[i] === close) {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Parsea la respuesta cruda del modelo a la extracción de lorebook. Nunca
 * lanza: los modelos locales chicos no son confiables generando JSON
 * estricto, así que se intenta en cascada y se devuelve null si nada sirve.
 * @param {string} rawText
 * @returns {object[]|null} Entradas crudas sin validar, o null si no se pudo parsear nada.
 */
export function parseExtractionResponse(rawText) {
  const text = String(rawText || '');
  const direct = tryParseEntries(text);
  if (direct) return direct;

  const bracketed = extractBalanced(text, '[', ']');
  if (bracketed) {
    const parsed = tryParseEntries(bracketed);
    if (parsed) return parsed;
  }

  const braced = extractBalanced(text, '{', '}');
  if (braced) {
    const parsed = tryParseEntries(braced);
    if (parsed) return parsed;
  }

  return null;
}

function newLoreId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function dedupeKey(content) {
  return content.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Valida y acota las entradas crudas devueltas por el modelo, y las combina
 * con las entradas existentes marcadas `source:'manual'` (si algún día hay
 * una UI para fijarlas a mano — ver roadmap en CONTRACT-HANDOFF.md §7.1 —
 * esas nunca las toca ni las descarta esta función; solo reemplaza las
 * `'auto'`). Descarta cualquier entrada con forma inválida en vez de
 * guardar basura. Nunca lanza.
 * @param {object[]} rawEntries
 * @param {LoreEntry[]} [existingEntries]
 * @param {number} [now]
 * @returns {LoreEntry[]}
 */
export function sanitizeLoreEntries(rawEntries, existingEntries = [], now = Date.now()) {
  const manualKept = (existingEntries || []).filter((e) => e && e.source === 'manual');
  const seen = new Set(manualKept.map((e) => dedupeKey(e.content)));

  const autoEntries = [];
  for (const raw of Array.isArray(rawEntries) ? rawEntries : []) {
    if (!raw || typeof raw !== 'object') continue;

    const content = typeof raw.content === 'string' ? raw.content.trim().slice(0, LOREBOOK_MAX_ENTRY_CHARS) : '';
    if (!content) continue;

    const keys = Array.isArray(raw.keys)
      ? raw.keys.map((k) => String(k || '').trim().toLowerCase()).filter(Boolean)
      : [];
    if (!keys.length) continue;

    const key = dedupeKey(content);
    if (seen.has(key)) continue;
    seen.add(key);

    autoEntries.push({ id: newLoreId(), keys, content, updated: now, source: 'auto' });
  }

  const room = Math.max(0, LOREBOOK_MAX_ENTRIES - manualKept.length);
  return [...manualKept, ...autoEntries.slice(0, room)];
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
