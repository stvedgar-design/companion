// tests/cards.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readPngCard, normCard, parseCardFile } from '../www/js/cards/parse.js';

// ---------- helpers para construir PNG de prueba en memoria ----------

const PNG_SIG = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i];
    for (let k = 0; k < 8; k++) {
      crc = (crc & 1) ? (crc >>> 1) ^ 0xEDB88320 : (crc >>> 1);
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0);
  return b;
}

function concatBytes(arrays) {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

function chunk(type, dataBytes) {
  const typeBytes = new TextEncoder().encode(type);
  const body = concatBytes([typeBytes, dataBytes]);
  return concatBytes([u32(dataBytes.length), body, u32(crc32(body))]);
}

function buildPng(chunks) {
  return concatBytes([PNG_SIG, ...chunks, chunk('IEND', new Uint8Array(0))]).buffer;
}

function tEXtChunk(keyword, text) {
  const kw = new TextEncoder().encode(keyword);
  const txt = new TextEncoder().encode(text);
  return chunk('tEXt', concatBytes([kw, new Uint8Array([0]), txt]));
}

async function deflateBytes(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

async function iTXtChunk(keyword, text, { compressed = false } = {}) {
  const kw = new TextEncoder().encode(keyword);
  const zero = new Uint8Array([0]);
  const compFlag = new Uint8Array([compressed ? 1 : 0]);
  const compMethod = new Uint8Array([0]);
  const langTag = new Uint8Array([0]); // vacío
  const translatedKeyword = new Uint8Array([0]); // vacío
  const textBytes = new TextEncoder().encode(text);
  const payload = compressed ? await deflateBytes(textBytes) : textBytes;
  return chunk('iTXt', concatBytes([kw, zero, compFlag, compMethod, langTag, translatedKeyword, payload]));
}

function b64FromJson(obj) {
  const bytes = new TextEncoder().encode(JSON.stringify(obj));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fileFromBuffer(buffer, name, type) {
  return new File([buffer], name, { type });
}

// ---------- datos de prueba ----------

const cardV2Wrapped = {
  spec: 'chara_card_v2',
  spec_version: '2.0',
  data: {
    name: 'Luná 🌙',
    description: 'Una compañera cálida y curiosa, con acentos: ñoño, café, corazón ❤️.',
    personality: 'Alegre y directa',
    scenario: 'Una tarde tranquila en casa',
    first_mes: '¡Hola! ¿Cómo estás hoy? 😊',
    mes_example: '<START>\n{{user}}: Hola\n{{char}}: ¡Hola!',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: ['Saludo alterno uno', 42, 'Saludo alterno dos', null],
    character_book: { entries: [{ keys: ['ñ'], content: 'algo' }] },
  },
};

const cardLegacyFlat = {
  char_name: 'Vieja Amiga',
  char_persona: 'Persona antigua descrita con alias',
  char_greeting: 'Hola de nuevo',
  world_scenario: 'Un mundo heredado',
  example_dialogue: '{{user}}: hola\n{{char}}: hola',
};

// ---------- readPngCard / detección por chunk ----------

test('lee una card V2 desde un chunk tEXt "chara" con acentos y emoji intactos', async () => {
  const png = buildPng([tEXtChunk('chara', b64FromJson(cardV2Wrapped))]);
  const raw = await readPngCard(png);
  assert.ok(raw);
  assert.equal(raw.data.name, 'Luná 🌙');
  assert.match(raw.data.description, /ñoño/);
  assert.match(raw.data.description, /❤️/);
});

test('lee una card V3 desde un chunk iTXt "ccv3" sin comprimir', async () => {
  const cardV3 = { spec: 'chara_card_v3', data: { ...cardV2Wrapped.data, name: 'Card V3' } };
  const png = buildPng([await iTXtChunk('ccv3', b64FromJson(cardV3), { compressed: false })]);
  const raw = await readPngCard(png);
  assert.ok(raw);
  assert.equal(raw.data.name, 'Card V3');
});

test('lee una card V3 desde un chunk iTXt comprimido (deflate)', async () => {
  const cardV3 = { spec: 'chara_card_v3', data: { ...cardV2Wrapped.data, name: 'Card V3 comprimida' } };
  const png = buildPng([await iTXtChunk('ccv3', b64FromJson(cardV3), { compressed: true })]);
  const raw = await readPngCard(png);
  assert.ok(raw);
  assert.equal(raw.data.name, 'Card V3 comprimida');
});

test('ccv3 tiene prioridad sobre chara cuando ambos están presentes', async () => {
  const cardChara = { spec: 'chara_card_v2', data: { ...cardV2Wrapped.data, name: 'Versión chara' } };
  const cardCcv3 = { spec: 'chara_card_v3', data: { ...cardV2Wrapped.data, name: 'Versión ccv3' } };
  const png = buildPng([
    tEXtChunk('chara', b64FromJson(cardChara)),
    await iTXtChunk('ccv3', b64FromJson(cardCcv3), { compressed: false }),
  ]);
  const raw = await readPngCard(png);
  assert.equal(raw.data.name, 'Versión ccv3');
});

test('un PNG válido sin chunk de card devuelve null', async () => {
  const png = buildPng([]);
  const raw = await readPngCard(png);
  assert.equal(raw, null);
});

test('bytes que no son PNG devuelven null en readPngCard', async () => {
  const notPng = new TextEncoder().encode('esto no es un png').buffer;
  const raw = await readPngCard(notPng);
  assert.equal(raw, null);
});

// ---------- normCard ----------

test('normCard normaliza el envoltorio V2/V3 con todos los campos', () => {
  const card = normCard(cardV2Wrapped);
  assert.equal(card.name, 'Luná 🌙');
  assert.match(card.description, /ñoño/);
  assert.equal(card.personality, 'Alegre y directa');
  assert.equal(card.scenario, 'Una tarde tranquila en casa');
  assert.equal(card.first_mes, '¡Hola! ¿Cómo estás hoy? 😊');
  assert.deepEqual(card.alternate_greetings, ['Saludo alterno uno', 'Saludo alterno dos']);
  assert.deepEqual(card.character_book, cardV2Wrapped.data.character_book);
});

test('normCard reconoce alias heredados del formato plano antiguo', () => {
  const card = normCard(cardLegacyFlat);
  assert.equal(card.name, 'Vieja Amiga');
  assert.equal(card.description, 'Persona antigua descrita con alias');
  assert.equal(card.first_mes, 'Hola de nuevo');
  assert.equal(card.scenario, 'Un mundo heredado');
  assert.equal(card.mes_example, '{{user}}: hola\n{{char}}: hola');
});

test('normCard devuelve una Card completa con valores por defecto', () => {
  const card = normCard({});
  assert.equal(card.name, 'Sin nombre');
  assert.equal(card.description, '');
  assert.equal(card.system_prompt, '');
  assert.deepEqual(card.alternate_greetings, []);
  assert.equal(card.character_book, null);
});

// ---------- parseCardFile: PNG y JSON, tamaño y errores ----------

test('parseCardFile importa un PNG V3 sin error (bytes reales, ninguna extensión)', async () => {
  const cardV3 = { spec: 'chara_card_v3', data: cardV2Wrapped.data };
  const buffer = buildPng([await iTXtChunk('ccv3', b64FromJson(cardV3), { compressed: false })]);
  const file = fileFromBuffer(buffer, 'personaje-sin-extension', ''); // sin .png y sin file.type
  const { card, avatarBlob } = await parseCardFile(file);
  assert.equal(card.name, 'Luná 🌙');
  assert.ok(avatarBlob);
});

test('parseCardFile importa un JSON de Chub/SillyTavern V2 sin error', async () => {
  const buffer = new TextEncoder().encode(JSON.stringify(cardV2Wrapped)).buffer;
  const file = fileFromBuffer(buffer, 'card.txt', ''); // extensión no confiable a propósito
  const { card, avatarBlob } = await parseCardFile(file);
  assert.equal(card.name, 'Luná 🌙');
  assert.equal(avatarBlob, null);
});

test('parseCardFile quita el BOM inicial de un JSON', async () => {
  const json = '\uFEFF' + JSON.stringify(cardLegacyFlat);
  const buffer = new TextEncoder().encode(json).buffer;
  const file = fileFromBuffer(buffer, 'card.json', 'application/json');
  const { card } = await parseCardFile(file);
  assert.equal(card.name, 'Vieja Amiga');
});

test('un PNG sin card lanza un error en español y accionable', async () => {
  const buffer = buildPng([]);
  const file = fileFromBuffer(buffer, 'sin-card.png', 'image/png');
  await assert.rejects(() => parseCardFile(file), /Ese PNG no trae una character card\./);
});

test('un JSON inválido lanza un error en español', async () => {
  const buffer = new TextEncoder().encode('{ esto no es json').buffer;
  const file = fileFromBuffer(buffer, 'roto.json', 'application/json');
  await assert.rejects(() => parseCardFile(file), /El archivo no es un JSON válido\./);
});

test('un archivo demasiado grande lanza un error claro', async () => {
  const bigFile = {
    size: 30 * 1024 * 1024,
    type: '',
    async arrayBuffer() { return new ArrayBuffer(0); },
  };
  await assert.rejects(() => parseCardFile(bigFile), /El archivo es demasiado grande\./);
});
