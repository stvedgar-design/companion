// www/js/msgtime.js
// MEM-011: texto del timestamp bajo cada mensaje. Puro (recibe `now` y usa la zona horaria local): la hora ("14:05") si el mensaje es de HOY, y la
// fecha ("24 sep", con el año si es de otro año) si es de un día anterior. Los meses van a mano para que el resultado no dependa del navegador.

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const pad2 = (n) => String(n).padStart(2, '0');

/**
 * @param {number} ts   marca de tiempo del mensaje (ms). Si no es un número válido devuelve ''.
 * @param {number} [nowTs]
 * @returns {string}
 */
export function formatMessageTime(ts, nowTs = Date.now()) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  const now = new Date(Number.isFinite(nowTs) ? nowTs : Date.now());
  const sameDay = d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate();
  if (sameDay) return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  const date = `${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return d.getFullYear() === now.getFullYear() ? date : `${date} ${d.getFullYear()}`;
}

/** Fecha y hora completas, para el atributo `title` (al mantener el dedo/cursor encima). */
export function formatMessageFullTime(ts) {
  if (!Number.isFinite(ts) || ts <= 0) return '';
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
