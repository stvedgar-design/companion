// tests/variants.test.mjs — UI-017: varias versiones de una respuesta (datos sintéticos)
import test from 'node:test';
import assert from 'node:assert/strict';
import { addVariant, selectVariant, editActiveText, variantCount, activeVariantIndex, normalizeVariants } from '../www/js/variants.js';
import { createState, sanitizeMessage, sanitizeLoreUsed } from '../www/js/state.js';
import { buildPlainPrompt, buildChatMessages } from '../www/js/api/prompt.js';

const lore = (c) => [{ id: 'l', keys: ['k'], content: c, always: false }];

test('UI-017: un mensaje viejo (sin variants) es una lista de una sola versión y carga igual que siempre', () => {
  const old = { role: 'char', text: 'hola', ts: 1 };
  assert.equal(variantCount(old), 1);
  assert.equal(activeVariantIndex(old), 0);
  assert.deepEqual(sanitizeMessage(old), old);
  const withLore = { role: 'char', text: 'hola', ts: 1, loreUsed: lore('Sam bebe té.') };
  assert.deepEqual(sanitizeMessage(withLore), withLore);
  assert.equal(selectVariant(old, 1), old);
});

test('UI-017: regenerar AGREGA una variante (no borra la anterior) y la nueva queda activa', () => {
  let m = { role: 'char', text: 'uno', ts: 1, loreUsed: lore('A') };
  m = addVariant(m, { text: 'dos', loreUsed: [], ts: 5 });
  assert.equal(variantCount(m), 2);
  assert.equal(activeVariantIndex(m), 1);
  assert.equal(m.text, 'dos');
  assert.deepEqual(m.loreUsed, []);
  assert.equal(m.ts, 5);
  assert.deepEqual(m.variants, [{ text: 'uno', loreUsed: lore('A') }, { text: 'dos', loreUsed: [] }]);
  m = addVariant(m, { text: 'tres' }); // sin dato de memoria
  assert.equal(variantCount(m), 3);
  assert.equal(activeVariantIndex(m), 2);
  assert.equal('loreUsed' in m, false);
  assert.deepEqual(m.variants.map((v) => v.text), ['uno', 'dos', 'tres']);
});

test('UI-017: navegar cambia cuál es la activa; text y loreUsed siguen a la versión (el marcapáginas es por variante)', () => {
  let m = addVariant(addVariant({ role: 'char', text: 'uno', ts: 1, loreUsed: lore('A') }, { text: 'dos', loreUsed: [] }), { text: 'tres' });
  m = selectVariant(m, 0);
  assert.equal(m.text, 'uno');
  assert.deepEqual(m.loreUsed, lore('A'));
  assert.equal(activeVariantIndex(m), 0);
  m = selectVariant(m, 1);
  assert.equal(m.text, 'dos');
  assert.deepEqual(m.loreUsed, []);
  m = selectVariant(m, 2);
  assert.equal(m.text, 'tres');
  assert.equal('loreUsed' in m, false);
  assert.equal(selectVariant(m, 9), m);
  assert.equal(selectVariant(m, -1), m);
  assert.deepEqual(m.variants.map((v) => v.text), ['uno', 'dos', 'tres']); // ninguna se perdió
});

test('UI-017: editar cambia solo la versión activa', () => {
  let m = addVariant({ role: 'char', text: 'uno', ts: 1 }, { text: 'dos' });
  m = selectVariant(m, 0);
  m = editActiveText(m, 'uno editado');
  assert.equal(m.text, 'uno editado');
  assert.deepEqual(m.variants.map((v) => v.text), ['uno editado', 'dos']);
  assert.equal(editActiveText({ role: 'char', text: 'a', ts: 1 }, 'b').text, 'b');
});

test('UI-017: la versión activa es la que cuenta para el historial que se envía al modelo (texto simple y plantilla)', () => {
  const card = { name: 'Luna', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
  const settings = { url: 'http://x', user: 'Sam', maxLen: 200, temp: 0.8, mode: 'plain', ctx: 4096 };
  let m = addVariant({ role: 'char', text: 'RESPUESTA-UNO', ts: 2 }, { text: 'RESPUESTA-DOS' });
  m = selectVariant(m, 0); // el usuario vuelve a la primera
  const msgs = [{ role: 'user', text: 'hola', ts: 1 }, m, { role: 'user', text: 'sigue', ts: 3 }];
  const plain = JSON.stringify(buildPlainPrompt(card, msgs, settings));
  assert.ok(plain.includes('RESPUESTA-UNO'));
  assert.ok(!plain.includes('RESPUESTA-DOS'));
  const chat = buildChatMessages(card, msgs, { ...settings, mode: 'chat' });
  const all = JSON.stringify(chat.messages);
  assert.ok(all.includes('RESPUESTA-UNO'));
  assert.ok(!all.includes('RESPUESTA-DOS'));
});

test('UI-017: normalizeVariants — basura o listas cortas se descartan sin tocar el texto visible', () => {
  const base = { role: 'char', text: 'visible', ts: 1 };
  assert.deepEqual(normalizeVariants({ ...base, variants: 'x', activeVariant: 1 }, sanitizeLoreUsed), base);
  assert.deepEqual(normalizeVariants({ ...base, variants: [{ text: 'solo una' }], activeVariant: 0 }, sanitizeLoreUsed), base);
  assert.deepEqual(normalizeVariants({ ...base, variants: [null, 3, { text: '' }] }, sanitizeLoreUsed), base);
  assert.deepEqual(normalizeVariants({ role: 'user', text: 'u', ts: 1, variants: [{ text: 'a' }, { text: 'b' }] }, sanitizeLoreUsed), { role: 'user', text: 'u', ts: 1 });
});

test('UI-017: normalizeVariants — si text y la versión activa no coinciden, manda text; índices raros se reubican', () => {
  const a = normalizeVariants({ role: 'char', text: 'editado', ts: 1, variants: [{ text: 'uno' }, { text: 'dos' }], activeVariant: 1 }, sanitizeLoreUsed);
  assert.deepEqual(a.variants.map((v) => v.text), ['uno', 'editado']);
  assert.equal(a.activeVariant, 1);
  const b = normalizeVariants({ role: 'char', text: 'dos', ts: 1, variants: [{ text: 'uno' }, { text: 'dos' }], activeVariant: 99 }, sanitizeLoreUsed);
  assert.equal(b.activeVariant, 1);
  const c = normalizeVariants({ role: 'char', text: 'tres', ts: 1, variants: [{ text: 'uno' }, null, { text: 'tres' }], activeVariant: 2 }, sanitizeLoreUsed);
  assert.deepEqual(c.variants.map((v) => v.text), ['uno', 'tres']);
  assert.equal(c.activeVariant, 1); // se descartó una entrada: se reubicó por texto
  const d = normalizeVariants({ role: 'char', text: 'a', ts: 1, loreUsed: lore('X'), variants: [{ text: 'a', loreUsed: 'basura' }, { text: 'b' }], activeVariant: 0 }, sanitizeLoreUsed);
  assert.deepEqual(d.variants[0], { text: 'a', loreUsed: lore('X') }); // el dato del mensaje manda sobre el de la copia
  assert.equal('loreUsed' in d.variants[1], false);
});

function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(s, k) { return stores[s].get(k); },
    async getAll(s) { return Array.from(stores[s].values()); },
    async put(s, k, v) { stores[s].set(k, v); },
    async remove(s, k) { stores[s].delete(k); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
    _raw: stores,
  };
}

test('UI-017: las variantes se guardan y se leen; la copia de seguridad v2 las exporta TODAS y las importa; una copia sin variantes sigue importando', async () => {
  const state = createState(memoryBackend());
  await state.saveCharacter({ id: 'x', name: 'Mia', avatar: '', card: { name: 'Mia' }, created: 1, updated: 1, last: '', lorebook: [] });
  const chat = await state.createChat('x', {});
  const withVariants = selectVariant(addVariant({ role: 'char', text: 'uno', ts: 2 }, { text: 'dos', loreUsed: lore('B') }), 0);
  await state.saveChatMessages(chat.id, [{ role: 'user', text: 'hola', ts: 1 }, withVariants, { role: 'char', text: 'vieja', ts: 3 }]);
  const back = await state.getChatMessages(chat.id);
  assert.deepEqual(back[1], withVariants);
  assert.deepEqual(back[2], { role: 'char', text: 'vieja', ts: 3 });

  const blob = await state.exportBackup();
  const data = JSON.parse(await blob.text());
  assert.equal(data.version, 2);
  assert.equal(data.chatMessages[chat.id][1].variants.length, 2);

  const other = createState(memoryBackend());
  await other.importBackup({ text: async () => JSON.stringify(data) });
  const restored = await other.getChatMessages(chat.id);
  assert.deepEqual(restored, back);

  // copia hecha antes de UI-017 (sin variants): importa y se ve igual
  const legacy = JSON.parse(JSON.stringify(data));
  legacy.chatMessages[chat.id] = [{ role: 'user', text: 'hola', ts: 1 }, { role: 'char', text: 'una sola', ts: 2 }];
  const third = createState(memoryBackend());
  await third.importBackup({ text: async () => JSON.stringify(legacy) });
  assert.deepEqual(await third.getChatMessages(chat.id), legacy.chatMessages[chat.id]);
});
