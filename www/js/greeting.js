// www/js/greeting.js
// UI-018: saludo del hub según la hora del día. Módulo puro: solo la hora del dispositivo, sin red ni datos personales.
// Frases genéricas (sin nombre de usuario ni de personaje), de tono cálido y sin marcar género salvo la que pidió el usuario.

/** Franjas (hora local 0-23): madrugada 0-5, mañana 6-11, tarde 12-19, noche 20-23. */
export function dayPart(hour) {
  const h = ((Math.floor(Number(hour)) % 24) + 24) % 24; // 24 → 0; valores raros no rompen
  if (h < 6) return 'madrugada';
  if (h < 12) return 'manana';
  if (h < 20) return 'tarde';
  return 'noche';
}

export const GREETINGS = Object.freeze({
  madrugada: Object.freeze([
    '¿Desvelándote?',
    '¿No puedes dormir?',
    'Qué madrugada tan tranquila',
    'Todo está en calma a esta hora',
    'Aún es de madrugada, aquí estoy',
  ]),
  manana: Object.freeze([
    'Buenos días',
    'Buen día, ¿cómo amaneciste?',
    'Que empiece bien el día',
    'Qué bueno verte por la mañana',
    'Un nuevo día, y aquí estamos',
  ]),
  tarde: Object.freeze([
    'Buenas tardes',
    'Bienvenido de vuelta',
    '¿Cómo va tu tarde?',
    'Qué bueno que pasaste por aquí',
    'Un rato para ti a media tarde',
  ]),
  noche: Object.freeze([
    'Buenas noches',
    'Qué bueno verte esta noche',
    '¿Cómo estuvo tu día?',
    'Ponte a gusto, la noche es tranquila',
    'La noche es buena para conversar',
  ]),
});

/**
 * Elige una frase al azar de la franja, sin repetir la `last` (la de la vez anterior) si hay otra opción.
 * @param {number} hour hora local 0-23
 * @param {string} [last] frase de la vez anterior
 * @param {() => number} [rand] inyectable para las pruebas (por defecto `Math.random`)
 */
export function pickGreeting(hour, last = '', rand = Math.random) {
  const all = GREETINGS[dayPart(hour)];
  const options = all.length > 1 ? all.filter((g) => g !== last) : all;
  const i = Math.min(options.length - 1, Math.max(0, Math.floor(rand() * options.length)));
  return options[i];
}
