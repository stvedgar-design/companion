// www/js/diagnostics/dataphases.js
// UI-005: fases del banco de pruebas de estrés que solo tocan DATOS (sin DOM). Reciben `state` (la API de `createState`) y
// `now` por parámetro: en la app `state` es SIEMPRE el del almacén aislado (`isolated.js`, base de datos aparte), nunca el real;
// en los tests, un backend en memoria. Ninguna función de aquí importa la instancia por defecto de state.js.

import { makeMessages, makeSyntheticCharacter } from './synth.js';

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Borra TODOS los personajes (y sus chats) del `state` recibido. Se usa para limpiar los datos temporales. */
export async function wipeAll(state) {
  for (const c of await state.listCharacters()) await state.deleteCharacter(c.id);
}

/** Fase "chats largos" (parte de datos): crea un chat por tamaño y mide generar, guardar y leer. */
export async function dataChats({ state, sizes, now = defaultNow }) {
  const rows = [];
  const messagesBySize = {};
  for (let i = 0; i < sizes.length; i++) {
    const size = sizes[i];
    let t = now();
    const messages = makeMessages(size, { seed: 42 });
    const genMs = now() - t;
    const character = makeSyntheticCharacter(100 + i);
    await state.saveCharacter(character);
    const chat = await state.createChat(character.id, { title: `prueba ${size}` });
    t = now();
    await state.saveChatMessages(chat.id, messages);
    const saveMs = now() - t;
    t = now();
    const loaded = await state.getChatMessages(chat.id);
    const loadMs = now() - t;
    rows.push({ size, genMs, saveMs, loadMs, sizeKB: Math.round(JSON.stringify(messages).length / 1024), loaded: loaded ? loaded.length : 0 });
    messagesBySize[size] = messages;
  }
  return { rows, messagesBySize };
}

/**
 * Fase "ráfaga": `count` mensajes seguidos en un chat temporal. Guarda el chat COMPLETO tras cada mensaje (como hace la app) y
 * mide cada guardado; `renderStep(i, message, messages)` (opcional, lo pone la capa de DOM) devuelve el tiempo (ms) de dibujar ese mensaje.
 */
export async function dataBurst({ state, count, renderStep, now = defaultNow }) {
  const character = makeSyntheticCharacter(200);
  await state.saveCharacter(character);
  const chat = await state.createChat(character.id, { title: 'ráfaga' });
  const source = makeMessages(count, { seed: 99 });
  const messages = [];
  const saveTimes = [];
  const renderTimes = [];
  for (let i = 0; i < source.length; i++) {
    messages.push(source[i]);
    const t = now();
    await state.saveChatMessages(chat.id, messages);
    saveTimes.push(now() - t);
    if (renderStep) renderTimes.push(await renderStep(i, source[i], messages));
  }
  return { count: source.length, saveTimes, renderTimes, stored: (await state.getChatMessages(chat.id) || []).length };
}

/** Fase "lista de personajes" (parte de datos): crea `count` personajes con imagen y mide escribirlos y leerlos. */
export async function dataHub({ state, count, makeAvatar, now = defaultNow }) {
  await wipeAll(state);
  let t = now();
  for (let i = 0; i < count; i++) {
    await state.saveCharacter(makeSyntheticCharacter(i, makeAvatar ? makeAvatar(i) : ''));
  }
  const writeMs = now() - t;
  t = now();
  const characters = await state.listCharacters();
  const listMs = now() - t;
  return { count, writeMs, listMs, characters };
}

/**
 * Fase "copia de seguridad": crea datos de prueba, exporta la copia, borra todo, la importa y verifica que vuelva igual.
 * Devuelve tiempos, tamaño y si los conteos coinciden.
 */
export async function dataBackup({ state, characters = 10, chats = 5, perChat = 300, makeAvatar, now = defaultNow }) {
  await wipeAll(state);
  let totalMessages = 0;
  for (let i = 0; i < characters; i++) {
    const ch = makeSyntheticCharacter(300 + i, makeAvatar ? makeAvatar(i) : '');
    await state.saveCharacter(ch);
    if (i < chats) {
      const chat = await state.createChat(ch.id, { title: `copia ${i}` });
      const msgs = makeMessages(perChat, { seed: 500 + i });
      await state.saveChatMessages(chat.id, msgs);
      totalMessages += msgs.length;
    }
  }
  let t = now();
  const blob = await state.exportBackup();
  const exportMs = now() - t;
  const text = await blob.text();
  const sizeKB = Math.round(text.length / 1024);
  await wipeAll(state);
  t = now();
  await state.importBackup({ async text() { return text; } });
  const importMs = now() - t;
  const back = await state.listCharacters();
  let backMessages = 0;
  let backChats = 0;
  for (const c of back) {
    for (const chat of await state.listChats(c.id)) {
      backChats++;
      backMessages += ((await state.getChatMessages(chat.id)) || []).length;
    }
  }
  const ok = back.length === characters && backChats === chats && backMessages === totalMessages;
  return { characters, chats, messages: totalMessages, sizeKB, exportMs, importMs, ok };
}
