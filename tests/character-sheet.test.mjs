// tests/character-sheet.test.mjs — UI-027: qué muestra/oculta la ficha del personaje (función pura, sin DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { characterSheetModel } from '../www/js/ui/character-sheet.js';
import { RELATIONSHIP_EARLY_DISPLAY_TEXT } from '../www/js/api/relationship.js';
import { formatDateOnly } from '../www/js/msgtime.js';

const makeChar = (extra = {}) => ({ id: 'c1', name: 'Nova', card: { name: 'Nova' }, ...extra });

test('characterSheetModel: personaje mínimo (sin nada extra) — relación "early", sin rasgos, sin fecha, sin apariencia', () => {
  const m = characterSheetModel(makeChar());
  assert.equal(m.name, 'Nova');
  assert.equal(m.initial, 'N');
  assert.equal(m.heroSrc, '');
  assert.equal(m.relationshipText, RELATIONSHIP_EARLY_DISPLAY_TEXT);
  assert.equal(m.traits, null);
  assert.equal(m.createdText, '');
  assert.equal(m.description, '');
  assert.equal(m.appearance, null);
  assert.equal(m.memoriesCount, 0);
});

test('characterSheetModel: con etiquetas del creador, usa sus labels (nunca ids crudos) y NO el texto libre', () => {
  const m = characterSheetModel(makeChar({ personalityTags: ['shy', 'bold'], card: { name: 'Nova', personality: 'texto libre que se ignora' } }));
  assert.deepEqual(m.traits, { kind: 'tags', labels: ['Shy', 'Bold'] });
});

test('characterSheetModel: sin etiquetas pero con personality de texto libre (card importada) — texto tal cual, nunca inventa pills', () => {
  const m = characterSheetModel(makeChar({ personalityTags: [], card: { name: 'Nova', personality: 'direct, upbeat' } }));
  assert.deepEqual(m.traits, { kind: 'text', text: 'direct, upbeat' });
});

test('characterSheetModel: sin etiquetas y sin personality — sección de rasgos oculta (null)', () => {
  const m = characterSheetModel(makeChar({ personalityTags: [], card: { name: 'Nova', personality: '' } }));
  assert.equal(m.traits, null);
});

test('characterSheetModel: "Creada" solo si `created` es un número finito y positivo', () => {
  assert.equal(characterSheetModel(makeChar({ created: undefined })).createdText, '');
  assert.equal(characterSheetModel(makeChar({ created: 0 })).createdText, '');
  const ts = new Date(2026, 8, 30, 12, 0).getTime();
  assert.equal(characterSheetModel(makeChar({ created: ts })).createdText, '30 sep 2026');
});

test('characterSheetModel: apariencia null si fixed y current están vacíos; objeto si hay al menos uno', () => {
  assert.equal(characterSheetModel(makeChar({ appearance: { fixed: '', current: '', updated: 0 } })).appearance, null);
  assert.equal(characterSheetModel(makeChar()).appearance, null, 'sin campo appearance también se oculta');
  const m = characterSheetModel(makeChar({ appearance: { fixed: 'tall, dark hair', current: '', updated: 1 } }));
  assert.deepEqual(m.appearance, { fixed: 'tall, dark hair', current: '', updated: 1 });
});

test('characterSheetModel: descripción viene de card.description, recortada; vacía si no hay nada', () => {
  assert.equal(characterSheetModel(makeChar({ card: { name: 'Nova', description: '  runs a bookshop  ' } })).description, 'runs a bookshop');
  assert.equal(characterSheetModel(makeChar({ card: { name: 'Nova' } })).description, '');
});

test('characterSheetModel: heroSrc prioriza avatarLarge sobre avatar; cae a avatar si no hay grande; \'\' si no hay ninguna', () => {
  assert.equal(characterSheetModel(makeChar({ avatar: 'data:small', avatarLarge: 'data:large' })).heroSrc, 'data:large');
  assert.equal(characterSheetModel(makeChar({ avatar: 'data:small' })).heroSrc, 'data:small');
  assert.equal(characterSheetModel(makeChar()).heroSrc, '');
});

test('characterSheetModel: memoriesCount cuenta el lorebook con la misma regla que "Ver lorebook" (relationshipSummary)', () => {
  const lorebook = [
    { id: 'a', keys: ['x'], content: 'algo', updated: 1, source: 'manual' },
    { id: 'b', keys: ['y'], content: 'otra cosa', updated: 2, source: 'auto', always: true },
    { id: 'c', content: '   ' /* sin contenido real: no cuenta */, updated: 3, source: 'auto' },
  ];
  assert.equal(characterSheetModel(makeChar({ lorebook })).memoriesCount, 2);
});

test('characterSheetModel: nombre vacío cae a "Sin nombre" (no rompe el inicial del avatar)', () => {
  const m = characterSheetModel(makeChar({ name: '   ' }));
  assert.equal(m.name, 'Sin nombre');
  assert.equal(m.initial, 'S');
});

test('formatDateOnly: solo día/mes/año, sin hora; \'\' con ts inválido', () => {
  assert.equal(formatDateOnly(new Date(2026, 8, 30, 23, 59).getTime()), '30 sep 2026');
  assert.equal(formatDateOnly(0), '');
  assert.equal(formatDateOnly(-1), '');
  assert.equal(formatDateOnly(NaN), '');
  assert.equal(formatDateOnly(undefined), '');
});
