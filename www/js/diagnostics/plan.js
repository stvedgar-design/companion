// www/js/diagnostics/plan.js
// UI-005: el "plan" del banco de pruebas de estrés: perfiles de duración, lista de fases, progreso reanudable, datos del
// hardware, informe en lenguaje llano y comparación entre corridas. Módulo PURO (sin DOM ni almacenamiento): se prueba en Node.

export const REPORT_VERSION = 1;

/** Perfiles: cuántas repeticiones de cada fase, pausa de enfriamiento y tamaños de cada prueba. */
export const PROFILES = Object.freeze({
  quick: Object.freeze({
    id: 'quick', label: 'Rápida', approx: 'unos 1–2 minutos', reps: 1, cooldownMs: 0,
    chatSizes: [100, 300, 1000], scrollSeconds: 2, scrollSpeeds: [1500, 3000, 6000],
    streamTokensPerSec: [120], streamWords: 110, burstCount: 50, skinSeconds: 1.2, skinListSize: 150,
    hubCounts: [10, 30], hubScrollSeconds: 1.5, enduranceRounds: 0, serverSizes: [20],
  }),
  full: Object.freeze({
    id: 'full', label: 'Completa', approx: 'de 5 a 10 minutos', reps: 1, cooldownMs: 0,
    chatSizes: [100, 300, 1000], scrollSeconds: 6, scrollSpeeds: [1500, 3000, 6000],
    streamTokensPerSec: [40, 150], streamWords: 140, burstCount: 50, skinSeconds: 3, skinListSize: 300,
    hubCounts: [10, 30], hubScrollSeconds: 4, enduranceRounds: 0, serverSizes: [20, 40, 60, 80],
  }),
  extended: Object.freeze({
    id: 'extended', label: 'Extendida', approx: 'unos 20–30 minutos', reps: 3, cooldownMs: 15000,
    chatSizes: [100, 300, 1000], scrollSeconds: 6, scrollSpeeds: [1500, 3000, 6000],
    streamTokensPerSec: [40, 150], streamWords: 140, burstCount: 50, skinSeconds: 3, skinListSize: 300,
    hubCounts: [10, 30], hubScrollSeconds: 4, enduranceRounds: 4, serverSizes: [20, 40, 60, 80],
  }),
});

/** Fases en orden. `plain` = qué hace, en lenguaje llano (se le muestra al usuario). */
export const PHASES = Object.freeze([
  { id: 'chats', title: 'Chats largos', plain: 'Crea chats de 100, 300 y 1.000 mensajes y mide cuánto tarda en guardarlos, leerlos y dibujarlos.' },
  { id: 'scroll', title: 'Desplazamiento', plain: 'Recorre el chat de 1.000 mensajes de arriba abajo y de vuelta a tres velocidades, contando los cuadros que se sienten lentos.' },
  { id: 'streaming', title: 'Respuesta llegando', plain: 'Simula una respuesta larga que llega palabra por palabra y mide lo que cuesta actualizar la burbuja.' },
  { id: 'burst', title: 'Ráfaga de mensajes', plain: 'Envía 50 mensajes seguidos (sin servidor) y mide el tiempo de guardado y de dibujo de cada uno.' },
  { id: 'skins', title: 'Los 10 aspectos', plain: 'Repite un desplazamiento corto en cada skin, claro y oscuro, y compara.' },
  { id: 'hub', title: 'Lista de personajes', plain: 'Crea 10 y 30 personajes de prueba con imagen y mide la carga y el desplazamiento de la pantalla principal.' },
  { id: 'backup', title: 'Copia de seguridad', plain: 'Exporta e importa una copia grande de datos de prueba y verifica que vuelva completa.' },
  { id: 'endurance', title: 'Resistencia', plain: 'Repite varias veces seguidas el desplazamiento, la respuesta y la ráfaga para ver si la app se va poniendo más lenta.', extendedOnly: true },
  { id: 'server', title: 'Con el servidor', plain: 'Si tu servidor está encendido, pide respuestas cortas en un chat de prueba que va creciendo (20, 40, 60 y 80 mensajes), de a una por vez.', optional: true },
]);

export function phasesFor(profile) {
  const p = PROFILES[profile] || PROFILES.quick;
  return PHASES.filter((ph) => !ph.extendedOnly || p.enduranceRounds > 0);
}

/** Duración aproximada (segundos) de una corrida, solo para avisar al usuario (no es una promesa). */
export function estimateSeconds(profileId) {
  const p = PROFILES[profileId] || PROFILES.quick;
  const perRep =
    8 + p.scrollSpeeds.length * p.scrollSeconds * 2 + p.streamTokensPerSec.length * (p.streamWords / 4) * 2 * 0.6 +
    10 + 10 * p.skinSeconds + p.hubCounts.length * (3 + p.hubScrollSeconds) + 6;
  return Math.round(perRep * p.reps + Math.max(0, p.reps - 1) * p.cooldownMs / 1000 * phasesFor(profileId).length + p.enduranceRounds * 25);
}

// ---------- progreso reanudable ----------

export function newProgress({ profile, theme, mode, appVersion, hardware, startedAt = Date.now() }) {
  return { v: 1, profile: PROFILES[profile] ? profile : 'quick', startedAt, theme: theme || '', mode: mode || '', appVersion: appVersion || '', hardware: hardware || null, wakeLock: null, results: {}, doneIds: [] };
}

/** Siguiente fase por ejecutar (la primera de `phasesFor` que no está en `doneIds`), o null si ya terminó todo. */
export function nextPhase(progress) {
  if (!progress || !Array.isArray(progress.doneIds)) return null;
  return phasesFor(progress.profile).find((ph) => !progress.doneIds.includes(ph.id)) || null;
}

/** Devuelve un progreso nuevo con el resultado de la fase (`result` = { reps } | { skipped } | { failed }). */
export function recordPhase(progress, id, result) {
  return { ...progress, results: { ...progress.results, [id]: result }, doneIds: progress.doneIds.includes(id) ? progress.doneIds : [...progress.doneIds, id] };
}

/** ¿Un progreso guardado (posiblemente corrupto) se puede reanudar? */
export function isResumable(progress) {
  return !!progress && progress.v === 1 && !!PROFILES[progress.profile] && Array.isArray(progress.doneIds) &&
    typeof progress.results === 'object' && progress.results !== null && nextPhase(progress) !== null;
}

export function progressSummary(progress) {
  const all = phasesFor(progress.profile);
  const next = nextPhase(progress);
  return { done: progress.doneIds.length, total: all.length, nextTitle: next ? next.title : '', profileLabel: PROFILES[progress.profile].label };
}

// ---------- hardware ----------

/**
 * Datos del equipo que el WebView expone (Hecho: el usuario autoriza registrarlos; nunca salen del teléfono).
 * @param {{ userAgent?: string, hardwareConcurrency?: number, deviceMemory?: number, screenWidth?: number, screenHeight?: number,
 *   devicePixelRatio?: number, uaModel?: string, uaPlatformVersion?: string }} raw
 */
export function parseHardware(raw = {}) {
  const ua = String(raw.userAgent || '');
  const android = (ua.match(/Android\s+([\d.]+)/) || [])[1] || (raw.uaPlatformVersion ? String(raw.uaPlatformVersion) : '');
  let model = raw.uaModel ? String(raw.uaModel) : ((ua.match(/Android\s+[\d.]+;\s*([^;)]+)/) || [])[1] || '').replace(/\s*Build\/\S*/i, '').trim();
  if (!model || model === 'K' || model === 'wv') model = 'no informado';
  const chrome = (ua.match(/Chrome\/(\d+)/) || [])[1] || '';
  return {
    model,
    android: android || 'no informado',
    webview: /;\s*wv\)/.test(ua) || /Version\/4\.0/.test(ua) ? 'WebView' : 'navegador',
    chrome: chrome || 'no informado',
    cores: Number.isFinite(raw.hardwareConcurrency) ? raw.hardwareConcurrency : null,
    memoryGb: Number.isFinite(raw.deviceMemory) ? raw.deviceMemory : null,
    screen: Number.isFinite(raw.screenWidth) && Number.isFinite(raw.screenHeight) ? `${raw.screenWidth}×${raw.screenHeight}` : 'no informado',
    density: Number.isFinite(raw.devicePixelRatio) ? raw.devicePixelRatio : null,
    userAgent: ua,
  };
}

// ---------- estadísticas y textos ----------

const round1 = (x) => Math.round(x * 10) / 10;
export const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

/** Percentil `p` (0-1) de una lista de números (vacía = 0). */
export function percentile(arr, p) {
  const v = (Array.isArray(arr) ? arr : []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return 0;
  return v[Math.min(v.length - 1, Math.floor(v.length * p))];
}

/** Resumen de una lista de tiempos (ms): media, p95, máximo y cantidad. */
export function summarizeTimes(times) {
  const v = (Array.isArray(times) ? times : []).filter(Number.isFinite);
  return { n: v.length, meanMs: round1(mean(v)), p95Ms: round1(percentile(v, 0.95)), maxMs: round1(v.length ? Math.max(...v) : 0) };
}

/** "850 ms" / "2,4 s" / "1 min 5 s" (coma decimal). */
export function fmtMs(ms) {
  if (!Number.isFinite(ms)) return 'sin dato';
  if (ms < 1000) return `${Math.round(ms * 10) / 10 >= 10 ? Math.round(ms) : round1(ms)} ms`.replace('.', ',');
  if (ms < 60000) return `${round1(ms / 1000)} s`.replace('.', ',');
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)} min ${s % 60} s`;
}

const SPEED_LABELS = ['lento', 'medio', 'rápido'];
const THEME_NAMES = { nomi: 'Nomi', glass: 'Glass', imessage: 'iMessage', penumbra: 'Penumbra', 'penumbra-claude': 'Penumbra Claude' };
export const themeLabel = (theme, mode) => `${THEME_NAMES[theme] || theme || '?'} ${mode === 'light' ? 'claro' : 'oscuro'}`;

const okReps = (res) => (res && Array.isArray(res.reps) ? res.reps : []);
const meanOver = (reps, fn) => mean(reps.map(fn).filter(Number.isFinite));

/** Cambio porcentual de `first` a `last` (positivo = más lento/más grande). null si no se puede calcular. */
export function pctChange(first, last) {
  if (!Number.isFinite(first) || !Number.isFinite(last) || first <= 0) return null;
  return Math.round(((last - first) / first) * 100);
}

function phaseLines(id, res) {
  const reps = okReps(res);
  if (res && res.skipped) return [`Omitida: ${res.skipped}`];
  if (res && res.failed) return [`No se pudo completar: ${res.failed}`];
  if (!reps.length) return ['Sin datos.'];
  const lines = [];
  if (id === 'chats') {
    reps[0].sizes.forEach((s, i) => {
      const avg = (k) => meanOver(reps, (r) => (r.sizes[i] || {})[k]);
      lines.push(`Chat de ${s.size} mensajes: se dibuja en ${fmtMs(avg('renderMs'))} (${Math.round(avg('nodes'))} elementos en pantalla), se guarda en ${fmtMs(avg('saveMs'))} y se lee en ${fmtMs(avg('loadMs'))}.`);
    });
  } else if (id === 'scroll') {
    reps[0].speeds.forEach((s, i) => {
      const avg = (k) => meanOver(reps, (r) => (r.speeds[i] || {})[k]);
      const label = SPEED_LABELS[i] || `${s.speedPxS} px/s`;
      if (!avg('frames')) lines.push(`Desplazamiento ${label}: no se pudo medir (la pantalla no dibujó cuadros).`);
      else lines.push(`Desplazamiento ${label}: ${Math.round(avg('slowPercent'))} de cada 100 cuadros se sintieron lentos (media ${fmtMs(avg('meanMs'))} por cuadro; el peor, ${fmtMs(avg('maxMs'))}).`);
    });
  } else if (id === 'streaming') {
    reps[0].runs.forEach((s, i) => {
      const avg = (k) => meanOver(reps, (r) => (r.runs[i] || {})[k]);
      const how = s.mode === 'perFragment' ? 'repintando en cada fragmento' : `repintando cada ${s.paintEveryMs} ms (como hace la app)`;
      lines.push(`Respuesta a ${s.tokensPerSec} fragmentos/s, ${how}: ${Math.round(avg('updates'))} actualizaciones de ${fmtMs(avg('meanMs'))} de media (la peor, ${fmtMs(avg('maxMs'))}).`);
    });
  } else if (id === 'burst') {
    const avg = (k) => meanOver(reps, (r) => r[k]);
    lines.push(`${reps[0].count} mensajes seguidos: guardar cada uno tarda ${fmtMs(avg('saveMeanMs'))} de media (el peor, ${fmtMs(avg('saveMaxMs'))}) y dibujarlo ${fmtMs(avg('renderMeanMs'))} (el peor, ${fmtMs(avg('renderMaxMs'))}).`);
  } else if (id === 'skins') {
    const combos = reps[0].combos.map((c, i) => ({ ...c, slowPercent: meanOver(reps, (r) => (r.combos[i] || {}).slowPercent), meanMs: meanOver(reps, (r) => (r.combos[i] || {}).meanMs), frames: meanOver(reps, (r) => (r.combos[i] || {}).frames) }));
    for (const c of combos) lines.push(c.frames ? `${themeLabel(c.theme, c.mode)}: ${Math.round(c.slowPercent)} de cada 100 cuadros lentos (media ${fmtMs(c.meanMs)}).` : `${themeLabel(c.theme, c.mode)}: no se pudo medir.`);
    const measured = combos.filter((c) => c.frames);
    if (measured.length > 1) {
      const worst = measured.reduce((a, b) => (b.meanMs > a.meanMs ? b : a));
      const best = measured.reduce((a, b) => (b.meanMs < a.meanMs ? b : a));
      lines.push(`El más fluido: ${themeLabel(best.theme, best.mode)}; el más lento: ${themeLabel(worst.theme, worst.mode)}.`);
    }
  } else if (id === 'hub') {
    reps[0].counts.forEach((c, i) => {
      const avg = (k) => meanOver(reps, (r) => (r.counts[i] || {})[k]);
      lines.push(`${c.count} personajes: leerlos ${fmtMs(avg('listMs'))}, dibujar la lista ${fmtMs(avg('buildMs'))}, cargar las imágenes ${fmtMs(avg('decodeMs'))}; al desplazarla, ${Math.round(avg('slowPercent'))} de cada 100 cuadros lentos.`);
    });
  } else if (id === 'backup') {
    const r = reps[0];
    const avg = (k) => meanOver(reps, (x) => x[k]);
    lines.push(`Copia de ${r.characters} personajes, ${r.chats} chats y ${r.messages} mensajes (${Math.round(avg('sizeKB'))} KB): exportar ${fmtMs(avg('exportMs'))}, importar ${fmtMs(avg('importMs'))}.${reps.every((x) => x.ok) ? ' Volvió completa.' : ' ¡ATENCIÓN: la copia importada NO coincidió con la original!'}`);
  } else if (id === 'endurance') {
    const rounds = reps[0].rounds || [];
    if (rounds.length >= 2) {
      const first = rounds[0];
      const last = rounds[rounds.length - 1];
      const d = (k) => pctChange(first[k], last[k]);
      const fmtPct = (v) => (v === null ? 'sin dato' : `${v > 0 ? '+' : ''}${v} %`);
      lines.push(`Tras ${rounds.length} vueltas seguidas (última contra primera): desplazamiento ${fmtPct(d('scrollMeanMs'))}, respuesta llegando ${fmtPct(d('streamMeanMs'))}, guardado ${fmtPct(d('saveMeanMs'))}.`);
      if (first.heapMB !== null && last.heapMB !== null) lines.push(`Memoria de la app: ${first.heapMB} MB → ${last.heapMB} MB.`);
      else lines.push(`Elementos en pantalla: ${first.domNodes} → ${last.domNodes} (este equipo no informa la memoria).`);
      const worst = Math.max(...['scrollMeanMs', 'streamMeanMs', 'saveMeanMs'].map((k) => d(k) ?? -Infinity));
      lines.push(worst > 25 ? 'Señal de posible degradación con el uso: alguna medida empeoró más de un 25 %.' : 'Sin señal de degradación con el uso.');
    } else lines.push('No hubo suficientes vueltas para comparar.');
  } else if (id === 'server') {
    reps[0].sizes.forEach((s, i) => {
      const avg = (k) => meanOver(reps, (r) => (r.sizes[i] || {})[k]);
      lines.push(`Chat de ${s.size} mensajes: primer fragmento en ${fmtMs(avg('ttftMs'))}, respuesta completa en ${fmtMs(avg('totalMs'))}.`);
    });
    lines.push('(El primer turno suele ser más lento: el servidor aún no tiene el chat en su memoria.)');
  }
  return lines;
}

/** Secciones del informe: [{ id, title, lines }] en el orden de las fases. */
export function describeResults(results, profileId) {
  return phasesFor(profileId).map((ph) => ({ id: ph.id, title: ph.title, lines: results && results[ph.id] ? phaseLines(ph.id, results[ph.id]) : ['No se ejecutó.'] }));
}

/**
 * Informe completo. `run` = { profile, startedAt, finishedAt, appVersion, theme, mode, hardware, wakeLock, results, interrupted?, finger? }.
 * @returns {{ text: string, json: object }}
 */
export function buildReport(run) {
  const p = PROFILES[run.profile] || PROFILES.quick;
  const hw = run.hardware || {};
  const date = (t) => (Number.isFinite(t) ? new Date(t).toISOString().replace('T', ' ').slice(0, 16) + ' UTC' : '?');
  const head = [
    `INFORME DE DIAGNÓSTICO Y RENDIMIENTO — Companion v${run.appVersion || '?'}`,
    `Prueba ${p.label.toLowerCase()} · inicio ${date(run.startedAt)} · fin ${date(run.finishedAt)}`,
    `Aspecto activo: ${themeLabel(run.theme, run.mode)}`,
    `Equipo: ${hw.model || '?'} · Android ${hw.android || '?'} · ${hw.webview || '?'} (Chrome ${hw.chrome || '?'}) · ${hw.cores ?? '?'} núcleos · memoria ${hw.memoryGb ?? '?'} GB · pantalla ${hw.screen || '?'} a ${hw.density ?? '?'}x`,
    `Pantalla encendida durante la prueba: ${run.wakeLock === 'acquired' ? 'sí (la app la mantuvo encendida)' : run.wakeLock === 'unsupported' ? 'no fue posible pedirla: conviene ajustar el bloqueo de pantalla del teléfono' : run.wakeLock === 'denied' ? 'el sistema la rechazó' : 'sin información'}`,
  ];
  if (run.interrupted) head.push('NOTA: la prueba se interrumpió y se retomó; los tiempos entre fases pueden incluir esa pausa.');
  const sections = describeResults(run.results, run.profile);
  const out = [...head, ''];
  for (const s of sections) {
    out.push(`== ${s.title} ==`, ...s.lines, '');
  }
  if (run.finger) out.push('== Con el dedo ==', run.finger.text || 'Sin datos.', '');
  out.push('Este informe usa solo datos sintéticos: no contiene tus chats ni datos personales.');
  const { hardware, ...rest } = run;
  return { text: out.join('\n'), json: { app: 'companion-diagnostics', reportVersion: REPORT_VERSION, ...rest, hardware: { ...hw, userAgent: undefined } } };
}

// ---------- comparación entre corridas ----------

/** Números clave de una corrida para compararla con otra. Cada valor es "ms" (más bajo = mejor) o null si no hay. Promedia las repeticiones. */
export function headline(results) {
  const r = results || {};
  // promedio, sobre las repeticiones, del campo `k` del elemento `i` de la lista `listKey` de la fase `id`
  const avgIn = (id, listKey, i, k) => {
    const vals = okReps(r[id]).map((rep) => (rep[listKey] && rep[listKey][i] ? rep[listKey][i][k] : undefined)).filter(Number.isFinite);
    return vals.length ? mean(vals) : null;
  };
  const avgTop = (id, k) => {
    const vals = okReps(r[id]).map((rep) => rep[k]).filter(Number.isFinite);
    return vals.length ? mean(vals) : null;
  };
  const first = (id, listKey) => (okReps(r[id])[0] && okReps(r[id])[0][listKey]) || [];
  const speeds = first('scroll', 'speeds');
  const runs = first('streaming', 'runs');
  const perFrag = runs.map((x, i) => (x.mode === 'perFragment' ? i : -1)).filter((i) => i >= 0).pop();
  const sizes = first('chats', 'sizes');
  const i1000 = sizes.findIndex((x) => x.size === 1000);
  const counts = first('hub', 'counts');
  const i30 = counts.findIndex((x) => x.count === 30);
  const srv = first('server', 'sizes');
  const hubParts = i30 >= 0 ? ['listMs', 'buildMs', 'decodeMs'].map((k) => avgIn('hub', 'counts', i30, k)) : [];
  return {
    scrollFast: speeds.length && avgIn('scroll', 'speeds', speeds.length - 1, 'frames') > 0 ? avgIn('scroll', 'speeds', speeds.length - 1, 'meanMs') : null,
    streamPerFragment: perFrag !== undefined ? avgIn('streaming', 'runs', perFrag, 'meanMs') : null,
    burstSave: avgTop('burst', 'saveMeanMs'),
    chat1000Render: i1000 >= 0 ? avgIn('chats', 'sizes', i1000, 'renderMs') : null,
    hub30Load: hubParts.length && hubParts.every((v) => v !== null) ? hubParts.reduce((a, b) => a + b, 0) : null,
    backupExport: avgTop('backup', 'exportMs'),
    serverTtftLast: srv.length ? avgIn('server', 'sizes', srv.length - 1, 'ttftMs') : null,
  };
}

const HEADLINE_LABELS = {
  scrollFast: 'Desplazamiento rápido (tiempo por cuadro)',
  streamPerFragment: 'Actualizar la burbuja en cada fragmento',
  burstSave: 'Guardar un mensaje en la ráfaga',
  chat1000Render: 'Dibujar un chat de 1.000 mensajes',
  hub30Load: 'Cargar la lista de 30 personajes',
  backupExport: 'Exportar la copia de seguridad',
  serverTtftLast: 'Servidor: primer fragmento (chat más largo)',
};

/**
 * Compara dos corridas (la anterior y la actual). Devuelve líneas en lenguaje llano; ≥8 % de diferencia se dice, menos = "igual".
 * @param {{ results: object, theme?: string, mode?: string, profile?: string }} prev
 * @param {{ results: object, theme?: string, mode?: string, profile?: string }} cur
 */
export function compareRuns(prev, cur) {
  if (!prev || !cur) return [];
  const a = headline(prev.results);
  const b = headline(cur.results);
  const sameSkin = prev.theme === cur.theme && prev.mode === cur.mode;
  const lines = [];
  for (const key of Object.keys(HEADLINE_LABELS)) {
    if (a[key] === null || b[key] === null) continue;
    const pct = pctChange(a[key], b[key]);
    if (pct === null) continue;
    const skin = sameSkin ? ` con ${themeLabel(cur.theme, cur.mode)}` : ` (${themeLabel(prev.theme, prev.mode)} → ${themeLabel(cur.theme, cur.mode)})`;
    if (Math.abs(pct) < 8) lines.push(`${HEADLINE_LABELS[key]}: igual que la vez anterior${skin}.`);
    else lines.push(`${HEADLINE_LABELS[key]}: ${Math.abs(pct)} % ${pct > 0 ? 'más lento' : 'más rápido'} que la vez anterior${skin}.`);
  }
  if (prev.profile && cur.profile && prev.profile !== cur.profile) lines.push(`(Ojo: la corrida anterior fue ${PROFILES[prev.profile] ? PROFILES[prev.profile].label.toLowerCase() : prev.profile} y esta ${PROFILES[cur.profile] ? PROFILES[cur.profile].label.toLowerCase() : cur.profile}: con menos repeticiones los números varían más.)`);
  return lines;
}

/** Agrega una corrida a la lista guardada (más nueva primero), con un máximo. Pura. */
export function pushRun(runs, run, max = 10) {
  return [run, ...(Array.isArray(runs) ? runs : [])].slice(0, max);
}
