// www/js/api/kobold.js — Módulo 04 "Motor".
// Adaptado para OpenRouter: habla directamente con la API en la nube de OpenRouter
// (https://openrouter.ai/api/v1) usando el API Key del usuario.
// No guarda nada en localStorage/IndexedDB.

import { buildPlainPrompt, buildChatMessages, cleanReply, trimPartial, FORMAT_PREFILL } from './prompt.js';
import { timeOfDayNote, dayPart } from './timeofday.js';
import { buildPresence } from './presence.js';
import { identityForPrompt } from './identity-synthesis.js';
import { buildLoreBlocks } from './lorebook.js';
import { relationshipForPrompt } from './relationship.js';
import { appearanceOf } from '../character-appearance.js';
import { VARIETY_NOTE, varietyNeeded } from './variety.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_FREE_MODEL = 'meta-llama/llama-3.1-8b-instruct';

const CONNECT_NETWORK_MSG =
  'No se pudo conectar con OpenRouter. Revisa tu conexión a internet y tu API Key.';
const STREAM_NETWORK_MSG = 'Se perdió la conexión con OpenRouter. Revisa tu conexión a internet.';
const INVALID_KEY_MSG = 'Se requiere un API Key de OpenRouter (comienza con sk-or-v1-...). Configúralo en Ajustes.';
const SERVER_MSG = 'OpenRouter devolvió una respuesta inesperada o error en el modelo.';

const KNOWN_CODES = new Set(['INVALID_KEY', 'INVALID_URL', 'NETWORK', 'HTTP', 'SERVER']);

function makeError(message, code) {
  const err = new Error(message);
  err.code = code;
  return err;
}

export function normUrl(raw) {
  let u = String(raw == null ? '' : raw).trim();
  if (!u) return OPENROUTER_BASE_URL;
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  return u.replace(/\/+$/, '');
}

function getAuthHeaders(apiKey) {
  const key = String(apiKey || '').trim();
  const headers = {
    'Content-Type': 'application/json',
    'HTTP-Referer': 'https://companion.app',
    'X-Title': 'Companion App'
  };
  if (key) {
    headers['Authorization'] = 'Bearer ' + key;
  }
  return headers;
}

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

/**
 * Prueba la conexión con OpenRouter usando el API Key provisto o consultando modelos.
 * @param {string|object} rawKey O URL/Key
 * @param {string} [modelChoice]
 * @returns {Promise<{ url: string, model: string, ctx: number }>}
 */
export async function connect(rawKey, modelChoice) {
  let apiKey = '';
  let customUrl = OPENROUTER_BASE_URL;

  if (typeof rawKey === 'object' && rawKey !== null) {
    apiKey = String(rawKey.apiKey || '').trim();
    if (rawKey.url && rawKey.url.trim()) customUrl = normUrl(rawKey.url);
    if (!modelChoice && rawKey.model) modelChoice = rawKey.model;
  } else {
    const s = String(rawKey || '').trim();
    if (s.startsWith('sk-or-') || s.startsWith('sk-')) {
      apiKey = s;
    } else if (s.startsWith('http')) {
      customUrl = normUrl(s);
    } else {
      apiKey = s;
    }
  }

  const endpoint = customUrl.includes('/models') ? customUrl : (customUrl + '/models');
  let res;
  try {
    res = await fetchWithTimeout(endpoint, {
      method: 'GET',
      headers: getAuthHeaders(apiKey)
    }, 10000);
  } catch (err) {
    throw makeError(CONNECT_NETWORK_MSG, 'NETWORK');
  }

  if (res.status === 401 || res.status === 403) {
    throw makeError('API Key de OpenRouter inválido o expirado. Revisa tu clave en Ajustes.', 'INVALID_KEY');
  }

  if (!res.ok) {
    throw makeError('OpenRouter respondió con error ' + res.status + '.', 'HTTP');
  }

  const targetModel = String(modelChoice || DEFAULT_FREE_MODEL).trim();
  return {
    url: customUrl,
    model: targetModel,
    ctx: 10240
  };
}

const COMPLETE_ONCE_TIMEOUT_MS = 120000;

export async function completeOnce(prompt, settings, opts = {}) {
  const messages = [{ role: 'user', content: prompt }];
  return completeChatOnce(messages, settings, opts);
}

export async function completeChatOnce(messages, settings, opts = {}) {
  const apiKey = (settings && settings.apiKey) || '';
  const model = (opts && opts.model) || (settings && settings.model) || DEFAULT_FREE_MODEL;
  const baseUrl = normUrl(settings && settings.url);

  const signal = opts.signal;
  const aborted = () => !!(signal && signal.aborted);
  if (aborted()) throw makeError('Cancelado.', 'ABORTED');

  const body = {
    model,
    messages,
    max_tokens: opts.maxLen || (settings && settings.maxLen) || 220,
    stream: false,
    stop: Array.isArray(opts.stop) ? opts.stop : ['\n']
  };
  if (typeof opts.temp === 'number') body.temperature = opts.temp;

  let res;
  try {
    res = await fetchWithTimeout(
      baseUrl + '/chat/completions',
      {
        method: 'POST',
        headers: getAuthHeaders(apiKey),
        body: JSON.stringify(body)
      },
      COMPLETE_ONCE_TIMEOUT_MS,
      signal
    );
  } catch {
    if (aborted()) throw makeError('Cancelado.', 'ABORTED');
    throw makeError(STREAM_NETWORK_MSG, 'NETWORK');
  }

  if (res.status === 401 || res.status === 403) {
    throw makeError(INVALID_KEY_MSG, 'INVALID_KEY');
  }
  if (!res.ok) {
    throw makeError('OpenRouter respondió con error ' + res.status + '.', 'HTTP');
  }

  let data;
  try {
    data = await res.json();
  } catch {
    if (aborted()) throw makeError('Cancelado.', 'ABORTED');
    throw makeError(SERVER_MSG, 'SERVER');
  }

  const text = data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (typeof text !== 'string') throw makeError(SERVER_MSG, 'SERVER');
  return text;
}

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

export async function generateReply({ character, chat, messages, settings, signal, onToken, now = new Date(), rnd = Math.random }) {
  const apiKey = (settings && settings.apiKey) || '';
  const model = (settings && settings.model) || DEFAULT_FREE_MODEL;
  const baseUrl = normUrl(settings && settings.url);

  const card = character.card;
  const chatScenario = (chat && chat.scenario) || '';
  const { always: loreBlock, topic: topicBlock, used: loreUsed } = buildLoreBlocks((character && character.lorebook) || [], messages, { now: now.getTime() });
  const varietyNote = settings.varietyAssist === true && varietyNeeded(messages, [card.name, settings.user]) ? VARIETY_NOTE : '';
  const prefill = settings.formatAssist === true;
  const continuity = (chat && chat.continuitySummary && chat.continuitySummary.text) || '';
  const relationship = null;
  const appearance = appearanceOf(character);
  const timeOfDay = timeOfDayNote(now);
  const identity = '';
  const presence = settings.humanTouch === true ? buildPresence({ character, messages, settings, now, rnd }) : null;
  const extras = { ...(continuity ? { continuity } : {}), relationship, ...(appearance ? { appearance } : {}), ...(timeOfDay ? { timeOfDay } : {}), dayPart: dayPart(now.getHours()), ...(identity ? { identity } : {}), ...(presence ? { presence: presence.note } : {}), ...(character && character.identityCore ? { identityCore: character.identityCore } : {}) };
  const moodInfo = presence ? presence.mood : null;
  const lifeInfo = presence ? presence.life : null;
  const followUpInfo = presence ? presence.followUp : null;
  const maxLen = settings.maxLen || 220;

  let fullText = '';
  let tokenCount = 0;
  const emit = (chunk) => {
    if (!chunk) return;
    if (prefill && !fullText) {
      chunk = chunk.trimStart();
      if (!chunk) return;
      if (chunk[0] !== FORMAT_PREFILL) chunk = FORMAT_PREFILL + chunk;
    }
    fullText += chunk;
    tokenCount++;
    if (onToken) onToken(chunk);
  };

  try {
    const { messages: chatMessages, stop } = buildChatMessages(card, messages, settings, chatScenario, loreBlock, topicBlock, varietyNote, prefill, extras);
    const body = {
      model,
      messages: chatMessages,
      max_tokens: maxLen,
      stream: true,
      stop
    };
    if (typeof settings.temp === 'number') body.temperature = settings.temp;

    const res = await fetch(baseUrl + '/chat/completions', {
      method: 'POST',
      headers: getAuthHeaders(apiKey),
      signal,
      body: JSON.stringify(body)
    });

    if (res.status === 401 || res.status === 403) {
      throw makeError(INVALID_KEY_MSG, 'INVALID_KEY');
    }
    if (!res.ok) {
      let errText = '';
      try {
        const errJson = await res.json();
        errText = (errJson && errJson.error && errJson.error.message) || '';
      } catch {}
      throw makeError(errText ? ('OpenRouter: ' + errText) : ('OpenRouter respondió con error ' + res.status + '.'), 'HTTP');
    }

    if (!canStream(res)) {
      const data = await res.json();
      const txt = (data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
      emit(txt);
    } else {
      await readSSE(res, (obj) => {
        const chunk = obj && obj.choices && obj.choices[0] && obj.choices[0].delta && obj.choices[0].delta.content;
        if (chunk) emit(chunk);
      });
    }
  } catch (err) {
    const wasAborted = (signal && signal.aborted) || (err && err.name === 'AbortError');
    if (wasAborted) {
      return { text: cleanReply(fullText, card.name), truncated: false, aborted: true, loreUsed, mood: moodInfo, followUp: followUpInfo, life: lifeInfo };
    }
    if (err && KNOWN_CODES.has(err.code)) throw err;
    if (fullText) {
      return { text: trimPartial(cleanReply(fullText, card.name)), truncated: true, aborted: false, loreUsed, mood: moodInfo, followUp: followUpInfo, life: lifeInfo };
    }
    throw makeError(STREAM_NETWORK_MSG, 'NETWORK');
  }

  let text = cleanReply(fullText, card.name);
  let truncated = false;
  if (tokenCount >= maxLen - 2) {
    text = trimPartial(text);
    truncated = true;
  }
  return { text, truncated, aborted: false, loreUsed, mood: moodInfo, followUp: followUpInfo, life: lifeInfo };
}

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
