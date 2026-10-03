// www/js/ui/mailbox.js
// PROACT-001: conecta el buzón (api/mailbox.js, puro) con la app.
//  · `maybeWriteMailboxNotes()`: desde el hub, de a un personaje, SOLO cuando el hub confirma que el servidor responde (misma razón y
//    mismo patrón que MEM-018/MEM-019: el servidor atiende de a una petición y cada llamada encarece la siguiente respuesta del chat, así que
//    nunca se dispara dentro de un chat). Sin servidor, no hace nada y el próximo chequeo lo reintenta. Nada se genera en segundo plano
//    real de Android: solo mientras la app está abierta (contrato de la hoja de ruta, punto pendiente aparte).
//  · `openMailbox()`: la hoja «Buzón de {Nombre}». Abrirla marca las notas como leídas; «Responder» crea un episodio NUEVO (nunca reabre uno)
//    cuyo primer mensaje es la propia nota; «Descartar» la oculta sin ninguna consecuencia.
//  · `touchInteraction()`: anota que el usuario estuvo con el personaje (chat, episodios, ficha). Mejor esfuerzo: nunca rompe nada.
// Sin notificaciones push del sistema: la nota se descubre al abrir la app (indicador en la tarjeta del hub y en la ficha).

import {
  getCharacter,
  getSettings,
  listCharacters,
  listChats,
  createChat,
  saveChatMessages,
  saveCharacterMailbox,
  touchCharacterInteraction,
} from '../state.js';
import { completeOnce, completeChatOnce } from '../api/kobold.js';
import { verifyRecap } from '../api/continuity.js';
import { relationshipAgeText } from '../api/relationship.js';
import { formatMessage } from './format.js';
import {
  createMailboxWriter,
  mailboxDue,
  dateNoteDue,
  lastInteractionAt,
  markAllRead,
  setNoteStatus,
  visibleNotes,
  unreadCount,
} from '../api/mailbox.js';

export { unreadCount };

let activeSettings = null;
let stopRequested = false;

const writer = createMailboxWriter({
  loadCharacter: (id) => getCharacter(id),
  loadSettings: async () => {
    activeSettings = await getSettings();
    return activeSettings;
  },
  listChatDates: async (characterId) => (await listChats(characterId)).map((c) => ({ updated: c.updated })), // solo fechas
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, activeSettings, opts) : completeOnce(request.prompt, activeSettings, opts),
  verifyText: verifyRecap,
  updateMailbox: (characterId, mutator) => saveCharacterMailbox(characterId, mutator),
});

/**
 * Revisa a todos los personajes y deja una nota a quien le toque (de a uno). Nunca lanza.
 * @returns {Promise<{ written: string[] }>} ids de los personajes con una nota nueva
 */
export async function maybeWriteMailboxNotes() {
  const written = [];
  stopRequested = false;
  try {
    for (const character of await listCharacters()) {
      if (stopRequested) break;
      const last = lastInteractionAt(character.mailbox, await listChats(character.id));
      if (!mailboxDue(character, last, Date.now()).due && !dateNoteDue(character, new Date())) continue; // HUM-004: o una fecha de hoy
      const result = await writer.maybeRun(character.id);
      if (result.kind === 'ok') written.push(character.id);
      else if (result.kind === 'aborted' || result.kind === 'error') break; // servidor caído o el usuario abrió un chat: no insistir con los demás
    }
  } catch {
    // mejor esfuerzo: nunca rompe el hub
  }
  return { written };
}

/** Corta una nota en curso (el usuario abrió un chat); no se anota nada y se reintenta en el próximo chequeo. */
export function cancelBackgroundMailbox() {
  stopRequested = true;
  writer.abort();
}

/** «El usuario estuvo con este personaje». Nunca lanza ni espera. */
export function touchInteraction(characterId) {
  if (!characterId) return;
  touchCharacterInteraction(characterId).catch(() => {});
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Hoja «Buzón de {Nombre}».
 * @param {{ openSheet: Function, closeSheet: Function, toast: Function, navigate: Function }} app
 * @param {{ id: string, name?: string }} characterRef
 * @param {{ onBack?: () => void, onChanged?: () => void }} [opts]
 *   `onBack`: si viene, aparece «Volver» (la ficha, p. ej.). `onChanged`: se llama cuando cambió el estado de las notas (para refrescar el indicador).
 */
export async function openMailbox(app, characterRef, opts = {}) {
  let character = await getCharacter(characterRef.id);
  if (!character) return;
  // Abrir el buzón = verlas: lo «nuevo» pasa a «leído» (el indicador se apaga).
  const hadUnread = unreadCount(character) > 0;
  if (hadUnread) {
    try {
      character = await saveCharacterMailbox(character.id, (mb) => markAllRead(mb, Date.now()));
      if (opts.onChanged) opts.onChanged();
    } catch {
      // se muestra igual; el indicador se apagará la próxima vez
    }
  }

  const wrap = el('div');
  wrap.appendChild(el('h3', 'sheet__title', `Buzón de ${character.name}`));
  const notes = visibleNotes(character.mailbox);
  if (!notes.length) {
    wrap.appendChild(el('div', 'field__hint', `Por ahora no hay notas. Si pasas unas horas sin hablar con ${character.name}, puede dejarte una aquí.`));
  }
  for (const note of notes) {
    const card = el('article', 'mem-continuity');
    card.dataset.noteId = note.id;
    card.dataset.status = note.status;
    // Mismo formato que en el chat (*acción* en cursiva); formatMessage escapa el texto antes de armar el HTML.
    const body = el('div', 'mem-continuity__text');
    body.innerHTML = formatMessage(note.text, { role: 'char', quoteDialogue: false });
    card.appendChild(body);
    const age = relationshipAgeText(note.createdAt);
    card.appendChild(el('div', 'field__hint', age ? `Dejada ${age}.` : 'Dejada hace un tiempo.'));
    if (note.reason === 'birthday') card.appendChild(el('div', 'field__hint', 'Por tu cumpleaños.'));
    else if (note.reason === 'anniversary') card.appendChild(el('div', 'field__hint', 'Por el aniversario de cuando empezaron a hablar.'));
    const actions = el('div', 'mem-actions');
    const reply = el('button', 'btn btn--sm', 'Responder');
    reply.type = 'button';
    const dismiss = el('button', 'btn btn--sm btn--ghost', 'Descartar');
    dismiss.type = 'button';
    reply.addEventListener('click', async () => {
      reply.disabled = dismiss.disabled = true;
      try {
        // Episodio NUEVO (nunca reabre uno existente) cuyo primer mensaje es la nota.
        const chat = await createChat(character.id, {});
        await saveChatMessages(chat.id, [{ role: 'char', text: note.text, ts: Date.now() }]);
        await saveCharacterMailbox(character.id, (mb) => setNoteStatus(mb, note.id, 'answered', Date.now()));
        if (opts.onChanged) opts.onChanged();
        app.closeSheet();
        app.navigate('chat', { chatId: chat.id });
      } catch {
        reply.disabled = dismiss.disabled = false;
        app.toast('No se pudo crear el episodio.');
      }
    });
    dismiss.addEventListener('click', async () => {
      reply.disabled = dismiss.disabled = true;
      try {
        await saveCharacterMailbox(character.id, (mb) => setNoteStatus(mb, note.id, 'dismissed', Date.now()));
        if (opts.onChanged) opts.onChanged();
        openMailbox(app, character, opts);
      } catch {
        reply.disabled = dismiss.disabled = false;
        app.toast('No se pudo descartar.');
      }
    });
    actions.append(reply, dismiss);
    card.appendChild(actions);
    wrap.appendChild(card);
  }
  wrap.appendChild(
    el(
      'div',
      'field__hint',
      `Estas notas nacen de quién es ${character.name}, de lo que sabe de ti en general o de una fecha especial, no de ninguna conversación en particular. ` +
        'No hay que contestarlas ni pasa nada si las ignoras.'
    )
  );
  if (opts.onBack) {
    const back = el('button', 'btn btn--ghost', 'Volver');
    back.type = 'button';
    back.style.marginTop = 'var(--space-3, 12px)';
    back.addEventListener('click', opts.onBack);
    wrap.appendChild(back);
  }
  app.openSheet(wrap);
}
