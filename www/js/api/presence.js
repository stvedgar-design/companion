// www/js/api/presence.js — HUM-001: "presencia" del personaje. Puro y SIN modelo (cero latencia): todo sale de la hora, de lo que el usuario
// acaba de escribir y de cuánto hace que no hablan. Cuatro piezas que se suman en UNA nota corta al FINAL del prompt (nunca en la cabecera:
// cambia en cada turno y en la cabecera invalidaría la caché de prompt del servidor, ver docs/HISTORIAL.md, "MEM-004"):
//   1. Ánimo persistente (`computeMood`): tranquilo, juguetón, cariñoso, cansado, melancólico, animado. Sube y baja con la hora, con un
//      "día" propio de cada personaje (los días no son iguales), con lo que el usuario escribe y con la ausencia; tiene inercia (no cambia
//      de golpe) y se desvanece hacia lo que toque por hora si pasan horas sin hablar.
//   2. Ritmo (`pickRhythm`): a veces una frase, a veces un párrafo más lleno — SIEMPRE un solo párrafo (decisión del usuario: nada de párrafos
//      enormes). Se adapta al largo del mensaje del usuario y evita repetir el largo de la respuesta anterior.
//   3. Observaciones (`observations`): que el personaje note la ausencia ("volviste después de 3 días"), que ya venía pensando en algo que se
//      dijo, que los mensajes de hoy son más cortos, que es muy tarde. Con probabilidades, para que no lo comente siempre.
//   4. Gestos de vida (`planSplit`, `typingHoldMs`): a veces la respuesta llega partida en dos mensajes y empieza con una pausa de "escribiendo".
// El texto que viaja al modelo va en inglés (el idioma de la conversación, principio 4 de docs/NOTES.md), redactado en positivo (qué SÍ hace) y
// sin pronombres (solo nombres), así sirve igual con cualquier género. La etiqueta que ve el usuario va en español y SIN género: "ánimo tranquilo".

import { dayPart } from './timeofday.js';

/** Nota máxima (sin corchetes). La reserva fija en el presupuesto del historial vive en prompt.js (`PRESENCE_RESERVE_CHARS`; mismo motivo que la hora). */
export const PRESENCE_NOTE_MAX = 430;

/** Probabilidad de que una respuesta larga llegue partida en dos mensajes. */
export const SPLIT_CHANCE = 0.12;

export const MOODS = [
  { id: 'calm', label: 'tranquilo', prompt: 'calm and at ease' },
  { id: 'playful', label: 'juguetón', prompt: 'playful and teasing' },
  { id: 'cozy', label: 'cariñoso', prompt: 'warm and affectionate' },
  { id: 'tired', label: 'cansado', prompt: 'tired and low on energy' },
  { id: 'wistful', label: 'melancólico', prompt: 'a little wistful and thoughtful' },
  { id: 'lively', label: 'alegre', prompt: 'bright and energetic' },
];
const MOOD_IDS = MOODS.map((m) => m.id);

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;

/**
 * Valida `Character.mood`. Sin forma válida = sin ánimo guardado (`id: ''`): un personaje anterior a este cambio carga así y se calcula solo
 * a partir de la hora. Pura.
 * @param {unknown} raw
 * @returns {{ id: string, updated: number }}
 */
export function sanitizeMood(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const id = typeof src.id === 'string' && MOOD_IDS.includes(src.id) ? src.id : '';
  const updated = Number.isFinite(src.updated) && src.updated > 0 ? src.updated : 0;
  return id ? { id, updated } : { id: '', updated: 0 };
}

/** "ánimo tranquilo" (sin género: "ánimo" es el sustantivo que concuerda). '' si el id no existe. */
export function moodHeadText(id) {
  const m = MOODS.find((x) => x.id === id);
  return m ? `ánimo ${m.label}` : '';
}

// Hash simple y estable (FNV-1a) para el "día" de cada personaje.
function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function dateKey(date) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function norm(text) {
  return String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const SAD = /\b(sad|cry(ing)?|lonely|alone|stress(ed)?|anxious|worried|bad day|rough day|awful|depress\w*|hurts?|triste|llor\w*|sol[oa]|estres\w*|ansios\w*|preocupad\w*|mal dia|horrible|duele)\b/;
const JOY = /\b(haha+|hehe+|lol|lmao|awesome|amazing|yay|excited|jaja+|jeje+|genial|increible|feliz|emocionad\w*|divertid\w*)\b|!{2,}|[😂😄😁🤣😆🎉]/u;
const AFFECTION = /\b(love you|miss you|missed you|hug|kiss|cuddle|babe|darling|te quiero|te amo|te extrano|abrazo|beso|carino|mi amor)\b|[❤💕😘🥰]/u;
const TIRED = /\b(tired|sleepy|exhausted|bedtime|cansad\w*|sueno|dormir|agotad\w*)\b/;

const HOUR_BASE = {
  'small-hours': { tired: 2, wistful: 1.5, cozy: 1 },
  morning: { calm: 1.5, lively: 1, tired: 0.3 },
  afternoon: { lively: 1.5, playful: 1, calm: 0.5 },
  night: { cozy: 1.5, calm: 1, wistful: 0.5 },
};

// Rasgos elegidos al crear el personaje (personality-tags.js): sesgan el ánimo hacia lo que le queda natural.
const TAG_BIAS = {
  playful: { playful: 1, lively: 0.5 },
  mischievous: { playful: 1 },
  cheerful: { lively: 1, playful: 0.5 },
  bold: { lively: 0.5 },
  calm: { calm: 1 },
  reserved: { calm: 0.7 },
  shy: { calm: 0.5 },
  affectionate: { cozy: 1 },
  caring: { cozy: 0.7 },
  clingy: { cozy: 1 },
  gentle: { cozy: 0.5, calm: 0.5 },
  anxious: { wistful: 0.6 },
  sarcastic: { playful: 0.5 },
  flirty: { playful: 0.7, cozy: 0.5 },
};

function add(scores, id, v) {
  scores[id] = (scores[id] || 0) + v;
}

/**
 * Calcula el ánimo del personaje. Determinista (sin azar): mismas entradas, mismo ánimo (importa para "regenerar").
 * @param {{
 *   prev?: { id?: string, updated?: number },
 *   now?: Date,
 *   characterId?: string,
 *   tags?: string[],
 *   userTexts?: string[],   // los últimos mensajes del usuario, el más reciente primero (vacío = solo hora/día/inercia)
 *   gapMs?: number,         // cuánto tardó el usuario en volver (0 = sin ausencia)
 * }} input
 * @returns {{ id: string, changed: boolean, updated: number }}
 */
export function computeMood({ prev, now = new Date(), characterId = '', tags = [], userTexts = [], gapMs = 0 } = {}) {
  const before = sanitizeMood(prev);
  const scores = {};
  for (const [id, v] of Object.entries(HOUR_BASE[dayPart(now.getHours())])) add(scores, id, v);
  for (const t of Array.isArray(tags) ? tags : []) {
    for (const [id, v] of Object.entries(TAG_BIAS[t] || {})) add(scores, id, v);
  }
  // El "día" de este personaje: dos ánimos favorecidos que cambian cada día (los días no son todos iguales).
  const day = dateKey(now);
  add(scores, MOOD_IDS[hash(`${characterId}|${day}|a`) % MOOD_IDS.length], 1.2);
  add(scores, MOOD_IDS[hash(`${characterId}|${day}|b`) % MOOD_IDS.length], 0.6);
  // Lo que el usuario escribe (el último pesa más).
  const weights = [1, 0.5, 0.3];
  userTexts.slice(0, 3).forEach((text, i) => {
    const w = weights[i];
    const n = norm(text);
    if (SAD.test(n)) { add(scores, 'wistful', 3.2 * w); add(scores, 'cozy', 0.8 * w); }
    if (JOY.test(n) || JOY.test(String(text || ''))) { add(scores, 'playful', 3 * w); add(scores, 'lively', 0.8 * w); }
    if (AFFECTION.test(n) || AFFECTION.test(String(text || ''))) add(scores, 'cozy', 3.6 * w);
    if (TIRED.test(n)) { add(scores, 'tired', 0.8 * w); add(scores, 'calm', 0.4 * w); }
  });
  if (gapMs >= 2 * DAY) { add(scores, 'wistful', 0.8); add(scores, 'cozy', 0.6); }
  // Inercia: el ánimo anterior pesa y se desvanece con las horas (vida media de 8 h).
  if (before.id) {
    const ageH = Math.max(0, (now.getTime() - before.updated) / HOUR);
    add(scores, before.id, 2 * Math.pow(0.5, ageH / 8));
  }
  let top = MOOD_IDS[0];
  for (const id of MOOD_IDS) if ((scores[id] || 0) > (scores[top] || 0)) top = id;
  // Histéresis: solo cambia si el nuevo gana con claridad.
  if (before.id && top !== before.id && (scores[top] || 0) - (scores[before.id] || 0) < 0.75) top = before.id;
  const changed = top !== before.id;
  return { id: top, changed, updated: changed ? now.getTime() : before.updated };
}

const RHYTHMS = {
  brief: 'Make this reply a single short paragraph of one or two sentences.',
  medium: 'Make this reply a single paragraph of about three or four sentences.',
  full: 'Make this reply a single, fuller paragraph of about five or six sentences, since the moment has room for it.',
};

function wordCount(text) {
  const m = String(text || '').trim().match(/\S+/g);
  return m ? m.length : 0;
}

function lengthCategory(text) {
  const n = String(text || '').length;
  if (!n) return '';
  return n < 160 ? 'brief' : n < 360 ? 'medium' : 'full';
}

function pickWeighted(weights, rnd) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  let r = rnd() * total;
  for (const [k, w] of Object.entries(weights)) {
    r -= w;
    if (r <= 0) return k;
  }
  return Object.keys(weights)[0];
}

/**
 * Elige el largo de ESTA respuesta (siempre un solo párrafo). Con mensajes cortos del usuario sale más corto; con mensajes largos, más lleno;
 * el cansancio acorta, la energía y el cariño alargan. Si saldría igual que la respuesta anterior, se vuelve a tirar una vez.
 * @param {{ userText?: string, lastCharText?: string, moodId?: string, rnd?: () => number }} input
 * @returns {{ id: 'brief'|'medium'|'full', text: string }}
 */
export function pickRhythm({ userText = '', lastCharText = '', moodId = '', rnd = Math.random } = {}) {
  const words = wordCount(userText);
  const base = words <= 4 ? { brief: 0.6, medium: 0.35, full: 0.05 } : words <= 20 ? { brief: 0.25, medium: 0.55, full: 0.2 } : { brief: 0.1, medium: 0.45, full: 0.45 };
  const w = { ...base };
  if (moodId === 'tired') w.brief *= 1.5;
  if (moodId === 'lively' || moodId === 'cozy') w.full *= 1.3;
  if (moodId === 'calm') w.medium *= 1.15;
  let id = pickWeighted(w, rnd);
  const last = lengthCategory(lastCharText);
  if (last && id === last && rnd() < 0.6) {
    const rest = { ...w };
    delete rest[id];
    id = pickWeighted(rest, rnd);
  }
  return { id, text: RHYTHMS[id] };
}

function clip(text, n) {
  const flat = String(text || '').replace(/\s+/g, ' ').replace(/^\*+|\*+$/g, '').trim();
  return flat.length > n ? flat.slice(0, n).trimEnd() + '…' : flat;
}

function awayText(gapMs) {
  const days = Math.round(gapMs / DAY);
  if (days < 7) return `${days} days`;
  const weeks = Math.round(days / 7);
  return weeks <= 1 ? 'about a week' : `about ${weeks} weeks`;
}

/**
 * Cosas que el personaje puede notar, en inglés y en positivo, de mayor a menor prioridad. Cada una lleva su probabilidad, salvo la ausencia.
 * @param {{
 *   messages: Array<{ role: string, text?: string, ts?: number }>,  // el historial, terminado en el mensaje nuevo del usuario
 *   now?: Date, userName?: string, charName?: string,
 *   lorebook?: Array<{ content?: string }>,
 *   rnd?: () => number,
 * }} input
 * @returns {string[]}
 */
export function observations({ messages = [], now = new Date(), userName = 'User', charName = 'Character', lorebook = [], rnd = Math.random } = {}) {
  const U = userName;
  const N = charName;
  const out = [];
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  if (lastUserIdx < 0) return out;
  const last = messages[lastUserIdx];
  const before = lastUserIdx > 0 ? messages[lastUserIdx - 1] : null;
  // Entre el mensaje anterior y el nuevo del usuario (no contra el reloj: así "regenerar" da la misma lectura).
  const gapMs = before && Number.isFinite(before.ts) && Number.isFinite(last.ts) ? Math.max(0, last.ts - before.ts) : 0;

  if (gapMs >= 2 * DAY) out.push(`${U} is back after ${awayText(gapMs)} away; ${N} noticed the time and can say so warmly.`);

  if (gapMs >= 4 * HOUR && rnd() < 0.6) {
    const candidates = [];
    const memories = (Array.isArray(lorebook) ? lorebook : []).map((e) => clip(e && e.content, 110)).filter(Boolean);
    if (memories.length) candidates.push(memories[Math.floor(rnd() * memories.length)]);
    for (let i = lastUserIdx - 1; i >= 0; i--) {
      if (messages[i].role === 'user' && wordCount(messages[i].text) >= 4) { candidates.push(clip(messages[i].text, 110)); break; }
    }
    if (candidates.length) {
      const pick = candidates[Math.floor(rnd() * candidates.length)];
      out.push(`While ${U} was away, ${N} kept thinking about this: "${pick}". ${N} may bring it up naturally, once.`);
    }
  }

  const userMsgs = messages.slice(0, lastUserIdx + 1).filter((m) => m.role === 'user').map((m) => wordCount(m.text));
  if (userMsgs.length >= 7) {
    const prior = userMsgs.slice(-9, -2);
    const avg = prior.reduce((a, b) => a + b, 0) / prior.length;
    const recent = (userMsgs[userMsgs.length - 1] + userMsgs[userMsgs.length - 2]) / 2;
    if (avg >= 7 && recent < avg * 0.45 && rnd() < 0.4) {
      out.push(`${U}'s messages are shorter than usual today; ${N} may notice and check in gently.`);
    }
  }

  if (dayPart(now.getHours()) === 'small-hours' && rnd() < 0.35) out.push(`${U} is up very late; ${N} may mention it.`);
  return out;
}

/**
 * Arma la nota de presencia de ESTA respuesta y el ánimo resultante (para guardarlo si cambió).
 * @param {{
 *   character: { id?: string, name: string, lorebook?: object[], mood?: object, personalityTags?: string[] },
 *   messages: Array<{ role: string, text?: string, ts?: number }>,
 *   settings: { user?: string },
 *   now?: Date,
 *   rnd?: () => number,
 * }} input
 * @returns {{ note: string, mood: { id: string, changed: boolean, updated: number } }}
 */
export function buildPresence({ character, messages = [], settings = {}, now = new Date(), rnd = Math.random } = {}) {
  const N = (character && character.name) || 'Character';
  const U = (settings && settings.user) || 'User';
  const userTexts = [];
  for (let i = messages.length - 1; i >= 0 && userTexts.length < 3; i--) {
    if (messages[i] && messages[i].role === 'user') userTexts.push(String(messages[i].text || ''));
  }
  let lastUserIdx = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === 'user') { lastUserIdx = i; break; }
  }
  const lastUser = lastUserIdx >= 0 ? messages[lastUserIdx] : null;
  const before = lastUserIdx > 0 ? messages[lastUserIdx - 1] : null;
  const gapMs = lastUser && before && Number.isFinite(before.ts) && Number.isFinite(lastUser.ts) ? Math.max(0, lastUser.ts - before.ts) : 0;

  const mood = computeMood({ prev: character && character.mood, now, characterId: (character && character.id) || N, tags: character && character.personalityTags, userTexts, gapMs });
  const moodDef = MOODS.find((m) => m.id === mood.id);
  const lastChar = [...messages].reverse().find((m) => m && m.role === 'char' && m.text);
  const rhythm = pickRhythm({ userText: userTexts[0] || '', lastCharText: lastChar ? lastChar.text : '', moodId: mood.id, rnd });

  const head = `${N} feels ${moodDef.prompt} right now.`;
  const parts = [head];
  const obs = observations({ messages, now, userName: U, charName: N, lorebook: character && character.lorebook, rnd });
  let used = head.length + rhythm.text.length + 2;
  for (const o of obs) {
    if (used + o.length + 1 > PRESENCE_NOTE_MAX) continue;
    parts.push(o);
    used += o.length + 1;
  }
  parts.push(rhythm.text);
  return { note: parts.join(' '), mood };
}

/**
 * ¿Se parte esta respuesta en dos mensajes? Solo si es larga, con probabilidad `SPLIT_CHANCE`, y por un límite de oración donde los asteriscos
 * (acciones) y las comillas quedan balanceados en cada mitad. Devuelve las dos mitades o null.
 * @param {string} text
 * @param {() => number} [rnd]
 * @returns {[string, string]|null}
 */
export function planSplit(text, rnd = Math.random) {
  const t = String(text || '').trim();
  if (t.length < 150) return null;
  if (rnd() >= SPLIT_CHANCE) return null;
  const count = (s, ch) => s.split(ch).length - 1;
  if (count(t, '*') % 2 !== 0) return null;
  let best = null;
  const re = /[.!?…]+["”')\]*]*\s+(?=\S)/g;
  let m;
  while ((m = re.exec(t))) {
    const cut = m.index + m[0].trimEnd().length;
    const a = t.slice(0, cut).trim();
    const b = t.slice(cut).trim();
    if (a.length < 50 || b.length < 50) continue;
    if (count(a, '*') % 2 !== 0 || count(a, '"') % 2 !== 0) continue;
    const dist = Math.abs(a.length - t.length / 2);
    if (!best || dist < best.dist) best = { a, b, dist };
  }
  return best ? [best.a, best.b] : null;
}

/** Pausa mínima de "escribiendo…" antes de mostrar la respuesta, en ms (más larga si el personaje está cansado). */
export function typingHoldMs(rnd = Math.random, moodId = '') {
  return Math.round(500 + rnd() * 1100 + (moodId === 'tired' ? 350 : 0));
}
