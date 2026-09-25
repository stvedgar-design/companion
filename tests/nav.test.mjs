import { test } from 'node:test';
import assert from 'node:assert/strict';
import { continueTarget, decideBack, ROOT_VIEWS } from '../www/js/nav.js';

test('continueTarget: con varios chats abre el de `updated` más reciente', () => {
  const chats = [
    { id: 'a', updated: 100 },
    { id: 'b', updated: 300 },
    { id: 'c', updated: 200 },
  ];
  assert.deepEqual(continueTarget('mia', chats), { view: 'chat', params: { chatId: 'b' } });
});

test('continueTarget: con un solo chat abre ese chat', () => {
  assert.deepEqual(continueTarget('mia', [{ id: 'solo', updated: 5 }]), { view: 'chat', params: { chatId: 'solo' } });
  assert.deepEqual(continueTarget('mia', [{ id: 'sin-fecha' }]), { view: 'chat', params: { chatId: 'sin-fecha' } });
});

test('continueTarget: sin chats (o sin datos) cae en la lista de chats, que crea uno', () => {
  const expected = { view: 'chats', params: { characterId: 'mia' } };
  assert.deepEqual(continueTarget('mia', []), expected);
  assert.deepEqual(continueTarget('mia', undefined), expected);
  assert.deepEqual(continueTarget('mia', [null, {}]), expected);
});

test('continueTarget: con empate de fechas conserva el primero de la lista (ya ordenada por listChats)', () => {
  const chats = [{ id: 'x', updated: 9 }, { id: 'y', updated: 9 }];
  assert.equal(continueTarget('mia', chats).params.chatId, 'x');
});

test('decideBack: una hoja o diálogo abierto se cierra primero, en cualquier vista', () => {
  for (const view of ['home', 'chats', 'chat', 'setup', null]) {
    assert.equal(decideBack({ sheetOpen: true, view }), 'close-sheet');
  }
});

test('decideBack: en chat y en la lista de chats retrocede una pantalla', () => {
  assert.equal(decideBack({ sheetOpen: false, view: 'chat' }), 'back');
  assert.equal(decideBack({ sheetOpen: false, view: 'chats' }), 'back');
});

test('decideBack: en la raíz (hub o configuración inicial) o sin vista activa (PIN) sale de la app', () => {
  assert.deepEqual(ROOT_VIEWS, ['home', 'setup']);
  assert.equal(decideBack({ sheetOpen: false, view: 'home' }), 'exit');
  assert.equal(decideBack({ sheetOpen: false, view: 'setup' }), 'exit');
  assert.equal(decideBack({ sheetOpen: false, view: null }), 'exit');
});
