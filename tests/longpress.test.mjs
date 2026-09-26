import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLongPress } from '../www/js/longpress.js';

function fakeClock() {
  let now = 0;
  let next = 1;
  const timers = new Map();
  return {
    setTimer(fn, ms) { const id = next++; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      now += ms;
      for (const [id, t] of [...timers]) if (t.at <= now) { timers.delete(id); t.fn(); }
    },
    pending: () => timers.size,
  };
}

test('UI-022 longpress: se dispara al mantener presionado el tiempo indicado', () => {
  const clock = fakeClock();
  let n = 0;
  const lp = createLongPress({ delay: 500, onLong: () => n++, ...clock });
  lp.down(10, 10);
  clock.advance(499);
  assert.equal(n, 0);
  clock.advance(1);
  assert.equal(n, 1);
});

test('UI-022 longpress: soltar antes de tiempo cancela y el click posterior es un toque normal', () => {
  const clock = fakeClock();
  let n = 0;
  const lp = createLongPress({ delay: 500, onLong: () => n++, ...clock });
  lp.down(0, 0);
  clock.advance(300);
  lp.up();
  clock.advance(1000);
  assert.equal(n, 0);
  assert.equal(clock.pending(), 0);
  assert.equal(lp.consumeClick(), false);
});

test('UI-022 longpress: mover el dedo más que la tolerancia (scroll) cancela; un temblor pequeño no', () => {
  const clock = fakeClock();
  let n = 0;
  const lp = createLongPress({ delay: 500, tolerance: 10, onLong: () => n++, ...clock });
  lp.down(100, 100);
  lp.move(104, 103); // temblor: distancia 5
  clock.advance(500);
  assert.equal(n, 1);

  lp.down(100, 100);
  lp.move(100, 130); // scroll
  clock.advance(1000);
  assert.equal(n, 1);
});

test('UI-022 longpress: consumeClick devuelve true una sola vez tras dispararse y un toque nuevo lo reinicia', () => {
  const clock = fakeClock();
  const lp = createLongPress({ delay: 500, onLong: () => {}, ...clock });
  lp.down(0, 0);
  clock.advance(500);
  assert.equal(lp.consumeClick(), true);
  assert.equal(lp.consumeClick(), false);

  // si el click nunca llegó (el dedo se movió al soltar), el siguiente toque real no debe quedar ignorado
  lp.down(0, 0);
  clock.advance(500);
  lp.down(0, 0); // toque nuevo
  lp.up();
  assert.equal(lp.consumeClick(), false);
});
