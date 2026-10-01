// www/js/api/identity-synthesis.js
// MEM-019: "identidad forjada por recuerdos". De vez en cuando se le pide al personaje que resuma, con sus propios
// recuerdos ACTIVOS (MEM-016: los archivados no cuentan) y su personalidad original a la vista, cómo ha cambiado.
// El resultado es una PROPUESTA: no entra al prompt hasta que el usuario la acepta (Memoria de {Nombre}). Aceptada,
// se suma como una línea más de la cabecera (api/prompt.js, `extras.identity`); los campos que el usuario escribió
// en el creador (card) nunca se tocan ni se reemplazan.
//
// Frecuencia (decisión de esta instancia; el contrato dejó el criterio abierto), pensada para que sea rara y deliberada:
//   · nunca con menos de IDENTITY_MIN_MEMORIES recuerdos activos;
//   · la primera propuesta apenas se llega a ese mínimo; las siguientes cuando hay IDENTITY_MEMORIES_STEP recuerdos
//     activos más que cuando se hizo la anterior, o al subir de nivel de relación (MEM-014: early → growing → established);
//   · nunca antes de IDENTITY_MIN_INTERVAL_MS (3 días) desde la propuesta anterior, aceptada o descartada (descartar no
//     debe provocar una propuesta nueva al rato);
//   · nunca con una propuesta sin responder pendiente;
//   · si el modelo contestó pero no se pudo verificar, no se reintenta hasta IDENTITY_RETRY_AFTER_FAILED_MS.
// Servidor apagado: no se anota nada (ni intento ni base), así que el próximo chequeo lo vuelve a intentar solo.
//
// Puro en el sentido de "sin fetch propio": el modelo entra por `deps.complete`, como en api/relationship.js.

import { relationshipSummary } from './relationship.js';

export const IDENTITY_TEXT_MAX_CHARS = 450;
export const IDENTITY_MIN_MEMORIES = 15;
export const IDENTITY_MEMORIES_STEP = 20;
export const IDENTITY_MIN_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;
export const IDENTITY_RETRY_AFTER_FAILED_MS = 12 * 60 * 60 * 1000;
/** Cuántas síntesis aceptadas anteriores se conservan (además de la vigente). */
export const IDENTITY_HISTORY_MAX = 5;
export const IDENTITY_MEMORY_BUDGET_CHARS = 1400;
export const IDENTITY_PREFILL = 'Over time,';
export const IDENTITY_TEMP = 0.4;
export const IDENTITY_MAX_TOKENS = 150;
export const IDENTITY_MAX_ATTEMPTS = 2;
/** Etiqueta de la línea en la cabecera del prompt. */
export const IDENTITY_LABEL = 'has grown so far';

const LEVEL_RANK = { early: 0, growing: 1, established: 2 };

function collapse(text) {
  return typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
}

function cleanLevel(level) {
  return Object.prototype.hasOwnProperty.call(LEVEL_RANK, level) ? level : 'early';
}

function sanitizeVersion(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = collapse(raw.text).slice(0, IDENTITY_TEXT_MAX_CHARS);
  if (!text) return null;
  return {
    text,
    acceptedAt: Number.isFinite(raw.acceptedAt) && raw.acceptedAt > 0 ? raw.acceptedAt : 0,
    replacedAt: Number.isFinite(raw.replacedAt) && raw.replacedAt > 0 ? raw.replacedAt : 0,
  };
}

/** Valor por defecto de todo personaje (también de los guardados antes de MEM-019). */
export function defaultIdentity() {
  return { text: '', acceptedAt: 0, history: [], proposal: null, basis: { count: 0, level: 'early', at: 0 }, attemptedAt: 0 };
}

/**
 * Valida `Character.identity` (guardado o de una copia de seguridad). Cualquier cosa sin forma válida da el valor por
 * defecto: un personaje sin síntesis aceptada se comporta exactamente igual que antes de MEM-019. Pura.
 * @param {unknown} raw
 */
export function sanitizeIdentity(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = defaultIdentity();
  out.text = collapse(src.text).slice(0, IDENTITY_TEXT_MAX_CHARS);
  out.acceptedAt = out.text && Number.isFinite(src.acceptedAt) && src.acceptedAt > 0 ? src.acceptedAt : 0;
  out.history = (Array.isArray(src.history) ? src.history : []).map(sanitizeVersion).filter(Boolean).slice(0, IDENTITY_HISTORY_MAX);
  const p = src.proposal && typeof src.proposal === 'object' ? src.proposal : null;
  const proposalText = p ? collapse(p.text).slice(0, IDENTITY_TEXT_MAX_CHARS) : '';
  if (proposalText) {
    out.proposal = {
      text: proposalText,
      createdAt: Number.isFinite(p.createdAt) && p.createdAt > 0 ? p.createdAt : 0,
      memoryCount: Number.isFinite(p.memoryCount) && p.memoryCount > 0 ? Math.floor(p.memoryCount) : 0,
      level: cleanLevel(p.level),
    };
  }
  const b = src.basis && typeof src.basis === 'object' ? src.basis : {};
  out.basis = {
    count: Number.isFinite(b.count) && b.count > 0 ? Math.floor(b.count) : 0,
    level: cleanLevel(b.level),
    at: Number.isFinite(b.at) && b.at > 0 ? b.at : 0,
  };
  out.attemptedAt = Number.isFinite(src.attemptedAt) && src.attemptedAt > 0 ? src.attemptedAt : 0;
  return out;
}

/**
 * Texto aceptado listo para `extras.identity` del prompt; '' si no hay ninguno (el prompt queda idéntico al de antes).
 * Una propuesta sin aceptar NUNCA se devuelve aquí.
 * @param {{ identity?: unknown }|null|undefined} character
 * @returns {string}
 */
export function identityForPrompt(character) {
  return sanitizeIdentity(character && character.identity).text;
}

/* ---------- transformaciones de estado (puras; el guardado las aplica sobre el registro recién leído) ---------- */

/** Acepta la propuesta pendiente: pasa a ser la vigente y la anterior baja al historial. Sin propuesta, no cambia nada. */
export function acceptProposal(identity, now = Date.now()) {
  const cur = sanitizeIdentity(identity);
  if (!cur.proposal) return cur;
  const history = cur.text ? [{ text: cur.text, acceptedAt: cur.acceptedAt, replacedAt: now }, ...cur.history] : cur.history;
  return { ...cur, text: cur.proposal.text, acceptedAt: now, history: history.slice(0, IDENTITY_HISTORY_MAX), proposal: null };
}

/** Descarta la propuesta pendiente: la identidad vigente (o la original) sigue igual y la base no se toca. */
export function discardProposal(identity) {
  return { ...sanitizeIdentity(identity), proposal: null };
}

/** Quita la síntesis vigente y vuelve a la aceptada antes (o a ninguna: solo los campos originales). */
export function revertIdentity(identity) {
  const cur = sanitizeIdentity(identity);
  if (!cur.text) return cur;
  const [prev, ...rest] = cur.history;
  return prev ? { ...cur, text: prev.text, acceptedAt: prev.acceptedAt, history: rest } : { ...cur, text: '', acceptedAt: 0 };
}

/** Anota una propuesta nueva (y la base para decidir cuándo toca la siguiente). */
export function withProposal(identity, { text, memoryCount, level }, now = Date.now()) {
  const cur = sanitizeIdentity(identity);
  return {
    ...cur,
    proposal: { text, createdAt: now, memoryCount, level: cleanLevel(level) },
    basis: { count: memoryCount, level: cleanLevel(level), at: now },
    attemptedAt: 0,
  };
}

/** Anota un intento fallido por no poder verificar el texto (no por servidor apagado). */
export function withFailedAttempt(identity, now = Date.now()) {
  return { ...sanitizeIdentity(identity), attemptedAt: now };
}

/* ---------- cuándo toca ---------- */

/**
 * ¿Toca proponer una síntesis nueva? Pura. Cuenta solo recuerdos ACTIVOS.
 * @param {{ lorebook?: unknown[], identity?: unknown }|null|undefined} character
 * @param {number} [now]
 * @returns {{ due: boolean, reason: string, total: number, level: 'early'|'growing'|'established' }}
 */
export function identityDue(character, now = Date.now()) {
  const { total, level } = relationshipSummary((character && character.lorebook) || []);
  const id = sanitizeIdentity(character && character.identity);
  const no = (reason) => ({ due: false, reason, total, level });
  if (id.proposal) return no('pending');
  if (total < IDENTITY_MIN_MEMORIES) return no('few-memories');
  if (id.attemptedAt && now - id.attemptedAt < IDENTITY_RETRY_AFTER_FAILED_MS) return no('recent-failure');
  if (!id.basis.at) return { due: true, reason: 'first', total, level };
  if (now - id.basis.at < IDENTITY_MIN_INTERVAL_MS) return no('too-soon');
  if (LEVEL_RANK[level] > LEVEL_RANK[id.basis.level]) return { due: true, reason: 'level', total, level };
  if (total - id.basis.count >= IDENTITY_MEMORIES_STEP) return { due: true, reason: 'memories', total, level };
  return no('not-enough-new');
}

/* ---------- qué ve el modelo y cómo se le pide ---------- */

/**
 * Recuerdos que se le muestran al modelo: "siempre presentes" primero, luego los más recientes, hasta el presupuesto. Pura.
 * @param {import('../state.js').LoreEntry[]} entries
 */
export function selectIdentityMemories(entries, budget = IDENTITY_MEMORY_BUDGET_CHARS) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.content === 'string' && e.content.trim());
  const always = list.filter((e) => e.always === true);
  const rest = list.filter((e) => e.always !== true).sort((a, b) => (b.updated || 0) - (a.updated || 0));
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

/** Instrucción para el modelo. La entrada son los recuerdos, no una conversación. */
export function identityInstruction({ charName, userName, personality, memories, cap = IDENTITY_TEXT_MAX_CHARS }) {
  const list = memories.map((e) => `- ${e.content}`).join('\n');
  return (
    `[Task: below are ${charName}'s original personality and the memories ${charName} has built with ${userName}. ` +
    `Write 2 to 3 short sentences, in third person, describing how ${charName} has grown or changed because of ` +
    `those memories while staying true to the original personality. Under ${cap} characters, same language as the ` +
    `memories. Use ONLY what is in the personality and the memories: no new names, no new facts, nothing invented. ` +
    `No stage directions, no asterisks, no quotes, just the plain sentences.\n\n` +
    `Original personality: ${personality || '(not specified)'}\n\nMemories:\n${list}\n\nEnd of memories.]`
  );
}

/** Pedido al modelo (la misma forma `{mode,…}` que usan los demás actualizadores). */
export function buildIdentityRequest({ character, settings, instruction }) {
  const card = character.card;
  const system = `You write short character notes about ${card.name}. Roleplay is fictional; stay factual to the notes you are given.`;
  if (settings && settings.mode === 'chat') {
    return {
      mode: 'chat',
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: instruction },
        { role: 'assistant', content: IDENTITY_PREFILL },
      ],
      stop: ['\n'],
    };
  }
  return { mode: 'plain', prompt: `${system}\n\n${instruction}\n${IDENTITY_PREFILL}`, stop: ['\n'] };
}

/** Une el inicio escrito de antemano con lo que siguió y deja una sola frase limpia con mayúscula inicial. */
function assemble(raw) {
  const rest = collapse(raw).replace(/^["“”']+|["“”']+$/g, '');
  if (!rest) return '';
  return `${IDENTITY_PREFILL} ${rest}`;
}

/* ---------- sintetizador ---------- */

function makeGenKey() {
  return 'IDN' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * @param {{
 *   loadCharacter: (characterId: string) => Promise<object|null>,
 *   loadSettings: () => Promise<object>,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   cleanText: (raw: string, opts: object) => string,
 *   verifyText: (text: string, sourceText: string, knownNames?: string[]) => { ok: boolean },
 *   updateIdentity: (characterId: string, mutator: (identity: object) => object) => Promise<object>,
 *   now?: () => number,
 * }} deps
 * Resultado de `maybeRun`: `{ kind }` con kind = `ok` | `skipped` | `unverified` | `aborted` | `error` (servidor apagado
 * o cualquier fallo de red cae en `error`: no se anota nada y se reintenta en el próximo chequeo).
 */
export function createIdentitySynthesizer(deps) {
  let running = null;
  const clock = deps.now || Date.now;

  async function run(character, settings, due) {
    const controller = new AbortController();
    running = { controller };
    try {
      const card = character.card;
      const names = { charName: card.name, userName: (settings && settings.user) || 'User' };
      const memories = selectIdentityMemories(character.lorebook || []);
      const personality = collapse([card.personality, card.description].filter(Boolean).join(' ')).slice(0, 700);
      const instruction = identityInstruction({ ...names, personality: collapse(card.personality) || collapse(card.description).slice(0, 300), memories });
      const request = buildIdentityRequest({ character, settings, instruction });
      const sourceText = [memories.map((e) => e.content).join(' '), personality, sanitizeIdentity(character.identity).text].join(' ');

      let proposal = '';
      let answered = false;
      for (let attempt = 0; attempt < IDENTITY_MAX_ATTEMPTS && !proposal; attempt++) {
        let raw;
        try {
          raw = await deps.complete(request, { signal: controller.signal, genkey: makeGenKey(), maxLen: IDENTITY_MAX_TOKENS, temp: IDENTITY_TEMP, stop: ['\n'] });
        } catch {
          if (controller.signal.aborted) return { kind: 'aborted' };
          return { kind: 'error' }; // servidor caído o sin respuesta: nada se anota, se reintenta en el próximo chequeo
        }
        if (controller.signal.aborted) return { kind: 'aborted' };
        answered = true;
        const cleaned = deps.cleanText(assemble(raw), { ...names, cap: IDENTITY_TEXT_MAX_CHARS });
        if (cleaned && deps.verifyText(cleaned, sourceText, [names.charName, names.userName]).ok) proposal = cleaned;
      }
      const now = clock();
      if (!proposal) {
        if (answered) await deps.updateIdentity(character.id, (id) => withFailedAttempt(id, now));
        return { kind: 'unverified' };
      }
      // El guardado vuelve a mirar el registro actual: si mientras tanto apareció otra propuesta, no se pisa.
      let saved = false;
      await deps.updateIdentity(character.id, (id) => {
        const cur = sanitizeIdentity(id);
        if (cur.proposal) return cur;
        saved = true;
        return withProposal(cur, { text: proposal, memoryCount: due.total, level: due.level }, now);
      });
      return saved ? { kind: 'ok', reason: due.reason } : { kind: 'skipped' };
    } catch {
      return { kind: 'error' };
    } finally {
      running = null;
    }
  }

  return {
    /** Revisa si a ese personaje le toca una propuesta y, si sí, la genera. Nunca lanza. */
    async maybeRun(characterId) {
      if (running) return { kind: 'skipped' };
      try {
        const character = await deps.loadCharacter(characterId);
        if (!character || !character.card) return { kind: 'skipped' };
        const due = identityDue(character, clock());
        if (!due.due) return { kind: 'skipped', reason: due.reason };
        const settings = await deps.loadSettings();
        return await run(character, settings, due);
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
