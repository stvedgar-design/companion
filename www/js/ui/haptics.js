/**
 * @fileoverview Motor ergonómico de feedback háptico para Companion (Fase 11 / PARETO-005).
 * Proporciona micro-vibraciones hápticas utilizando la API Web Vibration (navigator.vibrate),
 * emulando los patrones de interacción de aplicaciones de mensajería (Telegram, WhatsApp)
 * y AI companions modernos.
 *
 * Cero dependencias externas. Falla de forma silenciosa e instantánea en navegadores o
 * dispositivos sin soporte de vibración o con permisos denegados.
 */

let enabled = true;

/**
 * Actualiza el estado activo de la respuesta háptica según los ajustes del usuario.
 * @param {boolean} isEnabled
 */
export function setHapticsEnabled(isEnabled) {
  enabled = isEnabled !== false;
}

/**
 * Ejecuta un patrón de vibración si está habilitado y soportado por el dispositivo.
 * @param {number|number[]} pattern
 */
function vibrate(pattern) {
  if (!enabled) return;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
      navigator.vibrate(pattern);
    }
  } catch {
    // Ignorado intencionalmente (p. ej. iframe sin permisos o políticas de seguridad del navegador)
  }
}

export const haptics = {
  /**
   * Micro-pulsación ultracorta (8–10 ms) para toques de navegación, pestañas inferiores,
   * chips de selección o botones generales.
   */
  tap() {
    vibrate(9);
  },

  /**
   * Confirmación táctil de envío de mensaje (14 ms).
   * Confirma inmediatamente que el mensaje del usuario fue enviado.
   */
  send() {
    vibrate(14);
  },

  /**
   * Pulso doble suave [10 ms vibración, 45 ms pausa, 12 ms vibración] al completarse
   * la respuesta del companion. Alerta de forma sutil que Nora ha terminado de responder.
   */
  receive() {
    vibrate([10, 45, 12]);
  },

  /**
   * Pulsación firme (22 ms) para acciones destacadas: guardar configuración, archivar chat,
   * restaurar episodio o aplicar curación de memoria.
   */
  action() {
    vibrate(22);
  },
};
