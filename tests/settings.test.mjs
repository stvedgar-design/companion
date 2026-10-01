// tests/settings.test.mjs — UI-035: buscador de Ajustes. Solo se prueba la función pura
// (normalizeForSearch); el filtrado en sí vive en el DOM dentro de openSettings() y se verificó a mano
// en el navegador integrado (ver docs/HISTORIAL.md, "UI-035").
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeForSearch } from '../www/js/ui/settings.js';

test('UI-035 normalizeForSearch: minúsculas, sin acentos, sin distinguir mayúsculas', () => {
  assert.equal(normalizeForSearch('PIN'), 'pin');
  assert.equal(normalizeForSearch('Bloqueo con PIN'), 'bloqueo con pin');
  assert.equal(normalizeForSearch('Diagnóstico y rendimiento'), 'diagnostico y rendimiento');
  assert.equal(normalizeForSearch('Protección de datos del sistema'), 'proteccion de datos del sistema');
});

test('UI-035 normalizeForSearch: valores raros nunca lanzan', () => {
  assert.equal(normalizeForSearch(undefined), '');
  assert.equal(normalizeForSearch(null), '');
  assert.equal(normalizeForSearch(''), '');
  assert.equal(normalizeForSearch(42), '42');
});
