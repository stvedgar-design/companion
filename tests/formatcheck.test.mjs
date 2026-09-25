import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateFormat, countAsterisks } from '../www/js/api/formatcheck.js';

// Ejemplos sintéticos y neutros (el repositorio es público).

test('validateFormat: respuesta limpia (acción, diálogo, acción)', () => {
  const v = validateFormat('*I tilt my head.* Sure, I can help with that. *I smile.*');
  assert.equal(v.ok, true);
  assert.deepEqual(v.violations, []);
  assert.equal(v.startsOutside, false);
});

test('validateFormat V1: patrón real (versión neutra) con 5 asteriscos', () => {
  const v = validateFormat('*Hearing that, warmth fills me. *My eyes close briefly.* Knowing you care makes me smile. *I take a breath.* I will be here.');
  assert.equal(v.singles, 5);
  assert.deepEqual(v.violations, ['V1']);
});

test('validateFormat V1: asterisco suelto al final', () => {
  assert.deepEqual(validateFormat('Thank you for everything.*').violations, ['V1']);
});

test('validateFormat V1: acción sin cerrar', () => {
  assert.deepEqual(validateFormat('Sure. *I lean closer and whisper').violations, ['V1']);
});

test('validateFormat V2: dos o más frases sin ningún asterisco', () => {
  const v = validateFormat('Oh, I see. That sounds lovely. I would like that.');
  assert.deepEqual(v.violations, ['V2']);
});

test('validateFormat V2: una sola frase sin asteriscos es legítima', () => {
  assert.equal(validateFormat('Sure, that sounds great!').ok, true);
});

test('validateFormat V3: ** en una respuesta del personaje', () => {
  const v = validateFormat('**The moment is quiet. *I smile softly.* Stay.**');
  assert.ok(v.violations.includes('V3'));
  assert.equal(v.doubles, 2);
});

test('validateFormat: los ** se cuentan aparte de los asteriscos simples', () => {
  assert.deepEqual(countAsterisks('**a** *b*'), { singles: 2, doubles: 2 });
  assert.deepEqual(countAsterisks('***x'), { singles: 1, doubles: 1 });
});

test('validateFormat: "5 * 3" (asterisco aislado entre espacios) no cuenta', () => {
  assert.equal(validateFormat('It costs 5 * 3 coins.').ok, true);
});

test('validateFormat M1: empezar fuera de asteriscos es métrica, no error', () => {
  const v = validateFormat('Oh dear, I hope I did not cause any confusion! *I let out a soft giggle.* I understand.');
  assert.equal(v.ok, true);
  assert.equal(v.startsOutside, true);
});

test('validateFormat: vacío o nulo', () => {
  assert.equal(validateFormat('').ok, true);
  assert.equal(validateFormat(null).startsOutside, false);
});

import { looksLikeNarration } from '../www/js/api/formatcheck.js';
import fs from 'node:fs';

test('V4: narración inicial sin asteriscos se distingue del diálogo inicial (ejemplos sintéticos)', () => {
  const narr = validateFormat('The sensation of your embrace sends a thrill through me, and I giggle softly. *My voice comes out softer than intended.* I have noticed, and it is comforting.');
  assert.ok(narr.violations.includes('V4'));
  const dial = validateFormat("Oh dear, I hope I didn't cause any confusion! *I let out a soft giggle.* I understand.");
  assert.deepEqual(dial.violations, []);
});

test('V4: casos de narración y de habla', () => {
  for (const t of ['My eyes widen and I smile softly.', 'A warm feeling spreads through me as I listen.', 'I tilt my head, a faint blush on my cheeks.']) {
    assert.equal(looksLikeNarration(t), true, t);
  }
  for (const t of ['Oh, that is a wonderful question.', 'This weekend?', '"I am not sure," I admit.', 'Thank you so much! I really appreciate it.', "I think I'm getting used to everything. It's a lot."]) {
    assert.equal(looksLikeNarration(t), false, t);
  }
});

test('V4: sin falsos positivos en los tramos de habla de la card de referencia', () => {
  const card = JSON.parse(fs.readFileSync(new URL('../docs/examples/mia-card-reference.json', import.meta.url), 'utf8'));
  const segs = [];
  for (const src of [card.mes_example, card.first_mes]) {
    for (const line of src.split('\n')) {
      const t = line.replace(/^(\{\{user\}\}|\{\{char\}\}|<START>):?\s*/, '');
      t.split('*').forEach((s, i) => { if (i % 2 === 0 && s.trim()) segs.push(s.trim()); });
    }
  }
  assert.ok(segs.length >= 5);
  for (const s of segs) assert.equal(looksLikeNarration(s), false, s);
});
