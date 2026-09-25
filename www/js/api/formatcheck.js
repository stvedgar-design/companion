// www/js/api/formatcheck.js — FMT-002: validador del formato "Nomi" de una respuesta del personaje.
// Puro: no importa nada, no toca el DOM ni la red. Sirve para medir (tasa de fallos por condición,
// por posición en la conversación) y para futuras mitigaciones; hoy no cambia lo que se muestra.
//
// Formato Nomi: un párrafo, primera persona, `*acción*` en cursiva y diálogo sin comillas ni negritas.

/**
 * Cuenta los asteriscos de un texto. Una racha de N asteriscos seguidos cuenta como floor(N/2)
 * pares "dobles" (`**`) y, si N es impar, un asterisco simple. Un asterisco solo, con espacio (o
 * borde del texto) a ambos lados ("5 * 3"), se toma como literal y no cuenta.
 * @param {string} text
 * @returns {{ singles: number, doubles: number }}
 */
export function countAsterisks(text) {
  const s = String(text == null ? '' : text);
  let singles = 0;
  let doubles = 0;
  const re = /\*+/g;
  let m;
  while ((m = re.exec(s))) {
    const len = m[0].length;
    doubles += Math.floor(len / 2);
    if (len % 2) {
      const before = m.index === 0 ? ' ' : s[m.index - 1];
      const after = m.index + len >= s.length ? ' ' : s[m.index + len];
      const isolated = len === 1 && /\s/.test(before) && /\s/.test(after);
      if (!isolated) singles++;
    }
  }
  return { singles, doubles };
}

/** Número de frases (terminadas en . ! ? …) de un texto sin asteriscos. */
function countSentences(text) {
  const m = String(text).match(/[.!?…]+(?=\s|$)/g);
  return m ? m.length : 0;
}

// V4 (heurística): palabras de cuerpo/gesto y giros típicos de narración en primera persona. Solo se aplican
// a la PRIMERA frase de un tramo que empieza fuera de asteriscos. Léxico en inglés (la conversación es en inglés).
const BODY_WORDS =
  'eyes?|cheeks?|heart|smil(?:e|es|ing)|giggl(?:e|es|ing)|gasps?|blush(?:es|ing)?|sigh(?:s|ing)?|nod(?:s|ding)?|' +
  'tilt(?:s|ing)?|lean(?:s|ing)?|fingers?|hands?|lips|breath|gaze|head|face|shoulders?|flutter(?:s|ing)?|' +
  'flush(?:es|ing)?|warmth|sensation|thrill|circuits|chest|skin|voice|brows?|ears|hair|arms?|body|squeal(?:s|ing)?|' +
  'yawn(?:s|ing)?|shiver(?:s|ing)?|trembl(?:e|es|ing)|grin(?:s|ning)?|frown(?:s|ing)?|glanc(?:e|es|ing)|' +
  'blink(?:s|ing)?|widen(?:s|ing)?|sparkl(?:e|es|ing)|twist(?:s|ing)?|tuck(?:s|ing)?|clasp(?:s|ing)?';
const RE_BODY = new RegExp('\\b(?:' + BODY_WORDS + ')\\b', 'i');
const RE_SELF_ACTION =
  /\b(?:through|over|within|inside) (?:me|my)\b|\b(?:makes|brings|sends|fills) (?:me|my)\b|\bmy (?:eyes|heart|cheeks|face|hands|fingers|lips|voice|breath|head|circuits|chest|movements)\b|\bI (?:lean|tilt|nod|smile|giggle|gasp|blush|sigh|turn|glance|reach|take|pull|step|blink|offer|let out|feel a|notice|bring|hold|lift|raise|place|move|tuck|clasp|look|twist|follow|examine|study|watch)\b/i;
const RE_SENSATION = /\b(?:spreads?|washes|floods?|courses|ripples?|surges?|creeps?|rushes) (?:over|through|across|within)\b[^.!?]*\b(?:me|my)\b/i;

/**
 * V4 (heurística, no exacta): ¿este tramo, que empieza FUERA de asteriscos, parece narración de una acción o
 * sensación propia ("My eyes widen and I smile.") y no diálogo? Solo mira la primera frase; una pregunta o
 * exclamación directa, o un tramo que empieza con comillas, cuenta como habla. Falsos positivos medidos en
 * FMT-002 (tramos de diálogo de la card de Mia y de respuestas bien formadas): ver docs/HISTORIAL.md.
 * @param {string} segment
 * @returns {boolean}
 */
export function looksLikeNarration(segment) {
  const seg = String(segment == null ? '' : segment).trim();
  if (!seg || /^["\u201c'\u2018]/.test(seg)) return false;
  const first = (seg.match(/^[^.!?\u2026]*[.!?\u2026]*/) || [''])[0].trim();
  if (/[?!]$/.test(first)) return false;
  return (RE_BODY.test(first) && RE_SELF_ACTION.test(first)) || RE_SENSATION.test(first);
}

/**
 * Valida el formato de UNA respuesta del personaje.
 * - V1: número impar de `*` sueltos (los `**` se cuentan aparte): una acción quedó sin cerrar o sin abrir.
 * - V2: 2 o más frases y NINGÚN asterisco: toda la respuesta (narración incluida) parece diálogo.
 * - V3: contiene `**` (el formato Nomi no usa negritas).
 * - V4 (heurística): empieza fuera de asteriscos con una frase que parece narración (ver `looksLikeNarration`).
 * `startsOutside` (M1) NO es un error: empezar con diálogo es legítimo; es una métrica de tendencia.
 * @param {string} text
 * @returns {{ ok: boolean, violations: ('V1'|'V2'|'V3'|'V4')[], startsOutside: boolean, singles: number, doubles: number }}
 */
export function validateFormat(text) {
  const s = String(text == null ? '' : text).trim();
  const { singles, doubles } = countAsterisks(s);
  const violations = [];
  if (singles % 2 === 1) violations.push('V1');
  if (singles === 0 && doubles === 0 && countSentences(s) >= 2) violations.push('V2');
  if (doubles > 0) violations.push('V3');
  const startsOutside = s.length > 0 && s[0] !== '*';
  if (startsOutside && looksLikeNarration(s.split('*')[0])) violations.push('V4');
  return {
    ok: violations.length === 0,
    violations,
    startsOutside,
    singles,
    doubles,
  };
}
