import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPinHash, verifyPin } from '../www/js/lock.js';

test('createPinHash genera un hash que verifyPin acepta con el PIN correcto', async () => {
  const { salt, hash } = await createPinHash('1234');
  assert.equal(typeof salt, 'string');
  assert.ok(salt.length > 0);
  assert.equal(typeof hash, 'string');
  assert.ok(await verifyPin('1234', salt, hash));
});

test('verifyPin rechaza un PIN incorrecto o un hash vacío', async () => {
  const { salt, hash } = await createPinHash('1234');
  assert.equal(await verifyPin('9999', salt, hash), false);
  assert.equal(await verifyPin('1234', salt, ''), false);
});

test('createPinHash usa una sal distinta cada vez (hashes distintos para el mismo PIN)', async () => {
  const a = await createPinHash('1234');
  const b = await createPinHash('1234');
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.hash, b.hash);
});
