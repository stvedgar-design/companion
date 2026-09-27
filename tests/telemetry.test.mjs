// tests/telemetry.test.mjs — TEL-001: registro de eventos de uso, local y privado.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTelemetry, sanitizeEventData, TEL_EVENTS } from '../www/js/telemetry.js';

function memoryBackend() {
  const rows = [];
  return {
    async add(value) { rows.push(value); },
    async getAll() { return rows.slice(); },
    _rows: rows,
  };
}

test('sanitizeEventData: solo números finitos, booleanos y cadenas cortas; descarta el resto', () => {
  assert.deepEqual(sanitizeEventData(undefined), {});
  assert.deepEqual(sanitizeEventData(null), {});
  assert.deepEqual(sanitizeEventData('texto'), {});
  assert.deepEqual(sanitizeEventData(42), {});
  assert.deepEqual(
    sanitizeEventData({ count: 3, enabled: true, characterId: 'c123', bad: { nested: 1 }, arr: [1, 2], fn: () => {}, inf: Infinity, nan: NaN }),
    { count: 3, enabled: true, characterId: 'c123' }
  );
  const long = sanitizeEventData({ note: 'x'.repeat(500) });
  assert.equal(long.note.length, 40, 'una cadena larga se recorta, nunca pasa completa');
});

test('logEvent: guarda ts + type + datos saneados; nunca lanza con tipo inválido', async () => {
  const backend = memoryBackend();
  const tel = createTelemetry(backend);
  const before = Date.now();
  await tel.logEvent(TEL_EVENTS.MEMORY_CREATED, { characterId: 'c1', source: 'auto', count: 2 });
  assert.equal(backend._rows.length, 1);
  const row = backend._rows[0];
  assert.equal(row.type, 'memory_created');
  assert.ok(row.ts >= before);
  assert.equal(row.characterId, 'c1');
  assert.equal(row.source, 'auto');
  assert.equal(row.count, 2);

  await tel.logEvent('', { x: 1 });
  await tel.logEvent(undefined, { x: 1 });
  await tel.logEvent(null, { x: 1 });
  assert.equal(backend._rows.length, 1, 'un tipo inválido no agrega nada');
});

test('logEvent: si el backend falla, no lanza (mejor esfuerzo)', async () => {
  const tel = createTelemetry({ async add() { throw new Error('boom'); }, async getAll() { throw new Error('boom'); } });
  await assert.doesNotReject(() => tel.logEvent(TEL_EVENTS.MESSAGE, { characterId: 'c1' }));
  await assert.doesNotReject(async () => assert.deepEqual(await tel.listEvents(), []));
});

test('listEvents: devuelve todo lo guardado, en orden de inserción; nunca lanza', async () => {
  const backend = memoryBackend();
  const tel = createTelemetry(backend);
  await tel.logEvent(TEL_EVENTS.MEMORY_CREATED, { characterId: 'c1' });
  await tel.logEvent(TEL_EVENTS.MEMORY_DELETED, { characterId: 'c1' });
  const all = await tel.listEvents();
  assert.equal(all.length, 2);
  assert.deepEqual(all.map((e) => e.type), ['memory_created', 'memory_deleted']);
});

test('TEL_EVENTS: un tipo por evento del contrato, todos strings distintos', () => {
  const values = Object.values(TEL_EVENTS);
  assert.equal(new Set(values).size, values.length);
  for (const v of values) assert.equal(typeof v, 'string');
});

test('createIndexedDbTelemetryBackend/logEvent/listEvents por defecto: no lanzan al importar el módulo sin IndexedDB (Node)', async () => {
  const mod = await import('../www/js/telemetry.js');
  await assert.doesNotReject(() => mod.logEvent(TEL_EVENTS.MESSAGE, { characterId: 'c1' }));
  await assert.doesNotReject(() => mod.listEvents());
});
