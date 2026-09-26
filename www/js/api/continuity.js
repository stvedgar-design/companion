// www/js/api/continuity.js
// MEM-007: resumen de continuidad POR CHAT. Un resumen breve de lo que pasó en un chat y ya no cabe en el
// contexto del modelo, que se actualiza "justo antes" de que esos mensajes se recorten (disparo perezoso, no por
// calendario) y viaja al FINAL del prompt (ver `formatContinuityBlock` en api/prompt.js).
//
// Puro: no toca el DOM ni hace peticiones de red (la llamada al servidor entra por `deps.complete`). Decisiones de
// diseño medidas en docs/HISTORIAL.md, "MEM-007" (Paso 0): cómo se le pide el recuento al modelo, por qué al final
// del prompt y no en la cabecera, y qué tasa de invención tiene.
//
// Lección de MEM-006: al modelo (12B) se le pide EXTRACCIÓN acotada (qué se dijo o hizo en un fragmento chico), nunca
// síntesis abierta; y todo lo que devuelve pasa por `cleanRecap`/`verifyRecap` antes de guardarse.

import { historyStartIndex, continuityBlockChars, buildChatMessages, buildPlainPrompt, CONTINUITY_RESERVE_CHARS } from './prompt.js';
import { loreBudgetPreview } from './lorebook.js';
import { relationshipSummary } from './relationship.js';

/** Tope de caracteres de CADA recuento nuevo (lo que se pide y lo que se conserva de la respuesta). */
export const CONTINUITY_RECAP_CHARS = 400;
/**
 * Tope de caracteres del resumen acumulado del chat. Es el límite bajo del rango del contrato (800-1200) a propósito:
 * medido, cada respuesta con un resumen al final cuesta ~+0,35 s por cada 100 caracteres (docs/HISTORIAL.md, "MEM-007").
 * Debe caber en `CONTINUITY_RESERVE_CHARS` (api/prompt.js, con su etiqueta).
 */
export const CONTINUITY_TOTAL_CHARS = 800;
/**
 * Disparo perezoso: se actualiza cuando el primer mensaje visible sin resumir caería fuera de la ventana si entraran
 * unos ~1200 caracteres más (≈ un turno largo). Con menos margen podría recortarse antes de resumirse.
 */
export const CONTINUITY_LOOKAHEAD_CHARS = 1200;
/** Tamaño máximo del fragmento que resume cada actualización (caracteres de mensajes). */
export const CONTINUITY_CHUNK_MAX_CHARS = 3000;
/** No se resume menos que esto (mensajes): un recuento de 1-2 mensajes cuesta una llamada por casi nada. */
export const CONTINUITY_CHUNK_MIN_MESSAGES = 4;
/** Nunca se resumen los últimos mensajes del chat (son lo más vivo de la conversación). */
export const CONTINUITY_KEEP_RECENT_MESSAGES = 4;
/** Tokens de salida que se piden por llamada (el servidor real corta en 160; ver NOTES.md, "Perfil del servidor"). */
export const CONTINUITY_MAX_TOKENS = 130;
/** Reintentos máximos del mismo fragmento (en esta sesión) cuando la respuesta del modelo no sirve. */
export const CONTINUITY_MAX_ATTEMPTS = 2;
/** El "Actualizar ahora" manual mira más lejos que el disparo automático (multiplicador de la reserva). */
export const CONTINUITY_MANUAL_LOOKAHEAD_FACTOR = 4;

function collapse(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/* ---------- frases y topes ---------- */

/**
 * Parte un texto en frases (conservando su puntuación final).
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  const t = collapse(text);
  if (!t) return [];
  return (t.match(/[^.!?…]+(?:[.!?…]+["')\]]*|$)/g) || [t]).map((s) => s.trim()).filter(Boolean);
}

/**
 * Recorta a FRASES COMPLETAS dentro de `cap` caracteres (nunca deja una frase a medias). Si ni la primera frase cabe,
 * corta en el último espacio. Pura.
 * @param {string} text
 * @param {number} cap
 * @returns {string}
 */
export function fitToChars(text, cap) {
  const t = collapse(text);
  if (t.length <= cap) return t;
  let out = '';
  for (const sentence of splitSentences(t)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > cap) break;
    out = next;
  }
  if (out) return out;
  const cut = t.slice(0, cap);
  const space = cut.lastIndexOf(' ');
  return (space > cap * 0.5 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '');
}

/**
 * Deja las frases MÁS RECIENTES que caben en `cap` (descarta desde la más antigua). Es la vía sin modelo para respetar
 * el tope total: nunca inventa nada. Pura.
 * @param {string} text
 * @param {number} cap
 * @returns {string}
 */
export function keepNewestSentences(text, cap) {
  const t = collapse(text);
  if (t.length <= cap) return t;
  const sentences = splitSentences(t);
  let out = '';
  for (let i = sentences.length - 1; i >= 0; i--) {
    const next = out ? `${sentences[i]} ${out}` : sentences[i];
    if (next.length > cap) break;
    out = next;
  }
  return out || fitToChars(sentences[sentences.length - 1] || t, cap);
}

/**
 * Añade un recuento nuevo al resumen existente (tipo "rollo"). `fits` = si cabe en `cap` sin comprimir.
 * @param {string} existing
 * @param {string} addition
 * @param {number} [cap]
 * @returns {{ text: string, fits: boolean }}
 */
export function appendRecap(existing, addition, cap = CONTINUITY_TOTAL_CHARS) {
  const text = [collapse(existing), collapse(addition)].filter(Boolean).join(' ');
  return { text, fits: text.length <= cap };
}

/* ---------- limpieza y verificación de lo que devuelve el modelo ---------- */

/**
 * Limpia la respuesta del modelo a un pedido de recuento. Devuelve '' si no sirve (vacía, en personaje con
 * asteriscos, un turno de diálogo, demasiado corta, o una negativa).
 * @param {string} raw
 * @param {{ charName?: string, userName?: string, cap?: number, label?: string }} [opts]
 * @returns {string}
 */
export function cleanRecap(raw, opts = {}) {
  const cap = opts.cap || CONTINUITY_RECAP_CHARS;
  let t = collapse(raw);
  t = t.replace(/^(?:recap|summary|condensed)\s*:\s*/i, '');
  t = t.replace(/^["“”']+|["“”']+$/g, '').trim();
  if (t.length < 15) return '';
  if (t.includes('*')) return ''; // en personaje (acciones entre asteriscos): no es un recuento
  for (const name of [opts.charName, opts.userName]) {
    if (name && new RegExp('^' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*:', 'i').test(t)) return '';
  }
  if (/^(?:i(?:'m| am) (?:sorry|unable)|i cannot|i can't|as an ai)/i.test(t)) return '';
  return fitToChars(t, cap);
}

const STOPWORD_TOKENS = new Set(
  'the and but for with from that this then than they them their there here what when where which while who whom whose sam mia also just some very much more most many only into onto over under back again still once twice both each other another because since until about after before during told said asked'.split(' ')
);

function looseStem(w) {
  let s = w.toLowerCase();
  if (s.length > 4 && s.endsWith('ies')) s = s.slice(0, -3) + 'y';
  else if (s.length > 3 && s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  if (s.length > 5 && s.endsWith('ing')) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith('ed')) s = s.slice(0, -2);
  if (s.length > 3 && s.endsWith('e')) s = s.slice(0, -1);
  return s;
}

/**
 * Verificación léxica barata (no puede juzgar el significado, solo pilla lo más grueso): los nombres propios y los
 * números que aparecen en el recuento deben existir en el texto de origen (o ser los nombres del chat). Pura.
 * @param {string} recap
 * @param {string} sourceText  El fragmento que se resumió (o, al condensar, los dos textos de entrada).
 * @param {string[]} [knownNames]
 * @returns {{ ok: boolean, unsupported: string[] }}
 */
export function verifyRecap(recap, sourceText, knownNames = []) {
  const src = collapse(sourceText).toLowerCase();
  const srcStems = new Set((src.match(/[\p{L}\p{N}']+/gu) || []).map(looseStem));
  const known = new Set(knownNames.filter(Boolean).map((n) => String(n).toLowerCase()));
  const unsupported = [];
  const sentences = splitSentences(recap);
  for (const sentence of sentences) {
    const tokens = sentence.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    tokens.forEach((tok, i) => {
      const low = tok.toLowerCase().replace(/['’]s$/, '').replace(/['’-]+$/, ''); // "Marcus's", "Marcus'" y "-" finales no son parte del nombre
      if (known.has(low) || STOPWORD_TOKENS.has(low)) return;
      const isNumber = /^\d/.test(tok);
      const isProper = i > 0 && /^\p{Lu}/u.test(tok);
      if (!isNumber && !isProper) return;
      if (srcStems.has(looseStem(low)) || src.includes(low)) return;
      if (!unsupported.includes(tok)) unsupported.push(tok);
    });
  }
  return { ok: unsupported.length === 0, unsupported };
}

/* ---------- qué fragmento se resume y cuándo ---------- */

/**
 * Cuántos mensajes del principio ya están cubiertos por el resumen: los que tienen `ts` <= `coveredUntil`, contados
 * desde el principio hasta el primero que no. Por `ts` (no por posición): borrar o editar mensajes no lo desalinea.
 * @param {{ ts?: number }[]} messages
 * @param {number} coveredUntil
 * @returns {number}
 */
export function coveredCount(messages, coveredUntil) {
  if (!(coveredUntil > 0)) return 0;
  let i = 0;
  while (i < messages.length && Number.isFinite(messages[i].ts) && messages[i].ts <= coveredUntil) i++;
  return i;
}

/**
 * Decide si toca actualizar el resumen y con qué fragmento. Pura: recibe los dos índices ya calculados con la cuenta
 * real del prompt (`historyStartIndex`).
 *  - `windowStart`: primer mensaje que hoy entra en el prompt (los anteriores ya se recortaron).
 *  - `triggerStart`: primer mensaje que seguiría dentro si entraran ~CONTINUITY_LOOKAHEAD_CHARS más; los anteriores
 *    están "a punto de caer".
 * Se dispara solo si el primer mensaje visible sin resumir está antes de `triggerStart`. Si nunca se recorta nada,
 * nunca se dispara (correcto, no un fallo). Lo que ya se recortó sin resumirse no se puede recuperar: se resume solo
 * lo que todavía es visible (límite conocido, ver docs).
 * @param {{
 *   messages: { role: string, text: string, ts?: number }[],
 *   coveredUntil: number,
 *   windowStart: number,
 *   triggerStart: number,
 * }} input
 * @returns {{ kind: 'none' } | { kind: 'update', from: number, to: number, chunk: object[], coveredUntil: number }}
 */
export function planContinuityUpdate({ messages, coveredUntil, windowStart, triggerStart }) {
  const list = Array.isArray(messages) ? messages : [];
  const from = Math.max(coveredCount(list, coveredUntil), windowStart || 0);
  if (!(from < triggerStart)) return { kind: 'none' };
  const limit = list.length - CONTINUITY_KEEP_RECENT_MESSAGES;
  let to = from;
  let chars = 0;
  while (to < limit) {
    const len = String((list[to] && list[to].text) || '').length;
    if (to - from >= CONTINUITY_CHUNK_MIN_MESSAGES && chars + len > CONTINUITY_CHUNK_MAX_CHARS) break;
    chars += len;
    to++;
  }
  // Mejor terminar en una respuesta del personaje (intercambio completo) que en medio de uno.
  if (to - from > CONTINUITY_CHUNK_MIN_MESSAGES && list[to - 1] && list[to - 1].role === 'user') to--;
  if (to - from < CONTINUITY_CHUNK_MIN_MESSAGES) return { kind: 'none' };
  const chunk = list.slice(from, to);
  const lastTs = chunk[chunk.length - 1].ts;
  if (!Number.isFinite(lastTs)) return { kind: 'none' };
  return { kind: 'update', from, to, chunk, coveredUntil: lastTs };
}

/**
 * Calcula `windowStart` y `triggerStart` con la cuenta real del prompt y llama a `planContinuityUpdate`.
 * @param {{ character: object, chat: object, messages: object[], settings: object }} ctx
 * @param {{ manual?: boolean }} [opts] `manual`: mira `CONTINUITY_MANUAL_LOOKAHEAD_FACTOR` veces más lejos.
 */
export function planForContext(ctx, opts = {}) {
  const { character, chat, messages, settings } = ctx;
  const summary = (chat && chat.continuitySummary) || { text: '', coveredUntil: 0 };
  const preview = loreBudgetPreview((character && character.lorebook) || []);
  const continuity = continuityBlockChars(summary.text);
  const endChars = preview.topicReserve + continuity + (preview.topicReserve && continuity ? 1 : 0);
  const scenario = (chat && chat.scenario) || '';
  const relationship = relationshipSummary((character && character.lorebook) || []).level;
  const windowStart = historyStartIndex(character.card, messages, settings, scenario, preview.alwaysBlock, endChars, 0, relationship);
  const look = CONTINUITY_LOOKAHEAD_CHARS * (opts.manual ? CONTINUITY_MANUAL_LOOKAHEAD_FACTOR : 1);
  const triggerStart = historyStartIndex(character.card, messages, settings, scenario, preview.alwaysBlock, endChars, look, relationship);
  return planContinuityUpdate({ messages, coveredUntil: summary.coveredUntil, windowStart, triggerStart });
}

/* ---------- petición al modelo: continuación del prefijo del chat ---------- */

/** Inicio de respuesta ya escrito ("prefill"): el servidor corta la respuesta en el primer salto de línea, así que si el
 *  modelo empezara con uno llegaría vacía (medido en MEM-001 v2). */
export const CONTINUITY_PREFILL = 'Recap:';
/** Temperatura pedida (el servidor real impone su propio muestreo; ver NOTES.md). */
export const CONTINUITY_TEMP = 0.3;
/** Tras "servidor no disponible" no se reintenta el disparo automático durante este tiempo. */
export const CONTINUITY_RETRY_COOLDOWN_MS = 5 * 60 * 1000;

function transcriptOf(messages, charName, userName) {
  return messages.map((m) => `${m.role === 'user' ? userName : charName}: ${collapse(m.text)}`).join('\n');
}

/**
 * Instrucción (mensaje de usuario añadido AL FINAL del prompt normal del chat) para el recuento de un fragmento.
 * Elegida midiendo 4 redacciones (docs/HISTORIAL.md, "MEM-007"): el fragmento se repite entero dentro de la instrucción
 * (si no, el modelo no respeta el rango pedido y mezcla otros momentos del chat), se le ordena ignorar todo lo demás y se
 * le exige decir QUIÉN hizo o dijo cada cosa (sin eso se cruzaban los papeles: "Sam ofreció consuelo" cuando fue Mia).
 * @param {{ role: string, text: string }[]} chunk
 * @param {{ charName: string, userName: string, cap?: number }} opts
 * @returns {string}
 */
export function recapInstruction(chunk, { charName, userName, cap = CONTINUITY_RECAP_CHARS }) {
  return (
    `[Task: write a factual recap of ONLY the excerpt below, nothing else. Ignore everything else in this conversation; ` +
    `do not mention anything that is not in the excerpt.\n\nExcerpt:\n${transcriptOf(chunk, charName, userName)}\n\nEnd of excerpt. ` +
    `Now write the recap of ONLY that excerpt: short factual sentences, in order, under ${cap} characters in total, ` +
    `same language as the conversation, third person, past tense, with the concrete details (names, places, objects, plans) ` +
    `and who said or did each thing. Only what appears in the excerpt: no feelings, no comments, nothing invented. ` +
    `Say WHO did or said each thing exactly as in the excerpt: if ${charName} asked or offered something, write ${charName}; ` +
    `if ${userName} did, write ${userName}. Never swap who said or did what.]`
  );
}

/**
 * Instrucción para condensar el resumen acumulado + el recuento nuevo en un solo texto más corto.
 * @param {string} oldText
 * @param {string} newText
 * @param {{ charName: string, userName: string, cap?: number }} opts
 * @returns {string}
 */
export function condenseInstruction(oldText, newText, { charName, userName, cap = CONTINUITY_TOTAL_CHARS }) {
  return (
    `[Pause the roleplay and drop its style. Here are two notes about what happened earlier between ${charName} and ${userName}, oldest first:\n\n` +
    `Note 1: ${collapse(oldText)}\nNote 2: ${collapse(newText)}\n\nEnd of notes. ` +
    `Merge them into ONE shorter note, under ${Math.floor(cap * 0.8)} characters, in the same language. Keep the concrete details (names, places, objects, plans) and drop the least important ones. ` +
    `Do not add anything that is not in the notes, do not interpret feelings and do not comment. Third person, past tense.]`
  );
}

/**
 * Arma la petición como CONTINUACIÓN del prompt normal del chat (mismos mensajes, misma cabecera y mismo recorte), más
 * la instrucción y el inicio de respuesta. El resumen NO se incluye aquí (va en el último mensaje del usuario, que en
 * este momento no existe: el historial termina en una respuesta del personaje).
 * @param {{ character: object, chat: object, messages: object[], settings: object }} ctx
 * @param {string} instruction
 * @returns {{ mode: 'chat', messages: { role: string, content: string }[], stop: string[] } | { mode: 'plain', prompt: string, stop: string[] }}
 */
export function buildContinuationRequest(ctx, instruction) {
  const { character, chat, messages, settings } = ctx;
  const card = character.card;
  const scenario = (chat && chat.scenario) || '';
  const always = loreBudgetPreview((character && character.lorebook) || []).alwaysBlock;
  // MEM-008: la cabecera incluye la línea de la relación, igual que en el chat normal (así sigue siendo continuación del prefijo).
  const relationship = relationshipSummary((character && character.lorebook) || []).level;
  const extras = { relationship };
  if (settings && settings.mode === 'chat') {
    const built = buildChatMessages(card, messages, settings, scenario, always, '', '', false, extras);
    return {
      mode: 'chat',
      messages: [...built.messages, { role: 'user', content: instruction }, { role: 'assistant', content: CONTINUITY_PREFILL }],
      stop: ['\n'],
    };
  }
  const built = buildPlainPrompt(card, messages, settings, scenario, always, '', '', false, extras);
  const cue = `\n${card.name}:`;
  const base = built.prompt.endsWith(cue) ? built.prompt.slice(0, -cue.length) : built.prompt;
  return { mode: 'plain', prompt: `${base}\n${instruction}\n${CONTINUITY_PREFILL}`, stop: ['\n'] };
}

/* ---------- actualizador: prioridad al chat, sin competir con él ---------- */

function makeGenKey() {
  return 'CONT' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

const EMPTY_SUMMARY = Object.freeze({ text: '', coveredUntil: 0, updated: 0 });

/**
 * Crea el actualizador del resumen de continuidad. Mismo patrón que `createLoreUpdater`, y por las mismas razones
 * vive aquí (para poder probarlo sin DOM ni red):
 *  - no arranca mientras hay una generación del chat en curso (`isChatBusy()`) ni si ya hay otra actualización;
 *  - `abort()` cancela una en curso (el chat tiene prioridad absoluta) sin guardar nada;
 *  - una respuesta vacía, en personaje o con datos que no están en el fragmento NO se guarda (se reintenta a lo sumo
 *    CONTINUITY_MAX_ATTEMPTS veces el mismo fragmento);
 *  - el commit vuelve a leer el chat: si el usuario editó o borró el resumen mientras tanto, no se pisa;
 *  - mejor esfuerzo: nunca lanza.
 * Resultado de `maybeRun()`/`runNow()`: `{ kind, ... }` con `kind` = `ok` | `none` | `notyet` | `unparsed` |
 * `unverified` | `unavailable` | `aborted` | `error` | `skipped` | `busy`.
 *
 * @param {{
 *   getContext: () => ({ character: object, chat: object, messages: object[], settings: object }|null),
 *   isChatBusy: () => boolean,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   loadChat: (chatId: string) => Promise<object|null>,
 *   saveContinuity: (chatId: string, summary: { text: string, coveredUntil: number, updated: number }) => Promise<object|void>,
 *   onStatus?: (status: object) => void,
 *   now?: () => number,
 * }} deps
 */
export function createContinuityUpdater(deps) {
  const now = deps.now || (() => Date.now());
  let running = null;
  let status = { kind: 'idle', at: 0 };
  let cooldownUntil = 0;
  const attempts = new Map();

  function setStatus(kind, extra = {}) {
    status = { kind, at: now(), ...extra };
    if (deps.onStatus) {
      try {
        deps.onStatus(status);
      } catch {
        // la UI nunca debe romper la actualización
      }
    }
    return { kind, ...extra };
  }

  async function ask(ctx, instruction, controller) {
    return deps.complete(buildContinuationRequest(ctx, instruction), {
      signal: controller.signal,
      genkey: makeGenKey(),
      maxLen: CONTINUITY_MAX_TOKENS,
      temp: CONTINUITY_TEMP,
      stop: ['\n'],
    });
  }

  async function run(ctx, plan, { manual }) {
    const controller = new AbortController();
    running = { controller };
    const { character, chat } = ctx;
    const names = { charName: character.card.name, userName: (ctx.settings && ctx.settings.user) || 'User' };
    const startSummary = (chat && chat.continuitySummary) || EMPTY_SUMMARY;
    const attemptKey = `${chat.id}:${plan.coveredUntil}`;
    try {
      let raw;
      try {
        raw = await ask(ctx, recapInstruction(plan.chunk, names), controller);
      } catch {
        if (controller.signal.aborted) return setStatus('aborted');
        cooldownUntil = now() + CONTINUITY_RETRY_COOLDOWN_MS;
        return setStatus('unavailable');
      }
      if (controller.signal.aborted) return setStatus('aborted');

      const recap = cleanRecap(raw, { ...names, cap: CONTINUITY_RECAP_CHARS });
      const source = transcriptOf(plan.chunk, names.charName, names.userName);
      const check = recap ? verifyRecap(recap, source, [names.charName, names.userName]) : { ok: false, unsupported: [] };
      if (!recap || !check.ok) {
        // El servidor respondió pero el texto no sirve (o cita algo que no está en el fragmento): no se guarda ni se
        // avanza. Se reintenta el mismo fragmento a lo sumo CONTINUITY_MAX_ATTEMPTS veces.
        attempts.set(attemptKey, (attempts.get(attemptKey) || 0) + 1);
        return setStatus(recap ? 'unverified' : 'unparsed', { unsupported: check.unsupported });
      }

      let finalText;
      let condensed = false;
      const merged = appendRecap(startSummary.text, recap, CONTINUITY_TOTAL_CHARS);
      if (merged.fits) {
        finalText = merged.text;
      } else {
        // No cabe: segunda pasada del mismo tipo de pedido acotado, con verificación y, si no sirve, la vía sin modelo
        // (descartar las frases más antiguas), que nunca inventa nada.
        condensed = true;
        let candidate = '';
        try {
          const rawCondensed = await ask(ctx, condenseInstruction(startSummary.text, recap, { ...names, cap: CONTINUITY_TOTAL_CHARS }), controller);
          if (controller.signal.aborted) return setStatus('aborted');
          candidate = cleanRecap(rawCondensed, { ...names, cap: CONTINUITY_TOTAL_CHARS });
          if (candidate && !verifyRecap(candidate, `${startSummary.text} ${recap}`, [names.charName, names.userName]).ok) candidate = '';
        } catch {
          if (controller.signal.aborted) return setStatus('aborted');
        }
        finalText = candidate && candidate.length >= 60 ? candidate : keepNewestSentences(merged.text, CONTINUITY_TOTAL_CHARS);
      }

      // Commit: se relee el chat; si el usuario editó o borró el resumen mientras corría esto, no se pisa.
      const fresh = await deps.loadChat(chat.id);
      if (!fresh) return setStatus('error');
      const current = fresh.continuitySummary || EMPTY_SUMMARY;
      if (current.text !== startSummary.text || current.updated !== startSummary.updated) return setStatus('aborted');
      await deps.saveContinuity(chat.id, { text: finalText, coveredUntil: plan.coveredUntil, updated: now() });
      attempts.delete(attemptKey);
      return setStatus('ok', { added: recap.length, condensed, coveredMessages: plan.to - plan.from, manual: !!manual });
    } catch {
      return setStatus('error');
    } finally {
      running = null;
    }
  }

  return {
    /** Disparo perezoso: solo si hay mensajes visibles sin resumir a punto de caer y el chat está libre. */
    async maybeRun() {
      try {
        if (running || deps.isChatBusy()) return { kind: 'skipped' };
        const ctx = deps.getContext();
        if (!ctx || !ctx.character || !ctx.chat || !ctx.settings) return { kind: 'skipped' };
        if (ctx.settings.continuityAuto !== true) return { kind: 'skipped' };
        if (now() < cooldownUntil) return { kind: 'skipped' };
        const snapshot = { ...ctx, messages: ctx.messages.slice() };
        const plan = planForContext(snapshot);
        if (plan.kind !== 'update') return { kind: 'none' };
        if ((attempts.get(`${ctx.chat.id}:${plan.coveredUntil}`) || 0) >= CONTINUITY_MAX_ATTEMPTS) return { kind: 'skipped' };
        return await run(snapshot, plan, { manual: false });
      } catch {
        return { kind: 'error' };
      }
    },
    /** "Actualizar ahora": mira más lejos que el disparo automático y avisa si todavía no hace falta. */
    async runNow() {
      try {
        if (running || deps.isChatBusy()) return { kind: 'busy' };
        const ctx = deps.getContext();
        if (!ctx || !ctx.character || !ctx.chat || !ctx.settings) return { kind: 'skipped' };
        const snapshot = { ...ctx, messages: ctx.messages.slice() };
        const plan = planForContext(snapshot, { manual: true });
        if (plan.kind !== 'update') return { kind: 'notyet' };
        cooldownUntil = 0;
        return await run(snapshot, plan, { manual: true });
      } catch {
        return { kind: 'error' };
      }
    },
    /** Cancela una actualización en curso (el usuario envió un mensaje). */
    abort() {
      if (running) running.controller.abort();
    },
    isRunning() {
      return !!running;
    },
    /** Último resultado, solo en memoria. */
    getStatus() {
      return status;
    },
  };
}
