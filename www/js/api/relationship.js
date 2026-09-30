// www/js/api/relationship.js
// MEM-014: "Estado de la relación", escrito por el PERSONAJE a partir de sus propios recuerdos.
// Con pocos recuerdos ('early', < RELATIONSHIP_GROWING_MIN) es un texto fijo, sin modelo: el
// usuario pidió explícitamente contrarrestar que el personaje "jure amor eterno" con 2 recuerdos.
// Desde ahí ('growing'/'established') el personaje redacta 1-2 frases en su propia voz, usando
// SOLO sus recuerdos, verificadas (misma técnica léxica que el resumen de continuidad, MEM-007:
// `deps.cleanText`/`deps.verifyText`, inyectadas por quien arma el actualizador — ver
// `createRelationshipUpdater`); si no se puede verificar tras 2 intentos, se usa una frase de
// respaldo determinista fija por nivel. Reemplaza los umbrales y frases fijas de MEM-006/MEM-008.
//
// Puro en el sentido de "sin fetch propio" (ver PRINCIPIOS-DE-INGENIERIA.md, #10: módulos pequeños
// con dependencias inyectadas): la llamada al servidor entra por `deps.complete`, igual que
// api/lorebook.js y api/continuity.js. NO importa continuity.js (evita un ciclo: continuity.js ya
// importa este módulo para leer el nivel), así que su verificación léxica (`verifyRecap`) y su
// limpieza (`cleanRecap`) se pasan por `deps`, no se importan.

import { buildChatMessages, buildPlainPrompt } from './prompt.js';
import { loreBudgetPreview } from './lorebook.js';
import { appearanceOf } from '../character-appearance.js';

/** Hasta este número de recuerdos (incluido): "early" (se están conociendo; sin modelo). */
export const RELATIONSHIP_EARLY_MAX = 29;
/** Desde este número de recuerdos: "growing". */
export const RELATIONSHIP_GROWING_MIN = 30;
/** Desde este número de recuerdos: "established". */
export const RELATIONSHIP_ESTABLISHED_MIN = 80;

/**
 * @param {number} total  cantidad de recuerdos (siempre presentes + por tema)
 * @returns {'early'|'growing'|'established'}
 */
export function relationshipLevel(total) {
  const n = total > 0 ? total : 0;
  if (n >= RELATIONSHIP_ESTABLISHED_MIN) return 'established';
  if (n >= RELATIONSHIP_GROWING_MIN) return 'growing';
  return 'early';
}

/**
 * Resumen local del estado de la relación a partir del lorebook (siempre presentes + por tema). Sin
 * modelo, sin red: solo cuenta y mira fechas. Se usa para decidir el nivel y para mostrar "N
 * recuerdos" en "Ver lorebook"; el TEXTO de la relación vive aparte, en `Character.relationship`.
 * @param {import('../state.js').LoreEntry[]} entries
 * @returns {{
 *   total: number,
 *   always: { id: string, content: string }[],
 *   lastUpdated: number,
 *   level: 'early'|'growing'|'established',
 * }}  `lastUpdated` = la fecha más reciente entre los recuerdos (ms; 0 si no hay ninguna).
 */
export function relationshipSummary(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter(
    (e) => e && typeof e.content === 'string' && e.content.trim()
  );
  const always = list.filter((e) => e.always === true).map((e) => ({ id: String(e.id || ''), content: e.content.trim() }));
  const lastUpdated = list.reduce((max, e) => (Number.isFinite(e.updated) && e.updated > max ? e.updated : max), 0);
  return { total: list.length, always, lastUpdated, level: relationshipLevel(list.length) };
}

/**
 * "hace 2 días", en lenguaje llano ('' si no hay fecha).
 * @param {number} at  ms desde epoch
 * @param {number} [now]
 * @returns {string}
 */
export function relationshipAgeText(at, now = Date.now()) {
  if (!Number.isFinite(at) || at <= 0) return '';
  const mins = Math.floor(Math.max(0, now - at) / 60000);
  if (mins < 1) return 'hace un momento';
  if (mins < 60) return `hace ${mins} minuto${mins === 1 ? '' : 's'}`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `hace ${hours} hora${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `hace ${days} día${days === 1 ? '' : 's'}`;
  const months = Math.floor(days / 30);
  return `hace ${months} mes${months === 1 ? '' : 'es'}`;
}

/* ---------- textos fijos (nivel "early": SIN modelo) y de respaldo ---------- */

/** Tope de caracteres del texto de relación (generado o de respaldo; editable a mano hasta aquí). */
export const RELATIONSHIP_TEXT_MAX_CHARS = 300;

/** Texto fijo en inglés, para la cabecera del prompt, con < RELATIONSHIP_GROWING_MIN recuerdos. */
export const RELATIONSHIP_EARLY_PROMPT_TEXT = 'We are still getting to know each other.';
/** Guía breve de comportamiento (nivel "early"): evita declaraciones de amor prematuras. */
export const RELATIONSHIP_EARLY_GUIDE =
  "The relationship is still new: be warm and natural, but do not make deep declarations of love or lifelong promises.";
/** Texto fijo en español, para "Ver lorebook", con < RELATIONSHIP_GROWING_MIN recuerdos. */
export const RELATIONSHIP_EARLY_DISPLAY_TEXT = 'Nos estamos conociendo.';

/**
 * Frase de respaldo determinista por nivel, si la redacción del modelo no se puede verificar tras
 * RELATIONSHIP_MAX_ATTEMPTS intentos. En inglés (limitación conocida, igual que las frases fijas de
 * MEM-008 que reemplaza: no sabe en qué idioma conversa el usuario sin preguntarle al modelo).
 */
export const RELATIONSHIP_FALLBACK_TEXT = Object.freeze({
  growing: "We've been getting closer and sharing more with each other lately.",
  established: "We've built a long history together by now, one memory at a time.",
});

function collapse(text) {
  return String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
}

/**
 * Valida `Character.relationship` (guardado o de una copia de seguridad). Cualquier cosa que no
 * tenga forma válida da el valor por defecto. Pura.
 * @param {unknown} raw
 * @returns {{ text: string, level: 'early'|'growing'|'established', updated: number, source: 'auto'|'manual' }}
 */
export function sanitizeRelationship(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const text = typeof src.text === 'string' ? collapse(src.text).slice(0, RELATIONSHIP_TEXT_MAX_CHARS) : '';
  const level = ['early', 'growing', 'established'].includes(src.level) ? src.level : 'early';
  const source = src.source === 'manual' ? 'manual' : 'auto';
  const updated = text && Number.isFinite(src.updated) && src.updated > 0 ? src.updated : 0;
  return { text, level, updated, source };
}

/** Valor por defecto de todo personaje (también de los guardados antes de MEM-014). */
export function defaultRelationship() {
  return { text: '', level: 'early', updated: 0, source: 'auto' };
}

// El nivel que se MUESTRA (prompt y "Ver lorebook") es SIEMPRE el que corresponde a la cantidad
// ACTUAL de recuerdos (`relationshipSummary`), no el que quedó guardado la última vez que el
// actualizador corrió (puede estar un paso atrás: la regeneración es en segundo plano). El texto
// guardado (`character.relationship.text`) solo se usa si se redactó PARA ese mismo nivel; si el
// personaje ya cruzó de nivel y todavía no terminó de regenerar, se usa la frase de respaldo de ESE
// nivel mientras tanto (nunca la de un nivel viejo, y nunca el texto fijo de "early" con muchos recuerdos).
function currentRelationshipLevel(character) {
  return relationshipSummary((character && character.lorebook) || []).level;
}

/**
 * `{ level, text }` listo para pasar a `extras.relationship` de los prompts (api/prompt.js,
 * `formatRelationshipBlock`): en "early" no hay texto (la cabecera usa el fijo); en
 * "growing"/"established" usa el texto guardado (si es del nivel actual), o la frase de respaldo
 * si todavía no hay ninguno para ese nivel (p. ej. justo después de cruzar, antes de que termine la
 * primera generación).
 * @param {{ lorebook?: unknown, relationship?: unknown }|null|undefined} character
 * @returns {{ level: 'early'|'growing'|'established', text: string }}
 */
export function relationshipForPrompt(character) {
  const level = currentRelationshipLevel(character);
  if (level === 'early') return { level: 'early', text: '' };
  const stored = sanitizeRelationship(character && character.relationship);
  const text = stored.level === level && stored.text ? stored.text : RELATIONSHIP_FALLBACK_TEXT[level];
  return { level, text };
}

/**
 * Texto para mostrar en "Ver lorebook" (y, más adelante, en la ficha de UI-027).
 * @param {{ lorebook?: unknown, relationship?: unknown }|null|undefined} character
 * @returns {string}
 */
export function relationshipDisplayText(character) {
  const { level, text } = relationshipForPrompt(character);
  return level === 'early' ? RELATIONSHIP_EARLY_DISPLAY_TEXT : text;
}

/* ---------- qué recuerdos ve el personaje para redactar el texto ---------- */

/** Presupuesto de caracteres de recuerdos que se le pasan al modelo para redactar el texto. */
export const RELATIONSHIP_MEMORY_BUDGET_CHARS = 900;

/**
 * Selecciona los recuerdos que el personaje usa para redactar el texto: los "siempre presentes"
 * primero, luego los "por tema" más RECIENTES (proxy simple de "relevantes"; no depende de ninguna
 * palabra clave del turno actual, a diferencia de `selectLoreEntries`), hasta el presupuesto. Pura.
 * @param {import('../state.js').LoreEntry[]} entries
 * @param {{ charBudget?: number }} [opts]
 * @returns {import('../state.js').LoreEntry[]}
 */
export function selectRelationshipMemories(entries, opts = {}) {
  const budget = typeof opts.charBudget === 'number' ? opts.charBudget : RELATIONSHIP_MEMORY_BUDGET_CHARS;
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e.content === 'string' && e.content.trim());
  const always = list.filter((e) => e.always === true);
  const rest = list.filter((e) => e.always !== true).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const kept = [];
  let used = 0;
  for (const entry of [...always, ...rest]) {
    const cost = entry.content.length + 3;
    if (used + cost > budget && kept.length) break;
    used += cost;
    kept.push(entry);
  }
  return kept;
}

/* ---------- petición al modelo: continuación del prefijo del chat (misma técnica que MEM-007) ---------- */

/** Inicio de respuesta ya escrito ("prefill"): evita la respuesta vacía si el modelo empezara con un salto de línea. */
export const RELATIONSHIP_PREFILL = 'Honestly,';
/** Temperatura pedida (el servidor real impone su propio muestreo; ver NOTES.md). */
export const RELATIONSHIP_TEMP = 0.4;
/** Tokens de salida pedidos (suficiente para ~2 frases cortas; el servidor real corta en 160). */
export const RELATIONSHIP_MAX_TOKENS = 110;
/** Reintentos máximos antes de usar la frase de respaldo determinista. */
export const RELATIONSHIP_MAX_ATTEMPTS = 2;

/**
 * Instrucción (mensaje de usuario añadido AL FINAL del prompt normal del chat) para que el
 * personaje redacte, en su propia voz, cómo ve la relación — usando SOLO los recuerdos listados.
 * @param {import('../state.js').LoreEntry[]} memories
 * @param {{ charName: string, userName: string, cap?: number }} opts
 * @returns {string}
 */
export function relationshipInstruction(memories, { charName, userName, cap = RELATIONSHIP_TEXT_MAX_CHARS }) {
  const list = (memories || []).map((e) => `- ${e.content}`).join('\n');
  return (
    `[Task: based ONLY on the memories listed below, write 1 to 2 short sentences, in ${charName}'s own first-person ` +
    `voice, about how ${charName} feels the relationship with ${userName} is going so far. Under ${cap} characters, ` +
    `same language as the conversation, third person names but first-person voice (say "I", not "${charName}"). ` +
    `Use ONLY what is in these memories: no new names, no new facts, nothing invented, no feelings that aren't ` +
    `supported by them. No stage directions, no asterisks, just the plain sentences.\n\nMemories:\n${list}\n\nEnd of memories.]`
  );
}

/**
 * Arma la petición como CONTINUACIÓN del prompt normal del chat (mismos mensajes, misma cabecera,
 * mismo recorte — 0 s de penalización de caché, medido para esta misma técnica en MEM-007), más la
 * instrucción y el inicio de respuesta. La cabecera usa el estado de relación ACTUAL (antes de esta
 * actualización): es lo mismo que ve cualquier respuesta normal del chat en este momento.
 * @param {{ character: object, chat: object, messages: object[], settings: object }} ctx
 * @param {string} instruction
 * @returns {{ mode: 'chat', messages: { role: string, content: string }[], stop: string[] } | { mode: 'plain', prompt: string, stop: string[] }}
 */
export function buildRelationshipRequest(ctx, instruction) {
  const { character, chat, messages, settings } = ctx;
  const card = character.card;
  const scenario = (chat && chat.scenario) || '';
  const always = loreBudgetPreview((character && character.lorebook) || []).alwaysBlock;
  const relationship = relationshipForPrompt(character);
  const appearance = appearanceOf(character);
  const extras = { relationship, ...(appearance && appearance.fixed ? { appearance: { fixed: appearance.fixed } } : {}) };
  if (settings && settings.mode === 'chat') {
    const built = buildChatMessages(card, messages, settings, scenario, always, '', '', false, extras);
    return {
      mode: 'chat',
      messages: [...built.messages, { role: 'user', content: instruction }, { role: 'assistant', content: RELATIONSHIP_PREFILL }],
      stop: ['\n'],
    };
  }
  const built = buildPlainPrompt(card, messages, settings, scenario, always, '', '', false, extras);
  const cue = `\n${card.name}:`;
  const base = built.prompt.endsWith(cue) ? built.prompt.slice(0, -cue.length) : built.prompt;
  return { mode: 'plain', prompt: `${base}\n${instruction}\n${RELATIONSHIP_PREFILL}`, stop: ['\n'] };
}

/* ---------- actualizador: prioridad al chat, sin competir con él ---------- */

function makeGenKey() {
  return 'REL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Crea el actualizador del texto de relación. Mismo patrón que `createLoreUpdater`/
 * `createContinuityUpdater` (y por las mismas razones: probar sin DOM ni red):
 *  - nunca arranca mientras hay una generación del chat en curso (`isChatBusy()`);
 *  - `abort()` cancela una en curso sin guardar nada;
 *  - en nivel "early" nunca llama al modelo (`maybeRun`/`runNow` devuelven sin tocar nada);
 *  - el texto redactado pasa por `deps.cleanText` y `deps.verifyText` (misma técnica léxica que el
 *    resumen de continuidad — MEM-007, `cleanRecap`/`verifyRecap` de api/continuity.js, inyectadas
 *    por quien arma el actualizador para no crear un ciclo de imports); si no se puede verificar
 *    tras RELATIONSHIP_MAX_ATTEMPTS intentos, se guarda la frase de respaldo determinista;
 *  - una edición manual (`source:'manual'`) NUNCA se pisa con una regeneración automática
 *    (`maybeRun`); solo `runNow()` (el usuario pidió "Regenerar" a propósito) la reemplaza;
 *  - el commit vuelve a leer el personaje justo antes de guardar.
 * Resultado de `maybeRun()`/`runNow()`: `{ kind, level?, usedFallback? }` con `kind` = `ok` |
 * `skipped` | `busy` | `early` | `aborted` | `error`.
 *
 * @param {{
 *   getContext: () => ({ character: object, chat: object, messages: object[], settings: object }|null),
 *   isChatBusy: () => boolean,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   cleanText: (raw: string, opts: { charName?: string, userName?: string, cap?: number }) => string,
 *   verifyText: (text: string, sourceText: string, knownNames?: string[]) => { ok: boolean, unsupported: string[] },
 *   loadCharacter: (characterId: string) => Promise<object|null>,
 *   saveRelationship: (characterId: string, patch: { text: string, level: string, updated: number, source: 'auto' }) => Promise<object|void>,
 *   onStatus?: (status: object) => void,
 *   onLevelChanged?: (info: { level: string }) => void,
 * }} deps
 */
export function createRelationshipUpdater(deps) {
  let running = null;
  let status = { kind: 'idle', at: 0 };

  function setStatus(kind, extra = {}) {
    status = { kind, at: Date.now(), ...extra };
    if (deps.onStatus) {
      try {
        deps.onStatus(status);
      } catch {
        // la UI nunca debe romper la actualización
      }
    }
    return { kind, ...extra };
  }

  async function run(ctx, level, { manual = false } = {}) {
    const controller = new AbortController();
    running = { controller };
    const { character, settings } = ctx;
    const names = { charName: character.card.name, userName: (settings && settings.user) || 'User' };
    try {
      const memories = selectRelationshipMemories(character.lorebook || []);
      const sourceText = memories.map((e) => e.content).join(' ');
      const instruction = relationshipInstruction(memories, names);

      let text = '';
      for (let attempt = 0; attempt < RELATIONSHIP_MAX_ATTEMPTS && !text; attempt++) {
        let raw;
        try {
          raw = await deps.complete(buildRelationshipRequest(ctx, instruction), {
            signal: controller.signal,
            genkey: makeGenKey(),
            maxLen: RELATIONSHIP_MAX_TOKENS,
            temp: RELATIONSHIP_TEMP,
            stop: ['\n'],
          });
        } catch {
          if (controller.signal.aborted) return setStatus('aborted');
          continue;
        }
        if (controller.signal.aborted) return setStatus('aborted');
        const cleaned = deps.cleanText(raw, { ...names, cap: RELATIONSHIP_TEXT_MAX_CHARS });
        if (cleaned && deps.verifyText(cleaned, sourceText, [names.charName, names.userName]).ok) text = cleaned;
      }
      const usedFallback = !text;
      const finalText = text || RELATIONSHIP_FALLBACK_TEXT[level] || '';

      const fresh = await deps.loadCharacter(character.id);
      if (!fresh) return setStatus('error');
      if (!manual && sanitizeRelationship(fresh.relationship).source === 'manual') return setStatus('skipped');
      await deps.saveRelationship(character.id, { text: finalText, level, updated: Date.now(), source: 'auto' });
      if (deps.onLevelChanged) {
        try {
          deps.onLevelChanged({ level });
        } catch {
          // idem: nunca rompe la actualización
        }
      }
      return setStatus('ok', { level, usedFallback });
    } catch {
      return setStatus('error');
    } finally {
      running = null;
    }
  }

  return {
    /** Disparo automático: solo si cruzó de nivel (o nunca se generó texto para el nivel actual) y el chat está libre. */
    async maybeRun() {
      if (running || deps.isChatBusy()) return { kind: 'skipped' };
      const ctx = deps.getContext();
      if (!ctx || !ctx.character || !ctx.settings) return { kind: 'skipped' };
      const level = relationshipLevel(((ctx.character.lorebook || []).filter((e) => e && typeof e.content === 'string' && e.content.trim())).length);
      if (level === 'early') return { kind: 'skipped' };
      const stored = sanitizeRelationship(ctx.character.relationship);
      if (stored.source === 'manual') return { kind: 'skipped' };
      if (stored.level === level && stored.text) return { kind: 'skipped' };
      return run(ctx, level, { manual: false });
    },
    /** "Regenerar" (pedido explícito del usuario): reemplaza incluso una edición manual. */
    async runNow() {
      if (running || deps.isChatBusy()) return { kind: 'busy' };
      const ctx = deps.getContext();
      if (!ctx || !ctx.character || !ctx.settings) return { kind: 'skipped' };
      const level = relationshipLevel(((ctx.character.lorebook || []).filter((e) => e && typeof e.content === 'string' && e.content.trim())).length);
      if (level === 'early') return { kind: 'early' };
      return run(ctx, level, { manual: true });
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
