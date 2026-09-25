// tests/state.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createState } from '../www/js/state.js';
import { cleanStoredLorebook } from '../www/js/api/lorebook.js';

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
    theme: 'nomi', themeMode: 'dark',
    lorebookAuto: false,
    varietyAssist: false,
    formatAssist: true,
  });
});

test('saveSettings valida apariencia: skin y modo', async () => {
  const state = createState(createMemoryBackend());
  const saved = await state.saveSettings({ theme: 'imessage', themeMode: 'light' });
  assert.equal(saved.theme, 'imessage');
  assert.equal(saved.themeMode, 'light');

  const reloaded = await state.getSettings();
  assert.deepEqual(reloaded, saved);
});

test('saveSettings acepta los tres skins válidos', async () => {
  const state = createState(createMemoryBackend());
  for (const theme of ['nomi', 'glass', 'imessage']) {
    const saved = await state.saveSettings({ theme });
    assert.equal(saved.theme, theme);
  }
});

test('saveSettings descarta un theme o themeMode inválido y vuelve al valor por defecto', async () => {
  const state = createState(createMemoryBackend());
  const saved = await state.saveSettings({ theme: 'inventado', themeMode: 'inventado' });
  assert.equal(saved.theme, 'nomi');
  assert.equal(saved.themeMode, 'dark');
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
  assert.equal(chat.lorebookMessageCount, 0);

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

// ---------- lorebook automático por personaje (docs/NOTES.md) ----------

test('saveCharacterLorebook guarda las entradas del personaje', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));

  const lorebook = [{ id: 'l1', keys: ['café'], content: 'Se conocieron en un café.', updated: 1, source: 'auto' }];
  const updated = await state.saveCharacterLorebook('x', lorebook);
  assert.deepEqual(updated.lorebook, lorebook);

  const fetched = await state.getCharacter('x');
  assert.deepEqual(fetched.lorebook, lorebook);
});

test('saveCharacterLorebook contra un personaje inexistente lanza', async () => {
  const state = createState(createMemoryBackend());
  await assert.rejects(() => state.saveCharacterLorebook('no-existe', []));
});

test('el lorebook de un personaje es compartido entre todos sus chats', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const a = await state.createChat('x', { title: 'A' });
  const b = await state.createChat('x', { title: 'B' });

  const lorebook = [{ id: 'l1', keys: ['tema'], content: 'Un hecho compartido.', updated: 1, source: 'auto' }];
  await state.saveCharacterLorebook('x', lorebook);

  // Da igual desde qué chat se actualizó: lo ve cualquier chat del mismo personaje.
  assert.equal(a.characterId, 'x');
  assert.equal(b.characterId, 'x');
  const character = await state.getCharacter('x');
  assert.deepEqual(character.lorebook, lorebook);
});

test('markChatLorebookProgress avanza lorebookMessageCount de ese chat, sin tocar otros chats', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const a = await state.createChat('x', { title: 'A' });
  const b = await state.createChat('x', { title: 'B' });

  const updated = await state.markChatLorebookProgress(a.id, 40);
  assert.equal(updated.lorebookMessageCount, 40);

  const fetchedA = await state.getChat(a.id);
  assert.equal(fetchedA.lorebookMessageCount, 40);
  const fetchedB = await state.getChat(b.id);
  assert.equal(fetchedB.lorebookMessageCount, 0); // otro chat del mismo personaje no se toca
});

test('markChatLorebookProgress contra un chat inexistente lanza', async () => {
  const state = createState(createMemoryBackend());
  await assert.rejects(() => state.markChatLorebookProgress('no-existe', 40));
});

// ---------- fondo de chat por personaje (docs/NOTES.md) ----------

test('saveCharacterBackground guarda y valida los campos, con merge parcial', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));

  const withImage = await state.saveCharacterBackground('x', {
    chatBackground: 'data:image/jpeg;base64,AAAA',
    chatBackgroundBrightness: 999,
    chatBackgroundFade: true,
    chatBackgroundFit: 'stretch',
  });
  assert.equal(withImage.chatBackground, 'data:image/jpeg;base64,AAAA');
  assert.equal(withImage.chatBackgroundBrightness, 180); // recortado al máximo
  assert.equal(withImage.chatBackgroundFade, true);
  assert.equal(withImage.chatBackgroundFit, 'stretch');

  // Merge parcial: cambiar solo el brillo no debe tocar el resto.
  const dimmer = await state.saveCharacterBackground('x', { chatBackgroundBrightness: 60 });
  assert.equal(dimmer.chatBackgroundBrightness, 60);
  assert.equal(dimmer.chatBackground, 'data:image/jpeg;base64,AAAA');
  assert.equal(dimmer.chatBackgroundFade, true);
  assert.equal(dimmer.chatBackgroundFit, 'stretch');

  const fetched = await state.getCharacter('x');
  assert.deepEqual(fetched, dimmer);
});

test('saveCharacterBackground contra un personaje inexistente lanza', async () => {
  const state = createState(createMemoryBackend());
  await assert.rejects(() => state.saveCharacterBackground('no-existe', { chatBackground: 'x' }));
});

test('el fondo de un personaje no afecta a otro personaje', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  await state.saveCharacter(makeCharacter({ id: 'y' }));

  await state.saveCharacterBackground('x', { chatBackground: 'data:image/jpeg;base64,X' });

  const x = await state.getCharacter('x');
  const y = await state.getCharacter('y');
  assert.equal(x.chatBackground, 'data:image/jpeg;base64,X');
  assert.equal(y.chatBackground, '');
});

test('un personaje guardado antes de esta feature (sin lorebook ni fondo) sigue cargando con valores por defecto seguros', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  // Simula un personaje guardado por una versión anterior de la app: sin `lorebook` ni campos de fondo.
  backend._raw.characters.set('viejo', {
    id: 'viejo', name: 'Viejo', avatar: '',
    card: { name: 'Viejo', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null },
    avatarMode: 'mini', created: 1,
  });

  const character = await state.getCharacter('viejo');
  assert.deepEqual(character.lorebook, []);
  assert.equal(character.chatBackground, '');
  assert.equal(character.chatBackgroundBrightness, 100);
  assert.equal(character.chatBackgroundFade, false);
  assert.equal(character.chatBackgroundFit, 'fill');

  const list = await state.listCharacters();
  assert.deepEqual(list[0].lorebook, []);
});

test('un personaje guardado cuando el fondo todavía era global (settings) sigue cargando bien', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  // Simula un ajuste guardado por una versión anterior de la app, cuando
  // chatBackground* vivía en Settings en vez de en Character.
  backend._raw.settings.set('main', {
    url: '', user: '', maxLen: 220, temp: 0.85, mode: 'chat', ctx: 4096,
    pinSalt: '', pinHash: '', theme: 'glass', themeMode: 'dark',
    chatBackground: 'data:image/jpeg;base64,VIEJO', chatBackgroundBrightness: 70,
    chatBackgroundFade: true, chatBackgroundFit: 'stretch',
  });

  const settings = await state.getSettings();
  assert.equal(settings.theme, 'glass'); // los campos que siguen en Settings no se pierden
  assert.equal(settings.chatBackground, undefined); // el campo viejo simplemente no está en la Settings normalizada
});

test('un chat guardado antes de esta feature (sin lorebookMessageCount) sigue cargando con valores por defecto seguros', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  backend._raw.chatMeta.set('viejo', {
    id: 'viejo', characterId: 'x', title: '', scenario: '',
    created: 1, updated: 1, last: '', lastExportAt: 0,
  });

  const chat = await state.getChat('viejo');
  assert.equal(chat.lorebookMessageCount, 0);
});

test('getCharacter descarta entradas de lorebook con forma inválida en vez de romperse', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('x', {
    id: 'x', name: 'X', avatar: '',
    card: { name: 'X', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null },
    avatarMode: 'mini', created: 1,
    lorebook: [
      { id: 'ok', keys: ['a'], content: 'Válida', updated: 1, source: 'auto' },
      { id: 'sin-keys', keys: [], content: 'Sin keys' },
      { id: 'sin-content', keys: ['b'], content: '' },
      'no es un objeto',
      null,
    ],
  });

  const character = await state.getCharacter('x');
  assert.equal(character.lorebook.length, 1);
  assert.equal(character.lorebook[0].content, 'Válida');
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

// ---------- MEM-001 v2: lorebookPrevious (un nivel de "Deshacer") ----------

test('un personaje sin lorebookPrevious carga con [] y lorebookPreviousAt 0', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  backend._raw.characters.set('viejo', {
    id: 'viejo', name: 'Viejo', avatar: '',
    card: { name: 'Viejo', description: '', personality: '', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null },
    avatarMode: 'mini', created: 1,
    lorebook: [{ id: 'l1', keys: ['a'], content: 'Un recuerdo.', updated: 1, source: 'auto' }],
  });
  const character = await state.getCharacter('viejo');
  assert.deepEqual(character.lorebookPrevious, []);
  assert.equal(character.lorebookPreviousAt, 0);
  assert.equal(character.lorebook.length, 1); // lo existente no cambia
  assert.deepEqual((await state.listCharacters())[0].lorebookPrevious, []);
});

test('saveCharacterLorebook con `previous` guarda la copia para deshacer; sin él la deja como estaba; con null la borra', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const before = [{ id: 'l1', keys: ['a'], content: 'Antes.', updated: 1, source: 'auto' }];
  const after = [...before, { id: 'l2', keys: ['b'], content: 'Después.', updated: 2, source: 'auto' }];

  await state.saveCharacterLorebook('x', before);
  const withPrev = await state.saveCharacterLorebook('x', after, before);
  assert.deepEqual(withPrev.lorebook, after);
  assert.deepEqual(withPrev.lorebookPrevious, before);
  assert.ok(withPrev.lorebookPreviousAt > 0);

  // Una edición manual posterior (sin `previous`) no pisa la copia de deshacer.
  const edited = await state.saveCharacterLorebook('x', [after[1]]);
  assert.deepEqual(edited.lorebookPrevious, before);
  assert.equal(edited.lorebookPreviousAt, withPrev.lorebookPreviousAt);

  // Deshacer: se restaura la copia y se consume.
  const undone = await state.saveCharacterLorebook('x', before, null);
  assert.deepEqual(undone.lorebook, before);
  assert.deepEqual(undone.lorebookPrevious, []);
  assert.equal(undone.lorebookPreviousAt, 0);
});

test('una copia de deshacer con el lorebook anterior VACÍO se distingue de "no hay copia"', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const entry = { id: 'l1', keys: ['a'], content: 'Primera actualización.', updated: 1, source: 'auto' };
  const saved = await state.saveCharacterLorebook('x', [entry], []);
  assert.deepEqual(saved.lorebookPrevious, []);
  assert.ok(saved.lorebookPreviousAt > 0);
});

test('guardar el lorebook no pisa un chatBackground* ni un avatar cambiados entretanto', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));

  // La extracción "empezó" con una copia vieja del personaje en memoria…
  const stale = await state.getCharacter('x');
  // …y mientras tanto el usuario cambió el fondo y el avatar.
  await state.saveCharacterBackground('x', { chatBackground: 'data:image/jpeg;base64,NUEVO', chatBackgroundBrightness: 60 });
  const withAvatar = await state.getCharacter('x');
  await state.saveCharacter({ ...withAvatar, avatar: 'data:image/png;base64,AVATAR' });

  const entry = { id: 'l1', keys: ['a'], content: 'Un recuerdo.', updated: 1, source: 'auto' };
  await state.saveCharacterLorebook(stale.id, [entry], []);

  const after = await state.getCharacter('x');
  assert.deepEqual(after.lorebook, [entry]);
  assert.equal(after.chatBackground, 'data:image/jpeg;base64,NUEVO');
  assert.equal(after.chatBackgroundBrightness, 60);
  assert.equal(after.avatar, 'data:image/png;base64,AVATAR');
});

test('MEM-002: lorebookAuto es false por defecto y solo acepta true estricto', async () => {
  const state = createState(createMemoryBackend());
  assert.equal((await state.getSettings()).lorebookAuto, false);
  assert.equal((await state.saveSettings({ lorebookAuto: 'true' })).lorebookAuto, false);
  assert.equal((await state.saveSettings({ lorebookAuto: 1 })).lorebookAuto, false);
  assert.equal((await state.saveSettings({ lorebookAuto: true })).lorebookAuto, true);
  // merge parcial: otro cambio no lo apaga
  assert.equal((await state.saveSettings({ temp: 1.0 })).lorebookAuto, true);
  assert.equal((await state.getSettings()).lorebookAuto, true);
});

test('MEM-002: Settings guardados sin el campo (instalación o copia anterior) cargan con lorebookAuto=false', async () => {
  const backend = createMemoryBackend();
  await backend.put('settings', 'main', { url: 'http://100.1.1.1:5001', user: 'Ada', theme: 'glass' });
  const state = createState(backend);
  const settings = await state.getSettings();
  assert.equal(settings.lorebookAuto, false);
  assert.equal(settings.user, 'Ada');
});

test('MEM-002: una copia v2 sin lorebookAuto (Settings antiguos) sigue importando', async () => {
  const state = createState(createMemoryBackend());
  const backup = {
    app: 'companion', version: 2, exported: 1, settings: { url: '', user: 'Ada' },
    characters: [{ id: 'c1', name: 'Mia', card: {}, created: 1 }], chats: [], chatMessages: {},
  };
  await state.importBackup({ text: async () => JSON.stringify(backup) });
  assert.equal((await state.listCharacters()).length, 1);
  assert.equal((await state.getSettings()).lorebookAuto, false);
});

// ---------- MEM-003: "Limpiar recuerdos" guarda copia y el deshacer restaura ----------

test('Limpiar recuerdos: guarda lorebookPrevious con el estado anterior y "deshacer" lo restaura', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const e = (id, keys, content, source = 'auto') => ({ id, keys, content, updated: 1, source });
  const original = [
    e('a', ['fact'], 'U loves physical touch and enjoys the closeness with C'),
    e('b', ['person who loves physical touch'], 'U loves physical touch'),
    e('c', ['factory scent'], "C smells like 'a clean, modern factory' to U"),
    e('m', ['Cosa Mía'], 'Texto escrito a mano por el usuario.', 'manual'),
  ];
  await state.saveCharacterLorebook('x', original);

  const result = await cleanStoredLorebook({
    load: async () => (await state.getCharacter('x')).lorebook,
    save: (entries, previous) => state.saveCharacterLorebook('x', entries, previous),
    names: ['U', 'C'],
  });
  assert.equal(result.changed, true);
  assert.equal(result.merged, 1);

  const cleaned = await state.getCharacter('x');
  assert.equal(cleaned.lorebook.length, 3);
  assert.deepEqual(cleaned.lorebook.find((x) => x.id === 'm'), original[3]); // la manual, intacta
  assert.deepEqual(cleaned.lorebook.find((x) => /factory/.test(x.content)).keys, ['factory', 'scent']);
  assert.deepEqual(cleaned.lorebookPrevious, original);
  assert.ok(cleaned.lorebookPreviousAt > 0);

  // "Deshacer última actualización" (misma llamada que usa chat.js).
  const undone = await state.saveCharacterLorebook('x', cleaned.lorebookPrevious, null);
  assert.deepEqual(undone.lorebook, original);
  assert.equal(undone.lorebookPreviousAt, 0);

  // Sin nada que limpiar no se escribe nada: la copia anterior no se pisa.
  await state.saveCharacterLorebook('x', cleaned.lorebook, original);
  const again = await cleanStoredLorebook({
    load: async () => (await state.getCharacter('x')).lorebook,
    save: (entries, previous) => state.saveCharacterLorebook('x', entries, previous),
    names: ['U', 'C'],
  });
  assert.equal(again.changed, false);
  assert.deepEqual((await state.getCharacter('x')).lorebookPrevious, original);
});

// ---------- MEM-004: LoreEntry.always ----------

test('MEM-004: una entrada sin `always` (copias y personajes anteriores) carga idéntica, sin campo nuevo', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const old = [{ id: 'l1', keys: ['café'], content: 'Se conocieron en un café.', updated: 1, source: 'auto' }];
  await state.saveCharacterLorebook('x', old);
  const loaded = (await state.getCharacter('x')).lorebook;
  assert.deepEqual(loaded, old);
  assert.ok(!('always' in loaded[0]));
});

test('MEM-004: `always` solo se conserva si es exactamente true; basura o false se descarta', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  const e = (id, always) => ({ id, keys: ['k'], content: 'Un recuerdo válido.', updated: 1, source: 'manual', always });
  await state.saveCharacterLorebook('x', [e('a', true), e('b', false), e('c', 'yes'), e('d', 1), e('e', null), e('f', undefined)]);
  const byId = Object.fromEntries((await state.getCharacter('x')).lorebook.map((x) => [x.id, x]));
  assert.equal(byId.a.always, true);
  for (const id of ['b', 'c', 'd', 'e', 'f']) assert.ok(!('always' in byId[id]), id);
});

test('MEM-004: una entrada `always` es siempre `manual`, aunque llegue como `auto` (p. ej. de una copia ajena)', async () => {
  const state = createState(createMemoryBackend());
  await state.saveCharacter(makeCharacter({ id: 'x' }));
  await state.saveCharacterLorebook('x', [{ id: 'a', keys: ['k'], content: 'Importante.', updated: 1, source: 'auto', always: true }]);
  const [entry] = (await state.getCharacter('x')).lorebook;
  assert.equal(entry.always, true);
  assert.equal(entry.source, 'manual');
});

test('MEM-004: un personaje importado en una copia sin `always` conserva su lorebook tal cual', async () => {
  const backend = createMemoryBackend();
  const state = createState(backend);
  const character = makeCharacter({ id: 'x', lorebook: [{ id: 'l1', keys: ['tema'], content: 'Un hecho.', updated: 1, source: 'auto' }] });
  const backup = { app: 'companion', version: 2, exported: 1, settings: null, characters: [character], chats: [], chatMessages: {} };
  const result = await state.importBackup({ text: async () => JSON.stringify(backup) });
  assert.ok(result);
  assert.deepEqual((await state.getCharacter('x')).lorebook, character.lorebook);
});

test('FMT-004: varietyAssist es false por defecto y solo acepta true estricto; copias previas cargan bien', async () => {
  const state = createState(createMemoryBackend());
  assert.equal((await state.getSettings()).varietyAssist, false);
  assert.equal((await state.saveSettings({ varietyAssist: 'true' })).varietyAssist, false);
  assert.equal((await state.saveSettings({ varietyAssist: 1 })).varietyAssist, false);
  assert.equal((await state.saveSettings({ varietyAssist: true })).varietyAssist, true);
  // Un registro guardado antes de este ajuste (sin el campo) carga con el valor por defecto.
  const backend = createMemoryBackend();
  await backend.put('settings', 'main', { url: 'http://x', user: 'Sam', lorebookAuto: true });
  const old = await createState(backend).getSettings();
  assert.equal(old.varietyAssist, false);
  assert.equal(old.lorebookAuto, true);
  assert.equal(old.user, 'Sam');
});

// ---------- FMT-002: Settings.formatAssist ----------

test('FMT-002: formatAssist es true por defecto y solo un false estricto lo apaga', async () => {
  const state = createState(createMemoryBackend());
  assert.equal((await state.getSettings()).formatAssist, true);
  assert.equal((await state.saveSettings({ formatAssist: 0 })).formatAssist, true);
  assert.equal((await state.saveSettings({ formatAssist: 'false' })).formatAssist, true);
  assert.equal((await state.saveSettings({ formatAssist: false })).formatAssist, false);
  // merge parcial: otro cambio no lo vuelve a encender
  assert.equal((await state.saveSettings({ temp: 1.0 })).formatAssist, false);
  assert.equal((await state.saveSettings({ formatAssist: true })).formatAssist, true);
});

test('FMT-002: Settings guardados sin el campo (instalación o copia anterior) cargan con formatAssist=true', async () => {
  const backend = createMemoryBackend();
  await backend.put('settings', 'main', { url: 'http://100.1.1.1:5001', user: 'Ada', theme: 'glass' });
  const state = createState(backend);
  const settings = await state.getSettings();
  assert.equal(settings.formatAssist, true);
  assert.equal(settings.user, 'Ada');
});

test('FMT-002: una copia v2 sin formatAssist sigue importando', async () => {
  const state = createState(createMemoryBackend());
  const backup = {
    app: 'companion', version: 2, exported: 1, settings: { url: '', user: 'Ada' },
    characters: [{ id: 'c1', name: 'Mia', card: {}, created: 1 }], chats: [], chatMessages: {},
  };
  await state.importBackup({ text: async () => JSON.stringify(backup) });
  assert.equal((await state.listCharacters()).length, 1);
  assert.equal((await state.getSettings()).formatAssist, true);
});
