// tests/state.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../www/js/state.js';

// ---------- backend en memoria, implementa el mismo contrato que el backend de IndexedDB ----------

function createMemoryBackend() {
  const stores = {
    settings: new Map(),
    characters: new Map(),
    chats: new Map(),     // legado: solo lo usa migrateLegacyChats()
    chatMeta: new Map(),
    chatMsgs: new Map(),
  };

  function applyOp(op) {
    const store = stores[op.store];
    if (op.type === 'put') store.set(op.key, op.value);
    else if (op.type === 'remove') store.delete(op.key);
  }

  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) applyOp(op); },
    // Acceso directo para preparar datos "legado" en los tests de migración.
    _raw: stores,
  };
}

function makeCharacter(overrides = {}) {
  return {
    id: overrides.id || 'char-1',
    name: overrides.name || 'Personaje',
    avatar: '',
    card: {
      name: overrides.name || 'Personaje',
      description: '', personality: '', scenario: '',
      first_mes: '', mes_example: '', system_prompt: '',
      post_history_instructions: '', alternate_greetings: [], character_book: null,
    },
    avatarMode: 'mini',
    created: overrides.created ?? Date.now(),
    ...overrides,
  };
}

// ---------- ajustes ----------

test('getSettings devuelve valores por defecto cuando no hay nada guardado', async () => {
  const state = createState(createMemoryBackend());
  const settings = await state.getSettings();
  assert.deepEqual(settings, {
    url: '', user: '', maxLen: 220, temp: 0.85, mode: 'chat', ctx: 4096,
    pinSalt: '', pinHash: '',
  });
});

test('saveSettings valida rangos y descarta valores fuera de contrato', async () => {
  const state = createState(createMemoryBackend());
  const saved = await state.saveSettings({
    url: 'http://100.75.55.22:5001',
    maxLen: 5000,
    temp: -1,
    mode: 'invalido',
    ctx: 8192,
  });
  assert.equal(saved.url, 'http://100.75.55.22:5001');
  assert.equal(saved.maxLen, 500); // recortado al máximo
  assert.equal(saved.temp, 0.3); // recortado al mínimo
  assert.equal(saved.mode, 'chat'); // valor inválido -> por defecto
  assert.equal(saved.ctx, 8192);

  const reloaded = await state.getSettings();
  assert.deepEqual(reloaded, saved);
});

test('saveSettings hace merge parcial sobre lo ya guardado', async () => {
  const state = createState(createMemoryBackend());
  await state.saveSettings({ url: 'http://100.1.1.1:5001', user: 'Ada' });
  const saved = await state.saveSettings({ temp: 1.0 });
  assert.equal(saved.url, 'http://100.1.1.1:5001');
  assert.equal(saved.user, 'Ada');
  assert.equal(saved.temp, 1.0);
});

// ---------- personajes ----------

test('crea y lista personajes ordenados por updated descendente', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'a', updated: 1000 }));
  await state.saveCharacter(makeCharacter({ id: 'b', updated: 3000 }));
  await state.saveCharacter(makeCharacter({ id: 'c', updated: 2000 }));

  const list = await state.listCharacters();
  assert.deepEqual(list.map((c) => c.id), ['b', 'c', 'a']);
});

test('getCharacter devuelve null si no existe', async () => {
  const state = createState(createMemoryBackend());
  assert.equal(await state.getCharacter('no-existe'), null);
});

test('newId genera identificadores distintos', async () => {
  const state = createState(createMemoryBackend());
  const ids = new Set([state.newId(), state.newId(), state.newId()]);
  assert.equal(ids.size, 3);
});

// ---------- chats (adenda: varios por personaje) ----------

test('createChat crea un chat vacío ligado al personaje', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));

  const chat = await state.createChat('x', { title: 'Primera cita', scenario: 'En un café' });
  assert.equal(chat.characterId, 'x');
  assert.equal(chat.title, 'Primera cita');
  assert.equal(chat.scenario, 'En un café');
  assert.equal(chat.last, '');
  assert.equal(chat.lastExportAt, 0);

  const fetched = await state.getChat(chat.id);
  assert.deepEqual(fetched, chat);
});

test('createChat rechaza personajes inexistentes', async () => {
  const state = createState(createMemoryBackend());
  await assert.rejects(() => state.createChat('no-existe', {}));
});

test('listChats devuelve solo los chats de ese personaje, ordenados por updated descendente', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  await state.saveCharacter(makeCharacter({ id: 'y' }));

  const a = await state.createChat('x', { title: 'A' });
  const b = await state.createChat('x', { title: 'B' });
  await state.createChat('y', { title: 'De otro personaje' });

  await state.saveChatMessages(a.id, [{ role: 'user', text: 'hola', ts: 1 }]);
  await new Promise((r) => setTimeout(r, 2));
  await state.saveChatMessages(b.id, [{ role: 'user', text: 'hola de nuevo', ts: 2 }]);

  const list = await state.listChats('x');
  assert.equal(list.length, 2);
  assert.equal(list[0].id, b.id); // el más recientemente actualizado va primero
  assert.equal(list[1].id, a.id);
});

test('saveChatMessages actualiza `last` (sin asteriscos, espacios colapsados, máx 90) y `updated` del chat', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const chat = await state.createChat('x', {});

  const longText = '*se acerca despacio*   hola,   '.repeat(5) + 'final del mensaje';
  await state.saveChatMessages(chat.id, [
    { role: 'user', text: 'hola', ts: 1 },
    { role: 'char', text: longText, ts: 2 },
  ]);

  const updatedChat = await state.getChat(chat.id);
  assert.ok(updatedChat.updated >= chat.updated);
  assert.ok(updatedChat.last.length <= 90);
  assert.ok(!updatedChat.last.includes('*'));
  assert.ok(!updatedChat.last.includes('  '));

  const messages = await state.getChatMessages(chat.id);
  assert.equal(messages.length, 2);
});

test('saveChatMessages contra un chat inexistente lanza', async () => {
  const state = createState(createMemoryBackend());
  await assert.rejects(() => state.saveChatMessages('no-existe', []));
});

test('getChat/getChatMessages devuelven null si no existen', async () => {
  const state = createState(createMemoryBackend());
  assert.equal(await state.getChat('sin-chat'), null);
  assert.equal(await state.getChatMessages('sin-chat'), null);
});

test('renameChat cambia el título sin tocar los mensajes', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const chat = await state.createChat('x', { title: 'Original' });
  await state.saveChatMessages(chat.id, [{ role: 'user', text: 'hola', ts: 1 }]);

  const renamed = await state.renameChat(chat.id, 'Nuevo título');
  assert.equal(renamed.title, 'Nuevo título');

  const messages = await state.getChatMessages(chat.id);
  assert.equal(messages.length, 1);
});

test('deleteChat borra un chat sin afectar a los demás del mismo personaje', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const a = await state.createChat('x', { title: 'A' });
  const b = await state.createChat('x', { title: 'B' });
  await state.saveChatMessages(a.id, [{ role: 'user', text: 'hola', ts: 1 }]);
  await state.saveChatMessages(b.id, [{ role: 'user', text: 'hola', ts: 1 }]);

  await state.deleteChat(a.id);

  assert.equal(await state.getChat(a.id), null);
  assert.equal(await state.getChatMessages(a.id), null);
  assert.ok(await state.getChat(b.id));

  const remaining = await state.listChats('x');
  assert.deepEqual(remaining.map((c) => c.id), [b.id]);
});

// ---------- borrado de personaje ----------

test('deleteCharacter borra también todos sus chats', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const a = await state.createChat('x', {});
  const b = await state.createChat('x', {});
  await state.saveChatMessages(a.id, [{ role: 'user', text: 'hola', ts: 1 }]);
  await state.saveChatMessages(b.id, [{ role: 'user', text: 'hola', ts: 1 }]);

  await state.deleteCharacter('x');

  assert.equal(await state.getCharacter('x'), null);
  assert.equal(await state.getChat(a.id), null);
  assert.equal(await state.getChat(b.id), null);
  assert.equal(await state.getChatMessages(a.id), null);
  assert.equal(await state.getChatMessages(b.id), null);
  assert.deepEqual(await state.listChats('x'), []);
});

// ---------- migración de chats con formato viejo ----------

test('migrateLegacyChats convierte un chat viejo (uno por personaje) en un Chat nuevo con el mismo id', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  await state.saveCharacter(makeCharacter({ id: 'x', created: 123 }));
  // Simula el formato viejo: mensajes guardados directo bajo el id del personaje.
  backend._raw.chats.set('x', [{ role: 'user', text: 'hola vieja', ts: 1 }]);

  await state.migrateLegacyChats();

  const chat = await state.getChat('x');
  assert.ok(chat);
  assert.equal(chat.id, 'x');
  assert.equal(chat.characterId, 'x');
  assert.equal(chat.title, 'Chat original');
  assert.equal(chat.scenario, '');

  const messages = await state.getChatMessages('x');
  assert.equal(messages.length, 1);
  assert.equal(messages[0].text, 'hola vieja');
});

test('migrateLegacyChats corrida dos veces no duplica ni pisa cambios posteriores', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  backend._raw.chats.set('x', [{ role: 'user', text: 'hola vieja', ts: 1 }]);

  await state.migrateLegacyChats();
  // El usuario sigue chateando después de la primera migración...
  await state.saveChatMessages('x', [
    { role: 'user', text: 'hola vieja', ts: 1 },
    { role: 'char', text: 'un mensaje nuevo', ts: 2 },
  ]);
  await state.renameChat('x', 'Con nombre propio');

  // ...y la migración se vuelve a correr (p. ej. en el siguiente arranque).
  await state.migrateLegacyChats();

  const chats = await state.listChats('x');
  assert.equal(chats.length, 1); // no se duplicó
  assert.equal(chats[0].title, 'Con nombre propio'); // no se pisó el cambio

  const messages = await state.getChatMessages('x');
  assert.equal(messages.length, 2); // no se pisaron los mensajes nuevos
});

test('migrateLegacyChats no hace nada si no hay datos en formato viejo', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  await state.migrateLegacyChats();
  assert.deepEqual(await state.listChats('x'), []);
});

// ---------- copias de seguridad ----------

test('exportBackup produce el JSON con la forma del contrato (v2, varios chats por personaje)', async () => {
  const state = createState(createMemoryBackend());
  await state.saveSettings({ url: 'http://100.1.1.1:5001' });
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const a = await state.createChat('x', { title: 'A' });
  const b = await state.createChat('x', { title: 'B' });
  await state.saveChatMessages(a.id, [{ role: 'user', text: 'hola', ts: 1 }]);
  await state.saveChatMessages(b.id, [{ role: 'user', text: 'hola de nuevo', ts: 1 }]);

  const blob = await state.exportBackup();
  const data = JSON.parse(await blob.text());

  assert.equal(data.app, 'companion');
  assert.equal(data.version, 2);
  assert.equal(typeof data.exported, 'string');
  assert.equal(data.settings.url, 'http://100.1.1.1:5001');
  assert.equal(data.characters.length, 1);
  assert.equal(Object.keys(data.chats).length, 2);
  assert.equal(data.chatMessages[a.id].length, 1);
  assert.equal(data.chatMessages[b.id].length, 1);
});

test('importBackup (v2) restaura personajes, chats y mensajes, y no pisa settings.url', async () => {
  const state = createState(createMemoryBackend());
  await state.saveSettings({ url: 'http://mi-url-actual:5001' });
  await state.saveCharacter(makeCharacter({ id: 'existente', name: 'Viejo nombre' }));

  const backupPayload = {
    app: 'companion',
    version: 2,
    exported: new Date().toISOString(),
    settings: { url: 'http://url-del-backup:5001', user: 'Otro' },
    characters: [
      makeCharacter({ id: 'existente', name: 'Nombre actualizado' }),
      makeCharacter({ id: 'nuevo', name: 'Personaje nuevo' }),
    ],
    chats: {
      'chat-1': {
        id: 'chat-1', characterId: 'existente', title: 'Del backup', scenario: '',
        created: 1, updated: 1, last: 'hola de backup', lastExportAt: 0,
      },
    },
    chatMessages: {
      'chat-1': [{ role: 'user', text: 'hola de backup', ts: 1 }],
    },
  };
  const backupFile = { async text() { return JSON.stringify(backupPayload); } };

  const result = await state.importBackup(backupFile);
  assert.deepEqual(result, { characters: 2 });

  const settings = await state.getSettings();
  assert.equal(settings.url, 'http://mi-url-actual:5001'); // no se pisó
  assert.equal(settings.user, ''); // no se restauraron ajustes del backup

  const existente = await state.getCharacter('existente');
  assert.equal(existente.name, 'Nombre actualizado');

  const nuevo = await state.getCharacter('nuevo');
  assert.ok(nuevo);

  const chat = await state.getChat('chat-1');
  assert.equal(chat.title, 'Del backup');
  const messages = await state.getChatMessages('chat-1');
  assert.equal(messages[0].text, 'hola de backup');
});

test('importBackup acepta copias del formato viejo (v1: un chat por personaje)', async () => {
  const state = createState(createMemoryBackend());
  await state.saveSettings({ url: 'http://mi-url-actual:5001' });

  const backupPayload = {
    app: 'companion',
    version: 1,
    exported: new Date().toISOString(),
    settings: {},
    characters: [makeCharacter({ id: 'existente', name: 'Nombre viejo' })],
    chats: {
      existente: [{ role: 'user', text: 'hola de backup viejo', ts: 1 }],
    },
  };
  const backupFile = { async text() { return JSON.stringify(backupPayload); } };

  const result = await state.importBackup(backupFile);
  assert.deepEqual(result, { characters: 1 });

  const chats = await state.listChats('existente');
  assert.equal(chats.length, 1);
  assert.equal(chats[0].title, 'Chat restaurado');

  const messages = await state.getChatMessages(chats[0].id);
  assert.equal(messages[0].text, 'hola de backup viejo');
});

test('importBackup rechaza un archivo que no es una copia de seguridad válida', async () => {
  const state = createState(createMemoryBackend());
  const badFile = { async text() { return JSON.stringify({ foo: 'bar' }); } };
  await assert.rejects(() => state.importBackup(badFile));
});
