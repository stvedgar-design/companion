// tests/moments.test.mjs — HUM-003: recuerdos de MOMENTOS (lorebook con `kind:'moment'`, tono de lista cerrada y fecha).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createState } from '../www/js/state.js';
import { FEELING_WORDS } from '../www/js/api/feeling.js';
import { emotionPeak, PEAK_STRENGTH } from '../www/js/api/emotion.js';
import {
  MOMENT_TONES, MOMENT_TONE_IDS, EMOTION_TO_TONE, parseMomentTone, momentToneLabel, isMoment, sanitizeMomentFields, momentWhen, momentPromptLine,
} from '../www/js/api/moment-tones.js';
import { momentCandidate, withMoment, momentQuote, MOMENT_MIN_GAP_MS, MOMENT_QUOTE_MAX } from '../www/js/api/moments.js';
import {
  buildExtractionPrompt, parseExtractionResponse, applyExtraction, formatLoreBlock, buildLoreBlocks, mergeNearDuplicates, cleanupLorebook,
  archiveLoreEntry, restoreLoreEntry, editLoreEntry, createLoreUpdater, latestEmotionalPeak, MOMENT_MAX, MOMENT_SAME_WINDOW_MS,
  LOREBOOK_MAX_ENTRIES, LOREBOOK_MAX_ENTRY_CHARS, LOREBOOK_EXTRACT_PREFILL,
} from '../www/js/api/lorebook.js';
import { pickMailboxMemories, mailboxDue } from '../www/js/api/mailbox.js';
import { generateReply } from '../www/js/api/kobold.js';
import { momentCardLabel } from '../www/js/ui/character-memory.js';
import { duplicateCharacterData } from '../www/js/ui/character-sheet.js';

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const NOW = new Date(2026, 9, 3, 15, 0).getTime();
const NAMES = ['Luna', 'Edgar'];
const fact = (id, content, extra = {}) => ({ id, keys: [content.split(' ').pop().toLowerCase()], content, updated: 1, source: 'auto', ...extra });
const moment = (id, tone, at, extra = {}) => ({ id, keys: ['x'], content: `Edgar was feeling sad and told Luna: "algo ${id}"`, updated: at, source: 'auto', kind: 'moment', tone, at, ...extra });
const SAD_TEXT = 'Estoy muy triste hoy, la entrevista salió fatal y lloré toda la tarde';
const settingsOn = { user: 'Edgar', momentMemories: true };
const luna = (extra = {}) => ({ id: 'cl', name: 'Luna', card: { name: 'Luna' }, lorebook: [], lorebookTombstones: [], ...extra });

// ---------- lista cerrada ----------

test('HUM-003 la lista de tonos es CERRADA y es un subconjunto de la de feeling.js (mismas palabras y etiquetas)', () => {
  const byWord = new Map(FEELING_WORDS.map((f) => [f.word, f.label]));
  for (const t of MOMENT_TONES) assert.equal(byWord.get(t.tone), t.label, `${t.tone} existe en FEELING_WORDS con la misma etiqueta`);
  assert.equal(MOMENT_TONE_IDS.length, new Set(MOMENT_TONE_IDS).size);
  for (const tone of Object.values(EMOTION_TO_TONE)) assert.ok(MOMENT_TONE_IDS.includes(tone), tone);
  assert.equal(EMOTION_TO_TONE.tired, undefined, 'el cansancio no es un momento');
});

test('HUM-003 parseMomentTone: acepta la palabra y los alias en adjetivo; todo lo demás es "" (nunca se inventa una emoción)', () => {
  assert.equal(parseMomentTone('sadness'), 'sadness');
  assert.equal(parseMomentTone(' Sad. '), 'sadness');
  assert.equal(parseMomentTone('PROUD'), 'pride');
  assert.equal(parseMomentTone('anxious'), 'anxiety');
  for (const bad of ['rage', 'melancholy', '', 'sad and angry', null, undefined, 3, {}]) assert.equal(parseMomentTone(bad), '', String(bad));
  assert.equal(momentToneLabel('sadness'), 'tristeza');
  assert.equal(momentToneLabel('nope'), '');
});

test('HUM-003 sanitizeMomentFields / isMoment: solo `kind:"moment"` con tono válido; todo lo anterior es un hecho', () => {
  assert.deepEqual(sanitizeMomentFields({ kind: 'moment', tone: 'joy', at: 5 }), { kind: 'moment', tone: 'joy', at: 5 });
  assert.deepEqual(sanitizeMomentFields({ kind: 'moment', tone: 'sad' }), { kind: 'moment', tone: 'sadness' });
  for (const bad of [undefined, null, {}, { kind: 'moment' }, { kind: 'moment', tone: 'rage' }, { kind: 'fact', tone: 'joy' }, { tone: 'joy' }, 'x']) {
    assert.deepEqual(sanitizeMomentFields(bad), {}, JSON.stringify(bad));
  }
  assert.deepEqual(sanitizeMomentFields({ kind: 'moment', tone: 'joy', at: 'ayer' }), { kind: 'moment', tone: 'joy' });
  assert.equal(isMoment(moment('a', 'sadness', 1)), true);
  assert.equal(isMoment(fact('f', 'Edgar likes tea')), false);
  assert.equal(isMoment({ kind: 'moment', tone: 'rage' }), false);
  assert.equal(isMoment(null), false);
});

test('HUM-003 momentWhen: aproximado y en inglés, nunca una fecha exacta', () => {
  assert.equal(momentWhen(NOW - HOUR, NOW), 'earlier today');
  assert.equal(momentWhen(NOW - DAY, NOW), 'yesterday');
  assert.equal(momentWhen(NOW - 3 * DAY, NOW), 'a few days ago');
  assert.equal(momentWhen(NOW - 10 * DAY, NOW), 'a couple of weeks ago');
  assert.equal(momentWhen(NOW - 40 * DAY, NOW), 'a few weeks ago');
  assert.equal(momentWhen(NOW - 200 * DAY, NOW), 'a while back');
  assert.equal(momentWhen(0, NOW), '');
  assert.equal(momentWhen(NOW, NaN), '');
  assert.equal(momentPromptLine({ tone: 'sadness', at: NOW - 3 * DAY, content: 'Edgar was sad' }, NOW), '(sadness, a few days ago) Edgar was sad');
  assert.equal(momentPromptLine({ tone: 'sadness', content: 'Edgar was sad' }, NOW), '(sadness) Edgar was sad');
});

// ---------- picos ----------

test('HUM-003 emotionPeak: una emoción intensa y con algo que contar; lo suave, lo corto y el cansancio no', () => {
  assert.equal(emotionPeak(SAD_TEXT).emotion, 'sad');
  assert.equal(emotionPeak('Me gradué hoy y estoy muy orgulloso de mí mismo').emotion, 'proud');
  assert.ok(emotionPeak(SAD_TEXT).strength >= PEAK_STRENGTH);
  assert.equal(emotionPeak('estoy triste'), null, 'muy corto y suave');
  assert.equal(emotionPeak('hoy estoy un poco triste, nada más'), null, 'una sola pista sin intensificador no es un pico');
  assert.equal(emotionPeak('Estoy muy cansado, agotado, no doy más con tanto trabajo hoy'), null, 'el cansancio no es un momento');
  assert.equal(emotionPeak('solo quiero hablar contigo un rato de cualquier cosa'), null);
  assert.equal(emotionPeak('no estoy triste, estoy muy bien hoy gracias a todo esto'), null);
  assert.equal(emotionPeak(''), null);
});

test('HUM-003 latestEmotionalPeak: el mensaje MÁS RECIENTE del usuario con un pico, con su fecha', () => {
  const msgs = [
    { role: 'user', text: 'Estoy muy contento, lo logré, me gradué hoy por fin', ts: 10 },
    { role: 'char', text: 'Qué bien', ts: 11 },
    { role: 'user', text: SAD_TEXT, ts: 12 },
    { role: 'user', text: 'ok', ts: 13 },
  ];
  assert.deepEqual(latestEmotionalPeak(msgs), { emotion: 'sad', ts: 12 });
  assert.equal(latestEmotionalPeak([{ role: 'char', text: SAD_TEXT, ts: 1 }]), null, 'solo cuentan los mensajes del usuario');
  assert.equal(latestEmotionalPeak([]), null);
  assert.equal(latestEmotionalPeak(null), null);
});

// ---------- (b) detector sin modelo ----------

test('HUM-003 momentCandidate: un pico triste da un momento con tono, fecha, cita literal y keys del tema + del tono', () => {
  const messages = [{ role: 'char', text: 'Hola', ts: NOW - 5000 }, { role: 'user', text: SAD_TEXT, ts: NOW }];
  const c = momentCandidate({ messages, character: luna(), settings: settingsOn, now: NOW });
  assert.equal(c.tone, 'sadness');
  assert.equal(c.at, NOW);
  assert.match(c.content, /^Edgar was feeling sad and told Luna: "Estoy muy triste hoy/);
  assert.ok(c.content.includes('lloré toda la tarde'), 'la cita es literal');
  assert.ok(c.keys.length >= 2 && c.keys.length <= 4, c.keys.join());
  assert.ok(c.keys.includes('triste') && c.keys.includes('sad'), 'las keys del tono (los dos idiomas)');
  assert.ok(!c.keys.some((k) => /luna|edgar/i.test(k)), 'sin nombres como keys');
  assert.ok(c.content.length <= LOREBOOK_MAX_ENTRY_CHARS);
  // fuera de la cita no hay pronombres de primera persona ni ninguno: solo nombres
  assert.doesNotMatch(c.content.replace(/"[^"]*"/, ''), /\b(I|me|my|he|she|they|him|her|them|his|their)\b/i);
});

test('HUM-003 momentCandidate: sin interruptor, sin pico o sin mensajes del usuario, nada', () => {
  const messages = [{ role: 'user', text: SAD_TEXT, ts: NOW }];
  assert.equal(momentCandidate({ messages, character: luna(), settings: { user: 'Edgar' }, now: NOW }), null);
  assert.equal(momentCandidate({ messages, character: luna(), settings: { user: 'Edgar', momentMemories: false }, now: NOW }), null);
  assert.equal(momentCandidate({ messages: [{ role: 'user', text: 'Cuéntame algo de tu día, por favor', ts: NOW }], character: luna(), settings: settingsOn, now: NOW }), null);
  assert.equal(momentCandidate({ messages: [{ role: 'char', text: SAD_TEXT, ts: NOW }], character: luna(), settings: settingsOn, now: NOW }), null);
  assert.equal(momentCandidate({ messages, character: null, settings: settingsOn, now: NOW }), null);
  assert.equal(momentCandidate({}), null);
});

test('HUM-003 momentCandidate: como mucho un momento automático cada 6 h; uno manual no frena', () => {
  const messages = [{ role: 'user', text: SAD_TEXT, ts: NOW }];
  const recent = luna({ lorebook: [moment('m1', 'joy', NOW - 2 * HOUR)] });
  assert.equal(momentCandidate({ messages, character: recent, settings: settingsOn, now: NOW }), null);
  const old = luna({ lorebook: [moment('m1', 'joy', NOW - MOMENT_MIN_GAP_MS - HOUR)] });
  assert.ok(momentCandidate({ messages, character: old, settings: settingsOn, now: NOW }));
  const manual = luna({ lorebook: [moment('m1', 'joy', NOW - HOUR, { source: 'manual' })] });
  assert.ok(momentCandidate({ messages, character: manual, settings: settingsOn, now: NOW }), 'un momento escrito a mano no cuenta como automático');
});

test('HUM-003 momentCandidate: respeta las lápidas (lo archivado no vuelve)', () => {
  const messages = [{ role: 'user', text: SAD_TEXT, ts: NOW }];
  const first = momentCandidate({ messages, character: luna(), settings: settingsOn, now: NOW });
  const tomb = luna({ lorebookTombstones: [{ content: first.content, keys: first.keys, at: 1 }] });
  assert.equal(momentCandidate({ messages, character: tomb, settings: settingsOn, now: NOW }), null);
});

test('HUM-003 momentQuote: sin asteriscos ni saltos, comillas simples y corta en una palabra entera', () => {
  assert.equal(momentQuote('*llora* "no puedo\nmás"'), "llora 'no puedo más'");
  const long = momentQuote('palabra '.repeat(40));
  assert.ok(long.length <= MOMENT_QUOTE_MAX + 1 && long.endsWith('…'));
  assert.doesNotMatch(long, /palabr…/);
  assert.equal(momentQuote(''), '');
});

test('HUM-003 withMoment: añade sin mutar; respeta el tope de momentos y el de entradas; nunca toca lo manual', () => {
  const cand = { content: 'Edgar was feeling sad and told Luna: "x"', keys: ['sad', 'triste'], tone: 'sadness', at: NOW };
  const base = [fact('f1', 'Edgar likes tea')];
  const out = withMoment(base, cand, NOW, () => 'new');
  assert.equal(out.length, 2);
  assert.equal(base.length, 1, 'no muta');
  assert.deepEqual(out[1], { id: 'new', keys: ['sad', 'triste'], content: cand.content, updated: NOW, source: 'auto', kind: 'moment', tone: 'sadness', at: NOW });
  // dos a menos de 6 h: el segundo no entra (relectura bajo el candado)
  assert.equal(withMoment(out, { ...cand, content: 'otro', at: NOW + HOUR }, NOW), null);
  assert.equal(withMoment(out, cand, NOW), null, 'ni el mismo texto');
  // tope de momentos
  const many = Array.from({ length: MOMENT_MAX }, (_, i) => moment(`m${i}`, 'joy', NOW - (i + 1) * DAY));
  const capped = withMoment(many, cand, NOW, () => 'new');
  assert.equal(capped.filter(isMoment).length, MOMENT_MAX);
  assert.ok(!capped.some((e) => e.id === `m${MOMENT_MAX - 1}`), 'sale el más antiguo');
  assert.ok(capped.some((e) => e.id === 'new'));
  // todos manuales: no cabe → null y nada se pierde
  const manual = Array.from({ length: MOMENT_MAX }, (_, i) => moment(`m${i}`, 'joy', NOW - (i + 1) * DAY, { source: 'manual' }));
  assert.equal(withMoment(manual, cand, NOW), null);
  // tope de entradas: sale primero un momento automático, luego el hecho automático más antiguo
  const full = Array.from({ length: LOREBOOK_MAX_ENTRIES }, (_, i) => fact(`f${i}`, `Edgar hecho número ${i} importante`, { updated: i + 1 }));
  const withRoom = withMoment(full, cand, NOW, () => 'new');
  assert.equal(withRoom.length, LOREBOOK_MAX_ENTRIES);
  assert.ok(!withRoom.some((e) => e.id === 'f0') && withRoom.some((e) => e.id === 'new'));
  const fullManual = full.map((e) => ({ ...e, source: 'manual' }));
  assert.equal(withMoment(fullManual, cand, NOW), null, 'si todo es manual no se quita nada');
});

// ---------- inyección ----------

test('HUM-003 formatLoreBlock: sin momentos el texto es IDÉNTICO al de siempre; con momentos van aparte, en positivo y sin pronombres', () => {
  const facts = [fact('f1', 'Edgar likes tea'), fact('f2', 'Edgar has two cats')];
  assert.equal(formatLoreBlock(facts), 'Known facts (from memory):\n- Edgar likes tea\n- Edgar has two cats');
  assert.equal(formatLoreBlock([]), '');
  const m = moment('m1', 'sadness', NOW - 3 * DAY);
  const both = formatLoreBlock([facts[0], m], { now: NOW });
  assert.match(both, /^Known facts \(from memory\):\n- Edgar likes tea\n\nShared moments \(/);
  assert.ok(both.includes('- (sadness, a few days ago) Edgar was feeling sad'));
  const onlyMoment = formatLoreBlock([m], { now: NOW });
  assert.ok(onlyMoment.startsWith('Shared moments ('));
  assert.ok(!onlyMoment.includes('Known facts'));
  const heading = onlyMoment.split('\n')[0];
  assert.match(heading, /may recall one naturally, in the character's own words, when the moment fits/);
  assert.doesNotMatch(heading, /\b(he|she|they|him|her|them|his|their|its?|you|your)\b/i);
  assert.doesNotMatch(heading, /\b(never|not|no|without|avoid|stop|don't)\b|n't\b/i);
});

test('HUM-003 buildLoreBlocks: un momento sale por tema (keys), con su tono y su "cuándo", y cuenta como recuerdo usado', () => {
  const entries = [fact('f1', 'Edgar likes tea', { keys: ['tea'] }), moment('m1', 'sadness', NOW - DAY, { keys: ['entrevista', 'triste'] })];
  const out = buildLoreBlocks(entries, [{ role: 'user', text: 'Hoy tengo otra entrevista', ts: NOW }], { now: NOW });
  assert.ok(out.topic.includes('(sadness, yesterday)'));
  assert.ok(!out.topic.includes('Edgar likes tea'));
  assert.equal(out.used.length, 1);
  assert.equal(out.used[0].id, 'm1');
  const none = buildLoreBlocks(entries, [{ role: 'user', text: 'nada que ver', ts: NOW }], { now: NOW });
  assert.equal(none.topic, '');
});

// ---------- (a) extracción con modelo ----------

const existing = [fact('f1', 'Edgar likes tea', { keys: ['tea'] })];
const win = [{ role: 'user', text: SAD_TEXT, ts: NOW }, { role: 'char', text: 'Aquí estoy', ts: NOW + 1 }];
const lunaCard = { card: { name: 'Luna' } };

test('HUM-003 buildExtractionPrompt: sin pico es IDÉNTICO al de siempre; con pico pide 2 hechos + 1 momento de la lista cerrada', () => {
  const base = buildExtractionPrompt(lunaCard, { user: 'Edgar', ctx: 4096 }, win, existing);
  assert.equal(buildExtractionPrompt(lunaCard, { user: 'Edgar', ctx: 4096 }, win, existing, {}), base);
  assert.equal(buildExtractionPrompt(lunaCard, { user: 'Edgar', ctx: 4096 }, win, existing, { moment: false }), base);
  assert.match(base, /up to 3 NEW concrete facts/);
  assert.doesNotMatch(base, /emotional moment/);
  const withMoments = buildExtractionPrompt(lunaCard, { user: 'Edgar', ctx: 4096 }, win, existing, { moment: true });
  assert.match(withMoments, /up to 2 NEW concrete facts/);
  assert.match(withMoments, /emotional moment/);
  for (const t of MOMENT_TONE_IDS) assert.ok(withMoments.includes(t), t);
  assert.ok(withMoments.endsWith(`Reply:\n${LOREBOOK_EXTRACT_PREFILL}`));
  // costo en tokens del párrafo extra (heurística de 3 caracteres por token del módulo)
  const extra = withMoments.length - base.length;
  assert.ok(extra > 0 && extra < 800, `el párrafo extra mide ${extra} caracteres (~${Math.round(extra / 3)} tokens)`);
});

test('HUM-003 parseExtractionResponse: pasa el tono solo si viene (la forma de siempre no cambia)', () => {
  const plain = parseExtractionResponse('[{"k":["a"],"c":"hecho uno"}]');
  assert.deepEqual(plain, [{ keys: ['a'], content: 'hecho uno' }]);
  const withTone = parseExtractionResponse('[{"k":["a"],"c":"hecho uno","t":"sadness"},{"k":["b"],"c":"otro","tone":"joy"}]');
  assert.deepEqual(withTone.map((e) => e.tone), ['sadness', 'joy']);
  const truncated = parseExtractionResponse('[{"k":["a"],"c":"hecho uno"},{"k":["b"],"c":"momento","t":"sad');
  assert.deepEqual(truncated, [{ keys: ['a'], content: 'hecho uno' }]);
});

const excerpt = 'Edgar: Estoy muy triste hoy, la entrevista salió fatal y lloré toda la tarde\nLuna: Aquí estoy';
const modelMoment = [{ keys: ['entrevista'], content: 'Edgar estaba muy triste porque la entrevista salió fatal y Luna se quedó cerca', tone: 'sadness' }];

test('HUM-003 applyExtraction: con allowMoments un tono válido entra como momento con su fecha; sin él (o con un tono inventado) es un hecho', () => {
  const opts = { now: NOW, ignoreKeys: NAMES, excerptText: excerpt };
  const on = applyExtraction(existing, modelMoment, { ...opts, allowMoments: true, momentAt: NOW - HOUR });
  const m = on.entries.find((e) => e.kind === 'moment');
  assert.ok(m, 'hay un momento');
  assert.equal(m.tone, 'sadness');
  assert.equal(m.at, NOW - HOUR);
  assert.equal(m.source, 'auto');
  assert.equal(on.added, 1);
  assert.deepEqual(m.keys, ['entrevista', 'sad', 'triste'], 'tema del modelo + keys del tono');
  const off = applyExtraction(existing, modelMoment, opts);
  assert.ok(off.entries.every((e) => !e.kind && !e.tone), 'con los momentos apagados es un hecho de siempre');
  const fake = applyExtraction(existing, [{ ...modelMoment[0], tone: 'rage' }], { ...opts, allowMoments: true });
  assert.ok(fake.entries.every((e) => !e.kind), 'un tono inventado no crea un momento');
  const alias = applyExtraction(existing, [{ ...modelMoment[0], tone: 'sad' }], { ...opts, allowMoments: true });
  assert.equal(alias.entries.find((e) => e.kind === 'moment').tone, 'sadness');
});

test('HUM-003 applyExtraction: el filtro de fundamento sigue valiendo para los momentos (nada que no esté en los mensajes)', () => {
  const invented = [{ keys: ['viaje'], content: 'Edgar planned a trip to Japan with the whole family next summer', tone: 'joy' }];
  const out = applyExtraction(existing, invented, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true });
  assert.equal(out.entries.length, existing.length);
  assert.deepEqual(out.rejected, [{ reason: 'ungrounded' }]);
  const tomb = applyExtraction(existing, modelMoment, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, tombstones: [{ content: modelMoment[0].content, keys: ['entrevista'], at: 1 }] });
  assert.deepEqual(tomb.rejected, [{ reason: 'tombstone' }]);
});

test('HUM-003 applyExtraction: un solo momento por llamada; uno del mismo tono dentro de 6 h se REEMPLAZA (la frase del modelo gana a la plantilla), no se duplica', () => {
  const two = [
    modelMoment[0],
    { keys: ['lloré'], content: 'Edgar lloró toda la tarde después de la entrevista que salió fatal', tone: 'sadness' },
  ];
  const one = applyExtraction([], two, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, momentAt: NOW });
  assert.equal(one.entries.filter(isMoment).length, 1);
  const template = moment('t1', 'sadness', NOW - 2 * HOUR, { content: 'Edgar was feeling sad and told Luna: "Estoy muy triste hoy"' });
  const replaced = applyExtraction([template], modelMoment, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, momentAt: NOW });
  assert.equal(replaced.entries.length, 1, 'no se duplicó');
  assert.equal(replaced.entries[0].id, 't1');
  assert.deepEqual(replaced.entries[0].keys, ['entrevista', 'sad', 'triste', 'x'], 'suma las keys del tono a las que tenía');
  assert.match(replaced.entries[0].content, /entrevista salió fatal/);
  assert.equal(replaced.updated, 1);
  assert.equal(replaced.added, 0);
  const farther = applyExtraction([moment('t2', 'sadness', NOW - MOMENT_SAME_WINDOW_MS - HOUR)], modelMoment, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, momentAt: NOW });
  assert.equal(farther.entries.filter(isMoment).length, 2, 'otro día, otro momento');
});

test('HUM-003 applyExtraction: un hecho nunca se fusiona con un momento (ni cambia su texto), aunque compartan keys', () => {
  const m = moment('m1', 'sadness', NOW - DAY, { keys: ['entrevista', 'triste'], content: 'Edgar was feeling sad and told Luna: "la entrevista salió fatal"' });
  const incomingFact = [{ keys: ['entrevista'], content: 'Edgar was feeling sad and told Luna the entrevista salió fatal hoy' }];
  const out = applyExtraction([m], incomingFact, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt });
  assert.equal(out.entries.length, 2);
  assert.equal(out.entries.find((e) => e.id === 'm1').content, m.content, 'el momento queda intacto');
  assert.equal(out.entries.filter(isMoment).length, 1);
});

test('HUM-003 applyExtraction: tope de momentos — sale el automático más antiguo, nunca uno manual ni el recién tocado', () => {
  const full = Array.from({ length: MOMENT_MAX }, (_, i) => moment(`m${i}`, 'joy', NOW - (i + 2) * DAY, { content: `Edgar was feeling happy ${i} and told Luna: "momento ${i}"` }));
  const out = applyExtraction(full, modelMoment, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, momentAt: NOW });
  assert.equal(out.entries.filter(isMoment).length, MOMENT_MAX);
  assert.ok(!out.entries.some((e) => e.id === `m${MOMENT_MAX - 1}`));
  const manual = full.map((e) => ({ ...e, source: 'manual' }));
  const kept = applyExtraction(manual, modelMoment, { now: NOW, ignoreKeys: NAMES, excerptText: excerpt, allowMoments: true, momentAt: NOW });
  assert.equal(kept.entries.filter((e) => e.source === 'manual').length, MOMENT_MAX, 'lo manual no se toca');
});

test('HUM-003 "Limpiar recuerdos": un momento no se fusiona con otro ni con un hecho', () => {
  const a = moment('m1', 'sadness', NOW - DAY, { content: 'Edgar was feeling sad and told Luna: "la entrevista salió fatal"', keys: ['entrevista', 'triste'] });
  const b = moment('m2', 'sadness', NOW - 3 * DAY, { content: 'Edgar was feeling sad and told Luna: "la entrevista salió fatal"', keys: ['entrevista', 'triste'] });
  const f = fact('f1', 'Edgar was feeling sad and told Luna la entrevista salió fatal');
  assert.equal(mergeNearDuplicates([a, b, f], { names: NAMES, now: NOW }).merged, 0);
  const cleaned = cleanupLorebook([a, b, f], { names: NAMES, now: NOW });
  assert.equal(cleaned.entries.filter(isMoment).length, 2);
  assert.ok(cleaned.entries.filter(isMoment).every((e) => e.tone === 'sadness' && e.at > 0), 'conservan tono y fecha');
});

test('HUM-003 archivar, restaurar y editar conservan tono, fecha y tipo', () => {
  const m = moment('m1', 'pride', NOW - DAY);
  const { entries, archive } = archiveLoreEntry([m], [], 'm1', NOW);
  assert.equal(entries.length, 0);
  assert.equal(archive[0].kind, 'moment');
  const back = restoreLoreEntry(entries, archive, 'm1', NOW).entries[0];
  assert.deepEqual([back.kind, back.tone, back.at], ['moment', 'pride', m.at]);
  const edited = editLoreEntry([m], 'm1', { content: 'Edgar was proud of the day', keys: ['orgullo'] }, NOW)[0];
  assert.deepEqual([edited.kind, edited.tone, edited.at, edited.source], ['moment', 'pride', m.at, 'manual']);
});

// ---------- el actualizador (a) de punta a punta con dependencias simuladas ----------

function harness({ settings, reply, messages }) {
  const calls = { prompts: [], saved: [] };
  const store = { lorebook: [] };
  const updater = createLoreUpdater({
    getContext: () => ({ character: { id: 'cl', card: { name: 'Luna' } }, chat: { id: 'ch', lorebookMessageCount: 0 }, messages, settings: { user: 'Edgar', ctx: 4096, ...settings } }),
    isChatBusy: () => false,
    complete: async (prompt) => { calls.prompts.push(prompt); return reply; },
    loadLorebook: async () => store.lorebook,
    saveLorebook: async (id, entries) => { calls.saved.push(entries); store.lorebook = entries; },
    markProgress: async () => {},
  });
  return { updater, calls, store };
}
const chatMsgs = [
  { role: 'user', text: SAD_TEXT, ts: NOW - HOUR },
  { role: 'char', text: 'Aquí estoy contigo', ts: NOW - HOUR + 1 },
  { role: 'user', text: 'Gracias por escucharme', ts: NOW - 10 },
  { role: 'char', text: 'Siempre', ts: NOW - 5 },
];
const momentReply = '{"k":["entrevista"],"c":"Edgar estaba muy triste porque la entrevista salió fatal y Luna se quedó cerca","t":"sadness"}]';

test('HUM-003 createLoreUpdater: con momentMemories y un pico en la ventana, "Actualizar memoria" guarda el momento con tono y la fecha del mensaje', async () => {
  const h = harness({ settings: { momentMemories: true }, reply: momentReply, messages: chatMsgs });
  const r = await h.updater.runNow();
  assert.equal(r.kind, 'ok');
  assert.match(h.calls.prompts[0], /emotional moment/);
  const m = h.store.lorebook[0];
  assert.deepEqual([m.kind, m.tone, m.at], ['moment', 'sadness', NOW - HOUR]);
});

test('HUM-003 createLoreUpdater: con el interruptor apagado el prompt es el de siempre y el "tono" del modelo se ignora (queda un hecho)', async () => {
  const h = harness({ settings: { momentMemories: false }, reply: momentReply, messages: chatMsgs });
  await h.updater.runNow();
  assert.doesNotMatch(h.calls.prompts[0], /emotional moment/);
  assert.equal(h.store.lorebook[0].kind, undefined);
  const calm = harness({ settings: { momentMemories: true }, reply: momentReply, messages: chatMsgs.map((m) => ({ ...m, text: m.role === 'user' ? 'Edgar toca la guitarra los domingos entrevista' : m.text })) });
  await calm.updater.runNow();
  assert.doesNotMatch(calm.calls.prompts[0], /emotional moment/, 'sin pico en la ventana, tampoco se pide');
  assert.equal(calm.store.lorebook[0] && calm.store.lorebook[0].kind, undefined);
});

// ---------- datos viejos y guardado ----------

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
const rawCharacter = (lorebook) => ({ id: 'c1', name: 'Mia', avatar: 'data:image/png;base64,AAAA', card: { name: 'Mia' }, created: 1, lorebook });

test('HUM-003 migración: un personaje con recuerdos SIN kind/tone carga igual, como hechos; un tono inválido también cae en hecho', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', rawCharacter([
    { id: 'a', keys: ['perro'], content: 'El perro se llama Bruno', updated: 5, source: 'auto' },
    { id: 'b', keys: ['x'], content: 'algo raro', updated: 6, source: 'auto', kind: 'moment', tone: 'rage', at: 9 },
    { id: 'c', keys: ['y'], content: 'otra cosa', updated: 7, source: 'manual', kind: 'moment', tone: 'joy' },
  ]));
  const c = await state.getCharacter('c1');
  assert.equal(c.lorebook.length, 3);
  assert.equal(c.lorebook[0].kind, undefined);
  assert.equal(c.lorebook[1].kind, undefined);
  assert.equal(c.lorebook[1].tone, undefined);
  assert.deepEqual([c.lorebook[2].kind, c.lorebook[2].tone, c.lorebook[2].at], ['moment', 'joy', undefined]);
  assert.equal(c.avatar, 'data:image/png;base64,AAAA', 'no se tocó lo demás');
  // y los ajustes anteriores cargan con el interruptor encendido
  assert.equal((await state.getSettings()).momentMemories, true);
  assert.equal((await state.saveSettings({ momentMemories: 0 })).momentMemories, true);
  assert.equal((await state.saveSettings({ momentMemories: false })).momentMemories, false);
});

test('HUM-003 saveCharacterMoment: relee el registro bajo el candado, solo cambia el lorebook y NO escribe si no hay nada que guardar', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('c1', { ...rawCharacter([{ id: 'a', keys: ['perro'], content: 'El perro se llama Bruno', updated: 5, source: 'auto' }]), lorebookPrevious: [], lorebookPreviousAt: 77, chatBackground: 'data:image/jpeg;base64,BBBB' });
  let writes = 0;
  const origPut = backend.put;
  backend.put = async (...a) => { writes++; return origPut(...a); };
  assert.equal(await state.saveCharacterMoment('c1', () => null), null);
  assert.equal(writes, 0, 'sin cambio no se escribe');
  // dos escrituras paralelas (un momento y otra de memoria) no se pisan
  const cand = { content: 'Edgar was feeling sad and told Luna: "x"', keys: ['sad'], tone: 'sadness', at: NOW };
  await Promise.all([
    state.saveCharacterMoment('c1', (fresh) => withMoment(fresh.lorebook, cand, NOW)),
    state.saveCharacterLorebook('c1', [{ id: 'z', keys: ['z'], content: 'Edgar toca la guitarra', updated: 9, source: 'manual' }]),
  ]);
  const c = await state.getCharacter('c1');
  assert.ok(c.chatBackground.endsWith('BBBB'), 'no pisó el fondo');
  assert.equal(c.lorebookPreviousAt, 77, 'no tocó el "Deshacer"');
  assert.ok(c.lorebook.some((e) => e.id === 'z') || c.lorebook.some(isMoment), 'al menos una de las dos quedó y ninguna corrompió el registro');
  assert.equal(await state.saveCharacterMoment('nope', () => []), null, 'personaje inexistente');
});

test('HUM-003 duplicar un personaje no arrastra sus momentos (el lorebook nace vacío)', () => {
  const dup = duplicateCharacterData({ ...luna({ lorebook: [moment('m1', 'sadness', NOW)] }), lorebookArchive: [moment('m2', 'joy', NOW)], mailbox: {}, identity: {}, relationship: {} });
  assert.deepEqual(dup.lorebook, []);
  assert.deepEqual(dup.lorebookArchive, []);
});

// ---------- buzón: nada de citas de episodios ----------

test('HUM-003 buzón (regla de PROACT-001): los momentos no entran a la nota ni cuentan para "hacen falta 5 recuerdos"', () => {
  const facts = Array.from({ length: 4 }, (_, i) => fact(`f${i}`, `Edgar hecho ${i}`));
  const mixed = [...facts, moment('m1', 'sadness', NOW), moment('m2', 'joy', NOW - DAY)];
  const picked = pickMailboxMemories(mixed, () => 0.5);
  assert.equal(picked.length, 4);
  assert.ok(picked.every((e) => !isMoment(e)));
  const due = mailboxDue({ lorebook: mixed, mailbox: {} }, NOW - 10 * HOUR, NOW);
  assert.equal(due.reason, 'few-memories', '4 hechos + 2 momentos NO alcanzan');
  assert.equal(mailboxDue({ lorebook: [...mixed, fact('f9', 'Edgar hecho 9')], mailbox: {} }, NOW - 10 * HOUR, NOW).due, true);
});

// ---------- interfaz ----------

test('HUM-003 momentCardLabel: «Momento · tristeza · 3 oct 2026» para un momento; vacío para un hecho', () => {
  assert.equal(momentCardLabel(moment('m1', 'sadness', NOW)), 'Momento · tristeza · 3 oct 2026');
  assert.equal(momentCardLabel({ ...moment('m1', 'pride', 0), at: undefined }), 'Momento · orgullo');
  assert.equal(momentCardLabel(fact('f1', 'Edgar likes tea')), '');
});

// ---------- paso por generateReply (servidor simulado) ----------

test('HUM-003 generateReply: un momento con keys que coinciden viaja en el bloque final con su tono y un "cuándo" aproximado, en el último mensaje del usuario', async () => {
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
    const character = { id: 'c1', name: 'Luna', avatar: '', card: { name: 'Luna', description: '', personality: 'Calm.', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null }, lorebook: [moment('m1', 'sadness', NOW - 3 * DAY, { keys: ['entrevista', 'triste'] })], personalityTags: [] };
    const messages = [{ role: 'user', text: 'Mañana otra entrevista de trabajo', ts: NOW }];
    await generateReply({ character, messages, settings: { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url: base }, now: new Date(NOW) });
    const last = seen.body.messages.at(-1).content;
    assert.match(last, /\[Shared moments \(the character may recall one naturally/);
    assert.ok(last.includes('- (sadness, a few days ago) Edgar was feeling sad'));
    assert.doesNotMatch(seen.body.messages[0].content, /Shared moments/, 'nunca en la cabecera');
    // sin momentos en el lorebook el prompt no cambia de forma alguna
    const none = { ...character, lorebook: [] };
    await generateReply({ character: none, messages, settings: { user: 'Edgar', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 4096, url: base }, now: new Date(NOW) });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /Shared moments|Known facts/);
  } finally {
    server.close();
  }
});

// ---------- conexión en el chat (sin DOM): el detector no puede añadir llamadas al modelo ----------

import { readFileSync } from 'node:fs';
test('HUM-003 chat.js: el detector corre tras responder (no al regenerar), sin red y escribiendo con el candado del personaje', () => {
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /import \{ momentCandidate, withMoment \} from '..\/api\/moments\.js'/);
  assert.match(chat, /if \(character && chat && reply\.text && !previous\) maybeSaveMoment\(history\)/);
  const fn = chat.slice(chat.indexOf('function maybeSaveMoment'), chat.indexOf('// HUM-001: la segunda mitad'));
  assert.match(fn, /saveCharacterMoment\(characterId/);
  assert.doesNotMatch(fn, /fetch|generateReply|completeOnce|completeChatOnce/);
  const moments = readFileSync(new URL('../www/js/api/moments.js', import.meta.url), 'utf8');
  assert.doesNotMatch(moments.replace(/\/\/.*$/gm, ''), /fetch|complete\(|kobold/);
});
