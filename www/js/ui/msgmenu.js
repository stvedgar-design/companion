// www/js/ui/msgmenu.js
// UI-006: qué acciones ofrece el menú de un mensaje (puro, sin DOM). El menú se construye UNA vez en
// `chat.js` y se reutiliza para el mensaje seleccionado; aquí solo vive la definición y las condiciones.

/** Orden y textos de las acciones (los mismos de siempre). */
export const MESSAGE_ACTIONS = Object.freeze([
  Object.freeze({ id: 'edit', label: 'Editar' }),
  Object.freeze({ id: 'delete', label: 'Borrar' }),
  Object.freeze({ id: 'copy', label: 'Copiar' }),
  Object.freeze({ id: 'regenerate', label: 'Regenerar' }),
]);

/**
 * Acciones disponibles para un mensaje. Editar, Borrar y Copiar siempre; Regenerar solo en el ÚLTIMO mensaje
 * del personaje. Con una respuesta en curso (`busy`) no hay menú.
 * @param {{ role: 'user'|'char', isLast: boolean, busy?: boolean }} m
 * @returns {string[]} ids de `MESSAGE_ACTIONS`
 */
export function availableMessageActions({ role, isLast, busy = false }) {
  if (busy) return [];
  return MESSAGE_ACTIONS.filter((a) => a.id !== 'regenerate' || (isLast && role === 'char')).map((a) => a.id);
}
