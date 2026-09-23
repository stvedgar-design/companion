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
  trimPartial
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

test('buildChatMessages incluye post_history_instructions en el system y usa stop solo con el usuario', () => {
  const card = makeCard({ post_history_instructions: 'Sé breve, {{user}}.' });
  const { messages: out, stop } = buildChatMessages(card, [], makeSettings());
  assert.ok(out[0].content.includes('Sé breve, Edgar.'));
  assert.deepEqual(stop, ['\nEdgar:']);
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
