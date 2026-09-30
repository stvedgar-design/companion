// tests/mood.test.mjs — MEM-011: "sintiendo …" (heurística sin modelo) y timestamp bajo cada mensaje
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { deriveMood, moodText, moodScores, MOOD_MIN_ACTIVATED, MOOD_MIN_SUPPORT, MOOD_LABELS } from '../www/js/api/mood.js';
import { formatMessageTime, formatMessageFullTime } from '../www/js/msgtime.js';
import { estimateRowHeight } from '../www/js/perf.js';
import { MOOD_CASES, MOOD_CASES_OTHER_PHRASING } from './mood-cases.mjs';

const entry = (content, extra = {}) => ({ id: 'x', keys: [], content, always: false, ...extra });

test('MEM-011 Paso 0: la heurística acierta los 24 casos sintéticos (etiqueta esperada o silencio)', () => {
  assert.ok(MOOD_CASES.length >= 15);
  const wrong = MOOD_CASES.filter((c) => (moodText(c.loreUsed) || null) !== c.expected).map((c) => c.name);
  assert.deepEqual(wrong, []);
});

test('MEM-011 Paso 0: no es genérica ni repetitiva (usa varias etiquetas distintas) y calla cuando no hay una categoría clara', () => {
  const said = MOOD_CASES.map((c) => moodText(c.loreUsed)).filter(Boolean);
  assert.ok(new Set(said).size >= 9, `etiquetas distintas: ${new Set(said).size}`);
  for (const label of said) assert.ok(said.filter((l) => l === label).length <= 4, `la etiqueta "${label}" se repite demasiado`);
  const silent = MOOD_CASES.filter((c) => c.expected === null);
  assert.ok(silent.length >= 6);
  for (const c of silent) assert.equal(moodText(c.loreUsed), '');
});

test('MEM-011 Paso 0 (otro fraseo): cuando habla acierta SIEMPRE; con vocabulario fuera de la tabla se calla en vez de adivinar (cobertura 6/12 medida)', () => {
  let speaks = 0;
  for (const c of MOOD_CASES_OTHER_PHRASING) {
    const got = moodText(c.loreUsed) || null;
    assert.equal(got, c.spoken, c.name); // regresión: lo que responde hoy
    if (got) {
      speaks++;
      assert.equal(got, c.expected, `${c.name}: dijo una emoción distinta de la esperada`);
    }
  }
  assert.equal(speaks, 6);
  assert.equal(MOOD_CASES_OTHER_PHRASING.length, 12);
});

test('MEM-011: solo procede con 3 o más recuerdos activados POR TEMA (los "siempre presentes" no cuentan)', () => {
  assert.equal(MOOD_MIN_ACTIVATED, 3);
  assert.equal(MOOD_MIN_SUPPORT, 2);
  const hug = [entry('Sam hugged Mia.'), entry('Sam kissed Mia goodnight.')];
  assert.equal(deriveMood(hug), null);
  assert.equal(deriveMood([...hug, entry('Sam adores Mia.', { always: true })]), null, 'un "siempre presente" no suma');
  const three = [...hug, entry('Sam loves Mia.')];
  const mood = deriveMood(three);
  assert.equal(mood.id, 'affection');
  assert.equal(mood.label, 'cariño');
  assert.deepEqual([mood.support, mood.total], [3, 3]);
  // con 3 por tema y varios "siempre presentes" de más, sí procede y solo cuentan los de tema
  const withAlways = deriveMood([...three, entry('Sam trusts Mia.', { always: true })]);
  assert.equal(withAlways.total, 3);
});

test('MEM-011: hace falta una categoría respaldada por 2+ recuerdos y estrictamente por más que cualquier otra; un empate no es claro', () => {
  const tie = [entry('Sam hugged Mia.'), entry('Sam cried at the goodbye.'), entry('Sam works at a bakery.')];
  assert.deepEqual(moodScores(tie), { affection: 1, sadness: 1 });
  assert.equal(deriveMood(tie), null);
  const oneOnly = [entry('Sam hugged Mia.'), entry('Sam works at a bakery.'), entry('Sam owns a blue car.')];
  assert.equal(deriveMood(oneOnly), null, 'un solo recuerdo no basta');
  // una entrada cuenta UNA vez por categoría aunque repita palabras
  assert.deepEqual(moodScores([entry('hug hug hug hugged kiss love')]), { affection: 1 });
  // las keys también cuentan
  assert.equal(deriveMood([entry('Sam did it.', { keys: ['hug'] }), entry('Sam did that.', { keys: ['love'] }), entry('Sam did this.')]).id, 'affection');
});

test('MEM-011: normaliza acentos y mayúsculas; no confunde "huge" con "hug" ni "won\'t" con "won" (se probó y falló antes de corregir)', () => {
  assert.equal(moodText([entry('SAM EXTRAÑA a su abuela.'), entry('Sam RECUERDA su infancia.'), entry('Sam cree en la magia.')]), 'sintiendo nostalgia');
  assert.equal(moodScores([entry('a huge house')]).affection, undefined);
  assert.equal(moodScores([entry("Sam won't come")]).pride, undefined);
  assert.equal(moodScores([entry('Sam won a prize')]).pride, 1);
  assert.equal(moodScores([entry('Sam won’t come')]).pride, undefined, 'apóstrofo tipográfico');
  assert.equal(moodScores([entry('Sam can’t wait')]).excitement, 1);
});

test('MEM-011: entradas raras no rompen nada (undefined, no array, nulos, sin texto)', () => {
  for (const bad of [undefined, null, 'x', 5, {}, [], [null, undefined, 3], [{}, {}, {}], [{ content: 5 }, { keys: 'hug' }, {}]]) {
    assert.equal(moodText(bad), '');
    assert.equal(deriveMood(bad), null);
  }
});

test('MEM-011: el texto usa un SUSTANTIVO ("sintiendo cariño"), no un adjetivo con género; todas las etiquetas son distintas', () => {
  assert.equal(new Set(MOOD_LABELS).size, MOOD_LABELS.length);
  assert.ok(MOOD_LABELS.length >= 9);
  for (const c of MOOD_CASES) {
    const t = moodText(c.loreUsed);
    if (t) assert.match(t, /^sintiendo \S+$/);
  }
  assert.ok(!MOOD_LABELS.some((l) => /(ada|ado|osa|oso)$/.test(l)), 'sin adjetivos con marca de género');
});

// ---- timestamp ----

test('MEM-011: el timestamp muestra la hora si es de HOY y la fecha si es de un día anterior (con año solo si es de otro año)', () => {
  const now = new Date(2026, 8, 26, 15, 30).getTime(); // 26 sep 2026, 15:30 (hora local)
  assert.equal(formatMessageTime(new Date(2026, 8, 26, 9, 5).getTime(), now), '09:05');
  assert.equal(formatMessageTime(new Date(2026, 8, 26, 0, 0).getTime(), now), '00:00');
  assert.equal(formatMessageTime(new Date(2026, 8, 25, 23, 59).getTime(), now), '25 sep');
  assert.equal(formatMessageTime(new Date(2026, 0, 3, 12, 0).getTime(), now), '3 ene');
  assert.equal(formatMessageTime(new Date(2025, 11, 31, 22, 0).getTime(), now), '31 dic 2025');
  // mismo día del mes pero de otro mes/año no es "hoy"
  assert.equal(formatMessageTime(new Date(2026, 7, 26, 15, 0).getTime(), now), '26 ago');
  assert.equal(formatMessageTime(new Date(2025, 8, 26, 15, 0).getTime(), now), '26 sep 2025');
  assert.equal(formatMessageFullTime(new Date(2026, 8, 25, 23, 59).getTime()), '25 sep 2026, 23:59');
});

test('MEM-011: sin fecha válida no se muestra nada (mensajes viejos sin `ts`)', () => {
  for (const bad of [undefined, null, 'ayer', NaN, 0, -5, Infinity]) {
    assert.equal(formatMessageTime(bad, Date.now()), '');
    assert.equal(formatMessageFullTime(bad), '');
  }
  assert.equal(formatMessageTime(Date.now(), NaN).length, 5); // `now` inválido → usa el reloj
});

test('MEM-011: la estimación de altura de fila suma la línea del timestamp (20 px) sin cambiar los casos anteriores', () => {
  const base = estimateRowHeight('hola', 32);
  assert.equal(estimateRowHeight('hola', 32, false, true), base + 20);
  assert.equal(estimateRowHeight('hola', 32, true, true), estimateRowHeight('hola', 32, true), 'con la línea de memoria/versiones ya cuenta 34 px');
});

test('MEM-011: chat.js pone el timestamp en TODOS los mensajes con texto y la emoción solo en los del personaje, sin llamar al servidor', () => {
  const src = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(src, /const stampText = m\.text \? formatMessageTime\(m\.ts\) : '';/);
  assert.match(src, /if \(showLore \|\| showVariants \|\| stampText\)/);
  // MEM-015: la palabra elegida por el propio personaje manda; moodText (MEM-011) sigue de respaldo, sin llamar al servidor.
  assert.match(src, /const mood = m\.role === 'char' \? feelingDisplayText\(m\.feeling\) \|\| moodText\(m\.loreUsed\) : '';/);
  const mood = readFileSync(new URL('../www/js/api/mood.js', import.meta.url), 'utf8');
  assert.ok(!/fetch|import /.test(mood), 'mood.js es puro: sin red ni dependencias');
  const css = readFileSync(new URL('../www/css/chat.css', import.meta.url), 'utf8');
  assert.match(css, /\.chat-stamp \{[^}]*font-size: var\(--fs-xs\)/);
});
