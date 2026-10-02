// tests/presence.test.mjs — HUM-001: ánimo persistente, ritmo, observaciones y gestos de vida (api/presence.js) y su paso por el prompt.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import {
  MOODS, sanitizeMood, moodHeadText, computeMood, pickRhythm, observations, buildPresence, planSplit, typingHoldMs,
  PRESENCE_NOTE_MAX, SPLIT_CHANCE,
} from '../www/js/api/presence.js';
import { buildPlainPrompt, buildChatMessages, historyStartIndex, PRESENCE_RESERVE_CHARS } from '../www/js/api/prompt.js';
import { generateReply } from '../www/js/api/kobold.js';
import { sanitizeMessage } from '../www/js/state.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);
const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };
const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

// ---------- ánimo ----------

test('HUM-001 sanitizeMood: solo ids conocidos; cualquier otra cosa = sin ánimo guardado (personajes anteriores cargan así)', () => {
  assert.deepEqual(sanitizeMood({ id: 'tired', updated: 5 }), { id: 'tired', updated: 5 });
  for (const bad of [undefined, null, '', 'x', 42, {}, { id: 'furious', updated: 3 }, { id: 'calm', updated: 'a' }]) {
    const out = sanitizeMood(bad);
    assert.ok(out.id === '' || out.id === 'calm', JSON.stringify(bad));
    assert.equal(out.updated, 0);
  }
  assert.deepEqual(sanitizeMood({ id: 'furious', updated: 3 }), { id: '', updated: 0 });
});

test('HUM-001 moodHeadText: "ánimo …" sin género, vacío si no existe', () => {
  assert.equal(moodHeadText('calm'), 'ánimo tranquilo');
  assert.equal(moodHeadText('wistful'), 'ánimo melancólico');
  assert.equal(moodHeadText(''), '');
  assert.equal(moodHeadText('nope'), '');
  assert.equal(MOODS.length, 6);
});

test('HUM-001 computeMood: determinista y la hora lo inclina (madrugada: cansado/melancólico)', () => {
  const now = at(2026, 10, 2, 3);
  const a = computeMood({ now, characterId: 'c1' });
  const b = computeMood({ now, characterId: 'c1' });
  assert.deepEqual(a, b);
  assert.ok(['tired', 'wistful', 'cozy'].includes(a.id), a.id);
});

test('HUM-001 computeMood: lo que escribe el usuario pesa (tristeza → melancólico, cariño → cariñoso, risas → juguetón)', () => {
  const now = at(2026, 10, 2, 15);
  // 'c9' en este día no favorece nada extraño: se comparan contra el mismo contexto sin mensaje.
  assert.equal(computeMood({ now, characterId: 'c1', userTexts: ['I feel so sad and lonely today, I cried'] }).id, 'wistful');
  assert.equal(computeMood({ now, characterId: 'c1', userTexts: ['te quiero mucho, mi amor'] }).id, 'cozy');
  assert.equal(computeMood({ now, characterId: 'c1', userTexts: ['jajaja eso fue genial!! 😂'] }).id, 'playful');
});

test('HUM-001 computeMood: tiene inercia (no cambia por un empujón leve) y se desvanece con las horas', () => {
  const now = at(2026, 10, 2, 15);
  const sticky = computeMood({ now, characterId: 'c1', prev: { id: 'tired', updated: now.getTime() - HOUR } });
  assert.equal(sticky.id, 'tired', 'una hora después sigue cansado aunque la tarde pida energía');
  assert.equal(sticky.changed, false);
  assert.equal(sticky.updated, now.getTime() - HOUR, 'sin cambio no se reescribe la marca');
  const faded = computeMood({ now, characterId: 'c1', prev: { id: 'tired', updated: now.getTime() - 3 * DAY } });
  assert.notEqual(faded.id, 'tired', 'tres días después ya no pesa');
  assert.equal(faded.changed, true);
  assert.equal(faded.updated, now.getTime());
});

test('HUM-001 computeMood: el día del personaje varía entre días y entre personajes', () => {
  const ids = new Set();
  for (let d = 1; d <= 20; d++) ids.add(computeMood({ now: at(2026, 10, d, 16), characterId: 'luna' }).id);
  assert.ok(ids.size >= 3, `20 días dieron solo ${[...ids]}`);
  const byChar = new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((c) => computeMood({ now: at(2026, 10, 2, 16), characterId: c }).id));
  assert.ok(byChar.size >= 2);
});

test('HUM-001 computeMood: los rasgos de la card sesgan el ánimo (muy juguetón → juguetón a media tarde)', () => {
  const now = at(2026, 10, 2, 16);
  const plain = computeMood({ now, characterId: 'x' });
  const tagged = computeMood({ now, characterId: 'x', tags: ['playful', 'mischievous', 'cheerful'] });
  assert.ok(['playful', 'lively'].includes(tagged.id), tagged.id);
  assert.ok(plain.id);
});

// ---------- ritmo ----------

test('HUM-001 pickRhythm: siempre UN párrafo; mensajes cortos → respuestas más cortas', () => {
  for (let i = 0; i < 50; i++) {
    const r = pickRhythm({ userText: 'hola', moodId: 'calm', rnd: Math.random });
    assert.match(r.text, /single/);
    assert.ok(['brief', 'medium', 'full'].includes(r.id));
  }
  const count = (userText) => {
    const c = { brief: 0, medium: 0, full: 0 };
    let n = 0;
    const rnd = () => { n += 0.0137; return n % 1; };
    for (let i = 0; i < 200; i++) c[pickRhythm({ userText, rnd }).id]++;
    return c;
  };
  const short = count('hola');
  const long = count('Hoy fue un día largo, estuve en el trabajo toda la tarde y después salí a caminar un rato por el parque pensando en todo lo que pasó esta semana');
  assert.ok(short.brief > short.full);
  assert.ok(long.full > short.full);
});

test('HUM-001 pickRhythm: evita repetir el largo de la respuesta anterior (cuando el azar lo permite)', () => {
  // rnd: 1.er tiro cae en "medium", luego 0.1 (< 0.6) pide otro tiro que cae en otro largo.
  const r = pickRhythm({ userText: 'una frase de seis palabras justas', lastCharText: 'x'.repeat(200), rnd: seq(0.4, 0.1, 0.0) });
  assert.notEqual(r.id, 'medium');
  const keep = pickRhythm({ userText: 'una frase de seis palabras justas', lastCharText: 'x'.repeat(200), rnd: seq(0.4, 0.9) });
  assert.equal(keep.id, 'medium');
});

// ---------- observaciones ----------

const MSG = (role, text, ts) => ({ role, text, ts });

test('HUM-001 observations: nota la ausencia de 2+ días (siempre) y no la de menos', () => {
  const t0 = at(2026, 10, 2, 12).getTime();
  const away = [MSG('char', 'Hola', t0 - 3 * DAY), MSG('user', 'Volví', t0)];
  const out = observations({ messages: away, now: new Date(t0), userName: 'Edgar', charName: 'Luna', rnd: () => 0.99 });
  assert.equal(out.length, 1);
  assert.match(out[0], /Edgar is back after 3 days away; Luna noticed/);
  const week = observations({ messages: [MSG('char', 'Hola', t0 - 15 * DAY), MSG('user', 'Hi', t0)], now: new Date(t0), userName: 'E', charName: 'L', rnd: () => 0.99 });
  assert.match(week[0], /about 2 weeks away/);
  const day = observations({ messages: [MSG('char', 'Hola', t0 - 20 * HOUR), MSG('user', 'Hi', t0)], now: new Date(t0), userName: 'E', charName: 'L', rnd: () => 0.99 });
  assert.deepEqual(day, []);
});

test('HUM-001 observations: "estaba pensando en…" tras una pausa, con un recuerdo o con lo último que dijo el usuario', () => {
  const t0 = at(2026, 10, 2, 12).getTime();
  const msgs = [MSG('user', 'Mañana tengo la entrevista de trabajo', t0 - 6 * HOUR - 60000), MSG('char', 'Suerte', t0 - 6 * HOUR), MSG('user', 'Hola otra vez', t0)];
  const withLore = observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', lorebook: [{ content: 'Edgar adora el café con canela' }], rnd: () => 0 });
  assert.match(withLore[0], /While Edgar was away, Luna kept thinking about this: "Edgar adora el café con canela"\. Luna may bring it up naturally, once\./);
  const noLore = observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', lorebook: [], rnd: () => 0 });
  assert.match(noLore[0], /entrevista de trabajo/);
  const quiet = observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', lorebook: [{ content: 'x' }], rnd: () => 0.99 });
  assert.deepEqual(quiet, [], 'con el azar en contra no lo menciona siempre');
  const soon = observations({ messages: [MSG('char', 'Hola', t0 - 10 * 60000), MSG('user', 'Hi', t0)], now: new Date(t0), lorebook: [{ content: 'x' }], rnd: () => 0 });
  assert.deepEqual(soon, [], 'sin pausa no hay "estaba pensando"');
});

test('HUM-001 observations: nota que hoy escribe más corto, y que es muy tarde', () => {
  const t0 = at(2026, 10, 2, 15).getTime();
  const longMsg = 'Hoy me pasaron muchas cosas en el trabajo y quería contarte todo con calma';
  const msgs = [];
  for (let i = 0; i < 8; i++) { msgs.push(MSG('user', longMsg, t0 - (30 - i) * 60000)); msgs.push(MSG('char', 'Cuéntame más', t0 - (30 - i) * 60000 + 1000)); }
  msgs.push(MSG('user', 'ok', t0 - 2000), MSG('char', 'Mm', t0 - 1500), MSG('user', 'sí', t0));
  const out = observations({ messages: msgs, now: new Date(t0), userName: 'Edgar', charName: 'Luna', rnd: () => 0 });
  assert.ok(out.some((o) => /Edgar's messages are shorter than usual today/.test(o)), out.join('|'));
  const late = observations({ messages: [MSG('char', 'Hola', t0 - 1000), MSG('user', 'Hi', t0)], now: at(2026, 10, 3, 3), userName: 'Edgar', charName: 'Luna', rnd: () => 0 });
  assert.ok(late.some((o) => /up very late/.test(o)));
  const day = observations({ messages: [MSG('char', 'Hola', t0 - 1000), MSG('user', 'Hi', t0)], now: new Date(t0), userName: 'Edgar', charName: 'Luna', rnd: () => 0 });
  assert.ok(!day.some((o) => /up very late/.test(o)));
});

// ---------- nota completa ----------

test('HUM-001 buildPresence: ánimo primero, ritmo al final, dentro del tope, sin pronombres y en positivo', () => {
  const t0 = at(2026, 10, 2, 12).getTime();
  const messages = [MSG('char', 'Hola', t0 - 3 * DAY), MSG('user', 'Volví, te extrañé mucho', t0)];
  const character = { id: 'c1', name: 'Luna', lorebook: [{ content: 'Edgar adora el café' }], personalityTags: [] };
  for (const r of [0, 0.3, 0.7, 0.99]) {
    const { note, mood } = buildPresence({ character, messages, settings: { user: 'Edgar' }, now: new Date(t0), rnd: () => r });
    assert.ok(note.startsWith('Luna feels '), note);
    assert.match(note, /right now\./);
    assert.match(note, /single/);
    assert.ok(note.length <= PRESENCE_NOTE_MAX, `${note.length}`);
    assert.doesNotMatch(note, /\b(he|she|they|him|her|them|his|their)\b/i, note);
    assert.doesNotMatch(note, /\b(never|not|no|without|avoid|stop|stall|reject|refuse)\b|n't\b/i, note);
    assert.ok(MOODS.some((m) => m.id === mood.id));
    assert.ok(note.indexOf('is back after') < note.lastIndexOf('single'), 'la ausencia va antes que el ritmo');
  }
});

test('HUM-001 buildPresence: sin mensajes del usuario no falla y da ánimo y ritmo', () => {
  const { note } = buildPresence({ character: { id: 'c', name: 'Luna' }, messages: [], settings: {}, now: at(2026, 10, 2, 9), rnd: () => 0.5 });
  assert.match(note, /^Luna feels .* right now\. Make this reply/);
});

// ---------- gestos de vida ----------

test('HUM-001 planSplit: solo respuestas largas, con probabilidad baja, y las dos mitades son párrafos completos', () => {
  const text = '*Smiles softly and tucks a strand of hair behind an ear.* I was hoping you would stop by tonight, honestly. It has been quiet around here and the evening felt longer than usual without anyone to talk to.';
  assert.equal(planSplit('Corto.', () => 0), null);
  assert.equal(planSplit(text, () => SPLIT_CHANCE + 0.01), null, 'con el azar en contra no parte');
  const parts = planSplit(text, () => 0);
  assert.ok(parts, 'parte');
  assert.equal(parts.length, 2);
  assert.ok(parts[0].length >= 50 && parts[1].length >= 50);
  assert.equal(`${parts[0]} ${parts[1]}`, text, 'juntas dan el texto original');
  assert.equal(parts[0].split('*').length % 2, 1, 'asteriscos balanceados en la primera mitad');
  assert.doesNotMatch(parts[0] + parts[1], /\n/, 'un solo párrafo cada una');
});

test('HUM-001 planSplit: no corta dentro de una acción ni con asteriscos sin cerrar', () => {
  const insideAction = '*She looks at you for a long moment. Then she takes a slow breath and finally lets the words come out as the quiet room hums around them both.* Okay.';
  assert.equal(planSplit(insideAction, () => 0), null, 'el único corte posible quedaría dentro de la acción');
  const unbalanced = 'Hello there my friend. ' + 'blah '.repeat(30) + '*oops. ' + 'more '.repeat(20);
  assert.equal(planSplit(unbalanced, () => 0), null);
});

test('HUM-001 typingHoldMs: entre 0,5 y 1,6 s; el cansancio la alarga', () => {
  assert.equal(typingHoldMs(() => 0), 500);
  assert.equal(typingHoldMs(() => 1), 1600);
  assert.equal(typingHoldMs(() => 0, 'tired'), 850);
});

// ---------- paso por el prompt ----------

const card = { name: 'Luna', description: '', personality: 'Calm.', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
const settings = { user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'plain', ctx: 4096 };

test('HUM-001: la nota va al FINAL (antes de la hora), nunca en la cabecera, en texto simple y en plantilla', () => {
  const msgs = [{ role: 'user', text: 'Hola', ts: 1 }];
  const extras = { presence: 'Luna feels calm and at ease right now. Make this reply a single short paragraph of one or two sentences.', timeOfDay: 'It is a Friday afternoon.' };
  const plain = buildPlainPrompt(card, msgs, settings, '', '', '', '', false, extras).prompt;
  assert.ok(plain.indexOf('[Luna feels calm') > plain.indexOf('[Start of chat]'), 'no está en la cabecera');
  assert.ok(plain.indexOf('[Luna feels calm') < plain.indexOf('[It is a Friday afternoon.]'), 'antes de la hora');
  assert.ok(plain.indexOf('[Luna feels calm') < plain.indexOf('Edgar: Hola'), 'antes de la última línea del usuario');
  const chat = buildChatMessages(card, msgs, { ...settings, mode: 'chat' }, '', '', '', '', false, extras).messages;
  assert.doesNotMatch(chat[0].content, /feels calm/, 'la cabecera (system) no la lleva');
  assert.match(chat.at(-1).content, /^\[Luna feels calm[^\n]*\]\n\[It is a Friday afternoon\.\]\n\nHola$/);
});

test('HUM-001: sin nota de presencia el prompt es idéntico al de antes', () => {
  const msgs = [{ role: 'user', text: 'Hola', ts: 1 }];
  assert.equal(buildPlainPrompt(card, msgs, settings, '', '', '', '', false, { presence: '' }).prompt, buildPlainPrompt(card, msgs, settings).prompt);
});

test('HUM-001: la reserva fija mantiene la ventana del historial igual aunque la nota cambie de largo', () => {
  const many = [];
  for (let i = 0; i < 60; i++) many.push({ role: i % 2 ? 'char' : 'user', text: `mensaje número ${i} con algo de relleno para ocupar espacio en el contexto`, ts: i + 1 });
  many.push({ role: 'user', text: 'último', ts: 100 });
  const tight = { ...settings, ctx: 1024, maxLen: 100 };
  const short = 'Luna feels calm and at ease right now. Make this reply a single short paragraph of one or two sentences.';
  const long = short + ' Edgar is back after 3 days away; Luna noticed the time and can say so warmly. While Edgar was away, Luna kept thinking about this: "algo importante que dijo".';
  const window = (note) => {
    const p = buildPlainPrompt(card, many, tight, '', '', '', '', false, { presence: note }).prompt;
    return p.split('\n').filter((l) => /^(Edgar|Luna): mensaje número/.test(l)).length;
  };
  assert.equal(window(short), window(long));
  const c = (note) => buildChatMessages(card, many, { ...tight, mode: 'chat' }, '', '', '', '', false, { presence: note }).messages.length;
  assert.equal(c(short), c(long));
  assert.ok(PRESENCE_RESERVE_CHARS >= PRESENCE_NOTE_MAX + 3, 'la reserva cubre la nota más larga con corchetes y salto');
  assert.ok(historyStartIndex(card, many, tight, '', '', 0, 0, null, null, false, '', true) >= historyStartIndex(card, many, tight), 'historyStartIndex puede reservar el espacio');
});

test('HUM-001: la segunda mitad de una respuesta partida viaja unida a la primera en la plantilla (los turnos alternan)', () => {
  const msgs = [
    { role: 'user', text: 'Hola', ts: 1 },
    { role: 'char', text: 'Primera parte.', ts: 2 },
    { role: 'char', text: 'Segunda parte.', ts: 3, cont: true },
    { role: 'user', text: 'Sigue', ts: 4 },
  ];
  const out = buildChatMessages(card, msgs, { ...settings, mode: 'chat' }).messages;
  assert.deepEqual(out.map((m) => m.role), ['system', 'user', 'assistant', 'user']);
  assert.equal(out[2].content, 'Primera parte. Segunda parte.');
});

test('HUM-001: el flag `cont` sobrevive al guardado de un mensaje', () => {
  const m = sanitizeMessage({ role: 'char', text: 'x', ts: 1, cont: true });
  assert.equal(m.cont, true);
});

// ---------- paso por generateReply (servidor simulado) ----------

function chatServer(capture) {
  return http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    capture.body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
}
async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${server.address().port}`;
}
const character = () => ({ id: 'c1', name: 'Luna', avatar: '', card: { ...card }, lorebook: [], personalityTags: [] });

test('HUM-001 generateReply: con humanTouch envía la nota en el último mensaje del usuario y devuelve el ánimo; sin él, nada', async () => {
  const seen = {};
  const server = chatServer(seen);
  const base = await listen(server);
  try {
    const now = at(2026, 10, 2, 15);
    const messages = [{ role: 'user', text: 'Hola, ¿qué tal?', ts: now.getTime() }];
    const on = await generateReply({ character: character(), messages, settings: { ...settings, url: base, mode: 'chat', humanTouch: true }, now, rnd: () => 0.5 });
    const last = seen.body.messages.at(-1).content;
    assert.match(last, /^\[Luna feels .+ right now\..*single.*\]/s);
    assert.ok(on.mood && typeof on.mood.id === 'string' && typeof on.mood.changed === 'boolean');
    const off = await generateReply({ character: character(), messages, settings: { ...settings, url: base, mode: 'chat', humanTouch: false }, now });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /feels/);
    assert.equal(off.mood, null);
  } finally {
    server.close();
  }
});

// ---------- interfaz (fuentes) ----------

test('HUM-001: el chat usa la pausa, la cabecera con ánimo/"escribiendo…" y junta las mitades al regenerar', () => {
  const src = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(src, /escribiendo…/);
  assert.match(src, /moodHeadText\(/);
  assert.match(src, /planSplit\(reply\.text\)/);
  assert.match(src, /saveCharacterMood\(/);
  assert.match(src, /last\.cont && before/);
  assert.match(src, /streamHoldUntil/);
});

test('streamReplies apagado: el chat no pinta el texto parcial (solo puntos) y el ajuste está en Apariencia, junto a los tamaños', () => {
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /settings\.streamReplies === false/);
  const ui = readFileSync(new URL('../www/js/ui/settings.js', import.meta.url), 'utf8');
  const iAvatar = ui.indexOf('Tamaño de la foto junto a los mensajes');
  const iStream = ui.indexOf('Ver la respuesta mientras se escribe');
  const iAspect = ui.indexOf('Aspecto de la app');
  assert.ok(iAvatar > 0 && iAvatar < iStream && iStream < iAspect, 'justo después del tamaño de la foto, antes de "Aspecto de la app"');
});
