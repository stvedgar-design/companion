import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  VARIETY_NOTE,
  VARIETY_RECENT_TURNS,
  VARIETY_MIN_HITS,
  contentStems,
  themeWords,
  detectRepetition,
  varietyNeeded
} from '../www/js/api/variety.js';
import { buildPlainPrompt, buildChatMessages } from '../www/js/api/prompt.js';

const NAMES = ['Tessa', 'Sam'];

// Personaje SINTÉTICO con un eje temático marcado (jardinería).
const GARDEN = [
  '*I water the seedlings.* I love watching things grow, Sam. Every root is a little miracle.',
  '*I smile and touch a leaf.* Growing plants teaches me patience, you know. Want to plant a seed together?',
  '*I brush the soil off my hands.* Watching a seed grow into a flower never gets old, Sam.'
];

test('contentStems: raíces de 4+ letras, sin stopwords ni nombres; junta las formas de una palabra', () => {
  const s = contentStems('Tessa is exploring; Sam explored it and explores more', NAMES);
  assert.ok(s.has('explor'));
  assert.equal(s.size, 1);
  assert.equal(contentStems('yes and the', NAMES).size, 0);
});

test('themeWords: solo palabras que se repiten en 2 de los últimos 3 turnos; con menos de 3 turnos, ninguna', () => {
  assert.equal(VARIETY_RECENT_TURNS, 3);
  assert.deepEqual(themeWords(GARDEN.slice(0, 2), NAMES), []);
  const theme = themeWords(GARDEN, NAMES);
  assert.ok(theme.includes('grow') || theme.some((w) => w.startsWith('grow')));
  assert.ok(theme.some((w) => w.startsWith('seed')));
  assert.ok(!theme.includes('tessa') && !theme.includes('sam'));
});

test('detectRepetition: marca una respuesta que reutiliza el mismo eje temático', () => {
  const r = detectRepetition(GARDEN, '*I hold up a seed.* Watching it grow makes me so happy, Sam.', NAMES);
  assert.equal(r.repetitive, true);
  assert.ok(r.hits.length >= VARIETY_MIN_HITS);
});

test('detectRepetition: una respuesta sobre otro tema NO es repetitiva, aunque el personaje sea marcado', () => {
  const r = detectRepetition(GARDEN, '*I laugh.* Pizza sounds perfect, honestly. Pineapple or not, I do not judge.', NAMES);
  assert.equal(r.repetitive, false);
});

test('detectRepetition: un rasgo legítimamente constante (una sola palabra suelta) no cuenta como repetición', () => {
  const prev = [
    '*I tilt my head.* I am curious about that, what happened at the office today?',
    '*I nod.* Pasta is great with garlic, and I am always curious how you cook it.',
    '*I shrug.* Football is confusing to me, but tell me the score.'
  ];
  const r = detectRepetition(prev, '*I lean closer.* I am curious, how was the drive to the coast?', NAMES);
  assert.equal(r.repetitive, false);
});

test('detectRepetition: sirve igual con otro personaje (nada hardcodeado)', () => {
  const cook = [
    '*I stir the pot.* The sauce needs to simmer longer, Sam, patience makes flavor.',
    '*I taste the broth.* Simmer it slowly and the sauce gets deeper, trust the flavor.',
    '*I chop garlic.* A good sauce always needs time to simmer, Sam.'
  ];
  assert.equal(detectRepetition(cook, '*I smile.* Let it simmer, the sauce will get its flavor.', ['Rico', 'Sam']).repetitive, true);
  assert.equal(detectRepetition(cook, '*I smile.* The train leaves at nine, do not miss it.', ['Rico', 'Sam']).repetitive, false);
});

test('detectRepetition: entradas raras nunca lanzan', () => {
  assert.deepEqual(detectRepetition(null, undefined), { repetitive: false, theme: [], hits: [] });
  assert.equal(varietyNeeded(null), false);
  assert.equal(varietyNeeded([{ role: 'user', text: 'hola' }]), false);
});

test('varietyNeeded: mira el ÚLTIMO turno del personaje contra los tres anteriores', () => {
  const msgs = [];
  for (const t of GARDEN) {
    msgs.push({ role: 'char', text: t }, { role: 'user', text: 'Tell me more.' });
  }
  assert.equal(varietyNeeded(msgs, NAMES), false); // solo 3 turnos: falta el cuarto
  msgs.push({ role: 'char', text: '*I hold up a seed.* Watching it grow makes me so happy, Sam.' }, { role: 'user', text: 'ok' });
  assert.equal(varietyNeeded(msgs, NAMES), true);
  msgs.push({ role: 'char', text: '*I laugh.* Pizza it is, then. Extra cheese please.' }, { role: 'user', text: 'ok' });
  assert.equal(varietyNeeded(msgs, NAMES), false);
});

// ---------- colocación en el prompt ----------

const card = { name: 'Tessa', description: 'A botanist.', personality: 'gentle', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '' };
const settings = { user: 'Sam', ctx: 4096, maxLen: 160, mode: 'chat' };
const history = [
  { role: 'char', text: '*I smile.* Hi Sam.', ts: 1 },
  { role: 'user', text: 'Hi Tessa, long day.', ts: 2 }
];

test('la nota de variedad va al FINAL, junto al bloque por tema, y no toca los mensajes guardados', () => {
  const saved = JSON.stringify(history);
  const chat = buildChatMessages(card, history, settings, '', '', 'Known facts (from memory):\n- x', VARIETY_NOTE);
  const last = chat.messages[chat.messages.length - 1].content;
  assert.ok(last.startsWith('[Known facts (from memory):\n- x]\n[' + VARIETY_NOTE + ']\n\n'));
  assert.ok(last.endsWith('Hi Tessa, long day.'));
  const plain = buildPlainPrompt(card, history, settings, '', '', '', VARIETY_NOTE);
  assert.ok(plain.prompt.includes(`[${VARIETY_NOTE}]\nSam: Hi Tessa, long day.\nTessa:`));
  assert.equal(JSON.stringify(history), saved);
});

test('sin nota, el prompt es idéntico al de antes (con y sin bloque por tema)', () => {
  for (const topic of ['', 'Known facts (from memory):\n- x']) {
    assert.deepEqual(buildChatMessages(card, history, settings, '', '', topic), buildChatMessages(card, history, settings, '', '', topic, ''));
    assert.deepEqual(buildPlainPrompt(card, history, settings, '', '', topic), buildPlainPrompt(card, history, settings, '', '', topic, ''));
  }
  const chat = buildChatMessages(card, history, settings);
  assert.equal(chat.messages[chat.messages.length - 1].content, 'Hi Tessa, long day.');
});

test('la nota de variedad no nombra a ningún personaje', () => {
  assert.ok(!/tessa|mia/i.test(VARIETY_NOTE));
});
