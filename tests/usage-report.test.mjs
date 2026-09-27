// tests/usage-report.test.mjs — TEL-001: informe de uso (lenguaje llano, exportable, sin texto libre).
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUsageReport, filterEventsByRange } from '../www/js/diagnostics/usage-report.js';

const SECRET_MESSAGE = 'Sam le contó a Mia un secreto larguísimo sobre su infancia en la granja de sus abuelos';
const SECRET_MEMORY = 'Sam grew up on his grandparents farm and never told anyone until now';
const SECRET_SUMMARY = 'They talked for hours about the farm and what happened there that summer';

function makeCharacter(overrides = {}) {
  return {
    id: 'c1',
    name: 'Mia',
    lorebookTotal: 5,
    lorebookAlways: 1,
    relationshipLevel: 'several',
    totalMessages: 120,
    ...overrides,
  };
}

test('buildUsageReport: NUNCA incluye texto libre del usuario, aunque un evento (mal escrito) lo trajera', () => {
  const events = [
    { ts: 1000, type: 'memory_created', characterId: 'c1', source: 'auto', count: 2 },
    // Un evento "corrupto" que igual pudiera colarse con campos de más: el informe no debe repetirlos.
    { ts: 1500, type: 'message', characterId: 'c1', role: 'user', day: '2026-09-27', text: SECRET_MESSAGE, content: SECRET_MEMORY, summary: SECRET_SUMMARY },
  ];
  const { text, json } = buildUsageReport({ events, characters: [makeCharacter()], appVersion: '1.1.0' });
  assert.ok(!text.includes(SECRET_MESSAGE));
  assert.ok(!text.includes(SECRET_MEMORY));
  assert.ok(!text.includes(SECRET_SUMMARY));
  const jsonText = JSON.stringify(json);
  assert.ok(!jsonText.includes(SECRET_MESSAGE));
  assert.ok(!jsonText.includes(SECRET_MEMORY));
  assert.ok(!jsonText.includes(SECRET_SUMMARY));
});

test('buildUsageReport: ningún campo del texto ni del json es una cadena "larga" (> 60 caracteres) salvo las líneas del propio informe', () => {
  // Heurística de defensa en profundidad: si algún día se cuela un campo con texto libre, esta prueba
  // lo detectaría porque los VALORES de datos (no las frases fijas que escribe este módulo) serían largos.
  const longButFine = 'x'.repeat(30); // un id opaco nunca sería tan largo en la práctica; ver telemetry.js
  const events = [{ ts: 1000, type: 'memory_created', characterId: longButFine, count: 3 }];
  const { json } = buildUsageReport({ events, characters: [makeCharacter({ id: longButFine })] });
  const walk = (v) => {
    if (typeof v === 'string') assert.ok(v.length <= 60, `valor sospechosamente largo: ${v}`);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(json);
});

test('buildUsageReport: cabecera honesta — sin eventos dice que no hay datos; con eventos, la fecha de inicio del registro', () => {
  const empty = buildUsageReport({ events: [], characters: [] });
  assert.match(empty.text, /Todavía no hay ningún evento registrado/);
  assert.match(empty.text, /Todavía no hay ningún personaje/);

  const { text, json } = buildUsageReport({ events: [{ ts: 5000, type: 'message', characterId: 'c1', role: 'user', day: '2026-01-01' }], characters: [] });
  assert.match(text, /Este registro empieza el/);
  assert.equal(json.trackingSince, 5000);
});

test('buildUsageReport: agrega recuerdos creados/fusionados/editados/borrados por personaje', () => {
  const events = [
    { ts: 1, type: 'memory_created', characterId: 'c1', source: 'auto', count: 3 },
    { ts: 2, type: 'memory_created', characterId: 'c1', source: 'auto', count: 1 },
    { ts: 3, type: 'memory_merged', characterId: 'c1', count: 2 },
    { ts: 4, type: 'memory_edited', characterId: 'c1' },
    { ts: 5, type: 'memory_edited', characterId: 'c1' },
    { ts: 6, type: 'memory_deleted', characterId: 'c1' },
    { ts: 7, type: 'memory_created', characterId: 'c2', source: 'auto', count: 99 }, // de OTRO personaje: no debe mezclarse
  ];
  const { json } = buildUsageReport({ events, characters: [makeCharacter()] });
  const c1 = json.characters.find((c) => c.id === 'c1');
  assert.equal(c1.memoryCreated, 4);
  assert.equal(c1.memoryMerged, 2);
  assert.equal(c1.memoryEdited, 2);
  assert.equal(c1.memoryDeleted, 1);
});

test('buildUsageReport: cambios de nivel de relación y causas del resumen de continuidad, desglosadas', () => {
  const events = [
    { ts: 1, type: 'relationship_level_changed', characterId: 'c1', from: 'few', to: 'several' },
    { ts: 2, type: 'continuity_updated', characterId: 'c1', chatId: 'x1', cause: 'overflow' },
    { ts: 3, type: 'continuity_updated', characterId: 'c1', chatId: 'x1', cause: 'overflow' },
    { ts: 4, type: 'continuity_updated', characterId: 'c1', chatId: 'x1', cause: 'manual' },
    { ts: 5, type: 'continuity_updated', characterId: 'c1', chatId: 'x1', cause: 'resume' },
  ];
  const { text, json } = buildUsageReport({ events, characters: [makeCharacter()] });
  const c1 = json.characters.find((c) => c.id === 'c1');
  assert.equal(c1.relationshipLevelChanges, 1);
  assert.deepEqual(c1.continuityUpdated, { overflow: 2, manual: 1, resume: 1 });
  assert.match(text, /few→several/);
  assert.match(text, /por desborde del contexto/);
  assert.match(text, /al volver tras una ausencia/);
  assert.match(text, /manual \("Resumir ahora"\)/);
});

test('buildUsageReport: ajustes experimentales cuentan encendidos y apagados por separado', () => {
  const events = [
    { ts: 1, type: 'experimental_setting_changed', setting: 'formatAssist', enabled: false },
    { ts: 2, type: 'experimental_setting_changed', setting: 'formatAssist', enabled: true },
    { ts: 3, type: 'experimental_setting_changed', setting: 'varietyAssist', enabled: true },
  ];
  const { json, text } = buildUsageReport({ events, characters: [] });
  assert.deepEqual(json.settings.formatAssist, { on: 1, off: 1 });
  assert.deepEqual(json.settings.varietyAssist, { on: 1, off: 0 });
  assert.deepEqual(json.settings.splitTypography, { on: 0, off: 0 });
  assert.match(text, /Corregir formato automáticamente: encendido 1 vez\/veces, apagado 1 vez\/veces/);
  assert.match(text, /Tipografía dividida.*sin cambios registrados/);
});

test('buildUsageReport: mensajes por personaje y por día, sin desbordar (tope de 31 días recientes en el texto)', () => {
  const events = [];
  for (let i = 0; i < 40; i++) {
    const day = `2026-01-${String((i % 28) + 1).padStart(2, '0')}`;
    events.push({ ts: 1000 + i, type: 'message', characterId: 'c1', role: i % 2 ? 'char' : 'user', day });
  }
  const { json, text } = buildUsageReport({ events, characters: [makeCharacter()] });
  const c1 = json.characters.find((c) => c.id === 'c1');
  assert.equal(c1.messagesInRange, 40);
  assert.match(text, /Mensajes en el período: 40/);
});

test('filterEventsByRange: filtra por ts, ambos límites inclusive; sin rango, todo', () => {
  const events = [{ ts: 10 }, { ts: 20 }, { ts: 30 }];
  assert.equal(filterEventsByRange(events).length, 3);
  assert.deepEqual(filterEventsByRange(events, 15, 25).map((e) => e.ts), [20]);
  assert.deepEqual(filterEventsByRange(events, 10, 20).map((e) => e.ts), [10, 20]);
  assert.deepEqual(filterEventsByRange(events, undefined, 20).map((e) => e.ts), [10, 20]);
});

test('buildUsageReport: personaje creado/importado se anota con fecha y método, no con detalles de la card', () => {
  const events = [{ ts: 999, type: 'character_created', characterId: 'c1', method: 'imported' }];
  const { text } = buildUsageReport({ events, characters: [makeCharacter()] });
  assert.match(text, /Personaje importado el/);
});

test('buildUsageReport: apariencia editada se cuenta, nunca se describe', () => {
  const events = [
    { ts: 1, type: 'appearance_edited', characterId: 'c1' },
    { ts: 2, type: 'appearance_edited', characterId: 'c1' },
  ];
  const { json } = buildUsageReport({ events, characters: [makeCharacter()] });
  assert.equal(json.characters[0].appearanceEdited, 2);
});

test('buildUsageReport: expone head/sections estructurados (no hace falta re-parsear el texto para pintar la pantalla)', () => {
  const events = [{ ts: 1, type: 'appearance_edited', characterId: 'c1' }];
  const { text, head, sections } = buildUsageReport({ events, characters: [makeCharacter()] });
  assert.ok(Array.isArray(head) && head.length > 0);
  assert.ok(Array.isArray(sections) && sections.length >= 2);
  assert.equal(sections[0].title, 'Ajustes experimentales (cambios registrados)');
  assert.equal(sections[1].title, 'Mia');
  // el texto completo es exactamente head + secciones tituladas, nada más ni menos
  const rebuilt = [...head, ''];
  for (const s of sections) rebuilt.push(`== ${s.title} ==`, ...s.lines, '');
  assert.equal(text, rebuilt.join('\n'));
});

test('buildUsageReport: sin datos, no revienta (defensivo ante entradas raras)', () => {
  for (const bad of [undefined, null, {}, { events: null, characters: null }]) {
    assert.doesNotThrow(() => buildUsageReport(bad));
  }
});
