// www/js/ui/chats.js
// Lista de chats de un personaje (adenda "varios chats por personaje").
// Mismo patrón init/show/hide que las demás vistas.

import { getCharacter, listChats, createChat, deleteChat, renameChat } from '../state.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';
const ICON_EDIT = '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z"/></svg>';

const SCENARIO_MAX = 500;

let app = null;
let els = {};
let character = null;
let chats = [];

export function init(root, appApi) {
  app = appApi;

  root.innerHTML = `
    <div class="topbar">
      <button class="ib" type="button" id="chats-back" aria-label="Volver">${ICON_BACK}</button>
      <div class="av av--sm" id="chats-head-av"></div>
      <b class="topbar__title" id="chats-head-name"></b>
    </div>
    <div class="scroll">
      <div id="chats-list"></div>
    </div>
    <div class="footbar">
      <button class="btn" id="chats-add" type="button">+ Nuevo chat en este escenario</button>
    </div>
  `;

  els = {
    back: root.querySelector('#chats-back'),
    headAv: root.querySelector('#chats-head-av'),
    headName: root.querySelector('#chats-head-name'),
    list: root.querySelector('#chats-list'),
    add: root.querySelector('#chats-add'),
  };

  els.back.addEventListener('click', () => app.back());
  els.add.addEventListener('click', onAddClick);
}

export async function show({ characterId } = {}) {
  character = await getCharacter(characterId);
  if (!character) {
    app.toast('No se encontró ese personaje.');
    app.back();
    return;
  }

  els.headName.textContent = character.name;
  setAvatar(els.headAv, character);

  chats = await listChats(characterId);

  if (!chats.length) {
    // Caso normal: personaje recién creado o recién migrado, sin chats
    // todavía. Se crea uno solo y se entra directo, sin paso extra.
    try {
      const chat = await createChat(characterId, {});
      app.navigate('chat', { chatId: chat.id }, { replace: true });
    } catch (err) {
      app.toast('No se pudo crear el chat.');
    }
    return;
  }

  renderList();
}

export function hide() {
  // Sin estado que limpiar: cada `show()` vuelve a cargar todo.
}

function setAvatar(el, ch) {
  el.replaceChildren();
  if (ch && ch.avatar) {
    const img = document.createElement('img');
    img.src = ch.avatar;
    img.alt = '';
    el.appendChild(img);
  } else {
    const span = document.createElement('span');
    span.textContent = ((ch && ch.name) || '?').trim().charAt(0).toUpperCase();
    el.appendChild(span);
  }
}

function renderList() {
  els.list.innerHTML = '';

  if (!chats.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = 'Todavía no hay chats.<br>Toca «+ Nuevo chat» abajo para empezar uno.';
    els.list.appendChild(empty);
    return;
  }

  chats.forEach(renderRow);
}

function renderRow(chat) {
  const row = document.createElement('div');
  row.className = 'list-row';
  row.setAttribute('role', 'button');
  row.tabIndex = 0;

  const avatar = document.createElement('div');
  avatar.className = 'av av--md';
  setAvatar(avatar, character);

  const main = document.createElement('div');
  main.className = 'list-row__main';

  const title = document.createElement('div');
  title.className = 'list-row__title';
  title.textContent = chat.title || formatDate(chat.created);

  const sub = document.createElement('div');
  sub.className = 'list-row__sub';
  sub.textContent = chat.last || 'Sin mensajes';

  main.appendChild(title);
  main.appendChild(sub);

  const rename = document.createElement('button');
  rename.className = 'ib';
  rename.type = 'button';
  rename.setAttribute('aria-label', 'Renombrar chat');
  rename.innerHTML = ICON_EDIT;
  rename.addEventListener('click', (e) => {
    e.stopPropagation();
    onRename(chat);
  });

  const del = document.createElement('button');
  del.className = 'ib';
  del.type = 'button';
  del.setAttribute('aria-label', 'Borrar chat');
  del.innerHTML = ICON_TRASH;
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(chat);
  });

  row.appendChild(avatar);
  row.appendChild(main);
  row.appendChild(rename);
  row.appendChild(del);

  const open = () => app.navigate('chat', { chatId: chat.id });
  row.addEventListener('click', open);
  row.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      open();
    }
  });

  els.list.appendChild(row);
}

function onRename(chat) {
  const wrap = document.createElement('div');

  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = 'Renombrar chat';
  wrap.appendChild(title);

  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <label class="field__label" for="rename-chat-title">Título</label>
    <input class="inp" id="rename-chat-title" type="text" autocomplete="off" maxlength="60">
  `;
  wrap.appendChild(field);

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Guardar';
  wrap.appendChild(saveBtn);

  const input = field.querySelector('#rename-chat-title');
  input.value = chat.title || '';

  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      await renameChat(chat.id, input.value.trim());
      app.closeSheet();
      chats = await listChats(character.id);
      renderList();
    } catch (err) {
      app.toast('No se pudo renombrar el chat.');
      saveBtn.disabled = false;
    }
  });

  app.openSheet(wrap);
  input.focus();
}

async function onDelete(chat) {
  const label = chat.title || formatDate(chat.created);
  const ok = await app.confirmDialog(`¿Borrar el chat "${label}"?`, {
    danger: true,
    confirmText: 'Borrar',
  });
  if (!ok) return;

  await deleteChat(chat.id);
  chats = await listChats(character.id);
  renderList();
}

async function onAddClick() {
  const wrap = document.createElement('div');

  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = 'Nuevo chat';
  wrap.appendChild(title);

  const titleField = document.createElement('div');
  titleField.className = 'field';
  titleField.innerHTML = `
    <label class="field__label" for="newchat-title">Título (opcional)</label>
    <input class="inp" id="newchat-title" type="text" autocomplete="off">
  `;
  wrap.appendChild(titleField);

  const scenarioField = document.createElement('div');
  scenarioField.className = 'field';
  scenarioField.innerHTML = `
    <label class="field__label" for="newchat-scenario">Escenario (opcional)</label>
    <textarea class="inp" id="newchat-scenario" rows="4" maxlength="${SCENARIO_MAX}"
      placeholder="Ej: Meet at a rainy train station at midnight. Escríbelo en inglés: el modelo entiende mejor ese idioma."></textarea>
    <div class="field__hint">
      Se suma al escenario del personaje, no lo reemplaza. Puedes dejarlo vacío para un chat normal.
      Mejor en inglés (el modelo responde mejor) y corto, para no gastar de más el contexto.
      <span id="newchat-scenario-count">0/${SCENARIO_MAX}</span>
    </div>
  `;
  wrap.appendChild(scenarioField);

  const scenarioCount = scenarioField.querySelector('#newchat-scenario-count');
  scenarioField.querySelector('#newchat-scenario').addEventListener('input', (e) => {
    scenarioCount.textContent = `${e.target.value.length}/${SCENARIO_MAX}`;
  });

  const createBtn = document.createElement('button');
  createBtn.type = 'button';
  createBtn.className = 'btn';
  createBtn.textContent = 'Crear';
  wrap.appendChild(createBtn);

  const titleInput = titleField.querySelector('#newchat-title');
  const scenarioInput = scenarioField.querySelector('#newchat-scenario');

  createBtn.addEventListener('click', async () => {
    createBtn.disabled = true;
    try {
      const chat = await createChat(character.id, {
        title: titleInput.value.trim(),
        scenario: scenarioInput.value.trim(),
      });
      app.closeSheet();
      app.navigate('chat', { chatId: chat.id });
    } catch (err) {
      app.toast('No se pudo crear el chat.');
      createBtn.disabled = false;
    }
  });

  app.openSheet(wrap);
}

function formatDate(ts) {
  if (!ts) return 'Sin fecha';
  try {
    return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  } catch {
    return 'Sin fecha';
  }
}
