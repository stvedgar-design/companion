// tests/user-appearance.test.mjs — MEM-020: "Tu apariencia" (Settings.userAppearance) en la cabecera de todo prompt, y retirada de
// los recuerdos "siempre presentes".
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createState } from '../www/js/state.js';
import { USER_APPEARANCE_MAX, sanitizeUserAppearance } from '../www/js/user-appearance.js';
import {
  buildPlainPrompt, buildChatMessages, estimateContextUsage, historyStartIndex, formatUserAppearance,
} from '../www/js/api/prompt.js';
import { generateReply } from '../www/js/api/kobold.js';
import { buildContinuationRequest, planForContext } from '../www/js/api/continuity.js';
import { buildRelationshipRequest } from '../www/js/api/relationship.js';
import { buildFeelingRequest } from '../www/js/api/feeling.js';

const TAGS = 'man, short dark hair, green eyes, glasses';

const card = (extra = {}) => ({
  name: 'Luna', description: 'Una guardiana.', personality: 'Curiosa', scenario: 'Una torre', first_mes: '', mes_example: '',
  system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null, ...extra,
});
const character = (extra = {}) => ({ id: 'c1', name: 'Luna', avatar: '', card: card(), created: 1, lorebook: [], ...extra });
const settings = (extra = {}) => ({ url: 'http://x', user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'chat', ctx: 4096, ...extra });
const MSGS = [{ role: 'char', text: 'Hola.', ts: 1 }, { role: 'user', text: 'Hola Luna', ts: 2 }];

// ---------- el módulo puro ----------

test('MEM-020: sanitizeUserAppearance — una línea, espacios colapsados, tope de 300; lo que no es texto da vacío', () => {
  assert.equal(USER_APPEARANCE_MAX, 300);
  assert.equal(sanitizeUserAppearance('  man,\n short   hair\t'), 'man, short hair');
  assert.equal(sanitizeUserAppearance('x'.repeat(500)).length, 300);
  assert.equal(sanitizeUserAppearance(('abcd ').repeat(100)).length <= 300, true);
  for (const bad of [undefined, null, 5, {}, [], true]) assert.equal(sanitizeUserAppearance(bad), '', String(bad));
});

// ---------- el prompt ----------

// Salida EXACTA del código anterior a MEM-020 (capturada de git HEAD) para este fixture: con el campo vacío nada cambia.
const GOLDEN_EXTRAS = { relationship: { level: 'growing', text: 'We shared a lot.' }, appearance: { fixed: 'tall', current: 'a scarf' } };
const GOLDEN_PLAIN =
  "Roleplay chat between Luna and Edgar. Stay in character as Luna. Write only Luna's next reply, using *asterisks* for actions and plain text for speech. Luna's replies always include Luna's own spoken words, and Luna's feelings come through mostly in what Luna says.\n\nLuna's description:\nUna guardiana.\n\nLuna's personality: Curiosa\n\nScenario: Una torre\n\nRelationship so far: We shared a lot.\n\nLuna's appearance: tall\n\n[Start of chat]\nLuna: Hola.\n[Luna's look right now: a scarf]\n[Known facts (from memory):\n- x]\nEdgar: Hola Luna\nLuna:";
const GOLDEN_CHAT_HEAD =
  "Roleplay chat between Luna and Edgar. Stay in character as Luna. Write only Luna's next reply, using *asterisks* for actions and plain text for speech. Luna's replies always include Luna's own spoken words, and Luna's feelings come through mostly in what Luna says.\n\nLuna's description:\nUna guardiana.\n\nLuna's personality: Curiosa\n\nScenario: Una torre\n\nRelationship so far: We shared a lot.\n\nLuna's appearance: tall";
const GOLDEN_CHAT_LAST = "[Luna's look right now: a scarf]\n[Known facts (from memory):\n- x]\n\nHola Luna";

test('MEM-020: con el campo vacío (o ausente) el prompt es idéntico byte a byte al de antes, en modo texto simple y en plantilla', () => {
  for (const userAppearance of [undefined, '', '   ', '\n\t ']) {
    const extra = userAppearance === undefined ? {} : { userAppearance };
    const plain = buildPlainPrompt(card(), MSGS, settings({ mode: 'plain', ...extra }), '', '', 'Known facts (from memory):\n- x', '', false, GOLDEN_EXTRAS).prompt;
    assert.equal(plain, GOLDEN_PLAIN);
    const chat = buildChatMessages(card(), MSGS, settings({ mode: 'chat', ...extra }), '', '', 'Known facts (from memory):\n- x', '', false, GOLDEN_EXTRAS).messages;
    assert.equal(chat[0].content, GOLDEN_CHAT_HEAD);
    assert.equal(chat[chat.length - 1].content, GOLDEN_CHAT_LAST);
  }
});

test('MEM-020: con el campo lleno la línea es «{Usuario}\'s appearance: …», después de la apariencia del personaje y antes del ejemplo de diálogo', () => {
  const st = (mode) => settings({ mode, userAppearance: TAGS });
  const c = card({ mes_example: '{{char}}: Hola\n<START>' });
  const plain = buildPlainPrompt(c, MSGS, st('plain'), '', '', '', '', false, GOLDEN_EXTRAS).prompt;
  assert.ok(plain.includes(`Luna's appearance: tall\n\nEdgar's appearance: ${TAGS}\n\nExample dialogue:`));
  assert.ok(plain.indexOf("Edgar's appearance:") < plain.indexOf('[Start of chat]'));
  const head = buildChatMessages(c, MSGS, st('chat'), '', '', '', '', false, GOLDEN_EXTRAS).messages[0].content;
  assert.ok(head.includes(`Luna's appearance: tall\n\nEdgar's appearance: ${TAGS}\n\nExample dialogue:`));
  // sin apariencia del personaje, queda justo tras la relación
  const bare = buildChatMessages(card(), MSGS, st('chat'), '', '', '', '', false, { relationship: GOLDEN_EXTRAS.relationship }).messages[0].content;
  assert.ok(bare.endsWith(`Relationship so far: We shared a lot.\n\nEdgar's appearance: ${TAGS}`));
  // ni en la ropa final ni en los mensajes: solo cabecera
  const chat = buildChatMessages(c, MSGS, st('chat'), '', '', 'T', '', false, GOLDEN_EXTRAS).messages;
  assert.ok(!chat.slice(1).some((m) => m.content.includes("Edgar's appearance")));
});

test('MEM-020: sin nombre de usuario la línea usa "User"; las macros {{user}}/{{char}} se resuelven; una sola línea; tope de 300', () => {
  assert.equal(formatUserAppearance(TAGS, 'Luna', 'User'), `User's appearance: ${TAGS}`);
  assert.equal(formatUserAppearance('', 'Luna', 'Edgar'), '');
  assert.equal(formatUserAppearance(undefined, 'Luna', 'Edgar'), '');
  assert.equal(formatUserAppearance('{{user}} is taller than {{char}}', 'Luna', 'Edgar'), "Edgar's appearance: Edgar is taller than Luna");
  assert.equal(formatUserAppearance('man,\n\n glasses', 'Luna', 'Edgar'), "Edgar's appearance: man, glasses");

  const noName = buildChatMessages(card(), MSGS, settings({ user: '', userAppearance: TAGS }), '', '', '', '', false, {}).messages[0].content;
  assert.ok(noName.endsWith(`User's appearance: ${TAGS}`));

  const long = 'a'.repeat(450);
  const head = buildChatMessages(card(), MSGS, settings({ userAppearance: long }), '', '', '', '', false, {}).messages[0].content;
  const line = head.split('\n\n').pop();
  assert.equal(line, `Edgar's appearance: ${'a'.repeat(300)}`);
  assert.ok(!line.includes('\n'));
});

test('MEM-020: el parámetro obsoleto loreBlock ya no llega a la cabecera y la caché del prompt sigue siendo estable', () => {
  const a = buildChatMessages(card(), MSGS, settings({ userAppearance: TAGS }), '', '', 'uno', '', false, GOLDEN_EXTRAS).messages[0].content;
  const b = buildChatMessages(card(), [{ role: 'user', text: 'otro texto', ts: 5 }], settings({ userAppearance: TAGS }), '', '', 'dos', 'nota', true, GOLDEN_EXTRAS).messages[0].content;
  assert.equal(a, b); // la cabecera no depende de los mensajes ni del bloque por tema
});

// ---------- la MISMA cabecera en toda petición que continúa el prefijo del chat ----------

async function captureChatHeader(mode, st, char) {
  let body = null;
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const ch of req) chunks.push(ch);
    if (req.method === 'POST') body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    if (req.url === '/api/v1/model' || req.url === '/api/extra/true_max_context_length') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ result: 'm', value: 8192 }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (req.url === '/v1/chat/completions') res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
    else res.write('data: {"token":"Hola"}\n\n');
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    await generateReply({ character: char, messages: MSGS, settings: { ...st, url, mode } });
  } finally {
    server.close();
  }
  return mode === 'chat' ? body.messages[0].content : body.prompt.slice(0, body.prompt.indexOf('[Start of chat]'));
}

test('MEM-020: la cabecera con el campo lleno es IDÉNTICA en el chat, la continuidad, la relación y el sentimiento (ambos modos)', async () => {
  const char = character({
    appearance: { fixed: 'tall', current: '', updated: 1 },
    lorebook: [{ id: 'm', keys: ['playa'], content: 'Fueron a la playa.', updated: 1, source: 'manual' }],
  });
  const chat = { id: 'ch', scenario: '' };
  for (const mode of ['chat', 'plain']) {
    const st = settings({ mode, userAppearance: TAGS });
    const ctx = { character: char, chat, messages: MSGS, settings: st };
    const real = await captureChatHeader(mode, st, char);
    assert.ok(real.includes(`Edgar's appearance: ${TAGS}`), `${mode}: el chat real lleva la línea`);
    const headOf = (req) => (req.mode === 'chat' ? req.messages[0].content : req.prompt.slice(0, req.prompt.indexOf('[Start of chat]')));
    const cont = headOf(buildContinuationRequest(ctx, 'Recap.'));
    const rel = headOf(buildRelationshipRequest(ctx, 'Rel.'));
    const feel = headOf(buildFeelingRequest(ctx, 'Feel.'));
    assert.equal(cont, real, `${mode}: continuidad`);
    assert.equal(rel, real, `${mode}: relación`);
    assert.equal(feel, real, `${mode}: sentimiento`);
    // y al vaciar el campo, las cuatro vuelven a coincidir entre sí SIN la línea
    const empty = { ...ctx, settings: { ...st, userAppearance: '' } };
    for (const req of [buildContinuationRequest(empty, 'x'), buildRelationshipRequest(empty, 'x'), buildFeelingRequest(empty, 'x')]) {
      assert.ok(!headOf(req).includes('appearance: man'));
    }
  }
});

// ---------- el presupuesto de contexto ----------

test('MEM-020: el campo cuenta en estimateContextUsage, historyStartIndex y planForContext', () => {
  const many = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `#${i}# ` + 'palabra '.repeat(10), ts: i }));
  const base = settings({ ctx: 1024, maxLen: 200 });
  const full = { ...base, userAppearance: 'x'.repeat(300) };
  const without = estimateContextUsage(card(), many, base);
  const withIt = estimateContextUsage(card(), many, full);
  assert.ok(withIt.approxTokens > without.approxTokens);
  assert.ok(withIt.approxTokens - without.approxTokens >= Math.floor(300 / 3.3));
  for (const mode of ['chat', 'plain']) {
    const a = historyStartIndex(card(), many, { ...base, mode });
    const b = historyStartIndex(card(), many, { ...full, mode });
    assert.ok(b > a, `${mode}: con el campo lleno entran menos mensajes (${a} → ${b})`);
    // y coincide con lo que de verdad se envía
    const sent = mode === 'chat'
      ? buildChatMessages(card(), many, { ...full, mode }).messages.filter((m) => m.content !== '[Start of roleplay]').length - 1
      : buildPlainPrompt(card(), many, { ...full, mode }).prompt.split('\n').filter((l) => /^#\d+#/.test(l.replace(/^[^:]+: /, ''))).length;
    assert.equal(many.length - b, sent, mode);
  }
  // planForContext usa la misma cuenta (la ventana real del prompt): con el campo lleno el resumen tiene que cubrir más mensajes
  const ctx = (st) => ({ character: character(), chat: { id: 'c', scenario: '', continuitySummary: { text: '', coveredUntil: 0 } }, messages: many, settings: st });
  const planA = planForContext(ctx({ ...base, mode: 'chat' }), { manual: true });
  const planB = planForContext(ctx({ ...full, mode: 'chat' }), { manual: true });
  assert.equal(planA.kind, 'update');
  assert.equal(planB.kind, 'update');
  assert.ok(planB.from > planA.from, `la ventana real del prompt empieza más tarde (${planA.from} → ${planB.from})`);
});

// ---------- el campo en Ajustes y la copia de seguridad ----------

// Backend en memoria con el mismo contrato que el de IndexedDB (ver tests/state.test.mjs).
const memoryBackend = () => {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else if (op.type === 'remove') stores[op.store].delete(op.key); } },
  };
};

test('MEM-020: Settings.userAppearance — vacío por defecto, se guarda saneado, y registros viejos o corruptos cargan vacío', async () => {
  const state = createState(memoryBackend());
  assert.equal((await state.getSettings()).userAppearance, '');
  assert.equal((await state.saveSettings({ userAppearance: ' man,\n  glasses ' })).userAppearance, 'man, glasses');
  assert.equal((await state.getSettings()).userAppearance, 'man, glasses');
  assert.equal((await state.saveSettings({ userAppearance: 'z'.repeat(999) })).userAppearance.length, 300);
  for (const bad of [42, null, {}, ['a']]) assert.equal((await state.saveSettings({ userAppearance: bad })).userAppearance, '');
  // guardar OTRO ajuste no toca el campo
  await state.saveSettings({ userAppearance: 'tall' });
  assert.equal((await state.saveSettings({ user: 'Edgar' })).userAppearance, 'tall');
  // un registro guardado antes de MEM-020 (sin el campo) carga vacío
  const backend = memoryBackend();
  await backend.put('settings', 'main', { url: 'http://x', user: 'Sam', mode: 'chat', ctx: 4096 });
  assert.equal((await createState(backend).getSettings()).userAppearance, '');
});

test('MEM-020: la copia de seguridad conserva el campo (exportBackup → importBackup con ajustes) y una copia vieja importa sin error', async () => {
  const state = createState(memoryBackend());
  await state.saveSettings({ userAppearance: TAGS });
  const text = await (await state.exportBackup()).text();
  assert.equal(JSON.parse(text).settings.userAppearance, TAGS);
  const fresh = createState(memoryBackend());
  await fresh.importBackup({ async text() { return text; } }, { mode: 'replace', includeSettings: true });
  assert.equal((await fresh.getSettings()).userAppearance, TAGS);
  // copia anterior a MEM-020 (sin el campo en los ajustes)
  const old = JSON.parse(text);
  delete old.settings.userAppearance;
  const other = createState(memoryBackend());
  await other.importBackup({ async text() { return JSON.stringify(old); } }, { mode: 'replace', includeSettings: true });
  assert.equal((await other.getSettings()).userAppearance, '');
});

test('MEM-020: editar el campo NO toca el lorebook, el archivo ni la relación', async () => {
  const state = createState(memoryBackend());
  const lore = [{ id: 'a', keys: ['café'], content: 'Se conocieron en un café.', updated: 1, source: 'auto' }];
  await state.saveCharacter({
    ...character({ id: 'x' }), lorebook: lore,
    lorebookArchive: [{ id: 'z', keys: ['playa'], content: 'Fueron a la playa.', updated: 1, source: 'manual', archivedAt: 5 }],
    relationship: { text: 'We grew close.', level: 'growing', updated: 3, source: 'auto' },
  });
  const before = JSON.stringify(await state.getCharacter('x'));
  await state.saveSettings({ userAppearance: TAGS });
  await state.saveSettings({ userAppearance: '' });
  assert.equal(JSON.stringify(await state.getCharacter('x')), before);
});

// ---------- retirada de "siempre presentes": migración ----------

test('MEM-020: una entrada heredada con always:true carga como normal (source y keys se conservan, el campo se descarta)', async () => {
  const state = createState(memoryBackend());
  await state.saveCharacter(character({ id: 'x' }));
  await state.saveCharacterLorebook('x', [
    { id: 'a', keys: ['perro', 'Bruno'], content: 'El perro se llama Bruno.', updated: 7, source: 'manual', always: true },
  ]);
  const got = await state.getCharacter('x');
  assert.deepEqual(got.lorebook, [{ id: 'a', keys: ['perro', 'Bruno'], content: 'El perro se llama Bruno.', updated: 7, source: 'manual' }]);
  assert.deepEqual(got.lorebookArchive, []);
});

test('MEM-020: un `always` heredado SIN keys deriva keys de su contenido; si no se pueden derivar, pasa al archivo en vez de perderse', async () => {
  const backend = memoryBackend();
  // Se escribe directo al almacén: es como quedó un registro guardado por la versión anterior.
  await backend.put('characters', 'x', {
    ...character({ id: 'x' }),
    lorebook: [
      { id: 'k', keys: [], content: 'Edgar is allergic to peanuts and shellfish.', updated: 1, source: 'manual', always: true },
      { id: 'n', keys: [], content: 'I am so on it', updated: 2, source: 'manual', always: true },
      { id: 'ok', keys: ['tema'], content: 'Un hecho normal.', updated: 3, source: 'auto' },
    ],
  });
  const got = await createState(backend).getCharacter('x');
  const byId = Object.fromEntries(got.lorebook.map((e) => [e.id, e]));
  assert.ok(byId.k && byId.k.keys.length > 0 && !('always' in byId.k), 'con keys derivadas');
  assert.equal(byId.k.source, 'manual');
  assert.equal(byId.k.content, 'Edgar is allergic to peanuts and shellfish.');
  assert.ok(byId.ok);
  assert.equal(byId.n, undefined, 'no queda activa sin keys');
  assert.equal(got.lorebookArchive.length, 1);
  assert.equal(got.lorebookArchive[0].content, 'I am so on it');
  assert.ok(!('always' in got.lorebookArchive[0]));
  assert.ok(Number.isFinite(got.lorebookArchive[0].archivedAt));
});

test('MEM-020: una copia de seguridad vieja con recuerdos `always` y `loreUsed[].always` importa sin error', async () => {
  const state = createState(memoryBackend());
  const backup = {
    app: 'companion', version: 2, exported: 1, settings: {},
    characters: [character({ id: 'x', lorebook: [{ id: 'a', keys: ['k'], content: 'Importante.', updated: 1, source: 'manual', always: true }] })],
    chats: { c1: { id: 'c1', characterId: 'x', title: '', scenario: '', created: 1, updated: 1, last: '', lastExportAt: 0 } },
    chatMessages: { c1: [{ role: 'char', text: 'hola', ts: 1, loreUsed: [{ id: 'a', keys: ['k'], content: 'Importante.', always: true }, { id: 'b', keys: ['q'], content: 'Otro.', always: false }] }] },
  };
  await state.importBackup({ async text() { return JSON.stringify(backup); } });
  const msgs = await state.getChatMessages('c1');
  assert.deepEqual(msgs[0].loreUsed, [{ id: 'a', keys: ['k'], content: 'Importante.' }, { id: 'b', keys: ['q'], content: 'Otro.' }]);
  assert.ok(!('always' in (await state.getCharacter('x')).lorebook[0]));
});

// ---------- ya no queda nada de la función retirada ----------

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : /\.(js|html)$/.test(name) ? [p] : [];
  });
}

test('MEM-020: no quedan referencias a selectAlwaysEntries, LOREBOOK_ALWAYS_CHAR_BUDGET ni al interruptor "Siempre presente" en la app', () => {
  const files = sourceFiles(new URL('../www', import.meta.url).pathname);
  for (const f of files) {
    const text = readFileSync(f, 'utf8');
    assert.ok(!/selectAlwaysEntries|LOREBOOK_ALWAYS_CHAR_BUDGET|LOREBOOK_TOTAL_CHAR_BUDGET|formatAlwaysBlock|loreTopicBudget|alwaysBlock/.test(text), f);
    assert.ok(!/Siempre presente/.test(text), f);
  }
});
