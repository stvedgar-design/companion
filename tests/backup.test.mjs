// tests/backup.test.mjs — BKP-001: importación segura de copias (analizar, confirmar, no pisar, todo o nada)
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../www/js/state.js';
import { parseBackupText, normalizeBackup, analyzeBackup, planImport, describeAnalysis, describeResult, replaceWarning, formatExported, CHAT_LOG_MESSAGE } from '../www/js/backup.js';

function memoryBackend(opts = {}) {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  const b = {
    writes: 0,
    async get(s, k) { return stores[s].get(k); },
    async getAll(s) { return Array.from(stores[s].values()); },
    async put(s, k, v) { b.writes++; stores[s].set(k, v); },
    async remove(s, k) { b.writes++; stores[s].delete(k); },
    async atomic(ops) {
      if (opts.failAtomic) throw new Error('fallo simulado del almacenamiento');
      b.writes += ops.length;
      for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); }
    },
    _stores: stores,
  };
  return b;
}
const snapshot = (b) => JSON.stringify(Object.fromEntries(Object.entries(b._stores).map(([k, m]) => [k, [...m.entries()].sort()])));
const char = (id, extra = {}) => ({ id, name: extra.name || id, avatar: '', card: { name: id }, created: 1, updated: extra.updated ?? 1, lorebook: extra.lorebook || [], lorebookPrevious: [], lorebookPreviousAt: 0, ...extra });
const chatRec = (id, characterId, extra = {}) => ({ id, characterId, title: extra.title || id, scenario: '', created: 1, updated: extra.updated ?? 1, last: '', lastExportAt: 0, ...extra });
const msgs = (n, prefix = 'm') => Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: `${prefix}${i}`, ts: i + 1 }));
const file = (obj) => ({ async text() { return typeof obj === 'string' ? obj : JSON.stringify(obj); } });
const v2 = (o = {}) => ({ app: 'companion', version: 2, exported: '2026-09-12T14:30:00.000Z', settings: { url: 'http://otro:5001', user: 'Otro', theme: 'glass', pinHash: 'h', pinSalt: 's' }, characters: [], chats: {}, chatMessages: {}, ...o });

// ---------- lectura y validación ----------

test('BKP-001 parse: JSON roto, otra app y archivo sin personajes se rechazan con un mensaje comprensible; el BOM se tolera', () => {
  assert.throws(() => parseBackupText('{no'), /no es un JSON válido/);
  assert.throws(() => parseBackupText('{"app":"otra","characters":[]}'), /no es una copia de seguridad válida/);
  assert.throws(() => parseBackupText('{"app":"companion"}'), /no es una copia de seguridad válida/);
  assert.throws(() => parseBackupText('null'), /no es una copia de seguridad válida/);
  assert.ok(parseBackupText('\uFEFF' + JSON.stringify(v2())));
});

test('BKP-001 parse: el registro de un chat (chat-log, respaldo automático) se rechaza explicando que se importa desde el chat', async () => {
  const chatLog = { app: 'companion', kind: 'chat-log', version: 2, exported: 'x', character: { id: 'a', name: 'A' }, chat: { id: 'c' }, messages: [] };
  assert.throws(() => parseBackupText(JSON.stringify(chatLog)), (e) => e.message === CHAT_LOG_MESSAGE && /Importar chat/.test(e.message));
  const st = createState(memoryBackend());
  await assert.rejects(() => st.importBackup(file(chatLog)), /Importar chat/);
  await assert.rejects(() => st.analyzeBackupFile(file(chatLog)), /Importar chat/);
});

test('BKP-001 normalize: copias v2 y v1 (un chat por personaje) toman la misma forma; lo inválido se ignora sin lanzar', () => {
  const n2 = normalizeBackup(v2({ characters: [char('a'), { name: 'sin id' }, null], chats: { c1: chatRec('c1', 'a'), c2: { id: 'c2' }, c3: 'x' }, chatMessages: { c1: msgs(3) } }));
  assert.equal(n2.version, 2);
  assert.deepEqual(n2.characters.map((c) => c.id), ['a']);
  assert.deepEqual(n2.chats.map((c) => [c.id, c.messages.length, c.legacy]), [['c1', 3, false]]);
  const n1 = normalizeBackup({ app: 'companion', version: 1, characters: [char('a')], chats: { a: msgs(2), b: 'x' } });
  assert.equal(n1.version, 1);
  assert.deepEqual(n1.chats.map((c) => [c.id, c.characterId, c.legacy, c.title]), [['a', 'a', true, 'Chat restaurado']]);
  assert.equal(n1.exported, null);
  assert.deepEqual(normalizeBackup({ app: 'companion', characters: [] }).chats, []);
});

// ---------- análisis ----------

const existingOf = (chars, chats, counts) => ({ characters: chars, chats, messageCounts: counts || {} });

test('BKP-001 analyze: cuenta lo nuevo y detecta los conflictos por id donde lo existente es más nuevo o más completo', () => {
  const backup = normalizeBackup(v2({
    characters: [char('mia', { lorebook: [{ id: 1 }] }), char('theo'), char('ani')],
    chats: { c1: chatRec('c1', 'mia', { updated: 100 }), c2: chatRec('c2', 'mia', { updated: 200 }), c3: chatRec('c3', 'theo', { updated: 50 }), c9: chatRec('c9', 'fantasma', { updated: 1 }) },
    chatMessages: { c1: msgs(5), c2: msgs(2), c3: msgs(4), c9: msgs(1) },
  }));
  const existing = existingOf(
    [char('mia', { updated: 10, lorebook: [{ id: 1 }, { id: 2 }, { id: 3 }] }), char('theo')],
    [chatRec('c1', 'mia', { updated: 300 }), chatRec('c2', 'mia', { updated: 150 })],
    { c1: 2, c2: 9 }
  );
  const a = analyzeBackup(backup, existing);
  assert.deepEqual(a.counts, { characters: 3, chats: 4, messages: 12 });
  assert.equal(a.newCharacters, 1); // ani
  assert.equal(a.newChats, 2); // c3 y c9
  assert.equal(a.orphanChats, 1); // c9: su personaje no existe en ningún lado
  assert.equal(a.existingEmpty, false);
  assert.equal(a.conflictChats, 2);
  assert.equal(a.conflictCharacters, 2);
  const c1 = a.conflicts.find((c) => c.id === 'c1');
  assert.equal(c1.existingNewer, true); // 300 > 100
  assert.equal(c1.existingMore, false); // 2 < 5
  const c2 = a.conflicts.find((c) => c.id === 'c2');
  assert.equal(c2.existingMore, true); // 9 > 2
  assert.equal(c2.existingNewer, false); // 150 < 200
  const mia = a.conflicts.find((c) => c.kind === 'character' && c.id === 'mia');
  assert.equal(mia.existingMoreMemories, true);
  assert.equal(a.warnNewer, true);
  assert.equal(a.newerChats, 2);
  assert.equal(a.hasSettings, true);
});

test('BKP-001 analyze: teléfono vacío = sin conflictos ni advertencia; lo idéntico no advierte', () => {
  const backup = normalizeBackup(v2({ characters: [char('a')], chats: { c1: chatRec('c1', 'a') }, chatMessages: { c1: msgs(3) } }));
  const empty = analyzeBackup(backup, existingOf([], [], {}));
  assert.equal(empty.existingEmpty, true);
  assert.equal(empty.conflicts.length, 0);
  assert.equal(empty.warnNewer, false);
  assert.equal(replaceWarning(empty), '');
  const same = analyzeBackup(backup, existingOf([char('a')], [chatRec('c1', 'a')], { c1: 3 }));
  assert.equal(same.conflicts.length, 2);
  assert.equal(same.warnNewer, false, 'igual de nuevo y de completo: no hay nada que perder');
});

// ---------- plan ----------

test('BKP-001 plan: "solo agregar" nunca escribe un id existente y omite los chats sin personaje; "reemplazar" escribe todo', () => {
  const backup = normalizeBackup(v2({
    characters: [char('mia'), char('ani')],
    chats: { c1: chatRec('c1', 'mia'), c2: chatRec('c2', 'ani'), c9: chatRec('c9', 'fantasma') },
    chatMessages: { c1: msgs(2), c2: msgs(2), c9: msgs(1) },
  }));
  const existing = existingOf([char('mia')], [chatRec('c1', 'mia')]);
  const merge = planImport(backup, existing, {});
  assert.equal(merge.mode, 'merge');
  assert.deepEqual(merge.characters.map((c) => c.id), ['ani']);
  assert.deepEqual(merge.chats.map((c) => c.id), ['c2']);
  assert.deepEqual(merge.stats, { addedCharacters: 1, replacedCharacters: 0, skippedCharacters: 1, addedChats: 1, replacedChats: 0, skippedChats: 1, orphanChats: 1 });
  const replace = planImport(backup, existing, { mode: 'replace' });
  assert.deepEqual(replace.characters.map((c) => c.id), ['mia', 'ani']);
  assert.deepEqual(replace.chats.map((c) => c.id), ['c1', 'c2', 'c9']);
  assert.deepEqual([replace.stats.replacedCharacters, replace.stats.replacedChats, replace.stats.addedChats], [1, 1, 2]);
  assert.equal(planImport(backup, existing, { mode: 'cualquier cosa' }).mode, 'merge', 'un modo raro cae en el seguro');
  assert.equal(planImport(backup, existing, { includeSettings: true }).settings.url, 'http://otro:5001');
  assert.equal(planImport(backup, existing, {}).settings, null);
});

// ---------- textos ----------

test('BKP-001 textos: el resumen dice fecha, cantidades y conflictos en lenguaje llano; el resultado dice qué se agregó, reemplazó y omitió', () => {
  const backup = normalizeBackup(v2({ characters: [char('a'), char('b'), char('c')], chats: Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`c${i}`, chatRec(`c${i}`, i < 4 ? 'a' : 'b')])), chatMessages: {} }));
  const a = analyzeBackup(backup, existingOf([char('a')], [chatRec('c0', 'a', { updated: 9 }), chatRec('c1', 'a')], { c0: 50, c1: 0 }));
  const lines = describeAnalysis(a).join(' ');
  assert.match(lines, /Esta copia es del \d\d\/\d\d\/2026 \d\d:\d\d\./);
  assert.match(lines, /Tiene 3 personajes, 7 chats y 0 mensajes\./);
  assert.match(lines, /Ya tienes en tu teléfono 1 personaje y 2 chats de esta copia\./);
  assert.match(lines, /Lo que te falta y se agregaría: 2 personajes y 5 chats\./);
  assert.match(lines, /1 chat que ya tienes tiene más mensajes o cambios más nuevos/);
  assert.match(replaceWarning(a), /^¡Ojo! «Restaurar todo» pisaría cosas tuyas .*: 1 chat\./);
  assert.match(describeAnalysis(analyzeBackup(backup, existingOf([], []))).join(' '), /Tu teléfono no tiene personajes ni chats todavía/);
  const res = describeResult({ addedCharacters: 1, addedChats: 3, replacedCharacters: 0, replacedChats: 0, skippedCharacters: 1, skippedChats: 2, orphanChats: 1, droppedMessages: 2, settingsRestored: true }).join(' ');
  assert.match(res, /Se agregó: 1 personaje y 3 chats\./);
  assert.match(res, /Se omitió \(no se tocó\): 1 personaje que ya tenías, 2 chats que ya tenías, 1 chat sin su personaje\./);
  assert.match(res, /2 mensajes dañados se descartaron/);
  assert.match(res, /restauraron también tus ajustes/);
  assert.match(describeResult({ addedCharacters: 0, addedChats: 0 }).join(' '), /No se agregó nada nuevo/);
  assert.equal(formatExported('no es fecha'), '');
  assert.equal(formatExported(null), '');
  assert.match(formatExported('2026-09-12T14:30:00.000Z'), /^\d\d\/09\/2026 \d\d:\d\d$/);
  assert.match(describeAnalysis(analyzeBackup(normalizeBackup({ app: 'companion', characters: [] }), existingOf([], []))).join(' '), /no trae la fecha/);
});

// ---------- estado: modos, atomicidad, ajustes ----------

async function seededState() {
  const backend = memoryBackend();
  const st = createState(backend);
  await st.saveSettings({ url: 'http://mio:5001', user: 'Yo', theme: 'nomi' });
  await st.saveCharacter(char('mia', { name: 'Mia local', lorebook: [{ id: 'l', keys: ['k'], content: 'c', updated: 1, source: 'manual' }] }));
  await backend.put('chatMeta', 'c1', chatRec('c1', 'mia', { title: 'local', updated: 500 }));
  await backend.put('chatMsgs', 'c1', msgs(5, 'local'));
  return { backend, st };
}
const backupFile = () => file(v2({
  characters: [char('mia', { name: 'Mia de la copia' }), char('ani')],
  chats: { c1: chatRec('c1', 'mia', { title: 'copia', updated: 100 }), c2: chatRec('c2', 'ani', { title: 'nuevo', updated: 100 }), c3: chatRec('c3', 'mia', { title: 'otro chat de mia', updated: 100 }) },
  chatMessages: { c1: msgs(1, 'copia'), c2: msgs(3, 'nuevo'), c3: msgs(2, 'otro') },
}));

test('BKP-001 modo "solo agregar": NO modifica ningún registro existente y agrega solo lo que falta (incluido un chat nuevo de un personaje que ya tienes)', async () => {
  const { backend, st } = await seededState();
  const before = {
    mia: JSON.stringify(backend._stores.characters.get('mia')),
    c1: JSON.stringify(backend._stores.chatMeta.get('c1')),
    m1: JSON.stringify(backend._stores.chatMsgs.get('c1')),
    settings: JSON.stringify(backend._stores.settings.get('main')),
  };
  const r = await st.importBackup(backupFile());
  assert.equal(r.mode, 'merge');
  assert.deepEqual([r.addedCharacters, r.addedChats, r.skippedCharacters, r.skippedChats, r.replacedCharacters, r.replacedChats], [1, 2, 1, 1, 0, 0]);
  // lo existente, intacto byte a byte
  assert.equal(JSON.stringify(backend._stores.characters.get('mia')), before.mia);
  assert.equal(JSON.stringify(backend._stores.chatMeta.get('c1')), before.c1);
  assert.equal(JSON.stringify(backend._stores.chatMsgs.get('c1')), before.m1);
  assert.equal(JSON.stringify(backend._stores.settings.get('main')), before.settings);
  // lo que faltaba, agregado
  assert.ok(backend._stores.characters.get('ani'));
  assert.equal((await st.getChat('c2')).title, 'nuevo');
  assert.equal((await st.getChat('c3')).title, 'otro chat de mia');
  assert.equal((await st.getChatMessages('c2')).length, 3);
  assert.equal((await st.getChatMessages('c1')).length, 5, 'el chat local más largo no se toca');
});

test('BKP-001 modo "reemplazar": lo de la copia gana (decisión explícita) y el resultado lo dice', async () => {
  const { st } = await seededState();
  const r = await st.importBackup(backupFile(), { mode: 'replace' });
  assert.deepEqual([r.replacedCharacters, r.replacedChats, r.addedCharacters, r.addedChats], [1, 1, 1, 2]);
  assert.equal((await st.getCharacter('mia')).name, 'Mia de la copia');
  assert.equal((await st.getChat('c1')).title, 'copia');
  assert.equal((await st.getChatMessages('c1')).length, 1);
});

test('BKP-001 análisis sin escribir: analyzeBackupFile no toca nada, lee el archivo UNA vez y el mismo dato se aplica después', async () => {
  const { backend, st } = await seededState();
  const before = snapshot(backend);
  const writes = backend.writes;
  let reads = 0;
  const f = { async text() { reads++; return JSON.stringify(v2({ characters: [char('mia'), char('ani')], chats: { c1: chatRec('c1', 'mia', { updated: 100 }) }, chatMessages: { c1: msgs(1) } })); } };
  const { data, analysis } = await st.analyzeBackupFile(f);
  assert.equal(snapshot(backend), before);
  assert.equal(backend.writes, writes);
  assert.equal(analysis.warnNewer, true); // el c1 local tiene más mensajes y es más nuevo
  assert.equal(analysis.newerChats, 1);
  await st.importBackupData(data, { mode: 'merge' });
  assert.equal(reads, 1, 'el archivo se leyó una sola vez');
  assert.ok(backend._stores.characters.get('ani'));
});

test('BKP-001 todo o nada: si la escritura falla no queda NADA escrito y el mensaje es comprensible', async () => {
  const backend = memoryBackend({ failAtomic: true });
  const st = createState(backend);
  await st.saveCharacter(char('mia'));
  const before = snapshot(backend);
  for (const mode of ['merge', 'replace']) {
    await assert.rejects(() => st.importBackup(backupFile(), { mode, includeSettings: true }), /No se pudo restaurar la copia\. No se cambió nada/);
    assert.equal(snapshot(backend), before, mode);
  }
});

test('BKP-001 validación previa: contenido dañado se sanea/omite ANTES de escribir (mensajes sin forma, chats sin personaje id) y se informa', async () => {
  const backend = memoryBackend();
  const st = createState(backend);
  const bad = v2({
    characters: [char('a'), { name: 'sin id' }],
    chats: { c1: chatRec('c1', 'a'), c2: { id: 'c2' }, c3: chatRec('c3', 'a') },
    chatMessages: { c1: [{ role: 'user', text: 'ok', ts: 1 }, { role: 'robot', text: 'x' }, null, { role: 'char' }, { role: 'char', text: 'ok2', ts: 2, loreUsed: 'basura', meta: 'basura' }], c3: 'no es lista' },
  });
  const r = await st.importBackup(file(bad));
  assert.equal(r.droppedMessages, 3);
  const m = await st.getChatMessages('c1');
  assert.deepEqual(m.map((x) => x.text), ['ok', 'ok2']);
  assert.equal('loreUsed' in m[1] || 'meta' in m[1], false, 'los campos opcionales corruptos se limpian');
  assert.equal(backend._stores.chatMsgs.has('c3'), false, 'un chat cuyos mensajes no son una lista no crea una lista rota');
  assert.equal(backend._stores.chatMeta.has('c2'), false);
});

test('BKP-001 ajustes: por defecto NO se restauran; con includeSettings sí (URL, nombre, aspecto y PIN) y sin pisar los campos que la copia no trae', async () => {
  const { st } = await seededState();
  await st.importBackup(backupFile());
  assert.equal((await st.getSettings()).url, 'http://mio:5001');
  const r = await st.importBackup(backupFile(), { includeSettings: true });
  assert.equal(r.settingsRestored, true);
  const s = await st.getSettings();
  assert.equal(s.url, 'http://otro:5001');
  assert.equal(s.user, 'Otro');
  assert.equal(s.theme, 'penumbra-claude'); // UI-024: la copia trae 'glass' (skin archivado): migra en silencio
  assert.equal(s.pinHash, 'h');
  const fresh = createState(memoryBackend());
  const clean = await fresh.importBackup(backupFile(), { includeSettings: true });
  assert.equal(clean.settingsRestored, true);
  assert.equal((await fresh.getSettings()).user, 'Otro');
});

test('BKP-001 compatibilidad: copias v1, v2 y v2 sin campos nuevos (lorebookPrevious, meta, variantes) siguen importando', async () => {
  const st = createState(memoryBackend());
  const minimal = { id: 'x', name: 'X', avatar: '', card: {}, created: 1, updated: 1 }; // sin lorebook ni lorebookPrevious
  const r2 = await st.importBackup(file(v2({ characters: [minimal], chats: { cx: { id: 'cx', characterId: 'x' } }, chatMessages: { cx: [{ role: 'user', text: 'hola', ts: 1 }] } })));
  assert.deepEqual([r2.addedCharacters, r2.addedChats], [1, 1]);
  assert.deepEqual((await st.getCharacter('x')).lorebook, []);
  assert.equal((await st.getChatMessages('cx'))[0].text, 'hola');
  const v1 = { app: 'companion', version: 1, characters: [char('viejo')], chats: { viejo: [{ role: 'char', text: 'hola de v1', ts: 1 }] } };
  const r1 = await st.importBackup(file(v1));
  assert.deepEqual([r1.addedCharacters, r1.addedChats], [1, 1]);
  assert.equal((await st.getChatMessages('viejo'))[0].text, 'hola de v1');
  // v1 otra vez en "solo agregar": el chat ya existe y se omite
  const again = await st.importBackup(file(v1));
  assert.deepEqual([again.addedChats, again.skippedChats, again.skippedCharacters], [0, 1, 1]);
});

test('BKP-001 ida y vuelta: exportBackup → importBackup en un teléfono vacío restaura todo (con ajustes) y en el mismo teléfono no cambia nada', async () => {
  const { backend, st } = await seededState();
  const blob = await st.exportBackup();
  const text = await blob.text();
  const before = snapshot(backend);
  const same = await st.importBackup(file(text));
  assert.equal(snapshot(backend), before, 'importar la propia copia en "solo agregar" no cambia nada');
  assert.deepEqual([same.addedCharacters, same.addedChats], [0, 0]);
  const fresh = createState(memoryBackend());
  const { analysis } = await fresh.analyzeBackupFile(file(text));
  assert.equal(analysis.existingEmpty, true);
  const r = await fresh.importBackup(file(text), { includeSettings: true });
  assert.deepEqual([r.addedCharacters, r.addedChats], [1, 1]);
  assert.equal((await fresh.getSettings()).user, 'Yo');
  assert.equal((await fresh.getChatMessages('c1')).length, 5);
});
