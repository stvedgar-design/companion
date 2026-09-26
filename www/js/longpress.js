// www/js/longpress.js
// UI-022: detector de pulsación larga, puro (sin DOM). Se inyectan los temporizadores para probarlo con reloj simulado.
// Una pulsación larga se cancela si el dedo se mueve más de `tolerance` px (es un scroll) o si se suelta/cancela antes.
// Tras dispararse, `consumeClick()` dice si el "click" que sigue al soltar debe ignorarse (una sola vez).

/**
 * @param {{ delay?: number, tolerance?: number, onLong: () => void,
 *           setTimer?: (fn: () => void, ms: number) => any, clearTimer?: (id: any) => void }} opts
 */
export function createLongPress({ delay = 550, tolerance = 10, onLong, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let timer = null;
  let startX = 0;
  let startY = 0;
  let fired = false;

  function cancel() {
    if (timer !== null) clearTimer(timer);
    timer = null;
  }

  return {
    /** Al tocar: arranca la cuenta. Un toque nuevo reinicia también la marca de "ya se disparó". */
    down(x, y) {
      cancel();
      fired = false;
      startX = x;
      startY = y;
      timer = setTimer(() => {
        timer = null;
        fired = true;
        onLong();
      }, delay);
    },
    /** Al mover el dedo: si se aleja de donde empezó, es un scroll y no una pulsación larga. */
    move(x, y) {
      if (timer !== null && Math.hypot(x - startX, y - startY) > tolerance) cancel();
    },
    /** Al soltar, cancelar el gesto o salir del elemento. */
    up() {
      cancel();
    },
    /** ¿El click que llega ahora es el de una pulsación larga ya atendida? (devuelve true una sola vez) */
    consumeClick() {
      const was = fired;
      fired = false;
      return was;
    },
  };
}
