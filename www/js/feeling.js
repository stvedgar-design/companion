// www/js/api/feeling.js
// MEM-015: el personaje dice, EN SU VOZ, cómo se siente — una palabra de una lista cerrada, elegida por el
// modelo, cuando la respuesta usó 3 o más recuerdos "por tema" (misma regla que MEM-011, `mood.js`). Sin
// lista cerrada no hay invención posible por diseño: cualquier palabra que no esté en `FEELING_WORDS` se
// descarta y se usa el respaldo heurístico de MEM-011 (`deriveMood`, que sigue existiendo tal cual).
//
// Misma técnica de continuación validada en MEM-007/MEM-014 (menos texto, sin verificación léxica: no hace
// falta, la lista cerrada ya impide inventar nombres o hechos) y misma prioridad absoluta del chat: nunca
// compite con una generación en curso, un solo intento por respuesta, se aborta si el usuario escribe o
// envía. Resultado del Paso 0 (costo y tabla de calidad) en docs/HISTORIAL.md, "MEM-015".
//
// Puro en el sentido de "sin fetch propio" (PRINCIPIOS-DE-INGENIERIA.md, #10): la llamada al servidor entra
// por `deps.complete`, igual que api/continuity.js y api/relationship.js.

import { buildChatMessages, buildPlainPrompt } from './prompt.js';
import { loreBudgetPreview } from './lorebook.js';
import { relationshipForPrompt } from './relationship.js';
import { appearanceOf } from '../character-appearance.js';
import { identityForPrompt } from './identity-synthesis.js';
import { MOOD_MIN_ACTIVATED } from './mood.js';

/**
 * Lista cerrada: sustantivos (nunca adjetivos, por la misma razón que MEM-011 — no suponer el género del
 * personaje), en inglés (lo que el modelo debe copiar EXACTO) con su etiqueta en español para mostrar
 * ("sintiendo ternura"). ~28 categorías, deliberadamente más amplia que las ~11 de `mood.js` (esa es una
 * heurística barata sin modelo; esta la elige el propio personaje).
 */
export const FEELING_WORDS = Object.freeze([
  { word: 'tenderness', label: 'ternura' },
  { word: 'nostalgia', label: 'nostalgia' },
  { word: 'joy', label: 'alegría' },
  { word: 'shyness', label: 'timidez' },
  { word: 'desire', label: 'deseo' },
  { word: 'calm', label: 'calma' },
  { word: 'unease', label: 'inquietud' },
  { word: 'pride', label: 'orgullo' },
  { word: 'gratitude', label: 'gratitud' },
  { word: 'sadness', label: 'tristeza' },
  { word: 'excitement', label: 'ilusión' },
  { word: 'loneliness', label: 'soledad' },
  { word: 'curiosity', label: 'curiosidad' },
  { word: 'jealousy', label: 'celos' },
  { word: 'relief', label: 'alivio' },
  { word: 'frustration', label: 'frustración' },
  { word: 'affection', label: 'cariño' },
  { word: 'hope', label: 'esperanza' },
  { word: 'guilt', label: 'culpa' },
  { word: 'embarrassment', label: 'vergüenza' },
  { word: 'anger', label: 'enojo' },
  { word: 'wonder', label: 'asombro' },
  { word: 'warmth', label: 'calidez' },
  { word: 'longing', label: 'añoranza' },
  { word: 'contentment', label: 'satisfacción' },
  { word: 'anxiety', label: 'ansiedad' },
  { word: 'playfulness', label: 'picardía' },
  { word: 'trust', label: 'confianza' },
]);

const WORD_TO_LABEL = new Map(FEELING_WORDS.map((f) => [f.word, f.label]));
const KNOWN_WORDS = new Set(FEELING_WORDS.map((f) => f.word));

/**
 * Hallazgo real del Paso 0 (docs/HISTORIAL.md, "MEM-015"): pedido el sustantivo exacto, el modelo a veces
 * responde con el ADJETIVO natural en inglés ("grateful" en vez de "gratitude") — la lista sigue siendo
 * cerrada (cada alias mapea a UNA sola palabra ya conocida, nunca agrega una categoría nueva), pero
 * `parseFeelingWord` también los reconoce en vez de descartar una respuesta razonable como "sin dato".
 */
const ALIASES = Object.freeze({
  tender: 'tenderness',
  nostalgic: 'nostalgia',
  joyful: 'joy',
  happy: 'joy',
  shy: 'shyness',
  uneasy: 'unease',
  proud: 'pride',
  grateful: 'gratitude',
  sad: 'sadness',
  excited: 'excitement',
  lonely: 'loneliness',
  curious: 'curiosity',
  jealous: 'jealousy',
  relieved: 'relief',
  frustrated: 'frustration',
  affectionate: 'affection',
  hopeful: 'hope',
  guilty: 'guilt',
  embarrassed: 'embarrassment',
  angry: 'anger',
  warm: 'warmth',
  content: 'contentment',
  anxious: 'anxiety',
  playful: 'playfulness',
  trusting: 'trust',
});

/** Mismo umbral que "sintiendo …" de MEM-011: 3+ recuerdos activados POR TEMA (los "siempre presentes" no cuentan). */
export const FEELING_MIN_ACTIVATED = MOOD_MIN_ACTIVATED;

/**
 * ¿La respuesta activó suficientes recuerdos por tema como para que proceda preguntarle al personaje cómo
 * se siente? Misma cuenta que `deriveMood` (MEM-011): descarta los "siempre presentes". Pura.
 * @param {{ content?: string, always?: boolean }[]|undefined} loreUsed
 * @returns {boolean}
 */
export function feelingApplies(loreUsed) {
  const topic = (Array.isArray(loreUsed) ? loreUsed : []).filter((e) => e && e.always !== true);
  return topic.length >= FEELING_MIN_ACTIVATED;
}

/**
 * Valida un valor guardado (o de una copia de seguridad/import): debe ser exactamente una de las palabras
 * de `FEELING_WORDS`. Cualquier otra cosa es "sin dato" (`undefined`) — nunca se inventa ni se corrige.
 * @param {unknown} raw
 * @returns {string|undefined}
 */
export function sanitizeFeeling(raw) {
  return typeof raw === 'string' && KNOWN_WORDS.has(raw) ? raw : undefined;
}

/**
 * La respuesta CRUDA del modelo, reducida a una palabra válida de la lista (o `null` si no hay ninguna) —
 * sin importar mayúsculas, puntuación sobrante (Markdown incluido) o que haya escrito una frase en vez de
 * una palabra: se busca la PRIMERA palabra de la lista — o uno de sus alias conocidos (ver `ALIASES`,
 * Paso 0) — que aparezca como palabra completa en el texto. Pura.
 * @param {string} raw
 * @returns {string|null}
 */
export function parseFeelingWord(raw) {
  const text = String(raw == null ? '' : raw).toLowerCase();
  for (const { word } of FEELING_WORDS) {
    if (new RegExp(`\\b${word}\\b`).test(text)) return word;
  }
  for (const alias of Object.keys(ALIASES)) {
    if (new RegExp(`\\b${alias}\\b`).test(text)) return ALIASES[alias];
  }
  return null;
}

/** Etiqueta en español de una palabra válida ('' si no se reconoce). */
export function feelingLabel(word) {
  return WORD_TO_LABEL.get(word) || '';
}

/** Texto para mostrar junto al timestamp ("sintiendo ternura"), o '' si no hay palabra válida. */
export function feelingDisplayText(word) {
  const label = feelingLabel(word);
  return label ? `sintiendo ${label}` : '';
}

/* ---------- petición al modelo: continuación del prefijo del chat (misma técnica que MEM-007/014) ---------- */

/** Inicio de respuesta ya escrito ("prefill"): evita la respuesta vacía si el modelo empezara con un salto de línea. */
export const FEELING_PREFILL = 'Right now I feel';
/** Temperatura pedida (el servidor real impone su propio muestreo; ver NOTES.md). */
export const FEELING_TEMP = 0.4;
/**
 * Tokens de salida pedidos. El contrato sugería ~6; el Paso 0 (docs/HISTORIAL.md, "MEM-015") midió que el
 * modelo suele anteponer relleno antes de la palabra ("**", "...", ":") y con 6 tokens una respuesta se
 * truncó antes de llegar a ella (0 palabra en vez de una válida) — 10 dejó margen sin alargar la espera
 * de forma perceptible (la petición sigue siendo cortísima).
 */
export const FEELING_MAX_TOKENS = 10;

/**
 * Instrucción (mensaje de usuario añadido AL FINAL del prompt normal del chat) para que el personaje
 * elija, en su propia voz, UNA palabra de la lista cerrada.
 * @param {{ charName: string }} opts
 * @returns {string}
 */
export function feelingInstruction({ charName }) {
  const words = FEELING_WORDS.map((f) => f.word).join(', ');
  return (
    `[Task: in ONE word from this exact list, what is ${charName} feeling right now, after that last reply: ` +
    `${words}.\n\nAnswer with EXACTLY ONE word from that list, nothing else: no sentence, no punctuation, no explanation.]`
  );
}

/**
 * Arma la petición como CONTINUACIÓN del prompt normal del chat (mismos mensajes, misma cabecera, mismo
 * recorte — 0 s de penalización de caché, misma técnica medida en MEM-007), más la instrucción y el inicio
 * de respuesta ya escrito.
 * @param {{ character: object, chat: object, messages: object[], settings: object }} ctx
 * @param {string} instruction
 * @returns {{ mode: 'chat', messages: object[], stop: string[] } | { mode: 'plain', prompt: string, stop: string[] }}
 */
export function buildFeelingRequest(ctx, instruction) {
  const { character, chat, messages, settings } = ctx;
  const card = character.card;
  const scenario = (chat && chat.scenario) || '';
  const always = loreBudgetPreview((character && character.lorebook) || []).alwaysBlock;
  const relationship = relationshipForPrompt(character);
  const appearance = appearanceOf(character);
  // MEM-019: la cabecera lleva la identidad aceptada, igual que en el chat normal (así sigue siendo continuación del prefijo).
  const identity = identityForPrompt(character);
  const extras = { relationship, ...(appearance && appearance.fixed ? { appearance: { fixed: appearance.fixed } } : {}), ...(identity ? { identity } : {}) };
  if (settings && settings.mode === 'chat') {
    const built = buildChatMessages(card, messages, settings, scenario, always, '', '', false, extras);
    return {
      mode: 'chat',
      messages: [...built.messages, { role: 'user', content: instruction }, { role: 'assistant', content: FEELING_PREFILL }],
      stop: ['\n'],
    };
  }
  const built = buildPlainPrompt(card, messages, settings, scenario, always, '', '', false, extras);
  const cue = `\n${card.name}:`;
  const base = built.prompt.endsWith(cue) ? built.prompt.slice(0, -cue.length) : built.prompt;
  return { mode: 'plain', prompt: `${base}\n${instruction}\n${FEELING_PREFILL}`, stop: ['\n'] };
}

/* ---------- actualizador: prioridad absoluta al chat, un solo intento ---------- */

function makeGenKey() {
  return 'FEEL' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Crea el actualizador del sentimiento de UN mensaje ya mostrado y guardado. Mismo patrón que
 * `createContinuityUpdater`/`createRelationshipUpdater`, simplificado: un solo intento (sin reintentos: si
 * falla, se calla y queda el respaldo heurístico de MEM-011), y se dispara por mensaje, no por chat entero.
 *  - nunca arranca mientras hay una generación del chat en curso (`isChatBusy()`), ni si `Settings.feelingsEnabled`
 *    no es exactamente `true` (apagado por defecto — ver Paso 0 en docs/HISTORIAL.md, "MEM-015");
 *  - `abort()` cancela una en curso sin guardar nada (prioridad absoluta: el usuario escribió o envió);
 *  - la palabra devuelta que no está en `FEELING_WORDS` se descarta (nunca se guarda una inventada);
 *  - el commit vuelve a leer el chat: si el mensaje ya no es el mismo (se editó, se regeneró, se borró)
 *    mientras corría esto, no se guarda nada.
 * Resultado de `maybeRun(idx)`: `{ kind, word? }` con `kind` = `ok` | `skipped` | `unavailable` | `unparsed` |
 * `aborted` | `error`.
 *
 * @param {{
 *   getContext: () => ({ character: object, chat: object, messages: object[], settings: object }|null),
 *   isChatBusy: () => boolean,
 *   complete: (request: object, opts: { signal: AbortSignal, genkey: string, maxLen: number, temp: number, stop: string[] }) => Promise<string>,
 *   loadChatMessages: (chatId: string) => Promise<object[]|null>,
 *   saveFeeling: (chatId: string, idx: number, word: string) => Promise<void>,
 *   onStatus?: (status: object) => void,
 * }} deps
 */
export function createFeelingUpdater(deps) {
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

  async function run(ctx, idx) {
    const controller = new AbortController();
    running = { controller };
    try {
      const { character } = ctx;
      const instruction = feelingInstruction({ charName: character.card.name });
      let raw;
      try {
        raw = await deps.complete(buildFeelingRequest(ctx, instruction), {
          signal: controller.signal,
          genkey: makeGenKey(),
          maxLen: FEELING_MAX_TOKENS,
          temp: FEELING_TEMP,
          stop: ['\n'],
        });
      } catch {
        if (controller.signal.aborted) return setStatus('aborted');
        return setStatus('unavailable');
      }
      if (controller.signal.aborted) return setStatus('aborted');

      const word = parseFeelingWord(raw);
      if (!word) return setStatus('unparsed');

      // Commit: se relee el chat; si el mensaje cambió (editado, regenerado, borrado) mientras corría
      // esto, no se guarda nada (el respaldo heurístico de MEM-011 sigue disponible igual).
      const fresh = await deps.loadChatMessages(ctx.chat.id);
      const freshMsg = fresh && fresh[idx];
      if (!freshMsg || freshMsg.role !== 'char' || freshMsg.text !== ctx.messages[idx].text) return setStatus('skipped');

      await deps.saveFeeling(ctx.chat.id, idx, word);
      return setStatus('ok', { word });
    } catch {
      return setStatus('error');
    } finally {
      running = null;
    }
  }

  return {
    /** Se llama después de mostrar y guardar la respuesta `idx`, en segundo plano. */
    async maybeRun(idx) {
      if (running || deps.isChatBusy()) return { kind: 'skipped' };
      const ctx = deps.getContext();
      if (!ctx || !ctx.character || !ctx.chat || !ctx.settings) return { kind: 'skipped' };
      if (ctx.settings.feelingsEnabled !== true) return { kind: 'skipped' };
      const message = ctx.messages[idx];
      if (!message || message.role !== 'char' || !message.text) return { kind: 'skipped' };
      if (sanitizeFeeling(message.feeling)) return { kind: 'skipped' }; // ya tiene uno (no se regenera solo)
      if (!feelingApplies(message.loreUsed)) return { kind: 'skipped' };
      return run(ctx, idx);
    },
    /** Cancela una generación en curso sin guardar nada (prioridad absoluta del usuario). */
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
