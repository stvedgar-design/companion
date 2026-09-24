// www/js/ui/chat.js
// Pantalla de chat: burbujas, streaming, avatar en 3 modos, composer, menú.

import { getChat, getChatMessages, saveChatMessages, getCharacter, saveCharacter, getSettings, markChatExported, saveCharacterLorebook, markChatLorebookProgress } from '../state.js';
import { generateReply, completeOnce } from '../api/kobold.js';
import { initialMessages, scenarioGreeting, estimateContextUsage } from '../api/prompt.js';
import {
  shouldUpdateLorebook,
  buildExtractionPrompt,
  parseExtractionResponse,
  sanitizeLoreEntries,
  LOREBOOK_UPDATE_EVERY_MESSAGES,
  LOREBOOK_EXTRACT_TEMP,
} from '../api/lorebook.js';
import { openSettings } from './settings.js';
import { openAppearance } from './appearance.js';
import { openChatBackground } from './chat-background.js';
import { formatMessage } from './format.js';
import { makeAvatar } from '../cards/avatar.js';
import { pickFiles, saveBlob, autoBackupBlob } from '../platform.js';
import { averageColorFromDataUrl } from '../images.js';
import { setGlassTint } from './shell.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_MENU = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
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
  els.messages.replaceChildren();
  messages.forEach((m, i) => {
    els.messages.appendChild(buildMessageRow(m, i));
  });
  if (!busy && messages.length && messages[messages.length - 1].role === 'user') {
    els.messages.appendChild(buildRetryButton());
  }
  scrollToBottom(true);
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
    bubble.innerHTML = formatMessage(m.text);
  }
  row.appendChild(bubble);

  const actions = document.createElement('div');
  actions.className = 'chat-row__actions';
  if (!busy) {
    actions.appendChild(buildActionButton('Editar', () => openEditSheet(i)));
    actions.appendChild(buildActionButton('Borrar', () => deleteMessage(i)));
    actions.appendChild(buildActionButton('Copiar', () => copyMessage(i)));
    if (isLast && m.role === 'char') {
      actions.appendChild(buildActionButton('Regenerar', () => regenerate()));
    }
  }
  row.appendChild(actions);

  return row;
}

function buildActionButton(label, onClick) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-actionbtn';
  btn.textContent = label;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    onClick();
  });
  return btn;
}

function buildDots() {
  const wrap = document.createElement('span');
  wrap.className = 'chat-dots';
  wrap.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < 3; i++) wrap.appendChild(document.createElement('i'));
  return wrap;
}

function buildRetryButton() {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'chat-retry';
  btn.textContent = 'Reintentar respuesta';
  btn.addEventListener('click', () => generate());
  return btn;
}

function onMessagesClick(e) {
  if (busy) return;
  if (e.target.closest('.chat-row__actions')) return;
  const row = e.target.closest('.chat-row');
  if (!row) {
    clearSelection();
    return;
  }
  const wasSelected = row.classList.contains('chat-row--selected');
  clearSelection();
  if (!wasSelected) row.classList.add('chat-row--selected');
}

function clearSelection() {
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
      messages[i] = { ...msg, text: value };
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

  messages.push({ role: 'user', text, ts: Date.now() });
  renderMessages();
  await persistChat();
  await generate();
}

/* ---------- generación ---------- */

async function generate() {
  if (busy || !character) return;
  busy = true;
  syncSendButton();

  const history = messages.slice();
  const reply = { role: 'char', text: '', ts: Date.now() };
  messages.push(reply);
  renderMessages();

  abortCtl = new AbortController();

  try {
    const result = await generateReply({
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
  } catch (err) {
    app.toast((err && err.message) || 'No se pudo generar la respuesta.');
  } finally {
    if (!reply.text) {
      const idx = messages.indexOf(reply);
      if (idx >= 0) messages.splice(idx, 1);
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
    bubble.innerHTML = formatMessage(msg.text);
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
  if (messages.length && messages[messages.length - 1].role === 'char') {
    messages.pop();
  }
  generate();
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
}

/* ---------- lorebook automático (docs/NOTES.md, "Lorebook por personaje") ---------- */

// Evita disparar dos actualizaciones de lorebook superpuestas (p. ej. dos
// mensajes seguidos que cruzan el umbral antes de que termine la primera).
let lorebookUpdateInFlight = false;

// Cada LOREBOOK_UPDATE_EVERY_MESSAGES mensajes nuevos de ESTE chat, le pide
// al propio servidor del usuario (mismo KoboldCpp de siempre, una llamada
// de una sola vez sin streaming) que actualice el lorebook del PERSONAJE a
// partir de los mensajes nuevos. El lorebook es del personaje, no del chat:
// se comparte entre todos sus chats (así el personaje "recuerda" lo mismo
// sin importar en cuál chat se estableció), pero el progreso de disparo
// (`chat.lorebookMessageCount`) es por chat, porque cada chat recibe
// mensajes nuevos por su cuenta. Mejor esfuerzo total, como
// `maybeAutoBackup()`: nunca bloquea el chat, nunca lanza, nunca le muestra
// nada al usuario si falla.
//
// Decisión de diseño (los modelos locales chicos generan JSON poco
// confiable, ver api/lorebook.js): si el servidor responde pero el texto no
// se puede parsear como lorebook, igual se avanza `lorebookMessageCount` al
// tamaño actual del chat. La alternativa (dejarlo sin avanzar) reintentaría
// en cada mensaje siguiente reenviando una ventana de mensajes cada vez más
// grande contra un modelo que ya mostró que no sabe seguir el formato
// pedido — así, en cambio, se pierde esa ventana puntual de memoria pero no
// se entra en un reintento sin fin. Si en cambio falla la llamada en sí
// (red, servidor caído), no se avanza el contador: ahí sí vale la pena
// reintentar pronto, apenas el servidor vuelva a responder.
async function maybeUpdateLorebook() {
  if (lorebookUpdateInFlight) return;
  if (!character || !chat || !settings) return;
  if (!shouldUpdateLorebook(chat, messages.length)) return;

  const targetChatId = chat.id;
  const targetCharacterId = character.id;
  const targetCount = messages.length;
  const baseLorebook = character.lorebook || [];
  const newMessages = messages.slice(chat.lorebookMessageCount || 0);

  lorebookUpdateInFlight = true;
  try {
    const prompt = buildExtractionPrompt(character, settings, newMessages, baseLorebook);
    const raw = await completeOnce(prompt, settings, { temp: LOREBOOK_EXTRACT_TEMP });
    const parsed = parseExtractionResponse(raw);
    const lorebook = parsed ? sanitizeLoreEntries(parsed, baseLorebook) : baseLorebook;
    const updatedCharacter = await saveCharacterLorebook(targetCharacterId, lorebook);
    const updatedChat = await markChatLorebookProgress(targetChatId, targetCount);
    if (character && character.id === targetCharacterId) character = updatedCharacter;
    if (chat && chat.id === targetChatId) chat = updatedChat;
  } catch (err) {
    // Mejor esfuerzo: se reintenta solo cuando el umbral se vuelva a cumplir.
  } finally {
    lorebookUpdateInFlight = false;
  }
}

function openLorebookSheet() {
  const wrap = document.createElement('div');
  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = character ? `Lorebook de ${character.name}` : 'Lorebook';
  wrap.appendChild(title);

  const entries = (character && character.lorebook) || [];
  if (!entries.length) {
    const hint = document.createElement('div');
    hint.className = 'field__hint';
    hint.textContent = `Todavía no hay entradas. Se generan solas a medida que avanza la conversación ` +
      `en cualquiera de tus chats con este personaje (cada ~${LOREBOOK_UPDATE_EVERY_MESSAGES} mensajes).`;
    wrap.appendChild(hint);
  } else {
    entries
      .slice()
      .sort((a, b) => (b.updated || 0) - (a.updated || 0))
      .forEach((entry) => {
        const field = document.createElement('div');
        field.className = 'field';

        const label = document.createElement('div');
        label.className = 'field__label';
        label.textContent = entry.content;
        field.appendChild(label);

        const hint = document.createElement('div');
        hint.className = 'field__hint';
        hint.textContent = (entry.keys || []).join(', ');
        field.appendChild(hint);

        wrap.appendChild(field);
      });
  }

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
// en prompt.js). Solo informativo, se muestra al abrir el menú del chat.
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
    const { approxTokens, budgetTokens, ratio } = estimateContextUsage(
      character.card, messages, settings, chat ? chat.scenario : ''
    );
    const pct = Math.round(Math.min(ratio, 1) * 100);
    hint.textContent = ratio >= 1
      ? `Contexto lleno (≈${approxTokens} de ${budgetTokens} tokens aprox.): los mensajes más viejos ya se están recortando.`
      : `Contexto usado: ~${pct}% (≈${approxTokens} de ${budgetTokens} tokens aprox.)`;
  }
  field.appendChild(hint);

  return field;
}

function onMenu() {
  const wrap = document.createElement('div');
  wrap.appendChild(buildUsageInfo());

  const settingsBtn = document.createElement('button');
  settingsBtn.type = 'button';
  settingsBtn.className = 'menu-item';
  settingsBtn.textContent = 'Ajustes';
  settingsBtn.addEventListener('click', () => {
    openSettings(app);
  });
  wrap.appendChild(settingsBtn);

  const appearanceBtn = document.createElement('button');
  appearanceBtn.type = 'button';
  appearanceBtn.className = 'menu-item';
  appearanceBtn.textContent = 'Apariencia';
  appearanceBtn.addEventListener('click', () => {
    openAppearance(app);
  });
  wrap.appendChild(appearanceBtn);

  const bgBtn = document.createElement('button');
  bgBtn.type = 'button';
  bgBtn.className = 'menu-item';
  bgBtn.textContent = 'Fondo del chat';
  bgBtn.addEventListener('click', () => {
    openChatBackground(app, character);
  });
  wrap.appendChild(bgBtn);

  const backToChatsBtn = document.createElement('button');
  backToChatsBtn.type = 'button';
  backToChatsBtn.className = 'menu-item';
  backToChatsBtn.textContent = 'Volver a los chats de este personaje';
  backToChatsBtn.addEventListener('click', () => {
    if (busy) cancelGeneration();
    app.navigate('chats', { characterId: chat.characterId });
  });
  wrap.appendChild(backToChatsBtn);

  const lorebookBtn = document.createElement('button');
  lorebookBtn.type = 'button';
  lorebookBtn.className = 'menu-item';
  lorebookBtn.textContent = 'Ver lorebook';
  lorebookBtn.addEventListener('click', () => {
    openLorebookSheet();
  });
  wrap.appendChild(lorebookBtn);

  if (character && character.card.alternate_greetings && character.card.alternate_greetings.length && isOnlyGreeting()) {
    const greetBtn = document.createElement('button');
    greetBtn.type = 'button';
    greetBtn.className = 'menu-item';
    greetBtn.textContent = 'Cambiar saludo';
    greetBtn.addEventListener('click', () => {
      openGreetingSheet();
    });
    wrap.appendChild(greetBtn);
  }

  const avatarBtn = document.createElement('button');
  avatarBtn.type = 'button';
  avatarBtn.className = 'menu-item';
  avatarBtn.textContent = 'Cambiar avatar';
  avatarBtn.addEventListener('click', () => {
    app.closeSheet();
    onChangeAvatar();
  });
  wrap.appendChild(avatarBtn);

  const exportBtn = document.createElement('button');
  exportBtn.type = 'button';
  exportBtn.className = 'menu-item';
  exportBtn.textContent = 'Exportar este chat';
  exportBtn.addEventListener('click', () => {
    app.closeSheet();
    onExportChat();
  });
  wrap.appendChild(exportBtn);

  const importBtn = document.createElement('button');
  importBtn.type = 'button';
  importBtn.className = 'menu-item';
  importBtn.textContent = 'Importar chat';
  importBtn.addEventListener('click', () => {
    app.closeSheet();
    onImportChat();
  });
  wrap.appendChild(importBtn);

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
    chat: { id: chat.id, title: chat.title, scenario: chat.scenario },
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
    .map((m) => ({ role: m.role, text: m.text, ts: typeof m.ts === 'number' ? m.ts : Date.now() }));

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
