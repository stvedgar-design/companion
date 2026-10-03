// www/js/diagnostics/usage-report.js
// TEL-001: arma el informe de uso a partir de los eventos de telemetry.js. Puro (sin DOM ni
// almacenamiento, como el resto de `diagnostics/`; ver `diagnostics/plan.js` para el mismo patrón de
// "informe en lenguaje llano, {text, json}"), así se prueba sin abrir la app.
//
// Regla dura, verificada con un test: el informe NUNCA lleva texto libre del usuario — solo números,
// categorías fijas (tipo de evento, causa, nivel de relación, nombre de ajuste) y fechas. El nombre del
// personaje SÍ se muestra (para que el informe se pueda leer), pero nunca el contenido de sus recuerdos,
// resúmenes, mensajes o card.

// TEL-002: el nivel de relación usa la escala vigente de MEM-014 (`early`/`growing`/`established`); este
// módulo solo la nombra en lenguaje llano, no la calcula (el cálculo vive en api/relationship.js).
const LEVEL_LABELS = {
  early: 'nos estamos conociendo (menos de 30 recuerdos)',
  growing: 'la relación va creciendo (30 a 79 recuerdos)',
  established: 'relación establecida (80 recuerdos o más)',
};

function fmtDate(ts) {
  return Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '?';
}

function countBy(events, keyFn) {
  const out = {};
  for (const e of events) {
    const k = keyFn(e);
    if (k == null) continue;
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

function sumField(events, field) {
  return events.reduce((total, e) => total + (Number.isFinite(e[field]) ? e[field] : 0), 0);
}

const SETTING_LABELS = {
  formatAssist: 'Corregir formato automáticamente',
  varietyAssist: 'Ayuda a que las respuestas no se repitan',
  personalityAdapts: 'Personalidad que se adapta a la escena',
  humanTouch: 'Detalles de presencia humana',
  emotionResponse: 'Reaccionar a cómo te sientes',
  momentMemories: 'Recordar momentos emocionales',
  followUps: 'Acordarse de lo que viene y de las fechas',
  splitTypography: 'Tipografía dividida (narración/diálogo)',
  continuityAuto: 'Resumen de continuidad automático',
};

const CAUSE_LABELS = {
  overflow: 'por desborde del contexto',
  resume: 'al volver tras una ausencia',
  manual: 'manual ("Resumir ahora")',
};

/**
 * Filtra eventos al rango [from, to] (ms, ambos inclusive); sin rango, todos.
 * @param {object[]} events
 * @param {number} [from]
 * @param {number} [to]
 */
export function filterEventsByRange(events, from, to) {
  const list = Array.isArray(events) ? events : [];
  return list.filter((e) => e && Number.isFinite(e.ts) && (!Number.isFinite(from) || e.ts >= from) && (!Number.isFinite(to) || e.ts <= to));
}

/**
 * Arma la sección de un personaje: sus eventos + su "estado actual" (recuerdos, relación, mensajes).
 * @param {{ id: string, name: string, lorebookTotal: number, lorebookAlways: number, relationshipLevel: 'early'|'growing'|'established', totalMessages: number }} character
 * @param {object[]} events  YA filtrados por rango de fechas
 * @returns {{ title: string, lines: string[] }}
 */
function characterSection(character, events) {
  const mine = events.filter((e) => e.characterId === character.id);
  const lines = [];
  lines.push(`Recuerdos actuales: ${character.lorebookTotal} (${character.lorebookAlways} "siempre presentes").`);
  lines.push(`Estado de la relación actual: ${LEVEL_LABELS[character.relationshipLevel] || LEVEL_LABELS.early}`);
  lines.push(`Mensajes totales (de siempre, en todos sus chats): ${character.totalMessages}.`);

  const created = mine.filter((e) => e.type === 'character_created')[0];
  if (created) lines.push(`Personaje ${created.method === 'imported' ? 'importado' : 'creado con el creador guiado'} el ${fmtDate(created.ts)}.`);

  lines.push('', 'Desde que se empezó a registrar:');

  const memCreated = mine.filter((e) => e.type === 'memory_created');
  const memMerged = mine.filter((e) => e.type === 'memory_merged');
  const memEdited = mine.filter((e) => e.type === 'memory_edited').length;
  const memDeleted = mine.filter((e) => e.type === 'memory_deleted').length;
  lines.push(`- Recuerdos creados automáticamente: ${sumField(memCreated, 'count')} (en ${memCreated.length} actualizaciones de memoria).`);
  lines.push(`- Recuerdos fusionados: ${sumField(memMerged, 'count')} (en ${memMerged.length} actualizaciones o limpiezas).`);
  lines.push(`- Recuerdos editados a mano: ${memEdited}.`);
  const memArchived = mine.filter((e) => e.type === 'memory_archived').length;
  const memRestored = mine.filter((e) => e.type === 'memory_restored').length;
  lines.push(`- Recuerdos archivados: ${memArchived} (restaurados: ${memRestored}).`);
  lines.push(`- Recuerdos borrados para siempre: ${memDeleted}.`);

  const levelChanges = mine.filter((e) => e.type === 'relationship_level_changed');
  if (levelChanges.length) {
    lines.push(`- Cambios de nivel de relación: ${levelChanges.length} (` + levelChanges.map((e) => `${e.from}→${e.to}`).join(', ') + ').');
  } else {
    lines.push('- Cambios de nivel de relación: 0.');
  }

  const continuityByCause = countBy(mine.filter((e) => e.type === 'continuity_updated'), (e) => e.cause);
  const continuityTotal = Object.values(continuityByCause).reduce((a, b) => a + b, 0);
  if (continuityTotal) {
    const parts = Object.entries(continuityByCause).map(([cause, n]) => `${n} ${CAUSE_LABELS[cause] || cause}`);
    lines.push(`- Resumen de continuidad actualizado: ${continuityTotal} veces (${parts.join(', ')}).`);
  } else {
    lines.push('- Resumen de continuidad actualizado: 0 veces.');
  }

  const appearanceEdits = mine.filter((e) => e.type === 'appearance_edited').length;
  lines.push(`- Apariencia editada: ${appearanceEdits} veces.`);

  const replies = mine.filter((e) => e.type === 'reply_time' && Number.isFinite(e.totalMs));
  if (replies.length) {
    const avg = (field) => Math.round(sumField(replies, field) / replies.length);
    lines.push(`- Respuestas medidas: ${replies.length}; tarda en empezar ${avg('ttftMs')} ms y en terminar ${avg('totalMs')} ms, en promedio.`);
  } else {
    lines.push('- Respuestas medidas: 0.');
  }

  const msgs = mine.filter((e) => e.type === 'message');
  const byDay = countBy(msgs, (e) => e.day);
  const days = Object.keys(byDay).sort();
  lines.push(`- Mensajes en el período: ${msgs.length} (${days.length} día${days.length === 1 ? '' : 's'} con actividad).`);
  if (days.length) {
    const recent = days.slice(-31); // no crece sin límite si el registro lleva mucho tiempo activo
    lines.push('  ' + recent.map((d) => `${d}: ${byDay[d]}`).join(' · '));
  }

  return { title: character.name, lines };
}

/**
 * Informe completo de uso. Nunca incluye texto libre del usuario (mensajes, recuerdos, resúmenes, cards):
 * solo números, categorías fijas y fechas.
 * @param {{
 *   events: object[],
 *   characters: { id: string, name: string, lorebookTotal: number, lorebookAlways: number, relationshipLevel: string, totalMessages: number }[],
 *   generatedAt?: number,
 *   from?: number,
 *   to?: number,
 *   appVersion?: string,
 * }} data
 * @returns {{ text: string, json: object }}
 */
export function buildUsageReport(raw) {
  const data = raw && typeof raw === 'object' ? raw : {};
  const generatedAt = Number.isFinite(data.generatedAt) ? data.generatedAt : Date.now();
  const allEvents = Array.isArray(data.events) ? data.events.filter((e) => e && typeof e.type === 'string' && Number.isFinite(e.ts)) : [];
  const trackingSince = allEvents.reduce((min, e) => (min === null || e.ts < min ? e.ts : min), null);
  const events = filterEventsByRange(allEvents, data.from, data.to);
  const characters = Array.isArray(data.characters) ? data.characters : [];

  const head = [
    `INFORME DE USO — Companion v${data.appVersion || '?'}`,
    `Generado ${fmtDate(generatedAt)}`,
    trackingSince
      ? `Este registro empieza el ${fmtDate(trackingSince)}: no hay datos de antes de esa fecha (no se puede reconstruir el historial previo).`
      : 'Todavía no hay ningún evento registrado.',
    Number.isFinite(data.from) || Number.isFinite(data.to)
      ? `Rango del informe: ${data.from ? fmtDate(data.from) : 'el principio'} a ${data.to ? fmtDate(data.to) : 'ahora'}.`
      : 'Rango del informe: desde que se empezó a registrar hasta ahora.',
    'Este informe solo trae números, categorías y fechas: nunca el texto de tus mensajes, recuerdos, resúmenes o cards.',
  ];

  const settingsEvents = events.filter((e) => e.type === 'experimental_setting_changed');
  const settingsLines = [];
  for (const key of Object.keys(SETTING_LABELS)) {
    const mine = settingsEvents.filter((e) => e.setting === key);
    if (!mine.length) {
      settingsLines.push(`${SETTING_LABELS[key]}: sin cambios registrados.`);
      continue;
    }
    const on = mine.filter((e) => e.enabled === true).length;
    const off = mine.filter((e) => e.enabled === false).length;
    settingsLines.push(`${SETTING_LABELS[key]}: encendido ${on} vez/veces, apagado ${off} vez/veces.`);
  }

  const characterSections = characters.map((c) => characterSection(c, events));
  const sections = [
    { title: 'Ajustes experimentales (cambios registrados)', lines: settingsLines },
    ...characterSections,
    ...(characters.length ? [] : [{ title: 'Personajes', lines: ['Todavía no hay ningún personaje.'] }]),
  ];

  const out = [...head, ''];
  for (const s of sections) out.push(`== ${s.title} ==`, ...s.lines, '');

  return {
    text: out.join('\n'),
    head,
    sections,
    json: {
      app: 'companion-usage-report',
      generatedAt,
      trackingSince,
      range: { from: data.from ?? null, to: data.to ?? null },
      settings: Object.fromEntries(
        Object.keys(SETTING_LABELS).map((key) => {
          const mine = settingsEvents.filter((e) => e.setting === key);
          return [key, { on: mine.filter((e) => e.enabled === true).length, off: mine.filter((e) => e.enabled === false).length }];
        })
      ),
      characters: characters.map((c) => {
        const mine = events.filter((e) => e.characterId === c.id);
        return {
          id: c.id,
          name: c.name,
          lorebookTotal: c.lorebookTotal,
          lorebookAlways: c.lorebookAlways,
          relationshipLevel: c.relationshipLevel,
          totalMessages: c.totalMessages,
          memoryCreated: sumField(mine.filter((e) => e.type === 'memory_created'), 'count'),
          memoryMerged: sumField(mine.filter((e) => e.type === 'memory_merged'), 'count'),
          memoryEdited: mine.filter((e) => e.type === 'memory_edited').length,
          memoryArchived: mine.filter((e) => e.type === 'memory_archived').length,
          memoryRestored: mine.filter((e) => e.type === 'memory_restored').length,
          memoryDeleted: mine.filter((e) => e.type === 'memory_deleted').length,
          relationshipLevelChanges: mine.filter((e) => e.type === 'relationship_level_changed').length,
          continuityUpdated: countBy(mine.filter((e) => e.type === 'continuity_updated'), (e) => e.cause),
          appearanceEdited: mine.filter((e) => e.type === 'appearance_edited').length,
          repliesMeasured: mine.filter((e) => e.type === 'reply_time' && Number.isFinite(e.totalMs)).length,
          avgReplyTotalMs: (() => {
            const r = mine.filter((e) => e.type === 'reply_time' && Number.isFinite(e.totalMs));
            return r.length ? Math.round(sumField(r, 'totalMs') / r.length) : null;
          })(),
          messagesInRange: mine.filter((e) => e.type === 'message').length,
        };
      }),
    },
  };
}
