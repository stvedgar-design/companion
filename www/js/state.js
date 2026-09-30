// www/js/state.js
// Capa de persistencia: ajustes, personajes y chats en IndexedDB.
// Backend inyectable: createState(backend) permite usar un backend en memoria en tests.
// Única API asíncrona y estable; la estructura interna del backend es libre.

import { normalizeVariants } from './variants.js';
import { sanitizeMeta } from './perf.js';
import { parseBackupText, normalizeBackup, analyzeBackup, planImport } from './backup.js';
import { sanitizeAppearance } from './character-appearance.js';
import { sanitizeRelationship } from './api/relationship.js';
import { sanitizePersonalityTags } from './personality-tags.js';

/**
 * @typedef {Object} Card  Card normalizada: todos los campos siempre presentes.
 * @property {string} name
 * @property {string} description
 * @property {string} personality
 * @property {string} scenario
 * @property {string} first_mes
 * @property {string} mes_example
 * @property {string} system_prompt
 * @property {string} post_history_instructions
 * @property {string[]} alternate_greetings
 * @property {object|null} character_book
 */

/**
 * @typedef {Object} LoreEntry  Ver también www/js/api/lorebook.js.
 * @property {string} id
 * @property {string[]} keys        // palabras/frases que activan esta entrada
 * @property {string} content       // el hecho en sí, en texto plano, conciso
 * @property {number} updated       // ms desde epoch
 * @property {'auto'|'manual'} source  // 'auto' = generado por el lorebook automático
 * @property {boolean} [always]     // MEM-004: "siempre presente" (se envía en cada turno, sin keys). Ausente = false.
 *   Una entrada `always` es siempre `source:'manual'`; solo se guarda `always:true` (nunca `false`).
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {Card} card
 * @property {'none'|'mini'|'large'} avatarMode
 * @property {number} created
 * @property {LoreEntry[]} lorebook  // memoria de largo plazo autogenerada de ESTE personaje,
 *   compartida entre todos sus chats (ver docs/NOTES.md, "Lorebook por personaje")
 * @property {LoreEntry[]} lorebookPrevious  // copia del lorebook justo ANTES de la última
 *   actualización automática/manual de memoria (un solo nivel de "Deshacer"); [] por defecto
 * @property {number} lorebookPreviousAt  // cuándo se guardó esa copia (ms); 0 = no hay nada que
 *   deshacer. Existe porque `lorebookPrevious: []` no distingue "no hay copia" de "el lorebook
 *   estaba vacío antes de la primera actualización".
 * @property {{content: string, keys: string[], at: number}[]} lorebookTombstones  // MEM-013: lo que el
 *   usuario borró (o que la limpieza única quitó), para que la extracción automática no lo repita;
 *   tope LOREBOOK_TOMBSTONES_MAX (api/lorebook.js), la más antigua sale primero; [] por defecto
 * @property {{content: string, keys: string[], at: number}[]} lorebookTombstonesPrevious  // copia de
 *   `lorebookTombstones` de ANTES de la operación que dejó el nivel de "Deshacer" actual (pareja de
 *   `lorebookPrevious`/`lorebookPreviousAt`); [] por defecto
 * @property {{ fixed: string, current: string, updated: number }} appearance  // MEM-009: ficha de apariencia propia de la app (NO es parte de la card);
 *   `fixed` (rasgos fijos, ≤200 car.) va a la cabecera del prompt, `current` (ropa/estado, ≤100) al final. Vacía por defecto; ver character-appearance.js
 * @property {{ text: string, level: 'early'|'growing'|'established', updated: number, source: 'auto'|'manual' }} relationship  // MEM-014: estado
 *   de la relación escrito por el personaje a partir de sus recuerdos; `{text:'', level:'early', updated:0, source:'auto'}` por defecto; ver api/relationship.js
 * @property {string} chatBackground           // data URL JPEG del fondo de SUS chats, '' si no hay
 * @property {number} chatBackgroundBrightness // 20 a 180 (%), 100 = sin cambios
 * @property {boolean} chatBackgroundFade      // fundido a negro en la mitad inferior de la imagen
 * @property {'fill'|'stretch'} chatBackgroundFit // 'fill' = cubre y recorta; 'stretch' = deforma sin recortar
 *   El fondo es por personaje (no global, no por chat): ver docs/NOTES.md,
 *   "Fondo de chat por personaje". Se ve solo dentro de sus chats — el resto
 *   de la app sigue el fondo del skin activo (ver www/css/themes.css).
 * @property {'nomi'|'plain'} formatStyle  // CCC-001: estilo de escritura de ESTE personaje. 'nomi' = acciones entre
 *   asteriscos (Mia, Theo): `formatAssist` (arranque en `*`) y la reparación de asteriscos de format.js se aplican
 *   normalmente. 'plain' = sin asteriscos ni comillas (Ani): ninguno de los dos se aplica a sus respuestas, así no se le
 *   fuerza un formato que su card no usa. 'nomi' por defecto (así ningún personaje existente cambia de comportamiento).
 * @property {string[]} personalityTags  // CCC-001: ids de personality-tags.js elegidos al crear/editar este personaje
 *   con el creador guiado (`card.personality` se ensambla desde ellos). `[]` = la personalidad de la card es texto libre
 *   (importada, o editada a mano sin pasar por las etiquetas) y se muestra/edita como tal, nunca como pills inventadas.
 */

/**
 * @typedef {Object} Chat
 * @property {string} id
 * @property {string} characterId
 * @property {string} title        // si está vacío, la UI usa la fecha de creación
 * @property {string} scenario     // se suma al scenario de la card, nunca lo reemplaza
 * @property {number} created
 * @property {number} updated
 * @property {string} last         // vista previa del último mensaje de este chat
 * @property {number} lastExportAt // reservado para exportación automática de log
 * @property {number} lorebookMessageCount  // mensajes de ESTE chat ya usados para actualizar
 *   el lorebook (compartido) del personaje — marcador de progreso, no guarda entradas
 * @property {{ text: string, coveredUntil: number, updated: number }} continuitySummary  // MEM-007: resumen
 *   breve de lo que pasó en ESTE chat y ya no cabe en el contexto. `coveredUntil` = `ts` del último mensaje ya
 *   resumido (por `ts` y no por posición: borrar o editar mensajes no lo desalinea); `updated` = ms de la última
 *   actualización. Por defecto `{ text: '', coveredUntil: 0, updated: 0 }` (chats anteriores cargan así).
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'char'} role
 * @property {string} text
 * @property {number} ts
 * @property {{ id: string, keys: string[], content: string, always: boolean }[]} [loreUsed]
 *   UI-010, solo mensajes del personaje: copia de los recuerdos que viajaron en el prompt de ESE mensaje
 *   (`[]` = ninguno). Ausente = mensaje anterior a UI-010 / sin dato (no se muestra icono).
 * @property {{ text: string, loreUsed?: object[] }[]} [variants]
 *   UI-017, solo mensajes del personaje regenerados: TODAS las versiones de la respuesta (2 o más; ausente = una sola).
 * @property {number} [activeVariant]  Índice de la versión que se ve. `text`/`loreUsed` son SIEMPRE los de esa versión
 *   (ver `variants.js`), así que el prompt, la exportación y la vista previa no necesitan saber de variantes.
 * @property {{ ttftMs: number, totalMs: number, chars: number }} [meta]
 *   UI-001, solo mensajes del personaje generados por el servidor: tiempo hasta el primer fragmento, tiempo total (ms) y
 *   caracteres de la respuesta. Ausente = mensaje anterior a UI-001 / sin dato. No viaja nunca al modelo (el prompt solo lee `text`).
 */

/**
 * @typedef {Object} Settings
 * @property {string} url
 * @property {string} user
 * @property {number} maxLen
 * @property {number} temp
 * @property {'plain'|'chat'} mode
 * @property {number} ctx
 * @property {string} pinSalt   // '' si el bloqueo con PIN está desactivado
 * @property {string} pinHash   // '' si el bloqueo con PIN está desactivado (SHA-256 salteado, ver lock.js)
 * @property {'penumbra-claude'} theme        // skin visual (UI-024: único activo; cualquier otro valor guardado migra a este; los archivados están en www/css/themes-archived.css)
 * @property {'dark'|'light'} themeMode        // claro/oscuro, aplica a cualquier skin
 * @property {'full'|'bars'|'off'} glassEffect // UI-007, ARCHIVADO por UI-024: sin efecto ni interfaz (era del skin Glass); se conserva en el esquema por compatibilidad con copias viejas
 * @property {boolean} lorebookAuto // MEM-002: extracción automática de memoria cada ~20 mensajes; false por defecto (cada extracción encarece la SIGUIENTE respuesta ~20 s)
 * @property {boolean} continuityAuto // MEM-007: resumen de continuidad automático del chat (ver api/continuity.js)
 * @property {boolean} varietyAssist // FMT-004: nota de variedad al final del prompt cuando el personaje se repite
 * @property {boolean} formatAssist // FMT-002: la respuesta del personaje arranca ya dentro de una acción (`*`); true por defecto
 * @property {boolean} splitTypography // UI-023 (experimental): en los mensajes del personaje con acciones en cursiva, el diálogo usa una tipografía sans y la acción la del skin; false por defecto
 * @property {15|16|17|18|19} messageFontSize // UI-026: tamaño del texto de los mensajes del chat (px); 17 por defecto. El ancho de las burbujas NO depende de este valor.
 */

// UI-024: el único skin visible; ui/shell.js (THEMES) lo repite porque no importa state.js.
const ACTIVE_THEME = 'penumbra-claude';

const DEFAULT_SETTINGS = Object.freeze({
  url: '',
  user: '',
  maxLen: 220,
  temp: 0.85,
  // 'chat' (plantilla del modelo) da mejores resultados de roleplay que
  // 'plain' con la mayoría de los modelos actuales; 'plain' queda como
  // opción manual para el que le funcione mejor con su modelo puntual.
  mode: 'chat',
  ctx: 4096,
  pinSalt: '',
  pinHash: '',
  theme: ACTIVE_THEME,
  themeMode: 'dark',
  glassEffect: 'full',
  lorebookAuto: false,
  continuityAuto: false,
  varietyAssist: false,
  formatAssist: true,
  splitTypography: false,
  messageFontSize: 17,
});

// UI-026: pasos permitidos del tamaño de texto de los mensajes.
export const MESSAGE_FONT_SIZES = Object.freeze([15, 16, 17, 18, 19]);

// Por defecto de los campos de fondo de chat en Character (ver
// sanitizeCharacterExtras): mismos valores que tenía Settings antes de que
// el fondo pasara a ser por personaje.
const DEFAULT_CHARACTER_BACKGROUND = Object.freeze({
  chatBackground: '',
  chatBackgroundBrightness: 100,
  chatBackgroundFade: false,
  chatBackgroundFit: 'fill',
});

// CCC-001: por defecto 'nomi' (el estilo de asteriscos, el único que existía hasta ahora) para que ningún
// personaje ya guardado (Mia, Theo, Ani) cambie de comportamiento hasta que el usuario elija 'plain' a mano
// desde la pantalla de edición.
const DEFAULT_FORMAT_STYLE = 'nomi';

const SETTINGS_KEY = 'main';

// ---------- backend interface ----------
// Un backend expone:
//   get(store, key)            -> Promise<value|undefined>
//   getAll(store)               -> Promise<value[]>
//   put(store, key, value)      -> Promise<void>
//   remove(store, key)          -> Promise<void>
//   atomic(ops)                 -> Promise<void>
//     ops: Array<{ type:'put', store, key, value } | { type:'remove', store, key }>
//     ejecutado como una única transacción (evita corromper datos con escrituras concurrentes)

function clampNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function sanitizeSettings(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const merged = { ...DEFAULT_SETTINGS, ...src };
  return {
    url: typeof merged.url === 'string' ? merged.url : DEFAULT_SETTINGS.url,
    user: typeof merged.user === 'string' ? merged.user : DEFAULT_SETTINGS.user,
    maxLen: Math.round(clampNumber(merged.maxLen, 60, 500, DEFAULT_SETTINGS.maxLen)),
    temp: clampNumber(merged.temp, 0.3, 1.4, DEFAULT_SETTINGS.temp),
    mode: (merged.mode === 'plain' || merged.mode === 'chat') ? merged.mode : DEFAULT_SETTINGS.mode,
    ctx: Math.round(clampNumber(merged.ctx, 512, 200000, DEFAULT_SETTINGS.ctx)),
    pinSalt: typeof merged.pinSalt === 'string' ? merged.pinSalt : DEFAULT_SETTINGS.pinSalt,
    pinHash: typeof merged.pinHash === 'string' ? merged.pinHash : DEFAULT_SETTINGS.pinHash,
    theme: ACTIVE_THEME, // UI-024: un único skin; un valor guardado de otro skin (o de una copia vieja) migra en silencio
    themeMode: merged.themeMode === 'light' ? 'light' : DEFAULT_SETTINGS.themeMode,
    glassEffect: ['full', 'bars', 'off'].includes(merged.glassEffect) ? merged.glassEffect : DEFAULT_SETTINGS.glassEffect,
    lorebookAuto: merged.lorebookAuto === true,
    continuityAuto: typeof merged.continuityAuto === 'boolean' ? merged.continuityAuto : DEFAULT_SETTINGS.continuityAuto,
    varietyAssist: merged.varietyAssist === true,
    formatAssist: merged.formatAssist !== false,
    splitTypography: merged.splitTypography === true,
    messageFontSize: MESSAGE_FONT_SIZES.includes(merged.messageFontSize) ? merged.messageFontSize : DEFAULT_SETTINGS.messageFontSize,
  };
}

// Valida los campos de fondo de chat de un Character (ver
// sanitizeCharacterExtras). Mismas reglas que ya tenía Settings cuando el
// fondo era global.
function sanitizeCharacterBackground(raw) {
  const src = (raw && typeof raw === 'object') ? raw : {};
  const merged = { ...DEFAULT_CHARACTER_BACKGROUND, ...src };
  return {
    chatBackground: typeof merged.chatBackground === 'string' ? merged.chatBackground : DEFAULT_CHARACTER_BACKGROUND.chatBackground,
    chatBackgroundBrightness: Math.round(
      clampNumber(merged.chatBackgroundBrightness, 20, 180, DEFAULT_CHARACTER_BACKGROUND.chatBackgroundBrightness)
    ),
    chatBackgroundFade: !!merged.chatBackgroundFade,
    chatBackgroundFit: merged.chatBackgroundFit === 'stretch' ? 'stretch' : DEFAULT_CHARACTER_BACKGROUND.chatBackgroundFit,
  };
}

// UI-010: valida `loreUsed` de un mensaje. Devuelve un array (posiblemente vacío) o `undefined` = "sin dato".
// Un array no vacío donde ninguna entrada es válida también es "sin dato": mejor sin icono que un dato falso.
export function sanitizeLoreUsed(raw) {
  if (!Array.isArray(raw)) return undefined;
  const clean = raw
    .map((e) => {
      if (!e || typeof e !== 'object') return null;
      const content = typeof e.content === 'string' ? e.content.trim() : '';
      if (!content) return null;
      return {
        id: typeof e.id === 'string' ? e.id : '',
        keys: Array.isArray(e.keys) ? e.keys.map((k) => String(k || '')).filter(Boolean) : [],
        content,
        always: e.always === true,
      };
    })
    .filter(Boolean);
  if (raw.length && !clean.length) return undefined;
  return clean;
}

// Solo toca `loreUsed`, (UI-017) `variants`/`activeVariant` y (UI-001) `meta`; cualquier otro campo del mensaje (y los mensajes sin ellos) pasan tal cual.
export function sanitizeMessage(m) {
  if (!m || typeof m !== 'object') return m;
  if ('meta' in m) {
    const { meta, ...rest } = m;
    const clean = m.role === 'char' ? sanitizeMeta(meta) : undefined;
    m = clean === undefined ? rest : { ...rest, meta: clean };
  }
  if ('loreUsed' in m) {
    const { loreUsed, ...rest } = m;
    const clean = m.role === 'char' ? sanitizeLoreUsed(loreUsed) : undefined;
    m = clean === undefined ? rest : { ...rest, loreUsed: clean };
  }
  return normalizeVariants(m, sanitizeLoreUsed);
}

function previewLast(messages) {
  if (!Array.isArray(messages) || messages.length === 0) return '';
  const lastMsg = messages[messages.length - 1];
  let text = String((lastMsg && lastMsg.text) || '');
  text = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim();
  if (text.length > 90) text = text.slice(0, 90);
  return text;
}

// Valida una entrada de lorebook suelta (p. ej. al cargar un personaje
// guardado por una versión anterior, o al importar un backup ajeno).
// Descarta lo que no tenga la forma esperada en vez de dejar pasar basura
// al prompt real.
function sanitizeLoreEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content) return null;
  const keys = Array.isArray(raw.keys) ? raw.keys.map((k) => String(k || '')).filter(Boolean) : [];
  if (!keys.length) return null;
  // MEM-004: `always` solo se conserva si es exactamente `true` (copias y entradas
  // anteriores no lo traen y cargan idénticas), y una entrada `always` es siempre
  // `manual`: la vía automática nunca la modifica ni la borra.
  const always = raw.always === true;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : ('l' + Math.random().toString(36).slice(2, 10)),
    keys,
    content,
    updated: Number.isFinite(raw.updated) ? raw.updated : Date.now(),
    source: always || raw.source === 'manual' ? 'manual' : 'auto',
    ...(always ? { always: true } : {}),
  };
}

// MEM-013: tope de lápidas por personaje (mismo valor que LOREBOOK_TOMBSTONES_MAX en
// api/lorebook.js; no se importa para no crear una dependencia de state.js hacia esa capa).
const LOREBOOK_TOMBSTONES_MAX = 200;

// Valida una lápida suelta (recuerdo borrado/rechazado). Descarta lo que no tenga forma válida,
// igual que sanitizeLoreEntry.
function sanitizeTombstone(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const content = typeof raw.content === 'string' ? raw.content.trim() : '';
  if (!content) return null;
  const keys = Array.isArray(raw.keys) ? raw.keys.map((k) => String(k || '')).filter(Boolean) : [];
  return { content, keys, at: Number.isFinite(raw.at) ? raw.at : Date.now() };
}

function sanitizeTombstones(raw) {
  if (!Array.isArray(raw)) return [];
  return raw.map(sanitizeTombstone).filter(Boolean).slice(-LOREBOOK_TOMBSTONES_MAX);
}

// Asegura que un Character tenga un `lorebook` y campos de fondo de chat
// válidos (personajes guardados antes de esas features no los tienen
// todavía). No toca el resto del objeto: a diferencia de sanitizeChat(), el
// resto de los campos de Character no se validan acá (nunca se validaron,
// no es parte de ninguna de las dos features).
function sanitizeCharacterExtras(raw) {
  if (!raw || typeof raw !== 'object') return raw;
  const lorebook = Array.isArray(raw.lorebook) ? raw.lorebook.map(sanitizeLoreEntry).filter(Boolean) : [];
  const lorebookPrevious = Array.isArray(raw.lorebookPrevious)
    ? raw.lorebookPrevious.map(sanitizeLoreEntry).filter(Boolean)
    : [];
  const lorebookPreviousAt = Number.isFinite(raw.lorebookPreviousAt) ? raw.lorebookPreviousAt : 0;
  const lorebookTombstones = sanitizeTombstones(raw.lorebookTombstones);
  const lorebookTombstonesPrevious = sanitizeTombstones(raw.lorebookTombstonesPrevious);
  const formatStyle = raw.formatStyle === 'plain' ? 'plain' : DEFAULT_FORMAT_STYLE;
  const personalityTags = sanitizePersonalityTags(raw.personalityTags);
  return {
    ...raw,
    lorebook,
    lorebookPrevious,
    lorebookPreviousAt,
    lorebookTombstones,
    lorebookTombstonesPrevious,
    appearance: sanitizeAppearance(raw.appearance),
    relationship: sanitizeRelationship(raw.relationship),
    ...sanitizeCharacterBackground(raw),
    formatStyle,
    personalityTags,
  };
}

// MEM-007: tope duro de lo que se acepta guardar (el tope "de trabajo" del resumen vive en api/continuity.js
// y es menor; esto solo evita que un dato corrupto o un backup ajeno cuele un texto enorme al prompt).
const CONTINUITY_HARD_MAX_CHARS = 2000;

/**
 * Valida el resumen de continuidad de un chat. Sin forma válida o sin texto = el valor por defecto
 * (`coveredUntil` y `updated` a 0: un resumen vacío no "cubre" nada). Pura.
 * @param {unknown} raw
 * @returns {{ text: string, coveredUntil: number, updated: number }}
 */
export function sanitizeContinuity(raw) {
  const empty = { text: '', coveredUntil: 0, updated: 0 };
  if (!raw || typeof raw !== 'object') return empty;
  const text = typeof raw.text === 'string' ? raw.text.replace(/\s+/g, ' ').trim().slice(0, CONTINUITY_HARD_MAX_CHARS) : '';
  if (!text) return empty;
  return {
    text,
    coveredUntil: Number.isFinite(raw.coveredUntil) && raw.coveredUntil > 0 ? raw.coveredUntil : 0,
    updated: Number.isFinite(raw.updated) && raw.updated > 0 ? raw.updated : 0,
  };
}

function sanitizeChat(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.id !== 'string' || !raw.id) return null;
  if (typeof raw.characterId !== 'string' || !raw.characterId) return null;
  const now = Date.now();
  return {
    id: raw.id,
    characterId: raw.characterId,
    title: typeof raw.title === 'string' ? raw.title : '',
    scenario: typeof raw.scenario === 'string' ? raw.scenario : '',
    created: Number.isFinite(raw.created) ? raw.created : now,
    updated: Number.isFinite(raw.updated) ? raw.updated : now,
    last: typeof raw.last === 'string' ? raw.last : '',
    lastExportAt: Number.isFinite(raw.lastExportAt) ? raw.lastExportAt : 0,
    lorebookMessageCount: Number.isFinite(raw.lorebookMessageCount) ? raw.lorebookMessageCount : 0,
    continuitySummary: sanitizeContinuity(raw.continuitySummary),
  };
}

function requestPersistence() {
  try {
    if (typeof navigator !== 'undefined' && navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }
  } catch {
    // mejor esfuerzo: nunca lanza
  }
}

/**
 * Crea una instancia de la capa de estado ligada a `backend`.
 * @param {object} backend
 */
export function createState(backend) {
  requestPersistence();

  async function getSettings() {
    const raw = await backend.get('settings', SETTINGS_KEY);
    return sanitizeSettings(raw);
  }

  async function saveSettings(patch) {
    const current = await getSettings();
    const merged = sanitizeSettings({ ...current, ...(patch || {}) });
    await backend.put('settings', SETTINGS_KEY, merged);
    return merged;
  }

  // MEM-007: serializa las escrituras que leen y luego escriben el registro de UN chat (`chatMeta`). El resumen de
  // continuidad se guarda en segundo plano justo después de guardar los mensajes, y sin esto las dos escrituras podían
  // cruzarse (una pisaba el `last` o el resumen de la otra). Cola en memoria por chat: una escritura espera a la
  // anterior y un fallo de una nunca bloquea a las siguientes.
  const chatWriteQueue = new Map();
  function withChatLock(chatId, fn) {
    const previous = chatWriteQueue.get(chatId) || Promise.resolve();
    const run = previous.then(fn);
    const tail = run.catch(() => {});
    chatWriteQueue.set(chatId, tail);
    tail.then(() => {
      if (chatWriteQueue.get(chatId) === tail) chatWriteQueue.delete(chatId);
    });
    return run;
  }

  function newId() {
    return 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  async function listCharacters() {
    const all = await backend.getAll('characters');
    return all.map(sanitizeCharacterExtras).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  async function getCharacter(id) {
    const found = await backend.get('characters', id);
    return found ? sanitizeCharacterExtras(found) : null;
  }

  async function saveCharacter(character) {
    if (!character || typeof character.id !== 'string' || !character.id) {
      throw new Error('El personaje no tiene un id válido.');
    }
    await backend.put('characters', character.id, character);
    return character;
  }

  // Persiste el lorebook autogenerado de un personaje (ver docs/NOTES.md,
  // "Lorebook por personaje", y www/js/api/lorebook.js). Es compartido por
  // todos los chats de ese personaje — a diferencia del progreso de disparo
  // (`chat.lorebookMessageCount`), que es por chat.
  //
  // Relee el personaje al guardar y modifica SOLO los campos de lorebook
  // (`lorebook`, `lorebookPrevious`, `lorebookPreviousAt`): así no pisa, por
  // ejemplo, un fondo de chat o un avatar cambiados mientras tanto.
  // `previous` (opcional) controla el "Deshacer" de un nivel: un arreglo
  // guarda esa copia (con la hora actual); `null` la borra; `undefined` la
  // deja como estaba.
  // `tombstonesPatch` (opcional, MEM-013): `{ tombstones, previousTombstones }`. `tombstones`
  // (array) reemplaza la lista actual de lápidas; `previousTombstones` guarda/borra la pareja de
  // `previous` para que "Deshacer" también revierta lápidas (mismo criterio: array = guarda, null =
  // borra, undefined = no toca). Sin este parámetro, las lápidas no se tocan.
  async function saveCharacterLorebook(characterId, lorebook, previous, tombstonesPatch) {
    const character = await getCharacter(characterId);
    if (!character) throw new Error('El personaje no existe.');
    const patch = { lorebook };
    if (Array.isArray(previous)) {
      patch.lorebookPrevious = previous;
      patch.lorebookPreviousAt = Date.now();
    } else if (previous === null) {
      patch.lorebookPrevious = [];
      patch.lorebookPreviousAt = 0;
    }
    if (tombstonesPatch && Array.isArray(tombstonesPatch.tombstones)) {
      patch.lorebookTombstones = tombstonesPatch.tombstones;
    }
    if (tombstonesPatch && Array.isArray(tombstonesPatch.previousTombstones)) {
      patch.lorebookTombstonesPrevious = tombstonesPatch.previousTombstones;
    } else if (tombstonesPatch && tombstonesPatch.previousTombstones === null) {
      patch.lorebookTombstonesPrevious = [];
    }
    const updated = sanitizeCharacterExtras({ ...character, ...patch });
    await backend.put('characters', characterId, updated);
    return updated;
  }

  // Persiste (con merge parcial, como saveSettings) el fondo de chat de un
  // personaje — ver `chatBackground*` en el typedef `Character`. Es por
  // personaje, no global ni por chat: se ve solo en SUS chats.
  async function saveCharacterBackground(characterId, patch) {
    const character = await getCharacter(characterId);
    if (!character) throw new Error('El personaje no existe.');
    const merged = sanitizeCharacterBackground({ ...character, ...(patch || {}) });
    const updated = sanitizeCharacterExtras({ ...character, ...merged });
    await backend.put('characters', characterId, updated);
    return updated;
  }

  // MEM-009: persiste la ficha de apariencia de un personaje. Relee el personaje y cambia SOLO `appearance` (no pisa lorebook, fondo ni
  // avatar cambiados mientras tanto). `patch` = { fixed?, current? }; `updated` se pone al guardar si algo cambió.
  async function saveCharacterAppearance(characterId, patch) {
    const character = await getCharacter(characterId);
    if (!character) throw new Error('El personaje no existe.');
    const before = character.appearance;
    const next = sanitizeAppearance({ ...before, ...(patch || {}), updated: 1 });
    const changed = next.fixed !== before.fixed || next.current !== before.current;
    const appearance = changed ? { ...next, updated: next.fixed || next.current ? Date.now() : 0 } : before;
    const updated = { ...character, appearance };
    await backend.put('characters', characterId, updated);
    return updated;
  }

  // MEM-014: persiste (con merge parcial, como saveCharacterAppearance) el estado de relación de un personaje. Lo usa
  // tanto el actualizador automático (`patch` completo: `{text, level, source:'auto'}`) como una edición manual desde
  // "Ver lorebook" (`patch` parcial: `{text, source:'manual'}`, conserva el `level` que ya tenía).
  async function saveCharacterRelationship(characterId, patch) {
    const character = await getCharacter(characterId);
    if (!character) throw new Error('El personaje no existe.');
    const before = character.relationship;
    const next = sanitizeRelationship({ ...before, ...(patch || {}), updated: 1 });
    const changed = next.text !== before.text || next.level !== before.level || next.source !== before.source;
    const relationship = changed ? { ...next, updated: next.text ? Date.now() : 0 } : before;
    const updated = { ...character, relationship };
    await backend.put('characters', characterId, updated);
    return updated;
  }

  async function deleteCharacter(id) {
    const chats = await listChats(id);
    const ops = [
      { type: 'remove', store: 'characters', key: id },
      { type: 'remove', store: 'chats', key: id }, // legado, por si quedó algo sin migrar
    ];
    for (const chat of chats) {
      ops.push({ type: 'remove', store: 'chatMeta', key: chat.id });
      ops.push({ type: 'remove', store: 'chatMsgs', key: chat.id });
    }
    await backend.atomic(ops);
  }

  // ---------- chats (varios por personaje) ----------

  async function listChats(characterId) {
    const all = await backend.getAll('chatMeta');
    return all
      .map(sanitizeChat)
      .filter((c) => c && c.characterId === characterId)
      .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  }

  async function getChat(chatId) {
    const found = await backend.get('chatMeta', chatId);
    return sanitizeChat(found);
  }

  async function getChatMessages(chatId) {
    const found = await backend.get('chatMsgs', chatId);
    return Array.isArray(found) ? found.map(sanitizeMessage) : null;
  }

  async function saveChatMessages(chatId, messages) {
    return withChatLock(chatId, async () => {
      const chat = await getChat(chatId);
      if (!chat) throw new Error('El chat no existe.');
      const updatedChat = { ...chat, last: previewLast(messages), updated: Date.now() };
      await backend.atomic([
        { type: 'put', store: 'chatMsgs', key: chatId, value: messages },
        { type: 'put', store: 'chatMeta', key: chatId, value: updatedChat },
      ]);
    });
  }

  async function createChat(characterId, opts = {}) {
    const character = await getCharacter(characterId);
    if (!character) throw new Error('El personaje no existe.');
    const now = Date.now();
    const chat = sanitizeChat({
      id: newId(),
      characterId,
      title: (opts && opts.title) || '',
      scenario: (opts && opts.scenario) || '',
      created: now,
      updated: now,
      last: '',
      lastExportAt: 0,
    });
    await backend.put('chatMeta', chat.id, chat);
    return chat;
  }

  async function renameChat(chatId, title) {
    return withChatLock(chatId, async () => {
      const chat = await getChat(chatId);
      if (!chat) throw new Error('El chat no existe.');
      const updated = { ...chat, title: String(title || '') };
      await backend.put('chatMeta', chatId, updated);
      return updated;
    });
  }

  // Marca cuándo se hizo el último respaldo automático de este chat (ver
  // `lastExportAt` en el typedef `Chat`). No es un "export" manual del
  // usuario; lo usa el respaldo silencioso periódico en segundo plano.
  async function markChatExported(chatId) {
    return withChatLock(chatId, async () => {
      const chat = await getChat(chatId);
      if (!chat) throw new Error('El chat no existe.');
      const updated = { ...chat, lastExportAt: Date.now() };
      await backend.put('chatMeta', chatId, updated);
      return updated;
    });
  }

  // Marca cuántos mensajes de ESTE chat ya se usaron para actualizar el
  // lorebook (compartido) de su personaje — ver `lorebookMessageCount` en
  // el typedef `Chat` y `saveCharacterLorebook()` más arriba, que es donde
  // se guardan las entradas en sí.
  async function markChatLorebookProgress(chatId, lorebookMessageCount) {
    return withChatLock(chatId, async () => {
      const chat = await getChat(chatId);
      if (!chat) throw new Error('El chat no existe.');
      const updated = { ...chat, lorebookMessageCount: Number(lorebookMessageCount) || 0 };
      await backend.put('chatMeta', chatId, updated);
      return updated;
    });
  }

  // MEM-007: guarda el resumen de continuidad de UN chat. Solo cambia ese campo (no toca `updated`, así la lista
  // de chats no se reordena por una actualización en segundo plano). Serializada con las demás escrituras del chat.
  async function saveChatContinuity(chatId, summary) {
    const clean = sanitizeContinuity(summary);
    return withChatLock(chatId, async () => {
      const chat = await getChat(chatId);
      if (!chat) throw new Error('El chat no existe.');
      const updated = { ...chat, continuitySummary: clean };
      await backend.put('chatMeta', chatId, updated);
      return updated;
    });
  }

  async function deleteChat(chatId) {
    return withChatLock(chatId, () =>
      backend.atomic([
        { type: 'remove', store: 'chatMeta', key: chatId },
        { type: 'remove', store: 'chatMsgs', key: chatId },
      ])
    );
  }

  // Migra chats del formato viejo (uno por personaje, guardado bajo el id
  // del propio personaje en el store "chats") al formato nuevo. Segura de
  // correr más de una vez: si el chat destino ya existe, no hace nada.
  async function migrateLegacyChats() {
    const characters = await listCharacters();
    for (const character of characters) {
      const legacyMessages = await backend.get('chats', character.id);
      if (!Array.isArray(legacyMessages)) continue;
      const existing = await getChat(character.id);
      if (existing) continue;
      const now = Date.now();
      const chat = sanitizeChat({
        id: character.id,
        characterId: character.id,
        title: 'Chat original',
        scenario: '',
        created: character.created || now,
        updated: now,
        last: previewLast(legacyMessages),
        lastExportAt: 0,
      });
      await backend.atomic([
        { type: 'put', store: 'chatMeta', key: chat.id, value: chat },
        { type: 'put', store: 'chatMsgs', key: chat.id, value: legacyMessages },
      ]);
    }
  }

  async function exportBackup() {
    const [settings, characters] = await Promise.all([getSettings(), listCharacters()]);
    const chats = {};
    const chatMessages = {};
    for (const character of characters) {
      const characterChats = await listChats(character.id);
      for (const chat of characterChats) {
        chats[chat.id] = chat;
        const msgs = await getChatMessages(chat.id);
        if (msgs) chatMessages[chat.id] = msgs;
      }
    }
    const payload = {
      app: 'companion',
      version: 2,
      exported: new Date().toISOString(),
      settings,
      characters,
      chats,
      chatMessages,
    };
    return new Blob([JSON.stringify(payload)], { type: 'application/json' });
  }

  // ---------- importación de copias (BKP-001) ----------
  // Tres pasos separados: (1) leer y validar el archivo UNA vez (`parseBackupText`), (2) analizarlo contra lo que ya hay
  // (`analyzeBackupFile`, sin escribir nada) y (3) aplicarlo (`importBackupData`) en UNA transacción, tras validar y sanear TODO.
  // La lógica de comparar y decidir vive en `backup.js` (pura y probada).

  async function readBackupFile(file) {
    let text;
    try {
      text = await file.text();
    } catch {
      throw new Error('No se pudo leer el archivo de copia de seguridad.');
    }
    return parseBackupText(text);
  }

  // Lo que ya hay, en la forma que necesita `analyzeBackup`. Solo se cuentan los mensajes de los chats que la copia también trae.
  async function snapshotExisting(norm) {
    const characters = await backend.getAll('characters');
    const chats = (await backend.getAll('chatMeta')).map(sanitizeChat).filter(Boolean);
    const wanted = new Set(norm.chats.map((c) => c.id));
    const messageCounts = {};
    for (const c of chats) {
      if (!wanted.has(c.id)) continue;
      const msgs = await backend.get('chatMsgs', c.id);
      messageCounts[c.id] = Array.isArray(msgs) ? msgs.length : 0;
    }
    return { characters, chats, messageCounts };
  }

  /** Lee el archivo, lo valida y lo compara con lo que hay. No escribe nada. Devuelve `{ data, analysis }` (`data` se pasa luego a `importBackupData`). */
  async function analyzeBackupFile(file) {
    const data = await readBackupFile(file);
    const norm = normalizeBackup(data);
    const existing = await snapshotExisting(norm);
    return { data, analysis: analyzeBackup(norm, existing) };
  }

  const validMessage = (m) => !!m && typeof m === 'object' && (m.role === 'user' || m.role === 'char') && typeof m.text === 'string';

  /**
   * Aplica una copia ya leída. `opts.mode`: `'merge'` (por defecto: solo agrega lo que falta, NO toca nada existente) o
   * `'replace'` (lo de la copia gana). `opts.includeSettings`: restaura también los ajustes (servidor, nombre, aspecto, PIN);
   * por defecto NO. Todo se valida y sanea antes de escribir y se escribe en una sola transacción: si falla, no cambia nada.
   */
  async function importBackupData(data, opts = {}) {
    const norm = normalizeBackup(data);
    const existing = await snapshotExisting(norm);
    const plan = planImport(norm, existing, { mode: opts.mode, includeSettings: opts.includeSettings === true });

    const ops = [];
    let droppedMessages = 0;
    let invalidChats = 0;
    for (const character of plan.characters) ops.push({ type: 'put', store: 'characters', key: character.id, value: character });
    for (const ch of plan.chats) {
      const meta = ch.legacy
        ? sanitizeChat({ id: ch.id, characterId: ch.characterId, title: 'Chat restaurado', scenario: '', created: Date.now(), updated: Date.now(), last: previewLast(ch.messages), lastExportAt: 0 })
        : sanitizeChat(ch.raw);
      if (!meta) {
        invalidChats++;
        continue;
      }
      ops.push({ type: 'put', store: 'chatMeta', key: meta.id, value: meta });
      if (Array.isArray(ch.messages)) {
        const clean = ch.messages.filter(validMessage).map(sanitizeMessage);
        droppedMessages += ch.messages.length - clean.length;
        ops.push({ type: 'put', store: 'chatMsgs', key: meta.id, value: clean });
      }
    }
    let settingsRestored = false;
    if (plan.settings) {
      const current = await getSettings();
      ops.push({ type: 'put', store: 'settings', key: SETTINGS_KEY, value: sanitizeSettings({ ...current, ...plan.settings }) });
      settingsRestored = true;
    }

    try {
      if (ops.length) await backend.atomic(ops); // todo o nada
    } catch (err) {
      throw new Error('No se pudo restaurar la copia. No se cambió nada de tus datos.');
    }
    const st = plan.stats;
    return {
      characters: st.addedCharacters + st.replacedCharacters, // compatibilidad con quien leía solo este número
      ...st,
      orphanChats: st.orphanChats + invalidChats,
      droppedMessages,
      settingsRestored,
      mode: plan.mode,
    };
  }

  /** Lee, valida y aplica en un paso (sin confirmación: la interfaz usa `analyzeBackupFile` + `importBackupData`). Por defecto solo AGREGA. */
  async function importBackup(file, opts = {}) {
    return importBackupData(await readBackupFile(file), opts);
  }

  return {
    getSettings,
    saveSettings,
    listCharacters,
    getCharacter,
    saveCharacter,
    saveCharacterLorebook,
    saveCharacterBackground,
    saveCharacterAppearance,
    saveCharacterRelationship,
    deleteCharacter,
    listChats,
    getChat,
    getChatMessages,
    saveChatMessages,
    createChat,
    renameChat,
    markChatExported,
    markChatLorebookProgress,
    saveChatContinuity,
    deleteChat,
    migrateLegacyChats,
    exportBackup,
    importBackup,
    analyzeBackupFile,
    importBackupData,
    newId,
  };
}

// ---------- backend de IndexedDB (uso real en la app) ----------

const DB_NAME = 'companion';
const DB_VERSION = 2;
const STORE_NAMES = ['settings', 'characters', 'chats', 'chatMeta', 'chatMsgs'];

function storageError(err) {
  const name = err && err.name;
  if (name === 'QuotaExceededError') {
    return new Error('No hay espacio suficiente en el dispositivo para guardar los datos.');
  }
  if (name === 'VersionError' || name === 'InvalidStateError') {
    return new Error('No se pudo acceder al almacenamiento del dispositivo.');
  }
  return new Error('Ocurrió un error al guardar los datos en el dispositivo.');
}

function wrapRequest(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
  });
}

function openCompanionDb(dbName = DB_NAME) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // Solo la base aislada del banco de pruebas de estrés (UI-005): se cierra cuando alguien la borra, para que el borrado no
      // quede bloqueado. La base real (DB_NAME) no cambia de comportamiento.
      if (dbName !== DB_NAME) db.onversionchange = () => db.close();
      resolve(db);
    };
    req.onerror = () => reject(storageError(req.error));
    req.onblocked = () => {
      reject(new Error('La base de datos está bloqueada por otra pestaña. Cierra otras ventanas de la app e inténtalo de nuevo.'));
    };
  });
}

// `dbName` solo lo cambia el banco de pruebas de estrés (UI-005), que usa OTRA base de datos con los mismos almacenes para no
// poder tocar nunca los datos reales; la app usa siempre el valor por defecto.
export function createIndexedDbBackend(dbName = DB_NAME) {
  let dbPromise = null;
  const getDb = () => (dbPromise || (dbPromise = openCompanionDb(dbName)));

  return {
    async get(store, key) {
      const db = await getDb();
      const tx = db.transaction(store, 'readonly');
      return wrapRequest(tx.objectStore(store).get(key));
    },
    async getAll(store) {
      const db = await getDb();
      const tx = db.transaction(store, 'readonly');
      const result = await wrapRequest(tx.objectStore(store).getAll());
      return result || [];
    },
    async put(store, key, value) {
      const db = await getDb();
      const tx = db.transaction(store, 'readwrite');
      await wrapRequest(tx.objectStore(store).put(value, key));
    },
    async remove(store, key) {
      const db = await getDb();
      const tx = db.transaction(store, 'readwrite');
      await wrapRequest(tx.objectStore(store).delete(key));
    },
    async atomic(ops) {
      const db = await getDb();
      const storeNames = [...new Set(ops.map((op) => op.store))];
      const tx = db.transaction(storeNames, 'readwrite');
      await new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(storageError(tx.error));
        tx.onabort = () => reject(storageError(tx.error));
        for (const op of ops) {
          const os = tx.objectStore(op.store);
          if (op.type === 'put') os.put(op.value, op.key);
          else if (op.type === 'remove') os.delete(op.key);
        }
      });
    },
  };
}

// Instancia por defecto ligada a IndexedDB, creada de forma perezosa: importar
// este módulo en un entorno sin IndexedDB (por ejemplo, los tests con Node)
// no falla; solo falla si de verdad se usan estas funciones ahí.
let defaultInstance = null;
function getDefaultInstance() {
  if (!defaultInstance) {
    if (typeof indexedDB === 'undefined') {
      throw new Error('IndexedDB no está disponible en este entorno.');
    }
    defaultInstance = createState(createIndexedDbBackend());
  }
  return defaultInstance;
}

export const getSettings = (...args) => getDefaultInstance().getSettings(...args);
export const saveSettings = (...args) => getDefaultInstance().saveSettings(...args);
export const listCharacters = (...args) => getDefaultInstance().listCharacters(...args);
export const getCharacter = (...args) => getDefaultInstance().getCharacter(...args);
export const saveCharacter = (...args) => getDefaultInstance().saveCharacter(...args);
export const saveCharacterLorebook = (...args) => getDefaultInstance().saveCharacterLorebook(...args);
export const saveCharacterBackground = (...args) => getDefaultInstance().saveCharacterBackground(...args);
export const saveCharacterAppearance = (...args) => getDefaultInstance().saveCharacterAppearance(...args);
export const saveCharacterRelationship = (...args) => getDefaultInstance().saveCharacterRelationship(...args);
export const deleteCharacter = (...args) => getDefaultInstance().deleteCharacter(...args);
export const listChats = (...args) => getDefaultInstance().listChats(...args);
export const getChat = (...args) => getDefaultInstance().getChat(...args);
export const getChatMessages = (...args) => getDefaultInstance().getChatMessages(...args);
export const saveChatMessages = (...args) => getDefaultInstance().saveChatMessages(...args);
export const createChat = (...args) => getDefaultInstance().createChat(...args);
export const renameChat = (...args) => getDefaultInstance().renameChat(...args);
export const markChatExported = (...args) => getDefaultInstance().markChatExported(...args);
export const markChatLorebookProgress = (...args) => getDefaultInstance().markChatLorebookProgress(...args);
export const saveChatContinuity = (...args) => getDefaultInstance().saveChatContinuity(...args);
export const deleteChat = (...args) => getDefaultInstance().deleteChat(...args);
export const migrateLegacyChats = (...args) => getDefaultInstance().migrateLegacyChats(...args);
export const exportBackup = (...args) => getDefaultInstance().exportBackup(...args);
export const importBackup = (...args) => getDefaultInstance().importBackup(...args);
export const analyzeBackupFile = (...args) => getDefaultInstance().analyzeBackupFile(...args);
export const importBackupData = (...args) => getDefaultInstance().importBackupData(...args);
export const newId = (...args) => getDefaultInstance().newId(...args);
