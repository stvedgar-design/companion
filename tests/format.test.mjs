import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatMessage } from '../www/js/ui/format.js';

test('escapeHtml escapa < > & y comillas', () => {
  assert.equal(
    escapeHtml('<script>alert("hi")</script> & \'ok\''),
    '&lt;script&gt;alert(&quot;hi&quot;)&lt;/script&gt; &amp; &#39;ok&#39;'
  );
});

test('escapeHtml con texto vacío o nulo', () => {
  assert.equal(escapeHtml(''), '');
  assert.equal(escapeHtml(undefined), '');
  assert.equal(escapeHtml(null), '');
});

test('formatMessage: cursiva simple', () => {
  assert.equal(formatMessage('*sonríe*'), '<em>sonríe</em>');
});

test('formatMessage: negrita simple', () => {
  assert.equal(formatMessage('**hola**'), '<strong>hola</strong>');
});

test('formatMessage: mezcla de negrita y cursiva', () => {
  assert.equal(
    formatMessage('Dice **hola** y *sonríe* despacio'),
    'Dice <strong>hola</strong> y <em>sonríe</em> despacio'
  );
});

test('formatMessage: asterisco sin cerrar al final (streaming)', () => {
  assert.equal(
    formatMessage('Ella se acerca. *mira alrededor'),
    'Ella se acerca. <em>mira alrededor</em>'
  );
});

test('formatMessage: asteriscos sueltos no rompen el resto del texto', () => {
  assert.equal(formatMessage('5 * 3 son 15'), '5 * 3 son 15');
});

test('formatMessage: texto vacío', () => {
  assert.equal(formatMessage(''), '');
});

test('formatMessage: saltos de línea', () => {
  assert.equal(formatMessage('línea uno\nlínea dos'), 'línea uno<br>línea dos');
});

test('formatMessage: escapa HTML antes de aplicar formato', () => {
  assert.equal(
    formatMessage('<b>*ataca*</b> & gana'),
    '&lt;b&gt;<em>ataca</em>&lt;/b&gt; &amp; gana'
  );
});

test('formatMessage: par de cursiva seguido de asterisco sin cerrar', () => {
  assert.equal(
    formatMessage('Ella *sonríe* y luego *se aleja'),
    'Ella <em>sonríe</em> y luego <em>se aleja</em>'
  );
});
