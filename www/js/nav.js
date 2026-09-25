// www/js/nav.js
// Decisiones de navegación puras (sin DOM ni historial), para poder probarlas:
// a qué pantalla lleva "Continuar" y qué hace el botón "atrás" de Android.

/** Vistas raíz: ahí "atrás" cierra la app (el hub, o la configuración inicial). */
export const ROOT_VIEWS = ['home', 'setup'];

/**
 * UI-013: destino de "Continuar" en la tarjeta de un personaje.
 * Con chats: el de `updated` más reciente. Sin chats: la lista de chats, que
 * ya crea uno nuevo y entra directo (ver `chats.js`, `show()`).
 * @param {string} characterId
 * @param {{ id: string, updated?: number }[]} chats
 * @returns {{ view: 'chat'|'chats', params: object }}
 */
export function continueTarget(characterId, chats) {
  let latest = null;
  for (const chat of Array.isArray(chats) ? chats : []) {
    if (!chat || !chat.id) continue;
    if (!latest || (chat.updated || 0) > (latest.updated || 0)) latest = chat;
  }
  if (latest) return { view: 'chat', params: { chatId: latest.id } };
  return { view: 'chats', params: { characterId } };
}

/**
 * UI-014: qué hacer cuando Android manda "atrás".
 * Primero se cierra una hoja/diálogo; luego se retrocede una pantalla; en la
 * raíz (o sin vista activa, p. ej. con el PIN de bloqueo puesto) se sale.
 * @param {{ sheetOpen: boolean, view: string|null }} s
 * @returns {'close-sheet'|'back'|'exit'}
 */
export function decideBack({ sheetOpen, view }) {
  if (sheetOpen) return 'close-sheet';
  if (!view || ROOT_VIEWS.includes(view)) return 'exit';
  return 'back';
}
