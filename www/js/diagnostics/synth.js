// www/js/diagnostics/synth.js
// UI-005: datos SINTÉTICOS para el banco de pruebas de estrés. Puro (sin DOM ni almacenamiento) y determinista: el mismo
// `seed` da siempre los mismos mensajes, así dos corridas son comparables. Nada aquí sale de datos del usuario.

/** Prefijo de los ids de todo lo que crea la prueba (personajes y chats temporales). */
export const DIAG_PREFIX = 'diag-';

/** Generador pseudoaleatorio pequeño (LCG) con semilla. */
export function makeRng(seed = 1) {
  let s = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const ACTIONS = [
  'Sonrío y me acomodo el pelo.',
  'Levanto una ceja, divertida.',
  'Me inclino hacia adelante, curiosa.',
  'Suspiro y miro por la ventana un momento.',
  'Me río bajito, tapándome la boca con la mano.',
  'Cruzo los brazos y frunzo el ceño, pensativa.',
  'Ladeo la cabeza y te miro sin decir nada.',
];
const TALK = [
  'Hola, ¿cómo estás hoy?',
  'Eso suena a mentira, pero te creo.',
  'No sé por qué me pasa esto cada vez que te veo.',
  'Cuéntame más, tengo toda la noche.',
  'A veces me pregunto qué pensarías si supieras lo que pienso.',
  'Está bien, lo intentaremos otra vez mañana, pero prométeme que no te vas a rendir.',
  'Hoy fue un día largo y raro, y aun así me alegra que estés aquí conmigo.',
];

const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];

/**
 * `n` mensajes alternados (el 1.º del personaje, como el saludo) con el formato del proyecto: acción en *cursiva* + diálogo,
 * largos variables, y un ~8 % con un asterisco sin cerrar a propósito (para ejercitar la reparación de formato).
 * @param {number} n
 * @param {{ seed?: number, startTs?: number }} [opts]
 * @returns {{ role: 'user'|'char', text: string, ts: number }[]}
 */
export function makeMessages(n, opts = {}) {
  const rng = makeRng(opts.seed ?? 42);
  const start = Number.isFinite(opts.startTs) ? opts.startTs : 1700000000000;
  const out = [];
  for (let i = 0; i < Math.max(0, Math.floor(n)); i++) {
    let text = `*${pick(ACTIONS, rng)}* ${pick(TALK, rng)}`;
    const extra = rng();
    if (extra < 0.45) text += ` *${pick(ACTIONS, rng)}* ${pick(TALK, rng)}`;
    if (extra < 0.12) text += ` ${pick(TALK, rng)} ${pick(TALK, rng)}`; // algunos mensajes largos
    if (rng() < 0.08) text += ' *asterisco sin cerrar';
    out.push({ role: i % 2 === 0 ? 'char' : 'user', text, ts: start + i * 60000 });
  }
  return out;
}

/** Una respuesta larga (~`words` palabras) para simular streaming, partida en fragmentos como los que manda el servidor. */
export function makeStreamChunks(words = 140, seed = 7) {
  const rng = makeRng(seed);
  const chunks = ['*' + pick(ACTIONS, rng).slice(0, -1)];
  let inAction = true;
  for (let i = 1; i < words; i++) {
    if (inAction && i > 6 && rng() < 0.3) {
      chunks.push('.* ');
      inAction = false;
      continue;
    }
    const w = pick(TALK, rng).split(' ')[Math.floor(rng() * 4)] || 'sí';
    chunks.push((i === 1 || chunks[chunks.length - 1] === '.* ' ? '' : ' ') + w);
  }
  return chunks;
}

/** Card sintética mínima (con el formato de las cards normalizadas del proyecto). */
export function makeSyntheticCard(i = 0) {
  return {
    name: `Prueba ${i + 1}`,
    description: 'Personaje sintético del banco de pruebas de estrés.',
    personality: 'tranquila, curiosa',
    scenario: '',
    first_mes: '*Sonríe.* Hola.',
    mes_example: '',
    system_prompt: '',
    post_history_instructions: '',
    alternate_greetings: [],
    character_book: null,
  };
}

/**
 * Personaje sintético con la forma de un `Character` guardado. `avatar` es un data URL (o '').
 * El id lleva SIEMPRE el prefijo DIAG_PREFIX.
 */
export function makeSyntheticCharacter(i, avatar = '') {
  return {
    id: `${DIAG_PREFIX}c${i}`,
    name: `Prueba ${i + 1}`,
    avatar,
    card: makeSyntheticCard(i),
    created: 1700000000000 + i,
    updated: 1700000000000 + i,
    lorebook: [],
    lorebookPrevious: [],
    lorebookPreviousAt: 0,
    chatBackground: '',
    chatBackgroundBrightness: 100,
    chatBackgroundFade: false,
    chatBackgroundFit: 'cover',
  };
}

/** ¿Este id lo creó la prueba de estrés? */
export function isDiagId(id) {
  return typeof id === 'string' && id.startsWith(DIAG_PREFIX);
}
