// tests/emotion.test.mjs — HUM-002: reacción emocional del personaje (api/emotion.js + la instrucción de registro de api/presence.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { EMOTIONS, EMOTION_THRESHOLD, norm, emotionStrengths, emotionProfile, detectEmotion } from '../www/js/api/emotion.js';
import { buildPresence, computeMood, pickRhythm, registerLine, PRESENCE_NOTE_MAX } from '../www/js/api/presence.js';
import { PRESENCE_RESERVE_CHARS } from '../www/js/api/prompt.js';
import { generateReply } from '../www/js/api/kobold.js';

const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);
const id = (text) => { const e = detectEmotion([text]); return e ? e.id : null; };

// ---------- lexicón (español e inglés, con y sin tildes) ----------

test('HUM-002 detecta las 8 emociones en español e inglés (con y sin tildes)', () => {
  const cases = {
    sad: ['Estoy muy triste hoy', 'estoy muy triste hoy', 'I cried all night', 'I feel so lonely', 'Me siento sola', 'hoy fue un día horrible', 'I had a rough day'],
    stressed: ["I'm so stressed about the exam", 'Estoy muy estresado con el trabajo', 'me siento abrumada', 'I feel so anxious', 'tengo mucha ansiedad'],
    angry: ['Estoy furioso con mi jefe', 'I am so angry right now', 'Estoy harto de todo esto', "I'm really frustrated with this"],
    happy: ['Estoy muy feliz!', 'I am so excited about the trip', 'jajaja eso fue genial 😂', "I'm so happy today"],
    proud: ['Me gradué hoy!', 'I passed my exam', 'Estoy muy orgullosa de lo que logré', 'I got the job'],
    scared: ['Tengo miedo de la oscuridad', 'I am terrified of tomorrow', 'tuve una pesadilla horrible', 'Estoy asustado'],
    tired: ['Estoy agotado', 'I am exhausted', 'tengo mucho sueño', 'Me siento cansada hoy'],
    affectionate: ['Te quiero mucho', 'I miss you so much', 'Te extrañé mucho', 'sending you a hug ❤️'],
  };
  for (const [emotion, texts] of Object.entries(cases)) {
    for (const text of texts) assert.equal(id(text), emotion, `${emotion}: "${text}"`);
  }
  assert.deepEqual([...EMOTIONS].sort(), Object.keys(cases).sort());
});

test('HUM-002 norm: sin tildes, sin apóstrofos y en minúsculas', () => {
  assert.equal(norm("I can't — ESTÁ Triste ñandú’s"), 'i cant — esta triste nandus');
});

// ---------- negación ----------

test('HUM-002 negación: "no estoy triste", "I am not really sad", "ya no me siento mal" no cuentan', () => {
  for (const text of [
    'no estoy triste', 'No me siento triste', "I'm not sad", 'I am not really sad', 'I am not feeling very stressed', 'ya no me siento mal',
    'nunca estoy cansado', 'No tuve un mal día', "don't worry about it", 'no es que esté feliz, pero ok', 'estoy bien sin estrés', 'I never cry',
  ]) {
    assert.equal(id(text), null, text);
  }
});

test('HUM-002 negación: solo afecta a SU cláusula ("no sé, pero estoy triste" sí cuenta)', () => {
  assert.equal(id('no sé qué hacer, estoy triste'), 'sad');
  assert.equal(id('no lloro pero estoy triste'), 'sad');
  assert.equal(id("I don't know. I'm so tired"), 'tired');
});

// ---------- falsos positivos conocidos ----------

test('HUM-002 falsos positivos: "solo/sola" = "only" en español NO es tristeza (el bug de la lista SAD de HUM-001)', () => {
  for (const text of ['solo quiero hablar contigo', 'Solo un momento', 'estoy sola en casa', 'solo me falta un poco', 'dame solo una razón', 'no estoy solo']) {
    assert.equal(id(text), null, text);
  }
  // pero decirlo como sentimiento sí:
  assert.equal(id('me siento muy sola'), 'sad');
  assert.equal(id('me siento solo'), 'sad');
});

test('HUM-002 falsos positivos: frases comunes que contienen palabras parecidas no disparan nada', () => {
  for (const text of [
    'leave me alone', 'my dream is to travel', 'mi sueño es viajar', 'I love pizza', 'terminé de comer', 'hugo me escribió', 'It hurts to wait for the bus',
    'the movie was horrible', 'what time is it', 'hola, ¿cómo estás?', 'estoy con hambre', 'tengo que irme a dormir', 'mad cool', 'ok', 'lol', 'NO!!!', '!!!!',
  ]) {
    assert.equal(id(text), null, text);
  }
});

test('HUM-002 una pregunta o un comentario sobre el PERSONAJE o un tercero no es la emoción del usuario', () => {
  for (const text of ['are you sad?', '¿estás triste?', 'you seem tired', 'te ves cansada', 'my friend is sad', 'mi amigo está triste', "she's stressed about work", 'mi mamá está muy estresada']) {
    assert.equal(id(text), null, text);
  }
  // con una marca de primera persona sí es del usuario
  assert.equal(id('mi jefe me tiene estresado'), 'stressed');
  assert.equal(id('he makes me so angry'), 'angry');
  // el cariño va dirigido al personaje: "te quiero" sí cuenta
  assert.equal(id('te quiero'), 'affectionate');
  assert.equal(id('I miss you'), 'affectionate');
});

test('HUM-002 "tired of this" es hartazgo (enojo), no cansancio', () => {
  assert.equal(id('I am tired of this'), 'angry');
});

// ---------- fuerza, mezcla y decaimiento ----------

test('HUM-002 un intensificador sube la fuerza y varias pistas suman, con tope', () => {
  const plain = emotionStrengths('estoy triste').sad;
  const strong = emotionStrengths('estoy muy triste').sad;
  const several = emotionStrengths('estoy muy triste, llorando, sola, deprimida y desolada').sad;
  assert.ok(strong > plain);
  assert.ok(several > strong);
  assert.ok(several <= 2, 'tope por mensaje');
  assert.deepEqual(emotionStrengths(''), {});
  assert.deepEqual(emotionStrengths(null), {});
});

test('HUM-002 decaimiento: el último mensaje pesa 1, el anterior 0,5 y el otro 0,3', () => {
  const sad = 'estoy triste';
  assert.equal(detectEmotion([sad, 'hola', 'ok']).id, 'sad');
  assert.equal(detectEmotion(['hola', sad, 'ok']), null, 'una mención suave en el penúltimo mensaje ya no alcanza');
  assert.equal(detectEmotion(['hola', 'ok', sad]), null);
  const intense = 'estoy muy triste, llorando y deprimida';
  assert.equal(detectEmotion(['ok', intense]).id, 'sad', 'una mención intensa en el penúltimo sí');
  const prof = emotionProfile([sad, sad, sad]);
  assert.ok(Math.abs(prof.sad - (1 + 0.5 + 0.3)) < 1e-9);
  assert.ok(EMOTION_THRESHOLD > 0.5 && EMOTION_THRESHOLD < 1);
});

test('HUM-002 mezcla: gana la emoción más fuerte; en empate, la de más prioridad (estrés antes que alegría)', () => {
  assert.equal(id('estoy feliz pero estresado'), 'stressed');
  assert.equal(id('estoy cansado y estresado'), 'stressed');
  const e = detectEmotion(['estoy feliz y estoy muy muy triste, llorando']);
  assert.equal(e.id, 'sad');
  assert.ok(e.profile.happy > 0);
});

test('HUM-002 solo cuentan los últimos 3 mensajes', () => {
  assert.equal(detectEmotion(['ok', 'hola', 'bien', 'estoy muy triste, llorando y deprimida']), null);
});

// ---------- el ánimo usa la misma lista (y ya no tropieza con "solo") ----------

test('HUM-002 computeMood: la corrección de "solo" — "solo quiero jugar" no vuelve melancólico al personaje', () => {
  const now = at(2026, 10, 2, 15);
  const base = computeMood({ now, characterId: 'c1' });
  assert.equal(computeMood({ now, characterId: 'c1', userTexts: ['solo quiero hablar un rato, solo eso'] }).id, base.id);
  assert.equal(computeMood({ now, characterId: 'c1', userTexts: ['me siento muy sola y triste'] }).id, 'wistful');
});

// ---------- instrucción de registro ----------

const CAUSES_FORBIDDEN = /\b(never|not|no|without|avoid|stop|stall|reject|refuse|don't|can't|won't)\b|n't\b/i;
const PRONOUNS = /\b(he|she|they|him|her|them|his|hers|their|theirs|you|your|yours)\b/i;

test('HUM-002 registerLine: una por emoción, en positivo, con nombres (sin pronombres) y en la voz propia del personaje', () => {
  for (const emotion of EMOTIONS) {
    const line = registerLine(emotion, 'Luna', 'Edgar');
    assert.ok(line.length > 40, emotion);
    assert.doesNotMatch(line, CAUSES_FORBIDDEN, `${emotion}: ${line}`);
    assert.doesNotMatch(line, PRONOUNS, `${emotion}: ${line}`);
    assert.match(line, /Luna's own (voice|way)/, `${emotion}: respeta su personalidad`);
    assert.ok(!/\n/.test(line), 'una sola línea');
    assert.ok(line.includes('Edgar') && line.includes('Luna'));
  }
  assert.equal(registerLine('', 'Luna', 'Edgar'), '');
  assert.equal(registerLine('nope', 'Luna', 'Edgar'), '');
  // pide UNA pregunta, no un interrogatorio
  assert.match(registerLine('sad', 'Luna', 'Edgar'), /ONE gentle question/);
  assert.match(registerLine('happy', 'Luna', 'Edgar'), /celebrates/);
});

const MSG = (role, text, ts) => ({ role, text, ts });
const character = { id: 'c1', name: 'Luna', lorebook: [{ content: 'Edgar adora el café' }], personalityTags: [] };
const noon = at(2026, 10, 2, 12).getTime();

test('HUM-002 buildPresence: con el interruptor y una emoción, la nota suma el registro y sigue siendo un párrafo dentro del tope', () => {
  const messages = [MSG('char', 'Hola', noon - 60000), MSG('user', 'Estoy muy triste, tuve un día horrible', noon)];
  const on = buildPresence({ character, messages, settings: { user: 'Edgar', emotionResponse: true }, now: new Date(noon), rnd: () => 0.5 });
  assert.equal(on.emotion, 'sad');
  assert.ok(on.note.includes(registerLine('sad', 'Luna', 'Edgar')));
  assert.ok(on.note.length <= PRESENCE_NOTE_MAX);
  assert.ok(on.note.startsWith('Luna feels '), 'el ánimo sigue yendo primero');
  assert.ok(on.note.indexOf('ONE gentle question') < on.note.lastIndexOf('single'), 'el registro va antes que el ritmo');
  assert.doesNotMatch(on.note, /\n/);
  assert.doesNotMatch(on.note, CAUSES_FORBIDDEN);
  assert.doesNotMatch(on.note, /\b(he|she|they|him|her|them|his|their)\b/i);
});

test('HUM-002 buildPresence: sin interruptor, o sin emoción detectada, la nota es IDÉNTICA a la de HUM-001', () => {
  const sadMsgs = [MSG('char', 'Hola', noon - 60000), MSG('user', 'Estoy muy triste, tuve un día horrible', noon)];
  const off = buildPresence({ character, messages: sadMsgs, settings: { user: 'Edgar' }, now: new Date(noon), rnd: () => 0.5 });
  const offExplicit = buildPresence({ character, messages: sadMsgs, settings: { user: 'Edgar', emotionResponse: false }, now: new Date(noon), rnd: () => 0.5 });
  assert.equal(off.note, offExplicit.note);
  assert.equal(off.emotion, '');
  assert.doesNotMatch(off.note, /sounds low|ONE gentle/);
  const calmMsgs = [MSG('char', 'Hola', noon - 60000), MSG('user', 'Cuéntame algo sobre tu día', noon)];
  const a = buildPresence({ character, messages: calmMsgs, settings: { user: 'Edgar', emotionResponse: true }, now: new Date(noon), rnd: () => 0.5 });
  const b = buildPresence({ character, messages: calmMsgs, settings: { user: 'Edgar' }, now: new Date(noon), rnd: () => 0.5 });
  assert.equal(a.note, b.note, 'sin emoción detectada nada cambia');
  assert.equal(a.emotion, '');
});

test('HUM-002 buildPresence: el peor caso (nombres largos + ausencia + "estaba pensando") cabe: lo que sobra se omite entero, el registro tiene prioridad', () => {
  const N = 'Aurelia-Beatriz de la Montaña Dorada';
  const U = 'Maximiliano Alejandro Fernández';
  const messages = [
    MSG('user', 'Mañana tengo la entrevista de trabajo importante', noon - 6 * 3600000 - 60000),
    MSG('char', 'Suerte', noon - 6 * 3600000),
    MSG('user', 'Estoy muy estresado y asustado por todo', noon),
  ];
  const lorebook = [{ content: `${U} adora el café con canela y los domingos de lluvia en la ciudad vieja junto al río` }];
  for (const r of [0, 0.5, 0.99]) {
    const { note } = buildPresence({ character: { id: 'x', name: N, lorebook, personalityTags: [] }, messages, settings: { user: U, emotionResponse: true }, now: new Date(noon), rnd: () => r });
    assert.ok(note.length <= PRESENCE_NOTE_MAX, `${note.length}`);
    assert.ok(note.includes('sounds under pressure') || note.includes('sounds frightened'), 'el registro entra primero');
    assert.match(note, /single/);
  }
});

test('HUM-002 la reserva fija del prompt y el tope de la nota van atados (reserva = tope + 10 de corchetes y salto)', () => {
  assert.equal(PRESENCE_RESERVE_CHARS, PRESENCE_NOTE_MAX + 10);
});

// ---------- ritmo ----------

test('HUM-002 pickRhythm: con tristeza sale más corta y con alegría más llena (siempre un solo párrafo)', () => {
  const count = (emotionId) => {
    const c = { brief: 0, medium: 0, full: 0 };
    let n = 0;
    const rnd = () => { n += 0.0137; return n % 1; };
    for (let i = 0; i < 400; i++) {
      const r = pickRhythm({ userText: 'hoy fue un día largo y pasaron muchas cosas en el trabajo que quiero contarte', emotionId, rnd });
      assert.match(r.text, /single/);
      c[r.id]++;
    }
    return c;
  };
  const none = count('');
  const sad = count('sad');
  const happy = count('happy');
  assert.ok(sad.full === 0 && sad.brief > none.brief, JSON.stringify({ none, sad }));
  for (const e of ['stressed', 'scared', 'tired']) assert.equal(count(e).full, 0, `${e}: nunca el párrafo más lleno`);
  assert.ok(happy.full > none.full, JSON.stringify({ none, happy }));
  for (const e of EMOTIONS) assert.ok(count(e).brief + count(e).medium + count(e).full === 400);
});

test('HUM-002 pickRhythm: sin emoción (o una desconocida) idéntico a HUM-001', () => {
  const a = pickRhythm({ userText: 'hola', moodId: 'calm', rnd: () => 0.3 });
  const b = pickRhythm({ userText: 'hola', moodId: 'calm', emotionId: 'nope', rnd: () => 0.3 });
  assert.deepEqual(a, b);
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
const card = { name: 'Luna', description: '', personality: 'Calm.', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
const baseSettings = { user: 'Edgar', maxLen: 220, temp: 0.85, mode: 'chat', ctx: 4096 };

test('HUM-002 generateReply: el registro viaja al final del último mensaje del usuario solo con humanTouch + emotionResponse y una emoción', async () => {
  const seen = {};
  const server = chatServer(seen);
  const base = await listen(server);
  try {
    const now = at(2026, 10, 2, 15);
    const sad = [{ role: 'user', text: 'Estoy muy triste hoy, lloré toda la mañana', ts: now.getTime() }];
    const char = () => ({ id: 'c1', name: 'Luna', avatar: '', card: { ...card }, lorebook: [], personalityTags: [] });
    await generateReply({ character: char(), messages: sad, settings: { ...baseSettings, url: base, humanTouch: true, emotionResponse: true }, now, rnd: () => 0.5 });
    assert.match(seen.body.messages.at(-1).content, /Edgar sounds low right now\. Luna slows the pace/);
    await generateReply({ character: char(), messages: sad, settings: { ...baseSettings, url: base, humanTouch: true, emotionResponse: false }, now, rnd: () => 0.5 });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /sounds low/);
    await generateReply({ character: char(), messages: sad, settings: { ...baseSettings, url: base, humanTouch: false, emotionResponse: true }, now, rnd: () => 0.5 });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /feels|sounds low/);
    const neutral = [{ role: 'user', text: 'Cuéntame algo', ts: now.getTime() }];
    await generateReply({ character: char(), messages: neutral, settings: { ...baseSettings, url: base, humanTouch: true, emotionResponse: true }, now, rnd: () => 0.5 });
    assert.doesNotMatch(seen.body.messages.at(-1).content, /sounds/);
  } finally {
    server.close();
  }
});

test('HUM-002 el prompt con todos los interruptores apagados es IDÉNTICO al de antes de HUM-002', async () => {
  const seen = [];
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    seen.push(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"Hola"}}]}\n\n');
    res.write('data: [DONE]\n\n');
    res.end();
  });
  const base = await listen(server);
  try {
    const now = at(2026, 10, 2, 15);
    const messages = [{ role: 'user', text: 'Estoy muy triste hoy', ts: now.getTime() }];
    const char = { id: 'c1', name: 'Luna', avatar: '', card: { ...card }, lorebook: [], personalityTags: [] };
    // Sin los campos de HUM: igual que cualquier `settings` anterior.
    await generateReply({ character: char, messages, settings: { ...baseSettings, url: base }, now });
    await generateReply({ character: char, messages, settings: { ...baseSettings, url: base, humanTouch: false, emotionResponse: false }, now });
    assert.deepEqual(seen[0].messages, seen[1].messages);
    assert.doesNotMatch(JSON.stringify(seen[0].messages), /feels|sounds/);
  } finally {
    server.close();
  }
});
