// www/js/ui/format.js
// Utilidades puras de formateo de texto para la pantalla de chat.
// Sin DOM, sin dependencias externas.

const ESCAPE_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Escapa caracteres especiales de HTML. Es la única función que debe usarse
 * antes de insertar texto de usuario, modelo o card como HTML.
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ESCAPE_MAP[c]);
}

const isWs = (c) => c === undefined || /\s/.test(c);

/**
 * FMT-003: normalización SOLO VISUAL de los asteriscos de una respuesta del PERSONAJE (el texto guardado
 * y el que se envía al modelo no se tocan). Función pura, lineal (sin regex con retroceso).
 * - N1: `**` (y rachas mayores) valen como `*`: el formato Nomi no usa negritas.
 * - N2: repara el emparejamiento roto por el modelo, de forma conservadora:
 *   · dentro de una cursiva abierta, un `*` que parece APERTURA (precedido por fin de frase + espacio y seguido de
 *     una letra) cierra antes la anterior: `*A. *B.* C.` -> `*A.* *B.* C.`;
 *   · un `*` de cierre sin apertura, y un `*` suelto al principio o al final, se ocultan (no se ven como símbolo).
 *   Solo se aplica si el número de asteriscos es impar o si hubo una apertura dentro de otra; si no, el texto
 *   queda tal cual (el emparejamiento de siempre ya lo resuelve).
 * - Un `*` aislado entre espacios ("5 * 3") sigue siendo literal.
 * - Una cursiva abierta al final del texto se deja abierta (streaming: se muestra en cursiva hasta el final).
 * @param {string} text
 * @returns {string}
 */
export function normalizeCharAsterisks(text) {
  let s = String(text == null ? '' : text);
  if (s.indexOf('*') < 0) return s;
  s = s.replace(/\*{2,}/g, '*');

  const n = s.length;
  const inserts = []; // posiciones donde se inserta un `*` de cierre
  const removes = new Set(); // posiciones de `*` que se ocultan
  let singles = 0;
  let open = false;
  let reopens = 0;
  for (let i = 0; i < n; i++) {
    if (s[i] !== '*') continue;
    const prevWs = isWs(s[i - 1]);
    const nextWs = isWs(s[i + 1]);
    if (prevWs && nextWs) {
      // Aislado entre espacios: literal, salvo al principio o al final del texto (apertura sin contenido).
      const edge = i === 0 || i === n - 1 || !s.slice(0, i).trim() || !s.slice(i + 1).trim();
      if (edge) removes.add(i);
      continue;
    }
    singles++;
    if (!open) {
      if (nextWs && !prevWs) removes.add(i); // cierre sin apertura
      else open = true;
      continue;
    }
    // Hay una cursiva abierta. ¿Este `*` es más bien una apertura nueva?
    let j = i - 1;
    while (j >= 0 && /\s/.test(s[j])) j--;
    if (prevWs && j >= 0 && /[.!?\u2026]/.test(s[j]) && /\p{L}/u.test(s[i + 1] || '')) {
      inserts.push(j + 1);
      reopens++;
    } else {
      open = false;
    }
  }
  if (singles % 2 === 0 && reopens === 0 && !removes.size) return s;
  if (singles % 2 === 0 && reopens === 0) {
    // Par y sin aperturas dobles: solo se aplican los `*` de los bordes (los de cierre sin apertura se dejan
    // al emparejamiento normal para no cambiar textos que ya se veían bien).
    for (const r of [...removes]) if (!(isWs(s[r - 1]) && isWs(s[r + 1]))) removes.delete(r);
    if (!removes.size) return s;
  }
  let out = '';
  let last = 0;
  const edits = [
    ...inserts.map((p) => [p, 0]),
    ...[...removes].map((p) => [p, 1]),
  ].sort((a, b) => a[0] - b[0]);
  for (const [p, kind] of edits) {
    out += s.slice(last, p);
    if (kind === 0) {
      out += '*';
      last = p;
    } else {
      last = p + 1;
    }
  }
  return out + s.slice(last);
}

/**
 * Convierte texto crudo de un mensaje en HTML seguro para mostrar en una burbuja.
 * - Escapa primero (nunca interpreta HTML del texto original).
 * - `**negrita**` -> <strong>, `*acción*` -> <em>, saltos de línea -> <br>.
 * - Si el texto termina con un asterisco sin su cierre (streaming en curso),
 *   ese tramo final se formatea igualmente como cursiva.
 * - Un asterisco aislado que no forma parte de un par ni de un cierre en curso
 *   (p. ej. "5 * 3") se deja tal cual, sin romper el resto del texto.
 * - FMT-003: con `{ role: 'char' }` se normalizan antes los asteriscos mal emparejados del modelo
 *   (ver `normalizeCharAsterisks`); no hay negritas en los turnos del personaje. Con `role: 'user'` o
 *   sin rol, nada cambia.
 * No interpreta guiones bajos, backticks ni ningún otro markdown.
 * @param {string} text
 * @param {{ role?: 'user'|'char' }} [opts]
 * @returns {string}
 */
export function formatMessage(text, opts) {
  let s = escapeHtml(opts && opts.role === 'char' ? normalizeCharAsterisks(text) : text);

  // Negrita: pares **...** sin asteriscos dentro.
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

  // Cursiva: pares *...* sin asteriscos dentro (ya consumidos los de negrita).
  s = s.replace(/\*([^*]+)\*/g, '<em>$1</em>');

  // Asterisco sin cerrar al final del texto (streaming): solo si arranca
  // pegado a una palabra (sin espacio inmediatamente después), para no
  // capturar asteriscos aislados como en "5 * 3".
  s = s.replace(/\*(\S[^*]*)$/, '<em>$1</em>');

  return s.replace(/\n/g, '<br>');
}
