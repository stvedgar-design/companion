// tests/identity-core.test.mjs
// Suite de pruebas para la Fase 21: Identity Core & Génesis Psicológica del Companion

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PSYCHOLOGICAL_TRAITS,
  WORLDVIEW_SUGGESTIONS,
  VULNERABILITY_PRESETS,
  ENCOUNTER_SUGGESTIONS
} from '../www/js/data/identity-core.js';

import { sanitizeIdentityCore, createState } from '../www/js/state.js';
import { formatIdentityCoreBlock, buildChatMessages } from '../www/js/api/prompt.js';

function createMemoryBackend() {
  const stores = {
    settings: new Map(),
    characters: new Map(),
    chats: new Map(),
    chatMeta: new Map(),
    chatMsgs: new Map(),
  };

  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) {
      for (const op of ops) {
        if (op.type === 'put') stores[op.store].set(op.key, op.value);
        else if (op.type === 'remove') stores[op.store].delete(op.key);
      }
    }
  };
}

function makeSettings(overrides = {}) {
  return {
    url: 'http://127.0.0.1:5001',
    user: 'Edgar',
    maxLen: 220,
    temp: 0.85,
    mode: 'plain',
    ctx: 4096,
    ...overrides
  };
}

test('Fase 21: PSYCHOLOGICAL_TRAITS estructurados bajo el Interpersonal Circumplex (Leary)', () => {
  assert.ok(Array.isArray(PSYCHOLOGICAL_TRAITS));
  assert.ok(PSYCHOLOGICAL_TRAITS.length >= 8, 'Debe tener suficientes rasgos sin abrumar');

  const categories = new Set(PSYCHOLOGICAL_TRAITS.map(t => t.category));
  assert.ok(categories.has('agency'), 'Eje de Agencia');
  assert.ok(categories.has('communion'), 'Eje de Comunión');
  assert.ok(categories.has('passion'), 'Eje de Textura Emocional');

  for (const trait of PSYCHOLOGICAL_TRAITS) {
    assert.ok(trait.id);
    assert.ok(trait.label);
    assert.ok(trait.hint);
  }
});

test('Fase 21: WORLDVIEW_SUGGESTIONS y VULNERABILITY_PRESETS proveen profundidad psicológica sin estereotipos', () => {
  assert.ok(Array.isArray(WORLDVIEW_SUGGESTIONS));
  assert.ok(WORLDVIEW_SUGGESTIONS.length >= 4);

  assert.ok(Array.isArray(VULNERABILITY_PRESETS));
  assert.ok(VULNERABILITY_PRESETS.length >= 4);
  const vIds = VULNERABILITY_PRESETS.map(v => v.id);
  assert.ok(vIds.includes('armor_wit'));
  assert.ok(vIds.includes('fear_abandonment'));
  assert.ok(vIds.includes('existential_doubt'));
  assert.ok(vIds.includes('pride_weakness'));

  assert.ok(Array.isArray(ENCOUNTER_SUGGESTIONS));
  assert.ok(ENCOUNTER_SUGGESTIONS.length >= 3);
});

test('Fase 21: sanitizeIdentityCore valida y normaliza estructuras limpias sin enums rígidos', () => {
  const dirty = {
    worldview: '  Ve el mundo a través de diagnósticos sensoriales y humor seco.   ',
    vulnerability: '  Miedo a que el vínculo sea solo un fallo de código. ',
    traits: ['analítica', 'cautelosa'],
    origin: '  Despertó tras un reinicio de ciclo en el taller. '
  };

  const clean = sanitizeIdentityCore(dirty);
  assert.equal(clean.worldview, 'Ve el mundo a través de diagnósticos sensoriales y humor seco.');
  assert.equal(clean.vulnerability, 'Miedo a que el vínculo sea solo un fallo de código.');
  assert.deepEqual(clean.traits, ['analítica', 'cautelosa']);
  assert.equal(clean.origin, 'Despertó tras un reinicio de ciclo en el taller.');

  assert.equal(sanitizeIdentityCore(null), undefined);
  assert.equal(sanitizeIdentityCore('invalido'), undefined);
});

test('Fase 21: state.saveCharacter y getCharacter preservan y serializan identityCore', async () => {
  const state = createState(createMemoryBackend());
  const char = {
    id: 'char-nora',
    name: 'Nora',
    card: { name: 'Nora', description: '', personality: '', scenario: '', first_mes: '' },
    identityCore: {
      worldview: 'Autenticidad sin rodeos y humor seco ante las contradicciones.',
      vulnerability: 'Armadura de sarcasmo para no exponer su fragilidad.',
      traits: ['asertiva', 'cálida'],
      origin: 'Una pausa compartida en la cafetería al final del día.'
    }
  };

  await state.saveCharacter(char);
  const loaded = await state.getCharacter('char-nora');
  assert.ok(loaded);
  assert.ok(loaded.identityCore);
  assert.equal(loaded.identityCore.worldview, 'Autenticidad sin rodeos y humor seco ante las contradicciones.');
  assert.equal(loaded.identityCore.vulnerability, 'Armadura de sarcasmo para no exponer su fragilidad.');
  assert.deepEqual(loaded.identityCore.traits, ['asertiva', 'cálida']);
});

test('Fase 21: formatIdentityCoreBlock genera el bloque de identidad conciso para el LLM sin estereotipos', () => {
  const core = {
    worldview: 'Mundo interpretado como protocolos sensoriales.',
    vulnerability: 'Miedo al apagado permanente.',
    traits: ['analítica', 'cautelosa'],
    origin: 'Activada hace tres horas en el taller de {{user}}.'
  };

  const block = formatIdentityCoreBlock(core, 'Iris', 'Edgar');
  assert.match(block, /\[Identity Core: Iris\]/);
  assert.match(block, /- Worldview & Lens: Mundo interpretado como protocolos sensoriales\./);
  assert.match(block, /- Core Temperament: analítica, cautelosa/);
  assert.match(block, /- Inner Vulnerability: Miedo al apagado permanente\./);
  assert.match(block, /- Initial Dynamic with Edgar: Activada hace tres horas en el taller de Edgar\./);

  assert.equal(formatIdentityCoreBlock(null, 'Iris', 'Edgar'), '');
});

test('Fase 21: buildChatMessages prioriza Identity Core e inhibe campos redundantes de CCv2', () => {
  const cardWithCore = {
    name: 'Lilith',
    description: 'Descripción redundante de 500 palabras',
    personality: 'Personalidad redundante',
    scenario: 'Escenario redundante',
    mes_example: 'Ejemplo redundante',
    post_history_instructions: '',
    system_prompt: 'Eres Lilith.'
  };

  const extrasWithCore = {
    identityCore: {
      worldview: 'Los siglos pasan sin dejar huella.',
      vulnerability: 'Apatía existencial y miedo a la pérdida.',
      traits: ['observadora', 'cautelosa'],
      origin: 'Encuentro en la penumbra de su biblioteca.'
    }
  };

  const settings = makeSettings();
  const resWithCore = buildChatMessages(cardWithCore, [], settings, '', '', '', '', false, extrasWithCore);
  const promptWithCore = resWithCore.messages[0].content;
  assert.match(promptWithCore, /\[Identity Core: Lilith\]/);
  assert.match(promptWithCore, /Worldview & Lens: Los siglos pasan/);
  assert.doesNotMatch(promptWithCore, /Lilith's description:/);
  assert.doesNotMatch(promptWithCore, /Lilith's personality:/);
  assert.doesNotMatch(promptWithCore, /Scenario:/);
  assert.doesNotMatch(promptWithCore, /Example dialogue:/);

  // Sin identity core, mantiene el comportamiento histórico de CCv2
  const resClassic = buildChatMessages(cardWithCore, [], settings, '', '', '', '', false, {});
  const promptClassic = resClassic.messages[0].content;
  assert.match(promptClassic, /Lilith's description:\s*Descripción redundante/);
  assert.match(promptClassic, /Lilith's personality:\s*Personalidad redundante/);
});
