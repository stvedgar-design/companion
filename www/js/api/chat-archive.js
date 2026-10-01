// www/js/api/chat-archive.js
// MEM-018: archivar un episodio completo. Orden fijo: (1) forzar la extracción de recuerdos de ese episodio, (2) forzar su
// resumen de continuidad y (3) marcarlo como archivado (oculto de la lista; la transcripción NO se toca). Si el servidor no
// responde en (1) o (2), el episodio queda "pendiente de archivar" (sigue en la lista, con un indicador) y se completa solo
// la próxima vez que el servidor responda (`retryPending`).
//
// Módulo puro (docs/PRINCIPIOS-DE-INGENIERIA.md, 10): no importa nada de la app. La extracción y el resumen son los de
// siempre (`createLoreUpdater().runNow()` de MEM-013 y `createContinuityUpdater().runNow()` de MEM-007), inyectados por
// quien lo usa (ui/chat-archive.js); aquí solo se decide el orden y qué hacer con cada resultado.
//
// Qué significa cada resultado de esos dos pasos (los `kind` que ya devuelven los actualizadores):
//   - El servidor NO respondió o se cortó (`unavailable`, `aborted`, `busy`) → pendiente: se reintenta luego.
//   - El servidor respondió pero no había nada que hacer o el texto no sirvió (`ok`, `nochange`, `unparsed`, `unverified`,
//     `toolittle`, `notyet`, `none`, `skipped`) → el paso termina: reintentar contra un modelo que no sigue el formato no
//     arregla nada (misma regla de MEM-001 v2). En particular un episodio corto o que aún cabe entero en la memoria no tiene
//     nada que extraer o resumir: se archiva igual, sin esos pasos.
//   - Un fallo local (`error`: no se pudo leer o escribir) en la extracción → NO se archiva ni queda pendiente (no se reintenta
//     sin fin un fallo que no depende del servidor); el episodio sigue activo y se avisa. En el resumen es de mejor esfuerzo
//     (el resumen es un extra de cada episodio; nunca bloquea archivar).

/** Resultados con los que un paso se considera "el servidor no respondió": el episodio queda pendiente. */
const SERVER_DOWN_KINDS = new Set(['unavailable', 'aborted', 'busy']);

/**
 * @typedef {object} ArchiveDeps
 * @property {(chatId: string) => Promise<object|null>} loadChat
 * @property {(chatId: string) => Promise<object[]|null>} loadMessages
 * @property {(characterId: string) => Promise<object|null>} loadCharacter
 * @property {() => Promise<object>} loadSettings
 * @property {() => Promise<object[]>} listPendingChats  episodios con `archivePendingAt` y sin `archivedAt`
 * @property {(chatId: string, patch: { archivedAt?: number, archivePendingAt?: number }) => Promise<object>} saveArchive
 * @property {(settings: object) => Promise<boolean>} serverUp  una comprobación corta (la de `connect()` de kobold.js)
 * @property {(ctx: object) => Promise<{kind: string}>} extractMemories  `runNow()` de MEM-013 sobre `ctx`
 * @property {(ctx: object) => Promise<{kind: string}>} summarize  `runNow()` de MEM-007 sobre `ctx`
 * @property {(ctx: object) => Promise<void>} [refreshRelationship]  `maybeRun()` de MEM-014 (mejor esfuerzo)
 * @property {() => number} [now]
 */

/**
 * @param {ArchiveDeps} deps
 */
export function createChatArchiver(deps) {
  const now = deps.now || (() => Date.now());
  let current = null; // { chatId, aborted }
  let tail = Promise.resolve(); // un episodio a la vez: nunca dos extracciones contra el servidor

  async function context(chat) {
    const [character, settings, messages] = await Promise.all([
      deps.loadCharacter(chat.characterId),
      deps.loadSettings(),
      deps.loadMessages(chat.id),
    ]);
    if (!character || !settings) return null;
    return { character, chat, messages: Array.isArray(messages) ? messages : [], settings };
  }

  async function process(chatId, source) {
    const token = { chatId, aborted: false };
    current = token;
    try {
      const chat = await deps.loadChat(chatId);
      if (!chat) return { kind: 'missing' };
      if (chat.archivedAt > 0) return { kind: 'already' };
      // En un reintento solo se sigue si SIGUE pendiente: si el usuario retomó el episodio (mandó un mensaje) se canceló.
      if (source === 'retry' && !(chat.archivePendingAt > 0)) return { kind: 'cancelled' };

      // Se deja constancia ANTES de empezar: si Android mata la app a la mitad, al volver sigue pendiente (principio 7).
      if (!(chat.archivePendingAt > 0)) await deps.saveArchive(chatId, { archivePendingAt: now() });

      const ctx = await context(chat);
      if (!ctx) return { kind: 'error', reason: 'no-context' };

      // Comprobación corta primero: con el servidor apagado, `completeOnce` puede tardar hasta 2 minutos en rendirse.
      let up = false;
      try {
        up = await deps.serverUp(ctx.settings);
      } catch {
        up = false;
      }
      if (token.aborted) return { kind: 'pending', reason: 'aborted' };
      if (!up) return { kind: 'pending', reason: 'server-down' };

      const steps = {};

      // (1) recuerdos
      let lore;
      try {
        lore = await deps.extractMemories(ctx);
      } catch {
        lore = { kind: 'error' };
      }
      steps.memories = lore.kind;
      if (token.aborted || SERVER_DOWN_KINDS.has(lore.kind)) return { kind: 'pending', reason: 'server-down', steps };
      if (lore.kind === 'error') {
        // Fallo local: no queda pendiente (no se reintenta sin fin) y el episodio sigue activo.
        await deps.saveArchive(chatId, { archivePendingAt: 0 });
        return { kind: 'error', reason: 'memories', steps };
      }
      if (lore.kind === 'ok' && deps.refreshRelationship) {
        try {
          const fresh = await deps.loadCharacter(chat.characterId);
          if (fresh) await deps.refreshRelationship({ ...ctx, character: fresh });
        } catch {
          // mejor esfuerzo: la relación se vuelve a evaluar sola con el siguiente cambio de recuerdos
        }
      }

      // (2) resumen (ctx con el episodio ya releído: la extracción pudo cambiar `lorebookMessageCount`)
      let recap;
      try {
        const freshChat = (await deps.loadChat(chatId)) || chat;
        recap = await deps.summarize({ ...ctx, chat: freshChat });
      } catch {
        recap = { kind: 'error' };
      }
      steps.summary = recap.kind;
      if (token.aborted || SERVER_DOWN_KINDS.has(recap.kind)) return { kind: 'pending', reason: 'server-down', steps };

      // (3) archivar — solo si no lo retomaron mientras tanto
      const latest = await deps.loadChat(chatId);
      if (!latest) return { kind: 'missing' };
      if (!(latest.archivePendingAt > 0)) return { kind: 'cancelled', steps };
      await deps.saveArchive(chatId, { archivedAt: now(), archivePendingAt: 0 });
      return { kind: 'archived', steps };
    } catch {
      return { kind: 'error', reason: 'unexpected' };
    } finally {
      if (current === token) current = null;
    }
  }

  function enqueue(chatId, source) {
    const run = tail.then(() => process(chatId, source));
    tail = run.catch(() => {});
    return run;
  }

  return {
    /** "Archivar este episodio". Devuelve `{kind:'archived'|'pending'|'error'|'missing'|'already', steps?, reason?}`. */
    archive(chatId) {
      return enqueue(chatId, 'manual');
    },
    /**
     * Completa los episodios que quedaron pendientes (cuando el servidor vuelve a responder). Si el servidor sigue apagado,
     * no hace nada más que una comprobación corta.
     * @returns {Promise<{ attempted: number, archived: number }>}
     */
    async retryPending() {
      let pending = [];
      try {
        pending = (await deps.listPendingChats()) || [];
      } catch {
        return { attempted: 0, archived: 0 };
      }
      let archived = 0;
      let attempted = 0;
      for (const chat of pending) {
        attempted++;
        const result = await enqueue(chat.id, 'retry');
        if (result.kind === 'archived') archived++;
        // El servidor sigue sin responder (o se canceló): no tiene sentido probar el resto ahora.
        if (result.kind === 'pending') break;
      }
      return { attempted, archived };
    },
    /** Corta lo que esté corriendo (el usuario abrió un chat o envió un mensaje): el episodio queda pendiente. */
    abort() {
      if (current) current.aborted = true;
    },
    isRunning() {
      return !!current;
    },
  };
}

/**
 * Texto para el usuario según el resultado de `archive()`.
 * @param {{ kind: string }} result
 * @returns {string}
 */
export function archiveResultMessage(result) {
  switch (result && result.kind) {
    case 'archived':
      return 'Episodio archivado. Lo encuentras en «Episodios archivados».';
    case 'pending':
      return 'El servidor no responde ahora. El episodio quedó «pendiente de archivar» y se archivará solo cuando el servidor vuelva a estar encendido.';
    case 'error':
      return 'No se pudo archivar el episodio. No se cambió nada.';
    case 'already':
      return 'Este episodio ya estaba archivado.';
    case 'cancelled':
      return 'Se canceló el archivado de este episodio.';
    default:
      return 'No se pudo archivar el episodio.';
  }
}
