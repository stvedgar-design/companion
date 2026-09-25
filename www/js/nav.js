// www/js/nav.js
// Decisiones de navegación puras (sin DOM ni historial), para poder probarlas:
// a qué pantalla lleva "Continuar".

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
