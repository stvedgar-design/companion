// www/js/api/kobold.js — Módulo 04 "Motor".
// Único lugar de la app con `fetch`. Habla con un servidor KoboldCpp del
// usuario (URL propia, típicamente por Tailscale) para conectar y generar
// respuestas en streaming. No guarda nada en localStorage/IndexedDB.

import { buildPlainPrompt, buildChatMessages, cleanReply, trimPartial } from './prompt.js';
import { buildLoreBlocks } from './lorebook.js';
import { VARIETY_NOTE, varietyNeeded } from './variety.js';

const TOP_P = 0.92;
const TOP_K = 0;
const MIN_P = 0.05;
const REP_PEN = 1.08;
const REP_PEN_RANGE = 320;

const CONNECT_NETWORK_MSG =
  'No se pudo conectar. Revisa que Tailscale esté activo y que la URL lleve el puerto, por ejemplo http://100.x.x.x:5001';
const STREAM_NETWORK_MSG = 'Se perdió la conexión con el servidor. ¿Sigue activo Tailscale?';
const INVALID_URL_MSG = 'La URL no es válida. Ejemplo: http://100.x.x.x:5001';
const MIXED_CONTENT_MSG =
  'Esta página está en https y tu servidor en http; el navegador bloquea la conexión. Abre la app desde http.';
const SERVER_MSG = 'El servidor devolvió una respuesta inesperada.';

// Códigos que esta capa puede lanzar. Sirve para distinguir "ya es uno de
// nuestros errores clasificados" de un fallo crudo de fetch/undici, que
// también puede traer su propio `.code` (p. ej. ECONNREFUSED).
const KNOWN_CODES = new Set(['INVALID_URL', 'NETWORK', 'MIXED_CONTENT', 'HTTP', 'SERVER']);

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

function isMixedContent(base) {
  return typeof location !== 'undefined' && location.protocol === 'https:' && /^http:/i.test(base);
}

/**
 * Normaliza una URL: añade http:// si falta y devuelve solo el origen
 * (sin ruta, hash ni barra final). Devuelve '' si es inválida.
 * @param {string} raw
 * @returns {string}
 */
export function normUrl(raw) {
  let u = String(raw == null ? '' : raw).trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'http://' + u;
  try {
    return new URL(u).origin;
  } catch {
    return '';
  }
}

// `externalSignal` (opcional): cancelación pedida por quien llama, además del
// timeout propio.
async function fetchWithTimeout(url, opts, ms, externalSignal) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  const relay = () => ctrl.abort();
  if (externalSignal) {
    if (externalSignal.aborted) ctrl.abort();
    else externalSignal.addEventListener('abort', relay, { once: true });
  }
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', relay);
  }
}

// Le pide al servidor que corte una generación en curso. Medido contra el
// KoboldCpp real (docs/NOTES.md, Paso 0 de MEM-001 v2): cerrar la conexión
// del cliente NO detiene la generación del servidor, pero POST /api/extra/abort
// con el `genkey` de la petición sí. Mejor esfuerzo: nunca lanza.
function notifyServerAbort(base, genkey) {
  if (!genkey) return;
  fetch(base + '/api/extra/abort', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ genkey })
  }).catch(() => {});
}

/**
 * Prueba la conexión con un servidor KoboldCpp. No guarda nada: quien
 * llama decide qué hacer con el resultado.
 * @param {string} rawUrl
 * @returns {Promise<{ url: string, model: string, ctx: number }>}
 */
export async function connect(rawUrl) {
  const base = normUrl(rawUrl);
  if (!base) throw makeError(INVALID_URL_MSG, 'INVALID_URL');

  let res;
  try {
    res = await fetchWithTimeout(base + '/api/v1/model', {}, 6000);
  } catch {
    if (isMixedContent(base)) throw makeError(MIXED_CONTENT_MSG, 'MIXED_CONTENT');
    throw makeError(CONNECT_NETWORK_MSG, 'NETWORK');
  }
  if (!res.ok) {
    throw makeError(`El servidor respondió ${res.status}. ¿Es la URL de KoboldCpp?`, 'HTTP');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw makeError(SERVER_MSG, 'SERVER');
  }
  const model = String((data && data.result) || '').replace(/^koboldcpp\//, '');

  let ctx = 4096;
  try {
    const ctxRes = await fetchWithTimeout(base + '/api/extra/true_max_context_length', {}, 4000);
    if (ctxRes.ok) {
      const ctxData = await ctxRes.json();
      if (ctxData && typeof ctxData.value === 'number') ctx = ctxData.value;
    }
  } catch {
    // Opcional: si falla, se mantiene el valor por defecto.
  }

  return { url: base, model, ctx };
}

// Timeout generoso para completeOnce(): la extracción de lorebook (ver
// api/lorebook.js) le pasa al modelo bastante más texto que una respuesta
// normal de chat, y corre en segundo plano sin que el usuario esté
// esperando, así que preferimos tolerancia a un modelo local lento antes
// que cortar la llamada de más.
const COMPLETE_ONCE_TIMEOUT_MS = 120000;

/**
 * Completado de una sola vez, sin streaming, contra `/api/v1/generate`.
 * A diferencia de `generateReply()` (pensada para roleplay en streaming con
 * callbacks de UI), esta función recibe un prompt de texto ya armado por
 * quien llama y devuelve el texto completo cuando termina. La usa el
 * lorebook automático (ver api/lorebook.js) para su llamada de extracción,
 * con una temperatura baja propia, independiente de `settings.temp`.
 * @param {string} prompt
 * @param {import('../state.js').Settings} settings
 * @param {{ temp?: number, maxLen?: number, signal?: AbortSignal, genkey?: string }} [opts]
 *   `signal` cancela la llamada (lanza un error con `code: 'ABORTED'` y, si
 *   hay `genkey`, le pide al servidor que corte la generación); `genkey` se
 *   envía al servidor para poder cancelarla con /api/extra/abort.
 * @returns {Promise<string>}
 */
export async function completeOnce(prompt, settings, opts = {}) {
  const base = normUrl(settings && settings.url);
  if (!base) throw makeError(INVALID_URL_MSG, 'INVALID_URL');

  const signal = opts.signal;
  const aborted = () => !!(signal && signal.aborted);
  if (aborted()) throw makeError('Cancelado.', 'ABORTED');

  const body = {
    prompt,
    max_context_length: settings.ctx,
    max_length: opts.maxLen || settings.maxLen,
    temperature: typeof opts.temp === 'number' ? opts.temp : settings.temp,
    top_p: TOP_P,
    top_k: TOP_K,
    min_p: MIN_P,
    rep_pen: REP_PEN,
    rep_pen_range: REP_PEN_RANGE
  };
  if (opts.genkey) body.genkey = opts.genkey;

  let res;
  try {
    res = await fetchWithTimeout(
      base + '/api/v1/generate',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      },
      COMPLETE_ONCE_TIMEOUT_MS,
      signal
    );
  } catch {
    // Cancelación del llamador o timeout: el servidor seguiría generando.
    notifyServerAbort(base, opts.genkey);
    if (aborted()) throw makeError('Cancelado.', 'ABORTED');
    throw makeError(STREAM_NETWORK_MSG, 'NETWORK');
  }
  if (!res.ok) {
    throw makeError(`El servidor respondió ${res.status}. ¿Es la URL de KoboldCpp?`, 'HTTP');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    if (aborted()) throw makeError('Cancelado.', 'ABORTED');
    throw makeError(SERVER_MSG, 'SERVER');
  }
  const text = data && data.results && data.results[0] && data.results[0].text;
  if (typeof text !== 'string') throw makeError(SERVER_MSG, 'SERVER');
  return text;
}

// Lector de Server-Sent Events propio: tolera líneas partidas entre trozos
// de red, líneas `event:` o vacías, y el marcador [DONE].
async function readSSE(response, onEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      let obj;
      try {
        obj = JSON.parse(data);
      } catch {
        continue;
      }
      onEvent(obj);
    }
  }
}

function canStream(res) {
  return !!res.body && typeof res.body.getReader === 'function';
}

// Respaldo sin streaming: usa el endpoint nativo de generación de una sola
// vez, con el prompt en formato de texto simple (es el único formato que
// acepta este endpoint). Entrega el texto completo a `emit` de un tirón.
async function nonStreamingGenerate(base, card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote, signal, emit) {
  const { prompt } = buildPlainPrompt(card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote);
  const res = await fetch(base + '/api/v1/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    signal,
    body: JSON.stringify({
      prompt,
      max_context_length: settings.ctx,
      max_length: settings.maxLen,
      temperature: settings.temp,
      top_p: TOP_P,
      top_k: TOP_K,
      min_p: MIN_P,
      rep_pen: REP_PEN,
      rep_pen_range: REP_PEN_RANGE
    })
  });
  if (!res.ok) {
    throw makeError(`El servidor respondió ${res.status}. ¿Es la URL de KoboldCpp?`, 'HTTP');
  }
  let data;
  try {
    data = await res.json();
  } catch {
    throw makeError(SERVER_MSG, 'SERVER');
  }
  const text = data && data.results && data.results[0] && data.results[0].text;
  if (typeof text !== 'string') throw makeError(SERVER_MSG, 'SERVER');
  emit(text);
}

function makeGenKey() {
  return 'CMP' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/**
 * Genera la siguiente respuesta del personaje, en streaming cuando es
 * posible. Nunca lanza por aborto: en ese caso resuelve con lo recibido
 * hasta ese momento.
 * @param {{
 *   character: import('./prompt.js').Character,
 *   chat?: import('../state.js').Chat,
 *   messages: import('./prompt.js').Message[],
 *   settings: import('./prompt.js').Settings,
 *   signal?: AbortSignal,
 *   onToken?: (chunk: string) => void
 * }} opts
 * @returns {Promise<{ text: string, truncated: boolean, aborted: boolean }>}
 */
export async function generateReply({ character, chat, messages, settings, signal, onToken }) {
  const base = normUrl(settings && settings.url);
  if (!base) throw makeError(INVALID_URL_MSG, 'INVALID_URL');

  const card = character.card;
  const chatScenario = (chat && chat.scenario) || '';
  // Lorebook automático (docs/NOTES.md, "Lorebook por personaje"): es del
  // personaje, no del chat — compartido entre todos sus chats. Solo se
  // inyectan las entradas que matchearon por keyword contra los últimos
  // mensajes, dentro de un tope de caracteres — nunca el lorebook entero.
  // MEM-004: dos bloques. `loreBlock` = recuerdos "siempre presentes" (estable, va en la
  // cabecera); `topicBlock` = los "por tema" (varía turno a turno, va al FINAL del prompt
  // para no invalidar la caché de prompt del servidor: ver docs/HISTORIAL.md, "MEM-004").
  const { always: loreBlock, topic: topicBlock } = buildLoreBlocks((character && character.lorebook) || [], messages);
  // FMT-004: con `varietyAssist` activo, si el último turno del personaje ya repitió las palabras de sus
  // turnos anteriores, la respuesta siguiente lleva al FINAL una nota breve de variedad (mismo sitio que el
  // bloque por tema: no invalida la caché del servidor).
  const varietyNote =
    settings.varietyAssist === true && varietyNeeded(messages, [card.name, settings.user]) ? VARIETY_NOTE : '';
  const genkey = makeGenKey();
  const mode = settings.mode === 'chat' ? 'chat' : 'plain';
  const maxLen = settings.maxLen || 220;

  let fullText = '';
  let tokenCount = 0;
  let usedFallback = false;
  const emit = (chunk) => {
    if (!chunk) return;
    fullText += chunk;
    tokenCount++;
    if (onToken) onToken(chunk);
  };

  const notifyAbort = () => {
    fetch(base + '/api/extra/abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ genkey })
    }).catch(() => {});
  };

  try {
    let res;
    if (mode === 'chat') {
      const { messages: chatMessages, stop } = buildChatMessages(card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote);
      res = await fetch(base + '/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          messages: chatMessages,
          max_tokens: maxLen,
          temperature: settings.temp,
          top_p: TOP_P,
          stream: true,
          stop
        })
      });
    } else {
      const { prompt, stop } = buildPlainPrompt(card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote);
      res = await fetch(base + '/api/extra/generate/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal,
        body: JSON.stringify({
          prompt,
          max_context_length: settings.ctx,
          max_length: maxLen,
          temperature: settings.temp,
          top_p: TOP_P,
          top_k: TOP_K,
          min_p: MIN_P,
          rep_pen: REP_PEN,
          rep_pen_range: REP_PEN_RANGE,
          stop_sequence: stop,
          genkey,
          quiet: true
        })
      });
    }

    if (res.status === 404) {
      usedFallback = true;
      await nonStreamingGenerate(base, card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote, signal, emit);
    } else if (!res.ok) {
      throw makeError(`El servidor respondió ${res.status}. ¿Es la URL de KoboldCpp?`, 'HTTP');
    } else if (!canStream(res)) {
      usedFallback = true;
      await nonStreamingGenerate(base, card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote, signal, emit);
    } else if (mode === 'chat') {
      await readSSE(res, (obj) => {
        const chunk = obj && obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
        if (chunk) emit(chunk);
      });
    } else {
      await readSSE(res, (obj) => {
        if (obj && obj.token) emit(obj.token);
      });
    }
  } catch (err) {
    const wasAborted = (signal && signal.aborted) || (err && err.name === 'AbortError');
    if (wasAborted) {
      notifyAbort();
      return { text: cleanReply(fullText, card.name), truncated: false, aborted: true };
    }
    if (err && KNOWN_CODES.has(err.code)) throw err;
    // Fallo de red genérico: fetch rechazado, o el stream se cortó a mitad
    // de camino. Si ya había texto recibido, no se pierde.
    if (fullText) {
      return { text: trimPartial(cleanReply(fullText, card.name)), truncated: true, aborted: false };
    }
    throw makeError(STREAM_NETWORK_MSG, 'NETWORK');
  }

  let text = cleanReply(fullText, card.name);
  let truncated = false;
  // El respaldo sin streaming entrega el texto de una vez: no hay conteo
  // de eventos con el que detectar un corte por longitud.
  if (!usedFallback && tokenCount >= maxLen - 2) {
    text = trimPartial(text);
    truncated = true;
  }
  return { text, truncated, aborted: false };
}

/**
 * Como `generateReply()`, pero si el texto final queda vacío (p. ej. el modelo
 * empezó con un salto de línea y el servidor cortó ahí) reintenta UNA vez, en
 * silencio. Mientras el texto recibido sea solo espacios no se le pasa nada a
 * `onToken`, así el usuario no ve texto a medias que desaparezca. Un aborto no
 * se reintenta; los errores se propagan tal cual. Si el reintento también sale
 * vacío, devuelve ese resultado vacío y quien llama decide (chat.js avisa y deja
 * el botón "Reintentar respuesta").
 * @param {Parameters<typeof generateReply>[0]} opts
 * @param {typeof generateReply} [generate] Inyectable para tests.
 * @returns {Promise<{ text: string, truncated: boolean, aborted: boolean }>}
 */
export async function generateReplyNonEmpty(opts, generate = generateReply) {
  const attempt = () => {
    let held = '';
    let released = false;
    const onToken = opts.onToken
      ? (chunk) => {
          if (released) return opts.onToken(chunk);
          held += chunk;
          if (held.trim()) {
            released = true;
            opts.onToken(held);
          }
        }
      : undefined;
    return generate({ ...opts, onToken });
  };

  const first = await attempt();
  if (first.aborted || first.text.trim()) return first;
  if (opts.signal && opts.signal.aborted) return first;
  return attempt();
}
