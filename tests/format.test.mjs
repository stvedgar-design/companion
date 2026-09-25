import { test } from 'node:test';
import assert from 'node:assert/strict';
import { escapeHtml, formatMessage, normalizeCharAsterisks } from '../www/js/ui/format.js';

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

// ---------- FMT-003: normalización visual de asteriscos del PERSONAJE ----------
// Todos los ejemplos son sintéticos y neutros.

const C = { role: 'char' };
const EM = (t) => `<em>${t}</em>`;

const CHAR_CASES = [
  ['número impar a mitad de mensaje (apertura dentro de cursiva abierta)',
    '*Hearing that, warmth fills me. *My eyes close briefly.* Knowing you care makes me smile. *I take a breath.* I will be here.',
    `${EM('Hearing that, warmth fills me.')} ${EM('My eyes close briefly.')} Knowing you care makes me smile. ${EM('I take a breath.')} I will be here.`],
  ['par abierto con nueva apertura tras punto (*A. *B.* C.)',
    '*A. *B.* C.', `${EM('A.')} ${EM('B.')} C.`],
  ['par con nueva apertura tras puntos suspensivos',
    '*Waiting\u2026 *Then I nod.* Okay.', `${EM('Waiting\u2026')} ${EM('Then I nod.')} Okay.`],
  ['envoltura ** ... ** con simples dentro',
    '**The moment is quiet. *I smile softly. *Whispering, I add,* Stay.**',
    `${EM('The moment is quiet.')} ${EM('I smile softly.')} ${EM('Whispering, I add,')} Stay.`],
  ['asterisco suelto al final tras un punto', 'Thank you for everything.*', 'Thank you for everything.'],
  ['asterisco suelto al final tras una acción cerrada',
    '*I nod.* Sure, I can do that.*', `${EM('I nod.')} Sure, I can do that.`],
  ['asterisco suelto al principio (con espacio)', '* I nod. Sure.', ' I nod. Sure.'],
  ['asterisco aislado entre espacios sigue literal', 'It costs 5 * 3 coins.', 'It costs 5 * 3 coins.'],
  ['streaming: cursiva abierta al final', 'Sure. *I lean closer and', `Sure. ${EM('I lean closer and')}`],
  ['streaming: apertura recién escrita sin contenido', 'Sure. *', 'Sure. '],
  ['streaming: par roto mientras llega el texto', '*Hello there. *My eyes', `${EM('Hello there.')} ${EM('My eyes')}`],
  ['texto sin asteriscos', 'Just plain words. Nothing else.', 'Just plain words. Nothing else.'],
  ['formato correcto no cambia', '*I smile.* Hello! *I wave.*', `${EM('I smile.')} Hello! ${EM('I wave.')}`],
  ['** correcto en el personaje se ve como cursiva (sin negritas)', '**hola** amigo', `${EM('hola')} amigo`],
  ['combinación: envoltura ** + suelto al final + salto de línea',
    '**Ok. *Sure.*\nBye.*', `${EM('Ok.')} ${EM('Sure.')}<br>Bye.`],
  ['cierre sin apertura a mitad de texto (número impar)', 'Fine.* Then *I sit.*', `Fine. Then ${EM('I sit.')}`],
];

for (const [name, input, expected] of CHAR_CASES) {
  test(`formatMessage(personaje): ${name}`, () => {
    assert.equal(formatMessage(input, C), expected);
  });
}

test('formatMessage(usuario): el comportamiento no cambia (negritas y asteriscos sueltos)', () => {
  const same = ['Dice **hola** y *sonríe*', 'ok.*', '*A. *B.* C.', 'Ella *sonríe* y luego *se aleja'];
  for (const t of same) {
    assert.equal(formatMessage(t, { role: 'user' }), formatMessage(t));
  }
  assert.equal(formatMessage('Dice **hola**', { role: 'user' }), 'Dice <strong>hola</strong>');
  assert.equal(formatMessage('ok.*', { role: 'user' }), 'ok.*');
});

test('formatMessage(personaje): escapa HTML también tras normalizar', () => {
  assert.equal(formatMessage('<b>*hi. *there.*</b>', C), `&lt;b&gt;${EM('hi.')} ${EM('there.')}&lt;/b&gt;`);
});

test('normalizeCharAsterisks: texto sin asteriscos, vacío o nulo', () => {
  assert.equal(normalizeCharAsterisks('hola'), 'hola');
  assert.equal(normalizeCharAsterisks(''), '');
  assert.equal(normalizeCharAsterisks(null), '');
});

test('formatear NO altera los mensajes guardados (solo visual)', () => {
  const msgs = [
    { role: 'char', text: '*Hearing that. *My eyes close.* Fine.*', ts: 1 },
    { role: 'user', text: 'ok.*', ts: 2 },
  ];
  const before = JSON.stringify(msgs);
  msgs.forEach(Object.freeze);
  Object.freeze(msgs);
  msgs.forEach((m) => formatMessage(m.text, { role: m.role }));
  assert.equal(JSON.stringify(msgs), before);
});

test('rendimiento: 200 mensajes de ~700 caracteres con asteriscos rotos', () => {
  const chunk = '*I tilt my head and smile. *My eyes close briefly.* Knowing you care makes me happy. ';
  const text = chunk.repeat(9).slice(0, 700) + '*';
  const t0 = performance.now();
  for (let i = 0; i < 200; i++) formatMessage(text, C);
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `200 formateos tardaron ${ms.toFixed(1)} ms`);
});

test('rendimiento: texto largo con muchos asteriscos no se degrada (sin retroceso catastrófico)', () => {
  const text = '* a '.repeat(3000) + '*x. *y'.repeat(3000);
  const t0 = performance.now();
  formatMessage(text, C);
  assert.ok(performance.now() - t0 < 500);
});
