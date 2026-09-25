import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MESSAGE_ACTIONS, availableMessageActions } from '../www/js/ui/msgmenu.js';

test('UI-006: las acciones y su orden son los de siempre', () => {
  assert.deepEqual(MESSAGE_ACTIONS.map((a) => [a.id, a.label]), [
    ['edit', 'Editar'], ['delete', 'Borrar'], ['copy', 'Copiar'], ['regenerate', 'Regenerar'],
  ]);
});

test('UI-006: Editar, Borrar y Copiar siempre; Regenerar solo en el último mensaje del personaje', () => {
  const base = ['edit', 'delete', 'copy'];
  assert.deepEqual(availableMessageActions({ role: 'char', isLast: true }), [...base, 'regenerate']);
  assert.deepEqual(availableMessageActions({ role: 'char', isLast: false }), base);
  assert.deepEqual(availableMessageActions({ role: 'user', isLast: true }), base);
  assert.deepEqual(availableMessageActions({ role: 'user', isLast: false }), base);
});

test('UI-006: con una respuesta en curso no hay menú', () => {
  assert.deepEqual(availableMessageActions({ role: 'char', isLast: true, busy: true }), []);
  assert.deepEqual(availableMessageActions({ role: 'user', isLast: false, busy: true }), []);
});

test('UI-006: las condiciones coinciden con las del código anterior (regenerar = último && personaje)', () => {
  // Réplica de la condición que tenía buildMessageRow: `isLast && m.role === 'char'`.
  for (const role of ['user', 'char']) for (const isLast of [true, false]) {
    const old = isLast && role === 'char';
    assert.equal(availableMessageActions({ role, isLast }).includes('regenerate'), old);
  }
});
