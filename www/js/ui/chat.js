// www/js/ui/chat.js
// Pantalla de chat: burbujas, streaming, avatar en 3 modos, composer, menú.

import { getChat, getChatMessages, saveChatMessages, getCharacter, getSettings, saveSettings, markChatExported, saveCharacterLorebook, markChatLorebookProgress, saveChatContinuity, sanitizeContinuity, sanitizeMessage, saveCharacterRelationship, saveCharacterIdentity, saveCharacterMood, saveCharacterMoment, saveCharacterFollowUps, saveCharacterLife, saveChatArchive, isChatArchived, isChatArchivePending, insertSceneBreak } from '../state.js';
import { generateReplyNonEmpty, completeOnce, completeChatOnce } from '../api/kobold.js';
import { initialMessages, scenarioGreeting, estimateContextUsage, subMacros } from '../api/prompt.js';
import {
  createLoreUpdater,
  editLoreEntry,
  removeLoreEntry,
  archiveLoreEntry,
  restoreLoreEntry,
  purgeArchivedEntry,
  removeTombstonesFor,
  parseKeysInput,
  cleanStoredLorebook,
  loreBudgetPreview,
  loreIndicatorState,
  compareLoreUsed,
  addTombstone,
  LOREBOOK_UPDATE_EVERY_MESSAGES,
  LOREBOOK_MAX_ENTRY_CHARS,
  LOREBOOK_ALWAYS_CHAR_BUDGET,
} from '../api/lorebook.js';
import {
  sanitizeRelationship,
  relationshipAgeText,
  relationshipDisplayText,
  relationshipForPrompt,
  createRelationshipUpdater,
  RELATIONSHIP_TEXT_MAX_CHARS,
} from '../api/relationship.js';
import { appearanceOf } from '../character-appearance.js';
import { identityForPrompt } from '../api/identity-synthesis.js';
import { moodText } from '../api/mood.js';
import { computeMood, moodHeadText, moodDisplayStatus, feelingDisplayStatus, planSplit, typingHoldMs } from '../api/presence.js';
import { momentCandidate, withMoment } from '../api/moments.js';
import { detectFollowUps, detectUserDates, withFollowUps, withUserDates, markAsked, markDone } from '../api/followups.js';
import { createFeelingUpdater, feelingDisplayText } from '../api/feeling.js';
import { formatMessageTime, formatMessageFullTime } from '../msgtime.js';
import { createContinuityUpdater, coveredCount, CONTINUITY_TOTAL_CHARS, CONTINUITY_ON_OPEN_DELAY_MS, cleanRecap, verifyRecap } from '../api/continuity.js';
import { openCharacterSheet } from './character-sheet.js';
import { haptics, setHapticsEnabled } from './haptics.js';
import { archiveChat, archiveResultMessage, cancelBackgroundArchive } from './chat-archive.js';
import { cancelBackgroundIdentity } from './identity.js';
import { cancelBackgroundLife } from './life.js';
import { withLifeMentioned } from '../api/life.js';
import { cancelBackgroundMailbox, touchInteraction } from './mailbox.js';
import { memoryDashboardModel, buildRelationshipHero, buildContinuityCard, buildMemoryCards, buildGroupedMemoryCards, buildIdentityCard } from './character-memory.js';
import { buildMemoryRefinePrompt, buildMemoryRefinePlainPrompt, parseMemoryRefineResponse } from '../api/memory-clustering.js';
import { acceptProposal, discardProposal, revertIdentity } from '../api/identity-synthesis.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';
import { formatMessage } from './format.js';
import { variantCount, activeVariantIndex, addVariant, selectVariant, editActiveText } from '../variants.js';
import { MESSAGE_ACTIONS, availableMessageActions, revealDelta, shouldCloseOnScroll } from './msgmenu.js';
import { pickFiles, saveBlob, autoBackupBlob } from '../platform.js';
import { averageColorFromDataUrl } from '../images.js';
import { setGlassTint } from './shell.js';
import { createThrottle, STREAM_PAINT_MS, lastReplyText, sanitizeMeta, estimateRowHeight, charsPerBubbleLine } from '../perf.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_MENU = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="19" cy="12" r="1.2"/></svg>';
// UI-010: marcapáginas pequeño; gris = ningún recuerdo usado, color de acento = usó alguno.
const ICON_LORE = '<svg viewBox="0 0 24 24"><path d="M7 4h10a1 1 0 0 1 1 1v15l-6-3.5L6 20V5a1 1 0 0 1 1-1z"/></svg>';
const ICON_RETRY = '<svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/></svg>';
const ICON_SEND = '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
const ICON_STOP = '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2.5"/></svg>';
const ICON_DOWN = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>';

const NEAR_BOTTOM_PX = 200;

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
let blurTimeoutId = null;

const draftByChat = new Map();

export function init(rootEl, appApi) {
  root = rootEl;
  app = appApi;

  root.innerHTML = `
    <div class="topbar">
      <button class="ib" type="button" id="chat-back" aria-label="Volver">${ICON_BACK}</button>
      <div class="chat-head" id="chat-head">
        <button class="chat-head__name" type="button" id="chat-head-name" aria-label="Ver ficha del personaje">
          <div class="chat-head__avatar av" id="chat-head-avatar"></div>
          <div class="chat-head__info">
            <span class="chat-head__nm" id="chat-head-nm"></span>
            <span class="chat-head__sub" id="chat-head-sub"></span>
          </div>
        </button>
      </div>
      <button class="ib" type="button" id="chat-menu" aria-label="Más">${ICON_MENU}</button>
    </div>
    <div class="chat-bg" id="chat-bg" hidden>
      <div class="chat-bg__fade" id="chat-bg-fade" hidden></div>
    </div>
    <div class="chat-messageswrap">
      <div class="scroll chat-messages" id="chat-messages"></div>
      <div class="chat-icebreakers" id="chat-icebreakers" hidden></div>
      <button class="chat-scrolldown" type="button" id="chat-scrolldown" aria-label="Ir al último mensaje" hidden>${ICON_DOWN}</button>
    </div>
    <div class="chat-archivedbar" id="chat-archivedbar" hidden>
      <span>Este episodio está archivado: solo se puede leer.</span>
      <button class="btn btn--sm" type="button" id="chat-restore">Restaurar</button>
    </div>
    <div class="chat-composer" id="chat-composer">
      <textarea class="inp chat-composer__input" id="chat-input" rows="1" placeholder="Escribe un mensaje" autocomplete="off" autocapitalize="sentences"></textarea>
      <button class="chat-send" type="button" id="chat-send" aria-label="Enviar">${ICON_SEND}</button>
    </div>
  `;

  els = {
    back: root.querySelector('#chat-back'),
    headName: root.querySelector('#chat-head-name'),
    headAvatar: root.querySelector('#chat-head-avatar'),
    headNm: root.querySelector('#chat-head-nm'),
    headSub: root.querySelector('#chat-head-sub'),
    menu: root.querySelector('#chat-menu'),
    bg: root.querySelector('#chat-bg'),
    bgFade: root.querySelector('#chat-bg-fade'),
    messages: root.querySelector('#chat-messages'),
    icebreakers: root.querySelector('#chat-icebreakers'),
    scrollDown: root.querySelector('#chat-scrolldown'),
    composer: root.querySelector('#chat-composer'),
    archivedBar: root.querySelector('#chat-archivedbar'),
    restore: root.querySelector('#chat-restore'),
    input: root.querySelector('#chat-input'),
    send: root.querySelector('#chat-send'),
  };

  els.back.addEventListener('click', onBack);
  els.headName.addEventListener('click', onOpenCharacterSheet);
  els.menu.addEventListener('click', onMenu);
  els.input.addEventListener('input', onInputChange);
  els.input.addEventListener('keydown', onInputKeydown);
  els.input.addEventListener('focus', onInputFocus);
  els.input.addEventListener('blur', onInputBlur);
  els.send.addEventListener('click', onSendClick);
  els.restore.addEventListener('click', onRestoreEpisode);
  els.messages.addEventListener('click', onMessagesClick);
  els.messages.addEventListener('scroll', onMessagesScroll, { passive: true });
  els.scrollDown.addEventListener('click', () => { haptics.tap(); scrollToBottom(true, true); });

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

// UI-039: opacidad de las burbujas (por personaje). Con 100 % se quita la clase y todo queda exactamente como siempre.
// Solo aplica si el personaje tiene un fondo: sin imagen detrás no hay nada que ver a través de la burbuja.
function applyBubbleOpacity() {
  const pct = character && character.chatBackground && Number.isFinite(character.bubbleOpacity) ? character.bubbleOpacity : 100;
  root.classList.toggle('chat--translucent', pct < 100);
  root.style.setProperty('--bubble-opacity', String(pct / 100));
}

function applyChatBackground() {
  applyBubbleOpacity();
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
  // MEM-018: abrir un chat tiene prioridad sobre un archivado en segundo plano (latencia primero): se corta y el episodio
  // sigue pendiente para la próxima vez que el hub vea el servidor encendido.
  cancelBackgroundArchive();
  cancelBackgroundMailbox(); // PROACT-001: igual que lo anterior
  cancelBackgroundLife(); // HUM-005: igual que lo anterior
  cancelBackgroundIdentity(); // MEM-019: si el hub dejó una síntesis de identidad corriendo, se corta (se reintenta en el próximo chequeo)
  archiving = false;
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
  setHapticsEnabled(settings && settings.hapticsEnabled !== false);
  touchInteraction(character.id); // PROACT-001: el usuario estuvo con este personaje (para saber cuánto estuvo ausente)

  let loaded = await getChatMessages(chat.id);
  const isBrandNewScenarioChat = (!loaded || !loaded.length) && !!chat.scenario;
  if (!loaded) {
    // FASE 15: si el chat tiene escenario propio, se inicializa vacío para que el LLM
    // principal genere de inmediato el saludo/entrada a escena del personaje respondiendo al escenario.
    loaded = isBrandNewScenarioChat
      ? []
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

  els.headNm.textContent = character.name;
  if (els.headAvatar) setAvatarEl(els.headAvatar, character);
  els.input.value = draftByChat.get(chat.id) || '';
  autosizeInput();
  syncSendButton();
  applyChatBackground();
  updateGlassTint();
  applyArchivedState();
  renderMessages();

  if (isBrandNewScenarioChat && messages.length === 0) {
    generate().catch((err) => console.error('Error generating opening scene:', err));
  }

  attachViewportListeners();
  checkKeyboardFromVh();
  maybeUpdateContinuityOnOpen();
}

// UI-027: entrada "Ver recuerdos" desde la ficha abierta en chats.js (sin chat activo todavía ahí):
// primero se espera a que `app.navigate('chat', …)` termine (así `currentView`/el historial ya están
// al día) y RECIÉN AHÍ se abre esta hoja — abrirla desde dentro de `show()` empujaba su entrada de
// historial con el `currentView` viejo todavía sin actualizar, y el "atrás" siguiente volvía dos
// pantallas en vez de una. Sin este desvío no hace falta: chat.js ya la abre directo (menú, avisos).
export function openLorebookFromOutside() {
  if (!character) return;
  openLorebookSheet();
}

export function hide() {
  openToken++; // MEM-010: invalida el disparo por ausencia pendiente de este chat
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

// UI-027: tocar el nombre en la cabecera abre la ficha de lectura (foto grande, relación, rasgos,
// recuerdos…), con un botón "Editar" que lleva al editor de CCC-001/CCC-003.
// UI-028: la cabecera ya no muestra ningún avatar propio (ni el círculo chico ni el retrato grande
// expandible) — la foto del personaje ahora vive junto a sus burbujas (`buildMessageRow`) y en la
// ficha (UI-027). Si el nombre o la foto cambiaron (editar o "Cambiar foto" desde la ficha), se
// rehace la lista para que las burbujas ya vistas usen el avatar nuevo.
function onOpenCharacterSheet() {
  if (!character) return;
  openCharacterSheet(app, character, {
    onUpdated: (updated) => {
      character = updated;
      els.headNm.textContent = character.name;
      if (els.headAvatar) setAvatarEl(els.headAvatar, character);
      renderMessages();
    },
    openMemories: () => openLorebookSheet(),
  });
}

// Avatar-o-inicial dentro de un `.av` ya existente (círculo junto a las burbujas del personaje, UI-028).
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

// Mantiene el chat pegado abajo cuando el teclado abre/cierra (el resto de la detección de "¿está
// abierto el teclado?" que vivía acá era solo para el retrato grande de la cabecera; UI-028 lo quitó).
function checkKeyboardFromVh() {
  scrollToBottom(false);
}

/* ---------- rompehielos contextuales (Fase 13) ---------- */

function getIcebreakerSuggestions() {
  if (!character) return [];
  const charName = character.name || 'tu acompañante';
  const userName = settings?.userName || 'Tú';
  const suggestions = [];

  const alts = character.card?.data?.alternate_greetings;
  if (Array.isArray(alts) && alts.length > 0) {
    for (const alt of alts) {
      if (typeof alt === 'string' && alt.trim()) {
        const cleaned = subMacros(alt.trim(), charName, userName)
          .replace(/^\*.*?\*\s*/, '')
          .replace(/^["'«“]|["'»”]$/g, '')
          .trim();
        if (cleaned && cleaned.length <= 120 && !suggestions.includes(cleaned)) {
          suggestions.push(cleaned);
          if (suggestions.length >= 3) break;
        }
      }
    }
  }

  if (suggestions.length < 2) {
    const sc = character.card?.data?.scenario;
    if (typeof sc === 'string' && sc.trim().length > 10) {
      suggestions.push('Hola ' + charName + ', ¿en qué estabas pensando?');
    }
  }

  const defaults = [
    'Hola ' + charName + ', ¿cómo estás hoy?',
    'Cuéntame de qué te gustaría hablar hoy.',
    '¿Qué has estado haciendo últimamente?'
  ];

  for (const def of defaults) {
    if (suggestions.length >= 3) break;
    if (!suggestions.includes(def)) suggestions.push(def);
  }

  return suggestions.slice(0, 3);
}

function renderIcebreakers() {
  if (!els.icebreakers) return;
  const hasUserMessages = messages && messages.some((m) => m && m.role === 'user');
  if (hasUserMessages || !character) {
    els.icebreakers.hidden = true;
    els.icebreakers.replaceChildren();
    return;
  }

  const suggestions = getIcebreakerSuggestions();
  if (!suggestions.length) {
    els.icebreakers.hidden = true;
    return;
  }

  els.icebreakers.classList.remove('chat-icebreakers--leaving');
  els.icebreakers.hidden = false;
  els.icebreakers.replaceChildren();

  suggestions.forEach((text) => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'chat-icebreaker-pill';
    pill.textContent = text;
    pill.setAttribute('aria-label', 'Sugerencia: ' + text);
    pill.addEventListener('click', () => {
      haptics.tap();
      els.input.value = text;
      onInputChange();
      els.input.focus();
    });
    els.icebreakers.appendChild(pill);
  });
}

function hideIcebreakers() {
  if (!els.icebreakers || els.icebreakers.hidden) return;
  els.icebreakers.classList.add('chat-icebreakers--leaving');
  setTimeout(() => {
    if (els.icebreakers) {
      els.icebreakers.hidden = true;
      els.icebreakers.classList.remove('chat-icebreakers--leaving');
    }
  }, 180);
}

/* ---------- lista de mensajes ---------- */

// UI-001: reconstrucción TOTAL de la lista. Solo al abrir el chat y en cambios estructurales (borrar, editar hasta vaciar,
// importar…) o como respaldo si el DOM no coincide con `messages`. Enviar, recibir y regenerar usan las funciones
// incrementales de abajo (una fila a la vez). Se arma en un fragmento y se inserta de una vez.
function renderMessages() {
  clearSelection();
  streamRow = null;
  streamBubble = null;
  streamReply = null;
  streamPaint.cancel();
  retryEl = null;
  rowCharsPerLine = charsPerBubbleLine(els.messages.clientWidth); // una sola lectura de layout por reconstrucción
  const frag = document.createDocumentFragment();
  messages.forEach((m, i) => {
    frag.appendChild(buildMessageRow(m, i));
  });
  els.messages.replaceChildren(frag);
  syncRetryButton();
  scrollToBottom(true);
  renderIcebreakers();
}

// Caracteres por línea de burbuja en esta pantalla (para estimar la altura de las filas fuera de pantalla; ver chat.css).
let rowCharsPerLine = 32;

// Fila en curso (respuesta que se está recibiendo), para no buscarla en cada fragmento.
let streamRow = null;
let streamBubble = null;
let streamReply = null;
// Cadencia del repintado mientras llega la respuesta (≈ cada 90 ms) y, con él, del scroll al fondo.
const streamPaint = createThrottle(paintStreamingBubble, STREAM_PAINT_MS);
// HUM-001: hasta cuándo se retiene el primer texto de la respuesta (pausa natural) y el temporizador que lo libera.
let streamHoldUntil = 0;
let streamHoldTimer = 0;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let retryEl = null; // el ícono "Reintentar respuesta", si está en la lista

function removeRetryButton() {
  if (retryEl) retryEl.remove();
  retryEl = null;
}

// El ícono de reintentar aparece tras el último mensaje SOLO si es del usuario y no hay respuesta en curso.
function syncRetryButton() {
  const want = !busy && messages.length > 0 && messages[messages.length - 1].role === 'user';
  if (!want) {
    removeRetryButton();
    return;
  }
  if (retryEl && retryEl.parentNode === els.messages) return;
  retryEl = buildRetryButton();
  els.messages.appendChild(retryEl);
}

// ¿Las filas del DOM son exactamente las de `messages` (sin contar el ícono de reintentar)?
function rowsMatchMessages() {
  const extra = retryEl && retryEl.parentNode === els.messages ? 1 : 0;
  return els.messages.childElementCount - extra === messages.length;
}

// Añade la fila del mensaje `i` (que acaba de agregarse al final de `messages`). Si el DOM no está en el estado esperado
// se reconstruye todo (respaldo seguro). Devuelve la fila, o null si tuvo que reconstruir.
function appendMessageRow(i) {
  clearSelection();
  removeRetryButton();
  if (els.messages.childElementCount !== i || i !== messages.length - 1) {
    renderMessages();
    return null;
  }
  const row = buildMessageRow(messages[i], i);
  els.messages.appendChild(row);
  syncRetryButton();
  return row;
}

// Sustituye la fila del mensaje `i` por una nueva (texto editado, versión elegida, respuesta terminada). Respaldo: reconstruir.
function refreshMessageRow(i) {
  const old = els.messages.children[i];
  if (!old || old.dataset.index !== String(i) || !messages[i]) {
    renderMessages();
    return;
  }
  clearSelection();
  old.replaceWith(buildMessageRow(messages[i], i));
}

// UI-012: las comillas como señal de diálogo van con el interruptor "Corregir formato automáticamente".
function formatOpts(role) {
  return { role, quoteDialogue: !!settings && settings.formatAssist !== false };
}

// Pinta el texto de una burbuja. UI-023: marca con `.chat-bubble--split` las del personaje que traen cursiva (formato Nomi);
// solo tiene efecto visual si el usuario activó "Tipografía dividida" (ver chat.css).
function setBubbleContent(bubble, m) {
  const html = formatMessage(m.text, formatOpts(m.role));
  bubble.innerHTML = html;
  bubble.classList.toggle('chat-bubble--split', m.role === 'char' && html.includes('<em>'));
}

function buildMessageRow(m, i) {
  if (m.kind === 'scene_break' || m.role === 'system') {
    const row = document.createElement('div');
    row.className = 'chat-row chat-row--scene-break';
    row.dataset.index = String(i);
    row.style.setProperty('--row-h', '44px');
    const divider = document.createElement('div');
    divider.className = 'chat-scene-break';
    const textSpan = document.createElement('span');
    textSpan.className = 'chat-scene-break__text';
    textSpan.textContent = m.text || 'Corte de escena';
    divider.appendChild(textSpan);
    row.appendChild(divider);
    return row;
  }

  const isLast = i === messages.length - 1;
  const isChar = m.role === 'char';
  const row = document.createElement('div');
  row.className = 'chat-row ' + (isChar ? 'chat-row--char' : 'chat-row--user');
  row.dataset.index = String(i);
  // Altura estimada mientras la fila esté fuera de pantalla (chat.css: contain-intrinsic-size). No afecta a lo que se ve.
  row.style.setProperty('--row-h', estimateRowHeight(m.text, rowCharsPerLine, loreIndicatorState(m) !== 'none' || variantCount(m) > 1, true) + 'px');

  // UI-028: avatar circular junto a las burbujas del personaje, alineado arriba. Solo en el PRIMERO de
  // cada racha de mensajes consecutivos del personaje (se mira `messages[i-1]`, estable: nada cambia el
  // `role` de un mensaje ya guardado); en el resto de la racha se reserva el mismo ancho con un div vacío,
  // para que todas las burbujas de la racha queden alineadas igual. Reutiliza `character.avatar` tal cual
  // (mismo data: URL en cada fila que lo usa, así el navegador decodifica la imagen una sola vez).
  const bubble = document.createElement('div');
  bubble.className = 'chat-bubble';
  if (isChar && !m.text && busy && isLast) {
    bubble.classList.add('chat-bubble--thinking');
    bubble.appendChild(buildDots());
  } else {
    setBubbleContent(bubble, m);
  }
  row.appendChild(bubble);

  // FASE 16: Línea bajo la burbuja ultra-limpia (solo marcapáginas, versiones y hora, sin etiquetas duplicadas)
  const loreState = loreIndicatorState(m);
  const showLore = loreState !== 'none' && !!m.text;
  const showVariants = isChar && variantCount(m) > 1 && !!m.text;
  const stampText = m.text ? formatMessageTime(m.ts) : '';
  if (showLore || showVariants || stampText) {
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
      meta.appendChild(btn); // el clic se atiende por delegación en onMessagesClick (sin un listener por fila)
    }
    if (showVariants) meta.appendChild(buildVariantNav(m, i)); // después del marcapáginas: este no cambia de sitio (UI-016)
    if (stampText) meta.appendChild(buildStamp(m, stampText));
    row.appendChild(meta);
  }

  return row;
}

// MEM-011: `14:05` (o `24 sep` si es de un día anterior) y, a su lado, `sintiendo nostalgia` cuando el mensaje del personaje activó 3 o más
// recuerdos por tema y la heurística (api/mood.js, sin modelo) reconoce una emoción clara; si no, solo la hora. Discreto y en letra chica.
function buildStamp(m, text) {
  const stamp = document.createElement('span');
  stamp.className = 'chat-stamp';
  const time = document.createElement('time');
  time.dateTime = new Date(m.ts).toISOString();
  time.title = formatMessageFullTime(m.ts);
  time.textContent = text;
  stamp.appendChild(time);
  return stamp;
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
    b.dataset.step = String(delta); // clic por delegación en onMessagesClick
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
  if (busy || isReadOnlyChat()) return;
  const m = messages[i];
  if (!m) return;
  const next = selectVariant(m, activeVariantIndex(m) + delta);
  if (next === m) return;
  clearSelection();
  messages[i] = next;
  refreshMessageRow(i);
  scrollToBottom(false);
  await persistChat(); // la versión activa es la que se envía al modelo en el próximo turno: debe quedar guardada
}

// UI-006: UN solo menú de acciones para todo el chat. Se construye la primera vez que se necesita y después se
// MUEVE a la fila del mensaje seleccionado (no hay botones por fila, así el número de nodos no crece con el chat).
let msgMenu = null;
let menuIndex = -1; // índice del mensaje al que está asociado el menú; -1 = cerrado
let selectedRow = null; // fila seleccionada (la que tiene el menú), para no buscarla en el DOM
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
  // UI-028: en un mensaje del personaje el menú va DENTRO de `.chat-row__body`, alineado con la burbuja
  // (no con el avatar); `row` mismo sigue siendo el objetivo para un mensaje del usuario (sin ese wrapper).
  (row.querySelector(':scope > .chat-row__body') || row).appendChild(menu);
  row.classList.add('chat-row--selected');
  selectedRow = row;
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
  btn.addEventListener('click', () => { haptics.tap(); generate(); });
  return btn;
}

function onMessagesClick(e) {
  // UI-001: los botones de la línea bajo la burbuja (marcapáginas de memoria y selector de versiones) se atienden aquí,
  // con un único listener para toda la lista.
  const metaBtn = e.target.closest('.chat-lore, .chat-variants__btn');
  if (metaBtn) {
    const metaRow = metaBtn.closest('.chat-row');
    const mi = metaRow ? Number(metaRow.dataset.index) : -1;
    if (mi < 0 || !messages[mi]) return;
    if (metaBtn.classList.contains('chat-lore')) openLoreUsedSheet(messages[mi]);
    else if (!metaBtn.disabled) onVariantStep(mi, Number(metaBtn.dataset.step));
    return;
  }
  if (busy || isReadOnlyChat()) return;
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
  if (selectedRow) selectedRow.classList.remove('chat-row--selected');
  selectedRow = null;
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
    if (value) refreshMessageRow(i); // solo cambia esa fila
    else renderMessages(); // borrar desplaza los índices: reconstrucción total
  });

  wrap.append(title, textarea, saveBtn);
  app.openSheet(wrap);
}

async function deleteMessage(i) {
  const ok = await app.confirmDialog('¿Eliminar este mensaje? No podrás recuperarlo.', {
    confirmText: 'Eliminar',
    danger: true,
  });
  if (!ok) return;
  haptics.action();
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

function scrollToBottom(force, smooth) {
  if (force || atBottom) {
    // Con content-visibility las filas fuera de pantalla usan una altura estimada: al llegar abajo se miden las reales y el
    // final se corre un poco. Se repite (máx. 4 veces) hasta que el fondo deja de moverse.
    const el = els.messages;
    if (smooth) {
      el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    } else {
      for (let k = 0; k < 4; k++) {
        const target = el.scrollHeight;
        el.scrollTop = target;
        if (el.scrollHeight === target) break;
      }
    }
    atBottom = true;
  }
  updateScrollDownVisibility();
}

// Mientras llega una respuesta: solo baja (una lectura y una escritura) si el usuario estaba abajo; el botón "volver
// abajo" se actualiza solo con el siguiente evento de scroll (a lo más una vez por cuadro).
function followStreamToBottom() {
  if (atBottom) els.messages.scrollTop = els.messages.scrollHeight;
}

function updateScrollDownVisibility() {
  els.scrollDown.hidden = isNearBottom();
}

// UI-001: el listener es pasivo y el trabajo (que lee el layout) se hace como máximo UNA vez por cuadro.
let scrollFrame = 0;
function onMessagesScroll() {
  if (scrollFrame) return;
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0;
    // UI-006/UI-016: el menú se cierra al alejarse con el scroll (no por el ajuste al abrirlo ni por un temblor del dedo).
    const top = els.messages.scrollTop;
    if (shouldCloseOnScroll({ open: menuIndex >= 0, scrollTop: top, openScrollTop: menuOpenScrollTop })) clearSelection();
    atBottom = isNearBottom();
    updateScrollDownVisibility();
  });
}

/* ---------- composer ---------- */

function onInputChange() {
  continuityUpdater.abortOnOpenRun(); // MEM-010: el usuario empezó a escribir: el repaso al abrir el chat cede (prioridad absoluta al mensaje)
  feelingUpdater.abort(); // MEM-015: a diferencia de las otras tres, esta cede con la PRIMERA tecla, no solo al enviar
  autosizeInput();
  syncSendButton();
  if (chat) draftByChat.set(chat.id, els.input.value);
}

function autosizeInput() {
  els.input.style.height = 'auto';
  els.input.style.height = Math.min(els.input.scrollHeight, 140) + 'px';
}

// HUM-001: línea bajo el nombre: "escribiendo…" mientras responde; si no, el ánimo del momento ("ánimo tranquilo"). El ánimo mostrado es el
// guardado más la hora y el día (sin lo que se escriba): el que se usa al responder lo recalcula `generateReply` con el mensaje nuevo.
function headSubText() {
  if (busy) return 'typing…';
  if (!character || !settings || settings.humanTouch !== true) return '';

  const d = new Date();
  const charHash = (character.id || character.name || 'char').split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  const seed = d.getHours() * 31 + d.getDate() * 7 + charHash;

  // FASE 16: Si el último mensaje del personaje activó un sentimiento puntual, lo refleja prioritariamente:
  const lastChar = [...(messages || [])].reverse().find((m) => m && m.role === 'char');
  if (lastChar && lastChar.feeling) {
    const rawF = typeof lastChar.feeling === 'string' ? lastChar.feeling : (lastChar.feeling.word || lastChar.feeling.id || '');
    const feelStatus = feelingDisplayStatus(rawF.toLowerCase(), seed);
    if (feelStatus) return feelStatus;
  }

  const moodId = computeMood({ prev: character.mood, characterId: character.id, tags: character.personalityTags, now: d }).id;
  return moodDisplayStatus(moodId, seed) || moodHeadText(moodId);
}

function syncHeadSub() {
  if (!els.headSub) return;
  const text = headSubText();
  els.headSub.textContent = text;
  els.headSub.hidden = !text;
  els.headSub.classList.toggle('chat-head__sub--typing', busy);
}

function syncSendButton() {
  syncHeadSub();
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
}

function onInputBlur() {
  clearTimeout(blurTimeoutId);
  blurTimeoutId = setTimeout(() => {
    checkKeyboardFromVh();
  }, 60);
}

// MEM-018: un episodio archivado es SOLO LECTURA (decisión documentada en HISTORIAL.md): sin barra de escritura ni acciones
// sobre los mensajes hasta restaurarlo con el botón «Restaurar». Mientras se archiva el episodio abierto también se bloquea.
let archiving = false;

function isReadOnlyChat() {
  return archiving || isChatArchived(chat);
}

function applyArchivedState() {
  const archived = isChatArchived(chat);
  els.archivedBar.hidden = !archived;
  els.composer.hidden = archived;
  root.classList.toggle('chat--archived', archived);
}

async function onRestoreEpisode() {
  if (!chat || !isChatArchived(chat)) return;
  els.restore.disabled = true;
  try {
    chat = await saveChatArchive(chat.id, { archivedAt: 0, archivePendingAt: 0 });
    applyArchivedState();
    renderMessages();
    app.toast('Episodio restaurado. Vuelve a estar en tu lista de episodios.');
  } catch {
    app.toast('No se pudo restaurar el episodio.');
  } finally {
    els.restore.disabled = false;
  }
}

// FASE 17 (PARETO-010): "Nuevo capítulo / Corte de escena" dentro del chat único continuo.
function onNewSceneBreak() {
  app.closeSheet();
  const wrap = document.createElement('div');

  const title = document.createElement('h3');
  title.className = 'sheet__title';
  title.textContent = 'Nuevo capítulo / Corte de escena';
  wrap.appendChild(title);

  const field = document.createElement('div');
  field.className = 'field';
  field.innerHTML = `
    <label class="field__label" for="scene-break-title">Acontecimiento o salto temporal</label>
    <input class="inp" id="scene-break-title" type="text" autocomplete="off" maxlength="80"
      placeholder="Ej: A la mañana siguiente en la cafetería, Tres días después...">
  `;
  wrap.appendChild(field);

  const scenField = document.createElement('div');
  scenField.className = 'field';
  scenField.innerHTML = `
    <label class="field__label" for="scene-break-scenario">Nuevo escenario o situación (opcional)</label>
    <textarea class="inp" id="scene-break-scenario" rows="3" maxlength="300"
      placeholder="Orientación situacional para el companion en el nuevo momento."></textarea>
  `;
  wrap.appendChild(scenField);

  const insertBtn = document.createElement('button');
  insertBtn.type = 'button';
  insertBtn.className = 'btn';
  insertBtn.textContent = 'Insertar capítulo';
  wrap.appendChild(insertBtn);

  const titleInput = field.querySelector('#scene-break-title');
  const scenInput = scenField.querySelector('#scene-break-scenario');

  insertBtn.addEventListener('click', async () => {
    const text = titleInput.value.trim() || 'Corte de escena';
    const scenario = scenInput.value.trim();
    insertBtn.disabled = true;
    try {
      const { message } = await insertSceneBreak(chat.id, { text, ...(scenario ? { scenario } : {}) });
      if (scenario) chat.scenario = scenario;
      messages.push(message);
      appendMessageRow(messages.length - 1);
      scrollToBottom(true);
      haptics.tap();
      app.closeSheet();
    } catch (err) {
      insertBtn.disabled = false;
      app.toast('No se pudo insertar el capítulo.');
    }
  });

  app.openSheet(wrap);
  titleInput.focus();
}

// MEM-018: "Archivar este episodio". Fuerza recuerdos y resumen (api/chat-archive.js) y, si salió bien, vuelve a la pantalla anterior; si
// el servidor está apagado queda "pendiente de archivar" y se completa solo (hub). Nunca toca los mensajes.
async function onArchiveEpisode() {
  if (!character || !chat || archiving || busy || sendInFlight) return;
  const ok = await app.confirmDialog(
    `¿Archivar este episodio? ${character.name} guardará lo que aprendió y se hará un resumen (puede tardar un poco). ` +
      'Después se oculta de tu lista, pero queda guardado entero y lo puedes restaurar cuando quieras.',
    { confirmText: 'Archivar' }
  );
  if (!ok) return;
  app.closeSheet(); // el diálogo ya se cerró y dejó el menú ⋮ restaurado debajo: se cierra también
  archiving = true;
  loreUpdater.abort();
  continuityUpdater.abort();
  relationshipUpdater.abort();
  feelingUpdater.abort();
  els.input.disabled = true;
  const chatId = chat.id;
  const characterId = character.id;
  app.toast('Archivando… puede tardar unos segundos (si tu servidor está apagado, quedará pendiente).', { ms: 20000 });
  let result;
  try {
    result = await archiveChat(chatId);
  } catch {
    result = { kind: 'error' };
  }
  archiving = false;
  els.input.disabled = false;
  if (!chat || chat.id !== chatId) return; // el usuario ya se fue a otro lado: el resultado igual quedó guardado
  app.toast(archiveResultMessage(result), { ms: 6000 });
  if (result.kind === 'archived') {
    // Pequeña pausa: el diálogo de confirmación acaba de cerrarse y su entrada de historial todavía se está retirando.
    await new Promise((resolve) => setTimeout(resolve, 400));
    app.back();
    return;
  }
  // Pendiente o con error: el episodio sigue aquí; se recargan las copias en memoria porque la extracción pudo cambiar el lorebook.
  chat = (await getChat(chatId)) || chat;
  character = (await getCharacter(characterId)) || character;
  applyArchivedState();
}

async function onSendClick() {
  if (busy) {
    cancelGeneration();
    return;
  }
  const text = els.input.value.trim();
  if (!text || !character || !chat) return;
  hideIcebreakers();
  if (isReadOnlyChat()) return;
  // MEM-018: si el usuario retoma un episodio que estaba "pendiente de archivar", la intención ya no es esa: se cancela la marca.
  if (isChatArchivePending(chat)) {
    try {
      chat = await saveChatArchive(chat.id, { archivePendingAt: 0 });
    } catch {
      // mejor esfuerzo: si falla, el reintento verá el chat con mensajes nuevos y lo archivará con ellos
    }
  }

  els.input.value = '';
  draftByChat.delete(chat.id);
  autosizeInput();
  syncSendButton();
  haptics.send();

  // Prioridad absoluta al chat: si hay una extracción de memoria en curso se
  // cancela ya, y `sendInFlight` impide que arranque otra entre el guardado
  // del mensaje y el inicio de la respuesta (ver "lorebook automático").
  loreUpdater.abort();
  continuityUpdater.abort();
  relationshipUpdater.abort();
  feelingUpdater.abort();
  sendInFlight = true;
  try {
    messages.push({ role: 'user', text, ts: Date.now() });
    captureFollowUps(text); // HUM-004: pendientes y fechas del mensaje (sin modelo; solo escribe si detecta algo)
    appendMessageRow(messages.length - 1);
    scrollToBottom(true);
    logMessageEvent('user');
    await persistChat();
    await generate();
  } finally {
    sendInFlight = false;
    // Si el umbral de memoria se cruzó durante el envío o la respuesta, se
    // difirió hasta aquí: ahora el chat está libre.
    maybeUpdateLorebook();
    maybeUpdateContinuity();
    // MEM-015: generate() ya lo intentó, pero con `sendInFlight` todavía en true (isChatBusy lo frenó
    // igual que a las otras tres mientras dura TODO onSendClick, no solo generate()); se reintenta acá.
    const lastIdx = messages.length - 1;
    if (messages[lastIdx] && messages[lastIdx].role === 'char' && messages[lastIdx].text) maybeUpdateFeeling(lastIdx);
  }
}

/* ---------- generación ---------- */

// `opts.previous` (UI-017): la respuesta que se está regenerando. Se conserva y la nueva se AGREGA como versión.
async function generate(opts = {}) {
  const previous = (opts && opts.previous) || null;
  if (busy || !character || isReadOnlyChat()) return; // MEM-018: un episodio archivado no genera respuestas (ni "reintentar")
  loreUpdater.abort(); // también al regenerar: el chat tiene prioridad sobre la memoria
  continuityUpdater.abort();
  relationshipUpdater.abort();
  feelingUpdater.abort();
  busy = true;
  syncSendButton();

  const history = messages.slice();
  const reply = { role: 'char', text: '', ts: Date.now() };
  messages.push(reply);
  // La fila con los puntos de "escribiendo". Si hubo que reconstruir todo (respaldo), la fila de la respuesta es la última.
  const row = appendMessageRow(messages.length - 1) || els.messages.lastElementChild;
  scrollToBottom(true);
  streamRow = row;
  // UI-028: la burbuja ya no es siempre el primer hijo de la fila (las del personaje ahora
  // empiezan con el avatar/espacio reservado) — se busca por clase en vez de asumir la posición.
  streamBubble = row ? row.querySelector('.chat-bubble') : null;
  streamReply = reply;

  abortCtl = new AbortController();
  // UI-001: tiempos de ESTA respuesta (hasta el primer fragmento y total), medidos desde que se pide.
  const startedAt = performance.now();
  let firstChunkAt = 0;
  let replyMeta = null;
  let moodResult = null; // HUM-001: ánimo usado en este turno (se guarda si cambió)
  let lifeUsed = null; // HUM-005: si el personaje sacó su día en este turno (se anota que ese día ya se contó)
  let followUpUsed = null; // HUM-004: pendiente que se preguntó en este turno (se marca después de guardar la respuesta)
  let wasAborted = false;
  const humanTouch = !!settings && settings.humanTouch === true;
  streamHoldUntil = humanTouch ? startedAt + typingHoldMs(Math.random, character.mood && character.mood.id) : 0;

  try {
    const result = await generateReplyNonEmpty({
      character,
      chat,
      messages: history,
      settings,
      signal: abortCtl.signal,
      onToken: (chunk) => {
        if (!firstChunkAt) firstChunkAt = performance.now();
        reply.text += chunk;
        streamPaint.schedule(); // repinta como mucho cada ~90 ms; la cola final se vacía abajo
      },
    });
    reply.text = (result && result.text) || '';
    wasAborted = !!(result && result.aborted);
    moodResult = (result && result.mood) || null;
    followUpUsed = (result && result.followUp) || null;
    lifeUsed = (result && result.life) || null;
    // Una respuesta completa (no cortada por el usuario) guarda sus tiempos.
    if (reply.text && firstChunkAt && !(result && result.aborted)) {
      replyMeta = { ttftMs: firstChunkAt - startedAt, totalMs: performance.now() - startedAt, chars: reply.text.length };
      // TEL-002: solo los tiempos y el largo (números), nunca el texto.
      logEvent(TEL_EVENTS.REPLY_TIME, { characterId: character.id, ttftMs: Math.round(replyMeta.ttftMs), totalMs: Math.round(replyMeta.totalMs), chars: replyMeta.chars });
    }
    if (reply.text) logMessageEvent('char');
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
    // HUM-001: si la respuesta llegó antes de la pausa natural, se espera lo que falte (los puntos siguen visibles).
    const holdLeft = streamHoldUntil - performance.now();
    if (reply.text && !wasAborted && holdLeft > 0) await sleep(holdLeft);
    streamHoldUntil = 0;
    clearTimeout(streamHoldTimer);
    streamHoldTimer = 0;
    streamPaint.cancel(); // el texto final se pinta al reconstruir la fila (abajo): no hace falta la cola
    const idx = messages.indexOf(reply);
    const meta = replyMeta ? sanitizeMeta(replyMeta) : undefined;
    if (previous) {
      // UI-017: con texto (aunque sea parcial, como siempre) pasa a ser una versión más; sin texto se conserva la anterior.
      if (idx >= 0) {
        messages[idx] = reply.text ? addVariant(previous, { text: reply.text, loreUsed: reply.loreUsed, ts: reply.ts }) : previous;
        // UI-001: la versión nueva lleva SUS tiempos (addVariant conserva los del mensaje anterior); si no hay dato, ninguno.
        if (reply.text) {
          const { meta: _old, ...noMeta } = messages[idx];
          messages[idx] = meta ? { ...noMeta, meta } : noMeta;
        }
      }
    } else if (!reply.text && idx >= 0) {
      messages.splice(idx, 1);
    } else if (meta) {
      reply.meta = meta;
    }
    // HUM-001: a veces una respuesta larga llega partida en dos mensajes (solo respuestas nuevas, no versiones regeneradas ni cortadas).
    // Cada mitad sigue siendo un solo párrafo. El chat sigue "ocupado" hasta mostrar la segunda.
    let tail = null;
    if (!previous && !wasAborted && humanTouch && reply.text && idx >= 0 && idx === messages.length - 1) {
      const parts = planSplit(reply.text);
      if (parts) {
        reply.text = parts[0];
        tail = parts[1];
      }
    }
    if (!tail) busy = false;
    abortCtl = null;
    syncSendButton();
    finishStreamRow(idx);
    await persistChat();
    if (reply.text && !wasAborted) {
      haptics.receive();
    }
    // HUM-001: el ánimo solo se escribe en el personaje cuando cambió (el registro lleva imágenes).
    if (moodResult && moodResult.changed && character && reply.text) {
      saveCharacterMood(character.id, { id: moodResult.id, updated: moodResult.updated })
        .then((updated) => { if (updated && character && character.id === updated.id) { character = updated; syncHeadSub(); } })
        .catch(() => {});
    }
    // HUM-004: lo que se preguntó (o el usuario ya cubrió) no se repite: se marca bajo el candado del personaje, solo si la respuesta quedó guardada.
    if (followUpUsed && character && reply.text) markFollowUp(followUpUsed);
    // HUM-005: una vez por día: si sacó su día en esta respuesta (ya guardada), se anota para no repetirlo hoy.
    if (lifeUsed && character && reply.text) {
      saveCharacterLife(character.id, (l) => withLifeMentioned(l, lifeUsed.date))
        .then((updated) => { if (updated && character && character.id === updated.id) character = updated; })
        .catch(() => {});
    }
    // HUM-003: si el mensaje del usuario fue un pico emocional, se guarda un recuerdo del MOMENTO (sin modelo; solo escribe el personaje si hay algo que guardar).
    if (character && chat && reply.text && !previous) maybeSaveMoment(history);
    // MEM-015: después de mostrar y guardar la respuesta, en segundo plano (apagado por defecto; ver
    // Settings.feelingsEnabled). Nunca sobre un mensaje vacío que se acaba de quitar de `messages`.
    if (idx >= 0 && messages[idx] && messages[idx].role === 'char' && messages[idx].text) maybeUpdateFeeling(idx);
    if (tail) await showContinuation(tail);
  }
}

// HUM-004: pendientes («mañana tengo la entrevista») y cumpleaños dichos por el usuario, detectados sin modelo al enviar. Escribe el personaje SOLO si detectó
// algo y con el registro recién leído (el registro lleva imágenes). Con `Settings.followUps` apagado no hace nada. Mejor esfuerzo.
function captureFollowUps(text) {
  if (!character || !settings || settings.followUps !== true) return;
  const now = new Date();
  const found = detectFollowUps(text, now);
  const dates = detectUserDates(text);
  if (!found.length && !dates.length) return;
  saveCharacterFollowUps(character.id, (fu) => withUserDates(withFollowUps(fu, found, now.getTime()), dates, now.getTime()))
    .then((updated) => {
      if (updated && character && character.id === updated.id) character = updated;
    })
    .catch(() => {});
}

function markFollowUp(info) {
  saveCharacterFollowUps(character.id, (fu) => (info.topicCovered ? markDone(fu, info.id) : markAsked(fu, info.id, info.askedFor)))
    .then((updated) => {
      if (updated && character && character.id === updated.id) character = updated;
    })
    .catch(() => {});
}

// HUM-003: detector sin modelo (api/moments.js). Calcula el candidato con el personaje que hay en pantalla y lo vuelve a verificar y escribe bajo el candado del
// personaje con el registro RECIÉN leído (nunca pisa un guardado de memoria paralelo). Mejor esfuerzo: un fallo no se nota.
function maybeSaveMoment(history) {
  const characterId = character.id;
  const candidate = momentCandidate({ messages: history, character, settings, now: Date.now() });
  if (!candidate) return;
  saveCharacterMoment(characterId, (fresh) => {
    const again = momentCandidate({ messages: history, character: fresh, settings, now: Date.now() });
    return again ? withMoment(fresh.lorebook, again, Date.now()) : null;
  })
    .then((updated) => {
      if (updated && character && character.id === updated.id) character = updated;
    })
    .catch(() => {});
}

// HUM-001: la segunda mitad de una respuesta partida. Se guarda YA (nada se pierde si el usuario sale del chat) y se muestra tras una pausa
// de "escribiendo…" (la cabecera lo dice mientras tanto). `cont` marca que es continuación de la anterior: al regenerar se vuelven a juntar.
async function showContinuation(text) {
  const mine = messages;
  const myChat = chat;
  const second = { role: 'char', text, ts: Date.now(), cont: true };
  messages.push(second);
  await persistChat();
  await sleep(typingHoldMs(Math.random, character && character.mood && character.mood.id) + Math.min(1200, text.length * 8));
  if (messages !== mine || chat !== myChat) return; // se cambió de chat: show() ya reinició el estado y dibujará ambos mensajes
  const i = messages.indexOf(second);
  if (i >= 0) {
    if (!appendMessageRow(i)) renderMessages();
    scrollToBottom(true);
  }
  busy = false;
  syncSendButton();
}

// UI-001: al terminar la respuesta solo se rehace SU fila (o se quita, si quedó vacía); el resto de la lista no se toca.
function finishStreamRow(idx) {
  const row = streamRow;
  if (streamBubble) streamBubble.classList.remove('chat-bubble--thinking');
  streamRow = null;
  streamBubble = null;
  streamReply = null;
  const matches = row && row.parentNode === els.messages && idx >= 0 && row.dataset.index === String(idx) && idx === messages.length - 1;
  if (matches) {
    clearSelection();
    row.replaceWith(buildMessageRow(messages[idx], idx));
    syncRetryButton();
    scrollToBottom(false);
  } else if (row && row.parentNode === els.messages && idx < 0 && row.dataset.index === String(messages.length)) {
    // Respuesta vacía que se quitó de `messages`: se quita su fila (y reaparece el ícono de reintentar).
    row.remove();
    syncRetryButton();
    if (!rowsMatchMessages()) renderMessages();
  } else {
    renderMessages(); // el DOM no coincide con `messages` (p. ej. se cambió de chat a mitad): reconstrucción total
  }
}

// Repinta la burbuja de la respuesta en curso (la cadencia la marca `streamPaint`). Sin búsquedas en el DOM: usa la referencia.
function paintStreamingBubble() {
  if (!streamBubble || !streamReply) return;
  // HUM-001: pausa natural de "escribiendo…": si el servidor contesta tan rápido que parece instantáneo, el texto espera hasta `streamHoldUntil`
  // (los puntos siguen a la vista). Nunca suma latencia cuando el servidor ya tardó más que eso.
  const wait = streamHoldUntil - performance.now();
  // Con "Ver la respuesta mientras se escribe" apagado el texto no se pinta hasta que termina: se ven los puntos y la fila se rehace completa al final.
  if (streamReply.text && settings && settings.streamReplies === false) {
    if (!streamBubble.querySelector('.chat-dots')) streamBubble.replaceChildren(buildDots());
    return;
  }
  if (streamReply.text && wait > 0) {
    if (!streamBubble.querySelector('.chat-dots')) streamBubble.replaceChildren(buildDots());
    if (!streamHoldTimer) streamHoldTimer = setTimeout(() => { streamHoldTimer = 0; paintStreamingBubble(); }, wait + 5);
    return;
  }
  if (streamReply.text) {
    streamBubble.classList.remove('chat-bubble--thinking');
    setBubbleContent(streamBubble, streamReply);
  } else {
    streamBubble.classList.add('chat-bubble--thinking');
    streamBubble.replaceChildren(buildDots());
  }
  followStreamToBottom();
}

function cancelGeneration() {
  if (abortCtl) abortCtl.abort();
}

// Quita del DOM la última fila de mensaje (la que acaba de salir de `messages`); si el DOM no coincide, reconstruye.
function removeLastRow() {
  clearSelection();
  removeRetryButton();
  const last = els.messages.lastElementChild;
  if (last && last.classList.contains('chat-row') && last.dataset.index === String(messages.length)) last.remove();
  if (!rowsMatchMessages()) renderMessages();
}

function regenerate() {
  if (busy) return;
  const last = messages[messages.length - 1];
  if (last && last.role === 'char') {
    // UI-017: la respuesta anterior sale de la lista solo mientras se genera (el historial que viaja termina en el
    // mensaje del usuario) y vuelve como una de las versiones. Lo guardado en disco no cambia hasta terminar.
    messages.pop();
    removeLastRow(); // la respuesta anterior sale de la vista solo mientras se genera
    let base = last;
    // HUM-001: una respuesta que llegó partida en dos se regenera como UNA: las dos mitades se juntan y esa es la versión anterior.
    const before = messages[messages.length - 1];
    if (last.cont && before && before.role === 'char') {
      messages.pop();
      removeLastRow();
      const { cont: _cont, ...rest } = last;
      base = { ...before, text: `${before.text} ${rest.text}` };
    }
    generate({ previous: base });
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

// TEL-002: conteo de mensajes por personaje y por día (nunca el contenido). `day` en UTC para no depender
// de la zona horaria del teléfono.
function logMessageEvent(role) {
  if (!character) return;
  logEvent(TEL_EVENTS.MESSAGE, { characterId: character.id, role, day: new Date().toISOString().slice(0, 10) });
}

// REFORMA PARETO: si el usuario configuró una instancia secundaria en CPU (Settings.cpuUrl),
// las tareas en segundo plano (memorias, resúmenes, relación) van a la CPU para no tocar la GPU ni su caché.
function bgSettings(s) {
  if (!s) return s;
  const cpu = typeof s.cpuUrl === 'string' ? s.cpuUrl.trim() : '';
  return cpu ? { ...s, url: cpu } : s;
}

const loreUpdater = createLoreUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings: bgSettings(settings) } : null),
  isChatBusy: () => busy || sendInFlight || continuityUpdater.isRunning() || relationshipUpdater.isRunning() || feelingUpdater.isRunning(),
  complete: (prompt, opts) => completeOnce(prompt, bgSettings(settings), opts),
  loadLorebook: async (characterId) => {
    const fresh = await getCharacter(characterId);
    return (fresh && fresh.lorebook) || [];
  },
  // MEM-013: lápidas — lo que se borró (o la limpieza única del ejemplo viejo quitó) no vuelve.
  loadTombstones: async (characterId) => {
    const fresh = await getCharacter(characterId);
    return (fresh && fresh.lorebookTombstones) || [];
  },
  saveLorebook: async (characterId, entries, previous, tombstones, previousTombstones) => {
    const updated = await saveCharacterLorebook(characterId, entries, previous, { tombstones, previousTombstones });
    if (character && character.id === characterId) character = updated;
    maybeUpdateRelationship(); // MEM-014: la cantidad de recuerdos pudo cruzar de nivel
  },
  markProgress: async (chatId, count) => {
    const updated = await markChatLorebookProgress(chatId, count);
    if (chat && chat.id === chatId) chat = updated;
  },
  // MEM-012: aviso en el momento (mismo punto donde ya se detecta un recuerdo nuevo; no duplica nada).
  onStatus: (status) => {
    if (status.kind === 'ok' && character) {
      // TEL-002: solo cuántos recuerdos se crearon/fusionaron.
      if (status.added > 0) logEvent(TEL_EVENTS.MEMORY_CREATED, { characterId: character.id, source: 'auto', count: status.added });
      if (status.updated > 0) logEvent(TEL_EVENTS.MEMORY_MERGED, { characterId: character.id, count: status.updated });
    }
    if (status.kind !== 'ok' || !status.added) return;
    const entries = status.addedEntries || [];
    const name = (character && character.name) || 'Tu personaje';
    notifyNewMemory(name, entries);
  },
});

function maybeUpdateLorebook() {
  loreUpdater.maybeRun().catch(() => {});
}

// MEM-012: "{Nombre} aprendió algo nuevo de ti" (o "varias cosas", si la extracción agregó más de un
// recuerdo a la vez — no se apilan avisos, ya vienen agrupados en el mismo evento). Tocable: con un
// solo recuerdo nuevo, abre justo ESE recuerdo; con varios, abre "Ver lorebook" completo. El aviso
// nunca muestra el contenido del recuerdo, solo que algo se guardó.
function notifyNewMemory(name, entries) {
  const text = entries.length > 1 ? `${name} aprendió varias cosas nuevas de ti.` : `${name} aprendió algo nuevo de ti.`;
  app.toast(text, {
    onClick: () => {
      if (entries.length === 1) openLoreEdit(entries[0].id);
      else openLorebookSheet();
    },
  });
}

/* ---------- resumen de continuidad del chat (MEM-007, docs/HISTORIAL.md) ---------- */

// Misma prioridad que el lorebook: nunca compite con una respuesta (`busy`/`sendInFlight`) ni con una extracción de
// memoria en curso, y se cancela si el usuario envía un mensaje. La lógica vive en api/continuity.js.
const continuityUpdater = createContinuityUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings: bgSettings(settings) } : null),
  isChatBusy: () => busy || sendInFlight || loreUpdater.isRunning() || relationshipUpdater.isRunning() || feelingUpdater.isRunning(),
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, bgSettings(settings), opts) : completeOnce(request.prompt, bgSettings(settings), opts),
  loadChat: (chatId) => getChat(chatId),
  saveContinuity: async (chatId, summary) => {
    const updated = await saveChatContinuity(chatId, summary);
    if (chat && chat.id === chatId) chat = updated;
  },
  // MEM-012: mismo punto donde ya se detecta que el resumen se actualizó.
  onStatus: (status) => {
    if (status.kind !== 'ok') return;
    if (character && chat) {
      // TEL-002: causa del resumen, nunca su texto.
      const cause = status.manual ? 'manual' : status.onOpen ? 'resume' : 'overflow';
      logEvent(TEL_EVENTS.CONTINUITY_UPDATED, { characterId: character.id, chatId: chat.id, cause });
    }
    const name = (character && character.name) || 'Tu personaje';
    app.toast(`${name} repasó lo que ha pasado hasta ahora.`, { onClick: () => openContinuitySheet() });
  },
});

function maybeUpdateContinuity() {
  continuityUpdater.maybeRun().catch(() => {});
}

/* ---------- MEM-014: estado de la relación, escrito por el personaje ---------- */

// Misma prioridad que el lorebook y la continuidad: nunca compite con una respuesta ni con las
// otras dos actualizaciones en curso, y se cancela si el usuario envía un mensaje. La lógica
// (niveles, selección de recuerdos, verificación, respaldo determinista) vive en api/relationship.js;
// `cleanText`/`verifyText` reutilizan `cleanRecap`/`verifyRecap` del resumen de continuidad (MEM-007) —
// se inyectan en vez de importarse para no crear un ciclo (continuity.js ya importa relationship.js).
let relationshipLevelBefore = 'early';
const relationshipUpdater = createRelationshipUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings: bgSettings(settings) } : null),
  isChatBusy: () => busy || sendInFlight || loreUpdater.isRunning() || continuityUpdater.isRunning() || feelingUpdater.isRunning(),
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, bgSettings(settings), opts) : completeOnce(request.prompt, bgSettings(settings), opts),
  cleanText: cleanRecap,
  verifyText: verifyRecap,
  loadCharacter: (characterId) => getCharacter(characterId),
  saveRelationship: async (characterId, patch) => {
    // TEL-002: solo LEE el nivel guardado antes de pisarlo, para registrar de→a en onLevelChanged.
    relationshipLevelBefore = sanitizeRelationship(character && character.relationship).level;
    const updated = await saveCharacterRelationship(characterId, patch);
    if (character && character.id === characterId) character = updated;
  },
  // MEM-012: mismo punto donde ya se detecta el cambio de nivel (MEM-014). Más presencia visual que
  // un aviso normal, como pide el contrato, pero el mismo componente (no un modal).
  onLevelChanged: ({ level } = {}) => {
    // TEL-002: escala vigente de MEM-014 (early/growing/established); si regeneró en el mismo nivel, no es un cambio.
    if (character && level && level !== relationshipLevelBefore) {
      logEvent(TEL_EVENTS.RELATIONSHIP_LEVEL_CHANGED, { characterId: character.id, from: relationshipLevelBefore, to: level });
    }
    const name = (character && character.name) || 'Tu personaje';
    app.toast(`Tu relación con ${name} ha crecido.`, { prominent: true, ms: 5000, onClick: () => openLorebookSheet() });
  },
});

// Se llama después de CUALQUIER cambio al lorebook (extracción, borrar, deshacer, limpiar): la
// función misma decide si de verdad cruzó de nivel; si no, no hace nada (mejor esfuerzo, sin red
// de más). Nunca bloquea la acción que la dispara.
function maybeUpdateRelationship() {
  relationshipUpdater.maybeRun().catch(() => {});
}

/* ---------- MEM-015: el personaje dice cómo se siente, en su voz (lista cerrada) ---------- */

// Misma prioridad que las otras tres actualizaciones en segundo plano: nunca compite con una
// respuesta ni con las demás, y se cancela apenas el usuario escribe (más estricto que las otras:
// ver `onInputChange`). Apagado por defecto (`Settings.feelingsEnabled`; el propio api/feeling.js
// respeta el ajuste, no hace falta chequearlo acá). Un solo intento por mensaje, sin reintentos.
const feelingUpdater = createFeelingUpdater({
  getContext: () => (character && chat && settings ? { character, chat, messages, settings: bgSettings(settings) } : null),
  isChatBusy: () => busy || sendInFlight || loreUpdater.isRunning() || continuityUpdater.isRunning() || relationshipUpdater.isRunning(),
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, bgSettings(settings), opts) : completeOnce(request.prompt, bgSettings(settings), opts),
  loadChatMessages: (chatId) => getChatMessages(chatId),
  saveFeeling: async (chatId, idx, word) => {
    if (!chat || chat.id !== chatId || !messages[idx] || messages[idx].role !== 'char') return;
    messages[idx] = { ...messages[idx], feeling: word };
    await saveChatMessages(chatId, messages);
    refreshMessageRow(idx);
  },
});

function maybeUpdateFeeling(idx) {
  feelingUpdater.maybeRun(idx).catch(() => {});
}

// MEM-010: al ABRIR un chat tras una ausencia larga (ver `isLongAbsence`), si hacía falta actualizar el resumen se hace ya, en segundo plano,
// mientras el usuario todavía lee (y no en mitad de su próxima respuesta). Es el mismo disparo de siempre, evaluado otro momento: solo actúa si el
// usuario activó el resumen (`continuityAuto`) y respeta las mismas prioridades. Se difiere un momento para no competir con el dibujo del chat, y
// se cancela si el usuario sale del chat antes de que arranque (`openToken`) o empieza a escribir/enviar mientras corre (`onInputChange`, `onSendClick`).
let openToken = 0;
function maybeUpdateContinuityOnOpen() {
  const token = ++openToken;
  setTimeout(() => {
    if (token !== openToken || !chat) return;
    continuityUpdater.maybeRun({ onOpen: true }).catch(() => {});
  }, CONTINUITY_ON_OPEN_DELAY_MS);
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

// MEM-014: "Estado de la relación". Con pocos recuerdos ("early"), un texto fijo, sin modelo. Desde
// "growing" lo redacta el propio personaje a partir de sus recuerdos (ver api/relationship.js);
// editable a mano y regenerable a pedido. El conteo de recuerdos y "siempre presentes" se arma
// aparte, en el momento, sin servidor (relationshipSummary).
function buildRelationshipBlock(character, model) {
  const rel = character.relationship || {};
  const editable = model.level !== 'early';
  return buildRelationshipHero(
    model,
    { name: character.card.name, redactedBy: character.card.name, source: rel.source, updatedAt: rel.updated || 0 },
    editable
      ? {
          onEdit: () => openRelationshipEdit(),
          regenerateDisabled: relationshipUpdater.isRunning() || busy || sendInFlight,
          onRegenerate: async () => {
            const result = await relationshipUpdater.runNow();
            openLorebookSheet(
              result.kind === 'ok'
                ? 'Relación regenerada.'
                : result.kind === 'busy'
                  ? 'Hay una respuesta o una actualización en curso; espera a que termine.'
                  : 'No se pudo regenerar ahora mismo.'
            );
          },
        }
      : {}
  );
}

// MEM-014: edición manual del texto de relación (solo "growing"/"established": "early" es fijo).
// Al guardar queda como escrita por el usuario (`source:'manual'`) y una regeneración automática
// (al cruzar de nivel) ya no la pisa — solo "Regenerar" la reemplaza a propósito.
function openRelationshipEdit() {
  if (!character) return;
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Editar estado de la relación'));
  const hint = loreEl('div', 'field__hint', `Cómo ve ${character.card.name} la relación con ${(settings && settings.user) || 'ti'}, en su propia voz.`);
  hint.style.marginBottom = 'var(--space-2, 8px)';
  wrap.appendChild(hint);

  const text = loreEl('textarea', 'inp');
  text.value = relationshipDisplayText(character);
  text.maxLength = RELATIONSHIP_TEXT_MAX_CHARS;
  text.rows = 3;
  text.setAttribute('aria-label', 'Estado de la relación');
  const error = loreEl('div', 'field__label', '');

  const saveBtn = loreEl('button', 'btn', 'Guardar');
  saveBtn.type = 'button';
  saveBtn.style.marginTop = 'var(--space-2, 8px)';
  saveBtn.addEventListener('click', async () => {
    const value = text.value.replace(/\s+/g, ' ').trim();
    if (!value) {
      error.textContent = 'Escribe algo, o usa «Regenerar» en vez de dejarlo vacío.';
      return;
    }
    try {
      character = await saveCharacterRelationship(character.id, { text: value, source: 'manual' });
      openLorebookSheet('Estado de la relación guardado.');
    } catch {
      error.textContent = 'No se pudo guardar el cambio.';
    }
  });
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.marginTop = 'var(--space-2, 8px)';
  cancelBtn.addEventListener('click', () => openLorebookSheet());

  wrap.append(text, error, saveBtn, cancelBtn);
  app.openSheet(wrap);
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

// MEM-017: "Memoria de {Nombre}" — la pantalla única de memoria (antes "Lorebook de …"). Orden: (1) estado de la
// relación, (2) resumen de este episodio, (3) recuerdos como tarjetas (siempre presentes / por tema, por tandas),
// (4) archivados (MEM-016) y (5) herramientas (actualizar, deshacer, limpiar, automático), plegadas al final.
// Todo lo que hacen los botones es lo mismo de antes (mismas funciones, mismos datos); solo cambió dónde y cómo se ven.
// Cada pantalla de la hoja reemplaza a la anterior con `app.openSheet` (sin
// cerrar la hoja, así no se toca el historial: ver shell.js / main.js).
// MEM-019: aplica aceptar/descartar/quitar sobre el registro recién leído y refresca la pantalla. El `character` en memoria se renueva
// para que la PRÓXIMA respuesta ya use (o deje de usar) la identidad; nada más del personaje se toca.
async function changeIdentity(transform, doneNote) {
  try {
    const updated = await saveCharacterIdentity(character.id, (identity) => transform(identity, Date.now()));
    character = updated;
    openLorebookSheet(doneNote);
  } catch {
    openLorebookSheet('No se pudo guardar. No se cambió nada.');
  }
}

function openLorebookSheet(note = '') {
  if (!character) return;
  const model = memoryDashboardModel(character, chat);
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', `Memoria de ${character.name}`));
  if (note) {
    const noteEl = loreEl('div', 'field__label', note);
    noteEl.setAttribute('role', 'status');
    wrap.appendChild(noteEl);
  }

  // (1) relación y (2) resumen
  wrap.appendChild(buildRelationshipBlock(character, model));
  wrap.appendChild(
    buildIdentityCard(model, { name: character.name }, {
      onAccept: () => changeIdentity(acceptProposal, 'Listo: a partir de ahora esto se suma a cómo se presenta ' + character.name + '.'),
      onDiscard: () => changeIdentity(discardProposal, 'Propuesta descartada. Nada cambió.'),
      onRevert: () => changeIdentity(revertIdentity, 'Hecho. Volvió a como estaba antes.'),
    })
  );
  wrap.appendChild(buildContinuityCard(model, { onOpen: () => openContinuitySheet() }));,
        onDismiss: (c) => {
          model.clusters = model.clusters.filter((cl) => cl.id !== c.id);
          openLorebookSheet('Recuerdos conservados por separado.');
        },
      })
    );
  }

  // (3) recuerdos como tarjetas
  const all = character.lorebook || [];
  const preview = loreBudgetPreview(all);
  const list = loreEl('section', 'mem-list');
  list.appendChild(loreEl('h4', 'mem-section__title', `Recuerdos (${all.length})`));
  if (!all.length) {
    list.appendChild(
      loreEl(
        'div',
        'field__hint',
        'Todavía no hay recuerdos. Se crean al usar «Actualizar memoria ahora» (más abajo, con lo que hayas hablado en cualquiera de tus ' +
          'episodios con este personaje), o solos si activas la actualización automática.'
      )
    );
  }
  const cardHooks = { onEdit: (id) => openLoreEdit(id), onRefine: (id) => openLoreEdit(id, { autoRefine: true }), onArchive: (id) => openLoreDeleteConfirm(id) };
  if (all.length) {
    // MEM-004: "Siempre presentes" (van en cada respuesta, con tope) y "Por tema" (solo cuando sale una palabra clave).
    list.appendChild(loreEl('h5', 'mem-group__title', 'Siempre presentes'));
    const counter = loreEl(
      'div',
      'field__hint',
      `${preview.alwaysSelection.requested} / ${LOREBOOK_ALWAYS_CHAR_BUDGET} caracteres · ${character.name} los tiene en mente en cada respuesta, sin palabras clave.`
    );
    counter.setAttribute('data-role', 'always-counter');
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
    if (!model.always.length) {
      list.appendChild(loreEl('div', 'field__hint', 'Ninguno todavía. Toca «Editar» en un recuerdo importante y activa «Siempre presente».'));
    } else {
      list.appendChild(buildMemoryCards(model.always, cardHooks));
    }

    list.appendChild(loreEl('h5', 'mem-group__title', 'Por tema'));
    list.appendChild(
      loreEl('div', 'field__hint', `Entran en la conversación solo cuando aparece una de sus palabras clave (hasta ${preview.topicBudget} caracteres por respuesta).`)
    );
    if (model.topic.length) {
      const modeBar = loreEl('div', 'settings-row');
      modeBar.style.marginBottom = 'var(--space-3, 12px)';
      const btnGrouped = loreEl('button', 'btn btn--ghost btn--sm', 'Agrupados por asunto');
      const btnChrono = loreEl('button', 'btn btn--ghost btn--sm', 'Cronológico');
      const btnOrderToggle = loreEl('button', 'btn btn--ghost btn--sm', '▼ Más recientes');
      btnOrderToggle.type = 'button';
      btnOrderToggle.style.marginLeft = 'auto';
      btnOrderToggle.hidden = true;
      btnGrouped.type = 'button';
      btnChrono.type = 'button';
      modeBar.append(btnGrouped, btnChrono, btnOrderToggle);
      list.appendChild(modeBar);

      // Botón del Curador de Memoria Asistido por IA (Llama 3B)
      const btnAudit = loreEl('button', 'btn btn--ghost btn--sm', '✨ Auditar y limpiar recuerdos antiguos con IA (Llama 3B)');
      btnAudit.type = 'button';
      btnAudit.style.width = '100%';
      btnAudit.style.marginBottom = 'var(--space-3, 12px)';
      btnAudit.addEventListener('click', () => openLoreAuditSheet());
      list.appendChild(btnAudit);

      const cardsContainer = loreEl('div');
      list.appendChild(cardsContainer);

      let isGrouped = true;
      let chronoAsc = false;
      const renderTopicCards = () => {
        btnGrouped.classList.toggle('btn--primary', isGrouped);
        btnChrono.classList.toggle('btn--primary', !isGrouped);
        btnOrderToggle.hidden = isGrouped;
        btnOrderToggle.textContent = chronoAsc ? '▲ Más antiguos' : '▼ Más recientes';
        cardsContainer.innerHTML = '';
        if (isGrouped) {
          cardsContainer.appendChild(buildGroupedMemoryCards(model.topic, cardHooks));
        } else {
          const sorted = model.topic.slice().sort((a, b) => chronoAsc ? ((a.updated || 0) - (b.updated || 0)) : ((b.updated || 0) - (a.updated || 0)));
          cardsContainer.appendChild(buildMemoryCards(sorted, cardHooks));
        }
      };

      btnGrouped.addEventListener('click', () => { isGrouped = true; renderTopicCards(); });
      btnChrono.addEventListener('click', () => { isGrouped = false; renderTopicCards(); });
      btnOrderToggle.addEventListener('click', () => { chronoAsc = !chronoAsc; renderTopicCards(); });
      renderTopicCards();
    } else {
      list.appendChild(loreEl('div', 'field__hint', 'Ninguno todavía.'));
    }
  }
  wrap.appendChild(list);

  // (4) archivados (MEM-016): la vista y sus acciones no cambian, solo su lugar en la pantalla.
  const archiveBtn = loreEl('button', 'btn btn--ghost', `Recuerdos archivados (${model.archivedCount})`);
  archiveBtn.type = 'button';
  archiveBtn.style.marginTop = 'var(--space-3, 12px)';
  archiveBtn.addEventListener('click', () => openLoreArchiveSheet());
  wrap.appendChild(archiveBtn);

  // (5) herramientas, plegadas: no son lo que se mira a diario.
  const inFlight = loreUpdater.isRunning() || busy || sendInFlight;
  const tools = loreEl('details', 'mem-tools');
  if (inFlight) tools.open = true;
  tools.appendChild(loreEl('summary', '', 'Actualizar y ordenar la memoria'));
  tools.appendChild(loreEl('div', 'field__hint', loreStatusText()));
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
          // MEM-013: "Limpiar recuerdos" no toca lápidas; se guarda la misma lista como "antes" y
          // "ahora" para que un "Deshacer" posterior no las altere.
          const tombstones = character.lorebookTombstones || [];
          character = await saveCharacterLorebook(character.id, entries, previous, {
            tombstones,
            previousTombstones: tombstones,
          });
          maybeUpdateRelationship(); // MEM-014: fusionar recuerdos reduce el total; pudo cruzar de nivel
        },
        names: [character.card.name || character.name, settings && settings.user],
      });
      if (result.merged > 0) logEvent(TEL_EVENTS.MEMORY_MERGED, { characterId: character.id, count: result.merged });
      openLorebookSheet(loreCleanMessage(result));
    } catch {
      openLorebookSheet('No se pudo limpiar. No se cambió nada.');
    }
  });

  tools.append(autoRow, autoHint, progress, refreshBtn, costHint, undoBtn, cleanBtn, cleanHint);
  wrap.appendChild(tools);

  app.openSheet(wrap);
}

function openLoreEdit(entryId, opts = {}) {
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

  // FASE 19 (PARETO-012): Botón para pulir/sintetizar el recuerdo individual con Llama 3.2 3B en CPU
  const aiRefineBtn = loreEl('button', 'btn btn--sm btn--ghost', '✨ Pulir con IA (Llama 3.2)');
  aiRefineBtn.type = 'button';
  aiRefineBtn.style.marginTop = 'var(--space-2, 8px)';
  aiRefineBtn.style.marginBottom = 'var(--space-1, 4px)';
  aiRefineBtn.style.display = 'inline-flex';
  aiRefineBtn.style.alignItems = 'center';
  aiRefineBtn.style.gap = 'var(--space-1, 4px)';

  const doRefine = async () => {
    const raw = content.value.trim();
    if (!raw) return;
    const oldLabel = aiRefineBtn.textContent;
    aiRefineBtn.disabled = true;
    aiRefineBtn.textContent = '✨ Pulinedo recuerdo…';
    error.textContent = '';
    try {
      const messages = buildMemoryRefinePrompt({
        charName: character.name,
        userName: (settings && settings.user) || 'User',
        content: raw,
      });
      const bg = bgSettings(settings);
      let reply = '';
      try {
        reply = await completeChatOnce(messages, bg, { maxLen: 140, temp: 0.7 });
      } catch {
        const plain = buildMemoryRefinePlainPrompt({
          charName: character.name,
          userName: (settings && settings.user) || 'User',
          content: raw,
        });
        reply = await completeOnce(plain, bg, { maxLen: 140, temp: 0.7 });
      }
      const refined = parseMemoryRefineResponse(reply, raw);
      if (refined && refined !== raw) {
        content.value = refined;
        haptics.action();
      }
    } catch {
      error.textContent = 'No se pudo conectar con el modelo en CPU para pulir el recuerdo.';
    } finally {
      aiRefineBtn.disabled = false;
      aiRefineBtn.textContent = oldLabel;
    }
  };
  aiRefineBtn.addEventListener('click', doRefine);

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
      logEvent(TEL_EVENTS.MEMORY_EDITED, { characterId: character.id });
      openLorebookSheet('Recuerdo guardado.');
    } catch {
      error.textContent = 'No se pudo guardar el cambio.';
    }
  });
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.marginTop = 'var(--space-2, 8px)';
  cancelBtn.addEventListener('click', () => openLorebookSheet());

  wrap.append(content, aiRefineBtn, keys, hint, alwaysRow, alwaysHint, error, saveBtn, cancelBtn);
  app.openSheet(wrap);
  if (opts && opts.autoRefine) {
    setTimeout(doRefine, 60);
  }
}

// Confirmaciones dentro de la propia hoja (en vez de `app.confirmDialog`, que
// CIERRA la hoja al responder y obligaría a reabrirla: esa secuencia
// cerrar+abrir es justo la carrera con el historial que ya dio un bug real,
// ver docs/NOTES.md, "Bugs reales encontrados usando la app").
// `back(note)`: a dónde vuelve tras cancelar o confirmar (por defecto, la pantalla principal del lorebook;
// MEM-016: la vista de archivados vuelve a sí misma).
function openLoreConfirm(message, confirmText, onConfirm, danger, back = openLorebookSheet) {
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('p', 'sheet__title', message));
  const actions = loreEl('div');
  actions.style.display = 'flex';
  actions.style.gap = 'var(--space-3, 12px)';
  actions.style.marginTop = 'var(--space-4, 16px)';
  const cancelBtn = loreEl('button', 'btn btn--ghost', 'Cancelar');
  cancelBtn.type = 'button';
  cancelBtn.style.flex = '1';
  cancelBtn.addEventListener('click', () => back());
  const okBtn = loreEl('button', danger ? 'btn btn--danger' : 'btn', confirmText);
  okBtn.type = 'button';
  okBtn.style.flex = '1';
  okBtn.addEventListener('click', async () => {
    okBtn.disabled = true;
    try {
      back(await onConfirm());
    } catch {
      back('No se pudo guardar el cambio.');
    }
  });
  actions.append(cancelBtn, okBtn);
  wrap.appendChild(actions);
  app.openSheet(wrap);
}

// MEM-016: "Borrar" ahora ARCHIVA. El recuerdo sale de la lista y deja de usarse (prompt, relación), pero se conserva
// en "Recuerdos archivados", de donde se puede restaurar o borrar de verdad. Sigue dejando la lápida de MEM-013 (así la
// extracción automática no lo vuelve a crear mientras esté archivado) y habilita "Deshacer" para este paso.
function openLoreDeleteConfirm(entryId) {
  const entry = ((character && character.lorebook) || []).find((e) => e.id === entryId);
  if (!entry) {
    openLorebookSheet('Ese recuerdo ya no existe.');
    return;
  }
  const preview = entry.content.length > 120 ? entry.content.slice(0, 120) + '…' : entry.content;
  openLoreConfirm(
    `Archivar este recuerdo. Podrás recuperarlo después. «${preview}»`,
    'Archivar',
    async () => {
      const fresh = await getCharacter(character.id);
      const current = (fresh && fresh.lorebook) || [];
      const moved = archiveLoreEntry(current, (fresh && fresh.lorebookArchive) || [], entryId);
      if (!moved.archived) return 'Ese recuerdo ya no existe.';
      const prevTombstones = (fresh && fresh.lorebookTombstones) || [];
      character = await saveCharacterLorebook(character.id, moved.entries, current, {
        tombstones: addTombstone(prevTombstones, moved.archived),
        previousTombstones: prevTombstones,
        archive: moved.archive,
      });
      logEvent(TEL_EVENTS.MEMORY_ARCHIVED, { characterId: character.id });
      maybeUpdateRelationship(); // MEM-014: archivar reduce el total de recuerdos activos; pudo cruzar de nivel
      return 'Recuerdo archivado. Puedes recuperarlo en «Recuerdos archivados».';
    },
    false
  );
}

// MEM-016: vista de archivados (dentro de la misma pantalla de lorebook, un paso más adentro).

function openLoreAuditSheet() {
  if (!character) return;
  const lore = (character.lorebook || []).slice();
  const isRawAction = (txt) => /\b(made love|slept together|went to bed|fell asleep|undressed|kissed|cama|dormitorio|dormir|durmieron|hicieron el amor)\b/i.test(txt);
  const candidates = lore.filter((e) => {
    const text = e.content || '';
    return text.includes('"') || /told\s+\w+:|asked\s+\w+:|said\s+to\s+\w+:/i.test(text) || isRawAction(text);
  });

  if (!candidates.length) {
    app.toast('¡Tus recuerdos ya están limpios y en formato conceptual!');
    return;
  }

  let index = 0;
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Curador de recuerdos con IA'));
  wrap.appendChild(
    loreEl(
      'div',
      'field__hint',
      `Encontramos ${candidates.length} recuerdo${candidates.length === 1 ? '' : 's'} antiguos con comillas o transcripciones literales. Llama 3B propone una versión conceptual limpia. Tú decides si aceptas cada cambio.`
    )
  );

  const container = loreEl('div');
  container.style.marginTop = 'var(--space-4, 16px)';
  wrap.appendChild(container);

  async function renderCandidate() {
    container.innerHTML = '';
    if (index >= candidates.length) {
      container.appendChild(loreEl('div', 'field__label', '¡Auditoría completada con éxito!'));
      const doneBtn = loreEl('button', 'btn', 'Listo');
      doneBtn.type = 'button';
      doneBtn.addEventListener('click', () => openLorebookSheet('Recuerdos auditados.'));
      container.appendChild(doneBtn);
      return;
    }

    const currentEntry = candidates[index];
    const header = loreEl('div', 'field__label', `Recuerdo #${index + 1} de ${candidates.length}`);
    header.style.color = 'var(--color-accent-2)';
    container.appendChild(header);

    const origCard = loreEl('div', 'mem-card');
    origCard.style.marginBottom = 'var(--space-3, 12px)';
    origCard.appendChild(loreEl('div', 'field__hint', 'Texto original:'));
    origCard.appendChild(loreEl('div', 'mem-card__text', currentEntry.content));
    container.appendChild(origCard);

    const propLabel = loreEl('div', 'field__label', 'Propuesta de la IA (Llama 3B):');
    const propText = loreEl('textarea', 'inp');
    propText.rows = 3;
    propText.value = 'Generando propuesta con IA…';
    propText.disabled = true;
    container.append(propLabel, propText);

    const actionRow = loreEl('div', 'settings-row');
    actionRow.style.marginTop = 'var(--space-3, 12px)';
    const btnAccept = loreEl('button', 'btn btn--sm', 'Aceptar cambio');
    btnAccept.disabled = true;
    const btnSkip = loreEl('button', 'btn btn--sm btn--ghost', 'Conservar original');
    btnSkip.type = 'button';
    const btnCancel = loreEl('button', 'btn btn--sm btn--ghost', 'Salir');
    btnCancel.type = 'button';
    actionRow.append(btnAccept, btnSkip, btnCancel);
    container.appendChild(actionRow);

    btnCancel.addEventListener('click', () => openLorebookSheet());
    btnSkip.addEventListener('click', () => { index++; renderCandidate(); });

    try {
      const uName = (settings && settings.user) || 'the user';
      const prompt = `Rewrite the following memory snippet into ONE short, concise, enduring emotional truth or value shared between ${character.name} and ${uName}. Do NOT describe immediate raw physical actions or dialogue. Focus on their underlying bond, feelings, or meaning. Do NOT use quotes. Output ONLY the rewritten sentence, nothing else.\n\nOriginal: ${currentEntry.content}\n\nRewritten:`;
      const activeSettings = (await getSettings()) || settings;
      const targetSettings = bgSettings(activeSettings);
      const res = await completeOnce(prompt, targetSettings, {
        temp: 0.2,
        maxLen: 90,
      });
      const cleanProposal = res.replace(/["“”]/g, '').trim();
      propText.value = cleanProposal || currentEntry.content;
      propText.disabled = false;
      btnAccept.disabled = false;

      btnAccept.addEventListener('click', async () => {
      haptics.action();
        btnAccept.disabled = true;
        currentEntry.content = propText.value.trim();
        currentEntry.updated = Date.now();
        currentEntry.source = 'manual';
        await saveCharacterLorebook(character.id, character.lorebook);
        index++;
        renderCandidate();
      });
    } catch (err) {
      propText.value = 'No se pudo conectar con la IA. Puedes editarlo a mano si quieres.';
      propText.disabled = false;
      btnAccept.disabled = false;
      btnAccept.addEventListener('click', async () => {
        currentEntry.content = propText.value.trim();
        currentEntry.updated = Date.now();
        currentEntry.source = 'manual';
        await saveCharacterLorebook(character.id, character.lorebook);
        index++;
        renderCandidate();
      });
    }
  }

  renderCandidate();
  app.openSheet(wrap);
}

function openLoreArchiveSheet(note = '') {
  if (!character) return;
  const archive = (character.lorebookArchive || []).slice().sort((a, b) => (b.archivedAt || 0) - (a.archivedAt || 0));
  const wrap = loreEl('div');
  wrap.appendChild(loreEl('h3', 'sheet__title', `Recuerdos archivados de ${character.name}`));
  wrap.appendChild(
    loreEl('div', 'field__hint', 'No se usan en las respuestas ni cuentan para la relación. Restaura los que quieras volver a tener, o bórralos para siempre.')
  );
  if (note) wrap.appendChild(loreEl('div', 'field__label', note));
  if (!archive.length) wrap.appendChild(loreEl('div', 'field__hint', 'No hay recuerdos archivados.'));
  archive.forEach((entry) => {
    const field = loreEl('div', 'field');
    field.appendChild(loreEl('div', 'field__label', entry.content));
    field.appendChild(loreEl('div', 'field__hint', `Archivado ${relationshipAgeText(entry.archivedAt)}`));
    const actions = loreEl('div');
    actions.style.display = 'flex';
    actions.style.gap = 'var(--space-2, 8px)';
    actions.style.marginTop = 'var(--space-2, 8px)';
    const restoreBtn = loreEl('button', 'btn btn--sm', 'Restaurar');
    restoreBtn.type = 'button';
    restoreBtn.addEventListener('click', async () => {
      restoreBtn.disabled = true;
      try {
        const fresh = await getCharacter(character.id);
        const current = (fresh && fresh.lorebook) || [];
        const moved = restoreLoreEntry(current, (fresh && fresh.lorebookArchive) || [], entry.id);
        if (!moved.restored) {
          openLoreArchiveSheet('Ese recuerdo ya no está archivado.');
          return;
        }
        // Sin `previous`: el "Deshacer" de memoria no se pisa por restaurar.
        character = await saveCharacterLorebook(character.id, moved.entries, undefined, {
          tombstones: removeTombstonesFor((fresh && fresh.lorebookTombstones) || [], moved.restored),
          archive: moved.archive,
        });
        logEvent(TEL_EVENTS.MEMORY_RESTORED, { characterId: character.id });
        maybeUpdateRelationship(); // MEM-014: restaurar aumenta el total; pudo cruzar de nivel
        openLoreArchiveSheet('Recuerdo restaurado.');
      } catch {
        openLoreArchiveSheet('No se pudo restaurar.');
      }
    });
    const purgeBtn = loreEl('button', 'btn btn--sm btn--ghost', 'Borrar para siempre');
    purgeBtn.type = 'button';
    purgeBtn.addEventListener('click', () => openLorePurgeConfirm(entry.id));
    actions.append(restoreBtn, purgeBtn);
    field.appendChild(actions);
    wrap.appendChild(field);
  });
  const backBtn = loreEl('button', 'btn btn--ghost', 'Volver al lorebook');
  backBtn.type = 'button';
  backBtn.style.marginTop = 'var(--space-3, 12px)';
  backBtn.addEventListener('click', () => openLorebookSheet());
  wrap.appendChild(backBtn);
  app.openSheet(wrap);
}

// MEM-016: borrado definitivo, solo desde archivados y con aviso fuerte (no se puede deshacer).
function openLorePurgeConfirm(entryId) {
  const entry = ((character && character.lorebookArchive) || []).find((e) => e.id === entryId);
  if (!entry) {
    openLoreArchiveSheet('Ese recuerdo ya no está archivado.');
    return;
  }
  const preview = entry.content.length > 120 ? entry.content.slice(0, 120) + '…' : entry.content;
  openLoreConfirm(
    `¿Borrar PARA SIEMPRE este recuerdo? No se podrá recuperar ni deshacer. «${preview}»`,
    'Borrar para siempre',
    async () => {
      const fresh = await getCharacter(character.id);
      const current = (fresh && fresh.lorebook) || [];
      character = await saveCharacterLorebook(character.id, current, undefined, {
        archive: purgeArchivedEntry((fresh && fresh.lorebookArchive) || [], entryId),
      });
      logEvent(TEL_EVENTS.MEMORY_DELETED, { characterId: character.id });
      return 'Recuerdo borrado para siempre.';
    },
    true,
    openLoreArchiveSheet
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
      // MEM-013: revierte también las lápidas a como estaban antes de esa actualización (así
      // deshacer un borrado quita la lápida correspondiente).
      character = await saveCharacterLorebook(character.id, fresh.lorebookPrevious, null, {
        tombstones: fresh.lorebookTombstonesPrevious || [],
        previousTombstones: null,
      });
      maybeUpdateRelationship(); // MEM-014: deshacer también puede cambiar el total
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
  wrap.appendChild(loreEl('h3', 'sheet__title', 'Resumen de este episodio'));
  const intro = loreEl(
    'div',
    'field__hint',
    'Cuando esta conversación es tan larga que los mensajes más viejos ya no caben en la memoria de la IA, aquí se guarda un ' +
      'resumen breve de lo que pasó, para que el personaje no lo pierda del todo. Solo se crea cuando hace falta y es solo de ESTE episodio.'
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
  text.setAttribute('aria-label', 'Resumen de este episodio');
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
    'Mientras haya un resumen guardado, cada respuesta lo lleva y, en episodios largos, puede tardar unos 2 segundos más (medido con ~500 caracteres). ' +
      'Si prefieres la máxima velocidad, bórralo. Si lo escribes o editas tú, el resumen automático puede juntarlo o quitarle las frases más antiguas cuando ya no quepa.'
  );
  saveHint.style.marginTop = 'var(--space-1, 4px)';

  const deleteBtn = loreEl('button', 'btn btn--ghost', 'Borrar resumen');
  deleteBtn.type = 'button';
  deleteBtn.style.marginTop = 'var(--space-2, 8px)';
  deleteBtn.disabled = !summary.text;
  deleteBtn.addEventListener('click', () => {
    openContinuityConfirm(
      '¿Borrar el resumen de este episodio? Lo que ya no cabe en la conversación no se puede volver a resumir: si se borra, el personaje lo pierde.',
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
  autoRow.append(autoBox, loreEl('span', '', 'Resumir automáticamente cuando el episodio se hace muy largo'));
  const autoHint = loreEl(
    'div',
    'field__hint',
    'Se hace en segundo plano, solo cuando algo está a punto de perderse, y se cancela si envías un mensaje. ' +
      'Está apagado por defecto porque, con un resumen guardado, cada respuesta puede tardar unos 2 segundos más en episodios largos.'
  );
  autoHint.style.marginBottom = 'var(--space-3, 12px)';
  autoBox.addEventListener('change', async () => {
    const enable = autoBox.checked;
    autoBox.disabled = true;
    try {
      settings = await saveSettings({ continuityAuto: enable });
      logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'continuityAuto', enabled: enable });
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

  const backBtn = loreEl('button', 'btn btn--ghost', `Volver a la memoria de ${character.name}`);
  backBtn.type = 'button';
  backBtn.style.marginTop = 'var(--space-4, 16px)';
  backBtn.addEventListener('click', () => openLorebookSheet());

  wrap.append(error, saveBtn, saveHint, deleteBtn, autoRow, autoHint, progress, nowBtn, nowHint, backBtn);
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
      { continuity: chat && chat.continuitySummary ? chat.continuitySummary.text : '', relationship: relationshipForPrompt(character), appearance: appearanceOf(character), identity: identityForPrompt(character) }
    );
    const pct = Math.round(Math.min(ratio, 1) * 100);
    // UI-030: la palabra "tokens" no aparece en el texto principal (lenguaje de "memoria", no de programación);
    // el detalle numérico queda en una segunda línea, igual de discreta, para quien quiera verlo.
    hint.textContent = ratio >= 1
      ? 'Memoria inmediata llena: los mensajes más viejos ya se están recortando.'
      : `Memoria inmediata usada: ~${pct}%`;
    field.appendChild(hint);

    const detail = document.createElement('div');
    detail.className = 'field__hint';
    detail.textContent = `Detalle técnico: ≈${approxTokens} de ${budgetTokens} tokens aprox.`;
    field.appendChild(detail);
  } else {
    field.appendChild(hint);
  }

  return field;
}

// UI-001: "Última respuesta: X s" (tiempo total de la última respuesta del personaje que trae `meta`). Solo informativo.
function buildLastReplyInfo() {
  const field = document.createElement('div');
  field.className = 'field';
  const label = document.createElement('div');
  label.className = 'field__label';
  let text = '';
  for (let i = messages.length - 1; i >= 0 && !text; i--) {
    if (messages[i].role === 'char') text = lastReplyText(messages[i].meta);
  }
  label.textContent = text || 'Última respuesta: sin datos todavía';
  field.appendChild(label);
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
  label.textContent = 'Avanzado';
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
      body.append(note, buildUsageInfo(), buildLastReplyInfo());
    }
    body.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
  });

  wrap.append(toggle, body);
  return wrap;
}

function onMenu() {
  const wrap = document.createElement('div');

  // UI-025: este menú solo trae lo que se usa a diario en ESTE chat/personaje. Los ajustes globales (servidor, formato, PIN,
  // apariencia, copia de seguridad, diagnóstico y rendimiento) viven en Ajustes, desde el engranaje del hub (ui/settings.js).
  // UI-026: se quitó "Volver a los chats de este personaje" — el botón atrás de Android (UI-014) ya hace esa navegación
  // cuando se llegó al chat DESDE esa lista o tocando el retrato en el hub (ver docs/HISTORIAL.md, "UI-026": desde
  // "Continuar" en el hub se entra directo al chat, así que atrás vuelve al hub, no a esta lista — límite conocido).
  const characterItems = [
    // MEM-017: una sola entrada; el resumen de este episodio y los recuerdos archivados viven DENTRO de esta pantalla.
    menuItem(`Memoria de ${character.name}`, () => openLorebookSheet()),
  ];
  if (character && character.card.alternate_greetings && character.card.alternate_greetings.length && isOnlyGreeting()) {
    characterItems.push(menuItem('Cambiar saludo', () => openGreetingSheet()));
  }
  // UI-031: "Cambiar avatar", "Apariencia del personaje" y "Ver personaje" se quitaron de este menú —
  // son datos del PERSONAJE, no del chat, y ya viven en su ficha (tocar el nombre, arriba): "Cambiar
  // foto", "Editar apariencia" y "Editar" (editor completo), respectivamente.
  // UI-032: "Fondo del chat" se quitó por el mismo motivo — también vive en la ficha ahora.
  wrap.appendChild(menuSection('Personaje y memoria', characterItems));

  // FASE 17 (PARETO-010): Acción rápida para corte de escena / nuevo capítulo
  wrap.appendChild(
    menuSection('Continuidad y capítulos', [
      menuItem('Nuevo capítulo / Corte de escena', () => onNewSceneBreak()),
    ])
  );

  // MEM-018: no tiene sentido archivar lo que ya está archivado.
  if (!isChatArchived(chat)) {
    wrap.appendChild(
      menuSection('Este episodio', [
        // Sin `closeSheet()` antes: cerrar y abrir otra hoja enseguida es la carrera con el historial ya conocida (ver `openLoreConfirm`);
        // el diálogo se apila sobre el menú (UI-036) y `onArchiveEpisode` cierra el menú restaurado cuando el usuario confirma.
        menuItem('Archivar este episodio', () => onArchiveEpisode()),
      ])
    );
  }

  wrap.appendChild(
    menuSection('Datos', [
      menuItem('Exportar este episodio', () => {
        app.closeSheet();
        onExportChat();
      }),
      menuItem('Importar episodio', () => {
        app.closeSheet();
        onImportChat();
      }),
    ])
  );

  // Datos de ESTE chat (mensajes, contexto usado, última respuesta): por su naturaleza no pueden vivir en el hub (ver UI-025 en HISTORIAL.md).
  wrap.appendChild(buildDiagnostics());

  app.openSheet(wrap);
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
    if (savedToDevice) app.toast('Episodio guardado en Documentos del teléfono.');
  } catch (err) {
    app.toast('No se pudo exportar el episodio.');
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
  if (isReadOnlyChat()) {
    // MEM-018: importar REEMPLAZA los mensajes; un episodio archivado no se modifica hasta restaurarlo.
    app.toast('Este episodio está archivado: restáuralo antes de importar encima.');
    return;
  }
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
    app.toast('Ese archivo no es un log de episodio válido de Companion.');
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
    `¿Reemplazar el episodio actual con este log importado (${cleaned.length} mensajes)? Se perderá el historial actual.`,
    { confirmText: 'Importar', danger: true }
  );
  if (!ok) return;

  if (busy) cancelGeneration();
  continuityUpdater.abort();
  relationshipUpdater.abort();
  feelingUpdater.abort();
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
  app.toast('Episodio importado.');
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
