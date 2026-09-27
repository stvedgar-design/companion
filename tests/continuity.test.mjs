// tests/continuity.test.mjs — MEM-007: resumen de continuidad por chat (funciones puras y actualizador).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  CONTINUITY_RECAP_CHARS,
  CONTINUITY_TOTAL_CHARS,
  CONTINUITY_LOOKAHEAD_CHARS,
  CONTINUITY_CHUNK_MAX_CHARS,
  CONTINUITY_CHUNK_MIN_MESSAGES,
  CONTINUITY_KEEP_RECENT_MESSAGES,
  CONTINUITY_ABSENCE_MS,
  isLongAbsence,
  splitSentences,
  fitToChars,
  keepNewestSentences,
  appendRecap,
  cleanRecap,
  verifyRecap,
  coveredCount,
  planContinuityUpdate,
  planForContext,
} from '../www/js/api/continuity.js';
import { buildChatMessages, buildPlainPrompt, historyStartIndex, CONTINUITY_RESERVE_CHARS, continuityBlockChars } from '../www/js/api/prompt.js';

function makeCard(overrides = {}) {
  return { name: 'Mia', description: 'Una androide tímida.', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null, ...overrides };
}
function makeSettings(overrides = {}) {
  return { url: 'http://localhost:5001', user: 'Sam', maxLen: 220, temp: 0.8, mode: 'chat', ctx: 2048, ...overrides };
}
function makeMessages(n, len = 120) {
  return Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'char' : 'user', text: `#${i}# ` + 'palabra '.repeat(Math.ceil(len / 8)), ts: 1000 + i * 10 }));
}

/* ---------- frases y topes ---------- */

test('splitSentences parte en frases y conserva la puntuación', () => {
  assert.deepEqual(splitSentences('Sam told Mia about his job. Mia asked a question! Then they laughed'), ['Sam told Mia about his job.', 'Mia asked a question!', 'Then they laughed']);
  assert.deepEqual(splitSentences('  '), []);
  assert.deepEqual(splitSentences(undefined), []);
});

test('fitToChars deja solo frases COMPLETAS dentro del tope; nunca una a medias', () => {
  const t = 'One two three. Four five six seven. Eight nine.';
  assert.equal(fitToChars(t, 100), t);
  assert.equal(fitToChars(t, 40), 'One two three. Four five six seven.'.length <= 40 ? 'One two three. Four five six seven.' : 'One two three.');
  assert.equal(fitToChars(t, 20), 'One two three.');
  // Si ni la primera frase cabe, corta en un espacio (sin dejar una palabra partida).
  const cut = fitToChars('Una frase larguísima sin ningún punto final que no cabe', 22);
  assert.ok(cut.length <= 22 && !/\s$/.test(cut) && 'Una frase larguísima sin ningún punto final que no cabe'.startsWith(cut));
  assert.ok(!cut.endsWith('larguís'));
});

test('keepNewestSentences descarta desde la frase más ANTIGUA y no inventa nada', () => {
  const t = 'Uno dos tres. Cuatro cinco seis siete. Ocho nueve.';
  assert.equal(keepNewestSentences(t, 100), t);
  assert.equal(keepNewestSentences(t, 40), 'Cuatro cinco seis siete. Ocho nueve.'.length <= 40 ? 'Cuatro cinco seis siete. Ocho nueve.' : 'Ocho nueve.');
  assert.equal(keepNewestSentences(t, 12), 'Ocho nueve.');
  for (const cap of [5, 12, 30, 60]) {
    const out = keepNewestSentences(t, cap);
    assert.ok(out.length <= cap && t.includes(out.replace(/\s+$/, '').split(' ')[0]));
  }
});

test('appendRecap añade al final (rollo) y avisa si ya no cabe en el tope total', () => {
  assert.deepEqual(appendRecap('', 'Primero.', 100), { text: 'Primero.', fits: true });
  assert.deepEqual(appendRecap('Primero.', 'Segundo.', 100), { text: 'Primero. Segundo.', fits: true });
  assert.equal(appendRecap('a'.repeat(60), 'b'.repeat(60), 100).fits, false);
  assert.equal(appendRecap(' Primero.  ', '  ', 100).text, 'Primero.');
  assert.ok(CONTINUITY_RECAP_CHARS < CONTINUITY_TOTAL_CHARS);
  // El tope de trabajo (con la etiqueta y los corchetes) cabe en la reserva fija del prompt: cambiar el resumen no mueve la ventana.
  assert.ok(continuityBlockChars('x'.repeat(CONTINUITY_TOTAL_CHARS)) === CONTINUITY_RESERVE_CHARS);
});

/* ---------- limpieza y verificación ---------- */

test('cleanRecap quita la etiqueta, recorta a frases completas y rechaza lo que no es un recuento', () => {
  const opts = { charName: 'Mia', userName: 'Sam' };
  assert.equal(cleanRecap(' Recap: Sam told Mia that he got a job at the bakery.', opts), 'Sam told Mia that he got a job at the bakery.');
  assert.equal(cleanRecap('Sam told Mia about his day. She listened. ' + 'x'.repeat(600), { ...opts, cap: 60 }), 'Sam told Mia about his day. She listened.');
  for (const bad of ['', '   ', 'Ok.', '*I smile and nod.* Sam told me about the job.', 'Mia: I think that was lovely, Sam.', "I'm sorry, I can't help with that request."]) {
    assert.equal(cleanRecap(bad, opts), '', JSON.stringify(bad));
  }
});

test('verifyRecap pilla nombres propios y números que no están en el fragmento (y acepta los que sí)', () => {
  const src = 'Sam: I got the job at the bakery on Elm Street, I start Monday! Mia: Wonderful, Sam. Laura called about the hospital shift.';
  assert.deepEqual(verifyRecap('Sam told Mia he got a job at the bakery on Elm Street and starts Monday.', src, ['Sam', 'Mia']), { ok: true, unsupported: [] });
  const bad = verifyRecap('Sam got a job at the Sunrise Bakery in Paris on 14 May.', src, ['Sam', 'Mia']);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.unsupported.sort(), ['14', 'May', 'Paris', 'Sunrise'].sort());
  // Posesivos ("Marcus'", "Laura's") y palabras que abren frase no cuentan como datos nuevos.
  assert.equal(verifyRecap("Sam mentioned Laura's shift and the bakery's hours.", src, ['Sam', 'Mia']).unsupported.includes("bakery's"), false);
  assert.equal(verifyRecap("Sam heard from James' friend.", "Sam: James told me. Mia: Oh.", ['Sam', 'Mia']).ok, true);
  // Una palabra que abre frase no cuenta como nombre propio; el verbo en otra forma tampoco es "nuevo".
  assert.equal(verifyRecap('Laura called. Starting Monday, Sam works there.', src, ['Sam', 'Mia']).ok, true);
});

/* ---------- qué está cubierto y cuándo se dispara ---------- */

test('coveredCount cuenta por ts desde el principio: borrar o editar mensajes no lo desalinea', () => {
  const msgs = makeMessages(10);
  assert.equal(coveredCount(msgs, 0), 0);
  assert.equal(coveredCount(msgs, msgs[3].ts), 4);
  assert.equal(coveredCount(msgs, msgs[3].ts + 5), 4);
  assert.equal(coveredCount(msgs, 999999), 10);
  const withoutOne = msgs.filter((_, i) => i !== 1);              // se borró un mensaje que ya estaba cubierto
  assert.equal(coveredCount(withoutOne, msgs[3].ts), 3);          // sigue cubriendo exactamente los mismos mensajes que quedan
  assert.equal(coveredCount([{ text: 'x' }, { text: 'y' }], 50), 0); // mensajes sin ts: no se puede afirmar que estén cubiertos
});

test('planContinuityUpdate: NO se dispara si el primer mensaje visible sin resumir no está a punto de caer', () => {
  const msgs = makeMessages(60);
  assert.deepEqual(planContinuityUpdate({ messages: msgs, coveredUntil: 0, windowStart: 0, triggerStart: 0 }), { kind: 'none' });
  // Todo lo que está por caer ya está cubierto.
  assert.deepEqual(planContinuityUpdate({ messages: msgs, coveredUntil: msgs[19].ts, windowStart: 5, triggerStart: 20 }), { kind: 'none' });
});

test('planContinuityUpdate: se dispara cuando hay mensajes visibles sin resumir a punto de caer, y elige un fragmento acotado', () => {
  const msgs = makeMessages(80, 200);
  const plan = planContinuityUpdate({ messages: msgs, coveredUntil: 0, windowStart: 10, triggerStart: 14 });
  assert.equal(plan.kind, 'update');
  assert.equal(plan.from, 10);                                    // lo ya recortado (0-9) no se puede recuperar: se empieza en lo visible
  assert.ok(plan.to - plan.from >= CONTINUITY_CHUNK_MIN_MESSAGES);
  const chars = plan.chunk.reduce((s, m) => s + m.text.length, 0);
  assert.ok(chars <= CONTINUITY_CHUNK_MAX_CHARS + 260);
  assert.equal(plan.chunk[0], msgs[10]);
  assert.equal(plan.coveredUntil, plan.chunk[plan.chunk.length - 1].ts);
  assert.ok(plan.to <= msgs.length - CONTINUITY_KEEP_RECENT_MESSAGES);
  assert.notEqual(msgs[plan.to - 1].role, 'user');                // termina en un intercambio completo cuando puede
});

test('planContinuityUpdate: continúa donde quedó el resumen (no vuelve a resumir lo cubierto)', () => {
  const msgs = makeMessages(80, 200);
  const first = planContinuityUpdate({ messages: msgs, coveredUntil: 0, windowStart: 10, triggerStart: 14 });
  const second = planContinuityUpdate({ messages: msgs, coveredUntil: first.coveredUntil, windowStart: 10, triggerStart: first.to + 2 });
  assert.equal(second.kind, 'update');
  assert.equal(second.from, first.to);
  // Sin mensajes suficientes para un fragmento útil, o sin los últimos mensajes libres: no hay actualización.
  assert.deepEqual(planContinuityUpdate({ messages: makeMessages(6), coveredUntil: 0, windowStart: 0, triggerStart: 3 }), { kind: 'none' });
});

test('planContinuityUpdate: un mensaje sin ts al final del fragmento no rompe nada (no se actualiza)', () => {
  const msgs = makeMessages(40).map((m) => ({ role: m.role, text: m.text }));
  assert.deepEqual(planContinuityUpdate({ messages: msgs, coveredUntil: 0, windowStart: 0, triggerStart: 10 }), { kind: 'none' });
});

test('planForContext usa la cuenta real del prompt: un chat que cabe entero nunca dispara; uno que se recorta, sí', () => {
  const character = { card: makeCard(), lorebook: [] };
  const settings = makeSettings({ ctx: 2048 });
  const small = makeMessages(10, 100);
  assert.deepEqual(planForContext({ character, chat: { continuitySummary: { text: '', coveredUntil: 0 } }, messages: small, settings }), { kind: 'none' });
  const big = makeMessages(120, 160);
  const idx = historyStartIndex(character.card, big, settings);
  assert.ok(idx > 20, 'con ctx 2048 y 120 mensajes ya se recorta bastante');
  const plan = planForContext({ character, chat: { continuitySummary: { text: '', coveredUntil: 0 } }, messages: big, settings });
  assert.equal(plan.kind, 'update');
  assert.ok(plan.from >= idx);                                    // solo resume lo que todavía es visible
  // Lo que se resume sigue DENTRO del prompt real en este momento (es lo que permite pedirlo sobre el prefijo del chat).
  const sent = buildChatMessages(character.card, big, settings).messages.map((m) => m.content).join('\n');
  for (const m of plan.chunk) assert.ok(sent.includes(m.text.slice(0, 6)));
  // El manual mira más lejos que el automático.
  const manual = planForContext({ character, chat: { continuitySummary: { text: '', coveredUntil: 0 } }, messages: makeMessages(45, 160), settings }, { manual: true });
  const auto = planForContext({ character, chat: { continuitySummary: { text: '', coveredUntil: 0 } }, messages: makeMessages(45, 160), settings });
  assert.ok(manual.kind === 'update' || auto.kind === 'none');
  assert.ok(CONTINUITY_LOOKAHEAD_CHARS > 0);
});

/* ---------- armadores de petición ---------- */

import {
  CONTINUITY_PREFILL,
  CONTINUITY_MAX_ATTEMPTS,
  CONTINUITY_RETRY_COOLDOWN_MS,
  recapInstruction,
  condenseInstruction,
  buildContinuationRequest,
  createContinuityUpdater,
} from '../www/js/api/continuity.js';

test('recapInstruction incluye el fragmento entero, los nombres, el tope y el idioma; condenseInstruction las dos notas', () => {
  const chunk = [{ role: 'user', text: 'I got a job at the bakery.', ts: 1 }, { role: 'char', text: '*I smile.* Wonderful!', ts: 2 }];
  const text = recapInstruction(chunk, { charName: 'Mia', userName: 'Sam' });
  assert.ok(text.includes('Sam: I got a job at the bakery.') && text.includes('Mia: *I smile.* Wonderful!'));
  assert.ok(text.includes(`under ${CONTINUITY_RECAP_CHARS} characters`) && text.includes('same language') && /nothing invented/i.test(text));
  assert.ok(text.includes('if Mia asked or offered something, write Mia') && text.includes('if Sam did, write Sam'));   // quién hizo o dijo cada cosa
  assert.ok(text.startsWith('[') && text.endsWith(']'));
  const cond = condenseInstruction('Old note.', 'New note.', { charName: 'Mia', userName: 'Sam' });
  assert.ok(cond.includes('Note 1: Old note.') && cond.includes('Note 2: New note.'));
});

test('buildContinuationRequest (plantilla): son los mismos mensajes del chat normal + instrucción + inicio de respuesta, sin el resumen', () => {
  const character = { card: makeCard(), lorebook: [{ id: 'a', keys: ['x'], content: 'Sam es alérgico a los cacahuetes.', updated: 1, source: 'manual', always: true }] };
  const settings = makeSettings({ mode: 'chat', ctx: 4096 });
  const messages = makeMessages(9);
  const chat = { scenario: '', continuitySummary: { text: 'Resumen viejo.', coveredUntil: 0, updated: 1 } };
  const req = buildContinuationRequest({ character, chat, messages, settings }, '[INSTR]');
  // MEM-008: con 1 recuerdo el nivel es "few" y la cabecera lleva la línea de la relación (igual que en el chat normal).
  const normal = buildChatMessages(character.card, messages, settings, '', 'Always keep in mind:\n- Sam es alérgico a los cacahuetes.', '', '', false, { relationship: 'few' });
  assert.equal(req.mode, 'chat');
  assert.ok(normal.messages[0].content.includes('Relationship so far: Sam and Mia are still getting to know each other.'));
  assert.deepEqual(req.messages.slice(0, -2), normal.messages);          // mismo prefijo exacto: la caché del servidor se reutiliza
  assert.deepEqual(req.messages.slice(-2), [{ role: 'user', content: '[INSTR]' }, { role: 'assistant', content: CONTINUITY_PREFILL }]);
  assert.deepEqual(req.stop, ['\n']);
  assert.ok(!JSON.stringify(req.messages).includes('Resumen viejo'));
});

test('buildContinuationRequest (texto simple): el prompt normal sin la pista final, más instrucción e inicio de respuesta', () => {
  const character = { card: makeCard(), lorebook: [] };
  const settings = makeSettings({ mode: 'plain', ctx: 4096 });
  const messages = makeMessages(9);
  const req = buildContinuationRequest({ character, chat: { scenario: '' }, messages, settings }, '[INSTR]');
  const normal = buildPlainPrompt(character.card, messages, settings).prompt;
  assert.equal(req.mode, 'plain');
  assert.ok(normal.endsWith('\nMia:'));
  assert.equal(req.prompt, normal.slice(0, -'\nMia:'.length) + `\n[INSTR]\n${CONTINUITY_PREFILL}`);
});

/* ---------- actualizador ---------- */

function makeHarness(overrides = {}) {
  const calls = { complete: [], saved: [], aborted: 0 };
  const state = {
    busy: false,
    now: 1_000_000,
    character: { id: 'char1', card: makeCard(), lorebook: [] },
    chat: { id: 'chat1', scenario: '', continuitySummary: { text: '', coveredUntil: 0, updated: 0 } },
    messages: makeMessages(120, 160),
    settings: makeSettings({ ctx: 2048, mode: 'chat', continuityAuto: true }),
    reply: () => 'Sam and Mia talked about palabra for a while.',
    ...overrides,
  };
  const updater = createContinuityUpdater({
    getContext: () => ({ character: state.character, chat: state.chat, messages: state.messages, settings: state.settings }),
    isChatBusy: () => state.busy,
    complete: (request, opts) => {
      calls.complete.push(request);
      return new Promise((resolve, reject) => {
        opts.signal.addEventListener('abort', () => { calls.aborted++; reject(Object.assign(new Error('Cancelado.'), { code: 'ABORTED' })); });
        Promise.resolve()
          .then(() => state.reply(request, calls.complete.length))
          .then(resolve, reject);
      });
    },
    loadChat: async () => state.chat,
    saveContinuity: async (id, summary) => { calls.saved.push(summary); state.chat = { ...state.chat, continuitySummary: summary }; },
    now: () => state.now,
  });
  return { updater, state, calls };
}

test('actualizador: un chat que cabe entero NUNCA dispara (no llama al servidor ni guarda nada)', async () => {
  const h = makeHarness({ messages: makeMessages(12, 100) });
  assert.deepEqual(await h.updater.maybeRun(), { kind: 'none' });
  assert.equal(h.calls.complete.length, 0);
  assert.equal(h.calls.saved.length, 0);
});

test('actualizador: cuando hay mensajes visibles a punto de caer, resume UN fragmento y avanza hasta donde llegó', async () => {
  const h = makeHarness();
  const result = await h.updater.maybeRun();
  assert.equal(result.kind, 'ok');
  assert.equal(h.calls.complete.length, 1);
  const req = h.calls.complete[0];
  assert.equal(req.mode, 'chat');
  assert.equal(req.messages[req.messages.length - 2].role, 'user');
  assert.equal(req.messages[req.messages.length - 1].content, CONTINUITY_PREFILL);
  const saved = h.calls.saved[0];
  assert.equal(saved.text, 'Sam and Mia talked about palabra for a while.');
  assert.ok(saved.coveredUntil > 0 && saved.updated === 1_000_000);
  // Lo que se cubrió es lo primero visible sin resumir: el siguiente disparo continúa después.
  assert.ok(coveredCount(h.state.messages, saved.coveredUntil) > 4);
  // Un segundo disparo inmediato no repite el mismo fragmento (ya está cubierto y lo siguiente no está a punto de caer).
  assert.equal((await h.updater.maybeRun()).kind, 'none');
  assert.equal(h.calls.complete.length, 1);
});

test('actualizador: respeta el interruptor, el chat ocupado y una actualización ya en curso', async () => {
  const off = makeHarness({ settings: makeSettings({ ctx: 2048, mode: 'chat', continuityAuto: false }) });
  assert.deepEqual(await off.updater.maybeRun(), { kind: 'skipped' });
  assert.equal(off.calls.complete.length, 0);
  const busy = makeHarness();
  busy.state.busy = true;
  assert.deepEqual(await busy.updater.maybeRun(), { kind: 'skipped' });
  assert.deepEqual(await busy.updater.runNow(), { kind: 'busy' });
  assert.equal(busy.calls.complete.length, 0);
  // Mientras corre una, otra no arranca.
  let release;
  const slow = makeHarness({ reply: () => new Promise((r) => { release = () => r('Sam and Mia talked about palabra.'); }) });
  const first = slow.updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(slow.updater.isRunning(), true);
  assert.deepEqual(await slow.updater.maybeRun(), { kind: 'skipped' });
  release();
  assert.equal((await first).kind, 'ok');
  assert.equal(slow.updater.isRunning(), false);
});

test('actualizador: abort() cancela sin guardar nada y el siguiente intento puede repetirlo', async () => {
  const h = makeHarness({ reply: () => new Promise(() => {}) }); // no responde nunca
  const pending = h.updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  h.updater.abort();
  assert.equal((await pending).kind, 'aborted');
  assert.equal(h.calls.aborted, 1);
  assert.equal(h.calls.saved.length, 0);
  assert.equal(h.updater.isRunning(), false);
  assert.equal(h.updater.getStatus().kind, 'aborted');
});

test('actualizador: una respuesta en personaje, vacía o con datos inventados NO se guarda, y se reintenta a lo sumo dos veces', async () => {
  for (const bad of ['*I smile and nod.* Sam told me about the job.', '', 'Sam told Mia about the Sunrise Bakery in Paris on 14 May.']) {
    const h = makeHarness({ reply: () => bad });
    const first = await h.updater.maybeRun();
    assert.ok(['unparsed', 'unverified'].includes(first.kind), bad);
    assert.equal(h.calls.saved.length, 0);
    assert.equal(h.state.chat.continuitySummary.text, '');
    for (let i = 1; i < CONTINUITY_MAX_ATTEMPTS; i++) await h.updater.maybeRun();
    assert.deepEqual(await h.updater.maybeRun(), { kind: 'skipped' });        // ya no insiste con el mismo fragmento
    assert.equal(h.calls.complete.length, CONTINUITY_MAX_ATTEMPTS);
  }
});

test('actualizador: servidor caído → "unavailable", sin guardar, y no reintenta solo hasta pasado el enfriamiento; "Resumir ahora" sí', async () => {
  const h = makeHarness({ reply: () => { throw Object.assign(new Error('x'), { code: 'NETWORK' }); } });
  assert.equal((await h.updater.maybeRun()).kind, 'unavailable');
  assert.equal(h.calls.saved.length, 0);
  assert.deepEqual(await h.updater.maybeRun(), { kind: 'skipped' });
  assert.equal(h.calls.complete.length, 1);
  h.state.now += CONTINUITY_RETRY_COOLDOWN_MS + 1;
  h.state.reply = () => 'Sam and Mia talked about palabra.';
  assert.equal((await h.updater.maybeRun()).kind, 'ok');
});

test('actualizador: acumula (rollo) y, si ya no cabe en el tope, condensa con verificación; si el condensado no sirve, descarta lo más antiguo', async () => {
  const long = 'Sam told Mia about palabra number one and more palabra details. '.repeat(10).trim();
  const existing = { text: long, coveredUntil: 0, updated: 5 };
  const okCondense = 'Sam told Mia about palabra number one and more palabra details, and they talked again about palabra.';
  const cases = [
    { name: 'condensado válido', reply: (req, n) => (n === 1 ? 'Sam and Mia talked about palabra again and again ' + 'palabra '.repeat(50) + '.' : okCondense), expectCondensed: true },
    { name: 'condensado con un dato inventado', reply: (req, n) => (n === 1 ? 'Sam and Mia talked about palabra again ' + 'palabra '.repeat(50) + '.' : 'Sam and Mia went to Paris together after palabra.'), expectCondensed: false },
    { name: 'condensado vacío', reply: (req, n) => (n === 1 ? 'Sam and Mia talked about palabra again ' + 'palabra '.repeat(50) + '.' : ''), expectCondensed: false },
  ];
  for (const c of cases) {
    const h = makeHarness({ reply: c.reply });
    h.state.chat = { ...h.state.chat, continuitySummary: existing };
    const result = await h.updater.maybeRun();
    assert.equal(result.kind, 'ok', c.name);
    assert.equal(result.condensed, true);
    assert.equal(h.calls.complete.length, 2, c.name);
    const saved = h.calls.saved[0];
    assert.ok(saved.text.length <= CONTINUITY_TOTAL_CHARS, `${c.name}: tope`);
    assert.ok(saved.text.length >= 60, c.name);
    if (c.expectCondensed) assert.equal(saved.text, okCondense);
    else assert.ok(!saved.text.includes('Paris'), c.name);
  }
});

test('actualizador: si el usuario edita o borra el resumen mientras corre, el resultado NO lo pisa', async () => {
  let release;
  const h = makeHarness({ reply: () => new Promise((r) => { release = () => r('Sam and Mia talked about palabra.'); }) });
  const pending = h.updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  h.state.chat = { ...h.state.chat, continuitySummary: { text: 'Lo escribí yo.', coveredUntil: 0, updated: 777 } };   // edición manual en medio
  release();
  assert.equal((await pending).kind, 'aborted');
  assert.equal(h.calls.saved.length, 0);
  assert.equal(h.state.chat.continuitySummary.text, 'Lo escribí yo.');
});

test('actualizador: "Resumir ahora" avisa si todavía no hace falta, y funciona aunque el automático esté apagado', async () => {
  const short = makeHarness({ messages: makeMessages(10, 100), settings: makeSettings({ ctx: 4096, mode: 'chat', continuityAuto: false }) });
  assert.deepEqual(await short.updater.runNow(), { kind: 'notyet' });
  assert.equal(short.calls.complete.length, 0);
  const long = makeHarness({ settings: makeSettings({ ctx: 2048, mode: 'chat', continuityAuto: false }) });
  assert.equal((await long.updater.runNow()).kind, 'ok');
  assert.equal(long.calls.saved.length, 1);
});

test('actualizador: un chat guardado antes de MEM-007 (sin continuitySummary) funciona igual; el objeto del chat no se muta', async () => {
  const h = makeHarness();
  const legacyChat = { id: 'chat1', scenario: '' };
  h.state.chat = legacyChat;
  const result = await h.updater.maybeRun();
  assert.equal(result.kind, 'ok');
  assert.deepEqual(Object.keys(legacyChat).sort(), ['id', 'scenario']);
  const before = JSON.stringify(h.state.messages);
  await h.updater.maybeRun();
  assert.equal(JSON.stringify(h.state.messages), before);          // los mensajes guardados no se tocan nunca
});

/* ---------- MEM-010: repaso al volver tras una ausencia ---------- */

const HOUR = 60 * 60 * 1000;
// Mensajes con fecha real relativa a `state.now` (el harness fija now = 1_000_000 ms); el último mensaje fue hace `agoMs`.
function withLastMessageAgo(h, agoMs) {
  const n = h.state.messages.length;
  h.state.messages = h.state.messages.map((m, i) => ({ ...m, ts: h.state.now - agoMs - (n - 1 - i) * 1000 }));
  return h;
}
const NOW_BIG = 100 * HOUR; // un "ahora" lo bastante grande para restar horas sin dar fechas negativas

test('MEM-010: isLongAbsence mide desde el ÚLTIMO mensaje, con umbral en horas; sin fecha válida o sin mensajes no dispara nada', () => {
  assert.equal(CONTINUITY_ABSENCE_MS, 8 * HOUR);
  assert.ok(CONTINUITY_ABSENCE_MS >= 6 * HOUR && CONTINUITY_ABSENCE_MS <= 12 * HOUR, 'dentro del rango propuesto (6-12 h)');
  const at = (ago) => [{ role: 'char', text: 'x', ts: NOW_BIG - ago }];
  assert.equal(isLongAbsence(at(9 * HOUR), NOW_BIG), true);
  assert.equal(isLongAbsence(at(8 * HOUR), NOW_BIG), false);      // justo en el umbral: no
  assert.equal(isLongAbsence(at(5 * 60 * 1000), NOW_BIG), false);
  assert.equal(isLongAbsence(at(9 * HOUR), NOW_BIG, 10 * HOUR), false);
  for (const bad of [[], undefined, null, [{ text: 'sin ts' }], [{ ts: 'ayer' }], [{ ts: NaN }]]) assert.equal(isLongAbsence(bad, NOW_BIG), false);
  assert.equal(isLongAbsence(at(9 * HOUR), NaN), false);
});

test('MEM-010: al abrir un chat con ausencia larga y resumen a punto de hacer falta, se actualiza en segundo plano (mismo disparo, mismos topes)', async () => {
  const h = withLastMessageAgo(makeHarness({ now: NOW_BIG }), 9 * HOUR);
  const result = await h.updater.maybeRun({ onOpen: true });
  assert.equal(result.kind, 'ok');
  assert.equal(h.calls.complete.length, 1);
  assert.equal(h.calls.saved.length, 1);
  // exactamente la misma actualización que habría hecho el disparo perezoso de siempre
  const lazy = withLastMessageAgo(makeHarness({ now: NOW_BIG }), 9 * HOUR);
  await lazy.updater.maybeRun();
  assert.deepEqual(h.calls.saved[0], lazy.calls.saved[0]);
  assert.deepEqual(h.calls.complete[0], lazy.calls.complete[0]);
});

test('MEM-010: sin ausencia larga, abrir el chat NO dispara nada extra (aunque el resumen esté a punto de hacer falta); el disparo perezoso de siempre sigue igual', async () => {
  const h = withLastMessageAgo(makeHarness({ now: NOW_BIG }), 30 * 60 * 1000);
  assert.deepEqual(await h.updater.maybeRun({ onOpen: true }), { kind: 'skipped' });
  assert.equal(h.calls.complete.length, 0);
  assert.equal((await h.updater.maybeRun()).kind, 'ok'); // sin onOpen, como siempre (MEM-007)
});

test('MEM-010: con la continuidad APAGADA (o el chat ocupado, o en enfriamiento) abrir el chat no hace nada, aunque haya pasado mucho tiempo', async () => {
  const off = withLastMessageAgo(makeHarness({ now: NOW_BIG, settings: makeSettings({ ctx: 2048, mode: 'chat', continuityAuto: false }) }), 20 * HOUR);
  assert.deepEqual(await off.updater.maybeRun({ onOpen: true }), { kind: 'skipped' });
  assert.equal(off.calls.complete.length, 0);
  assert.equal(off.calls.saved.length, 0);
  const busy = withLastMessageAgo(makeHarness({ now: NOW_BIG }), 20 * HOUR);
  busy.state.busy = true;
  assert.deepEqual(await busy.updater.maybeRun({ onOpen: true }), { kind: 'skipped' });
  assert.equal(busy.calls.complete.length, 0);
  const down = withLastMessageAgo(makeHarness({ now: NOW_BIG, reply: () => { throw Object.assign(new Error('x'), { code: 'NETWORK' }); } }), 20 * HOUR);
  assert.equal((await down.updater.maybeRun({ onOpen: true })).kind, 'unavailable');
  assert.deepEqual(await down.updater.maybeRun({ onOpen: true }), { kind: 'skipped' }); // respeta el enfriamiento de 5 min
  assert.equal(down.calls.complete.length, 1);
});

test('MEM-010: un chat que cabe entero no dispara al abrir, por larga que sea la ausencia', async () => {
  const h = withLastMessageAgo(makeHarness({ now: NOW_BIG, messages: makeMessages(12, 100) }), 48 * HOUR);
  assert.deepEqual(await h.updater.maybeRun({ onOpen: true }), { kind: 'none' });
  assert.equal(h.calls.complete.length, 0);
});

test('MEM-010: si el usuario empieza a escribir mientras corre el repaso de apertura, cede (abortOnOpenRun) y no guarda nada', async () => {
  const h = withLastMessageAgo(makeHarness({ now: NOW_BIG, reply: () => new Promise(() => {}) }), 9 * HOUR); // no responde nunca
  const pending = h.updater.maybeRun({ onOpen: true });
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(h.updater.isRunning(), true);
  h.updater.abortOnOpenRun();
  assert.equal((await pending).kind, 'aborted');
  assert.equal(h.calls.aborted, 1);
  assert.equal(h.calls.saved.length, 0);
  assert.equal(h.updater.isRunning(), false);
});

test('MEM-010: al enviar un mensaje, abort() también cancela el repaso de apertura; y abortOnOpenRun NO toca una actualización que no nació al abrir', async () => {
  const sent = withLastMessageAgo(makeHarness({ now: NOW_BIG, reply: () => new Promise(() => {}) }), 9 * HOUR);
  const p1 = sent.updater.maybeRun({ onOpen: true });
  await new Promise((r) => setTimeout(r, 5));
  sent.updater.abort();
  assert.equal((await p1).kind, 'aborted');
  assert.equal(sent.calls.saved.length, 0);
  // una actualización perezosa normal (no de apertura) no se cancela por abortOnOpenRun
  let release;
  const lazy = makeHarness({ now: NOW_BIG, reply: () => new Promise((r) => { release = () => r('Sam and Mia talked about palabra.'); }) });
  const p2 = lazy.updater.maybeRun();
  await new Promise((r) => setTimeout(r, 5));
  lazy.updater.abortOnOpenRun();
  assert.equal(lazy.updater.isRunning(), true);
  release();
  assert.equal((await p2).kind, 'ok');
  assert.equal(lazy.calls.aborted, 0);
});

test('MEM-010: chat.js evalúa el disparo al abrir con retraso, lo invalida al salir y cede al escribir (sin esperar a nada al abrir)', () => {
  const src = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(src, /maybeUpdateContinuityOnOpen\(\);\n\}/);                       // último paso de show()
  assert.ok(!/await maybeUpdateContinuityOnOpen/.test(src), 'abrir el chat no espera al repaso');
  assert.match(src, /setTimeout\(\(\) => \{\s*if \(token !== openToken \|\| !chat\) return;\s*continuityUpdater\.maybeRun\(\{ onOpen: true \}\)/);
  assert.match(src, /export function hide\(\) \{\s*openToken\+\+;/);
  assert.match(src, /function onInputChange\(\) \{\s*continuityUpdater\.abortOnOpenRun\(\);/);
  assert.match(src, /CONTINUITY_ON_OPEN_DELAY_MS/);
});
