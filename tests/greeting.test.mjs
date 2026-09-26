// tests/greeting.test.mjs — UI-018: saludo según la hora
import test from 'node:test';
import assert from 'node:assert/strict';
import { dayPart, pickGreeting, GREETINGS } from '../www/js/greeting.js';

test('UI-018: las franjas cambian justo en los límites (medianoche incluida)', () => {
  const expected = { 0: 'madrugada', 5: 'madrugada', 6: 'manana', 11: 'manana', 12: 'tarde', 19: 'tarde', 20: 'noche', 23: 'noche' };
  for (const [h, part] of Object.entries(expected)) assert.equal(dayPart(Number(h)), part, `hora ${h}`);
  assert.equal(dayPart(24), 'madrugada'); // medianoche expresada como 24
  assert.equal(dayPart(-1), 'noche');
  assert.equal(dayPart(NaN) in GREETINGS, true); // un valor raro nunca rompe el saludo
});

test('UI-018: cada franja tiene al menos 5 frases, todas distintas, sin nombres propios', () => {
  for (const [part, list] of Object.entries(GREETINGS)) {
    assert.ok(list.length >= 5, part);
    assert.equal(new Set(list).size, list.length, part);
    for (const g of list) assert.ok(g.trim().length > 3 && !/\{\{|<user>|<bot>/i.test(g));
  }
});

test('UI-018: nunca repite la frase de la vez anterior si hay más de una opción, con cualquier valor aleatorio', () => {
  for (const hour of [2, 8, 15, 22]) {
    for (const last of GREETINGS[dayPart(hour)]) {
      for (const r of [0, 0.2, 0.5, 0.8, 0.999999]) {
        const g = pickGreeting(hour, last, () => r);
        assert.notEqual(g, last);
        assert.ok(GREETINGS[dayPart(hour)].includes(g));
      }
    }
  }
});

test('UI-018: una "última" de otra franja o vacía no excluye nada; sale de la franja correcta', () => {
  assert.equal(pickGreeting(9, '', () => 0), GREETINGS.manana[0]);
  assert.equal(pickGreeting(9, GREETINGS.noche[0], () => 0), GREETINGS.manana[0]);
  assert.equal(pickGreeting(9, undefined, () => 0.999999), GREETINGS.manana[GREETINGS.manana.length - 1]);
});

test('UI-018: con el aleatorio real, todas las frases de una franja llegan a salir', () => {
  const seen = new Set();
  let last = '';
  for (let i = 0; i < 400; i++) { last = pickGreeting(21, last); seen.add(last); }
  assert.equal(seen.size, GREETINGS.noche.length);
});
