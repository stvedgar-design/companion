// www/js/ui/home.js
// Vista de lista de personajes: chip de conexión, lista, búsqueda y carga de character cards.

import { getSettings, listCharacters, listChats, deleteCharacter } from '../state.js';
import { importCardFile } from '../cards/import.js';
import { connect } from '../api/kobold.js';
import { pickFiles } from '../platform.js';
import { openSettings } from './settings.js';

const ICON_SETTINGS = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>';
const ICON_TRASH = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/></svg>';

let app = null;
let els = {};
let characters = [];
let lastByCharacter = {};
let searchQuery = '';
let viewToken = 0; // se incrementa en hide(); invalida cualquier comprobación de conexión pendiente

export function init(root, appApi) {
  app = appApi;

  root.innerHTML = `
    <div class="topbar">
      <span class="topbar__title">Chats</span>
      <button class="ib" id="home-settings" aria-label="Ajustes">${ICON_SETTINGS}</button>
    </div>
    <button class="chip home-chip" id="home-chip" type="button"></button>
    <div class="scroll">
      <div class="field home-search" id="home-search-wrap" hidden>
        <input class="inp" id="home-search" type="text" placeholder="Buscar personaje" autocomplete="off">
      </div>
      <div class="home-grid" id="home-list"></div>
    </div>
    <div class="footbar">
      <button class="btn" id="home-add" type="button">Cargar character card</button>
    </div>
  `;

  els = {
    settingsBtn: root.querySelector('#home-settings'),
    chip: root.querySelector('#home-chip'),
    searchWrap: root.querySelector('#home-search-wrap'),
    search: root.querySelector('#home-search'),
    list: root.querySelector('#home-list'),
    add: root.querySelector('#home-add'),
  };

  els.settingsBtn.addEventListener('click', () => openSettings(app));
  els.chip.addEventListener('click', () => openSettings(app));
  els.add.addEventListener('click', onAddClick);
  els.search.addEventListener('input', () => {
    searchQuery = els.search.value.trim().toLowerCase();
    renderList();
  });
}

export async function show() {
  viewToken++;
  const myToken = viewToken;

  searchQuery = '';
  els.search.value = '';
  els.chip.className = 'chip home-chip';
  els.chip.textContent = 'Comprobando conexión…';

  characters = await listCharacters();
  lastByCharacter = await buildLastPreviews(characters);
  renderList();

  checkConnection(myToken);
}

// Trae, para cada personaje, el `last` del chat más reciente (si tiene
// alguno) para mostrarlo como vista previa en la tarjeta del hub.
async function buildLastPreviews(list) {
  const entries = await Promise.all(
    list.map(async (character) => {
      try {
        const chats = await listChats(character.id);
        return [character.id, chats.length ? chats[0].last : ''];
      } catch {
        return [character.id, ''];
      }
    })
  );
  return Object.fromEntries(entries);
}

export function hide() {
  viewToken++; // cualquier connect() en curso llegará tarde y se ignorará
}

function renderList() {
  els.searchWrap.hidden = characters.length <= 6;
  els.list.innerHTML = '';

  if (!characters.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.innerHTML = 'Todavía no hay personajes.<br>Toca «Cargar character card» abajo para empezar.';
    els.list.appendChild(empty);
    return;
  }

  const items = searchQuery
    ? characters.filter(c => c.name.toLowerCase().includes(searchQuery))
    : characters;

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Sin resultados para esa búsqueda.';
    els.list.appendChild(empty);
    return;
  }

  items.forEach(renderRow);
}

function renderRow(character) {
  const card = document.createElement('div');
  card.className = 'home-card';

  const avatar = document.createElement('div');
  avatar.className = 'home-card__avatar';
  if (character.avatar) {
    const img = document.createElement('img');
    img.src = character.avatar;
    img.alt = '';
    avatar.appendChild(img);
  } else {
    const initial = document.createElement('span');
    initial.textContent = (character.name || '?').trim().charAt(0).toUpperCase();
    avatar.appendChild(initial);
  }

  const del = document.createElement('button');
  del.className = 'ib home-card__del';
  del.type = 'button';
  del.setAttribute('aria-label', 'Borrar');
  del.innerHTML = ICON_TRASH;
  del.addEventListener('click', (e) => {
    e.stopPropagation();
    onDelete(character);
  });
  avatar.appendChild(del);

  const name = document.createElement('div');
  name.className = 'home-card__name';
  name.textContent = character.name;

  const sub = document.createElement('div');
  sub.className = 'home-card__sub';
  sub.textContent = lastByCharacter[character.id] || 'Sin mensajes';

  card.appendChild(avatar);
  card.appendChild(name);
  card.appendChild(sub);
  card.addEventListener('click', () => {
    app.navigate('chats', { characterId: character.id });
  });

  els.list.appendChild(card);
}

async function onDelete(character) {
  const ok = await app.confirmDialog(`¿Borrar a ${character.name} y todos sus chats?`, {
    danger: true,
    confirmText: 'Borrar',
  });
  if (!ok) return;

  await deleteCharacter(character.id);
  characters = await listCharacters();
  lastByCharacter = await buildLastPreviews(characters);
  renderList();
}

async function checkConnection(myToken) {
  const settings = await getSettings();
  if (myToken !== viewToken) return;

  try {
    const { model } = await connect(settings.url);
    if (myToken !== viewToken) return;
    els.chip.className = 'chip home-chip chip--ok';
    els.chip.textContent = 'Conectado · ' + model;
  } catch {
    if (myToken !== viewToken) return;
    els.chip.className = 'chip home-chip chip--err';
    els.chip.textContent = 'Sin conexión';
  }
}

async function onAddClick() {
  const files = await pickFiles({ multiple: true });
  if (!files.length) return;

  setAddBusy(true);
  try {
    let successCount = 0;
    let lastCharacter = null;

    for (const file of files) {
      try {
        lastCharacter = await importCardFile(file);
        successCount++;
      } catch (err) {
        app.toast(`${file.name}: ${err.message}`);
      }
    }

    if (successCount === 0) return;

    characters = await listCharacters();
    lastByCharacter = await buildLastPreviews(characters);
    renderList();

    if (successCount === 1) {
      app.navigate('chats', { characterId: lastCharacter.id });
    } else {
      app.toast(`${successCount} personajes cargados`);
    }
  } finally {
    setAddBusy(false);
  }
}

function setAddBusy(busy) {
  els.add.disabled = busy;
  els.add.textContent = busy ? 'Cargando…' : 'Cargar character card';
}
