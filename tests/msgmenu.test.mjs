import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MESSAGE_ACTIONS, availableMessageActions, revealDelta, shouldCloseOnScroll, SCROLL_CLOSE_THRESHOLD_PX, REVEAL_MARGIN_PX,
} from '../www/js/ui/msgmenu.js';

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

test('UI-016: revealDelta — si el menú ya se ve entero no mueve nada', () => {
  assert.equal(revealDelta({ top: 300, bottom: 344 }, { top: 60, bottom: 747 }), 0);
});

test('UI-016: revealDelta — el menú del último mensaje (bajo el borde) baja la lista lo justo, con margen', () => {
  // Caso real medido: menú en y=731..775 con la lista visible hasta 747 (dato sintético).
  const d = revealDelta({ top: 731, bottom: 775 }, { top: 60, bottom: 747 });
  assert.equal(d, 775 + REVEAL_MARGIN_PX - 747);
  assert.ok(d > 0);
});

test('UI-016: revealDelta — un menú por encima del borde superior sube la lista', () => {
  const d = revealDelta({ top: 40, bottom: 84 }, { top: 60, bottom: 747 });
  assert.equal(d, 40 - REVEAL_MARGIN_PX - 60);
  assert.ok(d < 0);
});

test('UI-016: revealDelta — si el menú es más alto que la zona visible, gana la parte de arriba', () => {
  const d = revealDelta({ top: 100, bottom: 900 }, { top: 60, bottom: 400 });
  assert.equal(d, 100 - REVEAL_MARGIN_PX - 60); // sube el borde superior hasta el margen, no más
  assert.equal(revealDelta({ top: 68, bottom: 900 }, { top: 60, bottom: 400 }), 0);
});

test('UI-016: shouldCloseOnScroll — sin menú abierto nunca cierra', () => {
  assert.equal(shouldCloseOnScroll({ open: false, scrollTop: 900, openScrollTop: 0 }), false);
});

test('UI-016: shouldCloseOnScroll — el ajuste al abrir y un temblor del dedo no cierran; alejarse sí', () => {
  assert.equal(shouldCloseOnScroll({ open: true, scrollTop: 1000, openScrollTop: 1000 }), false);
  assert.equal(shouldCloseOnScroll({ open: true, scrollTop: 1000 + SCROLL_CLOSE_THRESHOLD_PX, openScrollTop: 1000 }), false);
  assert.equal(shouldCloseOnScroll({ open: true, scrollTop: 1000 + SCROLL_CLOSE_THRESHOLD_PX + 1, openScrollTop: 1000 }), true);
  assert.equal(shouldCloseOnScroll({ open: true, scrollTop: 900, openScrollTop: 1000 }), true);
});
