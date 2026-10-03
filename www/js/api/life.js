// www/js/api/life.js — HUM-005: "vida propia" mínima. Que el personaje tenga algo que contarte sin que se lo preguntes: UNA frase corta por personaje y por día
// («regó las plantas de la ventana y leyó un rato»), generada EN SEGUNDO PLANO por el modelo cuando el hub confirma que el servidor está encendido (mismo patrón
// y misma prioridad que el buzón y la identidad: baja prioridad, un intento más como mucho, se corta al abrir un chat, nunca más de una vez al día por personaje).
//
// El prompt sale SOLO de quién es el personaje (personalidad, descripción, identidad aceptada), su ánimo y la franja del día: nunca se le pasa el nombre del
// usuario, un recuerdo ni ningún episodio, y se le pide hablar solo del propio personaje (sin otras personas, lugares con nombre ni números). Lo que contesta pasa
// por filtros duros —sin «tú», sin primera persona, sin pronombres, sin números, sin nombres propios que no estén en la ficha (la verificación léxica de
// MEM-007/PROACT-001)— y si algo falla se DESCARTA (preferible no tener nada que inventar algo sobre el usuario o su mundo).
//
// Uso en el chat (sin costo, en `presence.js`): con probabilidad baja y una vez por día, «Earlier today, Luna <texto>. Luna may mention it naturally when it fits.»
// dentro de la nota de presencia (siempre un solo párrafo). Uso en la interfaz: la línea «Su día» de la ficha.

import { identityForPrompt } from './identity-synthesis.js';
import { timeOfDayNote } from './timeofday.js';

/** Días que se conservan. */
export const LIFE_DAYS_MAX = 5;
/** Largo máximo de la frase guardada. */
export const LIFE_TEXT_MAX = 140;
/** Si el modelo contestó pero nada pasó los filtros, no se reintenta hasta pasado este lapso. */
export const LIFE_RETRY_AFTER_FAILED_MS = 3 * 60 * 60 * 1000;
/** Probabilidad de que el personaje saque su día en una respuesta (una vez por día como mucho). */
export const LIFE_MENTION_CHANCE = 0.25;
export const LIFE_MAX_TOKENS = 60;
export const LIFE_TEMP = 0.8;
export const LIFE_MAX_ATTEMPTS = 2;

function collapse(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function posNum(n) {
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Clave del día LOCAL: `2026-10-03`. */
export function dayKey(date) {
  const d = date instanceof Date ? date : new Date(date);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/* ---------- datos ---------- */

export function defaultLife() {
  return { entries: [], attemptedAt: 0, mentionedOn: '' };
}

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = collapse(raw.text).slice(0, LIFE_TEXT_MAX + 1);
  if (!text || typeof raw.date !== 'string' || !DAY_KEY.test(raw.date)) return null;
  return { date: raw.date, text };
}

/**
 * Valida `Character.life` (guardado o de una copia de seguridad). Sin forma válida = sin días y sin intentos: un personaje anterior a HUM-005 carga así. Pura.
 * @param {unknown} raw
 * @returns {{ entries: { date: string, text: string }[], attemptedAt: number, mentionedOn: string }}
 */
export function sanitizeLife(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const byDate = new Map();
  for (const e of Array.isArray(src.entries) ? src.entries : []) {
    const entry = sanitizeEntry(e);
    if (entry) byDate.set(entry.date, entry); // una por día: la última gana
  }
  const entries = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)).slice(-LIFE_DAYS_MAX);
  return {
    entries,
    attemptedAt: posNum(src.attemptedAt),
    mentionedOn: typeof src.mentionedOn === 'string' && DAY_KEY.test(src.mentionedOn) ? src.mentionedOn : '',
  };
}

/** La entrada de HOY (día local de `now`) o null. */
export function lifeToday(life, now = new Date()) {
  const key = dayKey(now);
  return sanitizeLife(life).entries.find((e) => e.date === key) || null;
}

/** Añade (o reemplaza) la entrada de un día, con el tope de días. Pura. */
export function withLifeEntry(life, entry, now = Date.now()) {
  const cur = sanitizeLife(life);
  const e = sanitizeEntry(entry);
  if (!e) return cur;
  return sanitizeLife({ ...cur, entries: [...cur.entries.filter((x) => x.date !== e.date), e], attemptedAt: 0 });
}

export function withFailedLifeAttempt(life, now = Date.now()) {
  return { ...sanitizeLife(life), attemptedAt: now };
}

/** Anota que ese día ya se sacó el tema en el chat (una vez por día). El MISMO objeto si ya estaba anotado. */
export function withLifeMentioned(life, key) {
  const cur = sanitizeLife(life);
  if (cur.mentionedOn === key || !DAY_KEY.test(String(key))) return life && typeof life === 'object' && Array.isArray(life.entries) ? life : cur;
  return { ...cur, mentionedOn: key };
}

/* ---------- cuándo toca ---------- */

/**
 * ¿Toca escribir el día de hoy de este personaje? Una vez al día: sin entrada de hoy, sin un fallo reciente y con algo de quién es (personalidad o descripción). Pura.
 * @param {{ card?: { personality?: string, description?: string }, life?: unknown }|null|undefined} character
 * @param {Date} [now]
 * @returns {{ due: boolean, reason: string }}
 */
export function lifeDue(character, now = new Date()) {
  const no = (reason) => ({ due: false, reason });
  if (!character || !character.card) return no('no-character');
  const life = sanitizeLife(character.life);
  if (life.entries.some((e) => e.date === dayKey(now))) return no('already-today');
  if (life.attemptedAt && now.getTime() - life.attemptedAt < LIFE_RETRY_AFTER_FAILED_MS) return no('recent-failure');
  if (!collapse(character.card.personality) && !collapse(character.card.description)) return no('no-personality');
  return { due: true, reason: 'daily' };
}

/* ---------- qué ve el modelo ---------- */

/**
 * Instrucción para el modelo. Entrada: quién es el personaje, su ánimo y la franja del día. Nunca el usuario, recuerdos ni episodios.
 */
export function lifeInstruction({ charName, personality, description, identity, moodPrompt, timeNote, cap = LIFE_TEXT_MAX }) {
  const lines = [
    `Original personality: ${personality || '(not specified)'}`,
    description ? `Description: ${description}` : '',
    identity ? `How ${charName} has grown so far: ${identity}` : '',
  ].filter(Boolean);
  return (
    `[Task: describe one small thing that ${charName} did today, as the end of this sentence: "Earlier today, ${charName} …". ` +
    `Pick a small, ordinary moment that fits ${charName}'s personality: a hobby, a chore, a walk, something cooked or read, a quiet observation. ` +
    `Past tense, one short clause under ${cap} characters, in the same language as ${charName}'s description. ` +
    `Refer to ${charName} only by name, and speak only about ${charName}'s own day: other people, named places, numbers and plans of anyone else stay out. ` +
    `${charName} feels ${moodPrompt || 'calm and at ease'} today. ${timeNote || 'It is some time of day.'} ` +
    `Use ONLY the notes below for who ${charName} is.\n\n${lines.join('\n\n')}\n\nEnd of notes.]`
  );
}

/** Pedido al modelo, autónomo. El nombre del personaje va ya escrito (prefill): el modelo sigue con la acción, en la misma línea. */
export function buildLifeRequest({ character, settings, instruction }) {
  const N = character.card.name;
  const system = `You write one short everyday detail about the life of ${N}, a fictional character. Stay with what you are given.`;
  if (settings && settings.mode === 'chat') {
    return {
      mode: 'chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: instruction },
        { role: 'assistant', content: N },
      ],
      stop: ['\n'],
    };
  }
  return { mode: 'plain', prompt: `${system}\n\n${instruction}\n${N}`, stop: ['\n'] };
}

const REFUSAL = /^(?:i(?:'m| am) (?:sorry|unable)|i cannot|i can't|as an ai|lo siento|no puedo)/i;
// Tercera persona y nada más: sin «tú», sin primera persona y sin pronombres (inglés y español; con lookarounds para que «él» y «ella» cuenten con tilde).
const PRONOUNS = /(?<![\p{L}])(?:he|she|him|her|hers|his|they|them|their|theirs|himself|herself|themselves|you|your|yours|i|me|my|mine|we|us|our|ours|él|ella|ellos|ellas|yo|mi|mis|me|tú|tu|tus|usted|ustedes|ti|te|contigo|conmigo|nos|nuestro|nuestra)(?![\p{L}])/iu;

/**
 * Limpia y valida lo que devolvió el modelo DESPUÉS del nombre. '' si no sirve. Descarta: vacío o muy corto, texto con tú/primera persona/pronombres, números,
 * el nombre del usuario, asteriscos o negritas, negativas del modelo. Se queda con la primera oración y le pone punto final.
 * @param {string} raw
 * @param {{ charName: string, userName?: string, cap?: number }} opts
 */
export function cleanLifeText(raw, opts) {
  const cap = (opts && opts.cap) || LIFE_TEXT_MAX;
  const N = (opts && opts.charName) || '';
  const U = (opts && opts.userName) || '';
  let t = collapse(raw).replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
  if (N && t.toLowerCase().startsWith(N.toLowerCase() + ' ')) t = t.slice(N.length).trim(); // si repitió el nombre
  t = t.replace(/^[,:;.\-–—\s]+/, '');
  const firstSentence = t.match(/^[^.!?…]*[.!?…]?/);
  t = collapse(firstSentence ? firstSentence[0] : t);
  if (t.length < 12) return '';
  if (REFUSAL.test(t) || /[*_#<>[\]{}]/.test(t) || /\d/.test(t)) return '';
  if (PRONOUNS.test(t)) return ''; // se rechazan: la frase va en tercera persona, con el nombre
  if (U && new RegExp(`(^|[^\\p{L}])${U.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^\\p{L}]|$)`, 'iu').test(t)) return '';
  if (t.length > cap) {
    const cut = t.slice(0, cap);
    const sp = cut.lastIndexOf(' ');
    t = (sp > cap * 0.5 ? cut.slice(0, sp) : cut).replace(/[\s,;:-]+$/, '');
  }
  t = t.replace(/[.!?…]+$/, '');
  if (t.length < 12) return '';
  return t + '.';
}

/** La observación para la nota de presencia (inglés, solo con el nombre, en positivo). */
export function lifeObservation(entry, charName) {
  return `Earlier today, ${charName} ${entry.text} ${charName} may mention it naturally when it fits.`;
}

/** Línea de la ficha: «Luna regó las plantas…» (el texto del modelo, tal cual, tras el nombre). */
export function lifeSheetText(entry, charName) {
  return entry ? `${charName} ${entry.text}` : '';
}

/* ---------- escritor ---------- */

function makeGenKey() {
  return 'VID' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Escritor del día del personaje. Dependencias inyectables (así se prueba sin red ni DOM). Nunca lanza.
 * Resultado de `maybeRun`: `{ kind }` = `ok` | `skipped` | `unverified` | `aborted` | `error`.
 * @param {{
 *   loadCharacter: (characterId: string) => Promise<object|null>,
 *   loadSettings: () => Promise<object>,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   verifyText: (text: string, sourceText: string, knownNames?: string[]) => { ok: boolean },
 *   updateLife: (characterId: string, mutator: (life: object) => object) => Promise<object>,
 *   moodPrompt?: (character: object, now: Date) => string,
 *   now?: () => number,
 * }} deps
 */
export function createLifeWriter(deps) {
  let running = null;
  const clock = deps.now || Date.now;

  async function run(character, settings) {
    const controller = new AbortController();
    running = { controller };
    try {
      const card = character.card;
      const N = card.name;
      const U = (settings && settings.user) || '';
      const nowMs = clock();
      const date = new Date(nowMs);
      const identity = identityForPrompt(character);
      const parts = {
        charName: N,
        personality: collapse(card.personality) || collapse(card.description).slice(0, 300),
        description: collapse(card.description).slice(0, 500),
        identity,
        moodPrompt: deps.moodPrompt ? deps.moodPrompt(character, date) : '',
        timeNote: timeOfDayNote(date) || 'some time of day',
      };
      const request = buildLifeRequest({ character, settings, instruction: lifeInstruction(parts) });
      const sourceText = [parts.personality, parts.description, identity].join(' ');

      let text = '';
      let answered = false;
      for (let attempt = 0; attempt < LIFE_MAX_ATTEMPTS && !text; attempt++) {
        let raw;
        try {
          raw = await deps.complete(request, { signal: controller.signal, genkey: makeGenKey(), maxLen: LIFE_MAX_TOKENS, temp: LIFE_TEMP, stop: ['\n'] });
        } catch {
          if (controller.signal.aborted) return { kind: 'aborted' };
          return { kind: 'error' }; // servidor caído: nada se anota, el próximo chequeo del hub lo reintenta
        }
        if (controller.signal.aborted) return { kind: 'aborted' };
        answered = true;
        const cleaned = cleanLifeText(raw, { charName: N, userName: U });
        // «Earlier today, Luna <texto>»: la verificación mira la oración completa con el nombre delante, para que el inicio no cuente como nombre propio suelto.
        if (cleaned && deps.verifyText(`${N} ${cleaned}`, sourceText, [N, U]).ok) text = cleaned;
      }
      if (!text) {
        if (answered) await deps.updateLife(character.id, (life) => withFailedLifeAttempt(life, nowMs));
        return { kind: 'unverified' };
      }
      let saved = false;
      await deps.updateLife(character.id, (life) => {
        const cur = sanitizeLife(life);
        if (cur.entries.some((e) => e.date === dayKey(date))) return cur; // si mientras tanto ya se escribió el de hoy, no se pisa
        saved = true;
        return withLifeEntry(cur, { date: dayKey(date), text }, nowMs);
      });
      return saved ? { kind: 'ok' } : { kind: 'skipped' };
    } catch {
      return { kind: 'error' };
    } finally {
      running = null;
    }
  }

  return {
    /** Revisa si a ese personaje le toca su día de hoy y, si sí, lo escribe. Nunca lanza. */
    async maybeRun(characterId) {
      if (running) return { kind: 'skipped' };
      try {
        const character = await deps.loadCharacter(characterId);
        if (!character || !character.card) return { kind: 'skipped' };
        const due = lifeDue(character, new Date(clock()));
        if (!due.due) return { kind: 'skipped', reason: due.reason };
        const settings = await deps.loadSettings();
        if (!settings || settings.ownLife !== true) return { kind: 'skipped', reason: 'disabled' };
        return await run(character, settings);
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
