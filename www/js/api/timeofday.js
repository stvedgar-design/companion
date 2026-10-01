// www/js/api/timeofday.js — TIME-001: referencia temporal gruesa para el prompt.
// Puro: recibe una fecha y devuelve una frase corta en inglés (el idioma del prompt, ver principio 4 de
// docs/NOTES.md). Usa la hora LOCAL del dispositivo (getHours/getDay), nunca UTC. Nunca incluye la hora ni los
// minutos en formato de reloj: solo franja del día y día de la semana.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Franja del día según la hora local: madrugada 0-4, mañana 5-11, tarde 12-18, noche 19-23.
 * @param {number} hour 0-23
 * @returns {'small-hours'|'morning'|'afternoon'|'night'}
 */
export function dayPart(hour) {
  if (hour < 5) return 'small-hours';
  if (hour < 12) return 'morning';
  if (hour < 19) return 'afternoon';
  return 'night';
}

/**
 * Frase para el final del prompt, p. ej. "It is a Tuesday morning." En madrugada no lleva día (a las 2 a. m.
 * "martes" es ambiguo para quien aún no se acostó): "It is the middle of the night, very late."
 * @param {Date} [date]
 * @returns {string} '' si la fecha no es válida.
 */
export function timeOfDayNote(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const part = dayPart(date.getHours());
  if (part === 'small-hours') return 'It is the middle of the night, very late.';
  const day = WEEKDAYS[date.getDay()];
  return part === 'night' ? `It is ${day} night.` : `It is a ${day} ${part}.`;
}
