// www/js/api/followups.js — HUM-004: notas y saludos que responden al CONTEXTO, baratos y SIN modelo. Dos cosas:
//
//  1. PENDIENTES («mañana tengo la entrevista», «this weekend we're hiking», «el examen es el viernes»): al enviar un mensaje con una marca de futuro y un plan o
//     un evento, se guarda un pendiente corto en el personaje (con fecha en que "toca", estado y caducidad). Cuando el usuario VUELVE y el pendiente ya venció,
//     la nota de presencia del chat le dice al personaje que puede preguntar cómo le fue (UNA vez: pasa a «preguntado» y no se repite; regenerar da la misma lectura).
//     Detectado con expresiones regulares; la escritura solo ocurre si se detectó algo.
//
//  2. FECHAS: el cumpleaños que el usuario dijo explícitamente («mi cumpleaños es el 12 de mayo», «my birthday is May 12»; patrones pequeños y seguros) y el
//     aniversario del primer chat (a partir de `Character.created`). Solo estas fechas generan una NOTA del buzón (PROACT-001).
//
// REGLA DE PROACT-001 (la nota se escribe SOLO desde la identidad y los recuerdos, nunca desde un episodio): un pendiente es una frase sacada de UN episodio
// («la entrevista de mañana»), así que NO se usa para notas del buzón — solo en el chat, donde ya hay una conversación en curso. Las notas por fecha reciben
// únicamente el MOTIVO («es su cumpleaños», «hace un año que se conocieron»), ninguna frase del usuario: una fecha como el cumpleaños es un dato estable,
// el mismo tipo de cosa que ya vive en los recuerdos generales. Ver docs/HISTORIAL.md, "HUM-004".

import { norm } from './emotion.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/** Máximo de pendientes guardados por personaje. */
export const FOLLOWUPS_MAX = 5;
/** Un pendiente deja de valer este tiempo después de su fecha (caduca sin preguntarse). */
export const FOLLOWUP_EXPIRES_AFTER_MS = 3 * DAY;
/** Largo máximo de la frase del usuario que se guarda. */
export const FOLLOWUP_TEXT_MAX = 90;
/** Un plan de «hoy más tarde / esta noche» toca preguntarlo después de este lapso. */
export const SAME_DAY_DUE_MS = 5 * HOUR;
/** Hora local a la que «toca» un pendiente de un día concreto (ya pasó casi seguro el evento). */
export const DUE_HOUR = 20;
/** Cuántas notas por fecha recuerda el buzón (para no repetir en el mismo año). */
export const DATE_NOTES_MAX = 8;

const STATUSES = ['pending', 'asked', 'done', 'expired'];

function posNum(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function collapse(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

/* ---------- datos ---------- */

export function defaultFollowUps() {
  return { items: [], dates: [] };
}

function sanitizeItem(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = collapse(raw.text).slice(0, FOLLOWUP_TEXT_MAX + 1);
  const dueAt = posNum(raw.dueAt);
  if (!text || !dueAt) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'f' + dueAt.toString(36),
    text,
    key: collapse(raw.key).slice(0, 30),
    createdAt: posNum(raw.createdAt),
    dueAt,
    expiresAt: posNum(raw.expiresAt) || dueAt + FOLLOWUP_EXPIRES_AFTER_MS,
    status: STATUSES.includes(raw.status) ? raw.status : 'pending',
    askedFor: posNum(raw.askedFor),
  };
}

function sanitizeDate(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'birthday') return null;
  const month = Math.floor(Number(raw.month));
  const day = Math.floor(Number(raw.day));
  if (!validMonthDay(month, day)) return null;
  return { id: typeof raw.id === 'string' && raw.id ? raw.id : 'd-birthday', kind: 'birthday', month, day, createdAt: posNum(raw.createdAt) };
}

/**
 * Valida `Character.followUps` (guardado o de una copia de seguridad). Sin forma válida = nada pendiente y ninguna fecha: un personaje anterior a HUM-004
 * carga así y se comporta igual que siempre. Pura.
 * @param {unknown} raw
 * @returns {{ items: object[], dates: object[] }}
 */
export function sanitizeFollowUps(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const items = (Array.isArray(src.items) ? src.items : []).map(sanitizeItem).filter(Boolean).slice(-FOLLOWUPS_MAX);
  const birthdays = (Array.isArray(src.dates) ? src.dates : []).map(sanitizeDate).filter(Boolean);
  return { items, dates: birthdays.slice(-1) }; // un solo cumpleaños: el último que dijo
}

/* ---------- fechas del calendario ---------- */

const MONTHS = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const DAYS_IN_MONTH = [0, 31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function validMonthDay(month, day) {
  return Number.isInteger(month) && Number.isInteger(day) && month >= 1 && month <= 12 && day >= 1 && day <= DAYS_IN_MONTH[month];
}

const MONTH_NAMES = Object.keys(MONTHS).join('|');
// «mi cumpleaños es el 12 de mayo», «cumplo años el 12 de mayo», «mi cumple es el 12 de mayo»
const BIRTHDAY_ES = new RegExp(`\\b(?:mi cumpleanos|mi cumple|cumplo anos)\\b[^.!?\\n]{0,15}?\\b(?:el |en |:)?\\s*(\\d{1,2})(?:\\s*(?:de|del))?\\s+(${MONTH_NAMES})\\b`);
// «my birthday is May 12», «my birthday is on 12 May», «my birthday is the 12th of May»
const BIRTHDAY_EN_A = new RegExp(`\\bmy birthday\\b[^.!?\\n]{0,15}?\\b(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`);
const BIRTHDAY_EN_B = new RegExp(`\\bmy birthday\\b[^.!?\\n]{0,15}?\\b(?:the )?(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+of)?\\s+(${MONTH_NAMES})\\b`);

/**
 * El cumpleaños que el usuario dice EXPLÍCITAMENTE en un mensaje (primera persona, mes con nombre; los formatos numéricos 12/05 se ignoran porque son
 * ambiguos entre día/mes). Pura.
 * @param {string} text
 * @returns {{ kind: 'birthday', month: number, day: number }[]}
 */
export function detectUserDates(text) {
  const t = norm(text);
  let m = t.match(BIRTHDAY_ES);
  let day;
  let month;
  if (m) {
    day = Number(m[1]);
    month = MONTHS[m[2]];
  } else if ((m = t.match(BIRTHDAY_EN_A))) {
    month = MONTHS[m[1]];
    day = Number(m[2]);
  } else if ((m = t.match(BIRTHDAY_EN_B))) {
    day = Number(m[1]);
    month = MONTHS[m[2]];
  }
  return validMonthDay(month, day) ? [{ kind: 'birthday', month, day }] : [];
}

// Si `original` ya tiene la forma válida se devuelve ese MISMO objeto (así quien compara por referencia ve "nada cambió"); si no, el saneado.
function keep(original, cleaned) {
  return original && typeof original === 'object' && Array.isArray(original.items) && Array.isArray(original.dates) ? original : cleaned;
}

/** Guarda (o reemplaza) el cumpleaños. Pura. */
export function withUserDates(followUps, dates, now = Date.now()) {
  const cur = sanitizeFollowUps(followUps);
  const b = (Array.isArray(dates) ? dates : []).find((d) => d && d.kind === 'birthday' && validMonthDay(d.month, d.day));
  if (!b) return keep(followUps, cur);
  const old = cur.dates[0];
  if (old && old.month === b.month && old.day === b.day) return keep(followUps, cur); // lo mismo: no se reescribe nada
  return { ...cur, dates: [{ id: 'd-birthday', kind: 'birthday', month: b.month, day: b.day, createdAt: now }] };
}

/* ---------- pendientes: detección ---------- */

const WEEKDAYS = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6, sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
const WEEKDAY_NAMES = Object.keys(WEEKDAYS).join('|');

// «mañana» también es la parte del día («por la mañana», «esta mañana»): solo cuenta sin esos artículos delante.
const TOMORROW = /(?<!\bla )(?<!\besta )(?<!\bcada )(?<!\buna )(?<!\bde )\bmanana\b|\btomorrow\b/;
const DAY_AFTER = /\bpasado manana\b|\bday after tomorrow\b/;
const SAME_DAY = /\b(esta noche|esta tarde|hoy mas tarde|mas tarde hoy|tonight|this evening|this afternoon|later today|later tonight)\b/;
const WEEKEND = /\b(este fin de semana|este finde|el fin de semana|el finde|this weekend|the weekend|next weekend)\b/;
const NEXT_WEEK = /\b(la semana que viene|la semana proxima|la proxima semana|proxima semana|next week)\b/;
const IN_DAYS = /\b(?:en|in) (\d{1,2}|un|dos|tres|cuatro|cinco|seis|siete|one|two|three|four|five|six|seven) (?:dias?|days?)\b/;
const WEEKDAY = new RegExp(`\\b(?:el|este|on|this|next|el proximo|este proximo)\\s+(${WEEKDAY_NAMES})\\b`);
const NUMBER_WORDS = { un: 1, one: 1, dos: 2, two: 2, tres: 3, three: 3, cuatro: 4, four: 4, cinco: 5, five: 5, seis: 6, six: 6, siete: 7, seven: 7 };

// Debe haber un PLAN (primera persona) o un EVENTO (examen, entrevista…) en la misma frase: «mañana es lunes» o «mañana te cuento» no son pendientes.
const PLAN = new RegExp(
  '\\b(tengo|tenemos|voy|vamos|me toca|nos toca|tendre|tendremos|empiezo|empezamos|salgo|salimos|viajo|viajamos|presento|rindo|me operan|me hacen|tengo que|debo|hay|' +
    'i have|ive got|i got|im going|were going|we have|im gonna|were gonna|ill have|i will|i start|i leave|i need to|i must|there is|theres|' +
    'i am (?:going|starting|leaving|meeting|seeing|taking|having|doing|flying)|im (?:starting|leaving|meeting|seeing|taking|having|doing|flying)|we are (?:going|having|meeting)|were (?:having|meeting|hiking|leaving)|' +
    'my [a-z ]{1,25} (?:is|starts|are)|mi [a-z ]{1,25} (?:es|empieza|son|sale))\\b'
);
const EVENT_NOUN = /\b(examen|examenes|entrevista|cita|reunion|operacion|presentacion|vuelo|viaje|boda|mudanza|consulta|turno|partido|concierto|exam|interview|appointment|meeting|surgery|presentation|flight|trip|wedding|moving|checkup|deadline|concert|recital|audicion|audition|test)\b/;
const GOODBYE = /\b(te cuento|te escribo|te hablo|te llamo|hablamos|nos vemos|te veo|te aviso|te digo|see you|talk tomorrow|talk to you|ill tell you|ill text you|ill write)\b/;
const NEGATED = /\b(no tengo|no voy|no vamos|no hay|nada|nothing|dont have|dont|not going|wont)\b/;
const HYPOTHETICAL = /\b(si|if|ojala|quiza|quizas|tal vez|maybe|perhaps|capaz)\b/;

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function atDueHour(date) {
  const d = startOfDay(date);
  d.setHours(DUE_HOUR, 0, 0, 0);
  return d.getTime();
}

function addDays(date, n) {
  const d = startOfDay(date);
  d.setDate(d.getDate() + n);
  return d;
}

// Próxima ocurrencia (a partir de mañana) del día de la semana `dow` (0 = domingo).
function nextWeekday(now, dow) {
  const today = startOfDay(now);
  let delta = (dow - today.getDay() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(now, delta);
}

/** Cuándo «toca» preguntar por lo que dice la frase `clause` (ya normalizada), o 0 si no tiene una marca de futuro reconocible. */
function dueAtFor(clause, now) {
  const mark = (re) => clause.match(re);
  const hyp = clause.search(HYPOTHETICAL);
  const guard = (re) => {
    const m = mark(re);
    return m && !(hyp >= 0 && hyp < m.index) ? m : null;
  };
  let m;
  if (guard(DAY_AFTER)) return atDueHour(addDays(now, 2));
  if ((m = guard(IN_DAYS))) {
    const n = Number(m[1]) || NUMBER_WORDS[m[1]] || 0;
    return n >= 1 && n <= 14 ? atDueHour(addDays(now, n)) : 0;
  }
  if (guard(TOMORROW)) return atDueHour(addDays(now, 1));
  if (guard(SAME_DAY)) return now.getTime() + SAME_DAY_DUE_MS;
  if (guard(NEXT_WEEK)) {
    const monday = nextWeekday(now, 1);
    return atDueHour(addDays(monday, 4)); // el viernes de la semana que viene
  }
  if ((m = guard(WEEKDAY))) return atDueHour(nextWeekday(now, WEEKDAYS[m[1]]));
  if (guard(WEEKEND)) {
    const dow = now.getDay();
    if (dow === 0) return now.getTime() + SAME_DAY_DUE_MS; // ya es domingo
    return atDueHour(nextWeekday(now, 0)); // el domingo
  }
  return 0;
}

function clipText(text, max = FOLLOWUP_TEXT_MAX) {
  const flat = collapse(String(text || '').replace(/\*/g, '').replace(/["“”]/g, "'"));
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const sp = cut.lastIndexOf(' ');
  return (sp > max * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,.;:!?¿¡-]+$/, '') + '…';
}

/**
 * Pendientes que dice un mensaje del usuario (puede haber más de uno en frases distintas). Pura; `now` y nada de azar.
 * @param {string} text
 * @param {Date} [now]
 * @returns {{ text: string, key: string, dueAt: number, expiresAt: number }[]}
 */
export function detectFollowUps(text, now = new Date()) {
  const out = [];
  for (const raw of String(text || '').split(/[.!?\n;]+/)) {
    const clause = raw.trim();
    if (clause.split(/\s+/).filter(Boolean).length < 3) continue;
    const n = norm(clause);
    if (GOODBYE.test(n) || NEGATED.test(n)) continue;
    const noun = n.match(EVENT_NOUN);
    if (!PLAN.test(n) && !noun) continue;
    const dueAt = dueAtFor(n, now);
    if (!dueAt) continue;
    out.push({ text: clipText(clause), key: noun ? noun[1] : '', dueAt, expiresAt: dueAt + FOLLOWUP_EXPIRES_AFTER_MS });
    if (out.length >= 2) break; // un mensaje no llena la lista
  }
  return out;
}

/**
 * Añade pendientes nuevos: sin repetir el mismo (misma palabra clave en el mismo día, o la misma frase) y con tope `FOLLOWUPS_MAX` (salen primero los ya
 * atendidos/caducados más viejos, luego el pendiente más viejo). Pura; devuelve el MISMO objeto si no cambia nada (para no escribir el personaje de balde).
 */
export function withFollowUps(followUps, candidates, now = Date.now()) {
  const cur = sanitizeFollowUps(followUps);
  let items = cur.items.slice();
  let changed = false;
  for (const c of Array.isArray(candidates) ? candidates : []) {
    if (!c || !c.text || !c.dueAt) continue;
    const dup = items.some((i) => i.status === 'pending' && (i.text === c.text || (c.key && i.key === c.key && Math.abs(i.dueAt - c.dueAt) < 12 * HOUR)));
    if (dup) continue;
    items.push({ id: 'f' + now.toString(36) + Math.random().toString(36).slice(2, 6), text: c.text, key: c.key || '', createdAt: now, dueAt: c.dueAt, expiresAt: c.expiresAt, status: 'pending', askedFor: 0 });
    changed = true;
    while (items.length > FOLLOWUPS_MAX) {
      const idx = items.findIndex((i) => i.status !== 'pending');
      items.splice(idx >= 0 ? idx : 0, 1);
    }
  }
  return changed ? { ...cur, items } : keep(followUps, cur);
}

/* ---------- pendientes: uso en el chat ---------- */

/**
 * ¿Hay un pendiente vencido para preguntar AHORA, cuando el usuario escribe `message`? Solo uno (el que venció primero). `at` = fecha del mensaje del usuario (no el
 * reloj: así «regenerar» lee lo mismo). Un pendiente `asked` solo vuelve a salir para ESE mismo mensaje (la respuesta regenerada); nunca para otro. Si el mensaje
 * ya habla del tema (contiene la palabra clave), no se pregunta y se marca como atendido. Pura.
 * @param {unknown} followUps
 * @param {{ at: number, text?: string }} message
 * @returns {{ item: object, topicCovered: boolean }|null}
 */
export function dueFollowUp(followUps, message) {
  const at = message && Number.isFinite(message.at) ? message.at : 0;
  if (!at) return null;
  const { items } = sanitizeFollowUps(followUps);
  const due = items
    .filter((i) => (i.status === 'pending' && i.dueAt <= at && at <= i.expiresAt) || (i.status === 'asked' && i.askedFor === at))
    .sort((a, b) => a.dueAt - b.dueAt)[0];
  if (!due) return null;
  const topicCovered = due.status === 'pending' && !!due.key && norm(message.text).includes(due.key);
  return { item: due, topicCovered };
}

/** Marca un pendiente como preguntado para el mensaje `askedFor`. Pura; el MISMO objeto si ya estaba así. */
export function markAsked(followUps, id, askedFor) {
  const cur = sanitizeFollowUps(followUps);
  const item = cur.items.find((i) => i.id === id);
  if (!item || (item.status === 'asked' && item.askedFor === askedFor) || item.status === 'done') return keep(followUps, cur);
  return { ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, status: 'asked', askedFor } : i)) };
}

/** Marca un pendiente como atendido (el usuario ya habló del tema). */
export function markDone(followUps, id) {
  const cur = sanitizeFollowUps(followUps);
  const item = cur.items.find((i) => i.id === id);
  if (!item || item.status === 'done') return keep(followUps, cur);
  return { ...cur, items: cur.items.map((i) => (i.id === id ? { ...i, status: 'done' } : i)) };
}

/** La observación para la nota de presencia (inglés, en positivo, solo con nombres). */
export function followUpObservation(item, userName, charName) {
  return `${userName} mentioned: "${item.text}". ${charName} can ask how it went, once, in ${charName}'s own words.`;
}

/* ---------- fechas para el buzón ---------- */

/** Clave de una nota por fecha (una por motivo y año): `birthday:2026`. */
export function dateNoteKey(reason, year) {
  return `${reason}:${year}`;
}

/**
 * ¿Hoy es una fecha especial para este personaje y todavía no se dejó su nota este año? Cumpleaños (el que dijo el usuario) o aniversario del primer chat
 * (`Character.created`, a partir del año siguiente). Pura.
 * @param {{ created?: number, followUps?: unknown, mailbox?: { dateNotes?: string[] } }|null} character
 * @param {Date} [now]
 * @returns {{ reason: 'birthday'|'anniversary', years: number, key: string }|null}
 */
export function dateOccasion(character, now = new Date()) {
  if (!character) return null;
  const done = new Set((character.mailbox && Array.isArray(character.mailbox.dateNotes) ? character.mailbox.dateNotes : []).filter((k) => typeof k === 'string'));
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const year = now.getFullYear();
  const b = sanitizeFollowUps(character.followUps).dates[0];
  if (b && b.month === month && b.day === day && !done.has(dateNoteKey('birthday', year))) {
    return { reason: 'birthday', years: 0, key: dateNoteKey('birthday', year) };
  }
  if (Number.isFinite(character.created) && character.created > 0) {
    const c = new Date(character.created);
    const years = year - c.getFullYear();
    if (years >= 1 && c.getMonth() + 1 === month && c.getDate() === day && !done.has(dateNoteKey('anniversary', year))) {
      return { reason: 'anniversary', years, key: dateNoteKey('anniversary', year) };
    }
  }
  return null;
}

/** Lo que el modelo sabe de la ocasión: SOLO el motivo y los nombres (nunca una frase de ningún episodio). Inglés, en positivo. */
export function occasionText(occasion, charName, userName) {
  if (!occasion) return '';
  if (occasion.reason === 'birthday') return `Today is ${userName}'s birthday.`;
  const span = occasion.years === 1 ? 'one year' : `${occasion.years} years`;
  return `Today is the anniversary of the day ${charName} and ${userName} first met: ${span} together.`;
}
