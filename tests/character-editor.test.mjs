// tests/character-editor.test.mjs — CCC-001: creador/editor de personajes.
// Cubre los módulos puros: personality-tags.js (pills) y cards/build.js (ensamblado de la Card).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERSONALITY_TAGS, MAX_PERSONALITY_TAGS, sanitizePersonalityTags, personalityTextFromTags } from '../www/js/personality-tags.js';
import { buildCharacterCard, cleanText, normalizeField, NAME_MAX, DESCRIPTION_MAX, SCENARIO_MAX, FIRST_MES_MAX, MES_EXAMPLE_MAX, INSTRUCTIONS_MAX } from '../www/js/cards/build.js';
import { normCard } from '../www/js/cards/parse.js';
import { createState } from '../www/js/state.js';
import { CHARACTER_ARCHETYPES } from '../www/js/data/character-archetypes.js';
import { readFileSync } from 'node:fs';

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

const makeChar = (extra = {}) => ({ id: 'c1', name: 'Mia', avatar: '', card: { name: 'Mia' }, created: 1, ...extra });

// ---------- personality-tags.js ----------

test('PERSONALITY_TAGS: lista curada, sin duplicados, ids en minúscula, etiquetas capitalizadas', () => {
  assert.ok(PERSONALITY_TAGS.length >= 12, 'lista curada completa, no un puñado de ejemplos');
  const ids = PERSONALITY_TAGS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, 'sin ids repetidos');
  for (const { id, label } of PERSONALITY_TAGS) {
    assert.equal(id, id.toLowerCase());
    assert.equal(label.charAt(0), label.charAt(0).toUpperCase());
    assert.equal(label.toLowerCase(), id);
  }
  assert.equal(MAX_PERSONALITY_TAGS, 6);
});

test('sanitizePersonalityTags: filtra basura, ids desconocidos y duplicados; tope de 6', () => {
  assert.deepEqual(sanitizePersonalityTags(undefined), []);
  assert.deepEqual(sanitizePersonalityTags(null), []);
  assert.deepEqual(sanitizePersonalityTags('shy'), []);
  assert.deepEqual(sanitizePersonalityTags(['shy', 'not-a-real-tag', 'bold', 42, null]), ['shy', 'bold']);
  assert.deepEqual(sanitizePersonalityTags(['shy', 'shy', 'bold']), ['shy', 'bold'], 'sin duplicados');
  const many = ['shy', 'bold', 'clingy', 'playful', 'dominant', 'caring', 'curious'];
  const clamped = sanitizePersonalityTags(many);
  assert.equal(clamped.length, MAX_PERSONALITY_TAGS);
  assert.deepEqual(clamped, many.slice(0, MAX_PERSONALITY_TAGS));
});

test('personalityTextFromTags: frase legible, no una lista de palabras pegadas', () => {
  assert.equal(personalityTextFromTags([]), '');
  assert.equal(personalityTextFromTags(undefined), '');
  assert.equal(personalityTextFromTags(['shy']), 'Shy.');
  assert.equal(personalityTextFromTags(['shy', 'bold']), 'Shy and bold.');
  assert.equal(personalityTextFromTags(['shy', 'bold', 'caring']), 'Shy, bold, and caring.');
  assert.ok(!personalityTextFromTags(['shy', 'bold', 'caring']).includes(','.repeat(2)));
  // ids desconocidos se descartan antes de armar la frase
  assert.equal(personalityTextFromTags(['shy', 'not-a-tag']), 'Shy.');
});

// ---------- cards/build.js ----------

test('cleanText/normalizeField: recorta espacios sobrantes, respeta el tope, no reescribe el contenido', () => {
  assert.equal(cleanText('  hola   mundo  ', 100), 'hola mundo');
  assert.equal(cleanText('a\n\nb\tc', 100), 'a b c');
  assert.equal(cleanText(42, 100), '');
  assert.equal(cleanText('x'.repeat(50), 10), 'x'.repeat(10));
  assert.equal(cleanText('1234567890  ', 10), '1234567890'); // el recorte de espacios no cuenta contra el tope de contenido
  assert.equal(normalizeField('hola mundo', 100), 'Hola mundo');
  assert.equal(normalizeField('  ya Capitalizado', 100), 'Ya Capitalizado', 'no reescribe el resto del texto');
  assert.equal(normalizeField('', 100), '');
  assert.equal(normalizeField('   ', 100), '');
});

test('buildCharacterCard: con etiquetas, la personalidad se ensambla desde ellas (ignora personalityText)', () => {
  const card = buildCharacterCard({
    name: 'Mia',
    personalityTags: ['shy', 'caring'],
    personalityText: 'esto se ignora',
    description: 'a shy girl who works at a bookstore',
    scenario: 'they meet at closing time',
    firstMes: '*waves shyly* h-hi there',
    mesExample: '<START>\n{{char}}: *smiles* hi',
  });
  assert.equal(card.name, 'Mia');
  assert.equal(card.personality, 'Shy and caring.');
  assert.equal(card.description, 'A shy girl who works at a bookstore');
  assert.equal(card.scenario, 'They meet at closing time');
  assert.equal(card.first_mes, '*waves shyly* h-hi there');
  assert.equal(card.mes_example, '<START> {{char}}: *smiles* hi');
  assert.equal(card.system_prompt, '');
  assert.equal(card.post_history_instructions, '');
  assert.deepEqual(card.alternate_greetings, []);
  assert.equal(card.character_book, null);
});

test('buildCharacterCard: sin etiquetas, usa el texto libre de personalidad tal cual (card importada editada a mano)', () => {
  const card = buildCharacterCard({ name: 'Ani', personalityTags: [], personalityText: '  direct, upbeat  ' });
  assert.equal(card.personality, 'direct, upbeat');
});

test('buildCharacterCard: nombre vacío cae a "Sin nombre" (igual que normCard); topes de cada campo', () => {
  assert.equal(buildCharacterCard({}).name, 'Sin nombre');
  assert.equal(buildCharacterCard({ name: '   ' }).name, 'Sin nombre');
  assert.equal(buildCharacterCard({ name: 'x'.repeat(200) }).name.length, NAME_MAX);
  assert.equal(buildCharacterCard({ description: 'x'.repeat(9999) }).description.length, DESCRIPTION_MAX);
  assert.equal(buildCharacterCard({ scenario: 'x'.repeat(9999) }).scenario.length, SCENARIO_MAX);
  assert.equal(buildCharacterCard({ firstMes: 'x'.repeat(9999) }).first_mes.length, FIRST_MES_MAX);
  assert.equal(buildCharacterCard({ mesExample: 'x'.repeat(9999) }).mes_example.length, MES_EXAMPLE_MAX);
  // CCC-002: "Instrucciones" se guarda en post_history_instructions y respeta el mismo tope real al
  // guardar, aunque el campo de origen haya recibido más texto (pegado o por IME, sin pasar por `maxlength`).
  assert.equal(buildCharacterCard({ instructions: 'x'.repeat(9999) }).post_history_instructions.length, INSTRUCTIONS_MAX);
});

// ---------- CCC-002: "Instrucciones" (post_history_instructions) ----------

test('CCC-002: buildCharacterCard arma "Instrucciones" en post_history_instructions, igual que los demás campos narrativos', () => {
  const card = buildCharacterCard({ name: 'Mia', instructions: '  never breaks character  ' });
  assert.equal(card.post_history_instructions, 'Never breaks character');
});

test('CCC-002: sin "Instrucciones", post_history_instructions queda vacío (el prompt no cambia, ver api/prompt.js)', () => {
  assert.equal(buildCharacterCard({ name: 'Mia' }).post_history_instructions, '');
  assert.equal(buildCharacterCard({ name: 'Mia', instructions: '   ' }).post_history_instructions, '');
});

test('CCC-002 round-trip: una card con "Instrucciones" se reimporta (normCard) bit a bit igual', () => {
  const card = buildCharacterCard({ name: 'Mia', instructions: 'always speaks in third person' });
  const viaImportRoundtrip = normCard({ data: card, spec: 'chara_card_v2' });
  assert.deepEqual(viaImportRoundtrip, card);
});

test('buildCharacterCard: la salida tiene EXACTAMENTE la forma de una Card normalizada (compatible con normCard/chara_card_v2)', () => {
  const card = buildCharacterCard({ name: 'Mia', personalityTags: ['shy'], description: 'd', scenario: 's', firstMes: 'f' });
  const viaImportRoundtrip = normCard({ data: card, spec: 'chara_card_v2' });
  assert.deepEqual(Object.keys(card).sort(), Object.keys(viaImportRoundtrip).sort());
  assert.deepEqual(viaImportRoundtrip, card, 'exportar y reimportar (normCard) da bit a bit lo mismo');
});

// ---------- state.js: formatStyle y personalityTags ----------

test('CCC-001: un personaje guardado antes de este contrato carga con formatStyle "nomi" y personalityTags [] (sin cambio de comportamiento)', async () => {
  const state = createState(memoryBackend());
  await state.saveCharacter(makeChar());
  const c = await state.getCharacter('c1');
  assert.equal(c.formatStyle, 'nomi');
  assert.deepEqual(c.personalityTags, []);
  assert.deepEqual((await state.listCharacters())[0].personalityTags, []);
});

test('CCC-001: formatStyle solo acepta "nomi"/"plain"; cualquier otra cosa cae a "nomi"', async () => {
  const state = createState(memoryBackend());
  for (const bad of [undefined, null, '', 'libre', 'Plain', 42, true]) {
    await state.saveCharacter(makeChar({ formatStyle: bad }));
    assert.equal((await state.getCharacter('c1')).formatStyle, 'nomi');
  }
  await state.saveCharacter(makeChar({ formatStyle: 'plain' }));
  assert.equal((await state.getCharacter('c1')).formatStyle, 'plain');
});

test('CCC-001: personalityTags se sanea igual que en el formulario (ids válidos, sin duplicados, tope 6) y no pisa lorebook ni apariencia', async () => {
  const state = createState(memoryBackend());
  await state.saveCharacter(makeChar({
    personalityTags: ['shy', 'shy', 'not-a-tag', 'bold'],
    lorebook: [{ id: 'l', keys: ['k'], content: 'algo', updated: 1, source: 'manual' }],
  }));
  const c = await state.getCharacter('c1');
  assert.deepEqual(c.personalityTags, ['shy', 'bold']);
  assert.equal(c.lorebook.length, 1);
});

test('UI-031: el editor completo ya no está en el menú del chat ("Ver personaje" se quitó); se llega desde "Editar" en la ficha del personaje', () => {
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chat, /menuItem\('Ver personaje'/, 'el menú ⋮ ya no abre el editor directo');
  const sheet = readFileSync(new URL('../www/js/ui/character-sheet.js', import.meta.url), 'utf8');
  assert.match(sheet, /openCharacterEditor\(app/, 'la ficha sigue abriendo el editor completo desde "Editar"');
});

test('CCC-003: formatStyle NO conecta con formatAssist ni con la reparación de asteriscos (decisión de producto pendiente; ver docs)', () => {
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  const kobold = readFileSync(new URL('../www/js/api/kobold.js', import.meta.url), 'utf8');
  assert.doesNotMatch(chat, /character\.formatStyle/);
  assert.doesNotMatch(kobold, /character\.formatStyle/);
});

// ---------- CCC-003: round-trip de compatibilidad (creador de la rama + MEM-013/014/009 ya en `main`) ----------

test('CCC-003 round-trip: un personaje de `main` (sin campos del creador) abre, edita y guarda sin perder nada', async () => {
  const state = createState(memoryBackend());
  const original = makeChar({
    relationship: { text: 'We are getting to know each other.', level: 'early', updated: 5, source: 'auto' },
    lorebookTombstones: [{ content: 'algo borrado', keys: ['algo'], at: 10 }],
    appearance: { fixed: 'tall, dark hair', current: 'a red dress', updated: 20 },
  });
  await state.saveCharacter(original);
  const loaded = await state.getCharacter('c1');
  // "editar" (como hace character-editor.js: ...source con solo los campos que cambian) y volver a guardar
  await state.saveCharacter({ ...loaded, name: 'Mia (editada)' });
  const after = await state.getCharacter('c1');
  assert.equal(after.name, 'Mia (editada)');
  assert.deepEqual(after.relationship, original.relationship);
  assert.deepEqual(after.lorebookTombstones, original.lorebookTombstones);
  assert.deepEqual(after.appearance, original.appearance);
  assert.equal(after.formatStyle, 'nomi', 'un personaje sin el campo lo recibe con el valor por defecto, no undefined');
  assert.deepEqual(after.personalityTags, []);
});

test('CCC-003 round-trip: un personaje importado (chara_card_v2 puro, sin ningún campo de main ni del creador) carga con todos los valores por defecto y sin perder la card', async () => {
  const state = createState(memoryBackend());
  const imported = { id: 'imp1', name: 'Theo', avatar: '', card: { name: 'Theo', description: 'runs a bookshop' }, created: 1 };
  await state.saveCharacter(imported);
  const loaded = await state.getCharacter('imp1');
  assert.equal(loaded.card.description, 'runs a bookshop');
  assert.equal(loaded.formatStyle, 'nomi');
  assert.deepEqual(loaded.personalityTags, []);
  assert.deepEqual(loaded.lorebookTombstones, []);
  assert.equal(loaded.relationship.level, 'early');
});

// ---------- CCC-004: arquetipos del paso 2 del wizard de creación ----------

test('CCC-004: CHARACTER_ARCHETYPES trae al menos 6 arquetipos, con id único y label/tagline en español', () => {
  assert.ok(CHARACTER_ARCHETYPES.length >= 6);
  const ids = CHARACTER_ARCHETYPES.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, 'sin ids repetidos');
  for (const a of CHARACTER_ARCHETYPES) {
    assert.ok(a.label && a.label.trim(), `${a.id}: label vacío`);
    assert.ok(a.tagline && a.tagline.trim(), `${a.id}: tagline vacío`);
  }
});

test('CCC-004: cada arquetipo respeta los topes reales de cards/build.js (los mismos del creador)', () => {
  for (const a of CHARACTER_ARCHETYPES) {
    assert.ok(a.description.length <= DESCRIPTION_MAX, `${a.id}: description excede DESCRIPTION_MAX`);
    assert.ok(a.scenario.length <= SCENARIO_MAX, `${a.id}: scenario excede SCENARIO_MAX`);
    assert.ok(a.firstMes.length <= FIRST_MES_MAX, `${a.id}: firstMes excede FIRST_MES_MAX`);
    assert.ok(a.mesExample.length <= MES_EXAMPLE_MAX, `${a.id}: mesExample excede MES_EXAMPLE_MAX`);
  }
});

test('CCC-004: las personalityTags de cada arquetipo son todas válidas (sobreviven sanitizePersonalityTags intactas)', () => {
  for (const a of CHARACTER_ARCHETYPES) {
    assert.deepEqual(sanitizePersonalityTags(a.personalityTags), a.personalityTags, `${a.id}: alguna etiqueta no es válida o sobra`);
    assert.ok(a.personalityTags.length > 0 && a.personalityTags.length <= MAX_PERSONALITY_TAGS);
  }
});

test('CCC-004: un arquetipo aplicado produce la MISMA card que si el usuario hubiera escrito esos campos a mano (misma buildCharacterCard)', () => {
  const a = CHARACTER_ARCHETYPES[0];
  const card = buildCharacterCard({
    name: 'Prueba',
    personalityTags: a.personalityTags,
    description: a.description,
    scenario: a.scenario,
    firstMes: a.firstMes,
    mesExample: a.mesExample,
  });
  assert.equal(card.personality, personalityTextFromTags(a.personalityTags));
  assert.equal(card.description, normalizeField(a.description, DESCRIPTION_MAX));
  assert.equal(card.first_mes, normalizeField(a.firstMes, FIRST_MES_MAX));
});

test('CCC-004: crear sigue siendo el wizard y editar sigue siendo la pantalla única (no se tocó el flujo de edición)', () => {
  const src = readFileSync(new URL('../www/js/ui/character-editor.js', import.meta.url), 'utf8');
  assert.match(src, /function renderWizard\(/, 'el flujo de creación arma un wizard');
  assert.match(src, /function renderEditScreen\(/, 'el flujo de edición sigue siendo una pantalla única aparte');
  assert.match(src, /if \(editing\) \{\s*renderEditScreen\(/, 'editing -> pantalla única, no el wizard');
});

test('CCC-003 round-trip: un personaje creado con el creador (formatStyle "plain" + personalityTags) abre, se le edita la apariencia (MEM-009) y se guarda sin perder los campos del creador ni viceversa', async () => {
  const state = createState(memoryBackend());
  const createdByEditor = makeChar({
    formatStyle: 'plain',
    personalityTags: ['shy', 'bold'],
    appearance: { fixed: '', current: '', updated: 0 },
  });
  await state.saveCharacter(createdByEditor);
  const loaded = await state.getCharacter('c1');
  // simula saveCharacterAppearance(): solo toca `appearance`, como en character-look.js
  await state.saveCharacter({ ...loaded, appearance: { fixed: 'short, pink hair', current: '', updated: 99 } });
  const after = await state.getCharacter('c1');
  assert.equal(after.formatStyle, 'plain', 'el campo del creador sobrevive a una edición que no lo toca');
  assert.deepEqual(after.personalityTags, ['shy', 'bold']);
  assert.equal(after.appearance.fixed, 'short, pink hair');
});
