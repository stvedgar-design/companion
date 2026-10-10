// tests/memory-clustering.test.mjs — FASE 19 (PARETO-012) & FASE 20: Refinamiento individual con IA y desmantelamiento de macro-clusters.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  clusterLorebookEntries,
  buildMemoryRefinePrompt,
  buildMemoryRefinePlainPrompt,
  parseMemoryRefineResponse,
  applyClusterConsolidation,
} from '../www/js/api/memory-clustering.js';

test('clusterLorebookEntries: retorna siempre [] tras la erradicación del coautor (PARETO-012)', () => {
  const entries = [
    { id: '1', keys: ['café', 'mañana'], content: 'Edgar y Nora toman café negro al amanecer.', always: false },
    { id: '2', keys: ['café', 'lluvia'], content: 'Cuando llueve, toman café junto a la ventana.', always: false },
    { id: '3', keys: ['piano'], content: 'Nora toca el piano para relajarse.', always: false },
  ];

  const clusters = clusterLorebookEntries(entries, { charName: 'Nora', userName: 'Edgar' });
  assert.equal(clusters.length, 0);
  assert.deepEqual(clusterLorebookEntries([]), []);
});

test('buildMemoryRefinePrompt: genera prompt de refinamiento íntimo anti-forense', () => {
  const prompt = buildMemoryRefinePrompt({
    charName: 'Nora',
    userName: 'Edgar',
    content: 'Edgar le dijo a Nora que tenía que ir a trabajar temprano.',
  });

  assert.equal(prompt.length, 2);
  assert.equal(prompt[0].role, 'system');
  assert.ok(prompt[0].content.includes('Nora'));
  assert.ok(prompt[0].content.includes('Edgar'));
  assert.ok(prompt[0].content.includes('STRICTLY FORBIDDEN: Clinical, forensic'));
  assert.equal(prompt[1].role, 'user');
  assert.ok(prompt[1].content.includes('Edgar le dijo a Nora'));
});

test('buildMemoryRefinePlainPrompt: genera sintaxis plana de Llama 3.2 Instruct', () => {
  const plain = buildMemoryRefinePlainPrompt({
    charName: 'Nora',
    userName: 'Edgar',
    content: 'Nota de prueba',
  });
  assert.ok(plain.includes('<|begin_of_text|>'));
  assert.ok(plain.includes('<|start_header_id|>system<|end_header_id|>'));
  assert.ok(plain.includes('<|start_header_id|>user<|end_header_id|>'));
  assert.ok(plain.includes('<|start_header_id|>assistant<|end_header_id|>'));
});

test('parseMemoryRefineResponse: limpia comillas, prefijos de respuesta y respeta límites', () => {
  assert.equal(
    parseMemoryRefineResponse('  "Un amanecer tranquilo donde Edgar y Nora compartieron miradas tiernas."  '),
    'Un amanecer tranquilo donde Edgar y Nora compartieron miradas tiernas.'
  );
  assert.equal(
    parseMemoryRefineResponse('Refined: Nora sonríe recordando las caricias suaves de Edgar.'),
    'Nora sonríe recordando las caricias suaves de Edgar.'
  );
  assert.equal(parseMemoryRefineResponse('', 'Fallback'), 'Fallback');
  assert.equal(parseMemoryRefineResponse('ab', 'Fallback largo'), 'Fallback largo');
});

test('applyClusterConsolidation: función de compatibilidad histórica para archivar recuerdos', () => {
  const char = {
    id: 'c1',
    name: 'Nora',
    lorebook: [
      { id: 'e1', keys: ['café'], content: 'Recuerdo 1', updated: 100 },
      { id: 'e2', keys: ['café'], content: 'Recuerdo 2', updated: 200 },
      { id: 'e3', keys: ['música'], content: 'Recuerdo no relacionado', updated: 300 },
    ],
    lorebookArchive: [],
  };

  const updated = applyClusterConsolidation(
    char,
    ['e1', 'e2'],
    'Edgar y Nora comparten su amor por el café en momentos de tranquilidad.',
    ['café', 'rutina'],
    123456789
  );

  assert.equal(updated.lorebook.length, 2);
  assert.equal(updated.lorebook[0].id, 'e3');
  assert.equal(updated.lorebook[1].content, 'Edgar y Nora comparten su amor por el café en momentos de tranquilidad.');
  assert.equal(updated.lorebook[1].source, 'manual');
  assert.deepEqual(updated.lorebook[1].keys, ['café', 'rutina']);

  assert.equal(updated.lorebookArchive.length, 2);
  assert.equal(updated.lorebookArchive[0].id, 'e1');
  assert.equal(updated.lorebookArchive[1].id, 'e2');
  assert.equal(updated.lorebookArchive[0].archivedAt, 123456789);

  assert.equal(updated.lorebookPrevious.length, 3);
  assert.equal(updated.lorebookPreviousAt, 123456789);
});
