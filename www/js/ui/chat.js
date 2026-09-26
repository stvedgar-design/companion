// www/js/ui/chat.js
// Pantalla de chat: burbujas, streaming, avatar en 3 modos, composer, menú.

import { getChat, getChatMessages, saveChatMessages, getCharacter, saveCharacter, getSettings, saveSettings, markChatExported, saveCharacterLorebook, markChatLorebookProgress, saveChatContinuity, sanitizeContinuity, sanitizeMessage } from '../state.js';
import { generateReplyNonEmpty, completeOnce, completeChatOnce } from '../api/kobold.js';
import { initialMessages, scenarioGreeting, estimateContextUsage } from '../api/prompt.js';
import {
  createLoreUpdater,
  editLoreEntry,
  removeLoreEntry,
  parseKeysInput,
  cleanStoredLorebook,
  loreBudgetPreview,
  loreIndicatorState,
  compareLoreUsed,
  LOREBOOK_UPDATE_EVERY_MESSAGES,
  LOREBOOK_MAX_ENTRY_CHARS,
  LOREBOOK_ALWAYS_CHAR_BUDGET,
} from '../api/lorebook.js';
import { relationshipSummary, relationshipAgeText } from '../api/relationship.js';
import { createContinuityUpdater, coveredCount, CONTINUITY_TOTAL_CHARS } from '../api/continuity.js';
import { openSettings } from './settings.js';
import { openAppearance } from './appearance.js';
import { openChatBackground } from './chat-background.js';
import { formatMessage } from './format.js';
import { variantCount, activeVariantIndex, addVariant, selectVariant, editActiveText } from '../variants.js';
import { MESSAGE_ACTIONS, availableMessageActions, revealDelta, shouldCloseOnScroll } from './msgmenu.js';
import { makeAvatar } from '../cards/avatar.js';
import { pickFiles, saveBlob, autoBackupBlob } from '../platform.js';
import { averageColorFromDataUrl } from '../images.js';
import { setGlassTint } from './shell.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_MENU = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
// UI-010: marcapáginas pequeño; gris = ningún recuerdo usado, color de acento = usó alguno.
const ICON_LORE = '<svg viewBox="0 0 24 24"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1z"/></svg>';
const ICON_RETRY = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';

const AVATAR_MODES = ['none', 'mini', 'large'];
const NEAR_BOTTOM_PX = 140;
const KEYBOARD_VH_RATIO = 0.75;

let root = null;
let app = null;
let els = {};

let character = null;
let chat = null;
let messages = [];
let settings = null;

let busy = false;
let abortCtl = null;

let atBottom = true;
let keyboardOpen = false;
let maxVh = 0;
let blurTimeoutId = null;

const draftByChat = new Map();

export function init(rootEl, appApi) {
  root = rootEl;
  app = appApi;

  root.innerHTML = `
    <div class="topbar">
      <button class="ib" type="button" id="chat-back" aria-label="Volver">${ICON_BACK}</button>
      <button class="chat-head" type="button" id="chat-head">
        <div class="av av--sm chat-head__av" id="chat-head-av" hidden></div>
        <b class="topbar__title chat-head__name" id="chat-head-name"></b>
      </button>
      <button class="ib" type="button" id="chat-menu" aria-label="Más">${ICON_MENU}</button>
    </div>
    <div class="chat-avatarpanel" id="chat-avatarpanel" hidden>
      <div class="av chat-avatarpanel__img" id="chat-avatarpanel-img"></div>
    </div>
    <div class="chat-messageswrap">
      <div class="chat-bg" id="chat-bg" hidden>
        <div class="chat-bg__fade" id="chat-bg-fade" hidden></div>
      </div>
      <div class="scroll chat-messages" id="chat-messages"></div>
      <button class="chat-scrolldown" type="button" id="chat-scrolldown" aria-label="Ir al último mensaje" hidden>${ICON_DOWN}</button>
    </div>
    <div class="chat-composer" id="chat-composer">
      <textarea class="inp chat-composer__input" id="chat-input" rows="1" placeholder="Escribe un mensaje" autocomplete="off" autocapitalize="sentences"></textarea>
      <button class="chat-send" type="button" id="chat-send" aria-label="Enviar">${ICON_SEND}</button>
    </div>
  `;

  els = {
    back: root.querySelector('#chat-back'),
    head: root.querySelector('#chat-head'),
    headAv: root.querySelector('#chat-head-av'),
    headName: root.querySelector('#chat-head-name'),
    menu: root.querySelector('#chat-menu'),
    avatarPanel: root.querySelector('#chat-avatarpanel'),
    avatarPanelImg: root.querySelector('#chat-avatarpanel-img'),
    bg: root.querySelector('#chat-bg'),
    bgFade: root.querySelector('#chat-bg-fade'),
    messages: root.querySelector('#chat-messages'),
    scrollDown: root.querySelector('#chat-scrolldown'),
    composer: root.querySelector('#chat-composer'),
    input: root.querySelector('#chat-input'),
    send: root.querySelector('#chat-send'),
  };

  els.back.addEventListener('click', onBack);
  els.head.addEventListener('click', onCycleAvatarMode);
  els.menu.addEventListener('click', onMenu);
  els.input.addEventListener('input', onInputChange);
  els.input.addEventListener('keydown', onInputKeydown);
  els.input.addEventListener('focus', onInputFocus);
  els.input.addEventListener('blur', onInputBlur);
  els.send.addEventListener('click', onSendClick);
  els.messages.addEventListener('click', onMessagesClick);
  els.messages.addEventListener('scroll', onMessagesScroll);
  els.scrollDown.addEventListener('click', () => scrollToBottom(true));

  // La hoja de fondo de chat (ui/chat-background.js) se abre encima de esta
  // vista, no la reemplaza — sin este evento, un cambio de fondo no se
  // vería hasta salir y volver a entrar al chat. El fondo es por personaje
  // (ver docs/NOTES.md, "Fondo de chat por personaje"): se ignora si llega
  // para un personaje distinto al que está abierto ahora mismo (no debería
  // pasar salvo alguna carrera rara, pero mejor chequearlo).
  document.addEventListener('companion:chatbackgroundchange', (e) => {
    if (!character || !e.detail || e.detail.id !== character.id) return;
    character = e.detail;
    applyChatBackground();
    updateGlassTint();
  });
}

function applyChatBackground() {
  const bg = character && character.chatBackground;
  if (!bg) {
    els.bg.hidden = true;
    els.bg.style.backgroundImage = '';
    return;
  }
  els.bg.hidden = false;
  els.bg.style.backgroundImage = `url("${bg}")`;
  els.bg.style.backgroundSize = character.chatBackgroundFit === 'stretch' ? '100% 100%' : 'cover';
  const brightness = Number.isFinite(character.chatBackgroundBrightness) ? character.chatBackgroundBrightness : 100;
  els.bg.style.filter = `brightness(${brightness}%)`;
  els.bgFade.hidden = !character.chatBackgroundFade;
}

// El tinte del skin "glass" (ver themes.css) responde al fondo del
// personaje actual mientras se lo está viendo — y vuelve al tinte por
// defecto del tema al salir del chat (hide()), para que el resto de la app
// (hub, ajustes) siga el fondo del skin, no el de un personaje puntual.
async function updateGlassTint() {
  const bg = character && character.chatBackground;
  if (!bg) {
    setGlassTint(null);
    return;
  }
  const rgb = await averageColorFromDataUrl(bg);
  setGlassTint(rgb);
}

export async function show({ chatId } = {}) {
  chat = await getChat(chatId);
  if (!chat) {
    app.toast('No se encontró ese chat.');
    app.back();
    return;
  }

  character = await getCharacter(chat.characterId);
  if (!character) {
    app.toast('No se encontró ese personaje.');
    app.back();
    return;
  }

  settings = await getSettings();

  let loaded = await getChatMessages(chat.id);
  if (!loaded) {
    // Si el chat tiene un escenario propio, el first_mes de la card (escrito
    // para el escenario por defecto) casi nunca encaja: se reemplaza por una
    // nota de escenario en vez de un saludo desalineado.
    loaded = chat.scenario
      ? scenarioGreeting(character, settings, chat.scenario)
      : initialMessages(character, settings);
    try {
      await saveChatMessages(chat.id, loaded);
    } catch (err) {
      app.toast('No se pudo crear la conversación.');
    }
  }
  messages = loaded;

  busy = false;
  abortCtl = null;
  keyboardOpen = false;
  maxVh = 0;

  els.headName.textContent = character.name;
  els.input.value = draftByChat.get(chat.id) || '';
  autosizeInput();
  syncSendButton();
  applyAvatarMode();
  applyChatBackground();
  updateGlassTint();
  renderMessages();

  attachViewportListeners();
  checkKeyboardFromVh();
}

export function hide() {
  if (busy) cancelGeneration();
  if (chat) {
    // El texto parcial recibido (si lo había) ya quedó en `messages`.
    persistChat();
  }
  clearTimeout(blurTimeoutId);
  detachViewportListeners();
  clearSelection();
  if (app) app.closeSheet();
  // El resto de la app (hub, ajustes) sigue el fondo del skin activo, no el
  // fondo de un personaje puntual — ver updateGlassTint().
  setGlassTint(null);
}

/* ---------- avatar en 3 modos ---------- */

function applyAvatarMode() {
  if (!character) return;
  const mode = character.avatarMode || 'mini';

  els.headAv.hidden = mode !== 'mini';
  if (mode === 'mini') setAvatarEl(els.headAv, character);

  const showLarge = mode === 'large';
  els.avatarPanel.hidden = !showLarge;
  if (showLarge) setAvatarEl(els.avatarPanelImg, character);
  els.avatarPanel.classList.toggle('chat-avatarpanel--collapsed', showLarge && keyboardOpen);
}

async function onCycleAvatarMode() {
  if (!character) return;
  const idx = AVATAR_MODES.indexOf(character.avatarMode || 'mini');
  const next = AVATAR_MODES[(idx + 1) % AVATAR_MODES.length];
  character.avatarMode = next;
  applyAvatarMode();
  try {
    character = await saveCharacter(character);
  } catch (err) {
    app.toast('No se pudo guardar la preferencia de avatar.');
  }
}

function setAvatarEl(el, ch) {
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

/* ---------- teclado / --vh ---------- */

function attachViewportListeners() {
  window.addEventListener('resize', checkKeyboardFromVh);
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', checkKeyboardFromVh);
  }
}

function detachViewportListeners() {
  window.removeEventListener('resize', checkKeyboardFromVh);
  if (window.visualViewport) {
    window.visualViewport.removeEventListener('resize', checkKeyboardFromVh);
  }
}

function checkKeyboardFromVh() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--vh');
  const px = parseFloat(raw);
  if (Number.isFinite(px) && px > 0) {
    if (px > maxVh) maxVh = px;
    const dropped = maxVh > 0 && px < maxVh * KEYBOARD_VH_RATIO;
    keyboardOpen = dropped || document.activeElement === els.input;
  } else {
    keyboardOpen = document.activeElement === els.input;
  }
  applyAvatarMode();
  scrollToBottom(false);
}

/* ---------- lista de mensajes ---------- */

function renderMessages() {
  clearSelection();
  els.messages.replaceChildren();
  messages.forEach((m, i) => {
    els.messages.appendChild(buildMessageRow(m, i));
  });
  if (!busy && messages.length && messages[messages.length - 1].role === 'user') {
    els.messages.appendChild(buildRetryButton());
  }
  scrollToBottom(true);
}

// UI-012: las comillas como señal de diálogo van con el interruptor "Corregir formato automáticamente".
function formatOpts(role) {
  return { role, quoteDialogue: !!settings && settings.formatAssist !== false };
}

function buildMessageRow(m, i) {
  const isLast = i === messages.length - 1;
  const row = document.createElement('div');
  row.className = 'chat-row ' + (m.role === 'user' ? 'chat-row--user' : 'chat-row--char');
  row.dataset.index = String(i);

  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (m.role === 'char' && !m.text && busy && isLast) {
    bubble.appendChild(buildDots());
  } else {
    bubble.innerHTML = formatMessage(m.text, formatOpts(m.role));
  }
  row.appendChild(bubble);

  // Línea bajo la burbuja: marcapáginas de memoria (UI-010) y, si hay varias versiones de la respuesta, el selector (UI-017).
  const loreState = loreIndicatorState(m);
  const showLore = loreState !== 'none' && !!m.text;
  const showVariants = m.role === 'char' && variantCount(m) > 1 && !!m.text;
  if (showLore || showVariants) {
    const meta = document.createElement('div');
    meta.className = 'chat-row__meta';
    if (showLore) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-lore chat-lore--' + (loreState === 'active' ? 'active' : 'muted');
      btn.dataset.lore = loreState;
      btn.setAttribute(
        'aria-label',
        loreState === 'active' ? `Este mensaje usó ${m.loreUsed.length} recuerdo(s). Ver cuáles` : 'Este mensaje no usó ningún recuerdo'
      );
      btn.innerHTML = ICON_LORE;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        openLoreUsedSheet(m);
      });
      meta.appendChild(btn);
    }
    if (showVariants) meta.appendChild(buildVariantNav(m, i)); // después del marcapáginas: este no cambia de sitio (UI-016)
    row.appendChild(meta);
  }

  return row;
}

// UI-017: `‹ 2/3 ›` bajo una respuesta con varias versiones. Navegar es instantáneo: no llama al servidor.
function buildVariantNav(m, i) {
  const n = variantCount(m);
  const at = activeVariantIndex(m);
  const nav = document.createElement('div');
  nav.className = 'chat-variants';
  nav.setAttribute('role', 'group');
  nav.setAttribute('aria-label', 'Versiones de la respuesta');
  const step = (label, text, delta, disabled) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chat-variants__btn';
    b.setAttribute('aria-label', label);
    b.textContent = text;
    b.disabled = disabled;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onVariantStep(i, delta);
    });
    return b;
  };
  const count = document.createElement('span');
  count.className = 'chat-variants__count';
  count.textContent = `${at + 1}/${n}`;
  count.setAttribute('aria-label', `Versión ${at + 1} de ${n}`);
  nav.append(step('Versión anterior', '‹', -1, at === 0), count, step('Versión siguiente', '›', 1, at === n - 1));
  return nav;
}

async function onVariantStep(i, delta) {
  if (busy) return;
  const m = messages[i];
  if (!m) return;
  const next = selectVariant(m, activeVariantIndex(m) + delta);
  if (next === m) return;
  clearSelection();
  messages[i] = next;
  const row = els.messages.querySelector(`.chat-row[data-index="${i}"]`);
  if (row) row.replaceWith(buildMessageRow(next, i));
  scrollToBottom(false);
  await persistChat(); // la versión activa es la que se envía al modelo en el próximo turno: debe quedar guardada
}

// UI-006: UN solo menú de acciones para todo el chat. Se construye la primera vez que se necesita y después se
// MUEVE a la fila del mensaje seleccionado (no hay botones por fila, así el número de nodos no crece con el chat).
let msgMenu = null;
let menuIndex = -1; // índice del mensaje al que está asociado el menú; -1 = cerrado
let menuOpenScrollTop = 0; // UI-016: posición de la lista al abrir (ya con el ajuste); un scroll solo cierra si se aleja de aquí

function ensureMessageMenu() {
  if (msgMenu) return msgMenu;
  msgMenu = document.createElement('div');
  msgMenu.className = 'chat-row__actions';
  msgMenu.setAttribute('role', 'menu');
  msgMenu.setAttribute('aria-label', 'Acciones del mensaje');
  MESSAGE_ACTIONS.forEach((a) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'chat-actionbtn';
    btn.setAttribute('role', 'menuitem');
    btn.dataset.action = a.id;
    btn.textContent = a.label;
    msgMenu.appendChild(btn);
  });
  msgMenu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    e.stopPropagation();
    runMessageAction(btn.dataset.action);
  });
  return msgMenu;
}

function openMessageMenu(row) {
  const i = Number(row.dataset.index);
  const m = messages[i];
  if (!m) return;
  const allowed = availableMessageActions({ role: m.role, isLast: i === messages.length - 1, busy });
  if (!allowed.length) return;
  const menu = ensureMessageMenu();
  menu.querySelectorAll('[data-action]').forEach((btn) => {
    btn.hidden = !allowed.includes(btn.dataset.action);
  });
  row.appendChild(menu);
  row.classList.add('chat-row--selected');
  menuIndex = i;
  // UI-016: el menú se abre debajo del mensaje; si queda fuera de la zona visible (típico en el último mensaje) se
  // desplaza la lista, sin animación, hasta verlo entero. Después se anota la posición: ese ajuste no cuenta como "scroll".
  const delta = revealDelta(menu.getBoundingClientRect(), els.messages.getBoundingClientRect());
  if (delta) els.messages.scrollTop += delta;
  menuOpenScrollTop = els.messages.scrollTop;
}

function runMessageAction(action) {
  const i = menuIndex;
  clearSelection(); // cierra el menú al ejecutar cualquier acción
  if (i < 0) return;
  if (action === 'edit') openEditSheet(i);
  else if (action === 'delete') deleteMessage(i);
  else if (action === 'copy') copyMessage(i);
  else if (action === 'regenerate') regenerate();
}

function buildDots() {
  const wrap = document.createElement('span');
  wrap.className = 'chat-dots';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) wrap.appendChild(document.createElement('i'));
  return wrap;
}

// UI-022: "Reintentar respuesta" es un ícono discreto (flecha circular) junto al mensaje del usuario, con área táctil de 44 px.
function buildRetryButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-retry';
  btn.setAttribute('aria-label', 'Reintentar respuesta');
  btn.title = 'Reintentar respuesta';
  btn.innerHTML = `<span class="chat-retry__icon">${ICON_RETRY}</span>`;
  btn.addEventListener('click', () => generate());
  return btn;
}

function onMessagesClick(e) {
  if (busy) return;
  if (e.target.closest('.chat-row__actions') || e.target.closest('.chat-row__meta')) return;
  const row = e.target.closest('.chat-row');
  if (!row) {
    clearSelection();
    return;
  }
  const wasSelected = row.classList.contains('chat-row--selected');
  clearSelection();
  if (!wasSelected) openMessageMenu(row);
}

// Cierra el menú (lo saca de la fila) y quita la selección. También lo usan hide(), volver y cada re-render.
function clearSelection() {
  if (msgMenu && msgMenu.parentNode) msgMenu.remove();
  menuIndex = -1;
  els.messages.querySelectorAll('.chat-row--selected').forEach((r) => r.classList.remove('chat-row--selected'));
}

/* ---------- acciones sobre un mensaje ---------- */

function openEditSheet(i) {
  const msg = messages[i];
  if (!msg) return;

  const wrap = document.createElement('div');
  wrap.className = 'chat-editsheet';

  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = 'Editar mensaje';

  const textarea = document.createElement('textarea');
  textarea.className = 'inp';
  textarea.value = msg.text;

  const saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'btn';
  saveBtn.textContent = 'Guardar';
  saveBtn.addEventListener('click', async () => {
    const value = textarea.value.trim();
    if (!value) {
      messages.splice(i, 1);
    } else {
      messages[i] = editActiveText(msg, value);
    }
    await persistChat();
    app.closeSheet();
    renderMessages();
  });

  wrap.append(title, textarea, saveBtn);
  app.openSheet(wrap);
}

async function deleteMessage(i) {
  messages.splice(i, 1);
  await persistChat();
  renderMessages();
}

async function copyMessage(i) {
  const msg = messages[i];
  if (!msg) return;
  try {
    await navigator.clipboard.writeText(msg.text);
    app.toast('Mensaje copiado.');
  } catch (err) {
    app.toast('No se pudo copiar el mensaje.');
  }
}

/* ---------- desplazamiento ---------- */

function isNearBottom() {
  const el = els.messages;
  return el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
}

function scrollToBottom(force) {
  if (force || atBottom) {
    els.messages.scrollTop = els.messages.scrollHeight;
    atBottom = true;
  }
  updateScrollDownVisibility();
}

function updateScrollDownVisibility() {
  els.scrollDown.hidden = isNearBottom();
}

function onMessagesScroll() {
  // UI-006/UI-016: el menú se cierra al alejarse con el scroll (no por el ajuste al abrirlo ni por un temblor del dedo).
  if (shouldCloseOnScroll({ open: menuIndex >= 0, scrollTop: els.messages.scrollTop, openScrollTop: menuOpenScrollTop })) clearSelection();
  atBottom = isNearBottom();
  updateScrollDownVisibility();
}

/* ---------- composer ---------- */

function onInputChange() {
  autosizeInput();
  syncSendButton();
  if (chat) draftByChat.set(chat.id, els.input.value);
}

function autosizeInput() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
}

function syncSendButton() {
  const hasText = els.input.value.trim().length > 0;
  els.send.classList.toggle('chat-send--ready', !busy && hasText);
  els.send.classList.toggle('chat-send--stop', busy);
  els.send.innerHTML = busy ? ICON_STOP : ICON_SEND;
  els.send.setAttribute('aria-label', busy ? 'Detener' : 'Enviar');
}

function onInputKeydown(e) {
  if (e.key !== 'Enter' || e.shiftKey) return;
  const isTouch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  if (isTouch) return; // en táctil, Enter inserta salto de línea
  e.preventDefault();
  onSendClick();
}

function onInputFocus() {
  clearTimeout(blurTimeoutId);
  keyboardOpen = true;
  applyAvatarMode();
}

function onInputBlur() {
  clearTimeout(blurTimeoutId);
  blurTimeoutId = setTimeout(() => {
    checkKeyboardFromVh();
  }, 60);
}

async function onSendClick() {
  if (busy) {
    cancelGeneration();
    return;
  }
  const text = els.input.value.trim();
  if (!text || !character || !chat) return;

  els.input.value = '';
  draftByChat.delete(chat.id);
  autosizeInput();
  syncSendButton();

  // Prioridad absoluta al chat: si hay una extracción de memoria en curso se
  // cancela ya, y `sendInFlight` impide que arranque otra entre el guardado
  // del mensaje y el inicio de la respuesta (ver "lorebook automático").
  loreUpdater.abort();
  continuityUpdater.abort();
  sendInFlight = true;
  try {
    messages.push({ role: 'user', text, ts: Date.now() });
    renderMessages();
    await persistChat();
    await generate();
  } finally {
    sendInFlight = false;
    // Si el umbral de memoria se cruzó durante el envío o la respuesta, se
    // difirió hasta aquí: ahora el chat está libre.
    maybeUpdateLorebook();
    maybeUpdateContinuity();
  }
}

/* ---------- generación ---------- */

// `opts.previous` (UI-017): la respuesta que se está regenerando. Se conserva y la nueva se AGREGA como versión.
async function generate(opts = {}) {
  const previous = (opts && opts.previous) || null;
  if (busy || !character) return;
  loreUpdater.abort(); // también al regenerar: el chat tiene prioridad sobre la memoria
  continuityUpdater.abort();
  busy = true;
  syncSendButton();

  const history = messages.slice();
  const reply = { role: 'char', text: '', ts: Date.now() };
  messages.push(reply);
  renderMessages();

  abortCtl = new AbortController();

  try {
    const result = await generateReplyNonEmpty({
      character,
      chat,
      messages: history,
      settings,
      signal: abortCtl.signal,
      onToken: (chunk) => {
        reply.text += chunk;
        updateStreamingBubble();
      },
    });
    reply.text = (result && result.text) || '';
    // UI-010: qué recuerdos viajaron en el prompt de ESTE mensaje (copia; `[]` si ninguno).
    if (result && Array.isArray(result.loreUsed)) reply.loreUsed = result.loreUsed;
    // Vacía tras el reintento automático: no se guarda nada (ver `finally`) y
    // el botón "Reintentar respuesta" queda visible.
    if (!reply.text && !(result && result.aborted)) {
      app.toast('El personaje no respondió. Toca el ícono de reintentar (↻).');
    }
  } catch (err) {
    app.toast((err && err.message) || 'No se pudo generar la respuesta.');
  } finally {
    const idx = messages.indexOf(reply);
    if (previous) {
      // UI-017: con texto (aunque sea parcial, como siempre) pasa a ser una versión más; sin texto se conserva la anterior.
      if (idx >= 0) messages[idx] = reply.text ? addVariant(previous, { text: reply.text, loreUsed: reply.loreUsed, ts: reply.ts }) : previous;
    } else if (!reply.text && idx >= 0) {
      messages.splice(idx, 1);
    }
    busy = false;
    abortCtl = null;
    syncSendButton();
    await persistChat();
    renderMessages();
  }
}

function updateStreamingBubble() {
  const rows = els.messages.querySelectorAll('.chat-row');
  const lastRow = rows[rows.length - 1];
  const msg = messages[messages.length - 1];
  if (!lastRow || !msg) return;
  const bubble = lastRow.querySelector('.chat-bubble');
  if (!bubble) return;
  if (msg.text) {
    bubble.innerHTML = formatMessage(msg.text, formatOpts(msg.role));
  } else {
    bubble.replaceChildren(buildDots());
  }
  scrollToBottom(false);
}

function cancelGeneration() {
  if (abortCtl) abortCtl.abort();
}

function regenerate() {
  if (busy) return;
  const last = messages[messages.length - 1];
  if (last && last.role === 'char') {
    // UI-017: la respuesta anterior sale de la lista solo mientras se genera (el historial que viaja termina en el
    // mensaje del usuario) y vuelve como una de las versiones. Lo guardado en disco no cambia hasta terminar.
    messages.pop();
    generate({ previous: last });
  } else {
    generate();
  }
}

async function persistChat() {
  if (!chat) return;
  try {
    await saveChatMessages(chat.id, messages);
  } catch (err) {
    app.toast('No se pudo guardar la conversación.');
    return;
  }
  maybeAutoBackup();
  maybeUpdateLorebook();
  maybeUpdateContinuity();
}

/* ---------- lorebook automático (docs/NOTES.md, "Lorebook por personaje" y "MEM-001 v2") ---------- */

// La lógica (qué se pide, cómo se parsea, cómo se aplica de forma aditiva y
// cuándo NO se debe extraer) vive en api/lorebook.js (`createLoreUpdater`),
// pura y probada sin DOM. Aquí solo se conecta con el estado del chat.
//
// Reglas de prioridad (latencia primero): la extracción NO arranca mientras
// haya una respuesta del chat en curso ni mientras se está enviando un
// mensaje (`busy`/`sendInFlight`); si el umbral se cruza en esos momentos se
// difiere y se reintenta apenas termina la respuesta (finally de
// `onSendClick()`/`generate()`). Si el usuario envía un mensaje con una
// extracción en curso, se cancela (`loreUpdater.abort()`, que también le pide
// al servidor cortar la generación) sin guardar nada ni avanzar el marcador.
// Mejor esfuerzo: los fallos de la extracción automática nunca muestran
// errores en el flujo normal del chat.
let sendInFlight = false;

const loreUpdater = createLoreUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings } : null),
  isChatBusy: () => busy || sendInFlight || continuityUpdater.isRunning(),
  complete: (prompt, opts) => completeOnce(prompt, settings, opts),
  loadLorebook: async (characterId) => {
    const fresh = await getCharacter(characterId);
    return (fresh && fresh.lorebook) || [];
  },
  saveLorebook: async (characterId, entries, previous) => {
    const updated = await saveCharacterLorebook(characterId, entries, previous);
    if (character && character.id === characterId) character = updated;
  },
  markProgress: async (chatId, count) => {
    const updated = await markChatLorebookProgress(chatId, count);
    if (chat && chat.id === chatId) chat = updated;
  },
});

function maybeUpdateLorebook() {
  loreUpdater.maybeRun().catch(() => {});
}

/* ---------- resumen de continuidad del chat (MEM-007, docs/HISTORIAL.md) ---------- */

// Misma prioridad que el lorebook: nunca compite con una respuesta (`busy`/`sendInFlight`) ni con una extracción de
// memoria en curso, y se cancela si el usuario envía un mensaje. La lógica vive en api/continuity.js.
const continuityUpdater = createContinuityUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings } : null),
  isChatBusy: () => busy || sendInFlight || loreUpdater.isRunning(),
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, settings, opts) : completeOnce(request.prompt, settings, opts),
  loadChat: (chatId) => getChat(chatId),
  saveContinuity: async (chatId, summary) => {
    const updated = await saveChatContinuity(chatId, summary);
    if (chat && chat.id === chatId) chat = updated;
  },
});

function maybeUpdateContinuity() {
  continuityUpdater.maybeRun().catch(() => {});
}

/* ---------- hoja "Ver lorebook": ver, editar, borrar, deshacer, actualizar ---------- */

function loreEl(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function loreClock(at) {
  try {
    return new Date(at).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

function loreStatusText() {
  const s = loreUpdater.getStatus();
  const when = s.at ? ` (${loreClock(s.at)})` : '';
  switch (s.kind) {
    case 'ok': {
      const parts = [];
      if (s.added) parts.push(`${s.added} nueva${s.added === 1 ? '' : 's'}`);
      if (s.updated) parts.push(`${s.updated} actualizada${s.updated === 1 ? '' : 's'}`);
      return `Última actualización: correcta, ${parts.join(' y ')}${when}.`;
    }
    case 'nochange':
      return `Última actualización: correcta, sin novedades que recordar${when}.`;
    case 'unparsed':
      return `Última actualización: el modelo respondió algo que no se pudo entender; no se cambió nada${when}.`;
    case 'unavailable':
      return `Última actualización: el servidor no estaba disponible; no se cambió nada${when}.`;
    case 'aborted':
      return `Última actualización: se interrumpió porque enviaste un mensaje; no se cambió nada${when}.`;
    case 'error':
      return `Última actualización: no se pudo guardar; no se cambió nada${when}.`;
    default:
      return 'Última actualización: aún no se ha intentado desde que abriste la app.';
  }
}

function loreResultMessage(result) {
  switch (result.kind) {
    case 'ok': {
      const parts = [];
      if (result.added) parts.push(`${result.added} nueva${result.added === 1 ? '' : 's'}`);
      if (result.updated) parts.push(`${result.updated} actualizada${result.updated === 1 ? '' : 's'}`);
      return `Listo: memoria actualizada (${parts.join(' y ')}).`;
    }
    case 'nochange':
      return 'Listo: no había nada nuevo que recordar.';
    case 'unparsed':
      return 'El modelo respondió algo que no se pudo entender. No se cambió nada; puedes intentar de nuevo.';
    case 'unavailable':
      return 'No se pudo conectar con el servidor (¿está encendido?). No se cambió nada.';
    case 'aborted':
      return 'Se interrumpió la actualización. No se cambió nada.';
    case 'toolittle':
      return 'Aún hay poca conversación para recordar.';
    case 'busy':
      return 'Ya hay una respuesta o una actualización en curso. Prueba de nuevo en unos segundos.';
    default:
      return 'No se pudo actualizar la memoria. No se cambió nada.';
  }
}

// MEM-003: mensaje llano del resultado de "Limpiar recuerdos".
function loreCleanMessage(result) {
  if (!result.changed) return 'No había nada que limpiar: tus recuerdos ya están en orden.';
  const parts = [];
  if (result.cleaned) parts.push(`Limpié ${result.cleaned} recuerdo${result.cleaned === 1 ? '' : 's'}`);
  if (result.merged) parts.push(`${parts.length ? 'fusioné' : 'Fusioné'} ${result.merged}`);
  return `${parts.join(' y ')}. Si no te gusta el resultado, usa «Deshacer última actualización».`;
}

async function freshLorebook() {
  const fresh = await getCharacter(character.id);
  return (fresh && fresh.lorebook) || [];
}

// MEM-006: "Estado de la relación", armado en el momento con lo que ya está en el lorebook (sin servidor, sin
// modelo y sin guardar nada): frase fija por cantidad de recuerdos, "siempre presentes" tal cual y última actualización.
function buildRelationshipBlock(entries) {
  const sum = relationshipSummary(entries);
  const box = loreEl('div', 'field');
  box.dataset.role = 'relationship';
  box.appendChild(loreEl('h4', 'sheet__title', 'Estado de la relación'));
  const phrase = loreEl('div', '', sum.phrase);
  phrase.style.fontWeight = '600';
  box.appendChild(phrase);
  if (sum.total) {
    box.appendChild(
      loreEl('div', 'field__hint', `${sum.total} recuerdo${sum.total === 1 ? '' : 's'} en total · ${sum.always.length} siempre presente${sum.always.length === 1 ? '' : 's'}.`)
    );
    if (sum.always.length) {
      box.appendChild(loreEl('div', 'field__label', 'Siempre presentes'));
      sum.always.forEach((a) => box.appendChild(loreEl('div', '', '• ' + a.content)));
    }
    const age = relationshipAgeText(sum.lastUpdated);
    if (age) box.appendChild(loreEl('div', 'field__hint', `Última actualización de la memoria: ${age}.`));
  }
  box.appendChild(loreEl('div', 'field__hint', 'Se arma solo con tus recuerdos guardados (los de abajo); no usa el servidor.'));
  box.style.marginBottom = 'var(--space-3, 12px)';
  return box;
}

// UI-010: detalle de los recuerdos que usó un mensaje. Muestra la COPIA guardada en el mensaje, y avisa si
// el recuerdo se editó o se borró después en el lorebook actual del personaje.
function openLoreUsedSheet(message) {
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Recuerdos usados en este mensaje'));
  const items = compareLoreUsed(message.loreUsed, character && character.lorebook);
  if (!items.length) {
    wrap.appendChild(loreEl('div', 'field__hint', 'Este mensaje no usó ningún recuerdo.'));
  }
  items.forEach((item) => {
    const field = loreEl('div', 'field');
    field.dataset.status = item.status;
    field.appendChild(loreEl('div', 'field__label', item.always ? 'Siempre presente' : 'Por tema'));
    field.appendChild(loreEl('div', '', item.content));
    if (!item.always && item.keys.length) field.appendChild(loreEl('div', 'field__hint', 'Palabras clave: ' + item.keys.join(', ')));
    if (item.status !== 'same') field.appendChild(loreEl('div', 'field__hint', 'Este recuerdo fue editado o borrado después.'));
    wrap.appendChild(field);
  });
  app.openSheet(wrap);
}

// Cada pantalla de la hoja reemplaza a la anterior con `app.openSheet` (sin
// cerrar la hoja, así no se toca el historial: ver shell.js / main.js).
function openLorebookSheet(note = '') {
  if (!character) return;
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', `Lorebook de ${character.name}`));

  const status = loreEl('div', 'field');
  status.appendChild(loreEl('div', 'field__hint', loreStatusText()));
  if (note) status.appendChild(loreEl('div', 'field__label', note));
  wrap.appendChild(status);
  wrap.appendChild(buildRelationshipBlock(character.lorebook || []));

  const inFlight = loreUpdater.isRunning() || busy || sendInFlight;
  const progress = loreEl(
    'div',
    'field__hint',
    inFlight ? 'Hay una respuesta o una actualización de memoria en curso; espera a que termine.' : ''
  );
  progress.style.marginBottom = 'var(--space-3, 12px)';

  const refreshBtn = loreEl('button', 'btn', 'Actualizar memoria ahora');
  refreshBtn.type = 'button';
  refreshBtn.disabled = inFlight;
  const undoBtn = loreEl('button', 'btn btn--ghost', 'Deshacer última actualización');
  undoBtn.type = 'button';
  undoBtn.style.marginTop = 'var(--space-2, 8px)';
  undoBtn.disabled = inFlight;

  // MEM-002: la actualización automática está apagada por defecto porque cada
  // extracción hace que la SIGUIENTE respuesta del chat tarde ~20 s más.
  const autoRow = loreEl('label', 'field__label');
  autoRow.style.display = 'flex';
  autoRow.style.alignItems = 'center';
  autoRow.style.gap = 'var(--space-2, 8px)';
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoBox.checked = !!(settings && settings.lorebookAuto);
  autoBox.style.accentColor = 'var(--color-accent, #8b1fe0)';
  autoRow.append(autoBox, loreEl('span', '', `Actualizar automáticamente cada ${LOREBOOK_UPDATE_EVERY_MESSAGES} mensajes`));
  const autoHint = loreEl(
    'div',
    'field__hint',
    'Mientras actualiza, la siguiente respuesta de tu personaje puede tardar más (en pruebas, unos 20 segundos o más).'
  );
  autoHint.style.marginBottom = 'var(--space-3, 12px)';
  autoBox.addEventListener('change', async () => {
    const enable = autoBox.checked;
    autoBox.disabled = true;
    try {
      settings = await saveSettings({ lorebookAuto: enable });
      // Al activar, el marcador se fija al conteo actual: sin extracción retroactiva inmediata.
      if (enable && chat) chat = await markChatLorebookProgress(chat.id, messages.length);
      openLorebookSheet(enable ? 'Actualización automática activada.' : 'Actualización automática desactivada.');
    } catch {
      autoBox.checked = !enable;
      autoBox.disabled = false;
      openLorebookSheet('No se pudo guardar el ajuste.');
    }
  });

  refreshBtn.addEventListener('click', async () => {
    refreshBtn.disabled = true;
    undoBtn.disabled = true;
    progress.textContent =
      'Actualizando memoria… puede tardar unos segundos (si tu servidor está apagado, hasta 2 minutos).';
    const result = await loreUpdater.runNow();
    const message = loreResultMessage(result);
    if (wrap.isConnected) openLorebookSheet(message);
    else app.toast(message);
  });
  undoBtn.addEventListener('click', () => {
    if (!character.lorebookPreviousAt) {
      openLorebookSheet('No hay ninguna actualización reciente que deshacer.');
    } else {
      openLoreUndoConfirm();
    }
  });

  const costHint = loreEl('div', 'field__hint', 'La siguiente respuesta puede tardar más. Conviene usarlo al terminar de chatear.');
  costHint.style.marginTop = 'var(--space-2, 8px)';

  // MEM-003: "Limpiar recuerdos" trabaja solo con lo ya guardado (no usa el
  // servidor, no afecta la velocidad del chat) y solo con las automáticas.
  const cleanBtn = loreEl('button', 'btn btn--ghost', 'Limpiar recuerdos');
  cleanBtn.type = 'button';
  cleanBtn.style.marginTop = 'var(--space-2, 8px)';
  cleanBtn.disabled = inFlight;
  const cleanHint = loreEl(
    'div',
    'field__hint',
    'Ordena las palabras clave y junta los recuerdos repetidos. No toca los que escribiste o editaste tú, y se puede deshacer.'
  );
  cleanHint.style.marginTop = 'var(--space-1, 4px)';
  cleanBtn.addEventListener('click', async () => {
    cleanBtn.disabled = true;
    try {
      const result = await cleanStoredLorebook({
        load: freshLorebook,
        save: async (entries, previous) => {
          character = await saveCharacterLorebook(character.id, entries, previous);
        },
        names: [character.card.name || character.name, settings && settings.user],
      });
      openLorebookSheet(loreCleanMessage(result));
    } catch {
      openLorebookSheet('No se pudo limpiar. No se cambió nada.');
    }
  });

  wrap.append(autoRow, autoHint, progress, refreshBtn, costHint, undoBtn, cleanBtn, cleanHint);

  // MEM-004: "Siempre presentes" (van en cada respuesta, con tope) y "Por tema" (solo cuando sale una palabra clave).
  const all = character.lorebook || [];
  const alwaysEntries = all.filter((e) => e.always);
  const topicEntries = all.filter((e) => !e.always).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const preview = loreBudgetPreview(all);
  const list = loreEl('div');
  list.style.marginTop = 'var(--space-4, 16px)';
  if (!all.length) {
    list.appendChild(
      loreEl(
        'div',
        'field__hint',
        'Todavía no hay recuerdos. Se crean al usar el botón de arriba (con lo que hayas hablado en cualquiera de tus ' +
          'chats con este personaje), o solos si activas la actualización automática.'
      )
    );
  }

  const renderEntry = (entry) => {
    const field = loreEl('div', 'field');
    field.appendChild(loreEl('div', 'field__label', entry.content));
    const origin = entry.source === 'manual' ? 'escrita o editada por ti' : 'automática';
    field.appendChild(
      loreEl('div', 'field__hint', entry.always ? origin : `${(entry.keys || []).join(', ')} · ${origin}`)
    );

    const actions = loreEl('div');
    actions.style.display = 'flex';
    actions.style.gap = 'var(--space-2, 8px)';
    actions.style.marginTop = 'var(--space-2, 8px)';
    const editBtn = loreEl('button', 'btn btn--sm btn--ghost', 'Editar');
    editBtn.type = 'button';
    editBtn.addEventListener('click', () => openLoreEdit(entry.id));
    const delBtn = loreEl('button', 'btn btn--sm btn--ghost', 'Borrar');
    delBtn.type = 'button';
    delBtn.addEventListener('click', () => openLoreDeleteConfirm(entry.id));
    actions.append(editBtn, delBtn);
    field.appendChild(actions);
    return field;
  };

  if (all.length) {
    const alwaysTitle = loreEl('h4', 'sheet__title', 'Siempre presentes');
    list.appendChild(alwaysTitle);
    const counter = loreEl(
      'div',
      'field__hint',
      `${preview.alwaysSelection.requested} / ${LOREBOOK_ALWAYS_CHAR_BUDGET} caracteres · Mia los tiene en mente en cada respuesta, sin palabras clave.`
    );
    counter.setAttribute('data-role', 'always-counter');
    counter.style.marginBottom = 'var(--space-3, 12px)';
    list.appendChild(counter);
    if (preview.alwaysSelection.overflow) {
      const hidden = preview.alwaysSelection.total - preview.alwaysSelection.sent;
      const warn = loreEl(
        'div',
        'field__label',
        (hidden === 1 ? 'No cabe todo: el último NO se envía. ' : `No cabe todo: los últimos ${hidden} NO se envían. `) +
          'Acorta alguno o quita alguno.'
      );
      warn.setAttribute('role', 'alert');
      list.appendChild(warn);
    }
    if (!alwaysEntries.length) {
      const none = loreEl('div', 'field__hint', 'Ninguno todavía. Toca «Editar» en un recuerdo importante y activa «Siempre presente».');
      none.style.marginBottom = 'var(--space-3, 12px)';
      list.appendChild(none);
    }
    alwaysEntries.forEach((entry) => list.appendChild(renderEntry(entry)));

    const topicTitle = loreEl('h4', 'sheet__title', 'Por tema');
    topicTitle.style.marginTop = 'var(--space-4, 16px)';
    list.appendChild(topicTitle);
    const topicHint = loreEl(
      'div',
      'field__hint',
      `Entran en la conversación solo cuando aparece una de sus palabras clave (hasta ${preview.topicBudget} caracteres por respuesta).`
    );
    topicHint.style.marginBottom = 'var(--space-3, 12px)';
    list.appendChild(topicHint);
    topicEntries.forEach((entry) => list.appendChild(renderEntry(entry)));
  }
  wrap.appendChild(list);

  app.openSheet(wrap);
}

function openLoreEdit(entryId) {
  const entry = ((character && character.lorebook) || []).find((e) => e.id === entryId);
  if (!entry) {
    openLorebookSheet('Ese recuerdo ya no existe.');
    return;
  }
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Editar recuerdo'));

  const content = loreEl('textarea', 'inp');
  content.value = entry.content;
  content.maxLength = LOREBOOK_MAX_ENTRY_CHARS;
  content.rows = 3;
  content.setAttribute('aria-label', 'Recuerdo');
  const keys = loreEl('input', 'inp');
  keys.type = 'text';
  keys.value = (entry.keys || []).join(', ');
  keys.placeholder = 'Palabras clave, separadas por comas';
  keys.setAttribute('aria-label', 'Palabras clave');
  keys.style.marginTop = 'var(--space-2, 8px)';
  const hint = loreEl(
    'div',
    'field__hint',
    'El recuerdo entra en la conversación cuando aparece alguna de estas palabras. ' +
      'Al guardar, queda como escrita por ti y la memoria automática ya no la toca.'
  );
  hint.style.margin = 'var(--space-2, 8px) 0';
  // MEM-004: interruptor "Siempre presente" (casilla nativa, como la de actualización automática).
  const alwaysRow = loreEl('label', 'field__label');
  alwaysRow.style.display = 'flex';
  alwaysRow.style.alignItems = 'center';
  alwaysRow.style.gap = 'var(--space-2, 8px)';
  const alwaysBox = document.createElement('input');
  alwaysBox.type = 'checkbox';
  alwaysBox.checked = !!entry.always;
  alwaysBox.style.accentColor = 'var(--color-accent, #8b1fe0)';
  alwaysRow.append(alwaysBox, loreEl('span', '', 'Siempre presente (Mia lo tiene en mente siempre)'));
  const alwaysHint = loreEl(
    'div',
    'field__hint',
    `Va en cada respuesta, sin necesitar palabras clave. Tope: ${LOREBOOK_ALWAYS_CHAR_BUDGET} caracteres entre todos los recuerdos siempre presentes. ` +
      'Al activarlo o cambiarlo, la siguiente respuesta puede tardar más una sola vez.'
  );
  alwaysHint.style.margin = 'var(--space-1, 4px) 0 var(--space-2, 8px)';
  const error = loreEl('div', 'field__label', '');

  const saveBtn = loreEl('button', 'btn', 'Guardar');
  saveBtn.type = 'button';
  saveBtn.addEventListener('click', async () => {
    try {
      const next = editLoreEntry(await freshLorebook(), entryId, {
        content: content.value,
        keys: parseKeysInput(keys.value),
        always: alwaysBox.checked,
      });
      if (!next) {
        error.textContent = 'Escribe el recuerdo y al menos una palabra clave.';
        return;
      }
      character = await saveCharacterLorebook(character.id, next);
      openLorebookSheet('Recuerdo guardado.');
    } catch {
      error.textContent = 'No se pudo guardar el cambio.';
    }
  });
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.marginTop = 'var(--space-2, 8px)';
  cancelBtn.addEventListener('click', () => openLorebookSheet());

  wrap.append(content, keys, hint, alwaysRow, alwaysHint, error, saveBtn, cancelBtn);
  app.openSheet(wrap);
}

// Confirmaciones dentro de la propia hoja (en vez de `app.confirmDialog`, que
// CIERRA la hoja al responder y obligaría a reabrirla: esa secuencia
// cerrar+abrir es justo la carrera con el historial que ya dio un bug real,
// ver docs/NOTES.md, "Bugs reales encontrados usando la app").
function openLoreConfirm(message, confirmText, onConfirm, danger) {
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('p', 'sheet__title', message));
  const actions = loreEl('div');
  actions.style.display = 'flex';
  actions.style.gap = 'var(--space-3, 12px)';
  actions.style.marginTop = 'var(--space-4, 16px)';
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.flex = '1';
  cancelBtn.addEventListener('click', () => openLorebookSheet());
  const okBtn = loreEl('button', danger ? 'btn btn--danger' : 'btn', confirmText);
  okBtn.type = 'button';
  okBtn.style.flex = '1';
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try {
      openLorebookSheet(await onConfirm());
    } catch {
      openLorebookSheet('No se pudo guardar el cambio.');
    }
  });
  actions.append(cancelBtn, okBtn);
  wrap.appendChild(actions);
  app.openSheet(wrap);
}

function openLoreDeleteConfirm(entryId) {
  const entry = ((character && character.lorebook) || []).find((e) => e.id === entryId);
  if (!entry) {
    openLorebookSheet('Ese recuerdo ya no existe.');
    return;
  }
  const preview = entry.content.length > 120 ? entry.content.slice(0, 120) + '…' : entry.content;
  openLoreConfirm(
    `¿Borrar este recuerdo? «${preview}»`,
    'Borrar',
    async () => {
      character = await saveCharacterLorebook(character.id, removeLoreEntry(await freshLorebook(), entryId));
      return 'Recuerdo borrado.';
    },
    true
  );
}

function openLoreUndoConfirm() {
  openLoreConfirm(
    '¿Volver al estado que tenía la memoria antes de la última actualización? ' +
      'Se perderán los cambios hechos desde entonces (también tus ediciones).',
    'Deshacer',
    async () => {
      const fresh = await getCharacter(character.id);
      if (!fresh || !fresh.lorebookPreviousAt) return 'No hay ninguna actualización reciente que deshacer.';
      character = await saveCharacterLorebook(character.id, fresh.lorebookPrevious, null);
      return 'Listo: se volvió al estado anterior de la memoria.';
    },
    false
  );
}

/* ---------- hoja "Resumen de este chat" (MEM-007): leer, editar, borrar, interruptor, resumir ahora ---------- */

function continuityStatusText() {
  const s = continuityUpdater.getStatus();
  const when = s.at ? ` (${loreClock(s.at)})` : '';
  switch (s.kind) {
    case 'ok':
      return `Último intento: correcto${s.condensed ? ' (se juntó con lo anterior para que quepa)' : ''}${when}.`;
    case 'unparsed':
      return `Último intento: el modelo respondió algo que no era un resumen; no se cambió nada${when}.`;
    case 'unverified':
      return `Último intento: el modelo mencionó cosas que no estaban en la conversación; se descartó y no se cambió nada${when}.`;
    case 'unavailable':
      return `Último intento: el servidor no estaba disponible; no se cambió nada${when}.`;
    case 'aborted':
      return `Último intento: se interrumpió (enviaste un mensaje o cambiaste el resumen); no se cambió nada${when}.`;
    case 'error':
      return `Último intento: no se pudo guardar; no se cambió nada${when}.`;
    default:
      return 'Todavía no se ha intentado resumir desde que abriste la app.';
  }
}

function continuityResultMessage(result) {
  switch (result.kind) {
    case 'ok':
      return 'Listo: resumen actualizado.';
    case 'notyet':
      return 'Todavía no hace falta: la conversación cabe completa en la memoria de la IA.';
    case 'unparsed':
      return 'El modelo respondió algo que no era un resumen. No se cambió nada; puedes intentarlo de nuevo.';
    case 'unverified':
      return 'El modelo mencionó cosas que no estaban en la conversación, así que se descartó. No se cambió nada.';
    case 'unavailable':
      return 'No se pudo conectar con el servidor (¿está encendido?). No se cambió nada.';
    case 'aborted':
      return 'Se interrumpió. No se cambió nada.';
    case 'busy':
      return 'Ya hay una respuesta o una actualización en curso. Prueba de nuevo en unos segundos.';
    default:
      return 'No se pudo actualizar el resumen. No se cambió nada.';
  }
}

function openContinuitySheet(note = '') {
  if (!character || !chat) return;
  const summary = chat.continuitySummary || { text: '', coveredUntil: 0, updated: 0 };
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Resumen de este chat'));
  const intro = loreEl(
    'div',
    'field__hint',
    'Cuando esta conversación es tan larga que los mensajes más viejos ya no caben en la memoria de la IA, aquí se guarda un ' +
      'resumen breve de lo que pasó, para que el personaje no lo pierda del todo. Solo se crea cuando hace falta y es solo de ESTE chat.'
  );
  intro.style.marginBottom = 'var(--space-3, 12px)';
  wrap.appendChild(intro);
  if (note) wrap.appendChild(loreEl('div', 'field__label', note));
  wrap.appendChild(loreEl('div', 'field__hint', continuityStatusText()));

  const inFlight = continuityUpdater.isRunning() || busy || sendInFlight || loreUpdater.isRunning();

  const text = loreEl('textarea', 'inp');
  text.value = summary.text;
  text.rows = 7;
  text.maxLength = CONTINUITY_TOTAL_CHARS;
  text.placeholder = 'Todavía no hay resumen. Puedes escribir uno tú (lo que quieras que el personaje recuerde de esta conversación) o esperar a que se cree solo.';
  text.setAttribute('aria-label', 'Resumen de este chat');
  text.style.marginTop = 'var(--space-2, 8px)';
  const counter = loreEl('div', 'field__hint', '');
  const refreshCounter = () => {
    counter.textContent = `${text.value.length} / ${CONTINUITY_TOTAL_CHARS} caracteres`;
  };
  refreshCounter();
  text.addEventListener('input', refreshCounter);
  wrap.append(text, counter);

  if (summary.text) {
    const covered = coveredCount(messages, summary.coveredUntil);
    const age = relationshipAgeText(summary.updated);
    const parts = [];
    if (covered) parts.push(`Resume los primeros ${covered} mensajes de esta conversación`);
    if (age) parts.push(`última vez ${age}`);
    if (parts.length) {
      const meta = loreEl('div', 'field__hint', parts.join(' · ') + '.');
      meta.setAttribute('data-role', 'continuity-meta');
      wrap.appendChild(meta);
    }
  }

  const error = loreEl('div', 'field__label', '');
  const saveBtn = loreEl('button', 'btn', 'Guardar cambios');
  saveBtn.type = 'button';
  saveBtn.style.marginTop = 'var(--space-2, 8px)';
  saveBtn.addEventListener('click', async () => {
    saveBtn.disabled = true;
    try {
      const next = text.value.replace(/\s+/g, ' ').trim();
      // Editar a mano no cambia hasta dónde llega el resumen; solo el texto (y la hora, para que una actualización en curso no lo pise).
      chat = await saveChatContinuity(chat.id, { text: next, coveredUntil: next ? summary.coveredUntil : 0, updated: Date.now() });
      openContinuitySheet(next ? 'Resumen guardado.' : 'Resumen borrado.');
    } catch {
      error.textContent = 'No se pudo guardar el cambio.';
      saveBtn.disabled = false;
    }
  });
  const saveHint = loreEl(
    'div',
    'field__hint',
    'Mientras haya un resumen guardado, cada respuesta lo lleva y, en chats largos, puede tardar unos 2 segundos más (medido con ~500 caracteres). ' +
      'Si prefieres la máxima velocidad, bórralo. Si lo escribes o editas tú, el resumen automático puede juntarlo o quitarle las frases más antiguas cuando ya no quepa.'
  );
  saveHint.style.marginTop = 'var(--space-1, 4px)';

  const deleteBtn = loreEl('button', 'btn btn--ghost', 'Borrar resumen');
  deleteBtn.type = 'button';
  deleteBtn.style.marginTop = 'var(--space-2, 8px)';
  deleteBtn.disabled = !summary.text;
  deleteBtn.addEventListener('click', () => {
    openContinuityConfirm(
      '¿Borrar el resumen de este chat? Lo que ya no cabe en la conversación no se puede volver a resumir: si se borra, el personaje lo pierde.',
      'Borrar',
      async () => {
        chat = await saveChatContinuity(chat.id, { text: '', coveredUntil: 0, updated: 0 });
        return 'Resumen borrado.';
      },
      true
    );
  });

  const autoRow = loreEl('label', 'field__label');
  autoRow.style.display = 'flex';
  autoRow.style.alignItems = 'center';
  autoRow.style.gap = 'var(--space-2, 8px)';
  autoRow.style.marginTop = 'var(--space-4, 16px)';
  const autoBox = document.createElement('input');
  autoBox.type = 'checkbox';
  autoBox.checked = !!(settings && settings.continuityAuto);
  autoBox.style.accentColor = 'var(--color-accent, #8b1fe0)';
  autoRow.append(autoBox, loreEl('span', '', 'Resumir automáticamente cuando el chat se hace muy largo'));
  const autoHint = loreEl(
    'div',
    'field__hint',
    'Se hace en segundo plano, solo cuando algo está a punto de perderse, y se cancela si envías un mensaje. ' +
      'Está apagado por defecto porque, con un resumen guardado, cada respuesta puede tardar unos 2 segundos más en chats largos.'
  );
  autoHint.style.marginBottom = 'var(--space-3, 12px)';
  autoBox.addEventListener('change', async () => {
    const enable = autoBox.checked;
    autoBox.disabled = true;
    try {
      settings = await saveSettings({ continuityAuto: enable });
      openContinuitySheet(enable ? 'Resumen automático activado.' : 'Resumen automático desactivado.');
    } catch {
      autoBox.checked = !enable;
      autoBox.disabled = false;
      openContinuitySheet('No se pudo guardar el ajuste.');
    }
  });

  const progress = loreEl('div', 'field__hint', inFlight ? 'Hay una respuesta o una actualización en curso; espera a que termine.' : '');
  const nowBtn = loreEl('button', 'btn btn--ghost', 'Resumir ahora');
  nowBtn.type = 'button';
  nowBtn.disabled = inFlight;
  nowBtn.addEventListener('click', async () => {
    nowBtn.disabled = true;
    saveBtn.disabled = true;
    deleteBtn.disabled = true;
    progress.textContent = 'Resumiendo… puede tardar unos segundos (si tu servidor está apagado, hasta 2 minutos).';
    const result = await continuityUpdater.runNow();
    const message = continuityResultMessage(result);
    if (wrap.isConnected) openContinuitySheet(message);
    else app.toast(message);
  });
  const nowHint = loreEl(
    'div',
    'field__hint',
    'Resume ahora los mensajes más viejos que todavía están visibles y pronto dejarán de caber. No hace nada si la conversación aún cabe entera.'
  );
  nowHint.style.marginTop = 'var(--space-1, 4px)';

  wrap.append(error, saveBtn, saveHint, deleteBtn, autoRow, autoHint, progress, nowBtn, nowHint);
  app.openSheet(wrap);
}

// Confirmación dentro de la propia hoja (mismo motivo que `openLoreConfirm`: `app.confirmDialog` cerraría la hoja).
function openContinuityConfirm(message, confirmText, onConfirm, danger) {
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('p', 'sheet__title', message));
  const actions = loreEl('div');
  actions.style.display = 'flex';
  actions.style.gap = 'var(--space-3, 12px)';
  actions.style.marginTop = 'var(--space-4, 16px)';
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.flex = '1';
  cancelBtn.addEventListener('click', () => openContinuitySheet());
  const okBtn = loreEl('button', danger ? 'btn btn--danger' : 'btn', confirmText);
  okBtn.type = 'button';
  okBtn.style.flex = '1';
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try {
      openContinuitySheet(await onConfirm());
    } catch {
      openContinuitySheet('No se pudo guardar el cambio.');
    }
  });
  actions.append(cancelBtn, okBtn);
  wrap.appendChild(actions);
  app.openSheet(wrap);
}

/* ---------- barra superior ---------- */

function onBack() {
  if (busy) cancelGeneration();
  app.closeSheet();
  clearSelection();
  app.back();
}

// Cuenta de mensajes por rol + estimación de cuánto contexto del modelo
// ocupa la conversación en este momento (aproximado: ver `estimateContextUsage`
// en prompt.js). Solo informativo (UI-020: dentro de "Diagnóstico" del menú del chat, plegado por defecto).
function buildUsageInfo() {
  const field = document.createElement('div');
  field.className = 'field';

  const label = document.createElement('div');
  label.className = 'field__label';
  const userCount = messages.filter((m) => m.role === 'user').length;
  const charCount = messages.filter((m) => m.role === 'char').length;
  label.textContent = `${messages.length} mensajes (${userCount} tuyos, ${charCount} del personaje)`;
  field.appendChild(label);

  const hint = document.createElement('div');
  hint.className = 'field__hint';
  if (character && settings) {
    // MEM-004: refleja el bloque "siempre presentes" real y reserva el espacio del bloque "por tema".
    const lore = loreBudgetPreview(character.lorebook || []);
    const { approxTokens, budgetTokens, ratio } = estimateContextUsage(
      character.card, messages, settings, chat ? chat.scenario : '', lore.alwaysBlock, lore.topicReserve,
      { continuity: chat && chat.continuitySummary ? chat.continuitySummary.text : '', relationship: relationshipSummary(character.lorebook || []).level }
    );
    const pct = Math.round(Math.min(ratio, 1) * 100);
    hint.textContent = ratio >= 1
      ? `Contexto lleno (≈${approxTokens} de ${budgetTokens} tokens aprox.): los mensajes más viejos ya se están recortando.`
      : `Contexto usado: ~${pct}% (≈${approxTokens} de ${budgetTokens} tokens aprox.)`;
  }
  field.appendChild(hint);

  return field;
}

// UI-019: el menú (⋮) agrupa las opciones por categoría; ninguna cambia de comportamiento, solo de lugar.
// UI-020 ("esconder, no eliminar"): el conteo de mensajes y el contexto viven en "Diagnóstico", plegado por defecto.
function menuItem(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'menu-item';
  btn.textContent = label;
  btn.addEventListener('click', onClick);
  return btn;
}

function menuSection(title, items) {
  const section = document.createElement('div');
  section.className = 'menu-section';
  section.setAttribute('role', 'group');
  section.setAttribute('aria-label', title);
  const head = document.createElement('div');
  head.className = 'menu-group';
  head.setAttribute('aria-hidden', 'true');
  head.textContent = title;
  section.append(head, ...items);
  return section;
}

// Sección plegable, cerrada de entrada. El contenido se calcula la primera vez que se abre (mismos cálculos de siempre).
function buildDiagnostics() {
  const wrap = document.createElement('div');
  wrap.className = 'menu-section';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'menu-item menu-fold';
  toggle.setAttribute('aria-expanded', 'false');
  const label = document.createElement('span');
  label.textContent = 'Diagnóstico';
  const chevron = document.createElement('span');
  chevron.className = 'menu-fold__chevron';
  chevron.setAttribute('aria-hidden', 'true');
  chevron.textContent = '›';
  toggle.append(label, chevron);

  const body = document.createElement('div');
  body.className = 'menu-fold__body';
  body.hidden = true;
  let built = false;

  toggle.addEventListener('click', () => {
    const open = body.hidden;
    if (open && !built) {
      built = true;
      const note = document.createElement('div');
      note.className = 'field__hint';
      note.textContent = 'Información técnica. No hace falta entenderla para usar la app.';
      body.append(note, buildUsageInfo());
    }
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  wrap.append(toggle, body);
  return wrap;
}

function onMenu() {
  const wrap = document.createElement('div');

  // Navegación (sin encabezado)
  wrap.appendChild(menuItem('Ajustes', () => openSettings(app)));
  wrap.appendChild(
    menuItem('Volver a los chats de este personaje', () => {
      if (busy) cancelGeneration();
      app.navigate('chats', { characterId: chat.characterId });
    })
  );

  wrap.appendChild(
    menuSection('Apariencia', [
      menuItem('Apariencia', () => openAppearance(app)),
      menuItem('Fondo del chat', () => openChatBackground(app, character)),
    ])
  );

  const characterItems = [
    menuItem('Ver lorebook', () => openLorebookSheet()),
    menuItem('Resumen de este chat', () => openContinuitySheet()),
  ];
  if (character && character.card.alternate_greetings && character.card.alternate_greetings.length && isOnlyGreeting()) {
    characterItems.push(menuItem('Cambiar saludo', () => openGreetingSheet()));
  }
  characterItems.push(
    menuItem('Cambiar avatar', () => {
      app.closeSheet();
      onChangeAvatar();
    })
  );
  wrap.appendChild(menuSection('Personaje y memoria', characterItems));

  wrap.appendChild(
    menuSection('Datos', [
      menuItem('Exportar este chat', () => {
        app.closeSheet();
        onExportChat();
      }),
      menuItem('Importar chat', () => {
        app.closeSheet();
        onImportChat();
      }),
    ])
  );

  wrap.appendChild(buildDiagnostics());

  app.openSheet(wrap);
}

async function onChangeAvatar() {
  if (!character) return;
  const files = await pickFiles();
  if (!files.length) return;

  app.toast('Generando avatar…');
  const dataUrl = await makeAvatar(files[0]);
  if (!dataUrl) {
    app.toast('No se pudo usar esa imagen como avatar.');
    return;
  }

  character.avatar = dataUrl;
  try {
    character = await saveCharacter(character);
    applyAvatarMode();
    app.toast('Avatar actualizado.');
  } catch (err) {
    app.toast('No se pudo guardar el avatar.');
  }
}

function slugify(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
}

function chatExportBlob() {
  const payload = {
    app: 'companion',
    kind: 'chat-log',
    version: 2,
    exported: new Date().toISOString(),
    character: { id: character.id, name: character.name },
    chat: { id: chat.id, title: chat.title, scenario: chat.scenario, continuitySummary: chat.continuitySummary },
    messages,
  };
  return new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
}

function chatSlug() {
  const charSlug = slugify(character.name) || 'chat';
  const titleSlug = slugify(chat.title);
  return titleSlug ? `${charSlug}-${titleSlug}` : charSlug;
}

async function onExportChat() {
  if (!character || !chat) return;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const { savedToDevice } = await saveBlob(chatExportBlob(), `companion-chat-${chatSlug()}-${date}.json`);
    if (savedToDevice) app.toast('Chat guardado en Documentos del teléfono.');
  } catch (err) {
    app.toast('No se pudo exportar el chat.');
  }
}

// Respaldo automático silencioso en segundo plano (ver `platform.js` /
// `state.js`): al menos cada AUTO_BACKUP_INTERVAL_MS, si hay algo más que
// el saludo inicial, se escribe una copia del chat en el teléfono sin
// avisar ni interrumpir. `chat.lastExportAt` guarda cuándo fue la última
// vez (arranca en 0, así que el primer respaldo pasa apenas hay un mensaje
// real, sin esperar el intervalo completo).
const AUTO_BACKUP_INTERVAL_MS = 10 * 60 * 1000;

async function maybeAutoBackup() {
  if (!character || !chat || messages.length < 2) return;
  if (Date.now() - (chat.lastExportAt || 0) < AUTO_BACKUP_INTERVAL_MS) return;
  const ok = await autoBackupBlob(chatExportBlob(), `${chatSlug()}.json`);
  if (!ok) return;
  try {
    chat = await markChatExported(chat.id);
  } catch (err) {
    // No crítico: se vuelve a intentar en el próximo mensaje.
  }
}

async function onImportChat() {
  if (!character || !chat) return;
  const files = await pickFiles();
  if (!files.length) return;

  let data;
  try {
    const text = await files[0].text();
    data = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    app.toast('El archivo no es un JSON válido.');
    return;
  }

  if (!data || typeof data !== 'object' || !Array.isArray(data.messages)) {
    app.toast('Ese archivo no es un log de chat válido de Companion.');
    return;
  }

  const cleaned = data.messages
    .filter((m) => m && (m.role === 'user' || m.role === 'char') && typeof m.text === 'string')
    .map((m) => sanitizeMessage({ ...m, role: m.role, text: m.text, ts: typeof m.ts === 'number' ? m.ts : Date.now() }));

  if (!cleaned.length) {
    app.toast('Ese archivo no tiene mensajes reconocibles.');
    return;
  }

  const ok = await app.confirmDialog(
    `¿Reemplazar el chat actual con este log importado (${cleaned.length} mensajes)? Se perderá el historial actual.`,
    { confirmText: 'Importar', danger: true }
  );
  if (!ok) return;

  if (busy) cancelGeneration();
  continuityUpdater.abort();
  // MEM-007: el resumen habla de los mensajes que se reemplazan, así que no sirve para el chat importado. Se restaura el
  // que trae el archivo (si lo trae y es válido); si no, vuelve al valor por defecto y se regenera solo cuando haga falta.
  try {
    chat = await saveChatContinuity(chat.id, sanitizeContinuity(data.chat && data.chat.continuitySummary));
  } catch {
    // mejor esfuerzo: un fallo aquí no debe impedir importar los mensajes
  }
  messages = cleaned;
  await persistChat();
  renderMessages();
  app.toast('Chat importado.');
}

function isOnlyGreeting() {
  return messages.length === 1 && messages[0].role === 'char';
}

function openGreetingSheet() {
  const wrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = 'Elegir saludo';
  wrap.appendChild(title);

  const greetings = [character.card.first_mes, ...(character.card.alternate_greetings || [])];
  greetings.forEach((text, i) => {
    if (!text) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'menu-item';
    const preview = text.replace(/\*/g, '').replace(/\s+/g, ' ').trim().slice(0, 80);
    btn.textContent = preview || `Saludo ${i + 1}`;
    btn.addEventListener('click', async () => {
      app.closeSheet();
      messages = initialMessages(character, settings, i);
      await persistChat();
      renderMessages();
    });
    wrap.appendChild(btn);
  });

  app.openSheet(wrap);
}
