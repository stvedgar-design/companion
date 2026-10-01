// www/js/ui/chat-archive.js
// MEM-018: conecta el archivador (api/chat-archive.js, puro) con el resto de la app. Crea UNA segunda instancia de los mismos
// actualizadores que usa chat.js (recuerdos MEM-013, resumen MEM-007, relación MEM-014) — la misma lógica, no una copia — pero
// apuntando a un episodio cualquiera (no necesariamente el que está abierto). Por eso se puede archivar y completar un
// "pendiente de archivar" sin abrir el episodio.
//
// Servidor: se reutiliza `connect()` de kobold.js, la misma comprobación corta (6 s) que usa el punto verde del hub.
// Reintento automático: cuando el hub confirma que el servidor responde (`retryPendingArchives()`, llamado desde home.js:
// cada vez que se abre la app o se vuelve al hub). Deliberadamente NO se dispara al enviar un mensaje en un chat: cada
// extracción invalida la caché de prompt del servidor y encarece la siguiente respuesta (docs/NOTES.md, "Latencia de la
// memoria"), y en un chat abierto eso se notaría. Si el usuario abre un chat mientras corre el reintento, se corta
// (`cancelBackgroundArchive`) y el episodio sigue pendiente para la próxima vez.

import {
  getChat,
  getChatMessages,
  getCharacter,
  getSettings,
  listCharacters,
  listChats,
  saveCharacterLorebook,
  saveCharacterRelationship,
  saveChatContinuity,
  saveChatArchive,
  markChatLorebookProgress,
  isChatArchivePending,
  isChatArchived,
} from '../state.js';
import { connect, completeOnce, completeChatOnce } from '../api/kobold.js';
import { createLoreUpdater } from '../api/lorebook.js';
import { createContinuityUpdater, cleanRecap, verifyRecap } from '../api/continuity.js';
import { createRelationshipUpdater, sanitizeRelationship } from '../api/relationship.js';
import { createChatArchiver, archiveResultMessage } from '../api/chat-archive.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';

export { archiveResultMessage };

let activeCtx = null; // el episodio que se está procesando ahora (el archivador procesa de a uno)
let relationshipLevelBefore = 'early';

const complete = (request, opts) =>
  request.mode === 'chat' ? completeChatOnce(request.messages, activeCtx.settings, opts) : completeOnce(request.prompt, activeCtx.settings, opts);

const loreUpdater = createLoreUpdater({
  getContext: () => activeCtx,
  isChatBusy: () => false,
  complete: (prompt, opts) => completeOnce(prompt, activeCtx.settings, opts),
  loadLorebook: async (characterId) => {
    const fresh = await getCharacter(characterId);
    return (fresh && fresh.lorebook) || [];
  },
  loadTombstones: async (characterId) => {
    const fresh = await getCharacter(characterId);
    return (fresh && fresh.lorebookTombstones) || [];
  },
  saveLorebook: async (characterId, entries, previous, tombstones, previousTombstones) => {
    await saveCharacterLorebook(characterId, entries, previous, { tombstones, previousTombstones });
  },
  markProgress: async (chatId, count) => {
    await markChatLorebookProgress(chatId, count);
  },
  onStatus: (status) => {
    if (status.kind === 'ok' && activeCtx) {
      if (status.added > 0) logEvent(TEL_EVENTS.MEMORY_CREATED, { characterId: activeCtx.character.id, source: 'auto', count: status.added });
      if (status.updated > 0) logEvent(TEL_EVENTS.MEMORY_MERGED, { characterId: activeCtx.character.id, count: status.updated });
    }
  },
});

const continuityUpdater = createContinuityUpdater({
  getContext: () => activeCtx,
  isChatBusy: () => false,
  complete,
  loadChat: (chatId) => getChat(chatId),
  saveContinuity: async (chatId, summary) => {
    await saveChatContinuity(chatId, summary);
  },
  onStatus: (status) => {
    if (status.kind === 'ok' && activeCtx) {
      logEvent(TEL_EVENTS.CONTINUITY_UPDATED, { characterId: activeCtx.character.id, chatId: activeCtx.chat.id, cause: 'manual' });
    }
  },
});

const relationshipUpdater = createRelationshipUpdater({
  getContext: () => activeCtx,
  isChatBusy: () => false,
  complete,
  cleanText: cleanRecap,
  verifyText: verifyRecap,
  loadCharacter: (characterId) => getCharacter(characterId),
  saveRelationship: async (characterId, patch) => {
    relationshipLevelBefore = sanitizeRelationship(activeCtx && activeCtx.character && activeCtx.character.relationship).level;
    await saveCharacterRelationship(characterId, patch);
  },
  onLevelChanged: ({ level } = {}) => {
    if (activeCtx && level && level !== relationshipLevelBefore) {
      logEvent(TEL_EVENTS.RELATIONSHIP_LEVEL_CHANGED, { characterId: activeCtx.character.id, from: relationshipLevelBefore, to: level });
    }
  },
});

const archiver = createChatArchiver({
  loadChat: (chatId) => getChat(chatId),
  loadMessages: (chatId) => getChatMessages(chatId),
  loadCharacter: (characterId) => getCharacter(characterId),
  loadSettings: () => getSettings(),
  saveArchive: (chatId, patch) => saveChatArchive(chatId, patch),
  listPendingChats: async () => {
    const out = [];
    for (const character of await listCharacters()) {
      for (const chat of await listChats(character.id)) if (isChatArchivePending(chat) && !isChatArchived(chat)) out.push(chat);
    }
    return out.sort((a, b) => (a.archivePendingAt || 0) - (b.archivePendingAt || 0));
  },
  serverUp: async (settings) => {
    try {
      await connect(settings.url);
      return true;
    } catch {
      return false;
    }
  },
  extractMemories: async (ctx) => {
    activeCtx = ctx;
    return loreUpdater.runNow();
  },
  summarize: async (ctx) => {
    activeCtx = ctx;
    return continuityUpdater.runNow();
  },
  refreshRelationship: async (ctx) => {
    activeCtx = ctx;
    await relationshipUpdater.maybeRun();
  },
});

/** "Archivar este episodio": ver `createChatArchiver().archive` en api/chat-archive.js. */
export function archiveChat(chatId) {
  return archiver.archive(chatId);
}

/** Completa los episodios pendientes si el servidor responde. Nunca lanza. */
export async function retryPendingArchives() {
  try {
    return await archiver.retryPending();
  } catch {
    return { attempted: 0, archived: 0 };
  }
}

/** Corta un archivado que esté corriendo en segundo plano (el usuario abrió un chat); el episodio sigue pendiente. */
export function cancelBackgroundArchive() {
  if (!archiver.isRunning()) return;
  archiver.abort();
  loreUpdater.abort();
  continuityUpdater.abort();
  relationshipUpdater.abort();
}

export function isArchiveRunning() {
  return archiver.isRunning();
}
