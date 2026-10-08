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
