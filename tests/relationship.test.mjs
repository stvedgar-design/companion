import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../www/js/state.js';
import {
  relationshipLevel,
  relationshipSummary,
  relationshipAgeText,
  sanitizeRelationship,
  defaultRelationship,
  relationshipForPrompt,
  relationshipDisplayText,
  selectRelationshipMemories,
  relationshipInstruction,
  buildRelationshipRequest,
  createRelationshipUpdater,
  RELATIONSHIP_EARLY_MAX,
  RELATIONSHIP_GROWING_MIN,
  RELATIONSHIP_ESTABLISHED_MIN,
  RELATIONSHIP_EARLY_PROMPT_TEXT,
  RELATIONSHIP_EARLY_GUIDE,
  RELATIONSHIP_EARLY_DISPLAY_TEXT,
  RELATIONSHIP_FALLBACK_TEXT,
  RELATIONSHIP_TEXT_MAX_CHARS,
  RELATIONSHIP_MEMORY_BUDGET_CHARS,
  RELATIONSHIP_MAX_ATTEMPTS,
} from '../www/js/api/relationship.js';

// Todos los datos son sintéticos y neutros.
const entry = (id, content, extra = {}) => ({ id, keys: ['k'], content, updated: 1000, source: 'auto', ...extra });
const many = (n) => Array.from({ length: n }, (_, i) => entry('e' + i, `Hecho número ${i} distinto de los demás.`));

function makeCard(overrides = {}) {
  return {
    name: 'Luna', description: '', personality: '', scenario: '', first_mes: '', mes_example: '',
    system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null, ...overrides,
  };
}
function makeCharacter(overrides = {}) {
  return { id: 'c1', name: 'Luna', avatar: '', card: makeCard(), avatarMode: 'mini', created: 1, lorebook: [], relationship: defaultRelationship(), ...overrides };
}
function makeSettings(overrides = {}) {
  return { url: 'http://100.1.1.1:5001', user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'plain', ctx: 4096, ...overrides };
}

// ---------- niveles ----------

test('MEM-014: los umbrales early / growing / established, en sus límites exactos', () => {
  assert.equal(relationshipLevel(0), 'early');
  assert.equal(relationshipLevel(1), 'early');
  assert.equal(relationshipLevel(RELATIONSHIP_EARLY_MAX), 'early');
  assert.equal(relationshipLevel(RELATIONSHIP_GROWING_MIN), 'growing');
  assert.equal(relationshipLevel(RELATIONSHIP_ESTABLISHED_MIN - 1), 'growing');
  assert.equal(relationshipLevel(RELATIONSHIP_ESTABLISHED_MIN), 'established');
  assert.equal(relationshipLevel(200), 'established');
  assert.equal(relationshipLevel(NaN), 'early');
  assert.equal(RELATIONSHIP_EARLY_MAX, 29);
  assert.equal(RELATIONSHIP_GROWING_MIN, 30);
  assert.equal(RELATIONSHIP_ESTABLISHED_MIN, 80);
});

test('MEM-014: relationshipSummary cuenta el total y el nivel, sin inventar frase (eso vive en Character.relationship)', () => {
  for (const input of [[], undefined, null, [null, {}, { content: '   ' }]]) {
    const s = relationshipSummary(input);
    assert.equal(s.total, 0);
    assert.equal(s.level, 'early');
    assert.deepEqual(s.always, []);
    assert.equal(s.lastUpdated, 0);
  }
  assert.equal(relationshipSummary(many(30)).level, 'growing');
  assert.equal(relationshipSummary(many(80)).level, 'established');
});

test('MEM-014: relationshipSummary cuenta el total (siempre presentes + por tema) y lista los "siempre presentes" con su texto exacto', () => {
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

test('MEM-014: relationshipSummary — la última actualización es la fecha más reciente entre los recuerdos', () => {
  const s = relationshipSummary([entry('a', 'Uno.', { updated: 500 }), entry('b', 'Dos.', { updated: 9000 }), entry('c', 'Tres.', { updated: 100 })]);
  assert.equal(s.lastUpdated, 9000);
  assert.equal(relationshipSummary([entry('a', 'Uno.', { updated: undefined })]).lastUpdated, 0);
});

test('MEM-014: relationshipSummary no altera lo recibido (puro)', () => {
  const entries = Object.freeze([Object.freeze(entry('a', ' Hecho con espacios. ', { always: true }))]);
  const s = relationshipSummary(entries);
  assert.deepEqual(s.always, [{ id: 'a', content: 'Hecho con espacios.' }]);
  assert.equal(entries[0].content, ' Hecho con espacios. ');
});

test('MEM-014: relationshipAgeText en lenguaje llano', () => {
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

// ---------- Character.relationship: sanitización y migración ----------

test('MEM-014: sanitizeRelationship — valor por defecto con datos ausentes o inválidos', () => {
  for (const raw of [null, undefined, {}, 'x', 42, { level: 'inventado' }]) {
    const r = sanitizeRelationship(raw);
    assert.equal(r.text, '');
    assert.equal(r.level, 'early');
    assert.equal(r.updated, 0);
    assert.equal(r.source, 'auto');
  }
  assert.deepEqual(sanitizeRelationship(null), defaultRelationship());
});

test('MEM-014: sanitizeRelationship recorta el texto a RELATIONSHIP_TEXT_MAX_CHARS, colapsa espacios y valida level/source', () => {
  const r = sanitizeRelationship({ text: '  Hola   mundo  ' + 'x'.repeat(400), level: 'growing', updated: 5, source: 'manual' });
  assert.equal(r.text.length, RELATIONSHIP_TEXT_MAX_CHARS);
  assert.ok(r.text.startsWith('Hola mundo'));
  assert.equal(r.level, 'growing');
  assert.equal(r.updated, 5);
  assert.equal(r.source, 'manual');
  assert.equal(sanitizeRelationship({ text: 'hola', source: 'otra cosa' }).source, 'auto');
  // sin texto, `updated` siempre vuelve a 0 (igual que Appearance)
  assert.equal(sanitizeRelationship({ text: '', level: 'growing', updated: 999 }).updated, 0);
});

// ---------- textos listos para el prompt y para "Ver lorebook" ----------

test('MEM-014: relationshipForPrompt — "early" no lleva texto (la cabecera usa el fijo)', () => {
  assert.deepEqual(relationshipForPrompt(makeCharacter()), { level: 'early', text: '' });
  assert.deepEqual(relationshipForPrompt(null), { level: 'early', text: '' });
});

test('MEM-014: relationshipForPrompt — el NIVEL sale siempre de la cantidad actual de recuerdos, no del que quedó guardado', () => {
  // El personaje ya tiene 30 recuerdos (nivel actual "growing"), pero relationship.level quedó en
  // "early" (la regeneración de fondo no corrió todavía): el nivel mostrado es el actual, no el viejo.
  const stale = makeCharacter({ lorebook: many(30), relationship: { text: '', level: 'early', updated: 0, source: 'auto' } });
  assert.equal(relationshipForPrompt(stale).level, 'growing');
  assert.equal(relationshipForPrompt(stale).text, RELATIONSHIP_FALLBACK_TEXT.growing); // el texto de "early" no aplica a "growing"
});

test('MEM-014: relationshipForPrompt — "growing"/"established" usan el texto guardado SI es del nivel actual, o el de respaldo si no', () => {
  const withText = makeCharacter({ lorebook: many(30), relationship: { text: 'We have grown close.', level: 'growing', updated: 1, source: 'auto' } });
  assert.deepEqual(relationshipForPrompt(withText), { level: 'growing', text: 'We have grown close.' });

  const justCrossed = makeCharacter({ lorebook: many(80), relationship: { text: '', level: 'established', updated: 0, source: 'auto' } });
  assert.deepEqual(relationshipForPrompt(justCrossed), { level: 'established', text: RELATIONSHIP_FALLBACK_TEXT.established });

  // Texto guardado de un nivel VIEJO (creció de "growing" a "established" y todavía no se regeneró):
  // se usa el respaldo de "established", no el texto (ya desactualizado) de "growing".
  const outdated = makeCharacter({ lorebook: many(80), relationship: { text: 'We have grown close.', level: 'growing', updated: 1, source: 'auto' } });
  assert.deepEqual(relationshipForPrompt(outdated), { level: 'established', text: RELATIONSHIP_FALLBACK_TEXT.established });
});

test('MEM-014: relationshipDisplayText — "Nos estamos conociendo." en "early"; el texto (o el de respaldo) desde "growing"', () => {
  assert.equal(relationshipDisplayText(makeCharacter()), RELATIONSHIP_EARLY_DISPLAY_TEXT);
  assert.equal(relationshipDisplayText(null), RELATIONSHIP_EARLY_DISPLAY_TEXT);
  const withText = makeCharacter({ lorebook: many(30), relationship: { text: 'Nos hemos acercado mucho.', level: 'growing', updated: 1, source: 'manual' } });
  assert.equal(relationshipDisplayText(withText), 'Nos hemos acercado mucho.');
  const noTextYet = makeCharacter({ lorebook: many(30), relationship: { text: '', level: 'growing', updated: 0, source: 'auto' } });
  assert.equal(relationshipDisplayText(noTextYet), RELATIONSHIP_FALLBACK_TEXT.growing);
});

test('MEM-014: RELATIONSHIP_EARLY_GUIDE no dicta personalidad, es corta y no nombra al personaje/usuario', () => {
  assert.ok(RELATIONSHIP_EARLY_GUIDE.length <= 160);
  assert.ok(!/\bMia\b|\bLuna\b|\bEdgar\b/.test(RELATIONSHIP_EARLY_GUIDE));
  assert.match(RELATIONSHIP_EARLY_GUIDE, /love|promises/i);
});

// ---------- selección de recuerdos para redactar el texto ----------

test('MEM-014: selectRelationshipMemories — "siempre presentes" primero, luego los más recientes hasta el presupuesto', () => {
  const always = [entry('a1', 'Siempre presente uno.', { always: true, updated: 1 })];
  const topics = [
    entry('t1', 'Tema viejo.', { updated: 1 }),
    entry('t2', 'Tema reciente.', { updated: 100 }),
    entry('t3', 'Tema medio.', { updated: 50 }),
  ];
  const kept = selectRelationshipMemories([...topics, ...always], { charBudget: 10000 });
  assert.deepEqual(kept.map((e) => e.id), ['a1', 't2', 't3', 't1']);
});

test('MEM-014: selectRelationshipMemories respeta el presupuesto y nunca deja la lista vacía si hay al menos una entrada que entra', () => {
  const list = [entry('a', 'x'.repeat(50)), entry('b', 'y'.repeat(50)), entry('c', 'z'.repeat(50))];
  const kept = selectRelationshipMemories(list, { charBudget: 60 });
  assert.equal(kept.length, 1);
  assert.deepEqual(selectRelationshipMemories([], { charBudget: 100 }), []);
  assert.deepEqual(selectRelationshipMemories(null), []);
});

test('MEM-014: RELATIONSHIP_MEMORY_BUDGET_CHARS es el presupuesto por defecto', () => {
  assert.equal(RELATIONSHIP_MEMORY_BUDGET_CHARS, 900);
});

// ---------- instrucción y petición (continuación del prefijo, MEM-007) ----------

test('MEM-014: relationshipInstruction pide primera persona, solo esos recuerdos y un tope de caracteres', () => {
  const memories = [entry('a', 'Fueron a la playa juntos.'), entry('b', 'Compartieron un café.')];
  const text = relationshipInstruction(memories, { charName: 'Luna', userName: 'Edgar', cap: 300 });
  assert.match(text, /Luna/);
  assert.match(text, /Edgar/);
  assert.match(text, /300 characters/);
  assert.match(text, /Fueron a la playa juntos\./);
  assert.match(text, /Compartieron un café\./);
  assert.match(text, /nothing invented/);
});

test('MEM-014: buildRelationshipRequest — misma técnica de continuación que MEM-007 (mismos mensajes + instrucción + prefill)', () => {
  const character = makeCharacter({ lorebook: [entry('a', 'Un recuerdo.', { always: true })] });
  const chat = { id: 'chat1', scenario: '' };
  const messages = [{ role: 'user', text: 'Hola', ts: 1 }, { role: 'char', text: 'Hola.', ts: 2 }];
  const instruction = '[instrucción de prueba]';

  const chatMode = buildRelationshipRequest({ character, chat, messages, settings: makeSettings({ mode: 'chat' }) }, instruction);
  assert.equal(chatMode.mode, 'chat');
  assert.deepEqual(chatMode.messages[chatMode.messages.length - 2], { role: 'user', content: instruction });
  assert.equal(chatMode.messages[chatMode.messages.length - 1].role, 'assistant');
  assert.match(chatMode.messages[0].content, /Un recuerdo\./); // "siempre presentes" en la cabecera, igual que un turno normal

  const plainMode = buildRelationshipRequest({ character, chat, messages, settings: makeSettings({ mode: 'plain' }) }, instruction);
  assert.equal(plainMode.mode, 'plain');
  assert.ok(plainMode.prompt.endsWith(`${instruction}\n${plainMode.prompt.split('\n').pop()}`) || plainMode.prompt.includes(instruction));
  assert.deepEqual(plainMode.stop, ['\n']);
});

// ---------- createRelationshipUpdater ----------

function makeUpdaterHarness(overrides = {}) {
  const calls = { save: [], levelChanged: [] };
  const state = {
    busy: false,
    character: makeCharacter({ lorebook: many(30) }), // 30 recuerdos: nivel "growing"
    chat: { id: 'chat1', scenario: '' },
    messages: [{ role: 'user', text: 'Hola', ts: 1 }],
    reply: overrides.reply !== undefined ? overrides.reply : 'we have grown quite close over time.',
    verifyOk: overrides.verifyOk !== undefined ? overrides.verifyOk : true,
  };
  const updater = createRelationshipUpdater({
    getContext: () => ({ character: state.character, chat: state.chat, messages: state.messages, settings: makeSettings() }),
    isChatBusy: () => state.busy,
    complete: overrides.complete || (async () => state.reply),
    cleanText: (raw) => (typeof raw === 'string' && raw.trim() ? raw.trim() : ''),
    verifyText: () => ({ ok: state.verifyOk, unsupported: state.verifyOk ? [] : ['Algo'] }),
    loadCharacter: async () => state.character,
    saveRelationship: async (id, patch) => {
      calls.save.push(patch);
      state.character = { ...state.character, relationship: { ...patch } };
    },
    onLevelChanged: (info) => calls.levelChanged.push(info),
  });
  return { updater, state, calls };
}

test('createRelationshipUpdater: nivel "early" nunca llama al modelo', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.character = makeCharacter({ lorebook: many(5) }); // "early"
  let completeCalls = 0;
  const { updater: u2 } = makeUpdaterHarness({ complete: async () => { completeCalls++; return 'x'; } });
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.deepEqual(await updater.runNow(), { kind: 'early' });
  assert.equal(completeCalls, 0);
  assert.equal(calls.save.length, 0);
});

test('createRelationshipUpdater: al cruzar de nivel, genera, verifica y guarda con source "auto"', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  const result = await updater.maybeRun();
  assert.equal(result.kind, 'ok');
  assert.equal(result.level, 'growing');
  assert.equal(result.usedFallback, false);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].text, 'we have grown quite close over time.');
  assert.equal(calls.save[0].level, 'growing');
  assert.equal(calls.save[0].source, 'auto');
  assert.deepEqual(calls.levelChanged, [{ level: 'growing' }]);
});

test('createRelationshipUpdater: sin cruzar de nivel y ya con texto, no hace nada', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.character = makeCharacter({ lorebook: many(30), relationship: { text: 'Ya redactado.', level: 'growing', updated: 1, source: 'auto' } });
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.equal(calls.save.length, 0);
});

test('createRelationshipUpdater: si la verificación falla tras RELATIONSHIP_MAX_ATTEMPTS intentos, usa la frase de respaldo determinista', async () => {
  const { state, calls } = makeUpdaterHarness();
  let attempts = 0;
  const updater = createRelationshipUpdater({
    getContext: () => ({ character: state.character, chat: state.chat, messages: state.messages, settings: makeSettings() }),
    isChatBusy: () => false,
    complete: async () => { attempts++; return 'texto no verificable'; },
    cleanText: (raw) => raw,
    verifyText: () => ({ ok: false, unsupported: ['x'] }),
    loadCharacter: async () => state.character,
    saveRelationship: async (id, patch) => calls.save.push(patch),
  });
  const result = await updater.maybeRun();
  assert.equal(attempts, RELATIONSHIP_MAX_ATTEMPTS);
  assert.equal(result.kind, 'ok');
  assert.equal(result.usedFallback, true);
  assert.equal(calls.save[0].text, RELATIONSHIP_FALLBACK_TEXT.growing);
});

test('createRelationshipUpdater: una edición manual NO se pisa con una regeneración automática; "Regenerar" sí la reemplaza', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.character = makeCharacter({ lorebook: many(35), relationship: { text: 'Edición mía.', level: 'growing', updated: 1, source: 'manual' } });
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.equal(calls.save.length, 0);

  const result = await updater.runNow();
  assert.equal(result.kind, 'ok');
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].source, 'auto');
});

test('createRelationshipUpdater: no compite con el chat (isChatBusy) ni con otra actualización en curso', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.busy = true;
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.deepEqual(await updater.runNow(), { kind: 'busy' });
  assert.equal(calls.save.length, 0);
});

test('createRelationshipUpdater: abort() cancela una generación en curso sin guardar', async () => {
  const { state, calls } = makeUpdaterHarness();
  let release;
  const pending = new Promise((r) => { release = r; });
  const updater = createRelationshipUpdater({
    getContext: () => ({ character: state.character, chat: state.chat, messages: state.messages, settings: makeSettings() }),
    isChatBusy: () => false,
    complete: (req, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelado.'), { code: 'ABORTED' })));
      pending.then(resolve);
    }),
    cleanText: (raw) => raw,
    verifyText: () => ({ ok: true, unsupported: [] }),
    loadCharacter: async () => state.character,
    saveRelationship: async (id, patch) => calls.save.push(patch),
  });
  const running = updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updater.isRunning(), true);
  updater.abort();
  const result = await running;
  assert.equal(result.kind, 'aborted');
  assert.equal(calls.save.length, 0);
  release('no debería usarse');
});

// ---------- almacenamiento (state.js) ----------

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
const makeChar = (extra = {}) => ({ id: 'c1', name: 'Mia', avatar: '', card: { name: 'Mia' }, created: 1, ...extra });

test('MEM-014: un personaje guardado antes de esta función carga con relación vacía ("early")', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', makeChar({ lorebook: [{ id: 'l', keys: ['k'], content: 'algo', updated: 1, source: 'manual' }] }));
  const c = await state.getCharacter('c1');
  assert.deepEqual(c.relationship, defaultRelationship());
  assert.equal(c.lorebook.length, 1, 'no se pierde nada más');
  assert.deepEqual((await state.listCharacters())[0].relationship, defaultRelationship());
});

test('MEM-014: saveCharacterRelationship guarda con merge parcial (no pisa lorebook ni fondo), recorta y pone la fecha solo si cambió', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await state.saveCharacter(makeChar({ chatBackground: 'data:x', lorebook: [{ id: 'l', keys: ['k'], content: 'algo', updated: 1, source: 'manual' }] }));
  const t0 = Date.now();
  const saved = await state.saveCharacterRelationship('c1', { text: 'x'.repeat(400), level: 'growing', source: 'auto' });
  assert.equal(saved.relationship.text.length, RELATIONSHIP_TEXT_MAX_CHARS);
  assert.equal(saved.relationship.level, 'growing');
  assert.equal(saved.relationship.source, 'auto');
  assert.ok(saved.relationship.updated >= t0);
  const reread = await state.getCharacter('c1');
  assert.deepEqual(reread.relationship, saved.relationship);
  assert.equal(reread.chatBackground, 'data:x');
  assert.equal(reread.lorebook.length, 1);
  // sin cambios reales, la fecha no se mueve
  const same = await state.saveCharacterRelationship('c1', { text: saved.relationship.text, level: 'growing', source: 'auto' });
  assert.equal(same.relationship.updated, saved.relationship.updated);
  // una edición manual parcial conserva el nivel guardado
  const manual = await state.saveCharacterRelationship('c1', { text: 'Editado a mano.', source: 'manual' });
  assert.equal(manual.relationship.level, 'growing');
  assert.equal(manual.relationship.source, 'manual');
  await assert.rejects(() => state.saveCharacterRelationship('nope', { text: 'x' }));
});

test('MEM-014: un valor de relación corrupto en disco se sanea al leer (no rompe el prompt)', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', makeChar({ relationship: { text: 42, level: 'inventado', updated: 'ayer', source: 'x' } }));
  assert.deepEqual((await state.getCharacter('c1')).relationship, defaultRelationship());
});
