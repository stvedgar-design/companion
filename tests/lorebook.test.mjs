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
  const raw = Array.from({ length: 6 }, (_, i) => ({ keys: [`k${i}`], content: `Hecho distinto número ${i}.` }));
  assert.equal(applyExtraction([], raw, { now: NOW }).entries.length, LOREBOOK_EXTRACT_MAX_NEW_ENTRIES);

  const long = applyExtraction([], [{ keys: 'una, sola', content: 'y'.repeat(LOREBOOK_MAX_ENTRY_CHARS + 100) }]);
  assert.equal(long.entries[0].content.length, LOREBOOK_MAX_ENTRY_CHARS);
  assert.deepEqual(long.entries[0].keys, ['una, sola']); // un string es UNA key
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
    messages: Array.from({ length: LOREBOOK_UPDATE_EVERY_MESSAGES }, (_, i) => ({ role: i % 2 ? 'char' : 'user', text: `msg ${i}`, ts: i })),
    reply: '{"k":["panadería"],"c":"Trabaja en una panadería."}]',
  };
  const updater = createLoreUpdater({
    getContext: () => ({ character: makeCharacter(), chat: state.chat, messages: state.messages, settings: makeSettings() }),
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
  state.reply = '{"k":["x"],"c":"Un hecho."}]';
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
  state.reply = '{"k":["a"],"c":"Primero."},{"k":["b"],"c":"Segundo."},{"k":["c"],"c":"Terc';
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

  state.messages = Array.from({ length: 30 }, (_, i) => ({ role: i % 2 ? 'char' : 'user', text: `msg ${i}`, ts: i }));
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
