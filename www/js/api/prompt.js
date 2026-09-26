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

// Presupuesto de caracteres del historial: lo que cabe en `ctx` menos la salida reservada, menos lo que ya ocupan
// las demás partes del prompt (`usedParts`, restadas una a una en este orden, como siempre). Lo comparten los
// armadores de prompt y `historyStartIndex`, para que "qué se recorta" no dependa de dos cuentas distintas.
function historyBudgetChars(settings, ...usedParts) {
  const ctx = (settings && settings.ctx) || 4096;
  const maxLen = (settings && settings.maxLen) || 220;
  return Math.max(MIN_HISTORY_BUDGET, usedParts.reduce((left, n) => left - n, (ctx - maxLen - 64) * CHARS_PER_TOKEN));
}

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

// MEM-008: estado de la relación en la conversación. Va en la CABECERA, junto a los recuerdos "siempre presentes"
// (solo cambia cuando el lorebook cruza un umbral de cantidad, así que no se mueve turno a turno). El nivel lo
// calcula `relationshipSummary().level` (api/relationship.js); aquí solo se elige la frase, en inglés porque el
// prompt lo está. Sin recuerdos (`none`) o con un nivel desconocido no se envía nada.
const RELATIONSHIP_LABEL = 'Relationship so far:';
const RELATIONSHIP_TEMPLATES = Object.freeze({
  few: (U, N) => `${U} and ${N} are still getting to know each other.`,
  several: (U, N) => `${U} and ${N} have already shared quite a lot.`,
  many: (U, N) => `${U} and ${N} have a long shared history.`,
});

/**
 * Texto de la línea "Relationship so far: …" o '' si no aplica.
 * @param {string} level  'none'|'few'|'several'|'many' (de `relationshipSummary().level`)
 * @param {string} charName
 * @param {string} userName
 * @returns {string}
 */
export function formatRelationshipBlock(level, charName, userName) {
  const make = Object.prototype.hasOwnProperty.call(RELATIONSHIP_TEMPLATES, level) ? RELATIONSHIP_TEMPLATES[level] : null;
  return make ? `${RELATIONSHIP_LABEL} ${make(userName, charName)}` : '';
}

// Bloque de cabecera común a ambos formatos de prompt: system_prompt de la
// card (si existe), una instrucción breve de rol, y los campos de la card
// con las macros ya resueltas. `chatScenario` es el escenario escrito a
// mano para ESTE chat en particular (adenda multi-chat): se suma al
// escenario de la card, nunca lo reemplaza. `loreBlock` es el texto ya
// armado (ver `formatLoreBlock` en api/lorebook.js) con las entradas del
// lorebook automático que matchearon por keyword en los últimos mensajes;
// '' si ninguna matcheó o el chat todavía no tiene lorebook. `relationship` = nivel de MEM-008 ('few'|'several'|'many';
// cualquier otro valor, o ausente, no añade nada).
function headBlock(card, settings, chatScenario, loreBlock, relationship = '') {
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

  const relationshipLine = formatRelationshipBlock(relationship, N, U);
  if (relationshipLine) parts.push(relationshipLine);
  if (loreBlock) parts.push(loreBlock);

  if (card.mes_example) {
    parts.push(`Example dialogue:\n${sub(card.mes_example).replace(/<START>/gi, '').trim()}`);
  }

  return parts.join('\n\n');
}

// MEM-004: envoltorio del bloque "por tema" cuando va al final del prompt. Es una nota para el
// modelo, no algo que el usuario dijo; el texto exacto se eligió midiendo (docs/HISTORIAL.md, "MEM-004").
function formatTopicBlock(topicBlock) {
  return `[${String(topicBlock).trim()}]`;
}

// MEM-007: resumen de continuidad del chat (lo que ya no cabe en la ventana). Va al FINAL del prompt, junto al bloque
// "por tema" y por la misma razón (medida en docs/HISTORIAL.md, "MEM-007"): en la cabecera, cada actualización del
// resumen invalidaría la caché de prompt del servidor y una respuesta tardaría ~55 s.
const CONTINUITY_LABEL = 'Earlier in this conversation:';

/**
 * Texto del bloque de continuidad (sin corchetes), o '' si no hay resumen.
 * @param {string} text
 * @returns {string}
 */
export function formatContinuityBlock(text) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  return t ? `${CONTINUITY_LABEL} ${t}` : '';
}

// Espacio que el resumen reserva SIEMPRE en el presupuesto del historial, tenga el texto que tenga (tope de trabajo 800 +
// etiqueta y corchetes). Medido en MEM-007: si el bloque final se acorta (p. ej. al condensar el resumen) el presupuesto
// crece, la ventana recupera mensajes viejos por el FRENTE y el servidor ya no puede reutilizar su caché (~66 s de
// reprocesado en un chat de ~5 500 tokens). Con una reserva fija, cambiar el texto del resumen no mueve la ventana.
export const CONTINUITY_RESERVE_CHARS = 880;

/**
 * Caracteres que el resumen ocupa (reserva) en el presupuesto del historial: los reales con corchetes si el texto es
 * más largo que la reserva; 0 si no hay resumen.
 * @param {string} text
 * @returns {number}
 */
export function continuityBlockChars(text) {
  const block = formatContinuityBlock(text);
  return block ? Math.max(CONTINUITY_RESERVE_CHARS, formatTopicBlock(block).length) : 0;
}

// Relleno que se suma al presupuesto para que el bloque de continuidad cuente como `continuityBlockChars` aunque el texto
// real sea más corto (el bloque real ya está dentro de `topic.length`).
function continuityPadding(continuity) {
  return continuity ? Math.max(0, CONTINUITY_RESERVE_CHARS - formatTopicBlock(continuity).length) : 0;
}

// Todo lo que va al FINAL del prompt (MEM-007 continuidad + MEM-004 "por tema" + FMT-004 nota de variedad), en este
// orden. '' si no hay nada: sin ninguno, el prompt es idéntico al de antes.
function endBlock(topicBlock, varietyNote, continuity = '') {
  return [
    continuity ? formatTopicBlock(continuity) : '',
    topicBlock ? formatTopicBlock(topicBlock) : '',
    varietyNote ? formatTopicBlock(varietyNote) : '',
  ]
    .filter(Boolean)
    .join('\n');
}

// FMT-002: la respuesta del personaje arranca ya dentro de una acción. En modo "texto simple" se añade al
// final del prompt; en modo "plantilla" se envía como mensaje `assistant` final (KoboldCpp lo continúa;
// verificado en FMT-002). La app antepone este mismo carácter al texto mostrado y guardado.
export const FORMAT_PREFILL = '*';

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

// LAT-001 (a) "frente estable": en modo plantilla, si el historial se recortó y el primer mensaje que cabe es del
// personaje, se descarta ese (y los que le sigan hasta el primero del usuario). Así el mensaje de relleno
// `[Start of roleplay]` solo aparece al inicio real del chat: si aparecía y desaparecía al deslizar la ventana, el
// prompt dejaba de ser "el anterior sin el principio" y el servidor reprocesaba todo (~45-55 s; docs/HISTORIAL.md,
// "Hallazgo LAT-001"). Un chat que cabe entero queda idéntico; sin ningún mensaje del usuario en la ventana no se toca.
function stableFront(kept, totalCount) {
  if (kept.length >= totalCount) return kept;
  const firstUser = kept.findIndex((m) => m.role === 'user');
  return firstUser > 0 ? kept.slice(firstUser) : kept;
}

/**
 * Arma un prompt de texto simple (equivalente al modo chat de Kobold Lite),
 * compatible con cualquier modelo.
 * @param {Card} card
 * @param {Message[]} messages
 * @param {Settings} settings
 * @param {string} [chatScenario] Escenario propio del chat (adenda multi-chat).
 * @param {string} [loreBlock] Bloque estable de la CABECERA: los recuerdos "siempre presentes" (ver api/lorebook.js).
 * @param {string} [topicBlock] MEM-004: bloque "por tema" (varía turno a turno). Va al FINAL, justo antes de la
 *   última línea del usuario, y solo en el prompt construido (nunca se guarda ni se muestra). En la cabecera
 *   invalidaría la caché de prompt del servidor (ver docs/HISTORIAL.md, "MEM-004").
 * @param {string} [varietyNote] FMT-004: nota breve para que el personaje varíe su vocabulario. Va junto al bloque
 *   "por tema", al FINAL y solo en el prompt construido.
 * @param {boolean} [prefill] FMT-002: si es true, el prompt termina con `FORMAT_PREFILL` (la respuesta arranca dentro de una acción).
 * @param {{ continuity?: string, relationship?: string }} [extras] MEM-007: `continuity` = texto del resumen de continuidad del chat; va al FINAL
 *   (primer bloque, antes del "por tema"). MEM-008: `relationship` = nivel (`'few'|'several'|'many'`) de `relationshipSummary()`;
 *   añade "Relationship so far: …" a la CABECERA, junto a los "siempre presentes". Ausente o vacío: el prompt queda idéntico al de antes.
 * @returns {{ prompt: string, stop: string[] }}
 */
export function buildPlainPrompt(card, messages, settings, chatScenario = '', loreBlock = '', topicBlock = '', varietyNote = '', prefill = false, extras = {}) {
  const N = card.name;
  const U = (settings && settings.user) || 'User';

  const head = headBlock(card, settings, chatScenario, loreBlock, extras && extras.relationship) + '\n\n[Start of chat]';
  const post = card.post_history_instructions
    ? `\n[${subMacros(card.post_history_instructions, N, U)}]`
    : '';
  const cue = `\n${N}:`;

  const continuity = formatContinuityBlock(extras && extras.continuity);
  const topic = endBlock(topicBlock, varietyNote, continuity);
  const budget = historyBudgetChars(settings, head.length, post.length, cue.length, topic.length + continuityPadding(continuity));

  const lines = messages.map((m) => `${m.role === 'user' ? U : N}: ${m.text}`);
  const kept = pickHistory(lines, budget, (line) => line.length);
  if (topic) {
    // Antes de la última línea del usuario; si el historial no tiene ninguna, al final.
    let at = kept.length;
    for (let i = kept.length - 1; i >= 0; i--) {
      if (kept[i].startsWith(`${U}: `)) {
        at = i;
        break;
      }
    }
    kept.splice(at, 0, topic);
  }

  const prompt = head + '\n' + kept.join('\n') + post + cue + (prefill ? ' ' + FORMAT_PREFILL : '');
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
 * @param {string} [loreBlock] Bloque estable de la CABECERA: los recuerdos "siempre presentes" (ver api/lorebook.js).
 * @param {string} [topicBlock] MEM-004: bloque "por tema". Se antepone al contenido del ÚLTIMO mensaje del usuario
 *   en la copia que se envía (no se asume que la plantilla del modelo admita mensajes `system` intercalados);
 *   los mensajes guardados no se tocan. Ver `buildPlainPrompt`.
 * @param {string} [varietyNote] FMT-004: nota de variedad; va junto al bloque "por tema". Ver `buildPlainPrompt`.
 * @param {boolean} [prefill] FMT-002: si es true, se añade al final un mensaje `assistant` con `FORMAT_PREFILL`
 *   (la respuesta arranca dentro de una acción). Solo en la copia enviada; los mensajes guardados no se tocan.
 * @param {{ continuity?: string }} [extras] MEM-007: ver `buildPlainPrompt`. Va junto al bloque "por tema", en el último
 *   mensaje del usuario de la copia enviada.
 * @returns {{ messages: {role:'system'|'user'|'assistant', content:string}[], stop: string[] }}
 */
export function buildChatMessages(card, messages, settings, chatScenario = '', loreBlock = '', topicBlock = '', varietyNote = '', prefill = false, extras = {}) {
  const N = card.name;
  const U = (settings && settings.user) || 'User';

  let head = headBlock(card, settings, chatScenario, loreBlock, extras && extras.relationship);
  if (card.post_history_instructions) {
    head += '\n\n' + subMacros(card.post_history_instructions, N, U);
  }

  const continuity = formatContinuityBlock(extras && extras.continuity);
  const topic = endBlock(topicBlock, varietyNote, continuity);
  const budget = historyBudgetChars(settings, head.length, topic.length + continuityPadding(continuity));
  const kept = stableFront(pickHistory(messages, budget, (m) => m.text.length), messages.length);

  const out = [{ role: 'system', content: head }];
  // Muchas plantillas exigen que el primer turno sea 'user'.
  if (!kept.length || kept[0].role !== 'user') {
    out.push({ role: 'user', content: '[Start of roleplay]' });
  }
  kept.forEach((m) => out.push({ role: m.role === 'user' ? 'user' : 'assistant', content: m.text }));
  if (topic) {
    // Copia enviada: el bloque va al principio del contenido del último mensaje del usuario.
    for (let i = out.length - 1; i > 0; i--) {
      if (out[i].role === 'user') {
        out[i] = { ...out[i], content: `${topic}\n\n${out[i].content}` };
        break;
      }
    }
  }

  if (prefill) out.push({ role: 'assistant', content: FORMAT_PREFILL });

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
 * @param {string} [loreBlock] Bloque estable de la cabecera ("siempre presentes").
 * @param {number} [topicReserveChars] MEM-004: caracteres que se reservan para el bloque "por tema" (va al final del prompt).
 * @param {{ continuity?: string, relationship?: string }} [extras] MEM-007: el resumen de continuidad (va al final) también ocupa contexto. MEM-008: `relationship` (nivel) suma la línea de la cabecera.
 * @returns {{ approxTokens: number, budgetTokens: number, ratio: number }}
 *   `ratio` es approxTokens/budgetTokens, sin recortar a 1 (puede superar 1
 *   si ya no entra todo el historial y algunos mensajes se recortarían).
 */
export function estimateContextUsage(card, messages, settings, chatScenario = '', loreBlock = '', topicReserveChars = 0, extras = {}) {
  const ctx = (settings && settings.ctx) || 4096;
  const maxLen = (settings && settings.maxLen) || 220;
  const head = headBlock(card, settings, chatScenario, loreBlock, extras && extras.relationship);
  const historyChars = messages.reduce((sum, m) => sum + String(m.text || '').length + LINE_OVERHEAD, 0);
  const approxTokens = Math.ceil((head.length + historyChars + Math.max(0, topicReserveChars || 0) + continuityBlockChars(extras && extras.continuity)) / CHARS_PER_TOKEN);
  const budgetTokens = Math.max(1, ctx - maxLen);
  return { approxTokens, budgetTokens, ratio: approxTokens / budgetTokens };
}

/**
 * MEM-007: índice del PRIMER mensaje que entraría en el historial enviado (los anteriores quedan fuera de la
 * ventana). Usa la misma cuenta que `buildPlainPrompt`/`buildChatMessages` (mismo presupuesto, mismo `pickHistory`),
 * según `settings.mode`. `extraChars` reserva caracteres adicionales al final: con él se pregunta "¿qué mensajes
 * caerán fuera si entran unos ~N caracteres más?" (el disparo perezoso del resumen de continuidad).
 * @param {Card} card
 * @param {Message[]} messages Historial completo.
 * @param {Settings} settings
 * @param {string} [chatScenario]
 * @param {string} [loreBlock] Bloque "siempre presentes" de la cabecera.
 * @param {number} [endChars] Caracteres del bloque final (por tema + continuidad) que se descuentan del presupuesto.
 * @param {number} [extraChars] Reserva adicional hipotética.
 * @param {string} [relationship] MEM-008: nivel de la relación (la línea de la cabecera ocupa presupuesto).
 * @returns {number} 0 si todo cabe; `messages.length - 1` como mucho (siempre queda al menos 1 mensaje).
 */
export function historyStartIndex(card, messages, settings, chatScenario = '', loreBlock = '', endChars = 0, extraChars = 0, relationship = '') {
  const N = card.name;
  const U = (settings && settings.user) || 'User';
  const end = Math.max(0, endChars || 0) + Math.max(0, extraChars || 0);
  if (settings && settings.mode === 'chat') {
    let head = headBlock(card, settings, chatScenario, loreBlock, relationship);
    if (card.post_history_instructions) head += '\n\n' + subMacros(card.post_history_instructions, N, U);
    const kept = stableFront(pickHistory(messages, historyBudgetChars(settings, head.length, end), (m) => m.text.length), messages.length);
    return messages.length - kept.length;
  }
  const head = headBlock(card, settings, chatScenario, loreBlock, relationship) + '\n\n[Start of chat]';
  const post = card.post_history_instructions ? `\n[${subMacros(card.post_history_instructions, N, U)}]` : '';
  const cue = `\n${N}:`;
  const lines = messages.map((m) => `${m.role === 'user' ? U : N}: ${m.text}`);
  const kept = pickHistory(lines, historyBudgetChars(settings, head.length, post.length, cue.length, end), (line) => line.length);
  return messages.length - kept.length;
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
