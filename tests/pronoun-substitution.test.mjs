// tests/pronoun-substitution.test.mjs — CCC-005: género y pronombres en plantillas y ejemplos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyGender, archetypeForGender, sanitizeGender, GENDERS, GENDER_LABELS } from '../www/js/pronoun-substitution.js';
import { CHARACTER_ARCHETYPES } from '../www/js/data/character-archetypes.js';
import { createState } from '../www/js/state.js';

test('applyGender: neutral (o valor desconocido) deja el texto exactamente igual', () => {
  const t = "They said it was theirs, and I told them they're wrong. They have a plan.";
  assert.equal(applyGender(t, 'neutral'), t);
  assert.equal(applyGender(t, undefined), t);
  assert.equal(applyGender(t, 'otro'), t);
});

test('applyGender: femenino y masculino, lista cerrada de formas', () => {
  const t = "They said it was theirs. I told them to rest themselves. Their eyes: they're calm, they've been quiet, they have time, they don't mind, they are fine, they do care.";
  assert.equal(
    applyGender(t, 'female'),
    "She said it was hers. I told her to rest herself. Her eyes: she's calm, she's been quiet, she has time, she doesn't mind, she is fine, she does care."
  );
  assert.equal(
    applyGender(t, 'male'),
    "He said it was his. I told him to rest himself. His eyes: he's calm, he's been quiet, he has time, he doesn't mind, he is fine, he does care."
  );
});

test('applyGender: conserva mayúsculas, apóstrofe tipográfico y no toca palabras parecidas', () => {
  assert.equal(applyGender('THEY left. They left. they left.', 'female'), 'SHE left. She left. she left.');
  assert.equal(applyGender('They’re here', 'male'), "He's here");
  const safe = 'Another theory: the theme is their-own, otherwise there is nothing; {{char}} and {{user}} stay.';
  assert.equal(applyGender(safe, 'female').includes('theory'), true);
  assert.equal(applyGender(safe, 'female').includes('theme'), true);
  assert.equal(applyGender(safe, 'female').includes('otherwise'), true);
  assert.equal(applyGender(safe, 'female').includes('{{char}} and {{user}}'), true);
  assert.equal(applyGender('', 'female'), '');
  assert.equal(applyGender(undefined, 'female'), '');
});

test('sanitizeGender y listas: solo 3 valores, "neutral" por defecto', () => {
  assert.deepEqual(GENDERS, ['female', 'male', 'neutral']);
  assert.deepEqual(GENDER_LABELS.map((g) => g.id), GENDERS);
  for (const bad of [undefined, null, '', 'Female', 42, {}]) assert.equal(sanitizeGender(bad), 'neutral');
  assert.equal(sanitizeGender('male'), 'male');
});

// Regla de redacción del texto base (ver cabecera de pronoun-substitution.js): tras "they" solo pasado,
// auxiliares de la lista o modales. Se vigila en los 6 arquetipos y en los ejemplos del creador.
const AFTER_THEY_OK = /^(?:'re|'ve|'ll|'d|\s+(?:are|have|do|don't|aren't|haven't|were|weren't|can|could|will|would|should|might|must|may|just|also|never|still|always|noticed|spotted|burst|saw|had|did|didn't|said|looked|came|were|was|[a-z]+ed)\b)/i;
function theyViolations(text) {
  const bad = [];
  for (const m of text.matchAll(/\bthey(?![a-z])/gi)) {
    const rest = text.slice(m.index + m[0].length);
    if (!AFTER_THEY_OK.test(rest)) bad.push(text.slice(m.index, m.index + 24));
  }
  return bad;
}
const FIELDS = ['description', 'scenario', 'firstMes', 'mesExample'];

test('CCC-005: los 6 arquetipos respetan la regla de "they" y no dejan neutros al convertir', () => {
  assert.equal(CHARACTER_ARCHETYPES.length, 6);
  for (const a of CHARACTER_ARCHETYPES) {
    for (const f of FIELDS) {
      assert.deepEqual(theyViolations(a[f]), [], `${a.id}.${f}: verbo en presente tras "they"`);
      for (const g of ['female', 'male']) {
        const out = applyGender(a[f], g);
        assert.doesNotMatch(out, /\b(they|their|them|themselves?)\b/i, `${a.id}.${f} (${g}) quedó con neutros: ${out}`);
        assert.doesNotMatch(out, /\b(she|he)\s+(have|are|do|don't|were|aren't|haven't)\b/i, `${a.id}.${f} (${g}) mala concordancia: ${out}`);
        assert.doesNotMatch(out, /\b(she|he) (want|care|spot|notice|need|know|feel|trust|meet)\b/i, `${a.id}.${f} (${g}) verbo sin conjugar`);
      }
    }
  }
});

test('CCC-005: revisión manual en los 3 géneros — frases clave de los arquetipos con pronombres', () => {
  const by = (id) => CHARACTER_ARCHETYPES.find((a) => a.id === id);
  assert.match(archetypeForGender(by('reserved-protector'), 'female').scenario, /She noticed something felt off tonight and she's been hovering nearby/);
  assert.match(archetypeForGender(by('reserved-protector'), 'male').scenario, /He noticed .* and he's been hovering/);
  assert.match(archetypeForGender(by('reserved-protector'), 'neutral').scenario, /They noticed .* and they've been hovering/);
  assert.match(archetypeForGender(by('calm-companion'), 'female').description, /people she has grown attached to/);
  assert.match(archetypeForGender(by('calm-companion'), 'male').scenario, /he's sitting close by/);
  assert.match(archetypeForGender(by('direct-flirt'), 'female').description, /what, or who, she's after/);
  assert.match(archetypeForGender(by('confidant'), 'female').firstMes, /pats the seat beside her/);
  assert.match(archetypeForGender(by('confidant'), 'male').firstMes, /pats the seat beside him/);
  assert.match(archetypeForGender(by('demanding-mentor'), 'male').scenario, /he's reviewing your progress/);
});

test('CCC-005: archetypeForGender solo toca los 4 campos de texto y deja intactos id, etiquetas y neutro', () => {
  const a = CHARACTER_ARCHETYPES[0];
  const f = archetypeForGender(a, 'female');
  assert.equal(f.id, a.id);
  assert.equal(f.label, a.label);
  assert.deepEqual(f.personalityTags, a.personalityTags);
  assert.deepEqual(archetypeForGender(a, 'neutral'), a);
  assert.match(f.mesExample, /<START>\n\{\{user\}\}:/, 'conserva <START>, {{user}} y {{char}}');
});

test('CCC-005: los ejemplos del creador (botón "Ejemplo") también respetan la regla y convierten limpio', () => {
  const src = readFileSync(new URL('../www/js/ui/character-editor.js', import.meta.url), 'utf8');
  const consts = [...src.matchAll(/^const (EXAMPLE_(?!PERSONALITY_TAGS)[A-Z_]+) = (['"])(.*)\2;$/gm)];
  assert.ok(consts.length >= 7, 'se encontraron los ejemplos');
  for (const [, name, , text] of consts) {
    assert.deepEqual(theyViolations(text), [], `${name}: verbo en presente tras "they"`);
    for (const g of ['female', 'male']) assert.doesNotMatch(applyGender(text, g), /\b(they|their|them)\b/i, `${name} (${g})`);
  }
  for (const [, name, , text] of consts) assert.doesNotMatch(text, /\b(she|her|hers|he|his|him)\b/i, `${name}: el ejemplo base debe ser neutro`);
});

function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(s, k) { return stores[s].get(k); },
    async getAll(s) { return Array.from(stores[s].values()); },
    async put(s, k, v) { stores[s].set(k, v); },
    async remove(s, k) { stores[s].delete(k); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
  };
}

test('CCC-005: Character.gender se guarda y se relee; personajes viejos cargan "neutral" sin tocar su texto', async () => {
  const state = createState(memoryBackend());
  const old = { id: 'old', name: 'Mia', avatar: '', card: { name: 'Mia', description: 'She is shy.' }, created: 1 };
  await state.saveCharacter(old);
  const loaded = await state.getCharacter('old');
  assert.equal(loaded.gender, 'neutral');
  assert.equal(loaded.card.description, 'She is shy.', 'el texto de un personaje existente no se reescribe');
  await state.saveCharacter({ ...loaded, gender: 'female' });
  assert.equal((await state.getCharacter('old')).gender, 'female');
  await state.saveCharacter({ ...loaded, gender: 'basura' });
  assert.equal((await state.getCharacter('old')).gender, 'neutral');
  assert.equal((await state.listCharacters())[0].card.description, 'She is shy.');
});
