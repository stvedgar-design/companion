// www/js/api/moments.js — HUM-003 (b): detector SIN modelo de recuerdos de MOMENTOS. Cuando el último mensaje del usuario es un pico emocional claro
// (api/emotion.js: una emoción intensa y algo que contar), propone un recuerdo del momento — «Edgar estaba triste y le dijo a Luna: "…"» — que se guarda en
// segundo plano en el MISMO lorebook del personaje (campo `kind:'moment'` con un `tone` de lista cerrada y la fecha `at`), así que hereda todas sus defensas:
// lápidas, archivado, tope de entradas, edición y la pantalla «Memoria de {Nombre}».
//
// Por qué sin modelo: la extracción con modelo (api/lorebook.js, "(a)") solo corre al pedir «Actualizar memoria ahora» (o con la automática, apagada por
// defecto), y un recuerdo de momento que dependiera de eso casi nunca nacería. Este detector cuesta cero llamadas y cero latencia; cuando la extracción con
// modelo corre sobre una ventana con un pico, ella REEMPLAZA la plantilla por una frase mejor (ver `applyExtraction`, ventana `MOMENT_SAME_WINDOW_MS`).
//
// Fundamento por construcción: el texto es una plantilla en tercera persona (con los dos nombres) más una CITA literal del mensaje del usuario, así que nada
// de lo guardado está fuera de los mensajes (MEM-013) y no lleva pronombres fuera de la cita (MEM-005).
//
// Límites: como mucho un momento automático cada `MOMENT_MIN_GAP_MS` por personaje (una charla triste larga no llena el lorebook), y `MOMENT_MAX` momentos
// en total (sale el automático más antiguo). Azar no hay: mismas entradas, mismo resultado.

import { emotionPeak } from './emotion.js';
import { EMOTION_TO_TONE, isMoment, momentToneKeys } from './moment-tones.js';
import { normalizeLoreKeys, isTombstoned, MOMENT_MAX, LOREBOOK_MAX_ENTRIES, LOREBOOK_MAX_ENTRY_CHARS } from './lorebook.js';

/** Entre dos momentos AUTOMÁTICOS del mismo personaje deben pasar al menos 6 h. */
export const MOMENT_MIN_GAP_MS = 6 * 60 * 60 * 1000;
/** Largo máximo de la cita del usuario dentro del recuerdo. */
export const MOMENT_QUOTE_MAX = 120;

const FRAMES = {
  sadness: (U, N, q) => `${U} was feeling sad and told ${N}: "${q}"`,
  anxiety: (U, N, q) => `${U} was feeling stressed and told ${N}: "${q}"`,
  frustration: (U, N, q) => `${U} was feeling frustrated and told ${N}: "${q}"`,
  joy: (U, N, q) => `${U} was feeling happy and told ${N}: "${q}"`,
  pride: (U, N, q) => `${U} felt proud and shared with ${N}: "${q}"`,
  unease: (U, N, q) => `${U} was feeling scared and told ${N}: "${q}"`,
  tenderness: (U, N, q) => `${U} was feeling tender and told ${N}: "${q}"`,
};

/** La cita: el mensaje sin asteriscos ni saltos, comillas dobles → simples, cortado en una palabra entera. */
export function momentQuote(text, max = MOMENT_QUOTE_MAX) {
  const flat = String(text || '').replace(/\*/g, '').replace(/["“”]/g, "'").replace(/\s+/g, ' ').trim();
  if (flat.length <= max) return flat;
  const cut = flat.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.5 ? cut.slice(0, lastSpace) : cut).replace(/[\s,.;:!?¿¡-]+$/, '') + '…';
}

/**
 * ¿Hay un momento para guardar a raíz del ÚLTIMO mensaje del usuario? Devuelve el candidato o null. Pura.
 * @param {{
 *   messages: { role?: string, text?: string, ts?: number }[],   // el historial, con el mensaje del usuario ya incluido
 *   character: { name?: string, card?: { name?: string }, lorebook?: object[], lorebookTombstones?: object[] },
 *   settings: { user?: string, momentMemories?: boolean },
 *   now?: number,
 * }} input
 * @returns {{ content: string, keys: string[], tone: string, at: number, emotion: string }|null}
 */
export function momentCandidate({ messages, character, settings, now = Date.now() } = {}) {
  if (!settings || settings.momentMemories !== true || !character) return null;
  const list = Array.isArray(messages) ? messages : [];
  let last = null;
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i] && list[i].role === 'user') { last = list[i]; break; }
  }
  if (!last) return null;
  const peak = emotionPeak(last.text);
  if (!peak) return null;
  const tone = EMOTION_TO_TONE[peak.emotion];
  if (!tone) return null;
  const at = Number.isFinite(last.ts) && last.ts > 0 ? last.ts : now;

  const lorebook = Array.isArray(character.lorebook) ? character.lorebook : [];
  // Como mucho un momento AUTOMÁTICO cada MOMENT_MIN_GAP_MS (cualquier tono): y si ya hay uno del mismo tono tan cerca, es el mismo momento.
  const recentAuto = lorebook.some((e) => isMoment(e) && e.source !== 'manual' && Math.abs(at - (e.at || 0)) < MOMENT_MIN_GAP_MS);
  if (recentAuto) return null;

  const N = character.name || (character.card && character.card.name) || 'Character';
  const U = settings.user || 'User';
  const quote = momentQuote(last.text);
  if (!quote) return null;
  const content = FRAMES[tone](U, N, quote).slice(0, LOREBOOK_MAX_ENTRY_CHARS);

  // Keys: hasta 2 palabras del tema (de la cita, las más largas) + las del tono en los dos idiomas (la emoción vuelve a surgir: «triste»).
  const topic = normalizeLoreKeys([quote], '', { names: [N, U] })
    .sort((a, b) => b.length - a.length)
    .slice(0, 2);
  const keys = [...new Set([...topic, ...momentToneKeys(tone)])].slice(0, 4);
  if (!keys.length) return null;
  if (isTombstoned(content, keys, character.lorebookTombstones, [N, U])) return null;
  return { content, keys, tone, at, emotion: peak.emotion };
}

/**
 * El lorebook con el momento añadido, o null si no hay nada que guardar (ya había uno cercano, o no cabe sin quitar algo manual). Respeta `MOMENT_MAX` y
 * `LOREBOOK_MAX_ENTRIES`: primero sale el momento automático más antiguo, luego el hecho automático más antiguo. Nunca toca lo manual. Pura (no muta).
 * @param {object[]} entries
 * @param {{ content: string, keys: string[], tone: string, at: number }} candidate
 * @param {number} [now]
 * @param {() => string} [makeId]
 * @returns {object[]|null}
 */
export function withMoment(entries, candidate, now = Date.now(), makeId = () => 'l' + now.toString(36) + Math.random().toString(36).slice(2, 8)) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === 'object');
  if (!candidate || !candidate.content) return null;
  if (list.some((e) => isMoment(e) && e.source !== 'manual' && Math.abs(candidate.at - (e.at || 0)) < MOMENT_MIN_GAP_MS)) return null; // relectura bajo el candado
  if (list.some((e) => e.content === candidate.content)) return null;
  const out = list.slice();
  const evict = (pred) => {
    const victim = out.filter(pred).sort((a, b) => (a.kind === 'moment' ? a.at || 0 : a.updated || 0) - (b.kind === 'moment' ? b.at || 0 : b.updated || 0))[0];
    if (!victim) return false;
    out.splice(out.indexOf(victim), 1);
    return true;
  };
  while (out.filter(isMoment).length >= MOMENT_MAX) {
    if (!evict((e) => isMoment(e) && e.source !== 'manual')) return null;
  }
  while (out.length >= LOREBOOK_MAX_ENTRIES) {
    if (!evict((e) => e.source !== 'manual' && isMoment(e)) && !evict((e) => e.source !== 'manual')) return null;
  }
  out.push({ id: makeId(), keys: candidate.keys.slice(), content: candidate.content, updated: now, source: 'auto', kind: 'moment', tone: candidate.tone, at: candidate.at });
  return out;
}
