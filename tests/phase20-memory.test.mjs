import test from 'node:test';
import assert from 'node:assert/strict';

import {
  scoreLoreEntry,
  selectLoreEntries,
  parseExtractionResponse,
  applyExtraction,
  LOREBOOK_MAX_ENTRIES
} from '../www/js/api/lorebook.js';
import { sanitizeLoreEntry } from '../www/js/state.js';

test('FASE 20: sanitizeLoreEntry preserva salience (1..10), topic, accessCount y lastAccessed', () => {
  const raw = {
    id: 'mem-1',
    content: 'Edgar prefiere café expreso sin azúcar',
    keys: ['café', 'expreso'],
    source: 'auto',
    salience: 8,
    topic: 'café',
    accessCount: 3,
    lastAccessed: 1728400000000
  };

  const sanitized = sanitizeLoreEntry(raw);
  assert.equal(sanitized.salience, 8);
  assert.equal(sanitized.topic, 'café');
  assert.equal(sanitized.accessCount, 3);
  assert.equal(sanitized.lastAccessed, 1728400000000);

  // Valores extremos o inválidos caen a valores por defecto seguros
  const rawInvalid = {
    id: 'mem-2',
    content: 'Un recuerdo sin campos',
    keys: ['test'],
    salience: 99,
    topic: '   tema con espacios   '
  };
  const sanitizedInvalid = sanitizeLoreEntry(rawInvalid);
  assert.equal(sanitizedInvalid.salience, 10, 'Salience mayor a 10 debe clampearse a 10');
  assert.equal(sanitizedInvalid.topic, 'tema con espacios');
  assert.equal(sanitizedInvalid.accessCount, undefined);
});

test('FASE 20: scoreLoreEntry pondera salience emocional, relevancia léxica y recencia', () => {
  const now = 1728400000000;
  const recentHighSalience = {
    content: 'Edgar le confesó a Nora un secreto íntimo de su infancia',
    keys: ['secreto', 'infancia'],
    salience: 9,
    topic: 'infancia',
    updated: now,
    accessCount: 2
  };

  const oldLowSalience = {
    content: 'Edgar toma agua por la mañana',
    keys: ['agua', 'mañana'],
    salience: 3,
    topic: 'rutina',
    updated: now - (30 * 24 * 3600 * 1000), // hace 30 días
    accessCount: 0
  };

  const text = 'Estábamos hablando de aquel secreto de tu infancia cuando éramos niños';
  const score1 = scoreLoreEntry(recentHighSalience, ['secreto', 'infancia'], text, now);
  const score2 = scoreLoreEntry(oldLowSalience, ['agua'], text, now);

  assert.ok(score1 > score2, `Recuerdo de alta salience (${score1}) debe puntuar mucho más que uno trivial y viejo (${score2})`);
  assert.ok(score1 >= 70, `Score de recuerdo altamente relevante y saliente debe ser >= 70 (obtuvo ${score1})`);
});

test('FASE 20: selectLoreEntries aplica filtro de diversidad temática (anti-piling)', () => {
  const now = Date.now();
  const entries = [
    {
      id: 'c1',
      content: 'Edgar toma café negro por las mañanas',
      keys: ['café'],
      topic: 'café',
      salience: 6,
      updated: now - 1000
    },
    {
      id: 'c2',
      content: 'Edgar le gusta preparar café en prensa francesa',
      keys: ['café'],
      topic: 'café',
      salience: 7,
      updated: now - 500
    },
    {
      id: 'c3',
      content: 'Edgar compra granos de café colombiano tostado oscuro',
      keys: ['café'],
      topic: 'café',
      salience: 6,
      updated: now
    },
    {
      id: 'b1',
      content: 'Edgar lee novelas de ciencia ficción por las noches',
      keys: ['libros', 'café'], // incluye café para que haga match
      topic: 'literatura',
      salience: 8,
      updated: now
    }
  ];

  const recentMessages = [
    { sender: 'user', text: 'Me estoy tomando un café mientras descanso' }
  ];

  const selected = selectLoreEntries(entries, recentMessages, { now, charBudget: 500 });
  const coffeeTopics = selected.filter((e) => e.topic === 'café');

  assert.ok(coffeeTopics.length <= 1, `No debe haber más de 1 recuerdo del mismo tema café (hubo ${coffeeTopics.length})`);
  assert.ok(selected.some((e) => e.topic === 'literatura'), 'El recuerdo del tema literatura debe entrar gracias a la diversidad');
});

test('FASE 20: parseExtractionResponse soporta "s" (salience) y "top" (topic)', () => {
  const jsonResponse = JSON.stringify([
    {
      k: ['café', 'desayuno'],
      c: 'Edgar toma café tostado en el desayuno',
      s: 7,
      top: 'café'
    },
    {
      keys: ['programación'],
      content: 'Edgar programa en JavaScript y Python',
      salience: 8,
      topic: 'trabajo'
    }
  ]);

  const parsed = parseExtractionResponse(jsonResponse);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].salience, 7);
  assert.equal(parsed[0].topic, 'café');
  assert.equal(parsed[1].salience, 8);
  assert.equal(parsed[1].topic, 'trabajo');
});

test('FASE 20: LOREBOOK_MAX_ENTRIES es 200 y applyExtraction descarta recuerdos triviales (<6 de salience)', () => {
  assert.equal(LOREBOOK_MAX_ENTRIES, 200, 'El tope de recuerdos en la base de datos debe ser 200');

  const existing = [];
  const candidates = [
    {
      keys: ['clima'],
      content: 'Hoy hace frío y nublado en la ciudad',
      salience: 4, // Trivial < 6
      topic: 'clima'
    },
    {
      keys: ['música', 'jazz'],
      content: 'Edgar ama el jazz clásico de Miles Davis',
      salience: 8, // Significativo >= 6
      topic: 'música'
    }
  ];

  const result = applyExtraction(existing, candidates, { ignoreKeys: ['Edgar', 'Nora'] });
  assert.equal(result.entries.length, 1, 'Solo debe guardarse el recuerdo con salience >= 6');
  assert.equal(result.entries[0].topic, 'música');
  assert.equal(result.entries[0].salience, 8);
});
