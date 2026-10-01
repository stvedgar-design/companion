// tests/character-sheet.test.mjs — UI-027: qué muestra/oculta la ficha del personaje (función pura, sin DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { characterSheetModel, duplicateCharacterData } from '../www/js/ui/character-sheet.js';
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

// ---------- UI-033: duplicateCharacterData ----------

const fullChar = () => ({
  id: 'c1',
  name: 'Mia',
  avatar: 'data:small',
  avatarLarge: 'data:large',
  card: { name: 'Mia', description: 'd', personality: 'p', post_history_instructions: 'nunca rompe el personaje' },
  avatarMode: 'mini',
  created: 1000,
  updated: 2000,
  last: 'último mensaje visto',
  lorebook: [{ id: 'l1', keys: ['k'], content: 'un recuerdo', updated: 1, source: 'manual' }],
  lorebookPrevious: [{ id: 'l0', keys: ['k0'], content: 'anterior', updated: 1, source: 'manual' }],
  lorebookPreviousAt: 50,
  lorebookTombstones: [{ content: 'borrado', keys: ['x'], at: 10 }],
  lorebookTombstonesPrevious: [{ content: 'borrado viejo', keys: ['y'], at: 5 }],
  appearance: { fixed: 'tall, dark hair', current: 'a red dress', updated: 999 },
  relationship: { text: 'We are close.', level: 'established', updated: 123, source: 'auto' },
  chatBackground: 'data:bg',
  chatBackgroundBrightness: 120,
  chatBackgroundFade: true,
  chatBackgroundFit: 'fill',
  formatStyle: 'plain',
  personalityTags: ['shy', 'bold'],
});

test('UI-033 duplicateCharacterData: copia la ficha completa (nombre con sufijo, card con Instrucciones, apariencia, avatar, fondo, personalidad)', () => {
  const original = fullChar();
  const dup = duplicateCharacterData(original);
  assert.equal(dup.name, 'Mia (copia)');
  assert.notEqual(dup.id, original.id, 'id nuevo e independiente');
  assert.deepEqual(dup.card, original.card, 'la card completa viaja tal cual, incluida post_history_instructions (CCC-002)');
  assert.deepEqual(dup.appearance, original.appearance);
  assert.equal(dup.avatar, original.avatar);
  assert.equal(dup.avatarLarge, original.avatarLarge);
  assert.equal(dup.chatBackground, original.chatBackground);
  assert.equal(dup.chatBackgroundBrightness, original.chatBackgroundBrightness);
  assert.equal(dup.chatBackgroundFade, original.chatBackgroundFade);
  assert.equal(dup.chatBackgroundFit, original.chatBackgroundFit);
  assert.equal(dup.formatStyle, original.formatStyle);
  assert.deepEqual(dup.personalityTags, original.personalityTags);
});

test('UI-033 duplicateCharacterData: NO copia lorebook, deshacer de lorebook, lápidas ni relación — queda como un personaje recién creado', () => {
  const dup = duplicateCharacterData(fullChar());
  assert.deepEqual(dup.lorebook, []);
  assert.deepEqual(dup.lorebookPrevious, []);
  assert.equal(dup.lorebookPreviousAt, 0);
  assert.deepEqual(dup.lorebookTombstones, []);
  assert.deepEqual(dup.lorebookTombstonesPrevious, []);
  assert.deepEqual(dup.relationship, { text: '', level: 'early', updated: 0, source: 'auto' });
});

test('UI-033 duplicateCharacterData: created/updated nuevos (no hereda las fechas del original); last vacío', () => {
  const original = fullChar();
  const before = Date.now();
  const dup = duplicateCharacterData(original);
  const after = Date.now();
  assert.notEqual(dup.created, original.created);
  assert.ok(dup.created >= before && dup.created <= after);
  assert.equal(dup.updated, dup.created);
  assert.equal(dup.last, '');
});

test('UI-033 duplicateCharacterData: el original no se modifica (misma referencia, sin mutación)', () => {
  const original = fullChar();
  const snapshot = JSON.parse(JSON.stringify(original));
  duplicateCharacterData(original);
  assert.deepEqual(original, snapshot);
});

test('formatDateOnly: solo día/mes/año, sin hora; \'\' con ts inválido', () => {
  assert.equal(formatDateOnly(new Date(2026, 8, 30, 23, 59).getTime()), '30 sep 2026');
  assert.equal(formatDateOnly(0), '');
  assert.equal(formatDateOnly(-1), '');
  assert.equal(formatDateOnly(NaN), '');
  assert.equal(formatDateOnly(undefined), '');
});
