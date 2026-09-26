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

/** UI-016: cuánto tiene que moverse la lista (px) para que un scroll cuente como "el usuario se fue a otro lado". */
export const SCROLL_CLOSE_THRESHOLD_PX = 12;
/** UI-016: margen (px) que se deja entre el menú y el borde de la lista al desplazarlo a la vista. */
export const REVEAL_MARGIN_PX = 8;

/**
 * UI-016: cuánto hay que desplazar la lista para que el elemento (el menú recién abierto) quede COMPLETO a la vista.
 * Positivo = bajar la lista (el elemento está por debajo), negativo = subirla, 0 = ya se ve entero. Si el elemento es
 * más alto que la zona visible, se prioriza que se vea su parte superior.
 * @param {{ top: number, bottom: number }} el rectángulo del elemento (coordenadas de pantalla)
 * @param {{ top: number, bottom: number }} view rectángulo de la zona visible de la lista
 */
export function revealDelta(el, view, margin = REVEAL_MARGIN_PX) {
  if (el.top - margin < view.top) return el.top - margin - view.top;
  if (el.bottom + margin > view.bottom) {
    const down = el.bottom + margin - view.bottom;
    const maxDown = el.top - margin - view.top; // no pasarse: que el borde superior siga visible
    return Math.max(0, Math.min(down, maxDown));
  }
  return 0;
}

/**
 * UI-016: ¿este evento de scroll debe cerrar el menú? Solo si hay menú abierto y la lista se movió de verdad
 * (más del umbral) respecto de donde estaba al abrirlo: un temblor del dedo, o el propio ajuste al abrir, no lo cierra.
 * @param {{ open: boolean, scrollTop: number, openScrollTop: number }} s
 */
export function shouldCloseOnScroll({ open, scrollTop, openScrollTop }) {
  return !!open && Math.abs(scrollTop - openScrollTop) > SCROLL_CLOSE_THRESHOLD_PX;
}
