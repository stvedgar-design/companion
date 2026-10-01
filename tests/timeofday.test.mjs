import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayPart, timeOfDayNote } from '../www/js/api/timeofday.js';
import { buildPlainPrompt, buildChatMessages, historyStartIndex, TIME_RESERVE_CHARS } from '../www/js/api/prompt.js';
import { generateReply } from '../www/js/api/kobold.js';
import http from 'node:http';

// Fechas con hora LOCAL (el constructor con componentes usa la zona del dispositivo).
const at = (y, mo, d, h, mi = 0) => new Date(y, mo - 1, d, h, mi);

test('dayPart: límites de las franjas', () => {
  assert.equal(dayPart(0), 'small-hours');
  assert.equal(dayPart(4), 'small-hours');
  assert.equal(dayPart(5), 'morning');
  assert.equal(dayPart(11), 'morning');
  assert.equal(dayPart(12), 'afternoon');
  assert.equal(dayPart(18), 'afternoon');
  assert.equal(dayPart(19), 'night');
  assert.equal(dayPart(23), 'night');
});

test('timeOfDayNote usa día y franja, y la madrugada no lleva día', () => {
  assert.equal(timeOfDayNote(at(2026, 9, 29, 9)), 'It is a Tuesday morning.'); // 2026-09-29 es martes
  assert.equal(timeOfDayNote(at(2026, 10, 3, 15)), 'It is a Saturday afternoon.');
  assert.equal(timeOfDayNote(at(2026, 9, 29, 22)), 'It is Tuesday night.');
  assert.equal(timeOfDayNote(at(2026, 9, 29, 3)), 'It is the middle of the night, very late.');
});

test('timeOfDayNote nunca incluye hora ni minutos en formato de reloj', () => {
  for (let h = 0; h < 24; h++) {
    for (const mi of [0, 7, 59]) {
      const note = timeOfDayNote(at(2026, 9, 29, h, mi));
      assert.ok(!/\d/.test(note), `"${note}" tiene dígitos`);
      assert.ok(!/[ap]\.?m\b/i.test(note));
    }
  }
});

test('timeOfDayNote con fecha inválida devuelve vacío', () => {
  assert.equal(timeOfDayNote(new Date('nope')), '');
});

const card = { name: 'Luna', description: 'd', personality: 'p', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
const settings = { user: 'Edgar', maxLen: 220, ctx: 4096, mode: 'plain' };
const msgs = [{ role: 'char', text: 'Hola', ts: 1 }, { role: 'user', text: 'Buenas', ts: 2 }];

test('plain: la línea de la hora va al final del bloque final, antes de la última línea del usuario', () => {
  const t = 'It is a Tuesday morning.';
  const { prompt } = buildPlainPrompt(card, msgs, settings, '', '', 'tema', 'variedad', false, { continuity: 'cont', timeOfDay: t });
  const i = prompt.indexOf(`[${t}]`);
  assert.ok(i > prompt.indexOf('[variedad]'), 'después de la nota de variedad');
  assert.ok(i > prompt.indexOf('[tema]'));
  assert.ok(i < prompt.indexOf('Edgar: Buenas'));
  assert.ok(prompt.indexOf('Luna\'s description') < i, 'después de la cabecera cacheable');
});

test('chat: la línea de la hora va al final del bloque, al frente del último mensaje del usuario', () => {
  const t = 'It is Tuesday night.';
  const { messages } = buildChatMessages(card, msgs, { ...settings, mode: 'chat' }, '', '', 'tema', '', false, { timeOfDay: t });
  const last = messages[messages.length - 1];
  assert.equal(last.role, 'user');
  assert.equal(last.content, `[tema]\n[${t}]\n\nBuenas`);
  assert.ok(!messages[0].content.includes(t), 'la cabecera (system) no la lleva');
});

test('sin timeOfDay el prompt es idéntico al de antes', () => {
  const a = buildPlainPrompt(card, msgs, settings, '', '', '', '', false, {});
  const b = buildPlainPrompt(card, msgs, settings, '', '', '', '', false, { timeOfDay: '' });
  assert.deepEqual(a, b);
  assert.ok(!a.prompt.includes('It is'));
});

test('la ventana del historial no se mueve entre franjas (reserva fija)', () => {
  const long = Array.from({ length: 200 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: 'palabra '.repeat(25) + i, ts: i }));
  const variants = ['It is a Wednesday afternoon.', 'It is the middle of the night, very late.', 'It is Saturday night.', 'It is a Monday morning.'];
  const firsts = variants.map((t) => {
    const { messages } = buildChatMessages(card, long, { ...settings, mode: 'chat' }, '', '', '', '', false, { timeOfDay: t });
    return messages.find((m) => m.role !== 'system' && m.content !== '[Start of roleplay]').content.slice(0, 40);
  });
  assert.equal(new Set(firsts).size, 1);
  for (const t of variants) assert.ok(t.length + 3 <= TIME_RESERVE_CHARS);
  // y historyStartIndex con withTime refleja la misma ventana
  const plainFirsts = variants.map((t) => buildPlainPrompt(card, long, settings, '', '', '', '', false, { timeOfDay: t }).prompt.length);
  const kept = (n) => long.length - n;
  const idx = historyStartIndex(card, long, settings, '', '', 0, 0, null, null, true);
  const promptKept = buildPlainPrompt(card, long, settings, '', '', '', '', false, { timeOfDay: variants[0] }).prompt.split('\n').filter((l) => /^(Edgar|Luna): /.test(l)).length;
  assert.equal(kept(idx), promptKept);
  assert.ok(plainFirsts.length);
});

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(`http://127.0.0.1:${server.address().port}`)));
}

test('generateReply manda la hora local del dispositivo al final (modo chat y plain)', async () => {
  for (const mode of ['chat', 'plain']) {
    let seen = null;
    const server = http.createServer((req, res) => {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        seen = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        res.write(mode === 'chat' ? 'data: {"choices":[{"delta":{"content":"Hola"}}]}\n\ndata: [DONE]\n\n' : 'data: {"token":"Hola"}\n\n');
        res.end();
      });
    });
    const base = await listen(server);
    try {
      await generateReply({
        character: { id: 'c', name: 'Luna', card },
        messages: [{ role: 'user', text: 'Buenas', ts: 1 }],
        settings: { ...settings, url: base, mode },
        now: at(2026, 9, 29, 22)
      });
      const text = mode === 'chat' ? seen.messages.map((m) => m.content).join('\n') : seen.prompt;
      assert.ok(text.includes('[It is Tuesday night.]'), mode);
      assert.ok(!/\b\d{1,2}:\d{2}\b/.test('[It is Tuesday night.]'));
    } finally {
      server.close();
    }
  }
});
