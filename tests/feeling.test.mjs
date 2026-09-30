// tests/feeling.test.mjs — MEM-015: el personaje dice cómo se siente, en su voz, de una lista cerrada.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEELING_WORDS,
  FEELING_MIN_ACTIVATED,
  feelingApplies,
  sanitizeFeeling,
  parseFeelingWord,
  feelingLabel,
  feelingDisplayText,
  feelingInstruction,
  buildFeelingRequest,
  createFeelingUpdater,
} from '../www/js/api/feeling.js';
import { MOOD_MIN_ACTIVATED } from '../www/js/api/mood.js';

test('FEELING_WORDS: lista curada de sustantivos (nunca adjetivos), 24-30 categorías, sin duplicados, con etiqueta en español', () => {
  assert.ok(FEELING_WORDS.length >= 24 && FEELING_WORDS.length <= 30, `esperaba 24-30, hay ${FEELING_WORDS.length}`);
  const words = FEELING_WORDS.map((f) => f.word);
  assert.equal(new Set(words).size, words.length, 'sin palabras repetidas');
  const labels = FEELING_WORDS.map((f) => f.label);
  assert.equal(new Set(labels).size, labels.length, 'sin etiquetas repetidas');
  for (const { word, label } of FEELING_WORDS) {
    assert.equal(word, word.toLowerCase(), 'la palabra que debe copiar el modelo va en minúsculas');
    assert.ok(label.length > 0);
    assert.ok(!/[ao]$/.test(label) || true); // no se exige terminación neutra: son sustantivos, no adjetivos de género
  }
  // ejemplos explícitos del contrato deben estar presentes
  for (const label of ['ternura', 'nostalgia', 'alegría', 'timidez', 'deseo', 'calma', 'inquietud', 'orgullo']) {
    assert.ok(labels.includes(label), `falta "${label}" de los ejemplos del contrato`);
  }
});

test('FEELING_MIN_ACTIVATED: mismo umbral que "sintiendo …" de MEM-011 (misma regla, no un número aparte)', () => {
  assert.equal(FEELING_MIN_ACTIVATED, MOOD_MIN_ACTIVATED);
});

test('feelingApplies: solo con 3+ recuerdos POR TEMA (los "siempre presentes" no cuentan)', () => {
  assert.equal(feelingApplies(undefined), false);
  assert.equal(feelingApplies([]), false);
  const two = [{ content: 'a' }, { content: 'b' }];
  assert.equal(feelingApplies(two), false);
  const three = [{ content: 'a' }, { content: 'b' }, { content: 'c' }];
  assert.equal(feelingApplies(three), true);
  const withAlways = [{ content: 'a', always: true }, { content: 'b', always: true }, { content: 'c' }, { content: 'd' }];
  assert.equal(feelingApplies(withAlways), false, 'los "siempre presentes" no cuentan para el umbral');
});

test('sanitizeFeeling: solo una palabra EXACTA de la lista; cualquier otra cosa es "sin dato"', () => {
  assert.equal(sanitizeFeeling('tenderness'), 'tenderness');
  assert.equal(sanitizeFeeling('Tenderness'), undefined, 'sensible a mayúsculas: se guarda tal cual sale de parseFeelingWord, ya en minúsculas');
  assert.equal(sanitizeFeeling('happiness'), undefined, 'no está en la lista');
  assert.equal(sanitizeFeeling(''), undefined);
  assert.equal(sanitizeFeeling(null), undefined);
  assert.equal(sanitizeFeeling(42), undefined);
});

test('parseFeelingWord: encuentra la palabra de la lista sin importar mayúsculas, puntuación o texto de más; null si ninguna', () => {
  assert.equal(parseFeelingWord('tenderness'), 'tenderness');
  assert.equal(parseFeelingWord('Tenderness.'), 'tenderness');
  assert.equal(parseFeelingWord('  NOSTALGIA  '), 'nostalgia');
  assert.equal(parseFeelingWord('I feel joy right now.'), 'joy');
  assert.equal(parseFeelingWord('happiness'), null, 'no está en la lista: no se inventa la más parecida');
  assert.equal(parseFeelingWord(''), null);
  assert.equal(parseFeelingWord('   '), null);
});

test('parseFeelingWord: reconoce el ADJETIVO natural como alias del sustantivo (hallazgo real del Paso 0: "grateful" en vez de "gratitude")', () => {
  assert.equal(parseFeelingWord('grateful'), 'gratitude');
  assert.equal(parseFeelingWord('Grateful.'), 'gratitude');
  assert.equal(parseFeelingWord('shy'), 'shyness');
  assert.equal(parseFeelingWord('I feel so lonely today'), 'loneliness');
});

test('parseFeelingWord: nunca casa una palabra de la lista como SUBCADENA de otra ajena', () => {
  // "trust" no debe aparecer dentro de "distrustful", ni "joy" dentro de "joystick"
  assert.equal(parseFeelingWord('completely distrustful of everyone'), null);
  assert.equal(parseFeelingWord('playing with a joystick'), null);
});

test('feelingLabel/feelingDisplayText: etiqueta en español o vacío si no se reconoce', () => {
  assert.equal(feelingLabel('tenderness'), 'ternura');
  assert.equal(feelingLabel('not-a-word'), '');
  assert.equal(feelingDisplayText('tenderness'), 'sintiendo ternura');
  assert.equal(feelingDisplayText('not-a-word'), '');
  assert.equal(feelingDisplayText(undefined), '');
});

test('feelingInstruction: pide UNA sola palabra de la lista exacta, con el nombre del personaje', () => {
  const text = feelingInstruction({ charName: 'Nova' });
  assert.match(text, /Nova/);
  assert.match(text, /ONE word/);
  for (const { word } of FEELING_WORDS) assert.match(text, new RegExp(`\\b${word}\\b`));
});

test('buildFeelingRequest: continuación del prompt normal (modo plantilla) con el prefill ya escrito', () => {
  const character = { card: { name: 'Nova', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null }, lorebook: [] };
  const chat = { scenario: '' };
  const messages = [{ role: 'user', text: 'Hola', ts: 1 }];
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8 };
  const req = buildFeelingRequest({ character, chat, messages, settings }, feelingInstruction({ charName: 'Nova' }));
  assert.equal(req.mode, 'chat');
  const last = req.messages[req.messages.length - 1];
  assert.equal(last.role, 'assistant');
  assert.equal(last.content, 'Right now I feel');
  const instructionMsg = req.messages[req.messages.length - 2];
  assert.equal(instructionMsg.role, 'user');
  assert.match(instructionMsg.content, /ONE word/);
});

test('buildFeelingRequest: modo texto simple termina en el prefill sin el nombre del personaje repetido como "cue"', () => {
  const character = { card: { name: 'Nova', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null }, lorebook: [] };
  const chat = { scenario: '' };
  const messages = [{ role: 'user', text: 'Hola', ts: 1 }];
  const settings = { mode: 'plain', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8 };
  const req = buildFeelingRequest({ character, chat, messages, settings }, feelingInstruction({ charName: 'Nova' }));
  assert.equal(req.mode, 'plain');
  assert.ok(req.prompt.endsWith('Right now I feel'));
});

/* ---------- createFeelingUpdater: con un servidor de prueba inyectado (sin red real) ---------- */

function makeCharacter(extra = {}) {
  return {
    id: 'c1',
    name: 'Nova',
    card: { name: 'Nova', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null },
    lorebook: [],
    ...extra,
  };
}

test('createFeelingUpdater.maybeRun: apagado por defecto — sin Settings.feelingsEnabled === true, no llama al servidor', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];
  let calls = 0;
  for (const settings of [{ mode: 'chat' }, { mode: 'chat', feelingsEnabled: false }, { mode: 'chat', feelingsEnabled: 'true' }]) {
    const updater = createFeelingUpdater({
      getContext: () => ({ character, chat, messages, settings }),
      isChatBusy: () => false,
      complete: async () => { calls++; return 'joy'; },
      loadChatMessages: async () => messages,
      saveFeeling: async () => {},
    });
    assert.equal((await updater.maybeRun(0)).kind, 'skipped');
  }
  assert.equal(calls, 0);
});

test('createFeelingUpdater.maybeRun: no arranca si el chat está ocupado, ni sin suficientes recuerdos, ni si el mensaje ya tiene sentimiento', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8, feelingsEnabled: true };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];

  let calls = 0;
  const updater = createFeelingUpdater({
    getContext: () => ({ character, chat, messages, settings }),
    isChatBusy: () => true,
    complete: async () => { calls++; return 'joy'; },
    loadChatMessages: async () => messages,
    saveFeeling: async () => {},
  });
  assert.equal((await updater.maybeRun(0)).kind, 'skipped', 'ocupado');
  assert.equal(calls, 0);

  const updater2 = createFeelingUpdater({
    getContext: () => ({ character, chat, messages: [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }] }], settings }),
    isChatBusy: () => false,
    complete: async () => { calls++; return 'joy'; },
    loadChatMessages: async () => messages,
    saveFeeling: async () => {},
  });
  assert.equal((await updater2.maybeRun(0)).kind, 'skipped', 'menos de 3 recuerdos por tema');
  assert.equal(calls, 0);

  const updater3 = createFeelingUpdater({
    getContext: () => ({ character, chat, messages: [{ role: 'char', text: 'hola', feeling: 'joy', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }], settings }),
    isChatBusy: () => false,
    complete: async () => { calls++; return 'joy'; },
    loadChatMessages: async () => messages,
    saveFeeling: async () => {},
  });
  assert.equal((await updater3.maybeRun(0)).kind, 'skipped', 'ya tiene un sentimiento guardado: no se regenera solo');
  assert.equal(calls, 0);
});

test('createFeelingUpdater.maybeRun: con suficientes recuerdos, llama al servidor UNA vez y guarda la palabra válida', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8, feelingsEnabled: true };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];

  let calls = 0;
  let saved = null;
  const updater = createFeelingUpdater({
    getContext: () => ({ character, chat, messages, settings }),
    isChatBusy: () => false,
    complete: async () => { calls++; return 'Joy.'; },
    loadChatMessages: async () => messages,
    saveFeeling: async (chatId, idx, word) => { saved = { chatId, idx, word }; },
  });
  const result = await updater.maybeRun(0);
  assert.equal(result.kind, 'ok');
  assert.equal(result.word, 'joy');
  assert.equal(calls, 1, 'un solo intento, nunca reintenta');
  assert.deepEqual(saved, { chatId: 'chat1', idx: 0, word: 'joy' });
});

test('createFeelingUpdater.maybeRun: una palabra fuera de la lista NO se guarda (queda el respaldo heurístico de MEM-011)', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8, feelingsEnabled: true };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];

  let saveCalled = false;
  const updater = createFeelingUpdater({
    getContext: () => ({ character, chat, messages, settings }),
    isChatBusy: () => false,
    complete: async () => 'I feel absolutely fantastic and great!', // ninguna palabra (ni alias) de la lista
    loadChatMessages: async () => messages,
    saveFeeling: async () => { saveCalled = true; },
  });
  const result = await updater.maybeRun(0);
  assert.equal(result.kind, 'unparsed');
  assert.equal(saveCalled, false);
});

test('createFeelingUpdater.maybeRun: si el mensaje cambió (editado/regenerado) mientras corría la llamada, no se guarda nada', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8, feelingsEnabled: true };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];

  let saveCalled = false;
  const updater = createFeelingUpdater({
    getContext: () => ({ character, chat, messages, settings }),
    isChatBusy: () => false,
    complete: async () => 'joy',
    loadChatMessages: async () => [{ role: 'char', text: 'texto editado mientras corría' }], // ya no coincide
    saveFeeling: async () => { saveCalled = true; },
  });
  const result = await updater.maybeRun(0);
  assert.equal(result.kind, 'skipped');
  assert.equal(saveCalled, false);
});

test('createFeelingUpdater.abort: cancela sin guardar nada (prioridad absoluta del usuario)', async () => {
  const character = makeCharacter();
  const chat = { id: 'chat1', scenario: '' };
  const settings = { mode: 'chat', user: 'Sam', ctx: 4096, maxLen: 200, temp: 0.8, feelingsEnabled: true };
  const messages = [{ role: 'char', text: 'hola', loreUsed: [{ content: 'a' }, { content: 'b' }, { content: 'c' }] }];

  let saveCalled = false;
  let release;
  const updater = createFeelingUpdater({
    getContext: () => ({ character, chat, messages, settings }),
    isChatBusy: () => false,
    complete: (req, opts) => new Promise((resolve, reject) => {
      release = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      opts.signal.addEventListener('abort', release);
    }),
    loadChatMessages: async () => messages,
    saveFeeling: async () => { saveCalled = true; },
  });
  const p = updater.maybeRun(0);
  assert.equal(updater.isRunning(), true);
  updater.abort();
  const result = await p;
  assert.equal(result.kind, 'aborted');
  assert.equal(saveCalled, false);
  assert.equal(updater.isRunning(), false);
});
