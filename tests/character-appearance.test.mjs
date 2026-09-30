// tests/character-appearance.test.mjs — MEM-009: ficha de apariencia del personaje (independiente de la character card)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createState } from '../www/js/state.js';
import {
  APPEARANCE_FIXED_MAX,
  APPEARANCE_CURRENT_MAX,
  emptyAppearance,
  sanitizeAppearance,
  isAppearanceEmpty,
  appearanceOf,
} from '../www/js/character-appearance.js';
import {
  buildPlainPrompt,
  buildChatMessages,
  estimateContextUsage,
  historyStartIndex,
  formatAppearanceFixed,
  formatAppearanceCurrent,
  appearanceEndChars,
} from '../www/js/api/prompt.js';
import { buildContinuationRequest } from '../www/js/api/continuity.js';

function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(s, k) { return stores[s].get(k); },
    async getAll(s) { return Array.from(stores[s].values()); },
    async put(s, k, v) { stores[s].set(k, v); },
    async remove(s, k) { stores[s].delete(k); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
    _stores: stores,
  };
}

// Tres personajes sintéticos: dos con formato de asteriscos (estilo Mia/Theo) y uno sin asteriscos ni comillas (estilo Ani).
const CARDS = {
  Mia: { name: 'Mia', description: '{{char}} is shy and kind.', personality: 'shy', scenario: '', mes_example: '<START>\n{{char}}: *Blushes.* H-hi.', first_mes: '*Waves.* Hi.', system_prompt: '', post_history_instructions: '' },
  Theo: { name: 'Theo', description: '{{char}} is calm.', personality: 'calm', scenario: '', mes_example: '', first_mes: '*Nods.* Hey.', system_prompt: 'Keep replies short.', post_history_instructions: '' },
  Ani: { name: 'Ani', description: 'Ani talks plainly and never uses asterisks.', personality: 'direct', scenario: '', mes_example: '{{char}}: Hey, how was your day', first_mes: 'Hey, how was your day', system_prompt: '', post_history_instructions: '' },
};
const MSGS = [
  { role: 'char', text: 'Hi there.', ts: 1 },
  { role: 'user', text: 'Hello, what do you look like?', ts: 2 },
];
const SETTINGS = { user: 'Sam', mode: 'chat', ctx: 4096, maxLen: 220 };
const PLAIN = { ...SETTINGS, mode: 'plain' };
const APP = { fixed: 'short and slim, pink hair, violet eyes', current: 'a white hoodie and jeans' };

test('sanitizeAppearance: valores por defecto, topes, una sola línea y basura → ficha vacía', () => {
  assert.deepEqual(emptyAppearance(), { fixed: '', current: '', updated: 0 });
  for (const bad of [undefined, null, 'x', 3, [], true]) assert.deepEqual(sanitizeAppearance(bad), emptyAppearance());
  const long = sanitizeAppearance({ fixed: 'a'.repeat(500), current: 'b '.repeat(200), updated: 5 });
  assert.equal(long.fixed.length, APPEARANCE_FIXED_MAX);
  assert.ok(long.current.length <= APPEARANCE_CURRENT_MAX);
  assert.equal(sanitizeAppearance({ fixed: '  pelo\n\n rosa \t ojos  ', current: 3, updated: 'x' }).fixed, 'pelo rosa ojos');
  assert.equal(sanitizeAppearance({ fixed: 'x', current: 3, updated: 'x' }).current, '');
  assert.equal(sanitizeAppearance({ fixed: 'x', updated: 'x' }).updated, 0);
  assert.equal(sanitizeAppearance({ fixed: 'x', updated: 99 }).updated, 99);
  assert.equal(sanitizeAppearance({ fixed: '  ', current: '', updated: 99 }).updated, 0, 'sin texto no hay fecha');
  assert.equal(APPEARANCE_FIXED_MAX, 200);
  assert.equal(APPEARANCE_CURRENT_MAX, 100);
  assert.equal(isAppearanceEmpty(undefined), true);
  assert.equal(isAppearanceEmpty({ current: 'x' }), false);
  assert.equal(appearanceOf({}), null);
  assert.equal(appearanceOf({ appearance: { fixed: '', current: '' } }), null);
  assert.deepEqual(appearanceOf({ appearance: { fixed: 'a', current: '' } }), { fixed: 'a', current: '' });
});

for (const [name, card] of Object.entries(CARDS)) {
  test(`MEM-009 (${name}): sin apariencia definida el prompt es IDÉNTICO al de antes (modo plantilla y texto simple)`, () => {
    for (const extras of [undefined, {}, { appearance: undefined }, { appearance: null }, { appearance: { fixed: '', current: '' } }, { appearance: { fixed: '   ' } }]) {
      assert.deepEqual(buildChatMessages(card, MSGS, SETTINGS, '', '', '', '', false, extras), buildChatMessages(card, MSGS, SETTINGS, '', '', '', '', false, undefined));
      assert.deepEqual(buildPlainPrompt(card, MSGS, PLAIN, '', '', '', '', false, extras), buildPlainPrompt(card, MSGS, PLAIN, '', '', '', '', false, undefined));
    }
    const all = JSON.stringify(buildChatMessages(card, MSGS, SETTINGS)) + buildPlainPrompt(card, MSGS, PLAIN).prompt;
    assert.ok(!/'s appearance:|look right now/.test(all), 'no aparece ninguna etiqueta vacía');
  });

  test(`MEM-009 (${name}): plantilla — los rasgos fijos van en la CABECERA (system) y la ropa actual al FINAL (último mensaje del usuario)`, () => {
    const { messages } = buildChatMessages(card, MSGS, SETTINGS, '', '', 'Known facts:\n- tema', '', false, { appearance: APP });
    assert.equal(messages[0].role, 'system');
    assert.ok(messages[0].content.includes(`${name}'s appearance: short and slim, pink hair, violet eyes`));
    assert.ok(!messages[0].content.includes('white hoodie'), 'la ropa actual NO va en la cabecera');
    const last = messages[messages.length - 1];
    assert.equal(last.role, 'user');
    assert.ok(last.content.includes(`[${name}'s look right now: a white hoodie and jeans]`));
    assert.ok(!last.content.includes('pink hair'), 'los rasgos fijos NO van al final');
    // orden del bloque final: apariencia actual antes del "por tema"
    assert.ok(last.content.indexOf('look right now') < last.content.indexOf('Known facts'));
    // el mensaje guardado no se toca
    assert.equal(MSGS[1].text, 'Hello, what do you look like?');
  });

  test(`MEM-009 (${name}): texto simple — cabecera antes de [Start of chat]; ropa actual justo antes de la última línea del usuario`, () => {
    const { prompt } = buildPlainPrompt(card, MSGS, PLAIN, '', '', 'Known facts:\n- tema', '', false, { appearance: APP });
    const start = prompt.indexOf('[Start of chat]');
    assert.ok(prompt.indexOf(`${name}'s appearance: short and slim`) > -1 && prompt.indexOf(`${name}'s appearance: short and slim`) < start);
    assert.ok(prompt.indexOf('look right now') > start);
    assert.ok(prompt.indexOf('look right now') < prompt.indexOf('Sam: Hello, what do you look like?'));
    assert.ok(prompt.indexOf('look right now') < prompt.indexOf('Known facts'));
  });
}

test('MEM-009: solo `fixed` o solo `current`: cada uno en su sitio y nada más; junto a la relación y los "siempre presentes"', () => {
  const only = (a) => buildChatMessages(CARDS.Mia, MSGS, SETTINGS, '', 'Known facts:\n- Sam likes tea', '', '', false, { relationship: 'several', appearance: a }).messages;
  const f = only({ fixed: 'tall' });
  assert.ok(f[0].content.includes("Mia's appearance: tall"));
  assert.ok(!f[f.length - 1].content.includes('look right now'));
  const c = only({ current: 'a red scarf' });
  assert.ok(!c[0].content.includes('appearance:'));
  assert.ok(c[c.length - 1].content.includes("[Mia's look right now: a red scarf]"));
  // en la cabecera queda entre la relación y los recuerdos "siempre presentes"
  const head = only({ fixed: 'tall' })[0].content;
  assert.ok(head.indexOf('Relationship so far:') < head.indexOf("Mia's appearance:"));
  assert.ok(head.indexOf("Mia's appearance:") < head.indexOf('Known facts:'));
});

test('MEM-009: las macros {{char}}/{{user}} del texto se resuelven; el texto se aplana a una línea', () => {
  assert.equal(formatAppearanceFixed('{{char}} is taller than {{user}}', 'Mia', 'Sam'), "Mia's appearance: Mia is taller than Sam");
  assert.equal(formatAppearanceCurrent('  a\n hat ', 'Mia', 'Sam'), "Mia's look right now: a hat");
  assert.equal(formatAppearanceFixed('', 'Mia', 'Sam'), '');
  assert.equal(formatAppearanceCurrent(undefined, 'Mia', 'Sam'), '');
});

test('MEM-009: la cabecera con `fixed` no cambia si solo cambia `current` (la ropa no invalida la caché de la cabecera)', () => {
  const head = (a) => buildChatMessages(CARDS.Theo, MSGS, SETTINGS, '', '', '', '', false, { appearance: a }).messages[0].content;
  assert.equal(head({ fixed: 'tall', current: 'a coat' }), head({ fixed: 'tall', current: 'a swimsuit' }));
  assert.notEqual(head({ fixed: 'tall' }), head({ fixed: 'short' }));
  const headPlain = (a) => buildPlainPrompt(CARDS.Theo, MSGS, PLAIN, '', '', '', '', false, { appearance: a }).prompt.split('[Start of chat]')[0];
  assert.equal(headPlain({ fixed: 'tall', current: 'a coat' }), headPlain({ fixed: 'tall', current: 'a swimsuit' }));
});

test('MEM-009: el contexto cuenta la ficha (estimación, ventana y disparo del resumen usan la misma cuenta que el prompt)', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: 'word '.repeat(60), ts: i + 1 }));
  const base = estimateContextUsage(CARDS.Mia, many, SETTINGS);
  const withApp = estimateContextUsage(CARDS.Mia, many, SETTINGS, '', '', 0, { appearance: APP });
  assert.ok(withApp.approxTokens > base.approxTokens);
  assert.ok(appearanceEndChars(APP, 'Mia', 'Sam') > 0);
  assert.equal(appearanceEndChars({ fixed: 'x' }, 'Mia', 'Sam'), 0);
  assert.equal(appearanceEndChars(null, 'Mia', 'Sam'), 0);
  // más reserva → la ventana puede empezar más tarde (nunca antes)
  for (const settings of [SETTINGS, PLAIN]) {
    const a = historyStartIndex(CARDS.Mia, many, settings, '', '', 0, 0, '', null);
    const b = historyStartIndex(CARDS.Mia, many, settings, '', '', 0, 0, '', { fixed: 'f'.repeat(200), current: 'c'.repeat(100) });
    assert.ok(b >= a);
  }
  // y coincide con lo que realmente envía el prompt (mismo recorte)
  const built = buildChatMessages(CARDS.Mia, many, SETTINGS, '', '', '', '', false, { appearance: APP }).messages.filter((m) => m.role !== 'system' && m.content !== '[Start of roleplay]').length;
  assert.equal(many.length - historyStartIndex(CARDS.Mia, many, SETTINGS, '', '', 0, 0, '', APP), built);
});

test('MEM-009: la petición de resumen lleva la MISMA cabecera que el chat (incluye los rasgos fijos) y ninguna ropa actual', () => {
  const character = { card: CARDS.Mia, lorebook: [], appearance: { ...APP, updated: 1 } };
  const ctx = { character, chat: { scenario: '' }, messages: MSGS, settings: SETTINGS };
  const req = buildContinuationRequest(ctx, '[Task]');
  const chatHead = buildChatMessages(CARDS.Mia, MSGS, SETTINGS, '', '', '', '', false, { appearance: { fixed: APP.fixed }, relationship: { level: 'early' } }).messages[0].content;
  assert.equal(req.messages[0].content, chatHead);
  assert.ok(!JSON.stringify(req.messages).includes('look right now'));
  const bare = buildContinuationRequest({ ...ctx, character: { card: CARDS.Mia, lorebook: [] } }, '[Task]');
  assert.ok(!bare.messages[0].content.includes('appearance:'));
});

// ---------- almacenamiento ----------

const makeChar = (extra = {}) => ({ id: 'c1', name: 'Mia', avatar: '', card: { name: 'Mia' }, created: 1, ...extra });

test('MEM-009: un personaje guardado sin el campo carga con la ficha por defecto (vacía)', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', makeChar({ lorebook: [{ id: 'l', keys: ['k'], content: 'algo', updated: 1, source: 'manual' }] }));
  const c = await state.getCharacter('c1');
  assert.deepEqual(c.appearance, { fixed: '', current: '', updated: 0 });
  assert.equal(c.lorebook.length, 1, 'no se pierde nada más');
  assert.deepEqual((await state.listCharacters())[0].appearance, emptyAppearance());
});

test('MEM-009: saveCharacterAppearance guarda solo la ficha (no pisa lorebook ni fondo), respeta topes y pone la fecha', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await state.saveCharacter(makeChar({ chatBackground: 'data:x', lorebook: [{ id: 'l', keys: ['k'], content: 'algo', updated: 1, source: 'manual' }] }));
  const t0 = Date.now();
  const saved = await state.saveCharacterAppearance('c1', { fixed: 'x'.repeat(400), current: '  a hat  ' });
  assert.equal(saved.appearance.fixed.length, APPEARANCE_FIXED_MAX);
  assert.equal(saved.appearance.current, 'a hat');
  assert.ok(saved.appearance.updated >= t0);
  const reread = await state.getCharacter('c1');
  assert.deepEqual(reread.appearance, saved.appearance);
  assert.equal(reread.chatBackground, 'data:x');
  assert.equal(reread.lorebook.length, 1);
  // un parche parcial conserva el otro campo; sin cambios no mueve la fecha
  const partial = await state.saveCharacterAppearance('c1', { current: 'a scarf' });
  assert.equal(partial.appearance.fixed.length, APPEARANCE_FIXED_MAX);
  assert.equal(partial.appearance.current, 'a scarf');
  const same = await state.saveCharacterAppearance('c1', { current: 'a scarf' });
  assert.equal(same.appearance.updated, partial.appearance.updated);
  // borrar todo deja la ficha vacía
  const cleared = await state.saveCharacterAppearance('c1', { fixed: '', current: '' });
  assert.deepEqual(cleared.appearance, emptyAppearance());
  await assert.rejects(() => state.saveCharacterAppearance('nope', { fixed: 'x' }));
});

test('MEM-009: una ficha corrupta en disco se sanea al leer (no rompe el prompt)', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', makeChar({ appearance: { fixed: 42, current: { a: 1 }, updated: 'ayer' } }));
  assert.deepEqual((await state.getCharacter('c1')).appearance, emptyAppearance());
});

test('MEM-009: la copia de seguridad v2 incluye la ficha; una copia vieja (sin el campo) sigue importando con el valor por defecto', async () => {
  const src = memoryBackend();
  const a = createState(src);
  await a.saveCharacter(makeChar());
  await a.saveCharacterAppearance('c1', { fixed: 'pink hair', current: 'a hoodie' });
  const blob = await a.exportBackup();
  const text = await blob.text();
  const parsed = JSON.parse(text);
  assert.equal(parsed.version, 2);
  assert.equal(parsed.characters[0].appearance.fixed, 'pink hair');
  // ida y vuelta
  const dst = createState(memoryBackend());
  await dst.importBackup({ text: async () => text });
  const restored = await dst.getCharacter('c1');
  assert.equal(restored.appearance.fixed, 'pink hair');
  assert.equal(restored.appearance.current, 'a hoodie');
  // copia vieja: sin el campo
  const old = { ...parsed, characters: parsed.characters.map(({ appearance, ...rest }) => rest) };
  const dst2 = createState(memoryBackend());
  await dst2.importBackup({ text: async () => JSON.stringify(old) });
  assert.deepEqual((await dst2.getCharacter('c1')).appearance, emptyAppearance());
});

test('MEM-009: kobold.js pasa la ficha del personaje a los prompts; la hoja de edición existe y el menú del chat la ofrece', () => {
  const kobold = readFileSync(new URL('../www/js/api/kobold.js', import.meta.url), 'utf8');
  assert.match(kobold, /appearanceOf\(character\)/);
  assert.match(kobold, /\.\.\.\(appearance \? \{ appearance \} : \{\}\)/);
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /menuItem\('Apariencia del personaje'/);
  const sheet = readFileSync(new URL('../www/js/ui/character-look.js', import.meta.url), 'utf8');
  assert.match(sheet, /saveCharacterAppearance/);
  assert.ok(!/chara_card_v2|\.card\./.test(sheet), 'la ficha no toca la card');
});
