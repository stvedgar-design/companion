import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { requestPersistence, getPersistenceResult, describePersistence } from '../www/js/persist.js';

const T = () => 1234;

test('QOL-002: llama a persist() cuando existe y registra "granted"', async () => {
  let calls = 0;
  const r = await requestPersistence({ persist: async () => { calls++; return true; }, persisted: async () => false }, T);
  assert.deepEqual(r, { status: 'granted', at: 1234 });
  assert.equal(calls, 1);
  assert.equal(getPersistenceResult(), r);
});

test('QOL-002: si Android la niega queda "denied" (sin error ni excepción)', async () => {
  const r = await requestPersistence({ persist: async () => false, persisted: async () => false }, T);
  assert.equal(r.status, 'denied');
});

test('QOL-002: si ya estaba concedida no vuelve a pedirla', async () => {
  let calls = 0;
  const r = await requestPersistence({ persist: async () => { calls++; return true; }, persisted: async () => true }, T);
  assert.equal(r.status, 'granted');
  assert.equal(r.alreadyPersisted, true);
  assert.equal(calls, 0);
});

test('QOL-002: sin la API (storage ausente o sin persist) la app sigue igual: "unsupported", sin errores', async () => {
  assert.equal((await requestPersistence(undefined, T)).status, 'unsupported');
  assert.equal((await requestPersistence(null, T)).status, 'unsupported');
  assert.equal((await requestPersistence({}, T)).status, 'unsupported');
  assert.equal((await requestPersistence({ persist: 'no soy función' }, T)).status, 'unsupported');
});

test('QOL-002: si persist() lanza o rechaza, se registra "error" y NO se propaga', async () => {
  const r1 = await requestPersistence({ persist: async () => { throw new Error('boom'); } }, T);
  assert.equal(r1.status, 'error');
  assert.equal(r1.error, 'boom');
  const r2 = await requestPersistence({ persist: () => { throw new Error('síncrono'); } }, T);
  assert.equal(r2.status, 'error');
  const r3 = await requestPersistence({ persist: async () => true, persisted: async () => { throw new Error('x'); } }, T);
  assert.equal(r3.status, 'error');
});

test('QOL-002: describePersistence da una frase llana para cada estado', () => {
  for (const s of ['granted', 'denied', 'unsupported', 'error']) assert.match(describePersistence({ status: s, at: 1 }), /^Protección de datos del sistema: /);
  assert.match(describePersistence(null), /todavía no comprobada/);
});

test('QOL-002: el arranque la pide sin esperar (no hay await antes de que empiece el resto del boot)', () => {
  const main = readFileSync(new URL('../www/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /^\s*requestPersistence\(/m);
  assert.ok(!/await requestPersistence/.test(main));
});
