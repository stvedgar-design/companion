// www/js/state.js
// Capa de persistencia: ajustes, personajes y chats en IndexedDB.
// Backend inyectable: createState(backend) permite usar un backend en memoria en tests.
// Única API asíncrona y estable; la estructura interna del backend es libre.

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
 * @property {string} chatBackground           // data URL JPEG del fondo de SUS chats, '' si no hay
 * @property {number} chatBackgroundBrightness // 20 a 180 (%), 100 = sin cambios
 * @property {boolean} chatBackgroundFade      // fundido a negro en la mitad inferior de la imagen
 * @property {'fill'|'stretch'} chatBackgroundFit // 'fill' = cubre y recorta; 'stretch' = deforma sin recortar
 *   El fondo es por personaje (no global, no por chat): ver docs/NOTES.md,
 *   "Fondo de chat por personaje". Se ve solo dentro de sus chats — el resto
 *   de la app sigue el fondo del skin activo (ver www/css/themes.css).
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
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'char'} role
 * @property {string} text
 * @property {number} ts
 * @property {{ id: string, keys: string[], content: string, always: boolean }[]} [loreUsed]
 *   UI-010, solo mensajes del personaje: copia de los recuerdos que viajaron en el prompt de ESE mensaje
 *   (`[]` = ninguno). Ausente = mensaje anterior a UI-010 / sin dato (no se muestra icono).
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
 * @property {'nomi'|'glass'|'imessage'} theme // skin visual, ver www/css/themes.css
 * @property {'dark'|'light'} themeMode        // claro/oscuro, aplica a cualquier skin
 * @property {boolean} lorebookAuto // MEM-002: extracción automática de memoria cada ~20 mensajes; false por defecto (cada extracción encarece la SIGUIENTE respuesta ~20 s)
 * @property {boolean} varietyAssist // FMT-004: nota de variedad al final del prompt cuando el personaje se repite
 * @property {boolean} formatAssist // FMT-002: la respuesta del personaje arranca ya dentro de una acción (`*`); true por defecto
 */

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
  theme: 'nomi',
  themeMode: 'dark',
  lorebookAuto: false,
  varietyAssist: false,
  formatAssist: true,
});

// Por defecto de los campos de fondo de chat en Character (ver
// sanitizeCharacterExtras): mismos valores que tenía Settings antes de que
// el fondo pasara a ser por personaje.
const DEFAULT_CHARACTER_BACKGROUND = Object.freeze({
  chatBackground: '',
  chatBackgroundBrightness: 100,
  chatBackgroundFade: false,
  chatBackgroundFit: 'fill',
});

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
    theme: ['nomi', 'glass', 'imessage'].includes(merged.theme) ? merged.theme : DEFAULT_SETTINGS.theme,
    themeMode: merged.themeMode === 'light' ? 'light' : DEFAULT_SETTINGS.themeMode,
    lorebookAuto: merged.lorebookAuto === true,
    varietyAssist: merged.varietyAssist === true,
    formatAssist: merged.formatAssist !== false,
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

// Solo toca el campo `loreUsed`; cualquier otro campo del mensaje (y los mensajes sin él) pasan tal cual.
function sanitizeMessage(m) {
  if (!m || typeof m !== 'object' || !('loreUsed' in m)) return m;
  const { loreUsed, ...rest } = m;
  const clean = m.role === 'char' ? sanitizeLoreUsed(loreUsed) : undefined;
  return clean === undefined ? rest : { ...rest, loreUsed: clean };
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
  return { ...raw, lorebook, lorebookPrevious, lorebookPreviousAt, ...sanitizeCharacterBackground(raw) };
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
  async function saveCharacterLorebook(characterId, lorebook, previous) {
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
    const chat = await getChat(chatId);
    if (!chat) throw new Error('El chat no existe.');
    const updatedChat = { ...chat, last: previewLast(messages), updated: Date.now() };
    await backend.atomic([
      { type: 'put', store: 'chatMsgs', key: chatId, value: messages },
      { type: 'put', store: 'chatMeta', key: chatId, value: updatedChat },
    ]);
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
    const chat = await getChat(chatId);
    if (!chat) throw new Error('El chat no existe.');
    const updated = { ...chat, title: String(title || '') };
    await backend.put('chatMeta', chatId, updated);
    return updated;
  }

  // Marca cuándo se hizo el último respaldo automático de este chat (ver
  // `lastExportAt` en el typedef `Chat`). No es un "export" manual del
  // usuario; lo usa el respaldo silencioso periódico en segundo plano.
  async function markChatExported(chatId) {
    const chat = await getChat(chatId);
    if (!chat) throw new Error('El chat no existe.');
    const updated = { ...chat, lastExportAt: Date.now() };
    await backend.put('chatMeta', chatId, updated);
    return updated;
  }

  // Marca cuántos mensajes de ESTE chat ya se usaron para actualizar el
  // lorebook (compartido) de su personaje — ver `lorebookMessageCount` en
  // el typedef `Chat` y `saveCharacterLorebook()` más arriba, que es donde
  // se guardan las entradas en sí.
  async function markChatLorebookProgress(chatId, lorebookMessageCount) {
    const chat = await getChat(chatId);
    if (!chat) throw new Error('El chat no existe.');
    const updated = { ...chat, lorebookMessageCount: Number(lorebookMessageCount) || 0 };
    await backend.put('chatMeta', chatId, updated);
    return updated;
  }

  async function deleteChat(chatId) {
    await backend.atomic([
      { type: 'remove', store: 'chatMeta', key: chatId },
      { type: 'remove', store: 'chatMsgs', key: chatId },
    ]);
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

  async function importBackup(file) {
    let text;
    try {
      text = await file.text();
    } catch {
      throw new Error('No se pudo leer el archivo de copia de seguridad.');
    }

    let data;
    try {
      data = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }

    if (!data || typeof data !== 'object' || data.app !== 'companion' || !Array.isArray(data.characters)) {
      throw new Error('Ese archivo no es una copia de seguridad válida de Companion.');
    }

    let count = 0;
    for (const character of data.characters) {
      if (!character || typeof character.id !== 'string' || !character.id) continue;
      await saveCharacter(character);
      count += 1;
    }

    if (data.version === 2 && data.chats && typeof data.chats === 'object') {
      const chatMessagesById = (data.chatMessages && typeof data.chatMessages === 'object') ? data.chatMessages : {};
      for (const chatId of Object.keys(data.chats)) {
        const chat = sanitizeChat(data.chats[chatId]);
        if (!chat) continue;
        await backend.put('chatMeta', chat.id, chat);
        const msgs = chatMessagesById[chatId];
        if (Array.isArray(msgs)) await backend.put('chatMsgs', chat.id, msgs);
      }
    } else if (data.chats && typeof data.chats === 'object') {
      // Copia de seguridad del formato viejo: un chat por personaje.
      for (const characterId of Object.keys(data.chats)) {
        const legacyMessages = data.chats[characterId];
        if (!Array.isArray(legacyMessages)) continue;
        const now = Date.now();
        const chat = sanitizeChat({
          id: characterId,
          characterId,
          title: 'Chat restaurado',
          scenario: '',
          created: now,
          updated: now,
          last: previewLast(legacyMessages),
          lastExportAt: 0,
        });
        await backend.put('chatMeta', chat.id, chat);
        await backend.put('chatMsgs', chat.id, legacyMessages);
      }
    }

    // No se pisa settings.url ni se restauran otros ajustes.
    return { characters: count };
  }

  return {
    getSettings,
    saveSettings,
    listCharacters,
    getCharacter,
    saveCharacter,
    saveCharacterLorebook,
    saveCharacterBackground,
    deleteCharacter,
    listChats,
    getChat,
    getChatMessages,
    saveChatMessages,
    createChat,
    renameChat,
    markChatExported,
    markChatLorebookProgress,
    deleteChat,
    migrateLegacyChats,
    exportBackup,
    importBackup,
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

function openCompanionDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORE_NAMES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(storageError(req.error));
    req.onblocked = () => {
      reject(new Error('La base de datos está bloqueada por otra pestaña. Cierra otras ventanas de la app e inténtalo de nuevo.'));
    };
  });
}

function createIndexedDbBackend() {
  let dbPromise = null;
  const getDb = () => (dbPromise || (dbPromise = openCompanionDb()));

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
export const deleteCharacter = (...args) => getDefaultInstance().deleteCharacter(...args);
export const listChats = (...args) => getDefaultInstance().listChats(...args);
export const getChat = (...args) => getDefaultInstance().getChat(...args);
export const getChatMessages = (...args) => getDefaultInstance().getChatMessages(...args);
export const saveChatMessages = (...args) => getDefaultInstance().saveChatMessages(...args);
export const createChat = (...args) => getDefaultInstance().createChat(...args);
export const renameChat = (...args) => getDefaultInstance().renameChat(...args);
export const markChatExported = (...args) => getDefaultInstance().markChatExported(...args);
export const markChatLorebookProgress = (...args) => getDefaultInstance().markChatLorebookProgress(...args);
export const deleteChat = (...args) => getDefaultInstance().deleteChat(...args);
export const migrateLegacyChats = (...args) => getDefaultInstance().migrateLegacyChats(...args);
export const exportBackup = (...args) => getDefaultInstance().exportBackup(...args);
export const importBackup = (...args) => getDefaultInstance().importBackup(...args);
export const newId = (...args) => getDefaultInstance().newId(...args);
