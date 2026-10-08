// www/js/api/timeofday.js — TIME-001 / FASE 15: referencia temporal objetiva y real para el prompt.
// Puro: recibe una fecha y devuelve una frase estructurada en inglés (el idioma del prompt, ver principio 4 de
// docs/NOTES.md). Usa la hora LOCAL del dispositivo (getHours/getDay/getMonth/getDate), nunca UTC.
// Entrega día de la semana, fecha de calendario, hora con minutos y franja del día.

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
 * Frase para el final del prompt con fecha, hora local y franja:
 * ej. "Current local context: Wednesday, October 7, 2026, 3:45 PM (afternoon)."
 * @param {Date} [date]
 * @returns {string} '' si la fecha no es válida.
 */
export function timeOfDayNote(date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  const part = dayPart(date.getHours());
  const day = WEEKDAYS[date.getDay()];
  const month = MONTHS[date.getMonth()];
  const dayNum = date.getDate();
  const year = date.getFullYear();

  let h = date.getHours();
  const m = String(date.getMinutes()).padStart(2, '0');
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  const timeStr = `${h}:${m} ${ampm}`;
  const partDesc = part === 'small-hours' ? 'late night' : part;

  return `Current local context: ${day}, ${month} ${dayNum}, ${year}, ${timeStr} (${partDesc}).`;
}
