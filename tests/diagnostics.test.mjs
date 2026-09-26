// tests/diagnostics.test.mjs — UI-005: banco de pruebas de estrés (partes puras y de datos; el DOM se verifica en el navegador)
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createState } from '../www/js/state.js';
import { makeMessages, makeStreamChunks, makeSyntheticCharacter, makeRng, isDiagId, DIAG_PREFIX } from '../www/js/diagnostics/synth.js';
import {
  PROFILES, PHASES, phasesFor, estimateSeconds, newProgress, nextPhase, recordPhase, isResumable, progressSummary, parseHardware,
  percentile, summarizeTimes, fmtMs, pctChange, describeResults, buildReport, headline, compareRuns, pushRun,
} from '../www/js/diagnostics/plan.js';
import { dataChats, dataBurst, dataHub, dataBackup, wipeAll } from '../www/js/diagnostics/dataphases.js';
import { loadRuns, saveRun, loadProgress, saveProgress, clearProgress, RUNS_KEY, PROGRESS_KEY } from '../www/js/diagnostics/store.js';

// ---- backend en memoria con contador de operaciones (para probar el aislamiento) ----
function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  const b = {
    ops: 0,
    async get(s, k) { b.ops++; return stores[s].get(k); },
    async getAll(s) { b.ops++; return Array.from(stores[s].values()); },
    async put(s, k, v) { b.ops++; stores[s].set(k, v); },
    async remove(s, k) { b.ops++; stores[s].delete(k); },
    async atomic(ops) { b.ops++; for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
    _stores: stores,
  };
  return b;
}
const fakeNow = () => { let t = 0; return () => (t += 5); };

// ---------- synth ----------

test('UI-005 synth: makeMessages es determinista, alterna roles, usa el formato del proyecto y trae asteriscos sueltos a propósito', () => {
  const a = makeMessages(300, { seed: 42 });
  const b = makeMessages(300, { seed: 42 });
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, makeMessages(300, { seed: 43 }));
  assert.equal(a.length, 300);
  assert.equal(a[0].role, 'char');
  assert.equal(a[1].role, 'user');
  assert.ok(a.every((m) => m.text.includes('*') && Number.isFinite(m.ts)));
  const unclosed = a.filter((m) => (m.text.match(/\*/g) || []).length % 2 === 1).length;
  assert.ok(unclosed > 5 && unclosed < 60, `asteriscos sueltos: ${unclosed}`);
  const lens = a.map((m) => m.text.length);
  assert.ok(Math.max(...lens) > 2 * Math.min(...lens), 'largos variables');
  assert.deepEqual(makeMessages(0), []);
  assert.deepEqual(makeMessages(-3), []);
});

test('UI-005 synth: makeStreamChunks devuelve fragmentos (unidos, una respuesta larga) y makeSyntheticCharacter lleva el prefijo de la prueba', () => {
  const chunks = makeStreamChunks(140);
  assert.ok(chunks.length >= 100);
  assert.ok(chunks.join('').length > 300);
  assert.deepEqual(makeStreamChunks(50, 1), makeStreamChunks(50, 1));
  const c = makeSyntheticCharacter(3, 'data:image/png;base64,AAAA');
  assert.ok(c.id.startsWith(DIAG_PREFIX) && isDiagId(c.id));
  assert.equal(isDiagId('c123'), false);
  assert.equal(isDiagId(undefined), false);
  const r = makeRng(5); const x = r(); assert.ok(x >= 0 && x < 1);
});

// ---------- plan ----------

test('UI-005 plan: tres perfiles; la Extendida repite 3 veces con pausa y añade la fase de resistencia; las demás no', () => {
  assert.deepEqual(Object.keys(PROFILES), ['quick', 'full', 'extended']);
  assert.equal(PROFILES.extended.reps, 3);
  assert.ok(PROFILES.extended.cooldownMs > 0 && PROFILES.quick.cooldownMs === 0);
  assert.equal(phasesFor('quick').some((p) => p.id === 'endurance'), false);
  assert.equal(phasesFor('full').some((p) => p.id === 'endurance'), false);
  assert.equal(phasesFor('extended').some((p) => p.id === 'endurance'), true);
  assert.equal(phasesFor('nope').length, phasesFor('quick').length);
  assert.ok(PHASES.every((p) => p.title && p.plain));
  assert.ok(estimateSeconds('quick') < estimateSeconds('full') && estimateSeconds('full') < estimateSeconds('extended'));
  assert.ok(estimateSeconds('quick') >= 30 && estimateSeconds('quick') <= 200, String(estimateSeconds('quick')));
});

test('UI-005 plan: el progreso avanza fase a fase, se puede reanudar hasta terminar y un progreso corrupto no se reanuda', () => {
  let p = newProgress({ profile: 'quick', theme: 'glass', mode: 'dark', appVersion: '1.1.0' });
  assert.equal(nextPhase(p).id, 'chats');
  assert.equal(isResumable(p), true);
  p = recordPhase(p, 'chats', { reps: [{ sizes: [] }] });
  assert.equal(nextPhase(p).id, 'scroll');
  assert.deepEqual(progressSummary(p), { done: 1, total: phasesFor('quick').length, nextTitle: 'Desplazamiento', profileLabel: 'Rápida' });
  const again = recordPhase(p, 'chats', { reps: [] }); // repetir no duplica
  assert.equal(again.doneIds.filter((x) => x === 'chats').length, 1);
  assert.equal(p.results.chats.reps.length, 1, 'inmutable');
  for (const ph of phasesFor('quick')) p = recordPhase(p, ph.id, { skipped: 'x' });
  assert.equal(nextPhase(p), null);
  assert.equal(isResumable(p), false);
  for (const bad of [null, undefined, {}, { v: 2 }, { v: 1, profile: 'zzz', doneIds: [], results: {} }, { v: 1, profile: 'quick', doneIds: 'x', results: {} }, 'texto']) {
    assert.equal(isResumable(bad), false, JSON.stringify(bad));
  }
});

test('UI-005 plan: parseHardware entiende el user agent de un WebView de Android y tolera datos ausentes', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 11; Nokia G20 Build/RP1A.200720.011; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.122 Mobile Safari/537.36';
  const hw = parseHardware({ userAgent: ua, hardwareConcurrency: 8, deviceMemory: 4, screenWidth: 360, screenHeight: 800, devicePixelRatio: 2 });
  assert.equal(hw.model, 'Nokia G20');
  assert.equal(hw.android, '11');
  assert.equal(hw.webview, 'WebView');
  assert.equal(hw.chrome, '126');
  assert.equal(hw.cores, 8);
  assert.equal(hw.memoryGb, 4);
  assert.equal(hw.screen, '360×800');
  assert.equal(hw.density, 2);
  const masked = parseHardware({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 Chrome/126.0.0.0 Mobile Safari/537.36', uaModel: 'SM-A166B' });
  assert.equal(masked.model, 'SM-A166B');
  assert.equal(masked.webview, 'navegador');
  assert.equal(parseHardware({ userAgent: 'Mozilla/5.0 (Linux; Android 10; K) Chrome/1' }).model, 'no informado');
  const empty = parseHardware();
  assert.equal(empty.model, 'no informado');
  assert.equal(empty.cores, null);
  assert.equal(empty.screen, 'no informado');
});

test('UI-005 plan: percentile, summarizeTimes, fmtMs y pctChange', () => {
  assert.equal(percentile([1, 2, 3, 4, 100], 0.95), 100);
  assert.equal(percentile([], 0.5), 0);
  assert.deepEqual(summarizeTimes([10, 20, 30]), { n: 3, meanMs: 20, p95Ms: 30, maxMs: 30 });
  assert.deepEqual(summarizeTimes([]), { n: 0, meanMs: 0, p95Ms: 0, maxMs: 0 });
  assert.equal(fmtMs(850), '850 ms');
  assert.equal(fmtMs(2450), '2,5 s');
  assert.equal(fmtMs(65000), '1 min 5 s');
  assert.equal(fmtMs(NaN), 'sin dato');
  assert.equal(fmtMs(0.4), '0,4 ms');
  assert.equal(pctChange(100, 118), 18);
  assert.equal(pctChange(100, 80), -20);
  assert.equal(pctChange(0, 5), null);
  assert.equal(pctChange(undefined, 5), null);
});

const sampleResults = (scale = 1) => ({
  chats: { reps: [{ sizes: [{ size: 100, renderMs: 30 * scale, nodes: 400, saveMs: 12, loadMs: 8 }, { size: 1000, renderMs: 250 * scale, nodes: 3500, saveMs: 90, loadMs: 60 }] }] },
  scroll: { reps: [{ speeds: [{ speedPxS: 1500, frames: 120, meanMs: 16.7, p95Ms: 20, maxMs: 30, slowPercent: 1 }, { speedPxS: 3000, frames: 120, meanMs: 17, p95Ms: 25, maxMs: 40, slowPercent: 3 }, { speedPxS: 6000, frames: 110, meanMs: 20 * scale, p95Ms: 40, maxMs: 90, slowPercent: 8 }] }] },
  streaming: { reps: [{ runs: [{ tokensPerSec: 120, mode: 'perFragment', updates: 110, meanMs: 4 * scale, p95Ms: 6, maxMs: 12 }, { tokensPerSec: 120, mode: 'throttled', paintEveryMs: 90, updates: 10, meanMs: 4.5, p95Ms: 6, maxMs: 9 }] }] },
  burst: { reps: [{ count: 50, saveMeanMs: 12 * scale, saveP95Ms: 20, saveMaxMs: 30, renderMeanMs: 3, renderP95Ms: 5, renderMaxMs: 8 }] },
  skins: { reps: [{ combos: [{ theme: 'nomi', mode: 'dark', frames: 60, meanMs: 16.8, slowPercent: 1 }, { theme: 'glass', mode: 'dark', frames: 60, meanMs: 22, slowPercent: 9 }] }] },
  hub: { reps: [{ counts: [{ count: 10, listMs: 20, buildMs: 15, decodeMs: 40, slowPercent: 2 }, { count: 30, listMs: 50 * scale, buildMs: 40, decodeMs: 110, slowPercent: 4 }] }] },
  backup: { reps: [{ characters: 10, chats: 5, messages: 1500, sizeKB: 900, exportMs: 400 * scale, importMs: 700, ok: true }] },
  server: { reps: [{ sizes: [{ size: 20, ttftMs: 900, totalMs: 4000 }, { size: 80, ttftMs: 2500 * scale, totalMs: 9000 }] }] },
});

test('UI-005 plan: el informe describe cada fase en lenguaje llano (sin jerga) y no incluye datos personales', () => {
  const sections = describeResults(sampleResults(), 'full');
  const byId = Object.fromEntries(sections.map((s) => [s.id, s.lines.join(' ')]));
  assert.match(byId.chats, /Chat de 1000 mensajes: se dibuja en 250 ms/);
  assert.match(byId.scroll, /rápido: 8 de cada 100 cuadros se sintieron lentos/);
  assert.match(byId.streaming, /repintando en cada fragmento/);
  assert.match(byId.streaming, /cada 90 ms/);
  assert.match(byId.burst, /50 mensajes seguidos/);
  assert.match(byId.skins, /Glass oscuro: 9 de cada 100/);
  assert.match(byId.skins, /El más fluido: Nomi oscuro; el más lento: Glass oscuro/);
  assert.match(byId.hub, /30 personajes/);
  assert.match(byId.backup, /Volvió completa/);
  assert.match(byId.server, /primer fragmento en 2,5 s/);
  // fase sin datos / omitida / fallida
  const partial = describeResults({ server: { skipped: 'el servidor no respondió' }, hub: { failed: 'sin espacio' } }, 'full');
  assert.match(partial.find((s) => s.id === 'server').lines[0], /Omitida: el servidor no respondió/);
  assert.match(partial.find((s) => s.id === 'hub').lines[0], /No se pudo completar: sin espacio/);
  assert.equal(partial.find((s) => s.id === 'chats').lines[0], 'No se ejecutó.');
  const bad = describeResults({ backup: { reps: [{ characters: 1, chats: 1, messages: 1, sizeKB: 1, exportMs: 1, importMs: 1, ok: false }] } }, 'full');
  assert.match(bad.find((s) => s.id === 'backup').lines[0], /NO coincidió/);
});

test('UI-005 plan: la fase de resistencia compara la última vuelta con la primera y avisa de una degradación', () => {
  const res = (last) => ({ endurance: { reps: [{ rounds: [
    { scrollMeanMs: 17, streamMeanMs: 4, saveMeanMs: 10, heapMB: 40, domNodes: 900 },
    { scrollMeanMs: 17, streamMeanMs: 4, saveMeanMs: 10, heapMB: 42, domNodes: 900 },
    { scrollMeanMs: last, streamMeanMs: 4, saveMeanMs: 10, heapMB: 45, domNodes: 900 },
  ] }] } });
  const ok = describeResults(res(18), 'extended').find((s) => s.id === 'endurance').lines.join(' ');
  assert.match(ok, /Tras 3 vueltas/);
  assert.match(ok, /40 MB → 45 MB/);
  assert.match(ok, /Sin señal de degradación/);
  const worse = describeResults(res(30), 'extended').find((s) => s.id === 'endurance').lines.join(' ');
  assert.match(worse, /desplazamiento \+76 %/);
  assert.match(worse, /posible degradación/);
  const noHeap = describeResults({ endurance: { reps: [{ rounds: [{ scrollMeanMs: 1, streamMeanMs: 1, saveMeanMs: 1, heapMB: null, domNodes: 10 }, { scrollMeanMs: 1, streamMeanMs: 1, saveMeanMs: 1, heapMB: null, domNodes: 12 }] }] } }, 'extended').find((s) => s.id === 'endurance').lines.join(' ');
  assert.match(noHeap, /no informa la memoria/);
});

test('UI-005 plan: buildReport trae versión, fecha, aspecto, hardware y el aviso de datos sintéticos; el JSON no lleva el user agent', () => {
  const hw = parseHardware({ userAgent: 'Mozilla/5.0 (Linux; Android 11; Nokia G20 Build/X; wv) Version/4.0 Chrome/126.0.0.0', hardwareConcurrency: 8, deviceMemory: 4, screenWidth: 360, screenHeight: 800, devicePixelRatio: 2 });
  const run = { profile: 'full', startedAt: Date.UTC(2026, 8, 26, 12, 0), finishedAt: Date.UTC(2026, 8, 26, 12, 8), appVersion: '1.1.0', theme: 'glass', mode: 'dark', hardware: hw, wakeLock: 'acquired', results: sampleResults() };
  const { text, json } = buildReport(run);
  assert.match(text, /Companion v1\.1\.0/);
  assert.match(text, /2026-09-26 12:00 UTC/);
  assert.match(text, /Aspecto activo: Glass oscuro/);
  assert.match(text, /Nokia G20 · Android 11 · WebView \(Chrome 126\) · 8 núcleos · memoria 4 GB · pantalla 360×800 a 2x/);
  assert.match(text, /la app la mantuvo encendida/);
  assert.match(text, /no contiene tus chats ni datos personales/);
  assert.equal(json.app, 'companion-diagnostics');
  assert.equal(json.hardware.userAgent, undefined);
  assert.ok(json.results.scroll);
  const noLock = buildReport({ ...run, wakeLock: 'unsupported', interrupted: true }).text;
  assert.match(noLock, /no fue posible pedirla/);
  assert.match(noLock, /se interrumpió y se retomó/);
});

test('UI-005 plan: compareRuns dice "+X % más lento" / "más rápido" / "igual" y avisa si cambió el aspecto o el perfil', () => {
  const prev = { profile: 'full', theme: 'glass', mode: 'dark', results: sampleResults(1) };
  const cur = { profile: 'full', theme: 'glass', mode: 'dark', results: sampleResults(1.18) };
  const lines = compareRuns(prev, cur);
  assert.ok(lines.some((l) => /Desplazamiento rápido.*: 18 % más lento que la vez anterior con Glass oscuro/.test(l)), lines.join('\n'));
  const same = compareRuns(prev, prev);
  assert.ok(same.length >= 5 && same.every((l) => /igual que la vez anterior/.test(l)));
  const faster = compareRuns(cur, prev);
  assert.ok(faster.some((l) => /más rápido/.test(l)));
  const other = compareRuns(prev, { ...cur, theme: 'nomi', profile: 'quick' });
  assert.ok(other.some((l) => /Glass oscuro → Nomi oscuro/.test(l)));
  assert.ok(other.some((l) => /la corrida anterior fue completa y esta rápida/.test(l)));
  assert.deepEqual(compareRuns(null, cur), []);
  assert.deepEqual(compareRuns(prev, { results: {} }), []);
  assert.equal(headline({}).scrollFast, null);
});

test('UI-005 plan: pushRun deja la más nueva primero y conserva como máximo 10', () => {
  let runs = [];
  for (let i = 0; i < 14; i++) runs = pushRun(runs, { id: i });
  assert.equal(runs.length, 10);
  assert.equal(runs[0].id, 13);
  assert.deepEqual(pushRun(undefined, { id: 1 }), [{ id: 1 }]);
});

// ---------- guardado local ----------

function fakeStorage(opts = {}) {
  const m = new Map();
  return {
    getItem: (k) => { if (opts.throws) throw new Error('bloqueado'); return m.has(k) ? m.get(k) : null; },
    setItem: (k, v) => { if (opts.throws) throw new Error('lleno'); m.set(k, String(v)); },
    removeItem: (k) => { if (opts.throws) throw new Error('bloqueado'); m.delete(k); },
    _m: m,
  };
}

test('UI-005 store: guarda y lee corridas y progreso; un almacenamiento que falla o un JSON roto nunca lanzan', () => {
  const st = fakeStorage();
  assert.deepEqual(loadRuns(st), []);
  assert.equal(saveRun({ id: 1 }, st), true);
  assert.equal(saveRun({ id: 2 }, st), true);
  assert.deepEqual(loadRuns(st).map((r) => r.id), [2, 1]);
  assert.equal(loadProgress(st), null);
  saveProgress({ v: 1, doneIds: ['chats'] }, st);
  assert.deepEqual(loadProgress(st), { v: 1, doneIds: ['chats'] });
  clearProgress(st);
  assert.equal(loadProgress(st), null);
  st._m.set(RUNS_KEY, '{no es json');
  st._m.set(PROGRESS_KEY, '{no es json');
  assert.deepEqual(loadRuns(st), []);
  assert.equal(loadProgress(st), null);
  st._m.set(RUNS_KEY, '"texto"');
  assert.deepEqual(loadRuns(st), []);
  const bad = fakeStorage({ throws: true });
  assert.deepEqual(loadRuns(bad), []);
  assert.equal(saveRun({ id: 1 }, bad), false);
  assert.equal(saveProgress({}, bad), false);
  assert.doesNotThrow(() => clearProgress(bad));
});

// ---------- fases de datos + aislamiento ----------

test('UI-005 datos: chats largos — crea un chat por tamaño, mide y todo queda SOLO en el almacén de prueba', async () => {
  const real = memoryBackend();
  const diag = memoryBackend();
  const realState = createState(real);
  await realState.saveCharacter({ id: 'mia', name: 'Mia', avatar: '', card: {}, created: 1, updated: 1 });
  const realChat = await realState.createChat('mia', {});
  await realState.saveChatMessages(realChat.id, [{ role: 'user', text: 'un mensaje real', ts: 1 }]);
  const realOps = real.ops;
  const snapshot = JSON.stringify([...real._stores.chatMsgs.entries()]);

  const diagState = createState(diag);
  const { rows, messagesBySize } = await dataChats({ state: diagState, sizes: [100, 300], now: fakeNow() });
  assert.deepEqual(rows.map((r) => r.size), [100, 300]);
  assert.ok(rows.every((r) => r.loaded === r.size && r.saveMs > 0 && r.loadMs > 0 && r.sizeKB > 0));
  assert.equal(messagesBySize[300].length, 300);
  assert.equal((await diagState.listCharacters()).length, 2);

  assert.equal(real.ops, realOps, 'la prueba no hizo NINGUNA operación sobre el almacén real');
  assert.equal(JSON.stringify([...real._stores.chatMsgs.entries()]), snapshot);
  assert.equal((await realState.listCharacters()).length, 1);
  assert.equal(JSON.stringify(rows).includes('un mensaje real'), false, 'el informe no contiene datos reales');
});

test('UI-005 datos: ráfaga — guarda el chat completo tras cada mensaje y usa el renderStep de la capa de DOM', async () => {
  const diagState = createState(memoryBackend());
  const seen = [];
  const r = await dataBurst({ state: diagState, count: 50, now: fakeNow(), renderStep: async (i, m, all) => { seen.push([i, all.length]); return 2; } });
  assert.equal(r.count, 50);
  assert.equal(r.saveTimes.length, 50);
  assert.equal(r.renderTimes.length, 50);
  assert.equal(r.stored, 50);
  assert.deepEqual(seen[49], [49, 50]);
  const r2 = await dataBurst({ state: createState(memoryBackend()), count: 5, now: fakeNow() });
  assert.deepEqual(r2.renderTimes, []);
});

test('UI-005 datos: lista de personajes — crea N con imagen, mide escritura y lectura, y no acumula entre corridas', async () => {
  const diagState = createState(memoryBackend());
  const a = await dataHub({ state: diagState, count: 10, makeAvatar: (i) => `data:image/png;base64,${i}`, now: fakeNow() });
  assert.equal(a.characters.length, 10);
  assert.ok(a.characters.every((c) => c.avatar.startsWith('data:image/png')));
  assert.ok(a.writeMs > 0 && a.listMs > 0);
  const b = await dataHub({ state: diagState, count: 30, now: fakeNow() });
  assert.equal(b.characters.length, 30, 'borra lo anterior antes de crear');
});

test('UI-005 datos: copia de seguridad — exporta, borra, importa y verifica que vuelva completa', async () => {
  const diagState = createState(memoryBackend());
  const r = await dataBackup({ state: diagState, characters: 4, chats: 2, perChat: 30, makeAvatar: () => 'data:image/png;base64,AAAA', now: fakeNow() });
  assert.deepEqual([r.characters, r.chats, r.messages], [4, 2, 60]);
  assert.equal(r.ok, true);
  assert.ok(r.sizeKB > 0 && r.exportMs > 0 && r.importMs > 0);
  assert.equal((await diagState.listCharacters()).length, 4);
});

test('UI-005 limpieza: wipeAll deja el almacén de prueba vacío (no queda ningún rastro de una prueba interrumpida)', async () => {
  const backend = memoryBackend();
  const st = createState(backend);
  await dataChats({ state: st, sizes: [100], now: fakeNow() });
  await dataBurst({ state: st, count: 10, now: fakeNow() });
  await dataHub({ state: st, count: 5, now: fakeNow() });
  assert.ok((await st.listCharacters()).length > 0);
  await wipeAll(st);
  assert.equal((await st.listCharacters()).length, 0);
  for (const name of ['characters', 'chatMeta', 'chatMsgs']) assert.equal(backend._stores[name].size, 0, name);
});

test('UI-005 aislamiento (estático): ningún archivo del banco de pruebas importa la instancia por defecto de state.js (la real)', () => {
  const dir = new URL('../www/js/diagnostics/', import.meta.url);
  const forbidden = /\b(getSettings|saveSettings|listCharacters|getCharacter|saveCharacter|deleteCharacter|listChats|getChat|getChatMessages|saveChatMessages|createChat|exportBackup|importBackup|migrateLegacyChats)\b/;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    const src = readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*'\.\.\/state\.js'/g)) {
      const names = m[1].split(',').map((x) => x.trim()).filter(Boolean);
      assert.ok(names.every((n) => n === 'createState' || n === 'createIndexedDbBackend'), `${f} importa de state.js: ${names.join(', ')}`);
      assert.ok(!forbidden.test(m[1]), f);
    }
    assert.ok(!/from\s*'\.\.\/ui\/(chat|home|chats)\.js'/.test(src), `${f} no debe usar las vistas reales`);
  }
});
