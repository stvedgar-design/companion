// tests/life.test.mjs — HUM-005: vida propia mínima («su día»): una frase por día, escrita en segundo plano, que el personaje a veces cuenta.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createState } from '../www/js/state.js';
import {
  LIFE_DAYS_MAX, LIFE_TEXT_MAX, LIFE_RETRY_AFTER_FAILED_MS, LIFE_MENTION_CHANCE, LIFE_MAX_ATTEMPTS,
  defaultLife, sanitizeLife, dayKey, lifeToday, withLifeEntry, withFailedLifeAttempt, withLifeMentioned, lifeDue,
  lifeInstruction, buildLifeRequest, cleanLifeText, lifeObservation, lifeSheetText, createLifeWriter,
} from '../www/js/api/life.js';
import { buildPresence, observations, PRESENCE_NOTE_MAX } from '../www/js/api/presence.js';
import { verifyRecap } from '../www/js/api/continuity.js';
import { generateReply } from '../www/js/api/kobold.js';
import { characterSheetModel, duplicateCharacterData } from '../www/js/ui/character-sheet.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 3, 10, 0); // sábado 3 de octubre de 2026, 10:00 local
const TODAY = '2026-10-03';
const TEXT = 'watered the plants on the windowsill and read for a while.';

// ---------- datos ----------

test('HUM-005 dayKey: el día LOCAL, con ceros', () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(dayKey(new Date(2026, 11, 31, 0, 0)), '2026-12-31');
  assert.equal(dayKey(new Date(2026, 9, 3, 10).getTime()), TODAY);
});

test('HUM-005 sanitizeLife: cualquier cosa rara = vacío; una entrada por día, orden y tope de días (personajes anteriores cargan así)', () => {
  for (const bad of [undefined, null, 5, 'x', [], {}, { entries: 'no' }]) assert.deepEqual(sanitizeLife(bad), defaultLife(), String(bad));
  const entries = [
    { date: '2026-10-01', text: 'uno' + ' y más'.repeat(1) }, { date: 'mañana', text: 'fecha mala' }, { date: '2026-10-02', text: '' }, null, { text: 'sin fecha' },
    { date: '2026-09-28', text: 'viejo' }, { date: '2026-09-29', text: 'a' }, { date: '2026-09-30', text: 'b' }, { date: '2026-10-01', text: 'reemplaza el del 1' },
    { date: '2026-10-03', text: 'hoy' }, { date: '2026-10-02', text: 'ayer' },
  ];
  const out = sanitizeLife({ entries, attemptedAt: 'x', mentionedOn: 'ayer' });
  assert.equal(out.entries.length, LIFE_DAYS_MAX);
  assert.deepEqual(out.entries.map((e) => e.date), ['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03']);
  assert.equal(out.entries.find((e) => e.date === '2026-10-01').text, 'reemplaza el del 1', 'una por día: la última gana');
  assert.equal(out.attemptedAt, 0);
  assert.equal(out.mentionedOn, '');
  assert.equal(sanitizeLife({ mentionedOn: TODAY }).mentionedOn, TODAY);
  assert.ok(sanitizeLife({ entries: [{ date: TODAY, text: 'x'.repeat(500) }] }).entries[0].text.length <= LIFE_TEXT_MAX + 1);
});

test('HUM-005 lifeToday / withLifeEntry / withLifeMentioned / withFailedLifeAttempt', () => {
  assert.equal(lifeToday(defaultLife(), NOW), null);
  const a = withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }, NOW.getTime());
  assert.equal(lifeToday(a, NOW).text, TEXT);
  assert.equal(lifeToday(a, new Date(NOW.getTime() + DAY)), null, 'mañana ya no es "hoy"');
  assert.equal(a.attemptedAt, 0, 'un éxito borra el intento fallido');
  // tope de días
  let life = defaultLife();
  for (let d = 1; d <= 9; d++) life = withLifeEntry(life, { date: `2026-09-${String(d).padStart(2, '0')}`, text: `día ${d}` }, 1);
  assert.equal(life.entries.length, LIFE_DAYS_MAX);
  assert.equal(life.entries.at(-1).text, 'día 9');
  assert.deepEqual(withLifeEntry(a, { date: 'x', text: '' }), a);
  // «ya lo conté hoy»
  const m = withLifeMentioned(a, TODAY);
  assert.equal(m.mentionedOn, TODAY);
  assert.equal(withLifeMentioned(m, TODAY), m, 'el mismo objeto si no cambia');
  assert.equal(withLifeMentioned(a, 'no es una fecha').mentionedOn, '');
  assert.equal(withFailedLifeAttempt(a, 77).attemptedAt, 77);
});

test('HUM-005 lifeDue: una vez al día — sin entrada de hoy, sin fallo reciente y con algo de quién es', () => {
  const card = { personality: 'Calm.', description: 'A gardener.' };
  assert.deepEqual(lifeDue({ card, life: defaultLife() }, NOW), { due: true, reason: 'daily' });
  assert.equal(lifeDue({ card }, NOW).due, true, 'un personaje anterior sin el campo');
  assert.equal(lifeDue({ card, life: { entries: [{ date: TODAY, text: TEXT }] } }, NOW).reason, 'already-today');
  assert.equal(lifeDue({ card, life: { entries: [{ date: '2026-10-02', text: TEXT }] } }, NOW).due, true, 'la de ayer no cuenta');
  assert.equal(lifeDue({ card, life: { attemptedAt: NOW.getTime() - HOUR } }, NOW).reason, 'recent-failure');
  assert.equal(lifeDue({ card, life: { attemptedAt: NOW.getTime() - LIFE_RETRY_AFTER_FAILED_MS - 1 } }, NOW).due, true);
  assert.equal(lifeDue({ card: { personality: '', description: '  ' } }, NOW).reason, 'no-personality');
  assert.equal(lifeDue(null, NOW).due, false);
  assert.equal(lifeDue({}, NOW).due, false);
});

// ---------- qué ve el modelo ----------

const luna = (extra = {}) => ({
  id: 'c1', name: 'Luna', avatar: '', mood: { id: 'calm', updated: 1 }, personalityTags: [],
  card: { name: 'Luna', personality: 'Calm. Affectionate. Loves gardening.', description: 'A gentle gardener who reads at night.' },
  lorebook: [{ id: 'l1', keys: ['k'], content: 'SENTINELA-RECUERDO Edgar vive en una ciudad con un río', updated: 1, source: 'auto' }],
  identity: { text: '', acceptedAt: 0, history: [], proposal: null, basis: {}, attemptedAt: 0 },
  mailbox: { notes: [{ id: 'n', text: 'SENTINELA-NOTA', createdAt: 1, status: 'new', readAt: 0 }] },
  followUps: { items: [{ id: 'f', text: 'SENTINELA-PENDIENTE mañana tengo la entrevista', key: '', createdAt: 1, dueAt: 2, expiresAt: 3, status: 'pending', askedFor: 0 }], dates: [] },
  ...extra,
});

test('HUM-005 el pedido al modelo sale SOLO de la personalidad, la identidad, el ánimo y la hora: nunca el usuario, recuerdos, notas ni pendientes', () => {
  const c = luna();
  const instruction = lifeInstruction({ charName: 'Luna', personality: c.card.personality, description: c.card.description, identity: 'Luna has become bolder.', moodPrompt: 'calm and at ease', timeNote: 'It is a Saturday morning.' });
  for (const mode of ['chat', 'plain']) {
    const request = buildLifeRequest({ character: c, settings: { mode }, instruction });
    const sent = JSON.stringify(request);
    assert.ok(!sent.includes('SENTINELA'), mode);
    assert.ok(!sent.includes('Edgar'), 'ni el nombre del usuario');
    assert.deepEqual(request.stop, ['\n']);
    if (mode === 'chat') assert.deepEqual(request.messages.at(-1), { role: 'assistant', content: 'Luna' }, 'el nombre va escrito: el modelo sigue con la acción');
    else assert.ok(request.prompt.endsWith('\nLuna'));
  }
  assert.match(instruction, /Earlier today, Luna …/);
  assert.match(instruction, /Original personality: Calm\. Affectionate\. Loves gardening\./);
  assert.match(instruction, /How Luna has grown so far: Luna has become bolder\./);
  assert.match(instruction, /Luna feels calm and at ease today\. It is a Saturday morning\. Use ONLY the notes below/);
  assert.match(instruction, /same language as Luna's description/);
  assert.match(instruction, /Refer to Luna only by name/);
});

// ---------- filtros de lo que contesta el modelo ----------

const clean = (raw) => cleanLifeText(raw, { charName: 'Luna', userName: 'Edgar' });

test('HUM-005 cleanLifeText: acepta una acción pequeña y cotidiana, en tercera persona, y la deja con punto final', () => {
  assert.equal(clean(' watered the plants on the windowsill and read for a while'), 'watered the plants on the windowsill and read for a while.');
  assert.equal(clean('regó las plantas de la ventana y leyó un rato.'), 'regó las plantas de la ventana y leyó un rato.');
  assert.equal(clean('"baked a loaf of bread and let it cool by the window"'), 'baked a loaf of bread and let it cool by the window.');
  assert.equal(clean('Luna watered the plants and swept the porch'), 'watered the plants and swept the porch.', 'si repite el nombre, se quita');
  assert.equal(clean(', tidied the bookshelf and hummed an old tune. Then the afternoon went by.'), 'tidied the bookshelf and hummed an old tune.', 'solo la primera oración');
  const long = clean('walked through the garden ' + 'and looked at the leaves '.repeat(20));
  assert.ok(long.length <= LIFE_TEXT_MAX + 1 && long.endsWith('.'));
});

test('HUM-005 cleanLifeText: descarta lo vacío, lo corto, números, tú/primera persona/pronombres, el usuario, marcas y negativas del modelo', () => {
  for (const bad of [
    '', '   ', null, 'ok', 'read.',
    'woke up at 7 and read for an hour', 'read 3 chapters of a book',
    'watered her plants and read for a while', 'sat with his tea by the window', 'went out with them for a walk', 'thought about you while reading by the window',
    'I watered the plants and read for a while', 'baked bread for my neighbor on the corner', 'ella regó las plantas y leyó un rato', 'pensó en ti mientras regaba las plantas', 'leyó mi carta junto a la ventana',
    'baked a cake for Edgar and left it by the door', 'edgar called and they talked for a while',
    '*watered the plants* and read for a while', 'watered the **plants** and read a while', 'read <b>a book</b> by the window for a while',
    "I'm sorry, I cannot do that", 'as an AI I do not have days', 'lo siento, no puedo hacer eso',
  ]) {
    assert.equal(clean(bad), '', String(bad));
  }
});

// ---------- el escritor (dependencias simuladas) ----------

function harness({ character = luna(), settings = { user: 'Edgar', mode: 'chat', ownLife: true }, now = NOW.getTime(), replies = [' watered the plants on the windowsill and read for a while'], complete } = {}) {
  const store = { character };
  const calls = { requests: [], updates: 0, settingsLoaded: 0 };
  let i = 0;
  const writer = createLifeWriter({
    loadCharacter: async () => store.character,
    loadSettings: async () => { calls.settingsLoaded++; return settings; },
    complete: complete || (async (request) => { calls.requests.push(request); return replies[Math.min(i++, replies.length - 1)]; }),
    verifyText: verifyRecap,
    updateLife: async (id, mutator) => { calls.updates++; store.character = { ...store.character, life: mutator(store.character.life) }; return store.character; },
    moodPrompt: () => 'calm and at ease',
    now: () => now,
  });
  return { writer, store, calls };
}

test('HUM-005 escritor: escribe «su día» de hoy UNA vez; el segundo chequeo del mismo día no llama al modelo', async () => {
  const h = harness();
  assert.deepEqual(await h.writer.maybeRun('c1'), { kind: 'ok' });
  assert.deepEqual(h.store.character.life.entries, [{ date: TODAY, text: TEXT }]);
  assert.equal(h.calls.requests.length, 1);
  assert.deepEqual(await h.writer.maybeRun('c1'), { kind: 'skipped', reason: 'already-today' });
  assert.equal(h.calls.requests.length, 1, 'no hubo otra llamada');
  assert.equal(h.calls.updates, 1);
});

test('HUM-005 escritor: el pedido real no lleva ni una palabra del usuario, de sus recuerdos, notas o pendientes, y sí el ánimo y la franja del día', async () => {
  const h = harness();
  await h.writer.maybeRun('c1');
  const sent = JSON.stringify(h.calls.requests[0]);
  for (const forbidden of ['SENTINELA', 'Edgar', 'entrevista']) assert.ok(!sent.includes(forbidden), forbidden);
  assert.match(sent, /feels calm and at ease today/);
  assert.match(sent, /It is a Saturday morning\./);
  assert.match(sent, /A gentle gardener who reads at night\./);
});

test('HUM-005 escritor: otro día, otra entrada; se conservan solo los últimos días', async () => {
  let character = luna();
  for (let d = 0; d < 7; d++) {
    const h = harness({ character, now: NOW.getTime() + d * DAY });
    assert.equal((await h.writer.maybeRun('c1')).kind, 'ok', `día ${d}`);
    character = h.store.character;
  }
  assert.equal(character.life.entries.length, LIFE_DAYS_MAX);
  assert.equal(character.life.entries.at(-1).date, '2026-10-09');
});

test('HUM-005 escritor: con el interruptor apagado no llama al modelo ni escribe', async () => {
  const h = harness({ settings: { user: 'Edgar', mode: 'chat', ownLife: false } });
  assert.deepEqual(await h.writer.maybeRun('c1'), { kind: 'skipped', reason: 'disabled' });
  assert.equal(h.calls.requests.length, 0);
  assert.equal(h.calls.updates, 0);
  const missing = harness({ settings: { user: 'Edgar', mode: 'chat' } });
  assert.equal((await missing.writer.maybeRun('c1')).kind, 'skipped', 'un settings sin el campo: nada (exige === true)');
});

test('HUM-005 escritor: aborta si se abre el chat — no guarda nada ni marca un intento', async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const h = harness({
    complete: (request, opts) => new Promise((resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('Cancelado.'), { code: 'ABORTED' })));
      gate.then(() => resolve(' watered the plants'));
    }),
  });
  const run = h.writer.maybeRun('c1');
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(h.writer.isRunning(), true);
  h.writer.abort();
  assert.deepEqual(await run, { kind: 'aborted' });
  release();
  assert.equal(h.calls.updates, 0);
  assert.deepEqual(sanitizeLife(h.store.character.life), defaultLife(), 'sin intento fallido anotado: se reintenta en el próximo chequeo');
  assert.equal(h.writer.isRunning(), false);
});

test('HUM-005 escritor: servidor caído → nada se anota (ni un intento fallido) y el próximo chequeo lo reintenta', async () => {
  const h = harness({ complete: async () => { throw Object.assign(new Error('red'), { code: 'NETWORK' }); } });
  assert.deepEqual(await h.writer.maybeRun('c1'), { kind: 'error' });
  assert.equal(h.calls.updates, 0);
  const ok = harness({ character: h.store.character });
  assert.equal((await ok.writer.maybeRun('c1')).kind, 'ok');
});

test('HUM-005 escritor: descarta lo inventado o vacío (nombre propio que no está en la ficha, número, el usuario, pronombres): dos intentos, nada guardado, y espera 3 h', async () => {
  const bads = ['visited Maria at the old bakery on Elm Street', 'woke up at 7 and read for an hour', 'baked a cake for Edgar', 'watered her plants and read'];
  for (const bad of bads) {
    const h = harness({ replies: [bad, bad] });
    const r = await h.writer.maybeRun('c1');
    assert.equal(r.kind, 'unverified', bad);
    assert.equal(h.calls.requests.length, LIFE_MAX_ATTEMPTS, 'dos intentos como mucho');
    assert.deepEqual(h.store.character.life.entries, [], 'no se guardó nada');
    assert.equal(h.store.character.life.attemptedAt, NOW.getTime());
    // y durante 3 h no se vuelve a intentar
    const again = harness({ character: h.store.character, now: NOW.getTime() + HOUR });
    assert.equal((await again.writer.maybeRun('c1')).reason, 'recent-failure');
    assert.equal(again.calls.requests.length, 0);
  }
  const empty = harness({ replies: ['', '   '] });
  assert.equal((await empty.writer.maybeRun('c1')).kind, 'unverified');
});

test('HUM-005 escritor: un nombre propio que SÍ está en la ficha se acepta (la verificación es léxica contra la personalidad y la descripción)', async () => {
  const c = luna({ card: { name: 'Luna', personality: 'Calm. Loves the Botanic Garden.', description: 'A gardener from Valparaíso.' } });
  const h = harness({ character: c, replies: ['spent the morning in the Botanic Garden'] });
  assert.equal((await h.writer.maybeRun('c1')).kind, 'ok');
  assert.equal(h.store.character.life.entries[0].text, 'spent the morning in the Botanic Garden.');
});

test('HUM-005 escritor: el segundo intento puede salvar el día', async () => {
  const h = harness({ replies: ['baked a cake for Edgar', 'baked bread and let it cool by the window'] });
  assert.equal((await h.writer.maybeRun('c1')).kind, 'ok');
  assert.equal(h.calls.requests.length, 2);
});

test('HUM-005 escritor: si mientras tanto ya se escribió el de hoy, no se pisa', async () => {
  const h = harness();
  const original = h.store.character;
  // simula que otro chequeo escribió el día entre la llamada y el guardado
  const writer = createLifeWriter({
    loadCharacter: async () => original,
    loadSettings: async () => ({ user: 'Edgar', mode: 'chat', ownLife: true }),
    complete: async () => ' watered the plants and read a while',
    verifyText: verifyRecap,
    updateLife: async (id, mutator) => mutator({ entries: [{ date: TODAY, text: 'ya escrito antes.' }], attemptedAt: 0, mentionedOn: '' }),
    now: () => NOW.getTime(),
  });
  assert.equal((await writer.maybeRun('c1')).kind, 'skipped');
});

// ---------- uso en el chat ----------

const base = (extra = {}) => ({
  character: luna({ life: withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }) }),
  messages: [{ role: 'char', text: 'Hola', ts: NOW.getTime() - 60000 }, { role: 'user', text: 'Hola Luna, ¿cómo estás?', ts: NOW.getTime() }],
  settings: { user: 'Edgar', ownLife: true },
  now: NOW,
  ...extra,
});

test('HUM-005 nota de presencia: con baja probabilidad cuenta su día («Earlier today, Luna …») y anota cuál; con el azar en contra, nada', () => {
  const yes = buildPresence({ ...base(), rnd: () => 0 });
  assert.ok(yes.note.includes(`Earlier today, Luna ${TEXT} Luna may mention it naturally when it fits.`), yes.note);
  assert.deepEqual(yes.life, { date: TODAY });
  const no = buildPresence({ ...base(), rnd: () => 0.99 });
  assert.doesNotMatch(no.note, /Earlier today/);
  assert.equal(no.life, null);
  assert.ok(LIFE_MENTION_CHANCE < 0.5, 'probabilidad baja');
  assert.equal(observations({ messages: base().messages, now: NOW, userName: 'Edgar', charName: 'Luna', life: { text: TEXT }, rnd: () => LIFE_MENTION_CHANCE + 0.01 }).length, 0);
});

test('HUM-005 nota de presencia: una vez por día (si ya lo contó hoy no vuelve), no con el interruptor apagado, ni sin entrada de hoy', () => {
  const told = base({ character: luna({ life: { ...withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }), mentionedOn: TODAY } }) });
  assert.doesNotMatch(buildPresence({ ...told, rnd: () => 0 }).note, /Earlier today/);
  assert.doesNotMatch(buildPresence({ ...base({ settings: { user: 'Edgar' } }), rnd: () => 0 }).note, /Earlier today/);
  assert.doesNotMatch(buildPresence({ ...base({ settings: { user: 'Edgar', ownLife: false } }), rnd: () => 0 }).note, /Earlier today/);
  const yesterday = base({ character: luna({ life: withLifeEntry(defaultLife(), { date: '2026-10-02', text: TEXT }) }) });
  assert.doesNotMatch(buildPresence({ ...yesterday, rnd: () => 0 }).note, /Earlier today/, 'el de ayer no es "hoy"');
  const nextDay = base({ character: luna({ life: { ...withLifeEntry(defaultLife(), { date: '2026-10-04', text: TEXT }), mentionedOn: TODAY } }), now: new Date(2026, 9, 4, 10), messages: [{ role: 'user', text: 'Hola', ts: new Date(2026, 9, 4, 10).getTime() }] });
  assert.match(buildPresence({ ...nextDay, rnd: () => 0 }).note, /Earlier today/, 'al otro día vuelve a poder contarlo');
});

test('HUM-005 nota de presencia: si el usuario está mal (tristeza, estrés…) se acompaña y no se cuenta el día', () => {
  const sad = base({ messages: [{ role: 'user', text: 'Estoy muy triste hoy, la entrevista salió fatal y lloré toda la tarde', ts: NOW.getTime() }] });
  assert.doesNotMatch(buildPresence({ ...sad, rnd: () => 0 }).note, /Earlier today/);
  const happy = base({ messages: [{ role: 'user', text: 'Estoy muy feliz, me gradué hoy y estoy muy orgulloso', ts: NOW.getTime() }] });
  assert.match(buildPresence({ ...happy, rnd: () => 0 }).note, /Earlier today/);
});

test('HUM-005 nota de presencia: con todo junto sigue en un solo párrafo, dentro del tope, en positivo y sin pronombres', () => {
  const t0 = NOW.getTime();
  const messages = [{ role: 'user', text: 'Mañana tengo la entrevista', ts: t0 - 6 * HOUR - 60000 }, { role: 'char', text: 'Suerte', ts: t0 - 6 * HOUR }, { role: 'user', text: 'Hola Luna', ts: t0 }];
  const character = luna({
    life: withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }),
    followUps: { items: [{ id: 'f', text: 'Mañana tengo la entrevista', key: 'entrevista', createdAt: 1, dueAt: t0 - HOUR, expiresAt: t0 + DAY, status: 'pending', askedFor: 0 }], dates: [] },
  });
  for (const r of [0, 0.1, 0.5, 0.99]) {
    const { note } = buildPresence({ character, messages, settings: { user: 'Edgar', ownLife: true, followUps: true, emotionResponse: true }, now: NOW, rnd: () => r });
    assert.ok(note.length <= PRESENCE_NOTE_MAX, `${note.length}`);
    assert.doesNotMatch(note, /\n/);
    assert.match(note, /single/);
    const outside = note.replace(/"[^"]*"/g, '');
    assert.doesNotMatch(outside, /\b(he|she|they|him|her|them|his|their)\b/i);
    assert.doesNotMatch(outside, /\b(never|not|no|without|avoid|stop|stall|reject|refuse)\b|n't\b/i);
  }
  // la vida propia va DESPUÉS del pendiente (prioridad)
  const both = buildPresence({ character, messages, settings: { user: 'Edgar', ownLife: true, followUps: true }, now: NOW, rnd: () => 0 }).note;
  assert.ok(both.indexOf('Edgar mentioned') < both.indexOf('Earlier today'));
});

test('HUM-005 nota de presencia: sin vida de hoy o con el interruptor apagado la nota es IDÉNTICA a la de antes', () => {
  const plain = { ...base(), character: luna(), rnd: () => 0 };
  const a = buildPresence(plain);
  const b = buildPresence({ ...plain, settings: { user: 'Edgar' } });
  assert.equal(a.note, b.note);
  assert.equal(buildPresence({ ...plain, character: { ...luna(), life: undefined } }).note, a.note);
});

test('HUM-005 la línea de la ficha: «Luna regó las plantas…» tal cual; vacía si hoy no hay', () => {
  const entry = { date: TODAY, text: 'regó las plantas de la ventana y leyó un rato.' };
  assert.equal(lifeSheetText(entry, 'Luna'), 'Luna regó las plantas de la ventana y leyó un rato.');
  assert.equal(lifeSheetText(null, 'Luna'), '');
  assert.equal(lifeObservation({ text: TEXT }, 'Luna'), `Earlier today, Luna ${TEXT} Luna may mention it naturally when it fits.`);
  const todayChar = luna({ life: withLifeEntry(defaultLife(), { date: dayKey(new Date()), text: 'regó las plantas y leyó un rato.' }) });
  assert.equal(characterSheetModel(todayChar).lifeToday, 'Luna regó las plantas y leyó un rato.');
  assert.equal(characterSheetModel(luna()).lifeToday, '');
  assert.equal(characterSheetModel(luna({ life: withLifeEntry(defaultLife(), { date: '2020-01-01', text: 'algo viejo de ayer.' }) })).lifeToday, '');
  const sheet = readFileSync(new URL('../www/js/ui/character-sheet.js', import.meta.url), 'utf8');
  assert.match(sheet, /field\('Su día', el\('div', '', m\.lifeToday\)\)/);
  assert.match(sheet, /if \(m\.lifeToday\)/);
});

// ---------- datos viejos, guardado, duplicar ----------

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

test('HUM-005 migración: un personaje SIN `life` carga con el valor seguro; los ajustes anteriores con el interruptor encendido; lo corrupto se limpia', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', { id: 'c1', name: 'Mia', avatar: 'data:image/png;base64,AAAA', card: { name: 'Mia' }, created: 1, lorebook: [] });
  backend._raw.characters.set('c2', { id: 'c2', name: 'Theo', card: { name: 'Theo' }, created: 1, lorebook: [], life: { entries: [{ date: 'nunca', text: 'x' }, 5, { date: TODAY, text: 'ok de verdad' }], attemptedAt: 'x', mentionedOn: 3 } });
  assert.deepEqual((await state.getCharacter('c1')).life, defaultLife());
  assert.equal((await state.getCharacter('c1')).avatar, 'data:image/png;base64,AAAA');
  assert.deepEqual((await state.getCharacter('c2')).life, { entries: [{ date: TODAY, text: 'ok de verdad' }], attemptedAt: 0, mentionedOn: '' });
  assert.equal((await state.getSettings()).ownLife, true);
  assert.equal((await state.saveSettings({ ownLife: 0 })).ownLife, true);
  assert.equal((await state.saveSettings({ ownLife: false })).ownLife, false);
});

test('HUM-005 saveCharacterLife: relee bajo el candado, escribe SOLO si cambió y no pisa un guardado paralelo', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', { id: 'c1', name: 'Mia', avatar: 'x', card: { name: 'Mia' }, created: 1, lorebook: [], chatBackground: 'data:image/jpeg;base64,BBBB' });
  let writes = 0;
  const put = backend.put;
  backend.put = async (...a) => { writes++; return put(...a); };
  await state.saveCharacterLife('c1', (l) => l);
  assert.equal(writes, 0, 'sin cambios no se escribe el registro (lleva imágenes)');
  await Promise.all([
    state.saveCharacterLife('c1', (l) => withLifeEntry(l, { date: TODAY, text: TEXT })),
    state.saveCharacterMood('c1', { id: 'tired', updated: 5 }),
  ]);
  const c = await state.getCharacter('c1');
  assert.equal(c.life.entries.length, 1);
  assert.equal(c.mood.id, 'tired', 'no pisó el ánimo');
  assert.ok(c.chatBackground.endsWith('BBBB'));
  // «ya lo conté hoy»: una escritura; repetirla no escribe
  await state.saveCharacterLife('c1', (l) => withLifeMentioned(l, TODAY));
  const before = writes;
  await state.saveCharacterLife('c1', (l) => withLifeMentioned(l, TODAY));
  assert.equal(writes, before, 'repetir lo mismo no reescribe');
  assert.equal(await state.saveCharacterLife('nope', (l) => l), null);
});

test('HUM-005 duplicar un personaje reinicia su día', () => {
  const dup = duplicateCharacterData({ ...luna({ life: { ...withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }), mentionedOn: TODAY } }), mailbox: {}, identity: {}, relationship: {} });
  assert.deepEqual(dup.life, defaultLife());
});

// ---------- paso por generateReply y conexión ----------

test('HUM-005 generateReply: su día viaja en la nota final y vuelve en `result.life`; con ownLife apagado, nada', async () => {
  const seen = {};
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n\n');
    res.end();
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  try {
    const card = { name: 'Luna', description: '', personality: 'Calm.', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
    const character = { id: 'c1', name: 'Luna', avatar: '', card, lorebook: [], personalityTags: [], life: withLifeEntry(defaultLife(), { date: TODAY, text: TEXT }) };
    const messages = base().messages;
    const common = { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url, humanTouch: true };
    const on = await generateReply({ character, messages, settings: { ...common, ownLife: true }, now: NOW, rnd: () => 0 });
    assert.match(seen.body.messages.at(-1).content, /Earlier today, Luna watered the plants on the windowsill and read for a while\. Luna may mention it naturally when it fits\./);
    assert.deepEqual(on.life, { date: TODAY });
    const off = await generateReply({ character, messages, settings: { ...common, ownLife: false }, now: NOW, rnd: () => 0 });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /Earlier today/);
    assert.equal(off.life, null);
  } finally {
    server.close();
  }
});

test('HUM-005 conexión: el hub la dispara tras el buzón con el servidor confirmado; el chat la corta y anota «ya lo conté» solo tras guardar la respuesta; sin red en el chat', () => {
  const home = readFileSync(new URL('../www/js/ui/home.js', import.meta.url), 'utf8');
  assert.ok(home.indexOf('maybeWriteMailboxNotes()') < home.indexOf('maybeWriteLife()'), 'después del buzón');
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /cancelBackgroundLife\(\);/);
  assert.match(chat, /if \(lifeUsed && character && reply\.text\)/);
  assert.match(chat, /withLifeMentioned\(l, lifeUsed\.date\)/);
  const ui = readFileSync(new URL('../www/js/ui/life.js', import.meta.url), 'utf8');
  assert.match(ui, /settings\.ownLife !== true/);
  assert.match(ui, /export function cancelBackgroundLife\(\)/);
  const src = readFileSync(new URL('../www/js/api/life.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /fetch\(|kobold/);
});
