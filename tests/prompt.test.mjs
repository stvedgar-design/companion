import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  subMacros,
  initialMessages,
  scenarioGreeting,
  buildPlainPrompt,
  buildChatMessages,
  estimateContextUsage,
  cleanReply,
  trimPartial,
  FORMAT_PREFILL,
  formatContinuityBlock,
  continuityBlockChars,
  historyStartIndex,
  CONTINUITY_RESERVE_CHARS
} from '../www/js/api/prompt.js';

function makeCard(overrides = {}) {
  return {
    name: 'Luna',
    description: '',
    personality: '',
    scenario: '',
    first_mes: '',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    character_book: null,
    ...overrides
  };
}

function makeSettings(overrides = {}) {
  return {
    url: 'http://100.1.1.1:5001',
    user: 'Edgar',
    maxLen: 220,
    temp: 0.85,
    mode: 'plain',
    ctx: 4096,
    ...overrides
  };
}

// ---------- subMacros ----------

test('subMacros reemplaza {{char}}, <BOT>, {{user}}, <USER> sin distinguir mayúsculas', () => {
  const out = subMacros('Hola {{USER}}, soy <bot>. {{char}} y <User> hablan.', 'Luna', 'Edgar');
  assert.equal(out, 'Hola Edgar, soy Luna. Luna y Edgar hablan.');
});

test('subMacros no falla con texto vacío o undefined', () => {
  assert.equal(subMacros('', 'Luna', 'Edgar'), '');
  assert.equal(subMacros(undefined, 'Luna', 'Edgar'), '');
});

// ---------- initialMessages ----------

test('initialMessages usa first_mes por defecto y resuelve macros', () => {
  const character = { card: makeCard({ first_mes: 'Hola {{user}}, soy {{char}}.' }) };
  const msgs = initialMessages(character, makeSettings());
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'char');
  assert.equal(msgs[0].text, 'Hola Edgar, soy Luna.');
  assert.equal(typeof msgs[0].ts, 'number');
});

test('initialMessages usa un saludo alternativo según el índice', () => {
  const character = {
    card: makeCard({ first_mes: 'Saludo A', alternate_greetings: ['Saludo B {{user}}', 'Saludo C'] })
  };
  assert.equal(initialMessages(character, makeSettings(), 1)[0].text, 'Saludo B Edgar');
  assert.equal(initialMessages(character, makeSettings(), 2)[0].text, 'Saludo C');
});

test('initialMessages devuelve [] si el saludo elegido está vacío', () => {
  const sinSaludo = { card: makeCard({ first_mes: '' }) };
  assert.deepEqual(initialMessages(sinSaludo, makeSettings()), []);

  const altVacio = { card: makeCard({ first_mes: 'Hola', alternate_greetings: [''] }) };
  assert.deepEqual(initialMessages(altVacio, makeSettings(), 1), []);
});

// ---------- scenarioGreeting ----------

test('scenarioGreeting arma una nota entre asteriscos con el escenario, resolviendo macros', () => {
  const character = { card: makeCard({ name: 'Luna' }) };
  const msgs = scenarioGreeting(character, makeSettings(), 'Un bosque nevado espera a {{user}}.');
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].role, 'char');
  assert.equal(msgs[0].text, '*(Un bosque nevado espera a Edgar.)*');
  assert.equal(typeof msgs[0].ts, 'number');
});

test('scenarioGreeting devuelve [] si el escenario está vacío o solo espacios', () => {
  const character = { card: makeCard() };
  assert.deepEqual(scenarioGreeting(character, makeSettings(), ''), []);
  assert.deepEqual(scenarioGreeting(character, makeSettings(), '   '), []);
});

// ---------- buildPlainPrompt ----------

test('buildPlainPrompt arma cabecera, historial, pista final y stop', () => {
  const card = makeCard({
    system_prompt: 'Eres {{char}}.',
    description: 'Una maga curiosa.',
    personality: 'Curiosa',
    scenario: 'Una torre',
    mes_example: '<START>\n{{char}}: hola'
  });
  const messages = [
    { role: 'user', text: 'Hola', ts: 1 },
    { role: 'char', text: 'Hola de vuelta', ts: 2 }
  ];
  const { prompt, stop } = buildPlainPrompt(card, messages, makeSettings());

  assert.ok(prompt.startsWith('Eres Luna.'));
  assert.ok(prompt.includes('[Start of chat]'));
  assert.ok(prompt.includes('Edgar: Hola'));
  assert.ok(prompt.includes('Luna: Hola de vuelta'));
  assert.ok(!prompt.includes('<START>'));
  assert.ok(prompt.endsWith('\nLuna:'));
  assert.deepEqual(stop, ['\nEdgar:', 'Edgar:', '\nLuna:']);
});

test('buildPlainPrompt incluye post_history_instructions entre corchetes, con macros resueltas', () => {
  const card = makeCard({ post_history_instructions: 'Recuerda ser breve, {{user}}.' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings());
  assert.ok(prompt.includes('[Recuerda ser breve, Edgar.]'));
});

// ---------- lorebook automático (docs/CONTRACT-LOREBOOK.md) ----------

test('buildPlainPrompt inyecta el loreBlock en la cabecera cuando se lo pasan', () => {
  const card = makeCard({ scenario: 'Una torre' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), '', 'Known facts (from memory):\n- Se conocieron en un café.');
  assert.ok(prompt.includes('Known facts (from memory):\n- Se conocieron en un café.'));
});

test('buildPlainPrompt no agrega nada si el loreBlock está vacío', () => {
  const card = makeCard();
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), '', '');
  assert.ok(!prompt.includes('Known facts'));
});

test('buildChatMessages inyecta el loreBlock en el mensaje system', () => {
  const card = makeCard();
  const { messages: out } = buildChatMessages(card, [], makeSettings(), '', 'Known facts (from memory):\n- Un hecho.');
  assert.ok(out[0].content.includes('Known facts (from memory):\n- Un hecho.'));
});

test('estimateContextUsage suma el loreBlock al estimar', () => {
  const card = makeCard();
  const settings = makeSettings();
  const sinLore = estimateContextUsage(card, [], settings, '');
  const conLore = estimateContextUsage(card, [], settings, '', 'Known facts (from memory):\n- '.repeat(20));
  assert.ok(conLore.approxTokens > sinLore.approxTokens);
});

// ---------- escenario del chat (adenda multi-chat) ----------

test('buildPlainPrompt suma el escenario del chat debajo del de la card, sin reemplazarlo', () => {
  const card = makeCard({ scenario: 'Una torre de hechicería' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), 'Es de noche y hay una tormenta afuera');
  assert.ok(prompt.includes('Scenario: Una torre de hechicería\nEs de noche y hay una tormenta afuera'));
});

test('buildPlainPrompt omite la segunda línea si el chat no tiene escenario propio', () => {
  const card = makeCard({ scenario: 'Una torre de hechicería' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), '');
  assert.ok(prompt.includes('Scenario: Una torre de hechicería\n\n'));
  assert.ok(!prompt.includes('Scenario: Una torre de hechicería\n \n'));
});

test('buildPlainPrompt muestra el escenario del chat aunque la card no tenga uno propio', () => {
  const card = makeCard({ scenario: '' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), 'Se conocen en un tren nocturno');
  assert.ok(prompt.includes('Scenario: Se conocen en un tren nocturno'));
});

test('buildPlainPrompt resuelve macros dentro del escenario del chat', () => {
  const card = makeCard({ scenario: '' });
  const { prompt } = buildPlainPrompt(card, [], makeSettings(), '{{char}} conoce a {{user}} en un tren');
  assert.ok(prompt.includes('Scenario: Luna conoce a Edgar en un tren'));
});

test('buildChatMessages suma el escenario del chat en el mensaje system', () => {
  const card = makeCard({ scenario: 'Una torre de hechicería' });
  const { messages: out } = buildChatMessages(card, [], makeSettings(), 'Es de noche');
  assert.ok(out[0].content.includes('Scenario: Una torre de hechicería\nEs de noche'));
});

test('buildPlainPrompt recorta el historial y conserva los mensajes más recientes', () => {
  const card = makeCard();
  const messages = [];
  for (let i = 0; i < 200; i++) {
    messages.push({
      role: i % 2 === 0 ? 'user' : 'char',
      text: `Mensaje número ${i} con algo de relleno de texto para ocupar espacio.`,
      ts: i
    });
  }
  const settings = makeSettings({ ctx: 1024, maxLen: 100 });
  const { prompt } = buildPlainPrompt(card, messages, settings);
  assert.ok(prompt.includes('Mensaje número 199'));
  assert.ok(!prompt.includes('Mensaje número 0 '));
});

test('buildPlainPrompt nunca devuelve menos de 1 mensaje aunque el presupuesto sea diminuto', () => {
  const card = makeCard();
  const hugeText = 'X'.repeat(5000);
  const messages = [{ role: 'user', text: hugeText, ts: 1 }];
  const settings = makeSettings({ ctx: 512, maxLen: 400 });
  const { prompt } = buildPlainPrompt(card, messages, settings);
  assert.ok(prompt.includes(hugeText));
});

// ---------- buildChatMessages ----------

test('buildChatMessages antepone un mensaje de relleno si el historial empieza en char', () => {
  const card = makeCard();
  const messages = [{ role: 'char', text: 'Hola', ts: 1 }];
  const { messages: out } = buildChatMessages(card, messages, makeSettings());
  assert.equal(out[0].role, 'system');
  assert.equal(out[1].role, 'user');
  assert.equal(out[1].content, '[Start of roleplay]');
  assert.equal(out[2].role, 'assistant');
  assert.equal(out[2].content, 'Hola');
});

test('buildChatMessages no antepone relleno si el historial ya empieza en user', () => {
  const card = makeCard();
  const messages = [{ role: 'user', text: 'Hola', ts: 1 }];
  const { messages: out } = buildChatMessages(card, messages, makeSettings());
  assert.equal(out.length, 2);
  assert.equal(out[1].role, 'user');
  assert.equal(out[1].content, 'Hola');
});

test('buildChatMessages incluye post_history_instructions en el system y usa stop con salto de línea y usuario', () => {
  const card = makeCard({ post_history_instructions: 'Sé breve, {{user}}.' });
  const { messages: out, stop } = buildChatMessages(card, [], makeSettings());
  assert.ok(out[0].content.includes('Sé breve, Edgar.'));
  // FMT-001: "\n" fuerza un solo párrafo también en /v1/chat/completions.
  assert.deepEqual(stop, ['\n', '\nEdgar:']);
});

test('buildChatMessages recorta el historial y conserva lo más reciente', () => {
  const card = makeCard();
  const messages = [];
  for (let i = 0; i < 200; i++) {
    messages.push({ role: i % 2 === 0 ? 'user' : 'char', text: `Turno ${i} `.repeat(20), ts: i });
  }
  const settings = makeSettings({ ctx: 1024, maxLen: 100 });
  const { messages: out } = buildChatMessages(card, messages, settings);
  const last = out[out.length - 1];
  assert.ok(last.content.includes('Turno 199'));
});

// ---------- estimateContextUsage ----------

test('estimateContextUsage crece con más mensajes y respeta el presupuesto de ctx/maxLen', () => {
  const card = makeCard({ name: 'Luna', description: 'Una descripción breve.' });
  const settings = makeSettings({ ctx: 4096, maxLen: 220 });

  const pocos = [{ role: 'user', text: 'Hola', ts: 1 }];
  const muchos = Array.from({ length: 50 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'char',
    text: 'Un mensaje bastante largo para sumar caracteres al historial. '.repeat(3),
    ts: i,
  }));

  const usoPocos = estimateContextUsage(card, pocos, settings);
  const usoMuchos = estimateContextUsage(card, muchos, settings);

  assert.equal(usoPocos.budgetTokens, 4096 - 220);
  assert.ok(usoPocos.approxTokens > 0);
  assert.ok(usoMuchos.approxTokens > usoPocos.approxTokens);
  assert.ok(usoMuchos.ratio > usoPocos.ratio);
});

test('estimateContextUsage suma el escenario del chat al estimar', () => {
  const card = makeCard();
  const settings = makeSettings();
  const sinEscenario = estimateContextUsage(card, [], settings);
  const conEscenario = estimateContextUsage(card, [], settings, 'Un escenario largo. '.repeat(10));
  assert.ok(conEscenario.approxTokens > sinEscenario.approxTokens);
});

// ---------- cleanReply ----------

test('cleanReply quita el prefijo inicial "Nombre:" y espacios sobrantes', () => {
  assert.equal(cleanReply('Luna:  Hola, ¿cómo estás?  ', 'Luna'), 'Hola, ¿cómo estás?');
  assert.equal(cleanReply('Sin prefijo de nombre', 'Luna'), 'Sin prefijo de nombre');
});

// ---------- trimPartial ----------

test('trimPartial no toca una respuesta que ya termina en puntuación', () => {
  assert.equal(trimPartial('Hola, ¿cómo estás?'), 'Hola, ¿cómo estás?');
  assert.equal(trimPartial('*sonríe*'), '*sonríe*');
});

test('trimPartial elimina la frase incompleta del final', () => {
  assert.equal(trimPartial('Ella sonrió. Luego empezó a cami'), 'Ella sonrió.');
});

test('trimPartial no deja un asterisco de acción abierto huérfano', () => {
  assert.equal(trimPartial('Hola. *se acerca lentamente y toca su hom'), 'Hola.');
});

test('trimPartial no recorta más de 240 caracteres', () => {
  const t = 'Ella dijo algo. ' + 'x'.repeat(250);
  assert.equal(trimPartial(t), t);
});

test('trimPartial no toca el texto si no hay ninguna puntuación de referencia', () => {
  const t = 'x'.repeat(300) + ' sin puntuacion final';
  assert.equal(trimPartial(t), t);
});

// ---------- MEM-004: bloque "por tema" al final del prompt, sin tocar lo guardado ----------

const TOPIC = 'Known facts (from memory):\n- Edgar tiene un perro llamado Bruno.';

function fixture() {
  return {
    card: makeCard({ description: 'Una guardiana de la torre.', personality: 'Curiosa', scenario: 'Una torre junto al mar' }),
    settings: makeSettings({ ctx: 4096, maxLen: 220 }),
    msgs: [
      { role: 'char', text: '*Sonrío.* Hola.', ts: 1 },
      { role: 'user', text: 'Hola Luna, ¿cómo estás?', ts: 2 }
    ]
  };
}

test('MEM-004: sin entradas el prompt es IDÉNTICO al de antes (modo texto simple y modo plantilla)', () => {
  const { card, settings, msgs } = fixture();
  // Valores literales producidos por la versión anterior de prompt.js (antes de MEM-004).
  const plain = {
    prompt: "Roleplay chat between Luna and Edgar. Stay in character as Luna. Write only Luna's next reply, using *asterisks* for actions and plain text for speech.\n\nLuna's description:\nUna guardiana de la torre.\n\nLuna's personality: Curiosa\n\nScenario: Una torre junto al mar\n\n[Start of chat]\nLuna: *Sonrío.* Hola.\nEdgar: Hola Luna, ¿cómo estás?\nLuna:",
    stop: ['\nEdgar:', 'Edgar:', '\nLuna:']
  };
  assert.deepEqual(buildPlainPrompt(card, msgs, settings), plain);
  assert.deepEqual(buildPlainPrompt(card, msgs, settings, '', '', ''), plain);

  const chat = {
    messages: [
      { role: 'system', content: "Roleplay chat between Luna and Edgar. Stay in character as Luna. Write only Luna's next reply, using *asterisks* for actions and plain text for speech.\n\nLuna's description:\nUna guardiana de la torre.\n\nLuna's personality: Curiosa\n\nScenario: Una torre junto al mar" },
      { role: 'user', content: '[Start of roleplay]' },
      { role: 'assistant', content: '*Sonrío.* Hola.' },
      { role: 'user', content: 'Hola Luna, ¿cómo estás?' }
    ],
    stop: ['\n', '\nEdgar:']
  };
  assert.deepEqual(buildChatMessages(card, msgs, settings), chat);
  assert.deepEqual(buildChatMessages(card, msgs, settings, '', '', ''), chat);
});

test('MEM-004 (texto simple): el bloque por tema va justo ANTES de la última línea del usuario, no en la cabecera', () => {
  const { card, settings, msgs } = fixture();
  const { prompt } = buildPlainPrompt(card, msgs, settings, '', '', TOPIC);
  assert.ok(prompt.includes(TOPIC));
  const head = prompt.slice(0, prompt.indexOf('[Start of chat]'));
  assert.ok(!head.includes('Bruno'), 'la cabecera no debe cambiar con el bloque por tema');
  assert.ok(prompt.indexOf(TOPIC) < prompt.indexOf('Edgar: Hola Luna'));
  assert.ok(prompt.indexOf(TOPIC) > prompt.indexOf('Luna: *Sonrío.* Hola.'));
  assert.ok(prompt.endsWith('Edgar: Hola Luna, ¿cómo estás?\nLuna:'));
  // La cabecera es idéntica a la de un prompt sin bloque.
  const plain = buildPlainPrompt(card, msgs, settings).prompt;
  assert.equal(head, plain.slice(0, plain.indexOf('[Start of chat]')));
});

test('MEM-004 (plantilla): el bloque por tema va al principio del ÚLTIMO mensaje del usuario, no en system', () => {
  const { card, settings, msgs } = fixture();
  const base = buildChatMessages(card, msgs, settings);
  const { messages: out, stop } = buildChatMessages(card, msgs, settings, '', '', TOPIC);
  assert.equal(out.length, base.messages.length);           // no se añaden mensajes (nada de `system` intercalado)
  assert.deepEqual(out[0], base.messages[0]);               // el system (cabecera) no cambia
  assert.deepEqual(out.slice(1, -1), base.messages.slice(1, -1));
  const last = out[out.length - 1];
  assert.equal(last.role, 'user');
  assert.ok(last.content.includes(TOPIC));
  assert.ok(last.content.endsWith('Hola Luna, ¿cómo estás?'));
  assert.deepEqual(stop, base.stop);
});

test('MEM-004: el bloque por tema nunca modifica los mensajes guardados', () => {
  const { card, settings, msgs } = fixture();
  const before = JSON.parse(JSON.stringify(msgs));
  buildPlainPrompt(card, msgs, settings, '', 'Always keep in mind:\n- x', TOPIC);
  buildChatMessages(card, msgs, settings, '', 'Always keep in mind:\n- x', TOPIC);
  assert.deepEqual(msgs, before);
});

test('MEM-004: "siempre presentes" (5.º parámetro) sigue en la cabecera y el bloque por tema va aparte', () => {
  const { card, settings, msgs } = fixture();
  const always = 'Always keep in mind:\n- Edgar prefiere las mañanas tranquilas.';
  const plain = buildPlainPrompt(card, msgs, settings, '', always, TOPIC).prompt;
  assert.ok(plain.indexOf(always) < plain.indexOf('[Start of chat]'));
  assert.ok(plain.indexOf(TOPIC) > plain.indexOf('[Start of chat]'));
  const chat = buildChatMessages(card, msgs, settings, '', always, TOPIC).messages;
  assert.ok(chat[0].content.includes(always));
  assert.ok(!chat[0].content.includes(TOPIC));
});

test('MEM-004: el presupuesto del historial descuenta el bloque por tema', () => {
  const { card } = fixture();
  const settings = makeSettings({ ctx: 1024, maxLen: 200 });
  const msgs = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `mensaje número ${i} `.repeat(6), ts: i }));
  const without = buildChatMessages(card, msgs, settings).messages.length;
  const withTopic = buildChatMessages(card, msgs, settings, '', '', TOPIC.repeat(6)).messages.length;
  assert.ok(withTopic <= without);
});

test('MEM-004: estimateContextUsage reserva el espacio del bloque por tema', () => {
  const { card, settings, msgs } = fixture();
  const base = estimateContextUsage(card, msgs, settings);
  const reserved = estimateContextUsage(card, msgs, settings, '', '', 660);
  assert.ok(Math.abs(reserved.approxTokens - base.approxTokens - 200) <= 1); // 660 caracteres ≈ 200 tokens (3,3 car./token)
  assert.equal(estimateContextUsage(card, msgs, settings, '', '', 0).approxTokens, base.approxTokens);
});

// ---------- FMT-002: la respuesta arranca dentro de una acción (prefill) ----------

test('FMT-002 (texto simple): con prefill el prompt termina en "Nombre: *"; sin él, queda igual que antes', () => {
  const msgs = [{ role: 'user', text: 'Hola', ts: 1 }];
  const base = buildPlainPrompt(makeCard(), msgs, makeSettings());
  const withPrefill = buildPlainPrompt(makeCard(), msgs, makeSettings(), '', '', '', '', true);
  assert.ok(base.prompt.endsWith('\nLuna:'));
  assert.equal(withPrefill.prompt, base.prompt + ' ' + FORMAT_PREFILL);
  assert.deepEqual(withPrefill.stop, base.stop);
});

test('FMT-002 (plantilla): con prefill se añade al final un mensaje assistant con "*"; sin él, igual que antes', () => {
  const msgs = [{ role: 'user', text: 'Hola', ts: 1 }];
  const base = buildChatMessages(makeCard(), msgs, makeSettings());
  const withPrefill = buildChatMessages(makeCard(), msgs, makeSettings(), '', '', '', '', true);
  assert.deepEqual(withPrefill.messages.slice(0, -1), base.messages);
  assert.deepEqual(withPrefill.messages.at(-1), { role: 'assistant', content: '*' });
  assert.deepEqual(withPrefill.stop, base.stop);
});

test('FMT-002: el prefill no modifica los mensajes guardados', () => {
  const msgs = [{ role: 'user', text: 'Hola', ts: 1 }, { role: 'char', text: '*Hi.* Hello', ts: 2 }, { role: 'user', text: 'Ok', ts: 3 }];
  const before = JSON.stringify(msgs);
  buildChatMessages(makeCard(), msgs, makeSettings(), '', '', 'topic', '', true);
  buildPlainPrompt(makeCard(), msgs, makeSettings(), '', '', 'topic', '', true);
  assert.equal(JSON.stringify(msgs), before);
});

// ---------- MEM-007: resumen de continuidad al final del prompt; historyStartIndex ----------

const CONT = 'Sam told Mia about the bakery job on Elm Street. Later they talked about his sister Laura.';

test('MEM-007: sin resumen el prompt es IDÉNTICO al de antes (extras ausentes, vacíos o con texto en blanco)', () => {
  const { card, settings, msgs } = fixture();
  const plain = buildPlainPrompt(card, msgs, settings);
  const chat = buildChatMessages(card, msgs, settings);
  for (const extras of [undefined, {}, { continuity: '' }, { continuity: '   ' }, { continuity: null }]) {
    assert.deepEqual(buildPlainPrompt(card, msgs, settings, '', '', '', '', false, extras), plain);
    assert.deepEqual(buildChatMessages(card, msgs, settings, '', '', '', '', false, extras), chat);
  }
  assert.equal(formatContinuityBlock(''), '');
  assert.equal(formatContinuityBlock('  \n '), '');
  assert.equal(continuityBlockChars(''), 0);
});

test('MEM-007 (plantilla): el resumen va al principio del ÚLTIMO mensaje del usuario, antes del bloque por tema, y no en system', () => {
  const { card, settings, msgs } = fixture();
  const base = buildChatMessages(card, msgs, settings, '', '', TOPIC);
  const { messages: out, stop } = buildChatMessages(card, msgs, settings, '', '', TOPIC, '', false, { continuity: CONT });
  assert.equal(out.length, base.messages.length);
  assert.deepEqual(out[0], base.messages[0]);               // la cabecera no cambia: no invalida la caché del servidor
  assert.deepEqual(out.slice(1, -1), base.messages.slice(1, -1));
  const last = out[out.length - 1].content;
  assert.ok(last.startsWith(`[Earlier in this conversation: ${CONT}]`));
  assert.ok(last.indexOf('Earlier in this conversation') < last.indexOf('Known facts'));
  assert.ok(last.endsWith('Hola Luna, ¿cómo estás?'));
  assert.deepEqual(stop, base.stop);
});

test('MEM-007 (texto simple): el resumen va justo antes de la última línea del usuario, antes del bloque por tema', () => {
  const { card, settings, msgs } = fixture();
  const { prompt } = buildPlainPrompt(card, msgs, settings, '', '', TOPIC, '', false, { continuity: CONT });
  const head = prompt.slice(0, prompt.indexOf('[Start of chat]'));
  assert.equal(head, buildPlainPrompt(card, msgs, settings).prompt.split('[Start of chat]')[0]);
  assert.ok(prompt.indexOf('[Earlier in this conversation:') < prompt.indexOf('Known facts'));
  assert.ok(prompt.indexOf('Known facts') < prompt.indexOf('Edgar: Hola Luna'));
  assert.ok(prompt.endsWith('Edgar: Hola Luna, ¿cómo estás?\nLuna:'));
});

test('MEM-007: el resumen nunca modifica los mensajes guardados', () => {
  const { card, settings, msgs } = fixture();
  const before = JSON.parse(JSON.stringify(msgs));
  buildPlainPrompt(card, msgs, settings, '', '', '', '', false, { continuity: CONT });
  buildChatMessages(card, msgs, settings, '', '', '', '', false, { continuity: CONT });
  assert.deepEqual(msgs, before);
});

test('MEM-007: el presupuesto del historial descuenta el resumen, y estimateContextUsage lo suma', () => {
  const { card } = fixture();
  const settings = makeSettings({ ctx: 1024, maxLen: 200, mode: 'chat' });
  const msgs = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `mensaje número ${i} `.repeat(6), ts: i }));
  const without = buildChatMessages(card, msgs, settings).messages.length;
  const withCont = buildChatMessages(card, msgs, settings, '', '', '', '', false, { continuity: CONT.repeat(5) }).messages.length;
  assert.ok(withCont < without);
  const base = estimateContextUsage(card, msgs, settings);
  const est = estimateContextUsage(card, msgs, settings, '', '', 0, { continuity: CONT });
  assert.ok(Math.abs(est.approxTokens - base.approxTokens - Math.ceil(continuityBlockChars(CONT) / 3.3)) <= 1);
});

test('MEM-007: historyStartIndex coincide con lo que recorta el armador real (ambos modos, con y sin bloques finales)', () => {
  let seed = 7;
  const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  let trimmedCases = 0;
  for (let n = 0; n < 300; n++) {
    const card = makeCard({ description: 'x '.repeat(Math.floor(rnd() * 80)), post_history_instructions: rnd() < 0.3 ? 'nota' : '' });
    const mode = rnd() < 0.5 ? 'chat' : 'plain';
    const settings = makeSettings({ ctx: [512, 1024, 2048, 4096][Math.floor(rnd() * 4)], maxLen: 200, mode });
    // Cada mensaje lleva una marca única «#i#» para saber con certeza cuáles entraron en el prompt.
    const msgs = Array.from({ length: 1 + Math.floor(rnd() * 70) }, (_, i) => ({ role: rnd() < 0.5 ? 'user' : 'char', text: `#${i}# ` + 'palabra '.repeat(1 + Math.floor(rnd() * 40)), ts: i }));
    const continuity = rnd() < 0.5 ? CONT : '';
    const topic = !continuity && rnd() < 0.5 ? TOPIC : '';
    const endChars = continuity ? continuityBlockChars(continuity) : topic ? topic.length + 2 : 0;
    const sent = mode === 'chat'
      ? buildChatMessages(card, msgs, settings, '', '', topic, '', false, { continuity }).messages.map((m) => m.content).join('\n')
      : buildPlainPrompt(card, msgs, settings, '', '', topic, '', false, { continuity }).prompt;
    const idx = historyStartIndex(card, msgs, settings, '', '', endChars, 0);
    assert.ok(idx >= 0 && idx <= msgs.length - 1, `caso ${n}: índice fuera de rango`);
    assert.ok(sent.includes(`#${idx}# `), `caso ${n} (${mode}): el mensaje ${idx} debería estar en el prompt`);
    if (idx > 0) {
      assert.ok(!sent.includes(`#${idx - 1}# `), `caso ${n} (${mode}): el mensaje ${idx - 1} no debería estar en el prompt`);
      trimmedCases++;
    }
  }
  assert.ok(trimmedCases > 50, 'el test debe ejercitar el recorte en bastantes casos');
});

test('MEM-007: historyStartIndex — con reserva extra el primer mensaje visible nunca retrocede, y todo cabe si el chat es corto', () => {
  const { card } = fixture();
  const settings = makeSettings({ ctx: 1024, maxLen: 200, mode: 'chat' });
  const msgs = Array.from({ length: 60 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `mensaje número ${i} `.repeat(4), ts: i }));
  const a = historyStartIndex(card, msgs, settings);
  const b = historyStartIndex(card, msgs, settings, '', '', 0, 400);
  const c = historyStartIndex(card, msgs, settings, '', '', 0, 1600);
  assert.ok(a > 0 && b >= a && c >= b);
  assert.equal(historyStartIndex(card, msgs.slice(0, 3), makeSettings({ ctx: 4096, mode: 'chat' })), 0);
  assert.equal(historyStartIndex(card, [], settings), 0);
});

test('MEM-007: la ventana del historial NO se mueve cuando el resumen cambia de largo (reserva fija), en ambos modos', () => {
  const { card } = fixture();
  const msgs = Array.from({ length: 80 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `#${i}# ` + 'palabra '.repeat(20), ts: i }));
  for (const mode of ['chat', 'plain']) {
    const settings = makeSettings({ ctx: 2048, maxLen: 200, mode });
    const start = (continuity) => historyStartIndex(card, msgs, settings, '', '', continuityBlockChars(continuity));
    const sizes = [60, 200, 400, 640, 800].map((n) => start('Sam told Mia. '.repeat(Math.ceil(n / 14)).slice(0, n)));
    assert.equal(new Set(sizes).size, 1, `${mode}: el primer mensaje visible debe ser el mismo con cualquier largo (${sizes})`);
    // Lo mismo con el armador real: los mensajes enviados son los mismos con un resumen corto o largo.
    const sent = (text) => {
      const out = mode === 'chat'
        ? buildChatMessages(card, msgs, settings, '', '', '', '', false, { continuity: text }).messages.map((m) => m.content).join('\n')
        : buildPlainPrompt(card, msgs, settings, '', '', '', '', false, { continuity: text }).prompt;
      return msgs.filter((m) => out.includes(m.text.slice(0, 6))).length;
    };
    assert.equal(sent('Corto resumen de prueba para el chat.'), sent('Sam told Mia. '.repeat(50).slice(0, 790)));
    // Sin resumen la ventana puede abarcar más (o igual) que con resumen: aparecer nunca "recupera" mensajes por el frente.
    assert.ok(historyStartIndex(card, msgs, settings) <= start('Un resumen.'));
  }
  assert.equal(continuityBlockChars(''), 0);
  assert.equal(continuityBlockChars('x'), CONTINUITY_RESERVE_CHARS);
  assert.ok(continuityBlockChars('y'.repeat(2000)) > CONTINUITY_RESERVE_CHARS);   // un texto más largo que la reserva ocupa lo que ocupa
});

// ---------- LAT-001 (a): frente estable en modo plantilla ----------

function longChat(n, len = 200) {
  return Array.from({ length: n }, (_, i) => ({ role: i % 2 === 0 ? 'char' : 'user', text: `m${i} ` + 'x'.repeat(len), ts: i }));
}

test('LAT-001: con el historial recortado, el primer mensaje enviado es SIEMPRE del usuario (nunca el de relleno)', () => {
  const card = makeCard();
  const settings = makeSettings({ ctx: 1200, maxLen: 100 });
  const all = longChat(120);
  const seenFronts = new Set();
  for (let n = 40; n <= 120; n++) {
    const { messages: out } = buildChatMessages(card, all.slice(0, n), settings);
    assert.ok(out.length < n, 'el caso de prueba debe recortar');
    assert.equal(out[1].role, 'user', `n=${n}`);
    assert.notEqual(out[1].content, '[Start of roleplay]', `n=${n}`);
    seenFronts.add(out[1].content.split(' ')[0]);
  }
  assert.ok(seenFronts.size > 1, 'la ventana se desliza');
});

test('LAT-001: dos turnos con distinto largo de mensaje no hacen aparecer/desaparecer el relleno al frente', () => {
  const card = makeCard();
  const settings = makeSettings({ ctx: 1200, maxLen: 100 });
  const base = longChat(80);
  const longer = base.map((m, i) => (i === 79 ? { ...m, text: m.text + ' y'.repeat(150) } : m));
  const a = buildChatMessages(card, base, settings).messages;
  const b = buildChatMessages(card, longer, settings).messages;
  assert.equal(a[1].role, 'user');
  assert.equal(b[1].role, 'user');
  assert.ok(![a[1], b[1]].some((m) => m.content === '[Start of roleplay]'));
});

test('LAT-001: el relleno sigue apareciendo al INICIO real del chat (todo cabe y empieza en el personaje)', () => {
  const card = makeCard();
  const msgs = longChat(6, 20);
  const { messages: out } = buildChatMessages(card, msgs, makeSettings());
  assert.equal(out[1].content, '[Start of roleplay]');
  assert.equal(out.length, 1 + 1 + 6);
});

test('LAT-001: chat que cabe entero queda IDÉNTICO al de antes (el frente estable no toca lo que no se recortó)', () => {
  const card = makeCard();
  const settings = makeSettings();
  const msgs = [
    { role: 'char', text: '*Sonrío.* Hola.', ts: 1 },
    { role: 'user', text: 'Hola', ts: 2 },
    { role: 'char', text: 'Qué bueno verte.', ts: 3 },
  ];
  const { messages: out } = buildChatMessages(card, msgs, settings);
  assert.deepEqual(out.slice(1).map((m) => [m.role, m.content]), [
    ['user', '[Start of roleplay]'],
    ['assistant', '*Sonrío.* Hola.'],
    ['user', 'Hola'],
    ['assistant', 'Qué bueno verte.'],
  ]);
});

test('LAT-001: sin ningún mensaje del usuario en la ventana no se descarta nada (queda al menos 1 mensaje)', () => {
  const card = makeCard();
  const settings = makeSettings({ ctx: 512, maxLen: 400 });
  const msgs = [{ role: 'user', text: 'hola', ts: 1 }, { role: 'char', text: 'X'.repeat(5000), ts: 2 }];
  const { messages: out } = buildChatMessages(card, msgs, settings);
  assert.equal(out.length, 3);
  assert.equal(out[1].content, '[Start of roleplay]');
  assert.equal(out[2].role, 'assistant');
});

test('LAT-001: historyStartIndex sigue coincidiendo con lo que envía el armador real (modo plantilla, con recorte)', () => {
  const card = makeCard();
  const settings = makeSettings({ ctx: 1200, maxLen: 100, mode: 'chat' });
  const all = longChat(100);
  for (let n = 40; n <= 100; n++) {
    const msgs = all.slice(0, n);
    const { messages: out } = buildChatMessages(card, msgs, settings);
    assert.equal(historyStartIndex(card, msgs, settings), n - (out.length - 1), `n=${n}`);
  }
});

test('LAT-001: modo texto simple no cambia (no usa mensaje de relleno)', () => {
  const card = makeCard();
  const settings = makeSettings({ ctx: 1200, maxLen: 100 });
  const all = longChat(80);
  const { prompt } = buildPlainPrompt(card, all, settings);
  const firstLine = prompt.split('\n[Start of chat]\n')[1].split('\n')[0];
  assert.ok(firstLine.startsWith('Luna: ') || firstLine.startsWith('Edgar: '));
});
