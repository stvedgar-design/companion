// www/js/api/prompt.js — Módulo 04 "Motor".
// Puro: no importa nada, no toca el DOM ni hace peticiones de red.
// Arma el texto/los mensajes que se envían al servidor a partir de una
// Card y del historial de la conversación.

/**
 * @typedef {Object} Card
 * @property {string} name
 * @property {string} description
 * @property {string} personality
 * @property {string} scenario
 * @property {string} first_mes
 * @property {string} mes_example
 * @property {string} system_prompt
 * @property {string} post_history_instructions
 * @property {string[]} alternate_greetings
 * @property {object|null} character_book
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name
 * @property {string} avatar
 * @property {Card} card
 * @property {'none'|'mini'|'large'} avatarMode
 * @property {number} created
 * @property {number} updated
 * @property {string} last
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'char'} role
 * @property {string} text
 * @property {number} ts
 */

/**
 * @typedef {Object} Settings
 * @property {string} url
 * @property {string} user
 * @property {number} maxLen
 * @property {number} temp
 * @property {'plain'|'chat'} mode
 * @property {number} ctx
 */

// Estimación prudente de caracteres por token para calcular el presupuesto
// del historial. Mejor recortar de más que desbordar el contexto.
const CHARS_PER_TOKEN = 3.3;

// Presupuesto mínimo de caracteres para el historial, aunque la cuenta dé
// un número menor (evita recortes absurdos con contextos muy pequeños).
const MIN_HISTORY_BUDGET = 500;

// Caracteres de margen que se descuentan por cada línea del historial
// (aproxima el costo de la etiqueta "Nombre: " y separadores).
const LINE_OVERHEAD = 12;

/**
 * Reemplaza las macros {{char}}/<BOT> por el nombre del personaje y
 * {{user}}/<USER> por el nombre del usuario. Insensible a mayúsculas.
 * @param {string} text
 * @param {string} charName
 * @param {string} userName
 * @returns {string}
 */
export function subMacros(text, charName, userName) {
  return String(text || '')
    .replace(/\{\{char\}\}|<BOT>/gi, charName)
    .replace(/\{\{user\}\}|<USER>/gi, userName);
}

/**
 * Devuelve el o los mensajes iniciales de un chat nuevo, según el saludo
 * elegido. Devuelve [] si ese saludo está vacío.
 * @param {Character} character
 * @param {Settings} settings
 * @param {number} [greetingIndex]
 * @returns {Message[]}
 */
export function initialMessages(character, settings, greetingIndex = 0) {
  const card = character.card;
  const userName = (settings && settings.user) || 'User';
  const greeting =
    greetingIndex === 0
      ? card.first_mes
      : (card.alternate_greetings || [])[greetingIndex - 1];

  if (!greeting) return [];

  return [
    {
      role: 'char',
      text: subMacros(greeting, card.name, userName),
      ts: Date.now()
    }
  ];
}

/**
 * Mensaje inicial para un chat nuevo que tiene un escenario propio (adenda
 * multi-chat). El `first_mes` de la card fue escrito para el escenario por
 * defecto de la card, así que casi siempre no encaja con un escenario nuevo
 * escrito a mano — por eso, en ese caso, se reemplaza por una nota entre
 * paréntesis (estilo acotación de escena, en *asteriscos*) con el propio
 * escenario, en vez del saludo de la card.
 * @param {Character} character
 * @param {Settings} settings
 * @param {string} chatScenario
 * @returns {Message[]} [] si `chatScenario` está vacío.
 */
export function scenarioGreeting(character, settings, chatScenario) {
  const text = String(chatScenario || '').trim();
  if (!text) return [];
  const card = character.card;
  const userName = (settings && settings.user) || 'User';
  return [
    {
      role: 'char',
      text: `*(${subMacros(text, card.name, userName)})*`,
      ts: Date.now()
    }
  ];
}

// Bloque de cabecera común a ambos formatos de prompt: system_prompt de la
// card (si existe), una instrucción breve de rol, y los campos de la card
// con las macros ya resueltas. `chatScenario` es el escenario escrito a
// mano para ESTE chat en particular (adenda multi-chat): se suma al
// escenario de la card, nunca lo reemplaza. `loreBlock` es el texto ya
// armado (ver `formatLoreBlock` en api/lorebook.js) con las entradas del
// lorebook automático que matchearon por keyword en los últimos mensajes;
// '' si ninguna matcheó o el chat todavía no tiene lorebook.
function headBlock(card, settings, chatScenario, loreBlock) {
  const N = card.name;
  const U = (settings && settings.user) || 'User';
  const sub = (s) => subMacros(s, N, U);
  const parts = [];

  if (card.system_prompt) parts.push(sub(card.system_prompt));

  parts.push(
    `Roleplay chat between ${N} and ${U}. Stay in character as ${N}. ` +
      `Write only ${N}'s next reply, using *asterisks* for actions and plain text for speech.`
  );

  if (card.description) parts.push(`${N}'s description:\n${sub(card.description)}`);
  if (card.personality) parts.push(`${N}'s personality: ${sub(card.personality)}`);

  const scenarioLines = [];
  if (card.scenario) scenarioLines.push(sub(card.scenario));
  if (chatScenario) scenarioLines.push(sub(chatScenario));
  if (scenarioLines.length) parts.push(`Scenario: ${scenarioLines.join('\n')}`);

  if (loreBlock) parts.push(loreBlock);

  if (card.mes_example) {
    parts.push(`Example dialogue:\n${sub(card.mes_example).replace(/<START>/gi, '').trim()}`);
  }

  return parts.join('\n\n');
}

// Conserva los items más recientes dentro de un presupuesto de caracteres.
// Nunca devuelve menos de 1 item si items no está vacío.
function pickHistory(items, budget, lengthOf) {
  let used = 0;
  const keep = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const cost = lengthOf(items[i]) + LINE_OVERHEAD;
    if (used + cost > budget && keep.length) break;
    used += cost;
    keep.unshift(items[i]);
  }
  return keep;
}

/**
 * Arma un prompt de texto simple (equivalente al modo chat de Kobold Lite),
 * compatible con cualquier modelo.
 * @param {Card} card
 * @param {Message[]} messages
 * @param {Settings} settings
 * @param {string} [chatScenario] Escenario propio del chat (adenda multi-chat).
 * @param {string} [loreBlock] Entradas del lorebook automático ya seleccionadas (ver api/lorebook.js).
 * @returns {{ prompt: string, stop: string[] }}
 */
export function buildPlainPrompt(card, messages, settings, chatScenario = '', loreBlock = '') {
  const N = card.name;
  const U = (settings && settings.user) || 'User';
  const ctx = (settings && settings.ctx) || 4096;
  const maxLen = (settings && settings.maxLen) || 220;

  const head = headBlock(card, settings, chatScenario, loreBlock) + '\n\n[Start of chat]';
  const post = card.post_history_instructions
    ? `\n[${subMacros(card.post_history_instructions, N, U)}]`
    : '';
  const cue = `\n${N}:`;

  const budget = Math.max(
    MIN_HISTORY_BUDGET,
    (ctx - maxLen - 64) * CHARS_PER_TOKEN - head.length - post.length - cue.length
  );

  const lines = messages.map((m) => `${m.role === 'user' ? U : N}: ${m.text}`);
  const kept = pickHistory(lines, budget, (line) => line.length);

  const prompt = head + '\n' + kept.join('\n') + post + cue;
  const stop = [`\n${U}:`, `${U}:`, `\n${N}:`];

  return { prompt, stop };
}

/**
 * Arma los mensajes para /v1/chat/completions, dejando que el servidor
 * aplique la plantilla del modelo cargado.
 * @param {Card} card
 * @param {Message[]} messages
 * @param {Settings} settings
 * @param {string} [chatScenario] Escenario propio del chat (adenda multi-chat).
 * @param {string} [loreBlock] Entradas del lorebook automático ya seleccionadas (ver api/lorebook.js).
 * @returns {{ messages: {role:'system'|'user'|'assistant', content:string}[], stop: string[] }}
 */
export function buildChatMessages(card, messages, settings, chatScenario = '', loreBlock = '') {
  const N = card.name;
  const U = (settings && settings.user) || 'User';
  const ctx = (settings && settings.ctx) || 4096;
  const maxLen = (settings && settings.maxLen) || 220;

  let head = headBlock(card, settings, chatScenario, loreBlock);
  if (card.post_history_instructions) {
    head += '\n\n' + subMacros(card.post_history_instructions, N, U);
  }

  const budget = Math.max(MIN_HISTORY_BUDGET, (ctx - maxLen - 64) * CHARS_PER_TOKEN - head.length);
  const kept = pickHistory(messages, budget, (m) => m.text.length);

  const out = [{ role: 'system', content: head }];
  // Muchas plantillas exigen que el primer turno sea 'user'.
  if (!kept.length || kept[0].role !== 'user') {
    out.push({ role: 'user', content: '[Start of roleplay]' });
  }
  kept.forEach((m) => out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));

  // "\n" primero: en /v1/chat/completions el corte en salto de línea de los
  // `gendefaults` del servidor NO se aplica si la petición trae su propio `stop`
  // (medido en FMT-001), y sin él el modelo a veces responde en varios párrafos.
  // Formato Nomi = un solo párrafo por turno del personaje.
  const stop = ['\n', `\n${U}:`];

  return { messages: out, stop };
}

/**
 * Estima qué fracción del contexto del modelo ocupa la conversación en este
 * momento, para mostrar un indicador en la UI (menú del chat). Usa la misma
 * heurística de caracteres/token que arma los prompts reales — es una
 * aproximación, no una cuenta exacta de tokens (eso solo lo sabe el
 * servidor).
 * @param {Card} card
 * @param {Message[]} messages
 * @param {Settings} settings
 * @param {string} [chatScenario]
 * @param {string} [loreBlock] Entradas del lorebook automático ya seleccionadas (ver api/lorebook.js).
 * @returns {{ approxTokens: number, budgetTokens: number, ratio: number }}
 *   `ratio` es approxTokens/budgetTokens, sin recortar a 1 (puede superar 1
 *   si ya no entra todo el historial y algunos mensajes se recortarían).
 */
export function estimateContextUsage(card, messages, settings, chatScenario = '', loreBlock = '') {
  const ctx = (settings && settings.ctx) || 4096;
  const maxLen = (settings && settings.maxLen) || 220;
  const head = headBlock(card, settings, chatScenario, loreBlock);
  const historyChars = messages.reduce((sum, m) => sum + String(m.text || '').length + LINE_OVERHEAD, 0);
  const approxTokens = Math.ceil((head.length + historyChars) / CHARS_PER_TOKEN);
  const budgetTokens = Math.max(1, ctx - maxLen);
  return { approxTokens, budgetTokens, ratio: approxTokens / budgetTokens };
}

function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Quita un prefijo inicial "{char}:" (si el modelo lo repitió) y espacios
 * sobrantes.
 * @param {string} text
 * @param {string} charName
 * @returns {string}
 */
export function cleanReply(text, charName) {
  return String(text)
    .replace(new RegExp('^\\s*' + escapeRegExp(charName) + ':\\s*'), '')
    .trim();
}

/**
 * Cuando una respuesta se cortó por límite de longitud, elimina la frase
 * incompleta del final sin dejar un asterisco de acción abierto huérfano.
 * No toca respuestas que ya terminan en puntuación. No recorta más de 240
 * caracteres.
 * @param {string} text
 * @returns {string}
 */
export function trimPartial(text) {
  if (/[.!?…*"~)\]]\s*$/.test(text)) return text;

  const m = text.match(/^([\s\S]*[.!?…*"~)\]])[^.!?…*"~)\]]*$/);
  if (!m || text.length - m[1].length > 240) return text;

  let r = m[1];
  // Si quedó un número impar de asteriscos, el último abre una acción que
  // nunca se cerró: se descarta junto con el espacio que lo precede.
  if ((r.match(/\*/g) || []).length % 2) r = r.replace(/\s*\*$/, '');
  return r.trim();
}
