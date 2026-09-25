import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  relationshipLevel,
  relationshipSummary,
  relationshipAgeText,
  RELATIONSHIP_PHRASES,
  RELATIONSHIP_FEW_MAX,
  RELATIONSHIP_MANY_MIN,
} from '../www/js/api/relationship.js';

// Todos los datos son sintéticos y neutros.
const entry = (id, content, extra = {}) => ({ id, keys: ['k'], content, updated: 1000, source: 'auto', ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => entry('e' + i, `Hecho número ${i}.`));

test('MEM-006: sin recuerdos → nivel "none" y no se afirma nada de la relación', () => {
  for (const input of [[], undefined, null, [null, {}, { content: '   ' }]]) {
    const s = relationshipSummary(input);
    assert.equal(s.total, 0);
    assert.equal(s.level, 'none');
    assert.equal(s.phrase, RELATIONSHIP_PHRASES.none);
    assert.deepEqual(s.always, []);
    assert.equal(s.lastUpdated, 0);
  }
  assert.ok(!/conociendo|compartido|historia/.test(RELATIONSHIP_PHRASES.none));
});

test('MEM-006: los umbrales pocos / varios / muchos, en sus límites exactos', () => {
  assert.equal(relationshipLevel(1), 'few');
  assert.equal(relationshipLevel(RELATIONSHIP_FEW_MAX), 'few');
  assert.equal(relationshipLevel(RELATIONSHIP_FEW_MAX + 1), 'several');
  assert.equal(relationshipLevel(RELATIONSHIP_MANY_MIN - 1), 'several');
  assert.equal(relationshipLevel(RELATIONSHIP_MANY_MIN), 'many');
  assert.equal(relationshipLevel(24), 'many'); // el tope del lorebook
  assert.equal(relationshipLevel(0), 'none');
  assert.equal(relationshipLevel(NaN), 'none');
});

test('MEM-006: la frase fija sale de la cantidad de recuerdos (textos acordados con el usuario)', () => {
  assert.equal(relationshipSummary(many(2)).phrase, 'Todavía se están conociendo.');
  assert.equal(relationshipSummary(many(7)).phrase, 'Ya han compartido bastante.');
  assert.equal(relationshipSummary(many(15)).phrase, 'Tienen una relación con mucha historia acumulada.');
});

test('MEM-006: cuenta el total (siempre presentes + por tema) y lista los "siempre presentes" con su texto exacto', () => {
  const entries = [
    entry('a', 'Sam le contó a Mia que su perro Bruno le teme a los truenos.', { always: true, source: 'manual' }),
    entry('b', 'Se conocieron en un café.'),
    entry('c', 'Mia se puso nerviosa cuando Sam le tomó la mano.', { always: true, source: 'manual' }),
    entry('d', 'Sam nunca fue a la playa.'),
  ];
  const s = relationshipSummary(entries);
  assert.equal(s.total, 4);
  assert.deepEqual(s.always, [
    { id: 'a', content: 'Sam le contó a Mia que su perro Bruno le teme a los truenos.' },
    { id: 'c', content: 'Mia se puso nerviosa cuando Sam le tomó la mano.' },
  ]);
});

test('MEM-006: la última actualización es la fecha más reciente entre los recuerdos', () => {
  const s = relationshipSummary([entry('a', 'Uno.', { updated: 500 }), entry('b', 'Dos.', { updated: 9000 }), entry('c', 'Tres.', { updated: 100 })]);
  assert.equal(s.lastUpdated, 9000);
  assert.equal(relationshipSummary([entry('a', 'Uno.', { updated: undefined })]).lastUpdated, 0);
});

test('MEM-006: no inventa: solo usa texto de las entradas y no altera lo recibido (puro)', () => {
  const entries = Object.freeze([Object.freeze(entry('a', ' Hecho con espacios. ', { always: true }))]);
  const s = relationshipSummary(entries);
  assert.deepEqual(s.always, [{ id: 'a', content: 'Hecho con espacios.' }]);
  assert.equal(entries[0].content, ' Hecho con espacios. ');
  const allowed = new Set(Object.values(RELATIONSHIP_PHRASES));
  assert.ok(allowed.has(s.phrase));
});

test('MEM-006: no usa red: el módulo no importa nada ni llama a fetch', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../www/js/api/relationship.js', import.meta.url), 'utf8');
  assert.ok(!/\bfetch\s*\(|\bimport\s+[^(]|completeOnce|kobold/.test(src.replace(/\/\/.*$/gm, '')));
});

test('MEM-006: relationshipAgeText en lenguaje llano', () => {
  const now = 10 * 24 * 3600 * 1000 * 10;
  const ago = (ms) => now - ms;
  const MIN = 60000, H = 60 * MIN, D = 24 * H;
  assert.equal(relationshipAgeText(ago(20 * 1000), now), 'hace un momento');
  assert.equal(relationshipAgeText(ago(1 * MIN), now), 'hace 1 minuto');
  assert.equal(relationshipAgeText(ago(5 * MIN), now), 'hace 5 minutos');
  assert.equal(relationshipAgeText(ago(1 * H), now), 'hace 1 hora');
  assert.equal(relationshipAgeText(ago(3 * H), now), 'hace 3 horas');
  assert.equal(relationshipAgeText(ago(1 * D), now), 'hace 1 día');
  assert.equal(relationshipAgeText(ago(2 * D), now), 'hace 2 días');
  assert.equal(relationshipAgeText(ago(45 * D), now), 'hace 1 mes');
  assert.equal(relationshipAgeText(ago(90 * D), now), 'hace 3 meses');
  assert.equal(relationshipAgeText(0, now), '');
  assert.equal(relationshipAgeText(undefined, now), '');
  assert.equal(relationshipAgeText(now + 5000, now), 'hace un momento'); // fecha futura por desfase de reloj
});
