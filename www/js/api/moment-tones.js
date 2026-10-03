// www/js/api/moment-tones.js — HUM-003: datos y ayudas PURAS (sin importar nada) de los recuerdos de MOMENTOS: una entrada del lorebook con `kind: 'moment'`,
// un `tone` de una lista CERRADA (así el modelo no inventa emociones) y la fecha del momento (`at`). Vive aparte de `moments.js` para que `lorebook.js` y
// `state.js` puedan usarlo sin ciclos de importación.
//
// La lista es un subconjunto de `FEELING_WORDS` (api/feeling.js, MEM-015): mismas palabras en inglés y mismas etiquetas en español (un test lo vigila).

/** Lista cerrada: `tone` (inglés, lo que viaja al modelo y se guarda), etiqueta en español (sustantivo, sin género) y keys que la emoción suma al recuerdo. */
export const MOMENT_TONES = Object.freeze([
  { tone: 'sadness', label: 'tristeza', keys: ['sad', 'triste'] },
  { tone: 'anxiety', label: 'ansiedad', keys: ['stress', 'estrés'] },
  { tone: 'frustration', label: 'frustración', keys: ['frustrated', 'frustración'] },
  { tone: 'joy', label: 'alegría', keys: ['happy', 'feliz'] },
  { tone: 'pride', label: 'orgullo', keys: ['proud', 'orgullo'] },
  { tone: 'unease', label: 'inquietud', keys: ['scared', 'miedo'] },
  { tone: 'tenderness', label: 'ternura', keys: [] },
  { tone: 'relief', label: 'alivio', keys: [] },
  { tone: 'gratitude', label: 'gratitud', keys: [] },
  { tone: 'excitement', label: 'ilusión', keys: [] },
  { tone: 'loneliness', label: 'soledad', keys: [] },
  { tone: 'hope', label: 'esperanza', keys: [] },
]);

export const MOMENT_TONE_IDS = Object.freeze(MOMENT_TONES.map((t) => t.tone));

/** Emoción del usuario (api/emotion.js) → tono del momento. El cansancio no genera momentos. */
export const EMOTION_TO_TONE = Object.freeze({
  sad: 'sadness', stressed: 'anxiety', angry: 'frustration', happy: 'joy', proud: 'pride', scared: 'unease', affectionate: 'tenderness',
});

// El modelo a veces responde con el adjetivo ("sad") en vez del sustantivo; cada alias lleva a UNA palabra ya conocida (la lista sigue cerrada).
const ALIASES = Object.freeze({
  sad: 'sadness', stressed: 'anxiety', anxious: 'anxiety', worried: 'anxiety', frustrated: 'frustration', angry: 'frustration', anger: 'frustration',
  happy: 'joy', joyful: 'joy', proud: 'pride', scared: 'unease', afraid: 'unease', uneasy: 'unease', tender: 'tenderness', affection: 'tenderness',
  relieved: 'relief', grateful: 'gratitude', excited: 'excitement', lonely: 'loneliness', hopeful: 'hope',
});

/** Un tono de la lista cerrada o ''. Acepta mayúsculas, espacios y los alias de arriba. Pura. */
export function parseMomentTone(raw) {
  if (typeof raw !== 'string') return '';
  const w = raw.toLowerCase().replace(/[^a-z]/g, '');
  if (MOMENT_TONE_IDS.includes(w)) return w;
  return ALIASES[w] || '';
}

export function momentToneLabel(tone) {
  const t = MOMENT_TONES.find((x) => x.tone === tone);
  return t ? t.label : '';
}

export function momentToneKeys(tone) {
  const t = MOMENT_TONES.find((x) => x.tone === tone);
  return t ? t.keys.slice() : [];
}

/** ¿Es un recuerdo de momento? (`kind === 'moment'` con un tono válido). Todo lo demás es un hecho, como siempre. */
export function isMoment(entry) {
  return !!entry && entry.kind === 'moment' && MOMENT_TONE_IDS.includes(entry.tone);
}

/**
 * Los campos de momento de una entrada guardada: `{kind, tone, at?}` si es un momento válido, `{}` si no (entradas anteriores = hechos, cargan igual). Pura.
 * @param {unknown} raw
 * @returns {{ kind?: 'moment', tone?: string, at?: number }}
 */
export function sanitizeMomentFields(raw) {
  if (!raw || typeof raw !== 'object' || raw.kind !== 'moment') return {};
  const tone = parseMomentTone(raw.tone);
  if (!tone) return {};
  const at = Number.isFinite(raw.at) && raw.at > 0 ? raw.at : 0;
  return { kind: 'moment', tone, ...(at ? { at } : {}) };
}

const DAY = 24 * 3600 * 1000;

/** «cuándo» en inglés y aproximado, para el prompt (nunca una fecha exacta). '' si no hay fecha válida. */
export function momentWhen(at, now) {
  if (!Number.isFinite(at) || at <= 0 || !Number.isFinite(now)) return '';
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / DAY);
  if (days <= 0) return 'earlier today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'a few days ago';
  if (days < 21) return 'a couple of weeks ago';
  if (days < 60) return 'a few weeks ago';
  return 'a while back';
}

/** Línea de un momento para el bloque «por tema»: `(sadness, a few days ago) Edgar was …`. */
export function momentPromptLine(entry, now) {
  const when = momentWhen(entry.at, now);
  return `(${entry.tone}${when ? `, ${when}` : ''}) ${entry.content}`;
}
