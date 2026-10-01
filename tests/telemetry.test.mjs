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
  assert.deepEqual(sanitizeEventData({ role: 'x'.repeat(500) }), {}, 'una cadena larga se descarta, no se recorta');
  assert.deepEqual(sanitizeEventData({ cause: 'una frase con espacios' }), {}, 'una frase (con espacios) nunca pasa');
  assert.deepEqual(sanitizeEventData({ text: 'hola', content: 'hola', summary: 'hola' }), {}, 'un campo desconocido se descarta aunque sea corto');
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

test('TEL-002: un evento de reply_time guarda tiempos numéricos y descarta cualquier texto largo', async () => {
  const backend = memoryBackend();
  const tel = createTelemetry(backend);
  await tel.logEvent(TEL_EVENTS.REPLY_TIME, { characterId: 'c1', ttftMs: 350, totalMs: 1800, chars: 240, text: { oops: 'x' } });
  const row = backend._rows[0];
  assert.equal(row.type, 'reply_time');
  assert.equal(row.totalMs, 1800);
  assert.equal(row.text, undefined);
});

test('TEL-002: exportar no saca nada de la base: los eventos exportados son exactamente los guardados, sin texto libre', async () => {
  const backend = memoryBackend();
  const tel = createTelemetry(backend);
  await tel.logEvent(TEL_EVENTS.MESSAGE, { characterId: 'c1', role: 'user', day: '2026-10-01', content: 'x'.repeat(200) });
  const [e] = await tel.listEvents();
  assert.equal(e.content, undefined);
  assert.ok(Object.values(e).every((v) => typeof v === 'number' || typeof v === 'boolean' || (typeof v === 'string' && /^[\w.:-]+$/.test(v))));
});
