// www/js/perf.js
// UI-001: piezas puras (sin DOM ni almacenamiento) para el rendimiento del chat: la cadencia con que se repinta la burbuja
// mientras llega una respuesta, el resumen de una medición de fluidez y el saneado de los tiempos por respuesta.
// El reloj y los temporizadores se inyectan para poder probarlas con un reloj simulado.

/** Cada cuántos ms se repinta la burbuja en streaming (y se hace el scroll al fondo). Ver docs/HISTORIAL.md, "UI-001". */
export const STREAM_PAINT_MS = 90;
/** Un cuadro más lento que esto (ms) cuenta como "tirón". ~2 cuadros perdidos a 60 Hz. */
export const SLOW_FRAME_MS = 32;

const defaultClock = () => ({
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (id) => clearTimeout(id),
});

/**
 * Limita `fn` a una ejecución cada `intervalMs`, con garantía de "cola final": una llamada a `schedule()` siempre acaba
 * ejecutando `fn` (a lo sumo `intervalMs` después de la última vez), así el último fragmento nunca queda sin pintar.
 *  - `schedule()`: pide una ejecución. Si ya pasó el intervalo se ejecuta en el acto; si no, se agenda para cuando toque
 *    (varias llamadas seguidas comparten UNA ejecución).
 *  - `flush()`: si hay una ejecución pendiente, la hace ya. Devuelve true si ejecutó.
 *  - `cancel()`: descarta la pendiente sin ejecutarla.
 * @param {() => void} fn
 * @param {number} intervalMs
 * @param {{ now: () => number, setTimer: (fn: () => void, ms: number) => unknown, clearTimer: (id: unknown) => void }} [clock]
 */
export function createThrottle(fn, intervalMs, clock = defaultClock()) {
  let last = -Infinity;
  let timer = null;
  let pending = false;
  const run = () => {
    if (timer !== null) clock.clearTimer(timer);
    timer = null;
    pending = false;
    last = clock.now();
    fn();
  };
  return {
    schedule() {
      if (pending) return;
      pending = true;
      const wait = intervalMs - (clock.now() - last);
      if (wait <= 0) run();
      else timer = clock.setTimer(run, wait);
    },
    flush() {
      if (!pending) return false;
      run();
      return true;
    },
    cancel() {
      if (timer !== null) clock.clearTimer(timer);
      timer = null;
      pending = false;
    },
    isPending: () => pending,
  };
}

/**
 * Resume las duraciones de cuadro (ms entre un cuadro y el siguiente) de una medición de fluidez.
 * @param {number[]} deltas
 * @param {number} [slowMs] umbral de "tirón"
 * @returns {{ frames: number, meanMs: number, p95Ms: number, maxMs: number, slowFrames: number, slowPercent: number }}
 */
export function summarizeFrames(deltas, slowMs = SLOW_FRAME_MS) {
  const d = (Array.isArray(deltas) ? deltas : []).filter((x) => Number.isFinite(x) && x >= 0);
  if (!d.length) return { frames: 0, meanMs: 0, p95Ms: 0, maxMs: 0, slowFrames: 0, slowPercent: 0 };
  const sorted = [...d].sort((a, b) => a - b);
  const slowFrames = d.filter((x) => x > slowMs).length;
  const round1 = (x) => Math.round(x * 10) / 10;
  return {
    frames: d.length,
    meanMs: round1(d.reduce((a, b) => a + b, 0) / d.length),
    p95Ms: round1(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    maxMs: round1(sorted[sorted.length - 1]),
    slowFrames,
    slowPercent: round1((slowFrames / d.length) * 100),
  };
}

/**
 * Texto en lenguaje llano del resultado de la "Prueba de fluidez". No lleva datos personales: solo números, el skin y el modo.
 * @param {ReturnType<typeof summarizeFrames>} s
 * @param {{ theme?: string, mode?: string, source?: 'chat'|'synthetic', rows?: number, seconds?: number }} ctx
 */
export function formatFluencyReport(s, ctx = {}) {
  const where = ctx.source === 'chat' ? `tu chat abierto (${ctx.rows || 0} mensajes)` : `un chat de prueba de ${ctx.rows || 0} mensajes`;
  const lines = [`Prueba de fluidez: ${where}, ${ctx.seconds || 0} s de desplazamiento automático.`];
  const n = (x) => String(x).replace('.', ','); // coma decimal
  if (!s.frames) {
    lines.push('No se pudo medir: la pantalla no dibujó cuadros durante la prueba (¿la app estaba en segundo plano?).');
  } else {
    const perSecond = s.meanMs > 0 ? Math.round(1000 / s.meanMs) : 0;
    lines.push(`Tiempo medio por cuadro: ${n(s.meanMs)} ms (unos ${perSecond} cuadros por segundo). El 95 % de los cuadros tardó ${n(s.p95Ms)} ms o menos; el peor, ${n(s.maxMs)} ms.`);
    lines.push(`Cuadros lentos (más de ${SLOW_FRAME_MS} ms): ${s.slowFrames} de ${s.frames} (${n(s.slowPercent)} %).`);
  }
  lines.push(`Skin: ${ctx.theme || '?'} · modo: ${ctx.mode || '?'}`);
  return lines.join('\n');
}

/**
 * Valida el campo opcional `meta` de un mensaje del personaje: `{ ttftMs, totalMs, chars }` (tiempo hasta el primer
 * fragmento, tiempo total y caracteres de la respuesta). Devuelve el objeto saneado (números enteros no negativos) o
 * `undefined` = "sin dato" (mejor sin dato que un dato falso). Nunca lanza.
 * @param {unknown} raw
 * @returns {{ ttftMs: number, totalMs: number, chars: number } | undefined}
 */
export function sanitizeMeta(raw) {
  if (!raw || typeof raw !== 'object') return undefined;
  const int = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.round(v) : null);
  const ttftMs = int(raw.ttftMs);
  const totalMs = int(raw.totalMs);
  const chars = int(raw.chars);
  if (ttftMs === null || totalMs === null || chars === null) return undefined;
  return { ttftMs, totalMs, chars };
}

/** "Última respuesta: 6,4 s" (coma decimal, una cifra) a partir de `meta.totalMs`; `''` si no hay dato. */
export function lastReplyText(meta) {
  const m = sanitizeMeta(meta);
  if (!m) return '';
  return `Última respuesta: ${(m.totalMs / 1000).toFixed(1).replace('.', ',')} s`;
}

/**
 * Altura estimada (px) de una fila de mensaje, para `contain-intrinsic-size` (chat.css): mientras una fila está fuera de
 * pantalla el navegador no la mide y usa este valor; cuando se ve por primera vez recuerda su altura real. Cuanto mejor la
 * estimación, menos se mueve la barra de scroll. Es una aproximación: burbuja = relleno vertical + líneas × alto de línea
 * (17 px × 1,5), con ~8 % de margen por el corte de palabras; más la línea inferior (memoria/versiones) si la hay.
 * @param {string} text
 * @param {number} charsPerLine caracteres que caben en una línea de la burbuja (según el ancho de la pantalla)
 * @param {boolean} [hasMeta]
 */
export function estimateRowHeight(text, charsPerLine, hasMeta = false) {
  const len = typeof text === 'string' ? text.replace(/\*/g, '').length : 0;
  const perLine = Number.isFinite(charsPerLine) && charsPerLine >= 8 ? charsPerLine : 30;
  const lines = Math.max(1, Math.ceil((len * 1.08) / perLine));
  return Math.round(24 + lines * 25.5 + (hasMeta ? 34 : 0));
}

/** Caracteres por línea de una burbuja para un ancho de lista dado (px): 88 % del ancho útil menos el relleno, a ~8,4 px por carácter. */
export function charsPerBubbleLine(listWidthPx) {
  const w = Number.isFinite(listWidthPx) && listWidthPx > 0 ? listWidthPx : 375;
  return Math.max(8, Math.floor((0.88 * (w - 32) - 32) / 8.4));
}

/** Velocidad del desplazamiento automático de la "Prueba de fluidez" (px/s): un fling rápido pero realista con el dedo. */
export const FLUENCY_SPEED_PX_S = 2500;

/**
 * Un paso del desplazamiento automático: avanza `dtMs` a `speedPxS` en la dirección `dir` (+1 baja, −1 sube) y rebota en
 * los extremos (0 y `max`), de modo que recorre la lista de arriba abajo y de vuelta sin parar. Pura.
 * @returns {{ pos: number, dir: 1|-1 }}
 */
export function stepScroll({ pos, dir, dtMs, max, speedPxS = FLUENCY_SPEED_PX_S }) {
  const limit = Math.max(0, Number.isFinite(max) ? max : 0);
  let d = dir === -1 ? -1 : 1;
  let p = (Number.isFinite(pos) ? pos : 0) + d * speedPxS * (Math.max(0, dtMs) / 1000);
  if (p >= limit) {
    p = limit;
    d = -1;
  } else if (p <= 0) {
    p = 0;
    d = 1;
  }
  return { pos: p, dir: d };
}
