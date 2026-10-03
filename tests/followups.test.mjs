// tests/followups.test.mjs — HUM-004: pendientes («mañana tengo la entrevista»), fechas (cumpleaños, aniversario) y su uso (observación en el chat, nota por fecha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import { createState } from '../www/js/state.js';
import {
  FOLLOWUPS_MAX, FOLLOWUP_EXPIRES_AFTER_MS, FOLLOWUP_TEXT_MAX, SAME_DAY_DUE_MS, DATE_NOTES_MAX,
  defaultFollowUps, sanitizeFollowUps, detectFollowUps, detectUserDates, withFollowUps, withUserDates, dueFollowUp, markAsked, markDone,
  followUpObservation, dateOccasion, dateNoteKey, occasionText,
} from '../www/js/api/followups.js';
import { buildPresence, observations, PRESENCE_NOTE_MAX } from '../www/js/api/presence.js';
import { generateReply } from '../www/js/api/kobold.js';
import {
  createMailboxWriter, sanitizeMailbox, defaultMailbox, dateNoteDue, withDateNote, mailboxInstruction, mailboxDue, MAILBOX_RETRY_AFTER_FAILED_MS,
} from '../www/js/api/mailbox.js';
import { duplicateCharacterData } from '../www/js/ui/character-sheet.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
// Jueves 1 de octubre de 2026, 14:00 (hora local).
const NOW = new Date(2026, 9, 1, 14, 0);
const at = (y, mo, d, h = 20) => new Date(y, mo - 1, d, h, 0).getTime();
const first = (text, now = NOW) => detectFollowUps(text, now)[0];

// ---------- detección de pendientes ----------

test('HUM-004 detecta pendientes en español e inglés y calcula CUÁNDO toca preguntarlos', () => {
  const cases = [
    ['Mañana tengo la entrevista de trabajo', at(2026, 10, 2), 'entrevista'],
    ['manana tengo la entrevista', at(2026, 10, 2), 'entrevista'],
    ["Tomorrow I have the interview", at(2026, 10, 2), 'interview'],
    ['Esta noche voy a cenar con mi hermana', NOW.getTime() + SAME_DAY_DUE_MS, ''],
    ["Tonight I'm going to the movies", NOW.getTime() + SAME_DAY_DUE_MS, ''],
    ["This weekend we're hiking in the mountains", at(2026, 10, 4), ''],
    ['Este finde tengo la boda de mi primo', at(2026, 10, 4), 'boda'],
    ['Next week I have the exam', at(2026, 10, 9), 'exam'],
    ['La semana que viene tengo un viaje a Paris', at(2026, 10, 9), 'viaje'],
    ['El examen es el viernes', at(2026, 10, 2), 'examen'],
    ['I have a dentist appointment on Monday', at(2026, 10, 5), 'appointment'],
    ['Pasado mañana viajo a Madrid', at(2026, 10, 3), ''],
    ['En tres días tengo la mudanza', at(2026, 10, 4), 'mudanza'],
    ['In 2 days I have a flight to Lima', at(2026, 10, 3), 'flight'],
  ];
  for (const [text, dueAt, key] of cases) {
    const f = first(text);
    assert.ok(f, text);
    assert.equal(f.dueAt, dueAt, `${text}: ${new Date(f.dueAt).toString()}`);
    assert.equal(f.key, key, text);
    assert.equal(f.expiresAt, f.dueAt + FOLLOWUP_EXPIRES_AFTER_MS, 'caduca 3 días después');
    assert.ok(f.text.length <= FOLLOWUP_TEXT_MAX + 1);
  }
});

test('HUM-004 el pendiente guarda la frase del usuario, sin asteriscos ni comillas, cortada en una palabra entera', () => {
  const f = first('*suspira* Mañana tengo "la entrevista" de trabajo con la empresa grande de la ciudad y estoy muy nervioso por todo lo que puede pasar ahí');
  assert.ok(!f.text.includes('*') && !f.text.includes('"'));
  assert.ok(f.text.length <= FOLLOWUP_TEXT_MAX + 1 && f.text.endsWith('…'));
  assert.doesNotMatch(f.text, /pasa…$/);
  // varias frases: una por frase, como mucho 2
  const many = detectFollowUps('Mañana tengo el examen. El viernes tengo la entrevista. Esta noche voy al cine.', NOW);
  assert.equal(many.length, 2);
});

test('HUM-004 falsos positivos: despedidas, la parte del día, el pasado, lo hipotético, lo negado y frases sin plan ni evento', () => {
  for (const text of [
    'Mañana te cuento cómo fue', 'hasta mañana', 'Hasta mañana, que descanses', 'talk to you tomorrow', 'see you tomorrow then',
    'Por la mañana tomo café y salgo a caminar', 'Esta mañana tuve una entrevista', 'toda la mañana estuve estudiando', 'Buenos días, ¿cómo amaneciste esta mañana?',
    'Mañana es lunes', 'Mañana', 'tomorrow is monday',
    'Si mañana tengo tiempo te escribo', 'if tomorrow I have time I will write', 'quizás mañana tengo la cita',
    'Mañana no tengo nada que hacer', 'tomorrow I have nothing to do', "I don't have anything tomorrow", 'mañana no voy al trabajo',
    'Ayer tuve la entrevista', 'Hoy fue un buen día', 'Estoy muy cansado', 'ok', '', null,
  ]) {
    assert.deepEqual(detectFollowUps(text, NOW), [], String(text));
  }
});

test('HUM-004 withFollowUps: guarda con id y estado, no repite el mismo y respeta el tope (salen antes los atendidos)', () => {
  const c = first('Mañana tengo la entrevista de trabajo');
  const one = withFollowUps(defaultFollowUps(), [c], NOW.getTime());
  assert.equal(one.items.length, 1);
  assert.deepEqual([one.items[0].status, one.items[0].askedFor, one.items[0].createdAt], ['pending', 0, NOW.getTime()]);
  assert.equal(withFollowUps(one, [c], NOW.getTime() + 1000).items.length, 1, 'el mismo pendiente no se duplica');
  const sameKeyDay = { ...c, text: 'la entrevista otra vez, mañana' };
  assert.equal(withFollowUps(one, [sameKeyDay], NOW.getTime()).items.length, 1, 'misma palabra clave el mismo día');
  // sin candidatos devuelve el mismo objeto (para no escribir de balde)
  assert.equal(withFollowUps(one, [], NOW.getTime()), one);
  // tope
  let fu = defaultFollowUps();
  for (let i = 0; i < FOLLOWUPS_MAX + 3; i++) fu = withFollowUps(fu, [{ text: `plan número ${i}`, key: '', dueAt: at(2026, 10, 2) + i * DAY, expiresAt: at(2026, 10, 2) + (i + 4) * DAY }], NOW.getTime());
  assert.equal(fu.items.length, FOLLOWUPS_MAX);
  assert.deepEqual(fu.items.map((i) => i.text), ['plan número 3', 'plan número 4', 'plan número 5', 'plan número 6', 'plan número 7'], 'sale el pendiente más viejo');
  const withDone = { items: [{ ...fu.items[2], status: 'done' }, ...fu.items.filter((_, i) => i !== 2)], dates: [] };
  const next = withFollowUps(withDone, [{ text: 'otro plan nuevo', key: '', dueAt: at(2026, 10, 20), expiresAt: at(2026, 10, 24) }], NOW.getTime());
  assert.equal(next.items.length, FOLLOWUPS_MAX);
  assert.ok(!next.items.some((i) => i.status === 'done'), 'los atendidos salen primero');
});

// ---------- uso: vencimiento, una sola vez, caducidad ----------

const item = (over = {}) => ({ id: 'f1', text: 'Mañana tengo la entrevista', key: 'entrevista', createdAt: NOW.getTime(), dueAt: at(2026, 10, 2), expiresAt: at(2026, 10, 2) + 3 * DAY, status: 'pending', askedFor: 0, ...over });
const fu = (...items) => ({ items, dates: [] });

test('HUM-004 dueFollowUp: solo cuando ya venció y no caducó; el más antiguo primero', () => {
  const f = fu(item());
  assert.equal(dueFollowUp(f, { at: at(2026, 10, 2, 9), text: 'hola' }), null, 'antes de que toque');
  assert.equal(dueFollowUp(f, { at: at(2026, 10, 2, 21), text: 'hola' }).item.id, 'f1');
  assert.equal(dueFollowUp(f, { at: at(2026, 10, 3, 10), text: 'hola' }).item.id, 'f1', 'al día siguiente (el caso real)');
  assert.equal(dueFollowUp(f, { at: at(2026, 10, 2) + 3 * DAY + HOUR, text: 'hola' }), null, 'caducó');
  assert.equal(dueFollowUp(f, { at: 0, text: 'hola' }), null);
  assert.equal(dueFollowUp(fu(item({ status: 'done' })), { at: at(2026, 10, 3), text: 'x' }), null);
  assert.equal(dueFollowUp(fu(item({ status: 'expired' })), { at: at(2026, 10, 3), text: 'x' }), null);
  const two = fu(item({ id: 'b', dueAt: at(2026, 10, 3), expiresAt: at(2026, 10, 7) }), item({ id: 'a' }));
  assert.equal(dueFollowUp(two, { at: at(2026, 10, 4), text: 'x' }).item.id, 'a');
});

test('HUM-004 una sola vez: tras preguntarlo solo reaparece para ESE mismo mensaje (regenerar), nunca para otro', () => {
  const ask = at(2026, 10, 3, 10);
  const pending = fu(item());
  const asked = markAsked(pending, 'f1', ask);
  assert.equal(asked.items[0].status, 'asked');
  assert.equal(asked.items[0].askedFor, ask);
  assert.equal(dueFollowUp(asked, { at: ask, text: 'hola' }).item.id, 'f1', 'regenerar la misma respuesta da la misma lectura');
  assert.equal(dueFollowUp(asked, { at: ask + 60000, text: 'otro mensaje' }), null, 'el siguiente mensaje ya no');
  assert.equal(markAsked(asked, 'f1', ask), asked, 'marcarlo otra vez no cambia nada');
  assert.equal(markAsked(pending, 'nope', ask), pending);
});

test('HUM-004 si el usuario ya habla del tema, no se pregunta y se da por atendido', () => {
  const r = dueFollowUp(fu(item()), { at: at(2026, 10, 3), text: 'La ENTREVISTA fue larguísima' });
  assert.equal(r.topicCovered, true);
  const done = markDone(fu(item()), 'f1');
  assert.equal(done.items[0].status, 'done');
  assert.equal(markDone(done, 'f1'), done);
  assert.equal(dueFollowUp(done, { at: at(2026, 10, 3), text: 'x' }), null);
  assert.equal(dueFollowUp(fu(item({ key: '' })), { at: at(2026, 10, 3), text: 'entrevista' }).topicCovered, false, 'sin palabra clave no se adivina');
});

// ---------- datos viejos ----------

test('HUM-004 sanitizeFollowUps: cualquier cosa rara = vacío; descarta lo inválido y respeta los topes (personajes anteriores cargan así)', () => {
  for (const bad of [undefined, null, 5, 'x', [], {}, { items: 'no', dates: 3 }]) assert.deepEqual(sanitizeFollowUps(bad), defaultFollowUps(), String(bad));
  const out = sanitizeFollowUps({
    items: [item(), { text: '', dueAt: 5 }, { text: 'sin fecha' }, null, item({ id: 'x', status: 'weird' }), ...Array.from({ length: 9 }, (_, i) => item({ id: `n${i}` }))],
    dates: [{ kind: 'birthday', month: 2, day: 30 }, { kind: 'birthday', month: 5, day: 12 }, { kind: 'birthday', month: 6, day: 1 }, { kind: 'other', month: 1, day: 1 }],
  });
  assert.equal(out.items.length, FOLLOWUPS_MAX);
  assert.ok(out.items.every((i) => ['pending', 'asked', 'done', 'expired'].includes(i.status)));
  assert.deepEqual(out.dates.map((d) => [d.month, d.day]), [[6, 1]], 'un solo cumpleaños: el último válido');
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
const rawChar = (extra = {}) => ({ id: 'c1', name: 'Luna', avatar: 'data:image/png;base64,AAAA', card: { name: 'Luna' }, created: 1, lorebook: [], ...extra });

test('HUM-004 migración: un personaje y un buzón SIN los campos nuevos cargan igual, con valores seguros', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', rawChar({ mailbox: { lastInteractionAt: 5, lastNoteFor: 0, attemptedAt: 0, notes: [{ id: 'n1', text: 'Hola, pasé a saludarte con cariño', createdAt: 3, status: 'new', readAt: 0 }] } }));
  const c = await state.getCharacter('c1');
  assert.deepEqual(c.followUps, defaultFollowUps());
  assert.deepEqual(c.mailbox.dateNotes, []);
  assert.equal(c.mailbox.notes[0].reason, 'absence', 'las notas anteriores son notas por ausencia');
  assert.equal(c.avatar, 'data:image/png;base64,AAAA');
  assert.equal(sanitizeMailbox(undefined).dateNotes.length, 0);
  assert.deepEqual(defaultMailbox().dateNotes, []);
  // y el interruptor
  assert.equal((await state.getSettings()).followUps, true);
  assert.equal((await state.saveSettings({ followUps: 0 })).followUps, true);
  assert.equal((await state.saveSettings({ followUps: false })).followUps, false);
});

test('HUM-004 saveCharacterFollowUps: relee bajo el candado, escribe SOLO si cambió y no pisa un guardado paralelo', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', rawChar({ chatBackground: 'data:image/jpeg;base64,BBBB' }));
  let writes = 0;
  const put = backend.put;
  backend.put = async (...a) => { writes++; return put(...a); };
  await state.saveCharacterFollowUps('c1', (f) => f);
  assert.equal(writes, 0, 'sin cambios no se escribe el registro (lleva imágenes)');
  const cand = first('Mañana tengo la entrevista de trabajo');
  await Promise.all([
    state.saveCharacterFollowUps('c1', (f) => withFollowUps(f, [cand], NOW.getTime())),
    state.saveCharacterMood('c1', { id: 'tired', updated: 5 }),
  ]);
  const c = await state.getCharacter('c1');
  assert.equal(c.followUps.items.length, 1);
  assert.equal(c.mood.id, 'tired', 'no pisó el ánimo');
  assert.ok(c.chatBackground.endsWith('BBBB'));
  assert.equal(await state.saveCharacterFollowUps('nope', (f) => f), null);
});

test('HUM-004 de punta a punta: lo dices, vuelves al día siguiente, te lo preguntan UNA vez y no se repite', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', rawChar());
  // 1. el usuario lo dice (captura al enviar)
  const said = new Date(2026, 9, 1, 14, 0);
  await state.saveCharacterFollowUps('c1', (f) => withFollowUps(f, detectFollowUps('Mañana tengo la entrevista de trabajo', said), said.getTime()));
  // 2. vuelve al día siguiente: la nota de presencia lo pregunta
  const back = new Date(2026, 9, 2, 21, 30);
  const msgs = (ts) => [{ role: 'char', text: 'Hola', ts: ts - 60000 }, { role: 'user', text: 'Hola Luna, ya volví', ts }];
  let c = await state.getCharacter('c1');
  const settings = { user: 'Edgar', followUps: true };
  const turn1 = buildPresence({ character: c, messages: msgs(back.getTime()), settings, now: back, rnd: () => 0.99 });
  assert.match(turn1.note, /Edgar mentioned: "Mañana tengo la entrevista de trabajo"\. Luna can ask how it went, once, in Luna's own words\./);
  assert.equal(turn1.followUp.id, c.followUps.items[0].id);
  // 3. quien llama lo marca después de guardar la respuesta
  await state.saveCharacterFollowUps('c1', (f) => markAsked(f, turn1.followUp.id, turn1.followUp.askedFor));
  c = await state.getCharacter('c1');
  // regenerar: misma lectura
  const regen = buildPresence({ character: c, messages: msgs(back.getTime()), settings, now: back, rnd: () => 0.99 });
  assert.match(regen.note, /Edgar mentioned/);
  // 4. el mensaje siguiente: ya no
  const later = new Date(back.getTime() + 120000);
  const turn2 = buildPresence({ character: c, messages: msgs(later.getTime()), settings, now: later, rnd: () => 0.99 });
  assert.doesNotMatch(turn2.note, /Edgar mentioned/);
  assert.equal(turn2.followUp, null);
});

// ---------- la nota de presencia ----------

const luna = (followUps, extra = {}) => ({ id: 'c1', name: 'Luna', lorebook: [{ content: 'Edgar adora el café con canela' }], personalityTags: [], followUps, ...extra });
const backMsgs = (ts, text = 'Hola Luna', gap = 20 * HOUR) => [{ role: 'char', text: 'Suerte mañana', ts: ts - gap }, { role: 'user', text, ts }];
const ASK_AT = at(2026, 10, 2, 21);

test('HUM-004 buildPresence: sin el interruptor, o sin pendiente vencido, la nota es IDÉNTICA a la de antes', () => {
  const messages = backMsgs(ASK_AT);
  const base = { messages, now: new Date(ASK_AT), rnd: () => 0.99 };
  const off = buildPresence({ ...base, character: luna(fu(item())), settings: { user: 'Edgar' } });
  const offExplicit = buildPresence({ ...base, character: luna(fu(item())), settings: { user: 'Edgar', followUps: false } });
  const none = buildPresence({ ...base, character: luna(defaultFollowUps()), settings: { user: 'Edgar', followUps: true } });
  const legacy = buildPresence({ ...base, character: luna(undefined), settings: { user: 'Edgar', followUps: true } });
  assert.equal(off.note, offExplicit.note);
  assert.equal(none.note, off.note);
  assert.equal(legacy.note, off.note);
  assert.doesNotMatch(off.note, /mentioned/);
  assert.equal(off.followUp, null);
  const early = buildPresence({ ...base, messages: backMsgs(at(2026, 10, 2, 9)), now: new Date(at(2026, 10, 2, 9)), character: luna(fu(item())), settings: { user: 'Edgar', followUps: true } });
  assert.doesNotMatch(early.note, /mentioned/, 'todavía no toca');
});

test('HUM-004 buildPresence: el pendiente va primero (tras el ánimo), reemplaza el «estaba pensando» y respeta tope, positivo y sin pronombres', () => {
  const messages = backMsgs(ASK_AT, 'Hola Luna', 8 * HOUR);
  for (const r of [0, 0.5, 0.99]) {
    const { note } = buildPresence({ character: luna(fu(item())), messages, settings: { user: 'Edgar', followUps: true }, now: new Date(ASK_AT), rnd: () => r });
    assert.ok(note.startsWith('Luna feels '));
    assert.ok(note.includes('Edgar mentioned: "Mañana tengo la entrevista"'));
    assert.doesNotMatch(note, /kept thinking about this/, 'un solo "volver a algo de antes"');
    assert.ok(note.indexOf('Edgar mentioned') < note.lastIndexOf('single'));
    assert.ok(note.length <= PRESENCE_NOTE_MAX, `${note.length}`);
    assert.doesNotMatch(note.replace(/"[^"]*"/g, ''), /\b(he|she|they|him|her|them|his|their)\b/i);
    assert.doesNotMatch(note.replace(/"[^"]*"/g, ''), /\b(never|not|no|without|avoid|stop|stall|reject|refuse)\b|n't\b/i);
  }
});

test('HUM-004 buildPresence: caben juntos el registro emocional, el pendiente y la ausencia dentro del tope (lo que sobra se omite entero)', () => {
  const messages = backMsgs(ASK_AT, 'Estoy muy triste hoy, la entrevista salió fatal y lloré toda la tarde', 4 * DAY);
  const long = item({ text: 'Mañana tengo la entrevista de trabajo en la empresa grande de la ciudad vieja junto al río' });
  const { note } = buildPresence({ character: luna(fu(long)), messages, settings: { user: 'Edgar', followUps: true, emotionResponse: true }, now: new Date(ASK_AT), rnd: () => 0.99 });
  assert.ok(note.length <= PRESENCE_NOTE_MAX, `${note.length}`);
  assert.match(note, /sounds low right now/, 'el registro emocional tiene prioridad');
  assert.match(note, /single/);
});

test('HUM-004 buildPresence: si el usuario ya habla del tema, no pregunta y avisa para marcarlo atendido', () => {
  const r = buildPresence({ character: luna(fu(item())), messages: backMsgs(ASK_AT, 'La entrevista salió bien'), settings: { user: 'Edgar', followUps: true }, now: new Date(ASK_AT), rnd: () => 0.99 });
  assert.doesNotMatch(r.note, /mentioned/);
  assert.equal(r.followUp.topicCovered, true);
});

test('HUM-004 observations: el pendiente es la primera; sin él nada cambia', () => {
  const t0 = ASK_AT;
  const msgs = [{ role: 'char', text: 'Hola', ts: t0 - 3 * DAY }, { role: 'user', text: 'Volví', ts: t0 }];
  const out = observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', followUp: { text: 'mañana tengo el examen' }, rnd: () => 0.99 });
  assert.match(out[0], /^Edgar mentioned: "mañana tengo el examen"/);
  assert.match(out[1], /is back after 3 days/);
  assert.equal(observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', rnd: () => 0.99 }).length, 1);
  assert.match(followUpObservation({ text: 'x' }, 'A', 'B'), /^A mentioned: "x"\. B can ask how it went, once, in B's own words\.$/);
});

// ---------- fechas ----------

test('HUM-004 detectUserDates: el cumpleaños dicho explícitamente (ES/EN, mes con nombre); lo ambiguo o ajeno se ignora', () => {
  const ok = [
    ['Mi cumpleaños es el 12 de mayo', 5, 12], ['mi cumple es el 3 de octubre', 10, 3], ['cumplo años el 1 de enero', 1, 1], ['Mi cumpleaños es 25 de diciembre', 12, 25],
    ['my birthday is May 12', 5, 12], ['My birthday is on May 12th!', 5, 12], ['my birthday is on 12 May', 5, 12], ['my birthday is the 3rd of October', 10, 3], ['Mi cumpleaños es el 29 de febrero', 2, 29],
  ];
  for (const [text, month, day] of ok) assert.deepEqual(detectUserDates(text), [{ kind: 'birthday', month, day }], text);
  for (const text of [
    'Mi cumpleaños es el 12/05', 'my birthday is 12/05', 'el cumpleaños de mi mamá es el 12 de mayo', "her birthday is May 12", 'mi cumpleaños es el 31 de febrero', 'my birthday is on April 31',
    'mi cumpleaños es pronto', 'Cumplí años ayer', 'my birthday was great', 'mi cumpleaños es el 0 de mayo', '', null,
  ]) assert.deepEqual(detectUserDates(text), [], String(text));
});

test('HUM-004 withUserDates: guarda o reemplaza el cumpleaños y no reescribe si es el mismo', () => {
  const a = withUserDates(defaultFollowUps(), [{ kind: 'birthday', month: 5, day: 12 }], 100);
  assert.deepEqual(a.dates.map((d) => [d.kind, d.month, d.day, d.createdAt]), [['birthday', 5, 12, 100]]);
  assert.equal(withUserDates(a, [{ kind: 'birthday', month: 5, day: 12 }], 200), a);
  const b = withUserDates(a, [{ kind: 'birthday', month: 6, day: 1 }], 300);
  assert.deepEqual(b.dates.map((d) => [d.month, d.day]), [[6, 1]]);
  assert.equal(withUserDates(a, [], 1), a);
  assert.deepEqual(withUserDates(a, [{ kind: 'birthday', month: 13, day: 1 }], 1), a);
});

test('HUM-004 dateOccasion: cumpleaños (el que dijo el usuario) y aniversario del primer chat, una vez al año', () => {
  const created = new Date(2025, 9, 1, 10).getTime(); // 1 de octubre de 2025
  const character = { created, followUps: { items: [], dates: [{ kind: 'birthday', month: 5, day: 12, id: 'd', createdAt: 1 }] }, mailbox: { dateNotes: [] } };
  const ann = dateOccasion(character, new Date(2026, 9, 1, 9));
  assert.deepEqual(ann, { reason: 'anniversary', years: 1, key: 'anniversary:2026' });
  const bday = dateOccasion(character, new Date(2026, 4, 12, 9));
  assert.deepEqual(bday, { reason: 'birthday', years: 0, key: 'birthday:2026' });
  assert.equal(dateOccasion(character, new Date(2026, 4, 13)), null);
  assert.equal(dateOccasion(character, new Date(2025, 9, 1)), null, 'el mismo año de creación no es aniversario');
  assert.equal(dateOccasion({ ...character, mailbox: { dateNotes: ['anniversary:2026'] } }, new Date(2026, 9, 1)), null, 'ya se dejó la de este año');
  assert.equal(dateOccasion({ ...character, mailbox: { dateNotes: ['anniversary:2025'] } }, new Date(2026, 9, 1)).reason, 'anniversary', 'la de otro año no cuenta');
  assert.equal(dateOccasion({ created: 0 }, new Date(2026, 9, 1)), null);
  assert.equal(dateOccasion(null), null);
  assert.equal(dateOccasion({ created, followUps: undefined }, new Date(2028, 9, 1)).years, 3);
  assert.equal(dateNoteKey('birthday', 2026), 'birthday:2026');
});

test('HUM-004 occasionText: solo el motivo y los nombres (nada del usuario), en positivo y sin pronombres', () => {
  const b = occasionText({ reason: 'birthday', years: 0 }, 'Luna', 'Edgar');
  const a1 = occasionText({ reason: 'anniversary', years: 1 }, 'Luna', 'Edgar');
  const a3 = occasionText({ reason: 'anniversary', years: 3 }, 'Luna', 'Edgar');
  assert.equal(b, "Today is Edgar's birthday.");
  assert.match(a1, /one year together/);
  assert.match(a3, /3 years together/);
  for (const t of [b, a1, a3]) assert.doesNotMatch(t, /\b(he|she|they|him|her|them|his|their|you|your)\b/i);
  assert.equal(occasionText(null, 'L', 'E'), '');
});

// ---------- el buzón: nota por fecha ----------

const SENTINEL = 'SENTINELA-DE-UN-EPISODIO-entrevista-mañana';
function writerHarness({ character, settings = { user: 'Edgar', mode: 'chat', followUps: true }, now = new Date(2026, 9, 1, 9).getTime(), reply = 'smiles warmly* Happy anniversary to us, I am glad you are here today.' }) {
  const store = { character };
  const calls = { requests: [], saved: 0 };
  const writer = createMailboxWriter({
    loadCharacter: async () => store.character,
    loadSettings: async () => settings,
    listChatDates: async () => [{ updated: now - 5 * DAY }],
    complete: async (request) => { calls.requests.push(request); return reply; },
    verifyText: () => ({ ok: true }),
    updateMailbox: async (id, mutator) => { calls.saved++; store.character = { ...store.character, mailbox: mutator(store.character.mailbox) }; return store.character; },
    now: () => now,
    random: () => 0.5,
  });
  return { writer, store, calls };
}
const annChar = (extra = {}) => ({
  id: 'c1',
  card: { name: 'Luna', personality: 'Calm and warm.', description: 'A kind companion.' },
  created: new Date(2025, 9, 1, 10).getTime(),
  lorebook: [],
  mailbox: defaultMailbox(),
  followUps: { items: [{ ...item({ text: SENTINEL }) }], dates: [{ id: 'd', kind: 'birthday', month: 5, day: 12, createdAt: 1 }] },
  ...extra,
});

test('HUM-004 buzón: el aniversario deja UNA nota con motivo `anniversary`, sin recuerdos ni ausencia, y no se repite ese año', async () => {
  const h = writerHarness({ character: annChar() });
  const r = await h.writer.maybeRun('c1');
  assert.deepEqual([r.kind, r.reason], ['ok', 'anniversary']);
  const mb = sanitizeMailbox(h.store.character.mailbox);
  assert.equal(mb.notes.length, 1);
  assert.equal(mb.notes[0].reason, 'anniversary');
  assert.equal(mb.notes[0].status, 'new');
  assert.deepEqual(mb.dateNotes, ['anniversary:2026']);
  assert.equal(mb.lastNoteFor, 0, 'no toca el ritmo de la nota por ausencia');
  assert.equal(mb.attemptedAt, 0);
  const again = await h.writer.maybeRun('c1');
  assert.equal(again.kind, 'skipped');
  assert.equal(h.calls.requests.length, 1, 'no vuelve a llamar al modelo');
  assert.equal(h.store.character.mailbox.notes.length, 1);
});

test('HUM-004 REGLA DE PROACT-001: el pedido de una nota por fecha lleva solo el motivo y los nombres — ninguna frase de ningún episodio ni pendiente', async () => {
  const h = writerHarness({ character: annChar() });
  await h.writer.maybeRun('c1');
  const sent = JSON.stringify(h.calls.requests[0]);
  assert.ok(!sent.includes('SENTINELA'), 'el pendiente guardado no llega al modelo');
  assert.ok(!sent.includes('entrevista'));
  assert.match(sent, /Today is the anniversary of the day Luna and Edgar first met: one year together\./);
  assert.match(sent, /Special day:/);
  assert.doesNotMatch(sent, /HUM-004/);
  // con un recuerdo general sí puede entrar (es un recuerdo, no un episodio)
  const withMemory = writerHarness({ character: annChar({ lorebook: [{ id: 'l', keys: ['k'], content: 'Edgar loves tea', updated: 1, source: 'auto' }] }) });
  await withMemory.writer.maybeRun('c1');
  assert.match(JSON.stringify(withMemory.calls.requests[0]), /Edgar loves tea/);
  // el pedido sigue prohibiendo hablar de una conversación concreta
  assert.match(JSON.stringify(h.calls.requests[0]), /Do NOT refer to any specific earlier conversation/);
});

test('HUM-004 buzón: el cumpleaños dicho por el usuario deja su nota ese día; otro día, nada', async () => {
  const h = writerHarness({ character: annChar({ created: new Date(2026, 8, 20).getTime() }), now: new Date(2026, 4, 12, 9).getTime(), reply: 'laughs happily* Happy birthday, my dear Edgar, I hope the day is lovely.' });
  assert.deepEqual((await h.writer.maybeRun('c1')).reason, 'birthday');
  assert.match(JSON.stringify(h.calls.requests[0]), /Today is Edgar's birthday\./);
  assert.deepEqual(sanitizeMailbox(h.store.character.mailbox).dateNotes, ['birthday:2026']);
  const other = writerHarness({ character: annChar({ created: new Date(2026, 8, 20).getTime() }), now: new Date(2026, 4, 13, 9).getTime() });
  assert.equal((await other.writer.maybeRun('c1')).kind, 'skipped');
  assert.equal(other.calls.requests.length, 0);
});

test('HUM-004 buzón: con `followUps` apagado no hay nota por fecha; y la nota por ausencia de siempre sigue funcionando', async () => {
  const off = writerHarness({ character: annChar(), settings: { user: 'Edgar', mode: 'chat', followUps: false } });
  const r = await off.writer.maybeRun('c1');
  assert.equal(off.calls.requests.length, 0, 'sin interruptor: ni una llamada');
  assert.notEqual(r.reason, 'anniversary');
  // un día sin fecha y con ausencia: nota normal, con motivo `absence`
  const memories = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, keys: ['k'], content: `Edgar hecho ${i}`, updated: i, source: 'auto' }));
  const day = new Date(2026, 6, 15, 9).getTime();
  const abs = writerHarness({ character: annChar({ lorebook: memories }), now: day, reply: 'waves softly* Thinking of you today, I hope the day is gentle.' });
  const ra = await abs.writer.maybeRun('c1');
  assert.equal(ra.kind, 'ok');
  assert.equal(abs.store.character.mailbox.notes[0].reason, 'absence');
  assert.deepEqual(abs.store.character.mailbox.dateNotes, []);
});

test('HUM-004 buzón: si la nota por fecha no pasa la verificación no se deja nada y se espera (como la nota por ausencia)', async () => {
  const h = writerHarness({ character: annChar(), reply: 'sorry, as an ai I cannot do that' });
  const r = await h.writer.maybeRun('c1');
  assert.equal(r.kind, 'unverified');
  assert.equal(h.store.character.mailbox.notes.length, 0);
  assert.ok(h.store.character.mailbox.attemptedAt > 0);
  assert.equal(dateNoteDue(h.store.character, new Date(2026, 9, 1, 10)), null, 'no se reintenta enseguida');
  assert.ok(dateNoteDue(h.store.character, new Date(new Date(2026, 9, 1, 9).getTime() + MAILBOX_RETRY_AFTER_FAILED_MS + HOUR)), 'más tarde ese mismo día sí');
});

test('HUM-004 withDateNote: respeta el tope de notas y la lista de claves, sin tocar lastNoteFor', () => {
  let mb = { ...defaultMailbox(), lastNoteFor: 77, attemptedAt: 5 };
  for (let i = 0; i < 12; i++) mb = withDateNote(mb, `*sonríe* nota número ${i} para ti`, 1000 + i, { reason: 'birthday', key: `birthday:${2000 + i}` });
  assert.equal(mb.notes.length, 10);
  assert.equal(mb.dateNotes.length, DATE_NOTES_MAX);
  assert.equal(mb.dateNotes.at(-1), 'birthday:2011');
  assert.deepEqual([mb.lastNoteFor, mb.attemptedAt], [77, 5]);
  assert.equal(sanitizeMailbox({ dateNotes: ['birthday:2026', 'basura', 5, 'x:1', 'anniversary:2025'] }).dateNotes.join(), 'birthday:2026,anniversary:2025');
  assert.equal(sanitizeMailbox({ notes: [{ text: 'una nota larga de prueba', reason: 'otro' }] }).notes[0].reason, 'absence');
});

test('HUM-004 mailboxInstruction: sin ocasión es EXACTAMENTE la de siempre', () => {
  const base = { charName: 'Luna', userName: 'Edgar', personality: 'Calm', description: '', identity: '', relationship: '', memories: [{ content: 'Edgar likes tea' }], elapsed: 'several hours have passed', timeNote: 'It is a morning.' };
  const a = mailboxInstruction(base);
  assert.equal(mailboxInstruction({ ...base, occasion: '' }), a);
  assert.match(a, /You may lightly feel that time has passed/);
  assert.doesNotMatch(a, /Special day/);
  const b = mailboxInstruction({ ...base, occasion: "Today is Edgar's birthday." });
  assert.match(b, /Special day: Today is Edgar's birthday\. Mention it warmly in one short line, in Luna's own words, and never count hours or minutes, and never reproach\./);
  assert.doesNotMatch(b, /You may lightly feel that time has passed/);
});

test('HUM-004 mailboxDue: la nota por ausencia no cambió', () => {
  const memories = Array.from({ length: 6 }, (_, i) => ({ id: `l${i}`, keys: ['k'], content: `Edgar hecho ${i}`, updated: i, source: 'auto' }));
  assert.equal(mailboxDue({ lorebook: memories, mailbox: {} }, NOW.getTime() - 10 * HOUR, NOW.getTime()).due, true);
});

// ---------- duplicar ----------

test('HUM-004 duplicar un personaje reinicia pendientes y cumpleaños (y las claves de fechas del buzón)', () => {
  const dup = duplicateCharacterData({ ...annChar(), name: 'Luna', mailbox: { ...defaultMailbox(), dateNotes: ['birthday:2026'] }, identity: {}, relationship: {} });
  assert.deepEqual(dup.followUps, defaultFollowUps());
  assert.deepEqual(dup.mailbox.dateNotes, []);
});

// ---------- paso por generateReply ----------

test('HUM-004 generateReply: el pendiente vencido viaja en la nota final y vuelve en `result.followUp`; con el interruptor apagado, nada', async () => {
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
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const now = new Date(ASK_AT);
    const card = { name: 'Luna', description: '', personality: 'Calm.', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
    const character = { id: 'c1', name: 'Luna', avatar: '', card, lorebook: [], personalityTags: [], followUps: fu(item()) };
    const messages = backMsgs(ASK_AT);
    const on = await generateReply({ character, messages, settings: { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url: base, humanTouch: true, followUps: true }, now, rnd: () => 0.99 });
    assert.match(seen.body.messages.at(-1).content, /Edgar mentioned: "Mañana tengo la entrevista"/);
    assert.deepEqual(on.followUp, { id: 'f1', topicCovered: false, askedFor: ASK_AT });
    const off = await generateReply({ character, messages, settings: { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url: base, humanTouch: true, followUps: false }, now, rnd: () => 0.99 });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /mentioned/);
    assert.equal(off.followUp, null);
    const noPresence = await generateReply({ character, messages, settings: { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url: base, humanTouch: false, followUps: true }, now });
    assert.equal(noPresence.followUp, null);
  } finally {
    server.close();
  }
});

// ---------- conexión en el chat y en el hub ----------

test('HUM-004 chat.js y hub: la captura corre al enviar sin red ni modelo; el marcado solo tras guardar la respuesta; las notas por fecha salen del hub', () => {
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /captureFollowUps\(text\)/);
  assert.match(chat, /if \(followUpUsed && character && reply\.text\) markFollowUp\(followUpUsed\)/);
  const cap = chat.slice(chat.indexOf('function captureFollowUps'), chat.indexOf('// HUM-003: detector sin modelo'));
  assert.match(cap, /settings\.followUps !== true/);
  assert.match(cap, /if \(!found\.length && !dates\.length\) return;/, 'solo escribe si detectó algo');
  assert.doesNotMatch(cap, /fetch|generateReply|completeOnce|completeChatOnce/);
  const mailbox = readFileSync(new URL('../www/js/ui/mailbox.js', import.meta.url), 'utf8');
  assert.match(mailbox, /dateNoteDue\(character, new Date\(\)\)/);
  const src = readFileSync(new URL('../www/js/api/followups.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert.doesNotMatch(src, /fetch\(|complete\(|kobold/);
});
