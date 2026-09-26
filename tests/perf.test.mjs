// tests/perf.test.mjs — UI-001: cadencia de repintado, resumen de fluidez y saneado de `meta` (puro, sin DOM)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createThrottle, summarizeFrames, formatFluencyReport, sanitizeMeta, lastReplyText, estimateRowHeight, charsPerBubbleLine, stepScroll, FLUENCY_SPEED_PX_S, STREAM_PAINT_MS, SLOW_FRAME_MS } from '../www/js/perf.js';

// Reloj simulado: avanza a mano y dispara los temporizadores vencidos.
function fakeClock() {
  let t = 1000;
  let seq = 0;
  const timers = new Map();
  return {
    now: () => t,
    setTimer(fn, ms) { const id = ++seq; timers.set(id, { at: t + ms, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        t = due[1].at;
        due[1].fn();
      }
      t = end;
    },
    pending: () => timers.size,
  };
}

test('UI-001 throttle: la primera llamada se ejecuta en el acto y las siguientes dentro del intervalo comparten UNA ejecución', () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createThrottle(() => runs++, 90, clock);
  th.schedule();
  assert.equal(runs, 1);
  clock.advance(10); th.schedule();
  clock.advance(10); th.schedule();
  clock.advance(10); th.schedule();
  assert.equal(runs, 1, 'dentro del intervalo no se ejecuta otra vez');
  assert.equal(clock.pending(), 1, 'y queda UNA sola agendada');
  clock.advance(60); // se cumplen los 90 ms desde la primera
  assert.equal(runs, 2);
  assert.equal(th.isPending(), false);
});

test('UI-001 throttle: con 60 fragmentos cada 8 ms (480 ms) se repinta ~6 veces, no 60; el último fragmento siempre se pinta', () => {
  const clock = fakeClock();
  let text = '';
  let painted = '';
  let paints = 0;
  const th2 = createThrottle(() => { paints++; painted = text; }, STREAM_PAINT_MS, clock);
  for (let i = 0; i < 60; i++) {
    text += 'w' + i + ' ';
    th2.schedule();
    clock.advance(8);
  }
  assert.ok(paints >= 4 && paints <= 8, `pintó ${paints} veces`);
  assert.notEqual(painted, text, 'antes de vaciar la cola puede faltar el último trozo…');
  th2.flush(); // …y al terminar la respuesta se vacía la cola
  assert.equal(painted, text);
  assert.equal(th2.isPending(), false);
});

test('UI-001 throttle: flush sin pendiente no ejecuta; cancel descarta lo pendiente; después de cancelar se puede volver a usar', () => {
  const clock = fakeClock();
  let runs = 0;
  const th = createThrottle(() => runs++, 100, clock);
  assert.equal(th.flush(), false);
  th.schedule(); // ejecuta
  clock.advance(5);
  th.schedule(); // agenda
  th.cancel();
  clock.advance(500);
  assert.equal(runs, 1);
  assert.equal(clock.pending(), 0);
  th.schedule(); // ya pasó el intervalo: ejecuta
  assert.equal(runs, 2);
});

test('UI-001 summarizeFrames: media, p95, peor cuadro y porcentaje de cuadros lentos (>32 ms)', () => {
  const deltas = [...Array(90).fill(16), ...Array(8).fill(20), 40, 100];
  const s = summarizeFrames(deltas);
  assert.equal(s.frames, 100);
  assert.equal(s.slowFrames, 2);
  assert.equal(s.slowPercent, 2);
  assert.equal(s.maxMs, 100);
  assert.equal(s.meanMs, 17.4);
  assert.equal(SLOW_FRAME_MS, 32);
  assert.equal(summarizeFrames([]).frames, 0);
  assert.equal(summarizeFrames(null).frames, 0);
  assert.equal(summarizeFrames([NaN, -1, 16]).frames, 1); // descarta lo inválido
  assert.equal(summarizeFrames([32, 33]).slowFrames, 1); // el límite (32) no cuenta como lento
});

test('UI-001 formatFluencyReport: lenguaje llano, con skin y modo, sin datos personales; explica cuando no hubo cuadros', () => {
  const ok = formatFluencyReport(summarizeFrames([16, 16, 50]), { theme: 'glass', mode: 'dark', source: 'synthetic', rows: 80, seconds: 5 });
  assert.match(ok, /chat de prueba de 80 mensajes/);
  assert.match(ok, /Cuadros lentos \(más de 32 ms\): 1 de 3 \(33,3 %\)/); // coma decimal
  assert.match(ok, /Skin: glass · modo: dark/);
  const chat = formatFluencyReport(summarizeFrames([16]), { theme: 'nomi', mode: 'light', source: 'chat', rows: 200, seconds: 5 });
  assert.match(chat, /tu chat abierto \(200 mensajes\)/);
  const none = formatFluencyReport(summarizeFrames([]), { theme: 'nomi', mode: 'dark', source: 'synthetic', rows: 80, seconds: 5 });
  assert.match(none, /No se pudo medir/);
});

test('UI-001 sanitizeMeta: acepta solo { ttftMs, totalMs, chars } numéricos no negativos y redondea; lo demás es "sin dato"', () => {
  assert.deepEqual(sanitizeMeta({ ttftMs: 1200.4, totalMs: 6400.6, chars: 180 }), { ttftMs: 1200, totalMs: 6401, chars: 180 });
  assert.deepEqual(sanitizeMeta({ ttftMs: 0, totalMs: 0, chars: 0, extra: 'x' }), { ttftMs: 0, totalMs: 0, chars: 0 });
  for (const bad of [undefined, null, 'x', 3, [], {}, { ttftMs: 1, totalMs: 2 }, { ttftMs: -1, totalMs: 2, chars: 3 }, { ttftMs: NaN, totalMs: 2, chars: 3 }, { ttftMs: '1', totalMs: 2, chars: 3 }, { ttftMs: Infinity, totalMs: 2, chars: 3 }]) {
    assert.equal(sanitizeMeta(bad), undefined, JSON.stringify(bad));
  }
});

test('UI-001 lastReplyText: "Última respuesta: X,Y s" con coma decimal; vacío sin dato', () => {
  assert.equal(lastReplyText({ ttftMs: 900, totalMs: 6400, chars: 100 }), 'Última respuesta: 6,4 s');
  assert.equal(lastReplyText({ ttftMs: 0, totalMs: 12345, chars: 1 }), 'Última respuesta: 12,3 s');
  assert.equal(lastReplyText(undefined), '');
  assert.equal(lastReplyText({ totalMs: 5 }), '');
});

test('UI-001 estimateRowHeight: crece con el largo del texto, ignora los asteriscos, suma la línea inferior y tolera datos raros', () => {
  const short = estimateRowHeight('hola', 32);
  const long = estimateRowHeight('x'.repeat(400), 32);
  assert.equal(short, 50); // 24 + 1 línea (25,5) redondeado
  assert.ok(long > short * 5, `${long} vs ${short}`);
  assert.equal(estimateRowHeight('*hola*', 32), short); // los asteriscos no ocupan sitio
  assert.equal(estimateRowHeight('hola', 32, true), short + 34);
  assert.equal(estimateRowHeight(undefined, 32), short);
  assert.equal(estimateRowHeight('hola', NaN), short);
});

test('UI-001 charsPerBubbleLine: ~32 caracteres en 375 px, más en pantallas anchas, nunca menos de 8', () => {
  assert.equal(charsPerBubbleLine(375), 32);
  assert.ok(charsPerBubbleLine(768) > 60);
  assert.equal(charsPerBubbleLine(20), 8);
  assert.equal(charsPerBubbleLine(NaN), 32);
});

test('UI-001 stepScroll: avanza a la velocidad pedida y rebota en los extremos (recorre la lista de ida y vuelta)', () => {
  let s = { pos: 0, dir: 1 };
  s = stepScroll({ ...s, dtMs: 16, max: 1000, speedPxS: 1000 });
  assert.equal(s.pos, 16);
  assert.equal(s.dir, 1);
  s = stepScroll({ pos: 990, dir: 1, dtMs: 20, max: 1000, speedPxS: 1000 }); // se pasaría de 1000: rebota
  assert.deepEqual(s, { pos: 1000, dir: -1 });
  s = stepScroll({ pos: 5, dir: -1, dtMs: 20, max: 1000, speedPxS: 1000 }); // se pasaría de 0: rebota
  assert.deepEqual(s, { pos: 0, dir: 1 });
  // lista más corta que la pantalla (max 0) no se mueve y no falla
  assert.deepEqual(stepScroll({ pos: 0, dir: 1, dtMs: 16, max: 0 }), { pos: 0, dir: -1 });
  assert.deepEqual(stepScroll({ pos: NaN, dir: 7, dtMs: -5, max: NaN }), { pos: 0, dir: -1 });
  // recorrido completo simulado: sube y baja sin salirse nunca de [0, max]
  let p = { pos: 0, dir: 1 }; let down = 0, up = 0;
  for (let i = 0; i < 1000; i++) { p = stepScroll({ ...p, dtMs: 16.7, max: 5000 }); assert.ok(p.pos >= 0 && p.pos <= 5000); if (p.dir === 1) down++; else up++; }
  assert.ok(down > 100 && up > 100);
  assert.ok(FLUENCY_SPEED_PX_S >= 1500 && FLUENCY_SPEED_PX_S <= 4000);
});
