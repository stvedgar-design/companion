import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOREBOOK_UPDATE_EVERY_MESSAGES,
  LOREBOOK_MAX_ENTRIES,
  LOREBOOK_MAX_ENTRY_CHARS,
  LOREBOOK_INJECT_CHAR_BUDGET,
  shouldUpdateLorebook,
  buildExtractionPrompt,
  parseExtractionResponse,
  sanitizeLoreEntries,
  selectLoreEntries,
  formatLoreBlock
} from '../www/js/api/lorebook.js';

function makeCharacter(overrides = {}) {
  return {
    id: 'c1',
    name: 'Luna',
    avatar: '',
    card: {
      name: 'Luna',
      description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', system_prompt: '',
      post_history_instructions: '', alternate_greetings: [], character_book: null
    },
    avatarMode: 'mini',
    created: Date.now(),
    ...overrides
  };
}

function makeSettings(overrides = {}) {
  return { url: 'http://100.1.1.1:5001', user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'plain', ctx: 4096, ...overrides };
}

function makeEntry(overrides = {}) {
  return { id: 'l1', keys: ['café'], content: 'Se conocieron en un café.', updated: 1000, source: 'auto', ...overrides };
}

// ---------- shouldUpdateLorebook ----------

test('shouldUpdateLorebook dispara cuando pasaron >= LOREBOOK_UPDATE_EVERY_MESSAGES desde el último corte', () => {
  assert.equal(shouldUpdateLorebook({ lorebookMessageCount: 0 }, LOREBOOK_UPDATE_EVERY_MESSAGES - 1), false);
  assert.equal(shouldUpdateLorebook({ lorebookMessageCount: 0 }, LOREBOOK_UPDATE_EVERY_MESSAGES), true);
  assert.equal(shouldUpdateLorebook({ lorebookMessageCount: 10 }, 10 + LOREBOOK_UPDATE_EVERY_MESSAGES), true);
});

test('shouldUpdateLorebook trata lorebookMessageCount ausente como 0', () => {
  assert.equal(shouldUpdateLorebook({}, LOREBOOK_UPDATE_EVERY_MESSAGES), true);
  assert.equal(shouldUpdateLorebook(null, LOREBOOK_UPDATE_EVERY_MESSAGES), true);
});

// ---------- buildExtractionPrompt ----------

test('buildExtractionPrompt incluye nombres, transcripción y lorebook existente', () => {
  const character = makeCharacter();
  const messages = [
    { role: 'user', text: 'Me encanta el café', ts: 1 },
    { role: 'char', text: 'Lo recordaré', ts: 2 }
  ];
  const existing = [makeEntry({ content: 'Un hecho ya conocido.' })];
  const prompt = buildExtractionPrompt(character, makeSettings(), messages, existing);

  assert.match(prompt, /Luna/);
  assert.match(prompt, /Edgar/);
  assert.match(prompt, /Me encanta el café/);
  assert.match(prompt, /Un hecho ya conocido\./);
  assert.match(prompt, /JSON array/);
});

test('buildExtractionPrompt funciona sin entradas existentes', () => {
  const character = makeCharacter();
  const prompt = buildExtractionPrompt(character, makeSettings(), [], []);
  assert.match(prompt, /\[\]/);
});

// ---------- parseExtractionResponse ----------

test('parseExtractionResponse parsea un JSON directo', () => {
  const raw = '[{"keys":["a"],"content":"x"}]';
  assert.deepEqual(parseExtractionResponse(raw), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse extrae un bloque [] balanceado rodeado de texto', () => {
  const raw = 'Here is the updated lorebook:\n[{"keys":["a"],"content":"x"}]\nHope this helps!';
  assert.deepEqual(parseExtractionResponse(raw), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse tolera un objeto suelto en vez de un array', () => {
  const raw = '{"keys":["a"],"content":"x"}';
  assert.deepEqual(parseExtractionResponse(raw), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse devuelve null si no hay nada parseable', () => {
  assert.equal(parseExtractionResponse('esto no es JSON de ninguna forma'), null);
  assert.equal(parseExtractionResponse(''), null);
  assert.equal(parseExtractionResponse('[{"keys": ["a", "content": "corte a la mitad'), null);
});

// ---------- sanitizeLoreEntries ----------

test('sanitizeLoreEntries valida forma: descarta entradas sin content o sin keys', () => {
  const raw = [
    { keys: ['a'], content: 'Válida' },
    { keys: [], content: 'Sin keys' },
    { keys: ['b'], content: '' },
    { keys: ['c'] },
    'no es un objeto',
    null
  ];
  const out = sanitizeLoreEntries(raw, []);
  assert.equal(out.length, 1);
  assert.equal(out[0].content, 'Válida');
  assert.equal(out[0].source, 'auto');
  assert.ok(out[0].id);
  assert.equal(typeof out[0].updated, 'number');
});

test('sanitizeLoreEntries trunca content al máximo de caracteres', () => {
  const raw = [{ keys: ['x'], content: 'y'.repeat(LOREBOOK_MAX_ENTRY_CHARS + 100) }];
  const out = sanitizeLoreEntries(raw, []);
  assert.equal(out[0].content.length, LOREBOOK_MAX_ENTRY_CHARS);
});

test('sanitizeLoreEntries no duplica contenido ya existente en entradas manuales', () => {
  const existing = [makeEntry({ id: 'm1', content: 'Ya lo sabíamos.', source: 'manual' })];
  const raw = [{ keys: ['x'], content: 'Ya lo sabíamos.' }, { keys: ['y'], content: 'Hecho nuevo.' }];
  const out = sanitizeLoreEntries(raw, existing);
  assert.equal(out.length, 2); // la manual + solo el hecho nuevo
  assert.ok(out.find((e) => e.id === 'm1' && e.source === 'manual'));
  assert.ok(out.find((e) => e.content === 'Hecho nuevo.'));
});

test('sanitizeLoreEntries nunca descarta entradas manuales existentes', () => {
  const existing = [makeEntry({ id: 'm1', content: 'Fijado a mano.', source: 'manual' })];
  const out = sanitizeLoreEntries([], existing);
  assert.deepEqual(out, existing);
});

test('sanitizeLoreEntries limita el total a LOREBOOK_MAX_ENTRIES', () => {
  const raw = Array.from({ length: LOREBOOK_MAX_ENTRIES + 10 }, (_, i) => ({
    keys: [`k${i}`],
    content: `Hecho número ${i}.`
  }));
  const out = sanitizeLoreEntries(raw, []);
  assert.equal(out.length, LOREBOOK_MAX_ENTRIES);
});

test('sanitizeLoreEntries reserva espacio para las entradas manuales dentro del tope', () => {
  const existing = [
    makeEntry({ id: 'm1', content: 'Manual 1', source: 'manual' }),
    makeEntry({ id: 'm2', content: 'Manual 2', source: 'manual' })
  ];
  const raw = Array.from({ length: LOREBOOK_MAX_ENTRIES }, (_, i) => ({ keys: [`k${i}`], content: `Auto ${i}` }));
  const out = sanitizeLoreEntries(raw, existing);
  assert.equal(out.length, LOREBOOK_MAX_ENTRIES);
  assert.equal(out.filter((e) => e.source === 'manual').length, 2);
  assert.equal(out.filter((e) => e.source === 'auto').length, LOREBOOK_MAX_ENTRIES - 2);
});

test('sanitizeLoreEntries no lanza con basura de cualquier tipo', () => {
  assert.doesNotThrow(() => sanitizeLoreEntries(null, null));
  assert.doesNotThrow(() => sanitizeLoreEntries('no es un array', undefined));
  assert.deepEqual(sanitizeLoreEntries(null, null), []);
});

// ---------- selectLoreEntries ----------

test('selectLoreEntries solo incluye entradas cuyas keys matchean los últimos mensajes', () => {
  const entries = [
    makeEntry({ id: '1', keys: ['café'], content: 'Sobre el café.' }),
    makeEntry({ id: '2', keys: ['playa'], content: 'Sobre la playa.' })
  ];
  const recent = [{ role: 'user', text: 'Hablemos del café de la mañana', ts: 1 }];
  const out = selectLoreEntries(entries, recent);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
});

test('selectLoreEntries es insensible a mayúsculas', () => {
  const entries = [makeEntry({ keys: ['Café'], content: 'x' })];
  const recent = [{ role: 'user', text: 'CAFÉ por favor', ts: 1 }];
  assert.equal(selectLoreEntries(entries, recent).length, 1);
});

test('selectLoreEntries solo escanea los últimos mensajes, no todo el historial', () => {
  const entries = [makeEntry({ keys: ['café'], content: 'x' })];
  const recent = [
    { role: 'user', text: 'café', ts: 1 },
    { role: 'char', text: 'algo', ts: 2 },
    { role: 'user', text: 'otra cosa', ts: 3 },
    { role: 'char', text: 'más', ts: 4 }
  ];
  assert.equal(selectLoreEntries(entries, recent, { scanCount: 2 }).length, 0);
});

test('selectLoreEntries respeta el tope de caracteres, priorizando lo más reciente', () => {
  const entries = [
    makeEntry({ id: 'viejo', keys: ['tema'], content: 'x'.repeat(50), updated: 1 }),
    makeEntry({ id: 'nuevo', keys: ['tema'], content: 'y'.repeat(50), updated: 2 })
  ];
  const recent = [{ role: 'user', text: 'hablemos del tema', ts: 1 }];
  const out = selectLoreEntries(entries, recent, { charBudget: 55 });
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'nuevo');
});

test('selectLoreEntries nunca deja afuera la primera entrada aunque exceda el presupuesto', () => {
  const entries = [makeEntry({ keys: ['tema'], content: 'x'.repeat(LOREBOOK_INJECT_CHAR_BUDGET + 500) })];
  const recent = [{ role: 'user', text: 'el tema de hoy', ts: 1 }];
  assert.equal(selectLoreEntries(entries, recent).length, 1);
});

test('selectLoreEntries devuelve [] sin entradas o sin mensajes recientes', () => {
  assert.deepEqual(selectLoreEntries([], [{ role: 'user', text: 'algo', ts: 1 }]), []);
  assert.deepEqual(selectLoreEntries([makeEntry()], []), []);
});

// ---------- formatLoreBlock ----------

test('formatLoreBlock arma un bloque legible con guiones', () => {
  const out = formatLoreBlock([makeEntry({ content: 'Hecho uno.' }), makeEntry({ content: 'Hecho dos.' })]);
  assert.match(out, /- Hecho uno\./);
  assert.match(out, /- Hecho dos\./);
});

test('formatLoreBlock devuelve "" sin entradas', () => {
  assert.equal(formatLoreBlock([]), '');
  assert.equal(formatLoreBlock(null), '');
});
