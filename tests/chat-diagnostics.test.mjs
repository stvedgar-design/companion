// tests/chat-diagnostics.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatDiagnosticsModel } from '../www/js/diagnostics/chat-diagnostics.js';

test('buildChatDiagnosticsModel: maneja entradas vacías y por defecto sin errores', () => {
  const model = buildChatDiagnosticsModel({
    character: { id: 'c1', name: 'Mia' },
    chat: { id: 'chat1' },
    messages: [],
    settings: { ctx: 10240, maxLen: 220 },
  });

  assert.equal(model.raw.total, 0);
  assert.equal(model.raw.userCount, 0);
  assert.equal(model.raw.charCount, 0);
  assert.equal(model.raw.avgUserTokens, 0);
  assert.equal(model.raw.avgCharTokens, 0);
  assert.equal(model.raw.totalRegenerations, 0);
  assert.equal(model.raw.messagesWithVariants, 0);
  assert.equal(model.raw.regenRatePct, 0);
  assert.equal(model.raw.lastSpeedTps, null);
  assert.equal(model.raw.hasIdentityCore, false);
  assert.ok(model.reportText.includes('=== COMPANION CHAT DIAGNOSTICS ==='));
  assert.ok(model.reportText.includes('[1. VOLUMETRÍA Y TOKENOMICS]'));
  assert.ok(model.reportText.includes('[2. SALUD GENERATIVA Y REGENERACIONES]'));
  assert.ok(model.reportText.includes('[3. ANATOMÍA DEL CONTEXTO (VENTANA 10240 TOKENS)]'));
  assert.ok(model.reportText.includes('[4. TRAZABILIDAD DE MEMORIA Y RECUERDOS]'));
  assert.ok(model.reportText.includes('Variantes descartadas: Ninguna'));
  assert.ok(model.reportText.includes('Ningún recuerdo inyectado en el último turno'));
});

test('buildChatDiagnosticsModel: calcula volumetría y tokenomics correctamente', () => {
  const messages = [
    { role: 'user', text: 'Hola, ¿cómo estás?' }, // 18 chars
    { role: 'char', text: '¡Hola! Estoy muy bien, gracias por preguntar. ¿Y tú qué tal tu día?' }, // 67 chars
    { role: 'user', text: 'Bien, trabajando en código.' }, // 27 chars
  ];

  const model = buildChatDiagnosticsModel({
    character: { id: 'c1', name: 'Mia' },
    chat: { id: 'chat1' },
    messages,
    settings: { ctx: 10240, maxLen: 220 },
  });

  assert.equal(model.raw.total, 3);
  assert.equal(model.raw.userCount, 2);
  assert.equal(model.raw.charCount, 1);
  assert.equal(model.raw.avgUserTokens, 7);
  assert.equal(model.raw.avgCharTokens, 20);
  assert.ok(model.reportText.includes('Total mensajes: 3 (Usuario: 2, Companion: 1)'));
});

test('buildChatDiagnosticsModel: detecta regeneraciones y variantes descartadas', () => {
  const messages = [
    { role: 'user', text: 'Cuéntame un secreto.' },
    {
      role: 'char',
      text: 'Variante activa final.',
      variants: [
        { text: 'Primera variante descartada que no me gustó tanto.' },
        { text: 'Segunda variante alternativa desechada.' },
        { text: 'Variante activa final.' },
      ],
      activeVariant: 2,
      meta: { ttftMs: 250, totalMs: 1500, chars: 80 },
    },
  ];

  const model = buildChatDiagnosticsModel({
    character: { id: 'c1', name: 'Mia' },
    chat: { id: 'chat1' },
    messages,
    settings: { ctx: 10240, maxLen: 220 },
  });

  assert.equal(model.raw.messagesWithVariants, 1);
  assert.equal(model.raw.totalRegenerations, 2);
  assert.equal(model.raw.regenRatePct, 100);
  assert.equal(model.raw.discardedVariants.length, 2);
  assert.equal(model.raw.discardedVariants[0].variantIndex, 1);
  assert.equal(model.raw.discardedVariants[0].totalVariants, 3);
  assert.ok(model.raw.discardedVariants[0].textSnippet.includes('Primera variante'));
  assert.equal(model.raw.discardedVariants[1].variantIndex, 2);
  assert.ok(model.raw.discardedVariants[1].textSnippet.includes('Segunda variante'));

  assert.ok(model.raw.lastSpeedTps > 15 && model.raw.lastSpeedTps < 18);
  assert.ok(model.reportText.includes('Total regeneraciones ejecutadas: 2'));
  assert.ok(model.reportText.includes('Último TTFT (Time to First Token): 250 ms'));
  assert.ok(model.reportText.includes('Variantes descartadas (2):'));
});

test('buildChatDiagnosticsModel: trazabilidad de memoria, Identity Core y estado de saturación', () => {
  const character = {
    id: 'c2',
    name: 'Theo',
    identityCore: {
      traits: ['Empático', 'Observador'],
    },
    lorebook: [
      { id: 'l1', keys: ['café'], content: 'A Theo le gusta el café amargo.', always: true },
      { id: 'l2', keys: ['lluvia'], content: 'La lluvia le da paz.', always: false },
      { id: 'l3', keys: ['libros'], content: 'Lee novelas clásicas.', always: false },
    ],
  };

  const messages = [
    { role: 'user', text: '¿Tomamos un café?' },
    {
      role: 'char',
      text: 'Claro, me encantaría un café.',
      loreUsed: [
        { id: 'l1', keys: ['café'], content: 'A Theo le gusta el café amargo.', always: true },
      ],
    },
  ];

  const model = buildChatDiagnosticsModel({
    character,
    chat: { id: 'chat2' },
    messages,
    settings: { ctx: 10240, maxLen: 220 },
  });

  assert.equal(model.raw.hasIdentityCore, true);
  assert.equal(model.raw.lorebookTotal, 3);
  assert.equal(model.raw.lorebookAlways, 1);
  assert.equal(model.raw.recentLoreUsed.length, 1);
  assert.ok(model.reportText.includes('Identity Core activo: SÍ (Empático, Observador)'));
  assert.ok(model.reportText.includes('Recuerdos en almacén: 3 (1 siempre presentes)'));
  assert.ok(model.reportText.includes('[ALWAYS] (ID: l1): "A Theo le gusta el café amargo."'));
  assert.ok(model.reportText.includes('VENTANA SALUDABLE (Historial íntegro en memoria viva)'));
});
