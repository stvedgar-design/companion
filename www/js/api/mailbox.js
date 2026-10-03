// www/js/api/mailbox.js
// PROACT-001: "Buzón" automático. Si el usuario estuvo ausente un buen rato, al volver a abrir la app (el hub confirma que el servidor
// responde) el personaje deja UNA nota breve en su buzón. Sin interruptor manual de disponibilidad: se activa sola por tiempo transcurrido.
//
// Regla de oro (decisión explícita del usuario): la nota se escribe SOLO desde quién es el personaje (card + identidad aceptada de MEM-019),
// lo que recuerda de forma general (recuerdos activos, MEM-013/016), el nivel de la relación (MEM-014) y la franja del día (TIME-001). NUNCA
// se le pasa ni se lee ningún mensaje ni resumen de ningún episodio, ni su escenario ni su saludo: el vínculo no debe sentirse como una
// obligación de retomar una conversación puntual. (Test: ningún texto de episodio llega al pedido.)
//
// El tiempo transcurrido se le dice al modelo SIEMPRE redondeado («several hours», «about a day») y con la orden de no reprochar nada.
//
// Cuándo (valores internos, ajustables aquí sin tocar lógica; no se exponen al usuario en esta versión):
//   · MAILBOX_MIN_ABSENCE_MS = 8 h desde la última interacción (mismo criterio que MEM-010 / `CONTINUITY_ABSENCE_MS`: una ausencia «de verdad»
//     —dormir, un día de trabajo—, no abrir y cerrar la app). Con 8 h una persona que charla de noche recibe una nota por la mañana;
//     abrir la app a media tarde tras charlar al mediodía no dispara nada.
//   · como mucho UNA nota por período de ausencia: se anota para qué «última interacción» ya se escribió una (`lastNoteFor`); hasta que el
//     usuario vuelva a interactuar no hay otra, por mucho que abra y cierre la app.
//   · hacen falta MAILBOX_MIN_MEMORIES recuerdos activos (con menos no hay de qué hablar en general y la nota saldría vacía o inventada).
//   · si el modelo contestó pero el texto no pasó la verificación, no se reintenta hasta MAILBOX_RETRY_AFTER_FAILED_MS.
// «Última interacción» = lo más reciente entre la marca `Character.mailbox.lastInteractionAt` (abrir su chat, su lista de episodios o su ficha;
// ver `touchCharacterInteraction` en state.js) y la fecha de actividad de sus chats (enviar o recibir un mensaje). Solo fechas: nunca contenido.
// Servidor apagado: no se anota nada y el próximo chequeo del hub lo reintenta.

import { relationshipSummary, relationshipForPrompt } from './relationship.js';
import { identityForPrompt } from './identity-synthesis.js';
import { timeOfDayNote } from './timeofday.js';
import { fitToChars } from './continuity.js';
import { isMoment } from './moment-tones.js';
import { dateOccasion, occasionText, DATE_NOTES_MAX } from './followups.js';

export const MAILBOX_MIN_ABSENCE_MS = 8 * 60 * 60 * 1000;
export const MAILBOX_MIN_MEMORIES = 5;
export const MAILBOX_NOTES_MAX = 10;
export const MAILBOX_NOTE_MAX_CHARS = 380;
export const MAILBOX_RETRY_AFTER_FAILED_MS = 3 * 60 * 60 * 1000;
/** Marcar «visto/interactuó» no escribe el personaje más de una vez en este lapso (el registro lleva imágenes: escribirlo siempre sería caro). */
export const MAILBOX_TOUCH_THROTTLE_MS = 10 * 60 * 1000;
export const MAILBOX_MEMORY_BUDGET_CHARS = 800;
export const MAILBOX_PREFILL = '*';
export const MAILBOX_TEMP = 0.7;
export const MAILBOX_MAX_TOKENS = 130;
export const MAILBOX_MAX_ATTEMPTS = 2;

const STATUSES = ['new', 'read', 'answered', 'dismissed'];
// HUM-004: por qué se dejó la nota. 'absence' = la de siempre (PROACT-001); 'birthday'/'anniversary' = una fecha (api/followups.js). Ausente = 'absence'.
const REASONS = ['absence', 'birthday', 'anniversary'];

function collapse(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function posNum(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/* ---------- datos ---------- */

export function defaultMailbox() {
  return { lastInteractionAt: 0, lastNoteFor: 0, attemptedAt: 0, notes: [], dateNotes: [] };
}

function sanitizeNote(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = collapse(raw.text).slice(0, MAILBOX_NOTE_MAX_CHARS + 40);
  if (!text) return null;
  return {
    id: typeof raw.id === 'string' && raw.id ? raw.id : 'n' + posNum(raw.createdAt).toString(36),
    text,
    createdAt: posNum(raw.createdAt),
    status: STATUSES.includes(raw.status) ? raw.status : 'new',
    readAt: posNum(raw.readAt),
    reason: REASONS.includes(raw.reason) ? raw.reason : 'absence',
  };
}

/**
 * Valida `Character.mailbox` (guardado o de una copia de seguridad). Sin forma válida = buzón vacío: un personaje anterior a PROACT-001
 * carga sin notas y sin marca de interacción (no genera nada hasta que el usuario interactúe). Pura.
 * @param {unknown} raw
 */
export function sanitizeMailbox(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  return {
    lastInteractionAt: posNum(src.lastInteractionAt),
    lastNoteFor: posNum(src.lastNoteFor),
    attemptedAt: posNum(src.attemptedAt),
    notes: (Array.isArray(src.notes) ? src.notes : []).map(sanitizeNote).filter(Boolean).slice(0, MAILBOX_NOTES_MAX),
    dateNotes: (Array.isArray(src.dateNotes) ? src.dateNotes : []).filter((k) => typeof k === 'string' && /^[a-z]+:\d{4}$/.test(k)).slice(-DATE_NOTES_MAX), // HUM-004: «birthday:2026»
  };
}

/** Notas visibles (no descartadas), la más nueva primero. */
export function visibleNotes(mailbox) {
  return sanitizeMailbox(mailbox).notes.filter((n) => n.status !== 'dismissed').sort((a, b) => b.createdAt - a.createdAt);
}

/** Cuántas notas siguen sin abrir (para el indicador de «nuevo»). */
export function unreadCount(character) {
  return sanitizeMailbox(character && character.mailbox).notes.filter((n) => n.status === 'new').length;
}

/* ---------- transformaciones puras (se aplican sobre el registro recién leído) ---------- */

/** Anota que el usuario interactuó con el personaje (abrir chat/episodios/ficha). */
export function withInteraction(mailbox, now = Date.now()) {
  return { ...sanitizeMailbox(mailbox), lastInteractionAt: now };
}

/** Añade una nota nueva; para no crecer sin fin, descarta primero las ya descartadas/leídas más viejas. */
export function withNote(mailbox, note, now, forInteraction) {
  const cur = sanitizeMailbox(mailbox);
  const created = { id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), text: note, createdAt: now, status: 'new', readAt: 0, reason: 'absence' };
  let notes = [created, ...cur.notes];
  while (notes.length > MAILBOX_NOTES_MAX) {
    const idx = [...notes].reverse().findIndex((n) => n.status !== 'new');
    if (idx === -1) notes.pop();
    else notes.splice(notes.length - 1 - idx, 1);
  }
  return { ...cur, notes, lastNoteFor: forInteraction, attemptedAt: 0 };
}

/**
 * HUM-004: añade una nota por FECHA (cumpleaños o aniversario) y anota su clave (`birthday:2026`) para no repetirla ese año. No toca `lastNoteFor` ni
 * `attemptedAt`: la nota por ausencia sigue su propio ritmo. Misma limpieza del tope de notas que `withNote`.
 */
export function withDateNote(mailbox, note, now, occasion) {
  const cur = sanitizeMailbox(mailbox);
  const created = { id: 'n' + now.toString(36) + Math.random().toString(36).slice(2, 6), text: note, createdAt: now, status: 'new', readAt: 0, reason: occasion.reason };
  let notes = [created, ...cur.notes];
  while (notes.length > MAILBOX_NOTES_MAX) {
    const idx = [...notes].reverse().findIndex((n) => n.status !== 'new');
    if (idx === -1) notes.pop();
    else notes.splice(notes.length - 1 - idx, 1);
  }
  return { ...cur, notes, dateNotes: [...cur.dateNotes.filter((k) => k !== occasion.key), occasion.key].slice(-DATE_NOTES_MAX) };
}

/**
 * HUM-004: ¿toca una nota por FECHA hoy? (cumpleaños dicho por el usuario o aniversario del primer chat, una vez al año; si un intento reciente falló la
 * verificación, se espera como en la nota por ausencia.) Pura.
 * @returns {{ reason: 'birthday'|'anniversary', years: number, key: string }|null}
 */
export function dateNoteDue(character, now = new Date()) {
  const occasion = dateOccasion(character, now);
  if (!occasion) return null;
  const mb = sanitizeMailbox(character && character.mailbox);
  if (mb.attemptedAt && now.getTime() - mb.attemptedAt < MAILBOX_RETRY_AFTER_FAILED_MS) return null;
  return occasion;
}

export function withFailedAttempt(mailbox, now = Date.now()) {
  return { ...sanitizeMailbox(mailbox), attemptedAt: now };
}

/** Al abrir el buzón, lo «nuevo» pasa a «leído» (el indicador se apaga). */
export function markAllRead(mailbox, now = Date.now()) {
  const cur = sanitizeMailbox(mailbox);
  return { ...cur, notes: cur.notes.map((n) => (n.status === 'new' ? { ...n, status: 'read', readAt: now } : n)) };
}

/** Cambia el estado de una nota ('dismissed' = ignorada, sin ninguna consecuencia; 'answered' = se respondió). */
export function setNoteStatus(mailbox, noteId, status, now = Date.now()) {
  const cur = sanitizeMailbox(mailbox);
  if (!STATUSES.includes(status)) return cur;
  return { ...cur, notes: cur.notes.map((n) => (n.id === noteId ? { ...n, status, readAt: n.readAt || now } : n)) };
}

/* ---------- cuándo toca ---------- */

/**
 * Última interacción efectiva: lo más reciente entre la marca del buzón y la actividad de sus chats. Solo fechas.
 * @param {unknown} mailbox
 * @param {{ updated?: number }[]} chats
 */
export function lastInteractionAt(mailbox, chats) {
  const mark = sanitizeMailbox(mailbox).lastInteractionAt;
  const chatMax = (Array.isArray(chats) ? chats : []).reduce((m, c) => (c && Number.isFinite(c.updated) && c.updated > m ? c.updated : m), 0);
  return Math.max(mark, chatMax);
}

/**
 * ¿Toca dejar una nota? Pura.
 * @param {{ lorebook?: unknown[], mailbox?: unknown }|null|undefined} character
 * @param {number} last  `lastInteractionAt(...)`
 * @param {number} [now]
 * @returns {{ due: boolean, reason: string, elapsedMs: number }}
 */
export function mailboxDue(character, last, now = Date.now()) {
  const mb = sanitizeMailbox(character && character.mailbox);
  const elapsedMs = last > 0 ? Math.max(0, now - last) : 0;
  const no = (reason) => ({ due: false, reason, elapsedMs });
  if (!(last > 0)) return no('never-interacted');
  if (elapsedMs < MAILBOX_MIN_ABSENCE_MS) return no('too-soon');
  if (mb.lastNoteFor === last) return no('already-noted'); // una por período de ausencia
  if (mb.attemptedAt && now - mb.attemptedAt < MAILBOX_RETRY_AFTER_FAILED_MS) return no('recent-failure');
  if (relationshipSummary(((character && character.lorebook) || []).filter((e) => !isMoment(e))).total < MAILBOX_MIN_MEMORIES) return no('few-memories');
  return { due: true, reason: 'absence', elapsedMs };
}

/**
 * El tiempo transcurrido SIEMPRE redondeado y en lenguaje llano; nunca horas y minutos exactos.
 * @param {number} ms
 * @returns {string}
 */
export function elapsedPhrase(ms) {
  const h = Math.max(0, ms) / 3600000;
  if (h < 20) return 'several hours have passed';
  if (h < 36) return 'about a day has passed';
  if (h < 72) return 'a couple of days have passed';
  if (h < 24 * 6) return 'several days have passed';
  if (h < 24 * 16) return 'about a week has passed';
  return 'a good while has passed, weeks perhaps';
}

/* ---------- qué ve el modelo y cómo se le pide ---------- */

/**
 * Recuerdos para la nota: «siempre presentes» primero y el resto en orden mezclado (así las notas no giran siempre en torno a lo último).
 * `rnd` inyectable para probar. Pura.
 * @param {import('../state.js').LoreEntry[]} entries
 */
export function pickMailboxMemories(entries, rnd = Math.random, budget = MAILBOX_MEMORY_BUDGET_CHARS) {
  // HUM-003: los recuerdos de MOMENTOS llevan una cita literal de un episodio: la nota nace solo de hechos (regla de oro de PROACT-001).
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.content === 'string' && e.content.trim() && !isMoment(e));
  const always = list.filter((e) => e.always === true);
  const rest = list.filter((e) => e.always !== true);
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [rest[i], rest[j]] = [rest[j], rest[i]];
  }
  const kept = [];
  let used = 0;
  for (const e of [...always, ...rest]) {
    const cost = e.content.length + 3;
    if (used + cost > budget && kept.length) break;
    used += cost;
    kept.push(e);
  }
  return kept;
}

/**
 * Instrucción para el modelo. La entrada es la identidad y los recuerdos; nunca un episodio.
 */
export function mailboxInstruction({ charName, userName, personality, description, identity, relationship, memories, elapsed, timeNote, occasion = '', cap = MAILBOX_NOTE_MAX_CHARS }) {
  const lines = [
    `Original personality: ${personality || '(not specified)'}`,
    description ? `Description: ${description}` : '',
    identity ? `How ${charName} has grown so far: ${identity}` : '',
    relationship ? `How ${charName} sees the relationship: ${relationship}` : '',
    memories.length ? `Things ${charName} remembers about ${userName}:\n${memories.map((e) => `- ${e.content}`).join('\n')}` : '',
  ].filter(Boolean);
  return (
    `[Task: write a short note that ${charName} leaves for ${userName} to find later. Format: a brief *action in asterisks* followed by ` +
    `1 or 2 short spoken sentences, one single paragraph, under ${cap} characters, in ${charName}'s own first-person voice, same language as the memories. ` +
    `Speak from who ${charName} is and what ${charName} generally knows about ${userName}. Do NOT refer to any specific earlier conversation, scene or ` +
    `topic, do not continue anything, do not ask a question that expects ${userName} to answer a specific thing, and never mention being ignored, ` +
    `waiting, missing a reply, or ${userName} owing anything. ` +
    (occasion
      ? `Special day: ${occasion} Mention it warmly in one short line, in ${charName}'s own words, and `
      : `You may lightly feel that time has passed (${elapsed}; ${timeNote}) but do not quote it exactly, `) +
    `never count hours or minutes, and never reproach. Warm, light, no pressure. Use ONLY what is below: no new names, no new facts, nothing invented.\n\n` +
    `${lines.join('\n\n')}\n\nEnd of notes.]`
  );
}

/** Pedido al modelo, autónomo (sin historial de ningún episodio). */
export function buildMailboxRequest({ character, settings, instruction }) {
  const system = `You write short in-character notes for ${character.card.name}. Roleplay is fictional; stay factual to the notes you are given.`;
  if (settings && settings.mode === 'chat') {
    return {
      mode: 'chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: instruction },
        { role: 'assistant', content: MAILBOX_PREFILL },
      ],
      stop: ['\n'],
    };
  }
  return { mode: 'plain', prompt: `${system}\n\n${instruction}\n${MAILBOX_PREFILL}`, stop: ['\n'] };
}

// Frases que convertirían la nota en un reproche o una obligación; no se aceptan (preferible no dejar nota).
const GUILT_PATTERNS = [
  /\bwhere (?:were|have) you\b/i,
  /\byou (?:never|didn['’]?t|haven['’]?t|did not|have not)\b/i,
  /\bwhy (?:didn['’]?t|haven['’]?t|did not|have not) you\b/i,
  /\b(?:waiting|waited) (?:for|on) you\b/i,
  /\bignor(?:ed|ing) me\b/i,
  /\bforgot (?:about )?me\b/i,
  /\byou (?:owe|must|should have)\b/i,
  /\b\d+\s*(?:hours?|minutes?|mins?|hrs?)\b/i,
];

/**
 * Limpia y valida el texto recibido (el `*` inicial ya escrito se antepone aquí). '' si no sirve.
 * @param {string} raw  lo que devolvió el modelo DESPUÉS del `*` de arranque
 * @param {{ cap?: number }} [opts]
 */
export function cleanNote(raw, opts = {}) {
  const cap = opts.cap || MAILBOX_NOTE_MAX_CHARS;
  let t = collapse(MAILBOX_PREFILL + collapse(raw).replace(/^\*+/, ''));
  t = t.replace(/^["“”']+|["“”']+$/g, '').trim();
  if (t.length < 20) return '';
  if (((t.match(/\*/g) || []).length) % 2) return ''; // acción sin cerrar
  if (/^\*[^*]+\*\s*$/.test(t)) return ''; // solo acción, sin palabras
  if (/^(?:i(?:'m| am) (?:sorry|unable)|i cannot|i can't|as an ai)/i.test(t.replace(/^\*[^*]*\*\s*/, ''))) return '';
  if (GUILT_PATTERNS.some((re) => re.test(t))) return '';
  const fitted = fitToChars(t, cap);
  return ((fitted.match(/\*/g) || []).length) % 2 ? '' : fitted;
}

/* ---------- escritor ---------- */

function makeGenKey() {
  return 'BUZ' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * @param {{
 *   loadCharacter: (characterId: string) => Promise<object|null>,
 *   loadSettings: () => Promise<object>,
 *   listChatDates: (characterId: string) => Promise<{ updated?: number }[]>,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   verifyText: (text: string, sourceText: string, knownNames?: string[]) => { ok: boolean },
 *   updateMailbox: (characterId: string, mutator: (mailbox: object) => object) => Promise<object>,
 *   now?: () => number,
 *   random?: () => number,
 * }} deps
 * `listChatDates` devuelve solo fechas (`{updated}`); el escritor nunca pide ni lee mensajes.
 * Resultado de `maybeRun`: `{ kind }` = `ok` | `skipped` | `unverified` | `aborted` | `error`.
 */
export function createMailboxWriter(deps) {
  let running = null;
  const clock = deps.now || Date.now;
  const rnd = deps.random || Math.random;

  // `occasion` (HUM-004): una nota por FECHA. Recibe SOLO el motivo y los nombres (`occasionText`); sin ausencia, sin mínimo de recuerdos.
  async function run(character, settings, last, due, occasion = null) {
    const controller = new AbortController();
    running = { controller };
    try {
      const card = character.card;
      const names = { charName: card.name, userName: (settings && settings.user) || 'User' };
      const now = clock();
      const memories = pickMailboxMemories(character.lorebook || [], rnd);
      const rel = relationshipForPrompt(character);
      const identity = identityForPrompt(character);
      const parts = {
        ...names,
        personality: collapse(card.personality) || collapse(card.description).slice(0, 300),
        description: collapse(card.description).slice(0, 500),
        identity,
        relationship: rel.level === 'early' ? '' : rel.text,
        memories,
        elapsed: occasion ? '' : elapsedPhrase(due.elapsedMs),
        timeNote: timeOfDayNote(new Date(now)) || 'some time of day',
        occasion: occasion ? occasionText(occasion, names.charName, names.userName) : '',
      };
      const request = buildMailboxRequest({ character, settings, instruction: mailboxInstruction(parts) });
      const sourceText = [parts.personality, parts.description, identity, parts.relationship, memories.map((e) => e.content).join(' '), parts.occasion].join(' ');

      let note = '';
      let answered = false;
      for (let attempt = 0; attempt < MAILBOX_MAX_ATTEMPTS && !note; attempt++) {
        let raw;
        try {
          raw = await deps.complete(request, { signal: controller.signal, genkey: makeGenKey(), maxLen: MAILBOX_MAX_TOKENS, temp: MAILBOX_TEMP, stop: ['\n'] });
        } catch {
          if (controller.signal.aborted) return { kind: 'aborted' };
          return { kind: 'error' }; // servidor caído: nada se anota, se reintenta en el próximo chequeo
        }
        if (controller.signal.aborted) return { kind: 'aborted' };
        answered = true;
        const cleaned = cleanNote(raw);
        if (cleaned && deps.verifyText(cleaned.replace(/\*/g, ''), sourceText, [names.charName, names.userName]).ok) note = cleaned;
      }
      if (!note) {
        if (answered) await deps.updateMailbox(character.id, (mb) => withFailedAttempt(mb, now));
        return { kind: 'unverified' };
      }
      let saved = false;
      if (occasion) {
        // Fecha: se vuelve a mirar sobre el registro recién leído (no se repite el mismo año aunque dos chequeos se crucen).
        await deps.updateMailbox(character.id, (mb) => {
          const cur = sanitizeMailbox(mb);
          if (cur.dateNotes.includes(occasion.key)) return cur;
          saved = true;
          return withDateNote(cur, note, now, occasion);
        });
        return saved ? { kind: 'ok', reason: occasion.reason } : { kind: 'skipped' };
      }
      await deps.updateMailbox(character.id, (mb) => {
        const cur = sanitizeMailbox(mb);
        // Si mientras tanto el usuario volvió (interactuó) o ya se escribió una para este período, no se deja nada.
        if (cur.lastNoteFor === last || cur.lastInteractionAt > last) return cur;
        saved = true;
        return withNote(cur, note, now, last);
      });
      return saved ? { kind: 'ok' } : { kind: 'skipped' };
    } catch {
      return { kind: 'error' };
    } finally {
      running = null;
    }
  }

  return {
    /** Revisa si a ese personaje le toca una nota y, si sí, la escribe. Nunca lanza. */
    async maybeRun(characterId) {
      if (running) return { kind: 'skipped' };
      try {
        const character = await deps.loadCharacter(characterId);
        if (!character || !character.card) return { kind: 'skipped' };
        // HUM-004: una fecha especial de hoy va primero (un cumpleaños importa más que una ausencia). Solo con `Settings.followUps === true`.
        const occasion = dateNoteDue(character, new Date(clock()));
        if (occasion) {
          const settings = await deps.loadSettings();
          if (settings && settings.followUps === true) return await run(character, settings, 0, { elapsedMs: 0 }, occasion);
        }
        const last = lastInteractionAt(character.mailbox, await deps.listChatDates(characterId));
        const due = mailboxDue(character, last, clock());
        if (!due.due) return { kind: 'skipped', reason: due.reason };
        const settings = await deps.loadSettings();
        return await run(character, settings, last, due);
      } catch {
        return { kind: 'error' };
      }
    },
    abort() {
      if (running) running.controller.abort();
    },
    isRunning() {
      return !!running;
    },
  };
}
