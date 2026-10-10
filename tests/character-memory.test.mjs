import { scoreLoreEntry, selectLoreEntries, parseExtractionResponse, applyExtraction, LOREBOOK_MAX_ENTRIES } from "../www/js/api/lorebook.js";
import { sanitizeLoreEntry } from "../www/js/state.js";
// tests/character-memory.test.mjs — MEM-017: qué muestra "Memoria de {Nombre}" (funciones puras, sin DOM).
import test from 'node:test';
import assert from 'node:assert/strict';
import { memoryDashboardModel, memoryPage, continuityPreview, MEMORY_PAGE_SIZE } from '../www/js/ui/character-memory.js';
import { duplicateCharacterData } from '../www/js/ui/character-sheet.js';
import { relationshipSummary, RELATIONSHIP_EARLY_DISPLAY_TEXT } from '../www/js/api/relationship.js';
import { buildMemoryRefinePrompt, parseMemoryRefineResponse } from '../www/js/api/memory-clustering.js';

const entry = (i, extra = {}) => ({ id: `e${i}`, keys: [`k${i}`], content: `Recuerdo ${i}`, updated: i, source: 'auto', ...extra });
const lore = (n, alwaysIds = []) => Array.from({ length: n }, (_, i) => entry(i, alwaysIds.includes(i) ? { always: true, source: 'manual' } : {}));
const makeChar = (extra = {}) => ({ id: 'c1', name: 'Nova', card: { name: 'Nova' }, lorebook: [], ...extra });

test('modelo: personaje vacío — early, sin avance falso, sin archivados, sin resumen', () => {
  const m = memoryDashboardModel(makeChar(), null);
  assert.equal(m.level, 'early');
  assert.equal(m.relationshipText, RELATIONSHIP_EARLY_DISPLAY_TEXT);
  assert.deepEqual(m.progress, { current: 0, target: 30 });
  assert.equal(m.total, 0);
  assert.equal(m.archivedCount, 0);
  assert.equal(m.continuity.text, '');
  assert.equal(m.continuity.preview, '');
});

test('modelo: separa siempre presentes y por tema (por tema, el más reciente primero)', () => {
  const m = memoryDashboardModel(makeChar({ lorebook: lore(5, [1, 3]) }), null);
  assert.deepEqual(m.always.map((e) => e.id), ['e1', 'e3']);
  assert.deepEqual(m.topic.map((e) => e.id), ['e4', 'e2', 'e0']);
  assert.equal(m.total, 5);
});

test('modelo: el nivel y el total coinciden SIEMPRE con relationshipSummary (la pantalla no calcula su propia relación)', () => {
  for (const n of [0, 29, 30, 79, 80, 120]) {
    const c = makeChar({ lorebook: lore(n) });
    const m = memoryDashboardModel(c, null);
    const s = relationshipSummary(c.lorebook);
    assert.equal(m.level, s.level, `n=${n}`);
    assert.equal(m.total, s.total, `n=${n}`);
  }
  assert.deepEqual(memoryDashboardModel(makeChar({ lorebook: lore(30) }), null).progress, { current: 30, target: 80 });
  assert.equal(memoryDashboardModel(makeChar({ lorebook: lore(80) }), null).progress, null);
});

test('modelo: los archivados solo se cuentan y NO entran en los recuerdos activos ni en el total', () => {
  const c = makeChar({ lorebook: lore(2), lorebookArchive: [{ ...entry(9), archivedAt: 5 }, { ...entry(8), archivedAt: 6 }] });
  const m = memoryDashboardModel(c, null);
  assert.equal(m.archivedCount, 2);
  assert.equal(m.total, 2);
  assert.equal([...m.always, ...m.topic].some((e) => e.id === 'e9'), false);
});

test('modelo: no modifica el personaje que recibe', () => {
  const c = makeChar({ lorebook: lore(4, [0]), lorebookArchive: [] });
  const before = JSON.stringify(c);
  memoryDashboardModel(c, { continuitySummary: { text: 'algo', updated: 1, coveredUntil: 1 } });
  assert.equal(JSON.stringify(c), before);
});

test('resumen: usa el del episodio recibido y recorta la vista previa sin partir palabras', () => {
  const long = 'palabra '.repeat(80).trim();
  const m = memoryDashboardModel(makeChar(), { continuitySummary: { text: long, updated: 10, coveredUntil: 3 } });
  assert.equal(m.continuity.text, long);
  assert.ok(m.continuity.preview.length <= 261);
  assert.ok(m.continuity.preview.endsWith('…'));
  assert.ok(!/palabr…$/.test(m.continuity.preview));
  assert.equal(continuityPreview('corto'), 'corto');
  assert.equal(continuityPreview(null), '');
});

test('paginación: 300 recuerdos se dibujan por tandas, sin perder ninguno', () => {
  const list = lore(300);
  let shown = 0;
  let batches = 0;
  const seen = [];
  for (;;) {
    const { items, remaining } = memoryPage(list, shown);
    assert.ok(items.length <= MEMORY_PAGE_SIZE);
    if (batches === 0) assert.equal(items.length, MEMORY_PAGE_SIZE);
    shown += items.length;
    seen.push(...items);
    batches++;
    if (!remaining) break;
  }
  assert.equal(batches, 300 / MEMORY_PAGE_SIZE);
  assert.equal(seen.length, 300);
  assert.equal(new Set(seen.map((e) => e.id)).size, 300);
  assert.deepEqual(memoryPage([], 0), { items: [], remaining: 0 });
});

test('duplicar personaje: el archivo de recuerdos NO se copia (un duplicado nace sin memoria)', () => {
  const dup = duplicateCharacterData(makeChar({ lorebook: lore(3), lorebookArchive: [{ ...entry(9), archivedAt: 1 }] }));
  assert.deepEqual(dup.lorebook, []);
  assert.deepEqual(dup.lorebookArchive, []);
});

test('FASE 19 (PARETO-012): coautor y consolidacion retirados; pulido emocional de recuerdos individuales activo', () => {
  const c = makeChar({
    lorebook: [
      { id: 'e1', keys: ['café', 'mañanas'], content: 'Edgar toma café negro por la mañana', updated: 10 },
      { id: 'e2', keys: ['café', 'lluvia'], content: 'Edgar y Nora toman café los días de lluvia', updated: 20 },
      { id: 'e3', keys: ['piano'], content: 'Nora toca el piano', updated: 30 },
    ],
  });
  const m = memoryDashboardModel(c, null);
  // La consolidación en clusters fue retirada en favor de la pureza atómica (siempre [])
  assert.ok(Array.isArray(m.clusters));
  assert.equal(m.clusters.length, 0);

  // Verificación del generador de prompt emocional para Llama 3.2 3B
  const messages = buildMemoryRefinePrompt({
    charName: 'Nora',
    userName: 'Edgar',
    content: 'Edgar mentioned needing to cook and shower before preparing for work',
  });
  assert.equal(messages.length, 2);
  assert.ok(messages[0].content.includes('intimate, character-driven fiction'));
  assert.ok(messages[0].content.includes('STRICTLY FORBIDDEN: Clinical, forensic, or transactional phrasing'));
  assert.ok(messages[1].content.includes('Edgar mentioned needing to cook'));

  // Verificación del parser
  const parsed = parseMemoryRefineResponse('Refined: "A warm, tender morning where Edgar and Nora shared soft words."');
  assert.equal(parsed, 'A warm, tender morning where Edgar and Nora shared soft words.');
});


test("FASE 20: sanitizeLoreEntry preserva salience (1..10), topic, accessCount y lastAccessed", () => {
  const raw = {
    id: "mem-1",
    content: "Edgar prefiere café expreso sin azúcar",
    keys: ["café", "expreso"],
    source: "auto",
    salience: 8,
    topic: "café",
    accessCount: 3,
    lastAccessed: 1728400000000
  };

  const sanitized = sanitizeLoreEntry(raw);
  assert.equal(sanitized.salience, 8);
  assert.equal(sanitized.topic, "café");
  assert.equal(sanitized.accessCount, 3);
  assert.equal(sanitized.lastAccessed, 1728400000000);

  const rawInvalid = {
    id: "mem-2",
    content: "Un recuerdo sin campos",
    keys: ["test"],
    salience: 99,
    topic: "   tema con espacios   "
  };
  const sanitizedInvalid = sanitizeLoreEntry(rawInvalid);
  assert.equal(sanitizedInvalid.salience, 10, "Salience mayor a 10 debe clampearse a 10");
  assert.equal(sanitizedInvalid.topic, "tema con espacios");
  assert.equal(sanitizedInvalid.accessCount, undefined);
});

test("FASE 20: scoreLoreEntry pondera salience emocional, relevancia léxica y recencia", () => {
  const now = 1728400000000;
  const recentHighSalience = {
    content: "Edgar le confesó a Nora un secreto íntimo de su infancia",
    keys: ["secreto", "infancia"],
    salience: 9,
    topic: "infancia",
    updated: now,
    accessCount: 2
  };

  const oldLowSalience = {
    content: "Edgar toma agua por la mañana",
    keys: ["agua", "mañana"],
    salience: 3,
    topic: "rutina",
    updated: now - (30 * 24 * 3600 * 1000),
    accessCount: 0
  };

  const text = "Estábamos hablando de aquel secreto de tu infancia cuando éramos niños";
  const score1 = scoreLoreEntry(recentHighSalience, ["secreto", "infancia"], text, now);
  const score2 = scoreLoreEntry(oldLowSalience, ["agua"], text, now);

  assert.ok(score1 > score2, "Recuerdo de alta salience debe puntuar mucho más que uno trivial y viejo");
  assert.ok(score1 >= 70, `Score de recuerdo altamente relevante y saliente debe ser >= 70 (obtuvo ${score1})`);
});

test("FASE 20: selectLoreEntries aplica filtro de diversidad temática (anti-piling)", () => {
  const now = Date.now();
  const entries = [
    {
      id: "c1",
      content: "Edgar toma café negro por las mañanas",
      keys: ["café"],
      topic: "café",
      salience: 6,
      updated: now - 1000
    },
    {
      id: "c2",
      content: "Edgar le gusta preparar café en prensa francesa",
      keys: ["café"],
      topic: "café",
      salience: 7,
      updated: now - 500
    },
    {
      id: "c3",
      content: "Edgar compra granos de café colombiano tostado oscuro",
      keys: ["café"],
      topic: "café",
      salience: 6,
      updated: now
    },
    {
      id: "b1",
      content: "Edgar lee novelas de ciencia ficción por las noches",
      keys: ["libros", "café"],
      topic: "literatura",
      salience: 8,
      updated: now
    }
  ];

  const recentMessages = [
    { sender: "user", text: "Me estoy tomando un café mientras descanso" }
  ];

  const selected = selectLoreEntries(entries, recentMessages, { now, charBudget: 500 });
  const coffeeTopics = selected.filter((e) => e.topic === "café");

  assert.ok(coffeeTopics.length <= 1, `No debe haber más de 1 recuerdo del mismo tema café (hubo ${coffeeTopics.length})`);
  assert.ok(selected.some((e) => e.topic === "literatura"), "El recuerdo del tema literatura debe entrar gracias a la diversidad");
});

test('FASE 20: parseExtractionResponse soporta "s" (salience) y "top" (topic)', () => {
  const jsonResponse = JSON.stringify([
    {
      k: ["café", "desayuno"],
      c: "Edgar toma café tostado en el desayuno",
      s: 7,
      top: "café"
    },
    {
      keys: ["programación"],
      content: "Edgar programa en JavaScript y Python",
      salience: 8,
      topic: "trabajo"
    }
  ]);

  const parsed = parseExtractionResponse(jsonResponse);
  assert.equal(parsed.length, 2);
  assert.equal(parsed[0].salience, 7);
  assert.equal(parsed[0].topic, "café");
  assert.equal(parsed[1].salience, 8);
  assert.equal(parsed[1].topic, "trabajo");
});

test("FASE 20: LOREBOOK_MAX_ENTRIES es 200 y applyExtraction descarta recuerdos triviales (<6 de salience)", () => {
  assert.equal(LOREBOOK_MAX_ENTRIES, 200, "El tope de recuerdos en la base de datos debe ser 200");

  const existing = [];
  const candidates = [
    {
      keys: ["clima"],
      content: "Hoy hace frío y nublado en la ciudad",
      salience: 4,
      topic: "clima"
    },
    {
      keys: ["música", "jazz"],
      content: "Edgar ama el jazz clásico de Miles Davis",
      salience: 8,
      topic: "música"
    }
  ];

  const result = applyExtraction(existing, candidates, { ignoreKeys: ["Edgar", "Nora"] });
  assert.equal(result.entries.length, 1, "Solo debe guardarse el recuerdo con salience >= 6");
  assert.equal(result.entries[0].topic, "música");
  assert.equal(result.entries[0].salience, 8);
});
