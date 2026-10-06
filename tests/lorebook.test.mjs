import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  LOREBOOK_UPDATE_EVERY_MESSAGES,
  LOREBOOK_MAX_ENTRIES,
  LOREBOOK_MAX_ENTRY_CHARS,
  LOREBOOK_INJECT_CHAR_BUDGET,
  LOREBOOK_EXTRACT_WINDOW_MESSAGES,
  LOREBOOK_EXTRACT_MAX_NEW_ENTRIES,
  LOREBOOK_EXTRACT_ENTRY_CHARS,
  LOREBOOK_EXTRACT_MAX_TOKENS,
  LOREBOOK_EXTRACT_CHARS_PER_TOKEN,
  LOREBOOK_EXTRACT_PREFILL,
  LOREBOOK_MANUAL_MIN_MESSAGES,
  shouldUpdateLorebook,
  buildExtractionPrompt,
  fitExtractionWindow,
  parseExtractionResponse,
  applyExtraction,
  parseKeysInput,
  editLoreEntry,
  removeLoreEntry,
  createLoreUpdater,
  selectLoreEntries,
  formatLoreBlock,
  LOREBOOK_KEYS_MAX,
  LOREBOOK_MERGE_OVERLAP,
  LOREBOOK_MERGE_MIN_SHARED,
  LORE_GENERIC_KEYWORDS,
  normalizeLoreKeys,
  isUnnamedPronounFact,
  hasFirstPersonVoice,
  isGenericWord,
  areNearDuplicates,
  mergeNearDuplicates,
  cleanupLorebook,
  cleanStoredLorebook,
  buildLoreBlocks,
  loreBudgetPreview,
  loreEntryCost,
  toLoreUsed,
  loreIndicatorState,
  compareLoreUsed,
  isGrounded,
  GROUNDING_MIN_WORDS,
  GROUNDING_MIN_RATIO,
  createTombstone,
  addTombstone,
  isTombstoned,
  LOREBOOK_TOMBSTONES_MAX,
  stripLegacyExampleFacts
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

// ---------- buildExtractionPrompt / fitExtractionWindow ----------

test('buildExtractionPrompt pide una sola línea, máx. 3 entradas, y termina en el prefill', () => {
  const character = makeCharacter();
  const messages = [
    { role: 'user', text: 'Me encanta el café', ts: 1 },
    { role: 'char', text: 'Lo recordaré', ts: 2 }
  ];
  const existing = [makeEntry({ keys: ['perro', 'bruno'], content: 'Un hecho ya conocido.' })];
  const prompt = buildExtractionPrompt(character, makeSettings(), messages, existing);

  assert.match(prompt, /Luna/);
  assert.match(prompt, /Edgar/);
  assert.match(prompt, /Edgar: Me encanta el café/);
  assert.match(prompt, /ONE line/);
  assert.match(prompt, new RegExp(`up to ${LOREBOOK_EXTRACT_MAX_NEW_ENTRIES} NEW`));
  assert.match(prompt, new RegExp(`${LOREBOOK_EXTRACT_ENTRY_CHARS} characters`));
  assert.match(prompt, /same language as the conversation/);
  // Las keys existentes van para evitar duplicados; el contenido existente NO.
  assert.match(prompt, /perro, bruno/);
  assert.doesNotMatch(prompt, /Un hecho ya conocido/);
  assert.ok(prompt.endsWith(LOREBOOK_EXTRACT_PREFILL));
});

test('buildExtractionPrompt funciona sin entradas existentes ni mensajes', () => {
  const prompt = buildExtractionPrompt(makeCharacter(), makeSettings(), [], []);
  assert.doesNotMatch(prompt, /Already known/);
  assert.ok(prompt.endsWith(LOREBOOK_EXTRACT_PREFILL));
});

test('buildExtractionPrompt solo incluye los últimos LOREBOOK_EXTRACT_WINDOW_MESSAGES mensajes', () => {
  const messages = Array.from({ length: 50 }, (_, i) => ({ role: 'user', text: `mensaje-${i}-fin`, ts: i }));
  const prompt = buildExtractionPrompt(makeCharacter(), makeSettings({ ctx: 8192 }), messages, []);
  assert.match(prompt, /mensaje-49-fin/);
  assert.match(prompt, new RegExp(`mensaje-${50 - LOREBOOK_EXTRACT_WINDOW_MESSAGES}-fin`));
  assert.doesNotMatch(prompt, new RegExp(`mensaje-${49 - LOREBOOK_EXTRACT_WINDOW_MESSAGES}-fin`));
});

test('buildExtractionPrompt respeta el presupuesto de contexto: descarta desde el mensaje más antiguo', () => {
  const ctx = 1024;
  const messages = Array.from({ length: LOREBOOK_EXTRACT_WINDOW_MESSAGES }, (_, i) => ({
    role: i % 2 ? 'char' : 'user', text: `m${i} ` + 'palabra '.repeat(60), ts: i
  }));
  const prompt = buildExtractionPrompt(makeCharacter(), makeSettings({ ctx }), messages, []);
  // Estimación conservadora: prompt + salida reservada + margen caben en ctx.
  const estTokens = Math.ceil(prompt.length / LOREBOOK_EXTRACT_CHARS_PER_TOKEN) + LOREBOOK_EXTRACT_MAX_TOKENS;
  assert.ok(estTokens <= ctx, `estimado ${estTokens} > ctx ${ctx}`);
  assert.match(prompt, /m19 /);           // el más reciente se conserva
  assert.doesNotMatch(prompt, /m0 /);      // el más antiguo se descarta
});

test('fitExtractionWindow conserva lo más reciente y nunca devuelve una ventana vacía', () => {
  const lines = ['a'.repeat(50), 'b'.repeat(50), 'c'.repeat(50)];
  assert.deepEqual(fitExtractionWindow(lines, 110), [lines[1], lines[2]]);
  assert.deepEqual(fitExtractionWindow(lines, 10_000), lines);
  const tooBig = fitExtractionWindow(['x'.repeat(5000)], 100);
  assert.equal(tooBig.length, 1);
  assert.ok(tooBig[0].length < 5000);
  assert.deepEqual(fitExtractionWindow([], 100), []);
});

// ---------- parseExtractionResponse ----------

test('parseExtractionResponse parsea un arreglo en una línea con nombres de campo cortos (k/c)', () => {
  const raw = '[{"k":["bruno","perro"],"c":"El perro se llama Bruno."},{"k":["panadería"],"c":"Trabaja en una panadería."}]';
  assert.deepEqual(parseExtractionResponse(raw), [
    { keys: ['bruno', 'perro'], content: 'El perro se llama Bruno.' },
    { keys: ['panadería'], content: 'Trabaja en una panadería.' }
  ]);
});

test('parseExtractionResponse parsea nombres largos (keys/content)', () => {
  assert.deepEqual(parseExtractionResponse('[{"keys":["a"],"content":"x"}]'), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse acepta el envoltorio {"entries":[…]}', () => {
  const raw = '{"entries":[{"k":["a"],"c":"x"},{"keys":["b"],"content":"y"}]}';
  assert.deepEqual(parseExtractionResponse(raw), [
    { keys: ['a'], content: 'x' },
    { keys: ['b'], content: 'y' }
  ]);
});

test('parseExtractionResponse extrae el arreglo rodeado de texto', () => {
  const raw = 'Here is the memory:\n[{"keys":["a"],"content":"x"}]\nHope this helps!';
  assert.deepEqual(parseExtractionResponse(raw), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse tolera un objeto suelto en vez de un arreglo', () => {
  assert.deepEqual(parseExtractionResponse('{"k":["a"],"c":"x"}'), [{ keys: ['a'], content: 'x' }]);
});

test('parseExtractionResponse RESCATA los objetos completos de un arreglo truncado', () => {
  const cut = '[{"k":["a"],"c":"primero"},{"k":["b"],"c":"segundo"},{"k":["c"],"c":"terc';
  assert.deepEqual(parseExtractionResponse(cut), [
    { keys: ['a'], content: 'primero' },
    { keys: ['b'], content: 'segundo' }
  ]);
});

test('parseExtractionResponse rescata dentro de un envoltorio truncado y respeta llaves dentro de cadenas', () => {
  const cut = '{"entries":[{"k":["a"],"c":"usa {llaves} y \\"comillas\\""},{"k":["b"],"c":"cor';
  assert.deepEqual(parseExtractionResponse(cut), [{ keys: ['a'], content: 'usa {llaves} y "comillas"' }]);
});

test('parseExtractionResponse repara keys sin comillas (error típico del modelo local)', () => {
  const raw = '[{"k":[Laura, sister],"c":"Edgar has a sister named Laura."}, {"k":["food"],"c":"Edgar loves ramen."}]';
  assert.deepEqual(parseExtractionResponse(raw), [
    { keys: ['Laura', 'sister'], content: 'Edgar has a sister named Laura.' },
    { keys: ['food'], content: 'Edgar loves ramen.' }
  ]);
});

test('parseExtractionResponse: [] es "sin novedades" (arreglo vacío); lo no reconocible es null', () => {
  assert.deepEqual(parseExtractionResponse('[]'), []);
  assert.deepEqual(parseExtractionResponse('{"entries":[]}'), []);
  assert.equal(parseExtractionResponse('esto no es JSON de ninguna forma'), null);
  assert.equal(parseExtractionResponse(''), null);
  assert.equal(parseExtractionResponse(null), null);
  assert.equal(parseExtractionResponse('[{"k": ["a", "c": "corte a la mitad'), null);
  assert.equal(parseExtractionResponse('{"foo": 1}'), null);
});

test('la respuesta real del servidor (una línea, prefill "[" + continuación) se parsea', () => {
  const continuation = '{"k":["Bruno", "park"],"c":"Edgar\'s dog Bruno loves the park."}]';
  assert.deepEqual(parseExtractionResponse(LOREBOOK_EXTRACT_PREFILL + continuation), [
    { keys: ['Bruno', 'park'], content: "Edgar's dog Bruno loves the park." }
  ]);
  // El servidor corta en "\n": una respuesta vacía o "[" solo no es un problema.
  assert.equal(parseExtractionResponse(LOREBOOK_EXTRACT_PREFILL + ''), null);
  assert.equal(parseExtractionResponse(LOREBOOK_EXTRACT_PREFILL + ' '), null);
});

// ---------- applyExtraction ----------

const NOW = 5000;

test('applyExtraction agrega entradas nuevas como `auto` sin tocar las existentes', () => {
  const prev = [makeEntry({ id: 'a', keys: ['perro'], content: 'El perro se llama Bruno.' })];
  const out = applyExtraction(prev, [{ keys: ['panadería'], content: 'Trabaja en una panadería.' }], { now: NOW });
  assert.equal(out.entries.length, 2);
  assert.deepEqual(out.entries[0], prev[0]);
  assert.equal(out.entries[1].source, 'auto');
  assert.equal(out.entries[1].updated, NOW);
  assert.ok(out.entries[1].id);
  assert.deepEqual([out.added, out.updated, out.changed], [1, 0, true]);
  assert.equal(prev.length, 1); // no muta su entrada
});

test('applyExtraction ACTUALIZA por key compartida (mismo hecho) sin duplicar y une las keys', () => {
  const prev = [makeEntry({ id: 'a', keys: ['cumpleaños'], content: 'El cumpleaños de Edgar es en marzo.', updated: 1 })];
  const out = applyExtraction(prev, [{ keys: ['Cumpleaños', 'abril'], content: 'El cumpleaños de Edgar es en abril.' }], { now: NOW });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].id, 'a');
  assert.equal(out.entries[0].content, 'El cumpleaños de Edgar es en abril.');
  assert.deepEqual(out.entries[0].keys, ['cumpleaños', 'abril']);
  assert.equal(out.entries[0].updated, NOW);
  assert.deepEqual([out.added, out.updated], [0, 1]);
});

test('applyExtraction NO reemplaza un recuerdo distinto solo porque comparte una key genérica', () => {
  const prev = [makeEntry({ id: 'a', keys: ['work', 'bakery'], content: 'Edgar works at a bakery downtown.' })];
  const out = applyExtraction(prev, [{ keys: ['work', 'hospital'], content: 'His sister works at a hospital.' }], { now: NOW });
  assert.equal(out.entries.length, 2);
  assert.equal(out.entries[0].content, 'Edgar works at a bakery downtown.'); // el recuerdo original sigue intacto
});

test('applyExtraction ignora los nombres (ignoreKeys) al quitar keys y al decidir coincidencias', () => {
  const prev = [makeEntry({ id: 'a', keys: ['edgar', 'perro'], content: 'Edgar tiene un perro llamado Bruno.' })];
  const out = applyExtraction(prev, [{ keys: ['Edgar', 'panadería'], content: 'Edgar trabaja en una panadería.' }],
    { now: NOW, ignoreKeys: ['Edgar', 'Mia'] });
  assert.equal(out.entries.length, 2);
  assert.equal(out.entries[0].content, 'Edgar tiene un perro llamado Bruno.');
  assert.deepEqual(out.entries[1].keys, ['panadería']); // el nombre no queda como key
  // Si TODAS las keys son nombres, la entrada se descarta (se inyectaría siempre).
  const none = applyExtraction([], [{ keys: ['Mia'], content: 'Algo sobre Mia.' }], { ignoreKeys: ['Mia'] });
  assert.deepEqual(none.entries, []);
});

test('applyExtraction no duplica un hecho idéntico ya existente (auto o manual)', () => {
  const prev = [
    makeEntry({ id: 'a', keys: ['x'], content: 'Un hecho.' }),
    makeEntry({ id: 'm', keys: ['y'], content: 'Otro hecho.', source: 'manual' })
  ];
  const out = applyExtraction(prev, [
    { keys: ['z'], content: 'un  HECHO.' },
    { keys: ['w'], content: 'Otro hecho.' }
  ], { now: NOW });
  assert.equal(out.entries.length, 2);
  assert.equal(out.changed, false);
});

test('applyExtraction NUNCA modifica ni elimina entradas manual', () => {
  const manual = makeEntry({ id: 'm', keys: ['cumpleaños'], content: 'El cumpleaños de Edgar es en marzo.', source: 'manual', updated: 1 });
  const out = applyExtraction([manual], [{ keys: ['cumpleaños'], content: 'El cumpleaños de Edgar es en abril.' }], { now: NOW });
  assert.deepEqual(out.entries[0], manual);          // la manual, intacta
  assert.equal(out.entries.length, 2);               // la nueva se agrega aparte
  assert.equal(out.entries[1].source, 'auto');
});

test('applyExtraction respeta el tope descartando primero las auto más antiguas (y nunca las manual)', () => {
  const prev = [
    makeEntry({ id: 'm1', keys: ['m1'], content: 'Manual 1', source: 'manual', updated: 0 }),
    ...Array.from({ length: LOREBOOK_MAX_ENTRIES - 1 }, (_, i) =>
      makeEntry({ id: `a${i}`, keys: [`k${i}`], content: `Hecho auto número ${i}.`, updated: 100 + i }))
  ];
  assert.equal(prev.length, LOREBOOK_MAX_ENTRIES);
  const out = applyExtraction(prev, [{ keys: ['nuevo'], content: 'Un hecho nuevo distinto.' }], { now: NOW });
  assert.equal(out.entries.length, LOREBOOK_MAX_ENTRIES);
  assert.ok(out.entries.some((e) => e.id === 'm1'));                       // la manual (aunque sea la más vieja) se queda
  assert.ok(!out.entries.some((e) => e.id === 'a0'));                      // la auto más antigua se fue
  assert.ok(out.entries.some((e) => e.content === 'Un hecho nuevo distinto.'));
});

test('applyExtraction: si todo son manual y no hay lugar, las nuevas no caben pero nada existente se pierde', () => {
  const prev = Array.from({ length: LOREBOOK_MAX_ENTRIES }, (_, i) =>
    makeEntry({ id: `m${i}`, keys: [`k${i}`], content: `Manual ${i}`, source: 'manual' }));
  const out = applyExtraction(prev, [{ keys: ['nuevo'], content: 'No cabe.' }], { now: NOW });
  assert.equal(out.entries.length, LOREBOOK_MAX_ENTRIES);
  assert.deepEqual(out.entries, prev);
  assert.equal(out.changed, false);
});

test('applyExtraction acota: máx. 3 entradas nuevas por llamada, contenido y keys saneados', () => {
  // (MEM-003: hechos realistas y distintos entre sí; con relleno tipo "Hecho número 1" se fusionarían.)
  const raw = [
    { keys: ['perro'], content: 'Edgar tiene un perro llamado Bruno.' },
    { keys: ['hospital'], content: 'La hermana de Edgar trabaja en un hospital.' },
    { keys: ['guitarra'], content: 'Edgar toca la guitarra los domingos.' },
    { keys: ['viaje'], content: 'Planean un viaje a la montaña en verano.' },
    { keys: ['pastel'], content: 'Mia horneó un pastel de zanahoria.' },
    { keys: ['bicicleta'], content: 'Edgar compró una bicicleta roja.' }
  ];
  assert.equal(applyExtraction([], raw, { now: NOW }).entries.length, LOREBOOK_EXTRACT_MAX_NEW_ENTRIES);

  const long = applyExtraction([], [{ keys: 'cocina', content: 'y '.repeat(LOREBOOK_MAX_ENTRY_CHARS) }]);
  assert.equal(long.entries[0].content.length, LOREBOOK_MAX_ENTRY_CHARS);
  assert.deepEqual(long.entries[0].keys, ['cocina']); // un string es UNA key (aquí, ya normalizada)
});

test('applyExtraction descarta entradas inválidas y NUNCA reduce el lorebook (basura, [] o null)', () => {
  const prev = [makeEntry({ id: 'a' }), makeEntry({ id: 'b', keys: ['otra'], content: 'Otra cosa.' })];
  for (const incoming of [[], null, undefined, 'texto', [{}], [{ keys: [], content: 'x' }], [{ keys: ['a'], content: '' }], [null, 5]]) {
    const out = applyExtraction(prev, incoming, { now: NOW });
    assert.deepEqual(out.entries, prev, `con ${JSON.stringify(incoming)}`);
    assert.equal(out.changed, false);
  }
  assert.doesNotThrow(() => applyExtraction(null, null));
  assert.deepEqual(applyExtraction(null, null).entries, []);
});

// ---------- edición manual ----------

test('parseKeysInput separa por comas/;/saltos, normaliza y quita repetidos', () => {
  assert.deepEqual(parseKeysInput(' Perro, bruno;PERRO\n parque ,, '), ['perro', 'bruno', 'parque']);
  assert.deepEqual(parseKeysInput(''), []);
  assert.deepEqual(parseKeysInput(null), []);
});

test('editLoreEntry edita una entrada y la marca manual; devuelve null si no es válido', () => {
  const list = [makeEntry({ id: 'a', source: 'auto' }), makeEntry({ id: 'b', keys: ['otra'], content: 'Otra cosa.' })];
  const out = editLoreEntry(list, 'a', { content: '  Nuevo   texto ', keys: ['Café', 'mañana'] }, NOW);
  assert.equal(out[0].content, 'Nuevo texto');
  assert.deepEqual(out[0].keys, ['café', 'mañana']);
  assert.equal(out[0].source, 'manual');
  assert.equal(out[0].updated, NOW);
  assert.deepEqual(out[1], list[1]);
  assert.equal(list[0].source, 'auto'); // no muta
  assert.equal(editLoreEntry(list, 'no-existe', { content: 'x', keys: ['y'] }), null);
  assert.equal(editLoreEntry(list, 'a', { content: '   ', keys: ['y'] }), null);
  assert.equal(editLoreEntry(list, 'a', { content: 'x', keys: [] }), null);
});

test('una entrada editada (manual) ya no la toca la extracción automática', () => {
  const list = editLoreEntry([makeEntry({ id: 'a', keys: ['cumpleaños'], content: 'El cumpleaños de Edgar es en marzo.' })],
    'a', { content: 'El cumpleaños de Edgar es el 3 de marzo.', keys: ['cumpleaños'] }, NOW);
  const out = applyExtraction(list, [{ keys: ['cumpleaños'], content: 'El cumpleaños de Edgar es en abril.' }], { now: NOW + 1 });
  assert.equal(out.entries[0].content, 'El cumpleaños de Edgar es el 3 de marzo.');
});

test('removeLoreEntry quita solo la entrada indicada', () => {
  const list = [makeEntry({ id: 'a' }), makeEntry({ id: 'b' })];
  assert.deepEqual(removeLoreEntry(list, 'a').map((e) => e.id), ['b']);
  assert.deepEqual(removeLoreEntry(list, 'zzz').map((e) => e.id), ['a', 'b']);
  assert.deepEqual(removeLoreEntry(null, 'a'), []);
});

// ---------- createLoreUpdater: prioridad al chat, sin pérdidas ----------

function makeUpdaterHarness(overrides = {}) {
  const calls = { complete: 0, save: [], progress: [], prompts: [], aborted: 0 };
  const state = {
    busy: false,
    lorebook: [makeEntry({ id: 'a', keys: ['perro'], content: 'El perro se llama Bruno.' })],
    chat: { id: 'chat1', lorebookMessageCount: 0 },
    // MEM-013: el último mensaje trae, literal, las palabras de contenido de los hechos que usan
    // estos tests (filtro de fundamento) — sin esto, `applyExtraction` los rechazaría por no
    // encontrarlos en la ventana analizada.
    messages: Array.from({ length: LOREBOOK_UPDATE_EVERY_MESSAGES }, (_, i) => ({
      role: i % 2 ? 'char' : 'user',
      text: i === LOREBOOK_UPDATE_EVERY_MESSAGES - 1
        ? 'Trabaja en una panadería. Edgar toca la guitarra. Edgar compró una bicicleta roja. ' +
          'Edgar cocina pasta los domingos. Planean un viaje.'
        : `msg ${i}`,
      ts: i,
    })),
    reply: '{"k":["panadería"],"c":"Trabaja en una panadería."}]',
    auto: true, // MEM-002: el disparo automático solo ocurre con Settings.lorebookAuto === true
  };
  const updater = createLoreUpdater({
    getContext: () => ({ character: makeCharacter(), chat: state.chat, messages: state.messages, settings: makeSettings({ lorebookAuto: state.auto }) }),
    isChatBusy: () => state.busy,
    complete: overrides.complete || ((prompt, opts) => {
      calls.complete++;
      calls.prompts.push(prompt);
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => { calls.aborted++; reject(Object.assign(new Error('Cancelado.'), { code: 'ABORTED' })); });
        Promise.resolve(state.reply).then(resolve);
      });
    }),
    loadLorebook: async () => state.lorebook,
    saveLorebook: async (id, entries, previous) => { calls.save.push({ entries, previous }); state.lorebook = entries; },
    markProgress: async (chatId, count) => { calls.progress.push([chatId, count]); state.chat = { ...state.chat, lorebookMessageCount: count }; },
    onStatus: overrides.onStatus,
  });
  return { updater, state, calls };
}

test('createLoreUpdater: agrega, guarda la copia anterior y avanza el marcador', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  const result = await updater.maybeRun();
  assert.deepEqual([result.kind, result.added], ['ok', 1]);
  assert.equal(calls.save.length, 1);
  assert.equal(calls.save[0].entries.length, 2);
  assert.equal(calls.save[0].previous.length, 1); // el estado ANTERIOR, para deshacer
  assert.deepEqual(calls.progress, [['chat1', LOREBOOK_UPDATE_EVERY_MESSAGES]]);
  assert.equal(updater.getStatus().kind, 'ok');
  assert.match(calls.prompts[0], /Already known/);
  assert.match(calls.prompts[0], /perro/);
  assert.equal(state.lorebook.length, 2);
});

test('MEM-012: createLoreUpdater — onStatus se dispara con "ok" y trae addedEntries (para el aviso de recuerdo nuevo)', async () => {
  const statuses = [];
  const { updater } = makeUpdaterHarness({ onStatus: (s) => statuses.push(s) });
  const result = await updater.maybeRun();
  assert.equal(result.kind, 'ok');
  assert.equal(result.addedEntries.length, 1);
  assert.equal(result.addedEntries[0].content, 'Trabaja en una panadería.');
  const ok = statuses.find((s) => s.kind === 'ok');
  assert.ok(ok, 'onStatus debe recibir un status "ok"');
  assert.equal(ok.addedEntries.length, 1);
});

test('createLoreUpdater NO inicia una extracción mientras hay una generación de chat en curso', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.busy = true;
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.deepEqual(await updater.runNow(), { kind: 'busy' });
  assert.equal(calls.complete, 0);
  // Al terminar la generación, el umbral sigue cruzado: se ejecuta.
  state.busy = false;
  assert.equal((await updater.maybeRun()).kind, 'ok');
  assert.equal(calls.complete, 1);
});

test('MEM-002: con lorebookAuto=false cruzar el umbral NO dispara la extracción; con true sí', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.auto = false;
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.equal(calls.complete, 0);
  assert.equal(calls.save.length, 0);
  assert.deepEqual(calls.progress, []);
  state.auto = true;
  assert.equal((await updater.maybeRun()).kind, 'ok');
  assert.equal(calls.complete, 1);
});

test('MEM-002: la actualización manual (runNow) funciona con lorebookAuto=false y con true', async () => {
  for (const auto of [false, true]) {
    const { updater, state, calls } = makeUpdaterHarness();
    state.auto = auto;
    const result = await updater.runNow();
    assert.equal(result.kind, 'ok', `auto=${auto}`);
    assert.equal(calls.complete, 1);
    assert.equal(calls.save.length, 1);
  }
});

test('createLoreUpdater no dispara si aún no toca por conteo', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.messages = state.messages.slice(0, LOREBOOK_UPDATE_EVERY_MESSAGES - 1);
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.equal(calls.complete, 0);
});

test('createLoreUpdater: si el usuario envía (abort) la extracción se cancela sin guardar ni avanzar el marcador', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.reply = new Promise(() => {}); // el servidor "no responde" todavía
  const pending = updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(updater.isRunning(), true);
  updater.abort();
  const result = await pending;
  assert.equal(result.kind, 'aborted');
  assert.equal(calls.aborted, 1);
  assert.equal(calls.save.length, 0);
  assert.equal(calls.progress.length, 0);
  assert.equal(updater.isRunning(), false);
  assert.equal(state.lorebook.length, 1);
  assert.equal(updater.getStatus().kind, 'aborted');
  // No queda nada colgado: otra extracción posterior funciona.
  state.reply = '{"k":["cocina"],"c":"Edgar cocina pasta los domingos."}]';
  assert.equal((await updater.maybeRun()).kind, 'ok');
});

test('createLoreUpdater: servidor caído/timeout = "unavailable", sin cambios y SIN avanzar el marcador', async () => {
  const { updater, state, calls } = makeUpdaterHarness({ complete: async () => { throw Object.assign(new Error('red'), { code: 'NETWORK' }); } });
  const result = await updater.maybeRun();
  assert.equal(result.kind, 'unavailable');
  assert.equal(calls.save.length, 0);
  assert.equal(calls.progress.length, 0);
  assert.equal(state.lorebook.length, 1);
});

test('createLoreUpdater: respuesta vacía, "[]" o no entendida NO reduce el lorebook; el marcador avanza (el servidor respondió)', async () => {
  for (const reply of ['', ' ', ']', 'no soy JSON', '{"k":["a"],"c":"cort']) {
    const { updater, state, calls } = makeUpdaterHarness();
    state.reply = reply;
    const result = await updater.maybeRun();
    assert.ok(['unparsed', 'nochange'].includes(result.kind), `${JSON.stringify(reply)} -> ${result.kind}`);
    assert.equal(calls.save.length, 0);
    assert.equal(state.lorebook.length, 1);
    assert.equal(calls.progress.length, 1, `${JSON.stringify(reply)}`);
  }
  const { updater, state } = makeUpdaterHarness();
  state.reply = ']'; // "[" + "]" = "[]": sin novedades
  assert.equal((await updater.maybeRun()).kind, 'nochange');
});

test('createLoreUpdater: un arreglo truncado por el servidor se rescata (las entradas completas se guardan)', async () => {
  const { updater, state } = makeUpdaterHarness();
  state.reply = '{"k":["guitarra"],"c":"Edgar toca la guitarra."},{"k":["bicicleta"],"c":"Edgar compró una bicicleta roja."},{"k":["viaje"],"c":"Planean un via';
  const result = await updater.maybeRun();
  assert.deepEqual([result.kind, result.added], ['ok', 2]);
  assert.equal(state.lorebook.length, 3);
});

test('createLoreUpdater: el guardado relee el lorebook, así no pisa una edición manual hecha durante la extracción', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  let release;
  state.reply = new Promise((r) => { release = r; });
  const pending = updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  // Mientras "el servidor piensa", el usuario edita una entrada a mano.
  state.lorebook = [{ ...state.lorebook[0], content: 'El perro de Edgar se llama Bruno Junior.', source: 'manual' }];
  release('{"k":["panadería"],"c":"Trabaja en una panadería."}]');
  await pending;
  assert.equal(state.lorebook.length, 2);
  assert.equal(state.lorebook[0].content, 'El perro de Edgar se llama Bruno Junior.');
  assert.equal(calls.save[0].previous[0].content, 'El perro de Edgar se llama Bruno Junior.');
});

test('createLoreUpdater.runNow: con < 4 mensajes avisa; usa como ventana los últimos mensajes; no depende del marcador', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.messages = state.messages.slice(0, LOREBOOK_MANUAL_MIN_MESSAGES - 1);
  assert.deepEqual(await updater.runNow(), { kind: 'toolittle' });
  assert.equal(calls.complete, 0);

  state.messages = Array.from({ length: 30 }, (_, i) => ({
    role: i % 2 ? 'char' : 'user',
    text: i === 29 ? 'msg 29 — Trabaja en una panadería.' : `msg ${i}`, // MEM-013: fundamento del hecho por defecto
    ts: i,
  }));
  state.chat = { id: 'chat1', lorebookMessageCount: 29 }; // maybeRun no tocaría; runNow sí
  assert.equal((await updater.runNow()).kind, 'ok');
  assert.match(calls.prompts[0], /msg 29/);
  assert.match(calls.prompts[0], new RegExp(`msg ${30 - LOREBOOK_EXTRACT_WINDOW_MESSAGES}\\b`));
  assert.doesNotMatch(calls.prompts[0], new RegExp(`msg ${29 - LOREBOOK_EXTRACT_WINDOW_MESSAGES}\\b`));
});

test('createLoreUpdater no permite dos extracciones a la vez', async () => {
  const { updater, state, calls } = makeUpdaterHarness();
  state.reply = new Promise(() => {});
  const first = updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  assert.deepEqual(await updater.maybeRun(), { kind: 'skipped' });
  assert.deepEqual(await updater.runNow(), { kind: 'busy' });
  assert.equal(calls.complete, 1);
  updater.abort();
  await first;
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

// ---------- MEM-003: higiene de keys ----------

const NAMES = ['U', 'C'];

test('normalizeLoreKeys: una frase pasa a palabras sueltas útiles, sin genéricas', () => {
  assert.deepEqual(normalizeLoreKeys(['person who loves physical touch'], 'U loves physical touch', { names: NAMES }),
    ['physical', 'touch']);
  assert.deepEqual(normalizeLoreKeys(['factory scent'], "C smells like 'a clean, modern factory' to U", { names: NAMES }),
    ['factory', 'scent']);
});

test('normalizeLoreKeys: una key genérica se reemplaza por palabras del contenido (2 como máximo)', () => {
  const keys = normalizeLoreKeys(['personality'], 'U is a clumsy person with technology.', { names: NAMES });
  assert.deepEqual(keys, ['clumsy', 'technology']);
  for (const generic of ['fact', 'person', 'characteristics', 'emotions', 'likes', 'feelings']) {
    const out = normalizeLoreKeys([generic], 'Edgar adopted a stray cat named Bruno.', { names: ['Edgar', 'Mia'] });
    assert.ok(out.length >= 1 && out.length <= 2, generic);
    assert.ok(!out.includes(generic), generic);
    assert.ok(!out.includes('edgar'), generic); // nunca el nombre
  }
});

test('normalizeLoreKeys: quita los nombres de los personajes, stopwords y palabras de menos de 3 letras', () => {
  assert.deepEqual(normalizeLoreKeys(['Edgar', 'Mia', 'la', 'perro', "edgar's"], 'x', { names: ['Edgar', 'Mia'] }), ['perro']);
  assert.deepEqual(normalizeLoreKeys(['the big dog', 'an ox'], 'x', { names: [] }), ['big', 'dog']);
});

test('normalizeLoreKeys: máximo LOREBOOK_KEYS_MAX, sin duplicados (ni por mayúsculas ni por acentos)', () => {
  const out = normalizeLoreKeys(['Café', 'cafe', 'pastel de zanahoria', 'playa', 'montaña', 'viaje'], 'x', { names: [] });
  assert.equal(out.length, LOREBOOK_KEYS_MAX);
  assert.deepEqual(out, ['café', 'pastel', 'zanahoria', 'playa']);
});

test('normalizeLoreKeys: las palabras genéricas se reconocen también en plural y conjugadas', () => {
  assert.deepEqual(normalizeLoreKeys(['loves', 'loved', 'enjoys', 'traits', 'things', 'kites'], 'x', { names: [] }), ['kites']);
  assert.ok(LORE_GENERIC_KEYWORDS.includes('personality') && LORE_GENERIC_KEYWORDS.includes('fact'));
});

test('normalizeLoreKeys: claves con escritura no latina se dejan tal cual y no rompen nada', () => {
  assert.deepEqual(normalizeLoreKeys(['猫', 'кошка'], 'x', { names: [] }), ['猫', 'кошка']);
  assert.deepEqual(normalizeLoreKeys('猫が好き', '猫が好き', { names: [] }), ['猫が好き']);
  assert.deepEqual(normalizeLoreKeys(null, '', {}), []);
  assert.deepEqual(normalizeLoreKeys([], 'the of and', {}), []);
});

// ---------- MEM-003: hechos sin nombre ----------

test('isUnnamedPronounFact: solo un pronombre de sujeto sin ningún nombre en la frase', () => {
  assert.equal(isUnnamedPronounFact('He loves physical touch.', NAMES), true);
  assert.equal(isUnnamedPronounFact('She works at a hospital', ['Edgar']), true);
  assert.equal(isUnnamedPronounFact('Ella tiene un perro.', ['Edgar']), true);
  assert.equal(isUnnamedPronounFact('Él vive en el norte.', ['Edgar']), true);
  assert.equal(isUnnamedPronounFact('My neighbor Marta lent me her ladder.', NAMES), true); // 1.ª persona, sin nombre
  assert.equal(isUnnamedPronounFact("I'm terrified of heights.", NAMES), true);
  assert.equal(isUnnamedPronounFact('Mi madre vive en Valencia.', ['Edgar']), true);
  assert.equal(isUnnamedPronounFact('My neighbor lent Edgar a ladder.', ['Edgar']), false); // hay un nombre
  assert.equal(isUnnamedPronounFact('He told Edgar about the trip.', ['Edgar']), false); // hay un nombre
  assert.equal(isUnnamedPronounFact('Edgar loves physical touch.', ['Edgar']), false);
  assert.equal(isUnnamedPronounFact('El perro se llama Bruno.', ['Edgar']), false); // "El" sin acento es artículo
});

test('applyExtraction NO guarda un hecho cuyo sujeto es un pronombre, ni uno de menos de 3 palabras', () => {
  const out = applyExtraction([], [
    { keys: ['touch'], content: 'He loves physical touch.' },
    { keys: ['laura'], content: 'Laura' },
    { keys: ['touch'], content: 'Edgar loves physical touch.' }
  ], { now: NOW, ignoreKeys: ['Edgar', 'Mia'] });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].content, 'Edgar loves physical touch.');
});

test('applyExtraction: las keys nuevas se normalizan (palabras sueltas, sin genéricas ni nombres)', () => {
  const out = applyExtraction([], [{ keys: ['personality', 'edgar'], content: 'Edgar is afraid of thunderstorms at night.' }],
    { now: NOW, ignoreKeys: ['Edgar', 'Mia'] });
  assert.equal(out.entries.length, 1);
  assert.ok(out.entries[0].keys.length >= 1 && out.entries[0].keys.length <= 2);
  assert.ok(!out.entries[0].keys.includes('personality') && !out.entries[0].keys.includes('edgar'));
});

// ---------- MEM-003: coincidencia por palabra completa en la inyección ----------

function matchesAny(key, text) {
  return selectLoreEntries([makeEntry({ keys: [key], content: 'x' })], [{ role: 'user', text, ts: 1 }]).length === 1;
}

test('selectLoreEntries compara por PALABRA completa: "art" no coincide con "start"; "hand" sí con "hands"', () => {
  assert.equal(matchesAny('art', 'Let us start the walk'), false);
  assert.equal(matchesAny('art', 'I love art and music'), true);
  assert.equal(matchesAny('hand', 'She holds my hands'), true);
  assert.equal(matchesAny('hands', 'give me your hand'), true);
  assert.equal(matchesAny('box', 'two boxes arrived'), true);
  assert.equal(matchesAny('cat', 'the category is closed'), false);
  assert.equal(matchesAny('cat', 'a Cat sat here'), true);
});

test('selectLoreEntries no distingue acentos ni mayúsculas, y admite keys de varias palabras', () => {
  assert.equal(matchesAny('cancion', 'Esa CANCIÓN me gusta'), true);
  assert.equal(matchesAny('canción', 'esa cancion me gusta'), true);
  assert.equal(matchesAny('ice cream', 'we ate ice-cream today'), true);
  assert.equal(matchesAny('ice cream', 'the ice was cold, the cream too'), false);
});

test('selectLoreEntries: una key no latina se sigue buscando como subcadena y no rompe nada', () => {
  assert.equal(matchesAny('猫', '我的猫很可爱'), true);
  assert.equal(matchesAny('猫', 'hello'), false);
  // Caracteres especiales de expresiones regulares: no se usan regex, así que no lanzan ni coinciden por error.
  assert.equal(matchesAny('(a+b*[', 'nada que ver'), false);
  assert.equal(matchesAny('.*', 'cualquier texto'), false);
});

// ---------- MEM-003: fusión de casi-duplicados ----------

test('areNearDuplicates: el caso obligatorio de "physical touch" se fusiona; hechos distintos no', () => {
  assert.ok(LOREBOOK_MERGE_OVERLAP > 0 && LOREBOOK_MERGE_MIN_SHARED >= 2);
  assert.equal(areNearDuplicates('U loves physical touch and is clumsy with technology', 'U likes physical touch.', NAMES), true);
  assert.equal(areNearDuplicates('Edgar tiene un perro llamado Bruno.', 'La hermana de Edgar trabaja en un hospital.', ['Edgar']), false);
  // Una sola palabra en común no basta, aunque la frase corta sea casi toda esa palabra.
  assert.equal(areNearDuplicates('Bruno barks loudly', 'Bruno sleeps all day', []), false);
});

test('mergeNearDuplicates: fusiona auto casi-duplicadas y NUNCA toca ni absorbe una manual', () => {
  const list = [
    makeEntry({ id: 'a', keys: ['touch'], content: 'U loves physical touch and is clumsy with technology', updated: 1 }),
    makeEntry({ id: 'm', keys: ['touch'], content: 'U likes physical touch.', source: 'manual', updated: 2 }),
    makeEntry({ id: 'b', keys: ['physical'], content: 'U likes physical touch.', updated: 3 })
  ];
  const out = mergeNearDuplicates(list, { names: NAMES, now: 9 });
  assert.equal(out.merged, 1);
  assert.deepEqual(out.entries.map((e) => e.id), ['a', 'm']);
  assert.deepEqual(out.entries[1], list[1]); // la manual, idéntica
  assert.equal(out.entries[0].content, 'U loves physical touch and is clumsy with technology'); // el más informativo
  assert.equal(out.entries[0].updated, 9);
  assert.deepEqual(out.entries[0].keys, ['touch', 'physical']);
  assert.equal(list.length, 3); // no muta
});

test('applyExtraction fusiona con una auto existente aunque NO compartan keys; con una manual nunca', () => {
  const prev = [makeEntry({ id: 'a', keys: ['closeness'], content: 'U loves physical touch and is clumsy with technology', updated: 1 })];
  const out = applyExtraction(prev, [{ keys: ['hugs'], content: 'U likes physical touch.' }], { now: NOW, ignoreKeys: NAMES });
  assert.equal(out.entries.length, 1);
  assert.deepEqual([out.added, out.updated], [0, 1]);
  assert.equal(out.entries[0].content, 'U loves physical touch and is clumsy with technology');
  assert.ok(out.entries[0].keys.includes('closeness') && out.entries[0].keys.includes('hugs'));

  const manual = [makeEntry({ id: 'm', keys: ['closeness'], content: 'U loves physical touch and is clumsy with technology', source: 'manual' })];
  const out2 = applyExtraction(manual, [{ keys: ['hugs'], content: 'U likes physical touch.' }], { now: NOW, ignoreKeys: NAMES });
  assert.equal(out2.entries.length, 2);
  assert.deepEqual(out2.entries[0], manual[0]);
});

// ---------- MEM-003: "Limpiar recuerdos" con las 7 entradas reales del tester (U = usuario, C = personaje) ----------

function realSeven() {
  const e = (id, keys, content, updated) => ({ id, keys, content, updated, source: 'auto' });
  return [
    e('r1', ['fact'], 'U loves physical touch and enjoys the closeness with C', 1),
    e('r2', ['personality'], 'U loves physical touch and enjoys the presence of others.', 2),
    e('r3', ['factory scent'], "C smells like 'a clean, modern factory' to U", 3),
    e('r4', ['person who loves physical touch'], 'U loves physical touch', 4),
    e('r5', ['person'], 'U is a clumsy person with technology.', 5),
    e('r6', ['characteristics'], 'He loves physical touch.', 6),
    e('r7', ['emotions'], "C feels comforted by U's kindness and embraces.", 7)
  ];
}

test('cleanupLorebook con las 7 entradas reales: quedan 4 o menos, con keys de palabras sueltas útiles', () => {
  const before = realSeven();
  const out = cleanupLorebook(before, { names: NAMES, now: 100 });
  assert.ok(out.entries.length <= 4, `quedaron ${out.entries.length}`);
  assert.equal(out.changed, true);
  assert.equal(out.merged, 7 - out.entries.length);

  // Las de "physical touch" (incluida la que empezaba con "He") quedan en una sola.
  assert.equal(out.entries.filter((e) => /physical touch/.test(e.content)).length, 1);
  const factory = out.entries.find((e) => /factory/.test(e.content));
  assert.deepEqual(factory.keys, ['factory', 'scent']);
  const clumsy = out.entries.find((e) => /clumsy/.test(e.content));
  assert.deepEqual(clumsy.keys, ['clumsy', 'technology']);
  const comforted = out.entries.find((e) => /comforted/.test(e.content));
  assert.ok(comforted.keys.includes('comforted'));

  const generic = new Set(LORE_GENERIC_KEYWORDS);
  for (const entry of out.entries) {
    assert.ok(entry.keys.length >= 1 && entry.keys.length <= LOREBOOK_KEYS_MAX);
    for (const key of entry.keys) {
      assert.match(key, /^\p{L}+$/u); // una sola palabra
      assert.ok(!generic.has(key) && !NAMES.map((n) => n.toLowerCase()).includes(key), key);
    }
  }
  assert.equal(before.length, 7); // no muta lo recibido
});

test('cleanupLorebook no toca las manuales, ni borra nada que no se fusione, y es idempotente', () => {
  const manual = { id: 'm', keys: ['Persona Especial'], content: 'He loves physical touch.', updated: 5, source: 'manual' };
  const list = [...realSeven(), manual];
  const once = cleanupLorebook(list, { names: NAMES, now: 100 });
  assert.deepEqual(once.entries.find((e) => e.id === 'm'), manual);
  const again = cleanupLorebook(once.entries, { names: NAMES, now: 200 });
  assert.equal(again.changed, false);
  assert.deepEqual(again.entries, once.entries);

  // Una entrada con pronombre que NO se parece a ninguna otra se conserva (solo la fusión reduce).
  const lone = cleanupLorebook([makeEntry({ id: 'x', keys: ['personality'], content: 'He collects vintage stamps.' })], { names: NAMES });
  assert.equal(lone.entries.length, 1);
});

test('cleanStoredLorebook guarda el estado anterior como copia; sin cambios no escribe nada', async () => {
  let stored = realSeven();
  const saves = [];
  const deps = {
    load: async () => stored,
    save: async (entries, previous) => { saves.push({ entries, previous }); stored = entries; },
    names: NAMES,
    now: 100
  };
  const result = await cleanStoredLorebook(deps);
  assert.equal(result.changed, true);
  assert.equal(saves.length, 1);
  assert.equal(saves[0].previous.length, 7);
  assert.deepEqual(saves[0].previous, realSeven());

  const second = await cleanStoredLorebook(deps);
  assert.equal(second.changed, false);
  assert.equal(saves.length, 1); // no volvió a escribir
});

test('cleanStoredLorebook: si el guardado falla, lanza y no cambia nada', async () => {
  let stored = realSeven();
  await assert.rejects(() => cleanStoredLorebook({
    load: async () => stored,
    save: async () => { throw new Error('disco lleno'); },
    names: NAMES
  }));
  assert.deepEqual(stored, realSeven());
});

// ---------- MEM-004 → MEM-020: bloque "por tema" (los "siempre presentes" se retiraron) ----------

// Una entrada escrita a mano (la vía automática nunca la toca).
const manual = (id, content, extra = {}) => ({ id, keys: ['x'], content, updated: 1, source: 'manual', ...extra });

test('MEM-020: editLoreEntry ignora `patch.always`; la entrada queda manual y sin ese campo', () => {
  const list = [makeEntry({ id: 'a', keys: ['perro'], content: 'El perro se llama Bruno.' })];
  const out = editLoreEntry(list, 'a', { content: 'El perro se llama Bruno.', keys: ['perro'], always: true }, 7);
  assert.ok(!('always' in out[0]));
  assert.equal(out[0].source, 'manual');
  assert.ok(!('always' in list[0])); // no muta
});

test('MEM-020: ya no existe nada de "siempre presentes" en el módulo', async () => {
  const mod = await import('../www/js/api/lorebook.js');
  for (const name of ['selectAlwaysEntries', 'LOREBOOK_ALWAYS_CHAR_BUDGET', 'LOREBOOK_TOTAL_CHAR_BUDGET', 'loreTopicBudget', 'formatAlwaysBlock']) {
    assert.equal(name in mod, false, name);
  }
});

test('MEM-020: una entrada con `always:true` heredada se trata como una por tema (el campo se ignora)', () => {
  const entries = [{ ...manual('a', 'Edgar prefiere las mañanas tranquilas.', { keys: ['mañanas'] }), always: true }];
  const recent = [{ role: 'user', text: 'Me encantan las mañanas', ts: 1 }];
  assert.deepEqual(selectLoreEntries(entries, recent).map((e) => e.id), ['a']);
  assert.deepEqual(selectLoreEntries(entries, [{ role: 'user', text: 'nada que ver', ts: 1 }]), []); // sin keys en el texto, no entra
});

test('MEM-020: buildLoreBlocks sin entradas devuelve todo vacío; con "por tema" el bloque es el de siempre', () => {
  const recent = [{ role: 'user', text: 'hablemos del café', ts: 1 }];
  const none = buildLoreBlocks([], recent);
  assert.deepEqual([none.topic, none.used], ['', []]);
  assert.ok(!('always' in none));
  const only = buildLoreBlocks([makeEntry({ keys: ['café'], content: 'Se conocieron en un café.' })], recent);
  assert.equal(only.topic, formatLoreBlock(selectLoreEntries([makeEntry({ keys: ['café'], content: 'Se conocieron en un café.' })], recent)));
});

test('MEM-004: el bloque por tema usa su tope fijo (1000 caracteres, el mismo valor efectivo de siempre sin "siempre presentes")', () => {
  assert.equal(LOREBOOK_INJECT_CHAR_BUDGET, 1000);
  const topics = ['uno', 'dos', 'tres', 'cuatro'].map((k, i) =>
    makeEntry({ id: k, keys: [k], content: `${k} ` + 'x'.repeat(250 - k.length - 1), updated: 10 - i }));
  const recent = [{ role: 'user', text: 'uno dos tres cuatro', ts: 1 }];
  const countLines = (block) => (block ? block.split('\n').length - 1 : 0);
  assert.equal(countLines(buildLoreBlocks(topics, recent).topic), 3); // tope de 1000: caben 3 de 253
});

test('MEM-004: la vía automática nunca toca, fusiona ni borra una entrada escrita a mano', () => {
  const pinned = manual('m', 'U loves physical touch and is clumsy with technology', { keys: ['touch'] });
  const out = applyExtraction([pinned], [{ keys: ['hugs'], content: 'U likes physical touch.' }], { now: 9, ignoreKeys: NAMES });
  assert.deepEqual(out.entries[0], pinned);
  assert.equal(out.entries.length, 2);
  assert.ok(out.entries.slice(1).every((e) => e.source === 'auto'));
  const cleaned = cleanupLorebook([pinned, makeEntry({ id: 'z', keys: ['personality'], content: 'U likes physical touch.' })], { names: NAMES, now: 9 });
  assert.deepEqual(cleaned.entries.find((e) => e.id === 'm'), pinned);
  assert.equal(cleaned.entries.length, 2);
  // Con el tope de entradas lleno, las manuales no se descartan para hacer sitio.
  const many = [pinned, ...Array.from({ length: LOREBOOK_MAX_ENTRIES }, (_, i) => makeEntry({ id: 'e' + i, keys: ['k' + i], content: `Hecho distinto número ${i} sobre tema${i}.`, updated: i + 1 }))];
  const capped = applyExtraction(many, [{ keys: ['nuevo'], content: 'Sam mencionó un viaje a la montaña.' }], { now: 99, ignoreKeys: NAMES });
  assert.ok(capped.entries.some((e) => e.id === 'm'));
});

test('MEM-020: loreBudgetPreview da solo la reserva y el tope del bloque por tema', () => {
  assert.deepEqual(loreBudgetPreview([]), { topicReserve: 0, topicBudget: LOREBOOK_INJECT_CHAR_BUDGET });
  const entries = [manual('a', 'Importante.'), makeEntry({ id: 'n', content: 'Un hecho por tema.' })];
  const prev = loreBudgetPreview(entries);
  assert.equal(prev.topicReserve, loreEntryCost(entries[0]) + loreEntryCost(entries[1]));
  assert.equal(prev.topicBudget, LOREBOOK_INJECT_CHAR_BUDGET);
  assert.equal(loreBudgetPreview([manual('big', 'x'.repeat(2000))]).topicReserve, LOREBOOK_INJECT_CHAR_BUDGET);
});

// ---------- MEM-005: fusión de paráfrasis con las mismas keys ----------
// Causa real (medida): "invite"/"invited" no se reconocían como la misma palabra, así que dos
// frases del mismo hecho con las MISMAS keys (`coffee, date`) quedaban con solapamiento 1/3 < 0,6.

const NAMES2 = ['Sam', 'Mia'];
const COFFEE_A = 'Sam did not invite Mia to a coffee date';
const COFFEE_B = 'Sam has never invited Mia out for coffee';

test('MEM-005: areNearDuplicates reconoce la misma palabra con otra terminación (invite/invited/inviting)', () => {
  assert.equal(areNearDuplicates(COFFEE_A, COFFEE_B, NAMES2), true);
  assert.equal(areNearDuplicates('Sam is inviting Mia for coffee', 'Sam invited Mia for coffee', NAMES2), true);
  // Hechos distintos siguen sin fusionarse.
  assert.equal(areNearDuplicates('Sam told Mia the dog Bruno fears thunder', 'Sam took Mia to the lake on Sunday', NAMES2), false);
  assert.equal(areNearDuplicates('Bruno barks loudly', 'Bruno sleeps all day', []), false);
});

test('MEM-005: dos entradas con las mismas keys y el mismo hecho, en dos extracciones, se fusionan en una', () => {
  const first = applyExtraction([], [{ keys: ['coffee', 'date'], content: COFFEE_A }], { now: 1, ignoreKeys: NAMES2 });
  const second = applyExtraction(first.entries, [{ keys: ['coffee', 'date'], content: COFFEE_B }], { now: 2, ignoreKeys: NAMES2 });
  assert.equal(second.entries.length, 1);
  assert.deepEqual([second.added, second.updated], [0, 1]);
  assert.deepEqual(second.entries[0].keys, ['coffee', 'date']);
  // En la MISMA pasada también.
  const same = applyExtraction([], [
    { keys: ['coffee', 'date'], content: COFFEE_A },
    { keys: ['coffee', 'date'], content: COFFEE_B }
  ], { now: 1, ignoreKeys: NAMES2 });
  assert.equal(same.entries.length, 1);
});

test('MEM-005: "Limpiar recuerdos" fusiona las dos entradas de coffee/date; un hecho distinto con otras keys se conserva', () => {
  const list = [
    makeEntry({ id: 'a', keys: ['coffee', 'date'], content: COFFEE_A, updated: 1 }),
    makeEntry({ id: 'b', keys: ['coffee', 'date'], content: COFFEE_B, updated: 2 }),
    makeEntry({ id: 'c', keys: ['bruno', 'thunder'], content: 'Sam told Mia that the dog Bruno is afraid of thunder', updated: 3 })
  ];
  const out = cleanupLorebook(list, { names: NAMES2, now: 9 });
  assert.equal(out.merged, 1);
  assert.deepEqual(out.entries.map((e) => e.id), ['a', 'c']);
});

test('MEM-005: con las mismas keys (2 o más) basta la mitad de solapamiento; con una sola key, no', () => {
  const a = 'Sam took Mia to the lake and they swam together';
  const b = 'Sam and Mia swam together on a cold night';
  const withKeys = mergeNearDuplicates([
    makeEntry({ id: 'a', keys: ['lake', 'swim'], content: a, updated: 1 }),
    makeEntry({ id: 'b', keys: ['lake', 'swim'], content: b, updated: 2 })
  ], { names: NAMES2, now: 9 });
  assert.equal(withKeys.merged, 1);
  const oneKey = mergeNearDuplicates([
    makeEntry({ id: 'a', keys: ['lake'], content: a, updated: 1 }),
    makeEntry({ id: 'b', keys: ['lake'], content: b, updated: 2 })
  ], { names: NAMES2, now: 9 });
  assert.equal(oneKey.merged, 0);
});

// ---------- MEM-005: cierre del residual de primera persona ----------

test('MEM-005: hasFirstPersonVoice detecta I/my/we/yo/mi fuera de comillas y no lo confunde con otras palabras', () => {
  for (const bad of [
    'Sam told me that his dog fears thunder',
    'Sam told Mia that my dog is Bruno',
    "Sam said I'm afraid of heights",
    'We went to the lake with Sam and Mia',
    'Sam le contó a Mia que mi perro teme a los truenos',
    'Yo trabajo en una panadería con Sam'
  ]) assert.equal(hasFirstPersonVoice(bad), true, bad);
  for (const good of [
    'Sam told Mia that the dog Bruno is afraid of thunder',
    'Sam works in a bakery and Mia loves croissants',
    'Sam told Mia: "I am afraid of heights"',
    'Sam gave Mia a mint and a mix of nuts', // "mix", "mint": no son "mi"
    'Sam visited Milan with Mia' // "Milan" contiene "mi"
  ]) assert.equal(hasFirstPersonVoice(good), false, good);
  assert.equal(hasFirstPersonVoice(null), false);
});

test('MEM-005: applyExtraction no guarda un hecho en primera persona aunque nombre a los dos', () => {
  const out = applyExtraction([], [
    { keys: ['bruno'], content: 'Sam told Mia that my dog Bruno hides under the bed' },
    { keys: ['bruno', 'thunder'], content: 'Sam told Mia that the dog Bruno is afraid of thunder' }
  ], { now: 1, ignoreKeys: NAMES2 });
  assert.equal(out.entries.length, 1);
  assert.equal(out.entries[0].content, 'Sam told Mia that the dog Bruno is afraid of thunder');
});

test('MEM-005: normalizeLoreKeys conserva una key "literal del usuario" de contenido real (hands, kiss, touch, whisper)', () => {
  const keys = normalizeLoreKeys(['bruno', 'thunder', 'hands'], 'Sam held Bruno with both hands', { names: NAMES2 });
  assert.deepEqual(keys, ['bruno', 'thunder', 'hands']);
  for (const w of ['hands', 'kiss', 'touch', 'whisper', 'squeeze', 'hug']) {
    assert.equal(isGenericWord(w), false, w);
    assert.ok(normalizeLoreKeys(['coffee', w], 'Sam and Mia', { names: NAMES2 }).includes(w), w);
  }
  // Máximo 4: 3 del tema + 1 del usuario.
  assert.equal(normalizeLoreKeys(['a1b', 'c2d', 'e3f', 'hands', 'kiss'], 'x', { names: NAMES2 }).length, LOREBOOK_KEYS_MAX);
  // El nombre de un personaje o una palabra de una letra siguen fuera.
  assert.deepEqual(normalizeLoreKeys(['sam', 'x', 'kiss'], 'Sam kissed Mia', { names: NAMES2 }), ['kiss']);
});


// ---------- UI-010: qué recuerdos usó cada mensaje ----------

test('UI-010: buildLoreBlocks.used sin coincidencias es []', () => {
  const recent = [{ role: 'user', text: 'nada que ver', ts: 1 }];
  assert.deepEqual(buildLoreBlocks([makeEntry({ keys: ['café'] })], recent).used, []);
  assert.deepEqual(buildLoreBlocks([], recent).used, []);
});

test('UI-010: buildLoreBlocks.used trae las "por tema" que coinciden, como copias', () => {
  const entries = [
    makeEntry({ id: 'b', keys: ['café'], content: 'Se conocieron en un café.' }),
    makeEntry({ id: 'c', keys: ['playa'], content: 'Sam nunca fue a la playa.' }),
  ];
  const recent = [{ role: 'user', text: 'tomemos un café', ts: 1 }];
  const { used } = buildLoreBlocks(entries, recent);
  assert.deepEqual(used, [{ id: 'b', keys: ['café'], content: 'Se conocieron en un café.' }]);
  // es una copia: editar la entrada original después no cambia lo guardado
  entries[0].content = 'Otra cosa.';
  entries[0].keys.push('nueva');
  assert.equal(used[0].content, 'Se conocieron en un café.');
  assert.deepEqual(used[0].keys, ['café']);
});

test('UI-010: `used` refleja lo que REALMENTE viaja (recortado por presupuesto), no todas las candidatas', () => {
  const topics = ['uno', 'dos', 'tres', 'cuatro'].map((k, i) =>
    makeEntry({ id: k, keys: [k], content: `${k} ` + 'x'.repeat(250 - k.length - 1), updated: 10 - i }));
  const recent = [{ role: 'user', text: 'uno dos tres cuatro', ts: 1 }];
  const { used, topic } = buildLoreBlocks(topics, recent);
  assert.equal(used.length, 3); // los 4 coinciden pero solo caben 3 (ver el test de presupuesto de MEM-004)
  assert.equal(used.length, topic.split('\n').length - 1);
  assert.deepEqual(used.map((u) => u.id), ['uno', 'dos', 'tres']);
});

test('UI-010: loreIndicatorState — sin dato = sin icono; [] = apagado; con recuerdos = activo; solo mensajes del personaje', () => {
  assert.equal(loreIndicatorState({ role: 'char', text: 'hola' }), 'none');
  assert.equal(loreIndicatorState({ role: 'char', text: 'hola', loreUsed: undefined }), 'none');
  assert.equal(loreIndicatorState({ role: 'char', text: 'hola', loreUsed: 'x' }), 'none');
  assert.equal(loreIndicatorState({ role: 'char', text: 'hola', loreUsed: [] }), 'muted');
  assert.equal(loreIndicatorState({ role: 'char', text: 'hola', loreUsed: toLoreUsed([makeEntry()]) }), 'active');
  assert.equal(loreIndicatorState({ role: 'user', text: 'hola', loreUsed: [] }), 'none');
  assert.equal(loreIndicatorState(null), 'none');
});

test('UI-010: compareLoreUsed avisa de recuerdos editados o borrados después, y el detalle conserva el contenido original', () => {
  const used = toLoreUsed([makeEntry({ id: 'x', content: 'Original.' }), makeEntry({ id: 'y', content: 'Se queda.' }), makeEntry({ id: 'z', content: 'Se borra.' })]);
  const now = [makeEntry({ id: 'x', content: 'Editado ahora.' }), makeEntry({ id: 'y', content: 'Se queda.' })];
  const res = compareLoreUsed(used, now);
  assert.deepEqual(res.map((r) => [r.id, r.status]), [['x', 'edited'], ['y', 'same'], ['z', 'gone']]);
  assert.equal(res[0].content, 'Original.');  // lo que se usó entonces, no lo de ahora
  assert.equal(res[2].content, 'Se borra.');  // borrado: el contenido sigue disponible
  // solo cuenta el contenido: un `always` heredado en el recuerdo actual no lo marca como editado (MEM-020)
  assert.equal(compareLoreUsed(toLoreUsed([makeEntry({ id: 'x' })]), [{ ...makeEntry({ id: 'x' }), always: true }])[0].status, 'same');
  assert.deepEqual(compareLoreUsed(undefined, undefined), []);
});

// ---------- MEM-013: filtro de fundamento (isGrounded) ----------

const GROUND_NAMES = ['Alex', 'Mia'];

// Hechos LEGÍTIMOS: parafraseados en tercera persona a partir de lo dicho en el fragmento (como
// se le pide al modelo). Objetivo del contrato: ≥ 90 % pasa.
const GROUNDED_CASES = [
  ['User: Adopté un gato llamado Simba la semana pasada.', 'Alex adoptó un gato llamado Simba la semana pasada.'],
  ["User: My sister Laura just got a new job at the hospital.", "Alex's sister Laura got a new job at the hospital."],
  ['User: I am planning a trip to Kyoto next spring with my brother.', 'Alex is planning a trip to Kyoto next spring.'],
  ['Char: ¿Cómo se llama tu perro? User: Se llama Rocco y le encanta nadar en el lago.', 'El perro de Alex se llama Rocco y le encanta nadar en el lago.'],
  ['User: I broke my arm skiing last winter, it was terrifying.', 'Alex broke an arm skiing last winter.'],
  ['User: Mi color favorito es el verde esmeralda, siempre lo uso en mi ropa.', 'El color favorito de Alex es el verde esmeralda.'],
  ['User: I collect vintage vinyl records, mostly jazz from the 60s.', 'Alex collects vintage vinyl jazz records from the 60s.'],
  ['User: Vivo en un departamento pequeño cerca del puerto con mi gata Michi.', 'Alex vive cerca del puerto con su gata Michi.'],
  ['User: My grandmother taught me to bake bread every Sunday.', "Alex's grandmother taught them to bake bread every Sunday."],
  ['User: Estudio arquitectura y sueño con diseñar un museo algún día.', 'Alex estudia arquitectura y sueña con diseñar un museo.'],
  ['User: I am terrified of spiders, even small ones make me scream.', 'Alex is terrified of spiders.'],
  ['User: Mi hermano menor se llama Tomás y toca la batería en una banda.', 'El hermano menor de Alex, Tomás, toca la batería en una banda.'],
];

// Hechos INVENTADOS o COPIADOS del ejemplo del prompt: nada de esto se dijo en el fragmento.
// Objetivo del contrato: 100 % se bloquea.
const UNGROUNDED_CASES = [
  ['User: hablamos del clima hoy, nada más.', "Zalika mentioned to Petrov that her neighbor's greenhouse grew record tomatoes this year."],
  ['User: no pasó nada importante hoy.', 'Alex confessed a secret fear of the dark to Mia last night.'],
  ['Char: ¿Qué tal tu día? User: bien, normal.', 'Alex\'s father was a famous astronaut who walked on Mars.'],
  ['User: Solo charlamos de tonterías.', 'Alex once lived in Paris for three years studying painting.'],
  ['User: jaja sí, todo bien por aquí.', 'Mia and Alex adopted a puppy named Rex together last summer.'],
  ['User: Estoy cansado, fue un día largo.', 'Alex\'s best friend Diego moved to Canada to become a chef.'],
  ['User: ¿Viste el partido de anoche?', 'Alex has a twin sister named Vera who lives in Berlin.'],
  ['User: Nada nuevo, la rutina de siempre.', 'Alex was once bitten by a snake while hiking in Peru.'],
  ['User: Solo quería saludar, nada más que contar.', 'Alex\'s grandfather built the house they grew up in by hand.'],
  ['User: Todo tranquilo por acá, ¿y tú?', 'Alex secretly writes poetry under a pen name.'],
];

test('MEM-013 Paso 0 (sintético): isGrounded deja pasar >= 90% de hechos legítimos parafraseados', () => {
  const results = GROUNDED_CASES.map(([excerpt, fact]) => isGrounded(fact, excerpt, GROUND_NAMES));
  const passed = results.filter(Boolean).length;
  assert.ok(passed / GROUNDED_CASES.length >= 0.9, `${passed}/${GROUNDED_CASES.length} pasaron`);
});

test('MEM-013 Paso 0 (sintético): isGrounded bloquea el 100% del ejemplo copiado y de hechos inventados', () => {
  const results = UNGROUNDED_CASES.map(([excerpt, fact]) => isGrounded(fact, excerpt, GROUND_NAMES));
  const blocked = results.filter((r) => !r).length;
  assert.equal(blocked, UNGROUNDED_CASES.length, `${blocked}/${UNGROUNDED_CASES.length} bloqueados`);
});

test('isGrounded: sin ninguna palabra de contenido propia (todo nombres/genéricas/stopwords), nunca está fundamentado', () => {
  assert.equal(isGrounded('Alex and Mia are very nice.', 'Alex and Mia talked for a while.', GROUND_NAMES), false);
  assert.equal(isGrounded('', 'cualquier cosa', []), false);
});

test('isGrounded: constantes con los valores documentados (2 palabras o 50%)', () => {
  assert.equal(GROUNDING_MIN_WORDS, 2);
  assert.equal(GROUNDING_MIN_RATIO, 0.5);
});

// ---------- MEM-013: applyExtraction con filtro de fundamento y lápidas ----------

test('applyExtraction: sin excerptText, el filtro de fundamento no actúa (compatibilidad)', () => {
  const out = applyExtraction([], [{ keys: ['viaje'], content: 'Alex mencionó un viaje inventado a Marte.' }], { now: 1 });
  assert.equal(out.added, 1);
  assert.deepEqual(out.rejected, []);
});

test('applyExtraction: con excerptText, descarta lo no fundamentado y lo reporta en `rejected`', () => {
  const out = applyExtraction([], [
    { keys: ['viaje', 'marte'], content: 'Alex mencionó un viaje inventado a Marte.' },
    { keys: ['gato', 'simba'], content: 'Alex adoptó un gato llamado Simba.' },
  ], { now: 1, excerptText: 'User: adopté un gato llamado Simba ayer.' });
  assert.equal(out.added, 1);
  assert.equal(out.entries[0].content, 'Alex adoptó un gato llamado Simba.');
  assert.deepEqual(out.rejected, [{ reason: 'ungrounded' }]);
});

test('applyExtraction: con tombstones, descarta un candidato que coincide con una lápida', () => {
  const tombstones = [createTombstone({ content: 'Alex adoptó un gato llamado Simba.', keys: ['gato', 'simba'] }, 1)];
  const out = applyExtraction([], [{ keys: ['gato', 'simba'], content: 'Alex adoptó un gato llamado Simba el mes pasado.' }], {
    now: 2,
    tombstones,
  });
  assert.equal(out.added, 0);
  assert.deepEqual(out.rejected, [{ reason: 'tombstone' }]);
});

// ---------- MEM-012: applyExtraction expone las entradas NUEVAS (addedEntries) ----------

test('applyExtraction: addedEntries trae las entradas nuevas (no las actualizadas ni las que ya existían)', () => {
  const prev = [makeEntry({ id: 'old', keys: ['viejo'], content: 'Un hecho viejo distinto.' })];
  const out = applyExtraction(prev, [
    { keys: ['guitarra'], content: 'Edgar toca la guitarra los domingos.' },
    { keys: ['bicicleta'], content: 'Edgar compró una bicicleta roja ayer.' },
  ], { now: 5 });
  assert.equal(out.added, 2);
  assert.equal(out.addedEntries.length, 2);
  assert.deepEqual(out.addedEntries.map((e) => e.content), ['Edgar toca la guitarra los domingos.', 'Edgar compró una bicicleta roja ayer.']);
  assert.ok(out.addedEntries.every((e) => out.entries.includes(e)));
});

test('applyExtraction: addedEntries es [] cuando solo se actualiza una entrada existente (nada "nuevo")', () => {
  const prev = [makeEntry({ id: 'a', keys: ['panadería'], content: 'Trabaja en una panadería.' })];
  const out = applyExtraction(prev, [{ keys: ['panadería'], content: 'Trabaja en una panadería del centro.' }], { now: 5 });
  assert.equal(out.added, 0);
  assert.equal(out.updated, 1);
  assert.deepEqual(out.addedEntries, []);
});

// ---------- MEM-013: lápidas (tombstones) ----------

test('createTombstone/addTombstone: copia contenido y keys, recorta por LOREBOOK_TOMBSTONES_MAX (la más antigua sale primero)', () => {
  const t = createTombstone(makeEntry({ content: '  Se   conocieron   en un café.  ', keys: ['café', 'cita'] }), 5);
  assert.deepEqual(t, { content: 'Se conocieron en un café.', keys: ['café', 'cita'], at: 5 });

  let list = [];
  for (let i = 0; i < LOREBOOK_TOMBSTONES_MAX + 3; i++) {
    list = addTombstone(list, makeEntry({ content: `Hecho número ${i} distinto.`, keys: ['n' + i] }), i);
  }
  assert.equal(list.length, LOREBOOK_TOMBSTONES_MAX);
  assert.equal(list[0].at, 3); // las 3 más viejas (0,1,2) salieron
  assert.equal(list[list.length - 1].at, LOREBOOK_TOMBSTONES_MAX + 2);
});

test('isTombstoned: usa el mismo criterio de casi-duplicado que la fusión (MEM-003/005)', () => {
  const tombstones = [{ content: 'Sam told Mia that the dog Bruno is afraid of thunder', keys: ['bruno', 'thunder'] }];
  // Casi el mismo hecho (parafraseado): coincide.
  assert.equal(
    isTombstoned('Sam mentioned that Bruno the dog is afraid of thunder storms', ['bruno', 'thunder'], tombstones, NAMES2),
    true
  );
  // Un hecho totalmente distinto: no coincide.
  assert.equal(isTombstoned('Sam took Mia to the lake on Sunday', ['lake'], tombstones, NAMES2), false);
  assert.equal(isTombstoned('cualquier cosa', ['x'], [], NAMES2), false);
  assert.equal(isTombstoned('cualquier cosa', ['x'], null, NAMES2), false);
});

// ---------- MEM-013: limpieza única del ejemplo viejo del prompt ("Bruno" + trueno) ----------

test('stripLegacyExampleFacts: quita entradas AUTOMÁTICAS que combinan Bruno y trueno, en cualquier idioma; deja las demás intactas', () => {
  const entries = [
    makeEntry({ id: 'a', content: 'Sam told Mia that the dog Bruno is afraid of thunder', keys: ['bruno', 'thunder'] }),
    makeEntry({ id: 'b', content: 'A Bruno le teme a los truenos.', keys: ['bruno', 'truenos'] }),
    makeEntry({ id: 'c', content: 'Bruno adora correr en el parque.', keys: ['bruno', 'parque'] }), // Bruno sin trueno: se queda
    makeEntry({ id: 'd', content: 'Le teme a los truenos desde niña.', keys: ['truenos'] }), // trueno sin Bruno: se queda
    { ...makeEntry({ id: 'e', content: 'Sam told Mia that the dog Bruno is afraid of thunder', keys: ['bruno', 'thunder'] }), source: 'manual' }, // manual: nunca se toca
  ];
  const { entries: out, removed } = stripLegacyExampleFacts(entries);
  assert.deepEqual(out.map((e) => e.id), ['c', 'd', 'e']);
  assert.deepEqual(removed.map((e) => e.id), ['a', 'b']);
});

test('stripLegacyExampleFacts: sin coincidencias, devuelve la MISMA referencia de arreglo (nada cambia)', () => {
  const entries = [makeEntry({ id: 'a', content: 'Un hecho normal cualquiera.' })];
  const result = stripLegacyExampleFacts(entries);
  assert.equal(result.entries, entries);
  assert.deepEqual(result.removed, []);
});

// ---------- MEM-013: createLoreUpdater — migración, fundamento y lápidas de punta a punta ----------

function makeUpdaterHarnessV2(overrides = {}) {
  const calls = { save: [], rejected: [] };
  const state = {
    busy: false,
    lorebook: [makeEntry({ id: 'legacy', content: 'Sam told Mia that the dog Bruno is afraid of thunder', keys: ['bruno', 'thunder'] })],
    tombstones: [],
    chat: { id: 'chat1', lorebookMessageCount: 0 },
    messages: Array.from({ length: LOREBOOK_UPDATE_EVERY_MESSAGES }, (_, i) => ({
      role: i % 2 ? 'char' : 'user',
      text: i === LOREBOOK_UPDATE_EVERY_MESSAGES - 1 ? 'Adopté un gato llamado Simba la semana pasada.' : `msg ${i}`,
      ts: i,
    })),
    reply: overrides.reply || '{"k":["gato","simba"],"c":"Alex adoptó un gato llamado Simba la semana pasada."}]',
  };
  const updater = createLoreUpdater({
    getContext: () => ({ character: makeCharacter({ name: 'Alex' }), chat: state.chat, messages: state.messages, settings: makeSettings({ lorebookAuto: true, user: 'Alex' }) }),
    isChatBusy: () => state.busy,
    complete: async () => state.reply,
    loadLorebook: async () => state.lorebook,
    loadTombstones: async () => state.tombstones,
    saveLorebook: async (id, entries, previous, tombstones) => {
      calls.save.push({ entries, previous, tombstones });
      state.lorebook = entries;
      if (tombstones) state.tombstones = tombstones;
    },
    markProgress: async () => {},
    onFactRejected: (info) => calls.rejected.push(info),
  });
  return { updater, state, calls };
}

test('createLoreUpdater: limpia (una vez) el recuerdo-fantasma del ejemplo viejo y deja lápida, antes de construir el prompt', async () => {
  const { updater, state, calls } = makeUpdaterHarnessV2();
  await updater.maybeRun();
  // La entrada "legacy" (Bruno + thunder) ya no está; sí está la nueva, fundamentada.
  assert.ok(!state.lorebook.some((e) => e.id === 'legacy'));
  assert.ok(state.lorebook.some((e) => e.content.includes('Simba')));
  assert.equal(state.tombstones.length, 1);
  assert.match(state.tombstones[0].content, /Bruno/);
});

test('createLoreUpdater: un candidato sin fundamento en la ventana analizada se descarta y se reporta (fact_rejected)', async () => {
  const { updater, state, calls } = makeUpdaterHarnessV2({
    reply: '{"k":["marte"],"c":"Alex mencionó un viaje inventado a Marte."}]',
  });
  const result = await updater.maybeRun();
  assert.equal(result.kind, 'nochange');
  assert.deepEqual(calls.rejected, [{ reason: 'ungrounded' }]);
});

test('createLoreUpdater: un candidato que coincide con una lápida existente se descarta y se reporta', async () => {
  const { updater, state, calls } = makeUpdaterHarnessV2();
  state.lorebook = []; // sin el fantasma esta vez, para aislar el caso
  state.tombstones = [createTombstone({ content: 'Alex adoptó un gato llamado Simba la semana pasada.', keys: ['gato', 'simba'] }, 1)];
  const result = await updater.maybeRun();
  assert.equal(result.kind, 'nochange');
  assert.deepEqual(calls.rejected, [{ reason: 'tombstone' }]);
});
