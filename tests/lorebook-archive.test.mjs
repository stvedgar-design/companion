// tests/lorebook-archive.test.mjs — MEM-016: archivar recuerdos en vez de borrarlos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../www/js/state.js';
import {
  archiveLoreEntry,
  restoreLoreEntry,
  purgeArchivedEntry,
  removeTombstonesFor,
  addTombstone,
  buildLoreBlocks,
} from '../www/js/api/lorebook.js';
import { relationshipSummary, relationshipForPrompt } from '../www/js/api/relationship.js';

function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
    _stores: stores,
  };
}

const entry = (id, content, extra = {}) => ({ id, keys: [id], content, updated: 1, source: 'auto', ...extra });
const baseChar = (over = {}) => ({ id: 'x', name: 'Mia', avatar: '', card: { name: 'Mia' }, created: 1, updated: 1, last: '', ...over });

test('archiveLoreEntry / restoreLoreEntry: ida y vuelta sin perder ni duplicar nada', () => {
  const a = entry('a', 'Le gusta el té.');
  const b = entry('b', 'Vive en Lima.');
  const moved = archiveLoreEntry([a, b], [], 'a', 100);
  assert.deepEqual(moved.entries.map((e) => e.id), ['b']);
  assert.equal(moved.archive.length, 1);
  assert.equal(moved.archive[0].archivedAt, 100);
  assert.equal(moved.archived.id, 'a');

  const back = restoreLoreEntry(moved.entries, moved.archive, 'a', 200);
  assert.deepEqual(back.entries.map((e) => e.id).sort(), ['a', 'b']);
  assert.deepEqual(back.archive, []);
  assert.equal(back.restored.archivedAt, undefined);
  assert.equal(back.restored.content, a.content);
  assert.equal(back.restored.updated, 200);
});

test('archive/restore/purge con un id inexistente no cambian nada', () => {
  const a = entry('a', 'Hecho.');
  const arch = [{ ...entry('z', 'Viejo.'), archivedAt: 5 }];
  assert.equal(archiveLoreEntry([a], arch, 'nope').archived, null);
  assert.deepEqual(archiveLoreEntry([a], arch, 'nope').entries, [a]);
  assert.equal(restoreLoreEntry([a], arch, 'nope').restored, null);
  assert.deepEqual(purgeArchivedEntry(arch, 'nope'), arch);
  assert.deepEqual(purgeArchivedEntry(arch, 'z'), []);
});

test('removeTombstonesFor quita solo la lápida del mismo contenido', () => {
  const a = entry('a', 'Le gusta el té.');
  const b = entry('b', 'Vive en Lima.');
  let t = addTombstone([], a, 1);
  t = addTombstone(t, b, 2);
  const left = removeTombstonesFor(t, a);
  assert.equal(left.length, 1);
  assert.equal(left[0].content, 'Vive en Lima.');
});

test('un archivado NO va al prompt, NO cuenta para la relación y NO lo ve ningún lector de `lorebook`', () => {
  const entries = Array.from({ length: 30 }, (_, i) => entry('e' + i, 'Hecho número ' + i + ' sobre el usuario.', { keys: ['clave' + i] }));
  assert.equal(relationshipSummary(entries).level, 'growing'); // 30 recuerdos
  const moved = archiveLoreEntry(entries, [], 'e0');
  assert.equal(relationshipSummary(moved.entries).total, 29);
  assert.equal(relationshipSummary(moved.entries).level, 'early', 'archivar uno baja el conteo y puede cruzar de nivel (igual que borrar)');
  assert.equal(relationshipForPrompt({ lorebook: moved.entries }).level, 'early');
  const blocks = buildLoreBlocks(moved.entries, [{ role: 'user', text: 'háblame de clave0 y clave1' }]);
  assert.ok(!blocks.topic.includes('número 0 '), 'el archivado no entra al prompt aunque su palabra clave salga');
  assert.ok(blocks.topic.includes('número 1 '));
});

test('state: archivar, persistir, restaurar (con lápida y todo) y borrar para siempre', async () => {
  const state = createState(memoryBackend());
  const a = entry('a', 'Le gusta el té.');
  const b = entry('b', 'Vive en Lima.');
  await state.saveCharacter(baseChar({ lorebook: [a, b] }));

  // archivar: sale del lorebook, queda en el archivo, deja lápida y habilita "Deshacer"
  let fresh = await state.getCharacter('x');
  let moved = archiveLoreEntry(fresh.lorebook, fresh.lorebookArchive, 'a', 100);
  let saved = await state.saveCharacterLorebook('x', moved.entries, fresh.lorebook, {
    tombstones: addTombstone(fresh.lorebookTombstones, moved.archived, 100),
    previousTombstones: fresh.lorebookTombstones,
    archive: moved.archive,
  });
  assert.deepEqual(saved.lorebook.map((e) => e.id), ['b']);
  assert.deepEqual(saved.lorebookArchive.map((e) => e.id), ['a']);
  assert.equal(saved.lorebookArchive[0].content, 'Le gusta el té.');
  assert.equal(saved.lorebookTombstones.length, 1);
  assert.ok(saved.lorebookPreviousAt > 0);

  // una escritura posterior del lorebook que NO menciona el archivo (extracción, limpieza, edición) no lo pierde
  saved = await state.saveCharacterLorebook('x', [entry('b', 'Vive en Lima, Perú.')]);
  assert.deepEqual(saved.lorebookArchive.map((e) => e.id), ['a']);

  // restaurar
  fresh = await state.getCharacter('x');
  const back = restoreLoreEntry(fresh.lorebook, fresh.lorebookArchive, 'a', 300);
  saved = await state.saveCharacterLorebook('x', back.entries, undefined, {
    tombstones: removeTombstonesFor(fresh.lorebookTombstones, back.restored),
    archive: back.archive,
  });
  assert.deepEqual(saved.lorebook.map((e) => e.id).sort(), ['a', 'b']);
  assert.deepEqual(saved.lorebookArchive, []);
  assert.deepEqual(saved.lorebookTombstones, []);

  // borrar para siempre: la única vía que elimina
  fresh = await state.getCharacter('x');
  moved = archiveLoreEntry(fresh.lorebook, fresh.lorebookArchive, 'b', 400);
  saved = await state.saveCharacterLorebook('x', moved.entries, undefined, { archive: moved.archive });
  assert.equal(saved.lorebookArchive.length, 1);
  saved = await state.saveCharacterLorebook('x', saved.lorebook, undefined, { archive: purgeArchivedEntry(saved.lorebookArchive, 'b') });
  assert.deepEqual(saved.lorebookArchive, []);
  assert.deepEqual(saved.lorebook.map((e) => e.id), ['a']);
});

test('state: un "Deshacer" que devuelve el recuerdo a la lista activa lo quita del archivo (nunca está en las dos)', async () => {
  const state = createState(memoryBackend());
  const a = entry('a', 'Le gusta el té.');
  await state.saveCharacter(baseChar({ lorebook: [a] }));
  const fresh = await state.getCharacter('x');
  const moved = archiveLoreEntry(fresh.lorebook, fresh.lorebookArchive, 'a');
  await state.saveCharacterLorebook('x', moved.entries, fresh.lorebook, { archive: moved.archive });
  const undone = await state.saveCharacterLorebook('x', fresh.lorebook, null);
  assert.deepEqual(undone.lorebook.map((e) => e.id), ['a']);
  assert.deepEqual(undone.lorebookArchive, []);
});

test('compatibilidad: un personaje guardado antes de MEM-016 carga con todo activo y archivo vacío; basura en el archivo se descarta', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  // registro "viejo": sin lorebookArchive
  backend._stores.characters.set('old', { ...baseChar({ id: 'old' }), lorebook: [entry('a', 'Hecho viejo.')], lorebookPrevious: [], lorebookPreviousAt: 0 });
  const old = await state.getCharacter('old');
  assert.deepEqual(old.lorebook.map((e) => e.id), ['a']);
  assert.deepEqual(old.lorebookArchive, []);
  // archivo corrupto / duplicado de uno activo / sin contenido
  backend._stores.characters.set('bad', {
    ...baseChar({ id: 'bad' }),
    lorebook: [entry('a', 'Activo.')],
    lorebookArchive: [null, 'x', { id: 'q' }, { ...entry('a', 'Activo.'), archivedAt: 1 }, { ...entry('k', 'Bueno.'), archivedAt: 2 }, { ...entry('k', 'Bueno.'), archivedAt: 3 }],
  });
  const bad = await state.getCharacter('bad');
  assert.deepEqual(bad.lorebookArchive.map((e) => e.id), ['k']);
});
