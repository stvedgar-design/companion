// tests/chat-archive.test.mjs — MEM-018: archivar un episodio completo (orden, servidor apagado, reintento, restaurar, datos).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState, activeChats, archivedChats, isChatArchived, isChatArchivePending } from '../www/js/state.js';
import { createChatArchiver, archiveResultMessage } from '../www/js/api/chat-archive.js';

function createMemoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
    _raw: stores,
  };
}

const CARD = { name: 'Nova', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };

async function setup() {
  const backend = createMemoryBackend();
  const state = createState(backend);
  await state.saveCharacter({ id: 'c1', name: 'Nova', avatar: '', card: CARD, avatarMode: 'mini', created: 1 });
  const chat = await state.createChat('c1', { title: 'Uno' });
  const msgs = [
    { role: 'char', text: 'Hola', ts: 1 },
    { role: 'user', text: 'Hola Nova', ts: 2 },
    { role: 'char', text: '*Sonríe.* Hola.', ts: 3 },
    { role: 'user', text: 'Cuéntame', ts: 4 },
  ];
  await state.saveChatMessages(chat.id, msgs);
  return { backend, state, chatId: chat.id, msgs };
}

// Archivador con dobles: `calls` registra el orden; `lore`/`recap`/`up` se pueden cambiar entre pruebas.
function makeArchiver(state, opts = {}) {
  const calls = [];
  const cfg = { up: true, lore: { kind: 'ok' }, recap: { kind: 'notyet' }, ...opts };
  let t = 1000;
  const archiver = createChatArchiver({
    loadChat: (id) => state.getChat(id),
    loadMessages: (id) => state.getChatMessages(id),
    loadCharacter: (id) => state.getCharacter(id),
    loadSettings: () => state.getSettings(),
    saveArchive: (id, patch) => state.saveChatArchive(id, patch),
    listPendingChats: async () => {
      const all = await state.listChats('c1');
      return all.filter(isChatArchivePending);
    },
    serverUp: async () => { calls.push('ping'); return typeof cfg.up === 'function' ? cfg.up() : cfg.up; },
    extractMemories: async () => { calls.push('memories'); return typeof cfg.lore === 'function' ? cfg.lore() : cfg.lore; },
    summarize: async () => { calls.push('summary'); return typeof cfg.recap === 'function' ? cfg.recap() : cfg.recap; },
    refreshRelationship: async () => { calls.push('relationship'); },
    now: () => ++t,
  });
  return { archiver, calls, cfg };
}

test('compatibilidad: un chat guardado antes de MEM-018 carga ACTIVO (sin marcas)', async () => {
  const { backend, state, chatId } = await setup();
  const raw = backend._raw.chatMeta.get(chatId);
  delete raw.archivedAt;
  delete raw.archivePendingAt;
  const chat = await state.getChat(chatId);
  assert.equal(chat.archivedAt, 0);
  assert.equal(chat.archivePendingAt, 0);
  assert.equal(isChatArchived(chat), false);
  assert.equal(isChatArchivePending(chat), false);
  assert.equal(activeChats(await state.listChats('c1')).length, 1);
});

test('valores corruptos de archivado se limpian a "activo" (nunca esconden un chat por un dato roto)', async () => {
  const { backend, state, chatId } = await setup();
  const raw = backend._raw.chatMeta.get(chatId);
  raw.archivedAt = 'ayer';
  raw.archivePendingAt = -5;
  const chat = await state.getChat(chatId);
  assert.equal(chat.archivedAt, 0);
  assert.equal(chat.archivePendingAt, 0);
});

test('archivar y restaurar a mano: la transcripción queda idéntica, sin tocar `updated`, y vuelve a la lista normal', async () => {
  const { state, chatId } = await setup();
  const before = await state.getChat(chatId);
  const msgsBeforeObj = await state.getChatMessages(chatId);
  const msgsBefore = JSON.stringify(msgsBeforeObj);
  await state.saveChatArchive(chatId, { archivedAt: 500 });
  let all = await state.listChats('c1');
  assert.equal(all.length, 1, 'listChats sigue devolviendo todo (respaldo, informe de uso)');
  assert.equal(activeChats(all).length, 0);
  assert.equal(archivedChats(all).length, 1);
  assert.equal(JSON.stringify(await state.getChatMessages(chatId)), msgsBefore);
  assert.equal((await state.getChat(chatId)).updated, before.updated);
  await state.saveChatArchive(chatId, { archivedAt: 0, archivePendingAt: 0 });
  all = await state.listChats('c1');
  assert.equal(activeChats(all).length, 1);
  assert.equal(archivedChats(all).length, 0);
  assert.deepEqual(await state.getChatMessages(chatId), msgsBeforeObj);
});

test('archivar: orden recuerdos → resumen → archivado, y la relación se reevalúa tras extraer', async () => {
  const { state, chatId } = await setup();
  const { archiver, calls } = makeArchiver(state);
  const r = await archiver.archive(chatId);
  assert.equal(r.kind, 'archived');
  assert.deepEqual(calls, ['ping', 'memories', 'relationship', 'summary']);
  const chat = await state.getChat(chatId);
  assert.ok(chat.archivedAt > 0);
  assert.equal(chat.archivePendingAt, 0);
});

test('archivar NO modifica ni borra ningún mensaje', async () => {
  const { state, chatId } = await setup();
  const before = JSON.stringify(await state.getChatMessages(chatId));
  const { archiver } = makeArchiver(state);
  await archiver.archive(chatId);
  assert.equal(JSON.stringify(await state.getChatMessages(chatId)), before);
});

test('servidor APAGADO: queda pendiente (sigue en la lista), no se extrae nada y los mensajes siguen intactos', async () => {
  const { state, chatId } = await setup();
  const { archiver, calls } = makeArchiver(state, { up: false });
  const r = await archiver.archive(chatId);
  assert.equal(r.kind, 'pending');
  assert.deepEqual(calls, ['ping']);
  const chat = await state.getChat(chatId);
  assert.equal(isChatArchived(chat), false);
  assert.equal(isChatArchivePending(chat), true);
  assert.equal(activeChats(await state.listChats('c1')).length, 1, 'el pendiente sigue visible en la lista');
  assert.match(archiveResultMessage(r), /pendiente de archivar/);
});

test('la marca de pendiente se guarda ANTES de empezar (si Android mata la app a la mitad, sigue pendiente)', async () => {
  const { state, chatId } = await setup();
  let seenDuring = null;
  const { archiver } = makeArchiver(state, {
    lore: async () => {
      seenDuring = await state.getChat(chatId);
      return { kind: 'ok' };
    },
  });
  await archiver.archive(chatId);
  assert.equal(isChatArchivePending(seenDuring), true);
});

test('reintento automático: al volver el servidor se archiva solo, sin volver a tocar «Archivar»', async () => {
  const { state, chatId } = await setup();
  const server = { up: false };
  const { archiver, calls } = makeArchiver(state, { up: () => server.up });
  assert.equal((await archiver.archive(chatId)).kind, 'pending');
  // sigue apagado: no hace nada
  assert.deepEqual(await archiver.retryPending(), { attempted: 1, archived: 0 });
  assert.equal(isChatArchived(await state.getChat(chatId)), false);
  // vuelve el servidor
  server.up = true;
  calls.length = 0;
  assert.deepEqual(await archiver.retryPending(), { attempted: 1, archived: 1 });
  const chat = await state.getChat(chatId);
  assert.equal(isChatArchived(chat), true);
  assert.equal(chat.archivePendingAt, 0);
  assert.deepEqual(calls, ['ping', 'memories', 'relationship', 'summary']);
  // nada más que reintentar
  assert.deepEqual(await archiver.retryPending(), { attempted: 0, archived: 0 });
});

test('el servidor se cae a mitad de camino (recuerdos o resumen "unavailable"): queda pendiente, no archivado', async () => {
  for (const cfg of [{ lore: { kind: 'unavailable' } }, { recap: { kind: 'unavailable' } }, { lore: { kind: 'aborted' } }]) {
    const { state, chatId } = await setup();
    const { archiver } = makeArchiver(state, cfg);
    const r = await archiver.archive(chatId);
    assert.equal(r.kind, 'pending', JSON.stringify(cfg));
    assert.equal(isChatArchivePending(await state.getChat(chatId)), true);
  }
});

test('episodio corto o sin nada que extraer/resumir: se archiva igual, sin esos pasos', async () => {
  for (const cfg of [
    { lore: { kind: 'toolittle' }, recap: { kind: 'notyet' } },
    { lore: { kind: 'nochange' }, recap: { kind: 'notyet' } },
    { lore: { kind: 'unparsed' }, recap: { kind: 'unparsed' } },
    { lore: { kind: 'ok' }, recap: { kind: 'unverified' } },
    { lore: { kind: 'ok' }, recap: { kind: 'error' } }, // el resumen es un extra: nunca bloquea
  ]) {
    const { state, chatId } = await setup();
    const { archiver } = makeArchiver(state, cfg);
    assert.equal((await archiver.archive(chatId)).kind, 'archived', JSON.stringify(cfg));
  }
});

test('fallo LOCAL al extraer ("error"): no se archiva ni queda pendiente para siempre; el episodio sigue activo', async () => {
  const { state, chatId } = await setup();
  const { archiver } = makeArchiver(state, { lore: { kind: 'error' } });
  const r = await archiver.archive(chatId);
  assert.equal(r.kind, 'error');
  const chat = await state.getChat(chatId);
  assert.equal(isChatArchived(chat), false);
  assert.equal(isChatArchivePending(chat), false);
  assert.match(archiveResultMessage(r), /No se pudo archivar/);
});

test('si el usuario retoma el episodio pendiente (quita la marca), el reintento NO lo archiva', async () => {
  const { state, chatId } = await setup();
  const server = { up: false };
  const { archiver } = makeArchiver(state, { up: () => server.up });
  await archiver.archive(chatId);
  await state.saveChatArchive(chatId, { archivePendingAt: 0 }); // mandó un mensaje
  server.up = true;
  assert.deepEqual(await archiver.retryPending(), { attempted: 0, archived: 0 });
  assert.equal(isChatArchived(await state.getChat(chatId)), false);
});

test('el usuario retoma el episodio MIENTRAS corre el archivado: no se archiva por encima de su decisión', async () => {
  const { state, chatId } = await setup();
  const { archiver } = makeArchiver(state, {
    recap: async () => {
      await state.saveChatArchive(chatId, { archivePendingAt: 0 });
      return { kind: 'ok' };
    },
  });
  const r = await archiver.archive(chatId);
  assert.equal(r.kind, 'cancelled');
  assert.equal(isChatArchived(await state.getChat(chatId)), false);
});

test('abortar (el usuario abrió un chat): queda pendiente', async () => {
  const { state, chatId } = await setup();
  let archiverRef;
  const made = makeArchiver(state, {
    lore: async () => {
      archiverRef.abort();
      return { kind: 'ok' };
    },
  });
  archiverRef = made.archiver;
  const r = await made.archiver.archive(chatId);
  assert.equal(r.kind, 'pending');
  assert.equal(isChatArchivePending(await state.getChat(chatId)), true);
});

test('chat inexistente o ya archivado: sin efectos', async () => {
  const { state, chatId } = await setup();
  const { archiver, calls } = makeArchiver(state);
  assert.equal((await archiver.archive('no-existe')).kind, 'missing');
  await archiver.archive(chatId);
  calls.length = 0;
  assert.equal((await archiver.archive(chatId)).kind, 'already');
  assert.deepEqual(calls, []);
});

test('dos archivados seguidos se procesan de a uno (nunca dos extracciones a la vez)', async () => {
  const { state, chatId } = await setup();
  const second = await state.createChat('c1', { title: 'Dos' });
  await state.saveChatMessages(second.id, [{ role: 'char', text: 'Hola', ts: 1 }]);
  let running = 0;
  let maxRunning = 0;
  const { archiver } = makeArchiver(state, {
    lore: async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return { kind: 'ok' };
    },
  });
  const [a, b] = await Promise.all([archiver.archive(chatId), archiver.archive(second.id)]);
  assert.equal(a.kind, 'archived');
  assert.equal(b.kind, 'archived');
  assert.equal(maxRunning, 1);
});

test('la copia de seguridad conserva el estado de archivado y restaurar sigue funcionando tras importarla', async () => {
  const { state, chatId } = await setup();
  await state.saveChatArchive(chatId, { archivedAt: 777 });
  const backup = JSON.parse(await (await state.exportBackup()).text());
  const other = createState(createMemoryBackend());
  await other.importBackupData(backup);
  const chat = await other.getChat(chatId);
  assert.equal(chat.archivedAt, 777);
  assert.equal(archivedChats(await other.listChats('c1')).length, 1);
  assert.equal((await other.getChatMessages(chatId)).length, 4);
});
