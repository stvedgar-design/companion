// www/js/api/mood.js
// MEM-011: "sintiendo …" bajo un mensaje del personaje que activó VARIOS recuerdos a la vez. Puro y SIN modelo: cero latencia.
// La emoción sale de una tabla pequeña de palabras clave sobre el texto y las keys de los recuerdos activados (`Message.loreUsed`); si no hay una
// categoría clara, no se muestra nada (nunca se adivina ni se rellena con una emoción genérica). El resultado del Paso 0 (casos sintéticos y
// tasa de acierto) está en docs/HISTORIAL.md, "MEM-011".
//
// Se dice con un SUSTANTIVO ("sintiendo nostalgia"), no con un adjetivo ("nostálgica"): en español el adjetivo obliga a elegir género y la app no
// sabe cuál es el del personaje (ni debe suponerlo).

/** Recuerdos activados (por tema) que hacen falta para que un mensaje pueda llevar la etiqueta. Decisión del usuario: 3 o más. */
export const MOOD_MIN_ACTIVATED = 3;
/** Cuántos de esos recuerdos deben apoyar la MISMA categoría para hablar. */
export const MOOD_MIN_SUPPORT = 2;

// Cada categoría: etiqueta (sustantivo) y patrones sobre texto SIN acentos y en minúsculas, en inglés (idioma de la conversación, MEM-003) y
// español. `\b` al inicio evita que "hug" case dentro de "huge"; las terminaciones se listan a mano.
const CATEGORIES = [
  { id: 'affection', label: 'cariño', patterns: [
    /\b(love[sd]?|loving|lover|hug(s|ged|ging)?|kiss(es|ed|ing)?|cuddl\w*|snuggl\w*|affection\w*|adore[sd]?|cherish\w*|sweetheart|darling|tender\w*|hold(s|ing)? (his|her|their|my|your)? ?hands?|held (his|her|their|my|your)? ?hands?)\b/,
    /\b(amor|abraz\w*|beso\w*|besa\w*|carino\w*|te quiero|ternura|mimos?|abrazo)\b/,
  ] },
  { id: 'nostalgia', label: 'nostalgia', patterns: [
    /\b(miss(es|ed|ing)?|remember\w*|memor(y|ies)|childhood|grew up|growing up|used to|years ago|back then|old times|nostalg\w*|reminisc\w*|hometown|old friends?)\b/,
    /\b(extran\w*|recuerd\w*|infancia|nostalgi\w*|de nino|de nina|antiguo|pueblo natal)\b/,
  ] },
  { id: 'excitement', label: 'ilusión', patterns: [
    /\b(excit\w*|can'?t wait|looking forward|dreams?|dreamed|plans? to|planning|trip|travel\w*|vacation|wedding|birthday|surprise[sd]?|promis(e|es|ed)|concert|festival|adventure\w*|anticipat\w*)\b/,
    /\b(ilusion|emocion\w*|ganas de|sueno|suenos|viaje\w*|boda|cumpleanos|sorpresa\w*|planea\w*|prometi\w*)\b/,
  ] },
  { id: 'gratitude', label: 'gratitud', patterns: [
    /\b(thank\w*|grateful|gratitude|appreciat\w*|helped|favou?r|gift(s|ed)?|generous|generosity|kindness|saved (his|her|their|my|your) )\b/,
    /\b(gracias|agradec\w*|ayudo|regalo\w*|generos\w*|amabilidad)\b/,
  ] },
  { id: 'worry', label: 'preocupación', patterns: [
    /\b(worr(y|ies|ied|ying)|anxious|anxiety|scared|afraid|fear\w*|nervous\w*|panic\w*|stress\w*|sick|illness|hospital|surgery|exams?|deadline|nightmare\w*|trouble)\b/,
    /\b(preocup\w*|miedo\w*|ansied\w*|nervios\w*|enferm\w*|hospital|cirugia|examen\w*|pesadilla\w*)\b/,
  ] },
  { id: 'sadness', label: 'tristeza', patterns: [
    /\b(sad(ness|ly)?|cry|cries|cried|crying|tears?|died|death|dead|funeral|passed away|lonel(y|iness)|grief|grieving|broke up|breakup|divorce\w*|depress\w*|heartbr\w*|lost (his|her|their|my|your) |bereave\w*)\b/,
    /\b(triste\w*|llor\w*|murio|muerte|fallec\w*|funeral|soledad|duelo|divorcio|deprim\w*|perdio a)\b/,
  ] },
  { id: 'joy', label: 'alegría', patterns: [
    /\b(laugh\w*|funny|jokes?|joked|prank\w*|teas(e|es|ed|ing)|silly|giggl\w*|play(s|ed|ing)|games?|party|parties|danc(e|es|ed|ing)|sing(s|ing)?|sang|fun)\b/,
    /\b(reir\w*|risa\w*|chiste\w*|broma\w*|juego\w*|jugar|jugo|divert\w*|fiesta\w*|bail\w*)\b/,
  ] },
  { id: 'pride', label: 'orgullo', patterns: [
    /\b(proud\w*|achievement\w*|accomplish\w*|graduat\w*|promotion|promoted|won(?!'t)|award\w*|first place|degree|passed the)\b/,
    /\b(orgull\w*|logro\w*|gano|gradu\w*|ascenso|premio\w*)\b/,
  ] },
  { id: 'calm', label: 'calma', patterns: [
    /\b(calm\w*|peace(ful)?|quiet (evenings?|nights?|mornings?|afternoons?)|relax\w*|cozy|cosy|serene|serenity)\b/,
    /\b(calma|tranquil\w*|relaj\w*|sereno|serenidad)\b/,
  ] },
  { id: 'wonder', label: 'asombro', patterns: [
    /\b(wonder\w*|amaz\w*|awe|magic(al)?|stars?|starry|universe|galax\w*|northern lights|aurora|ocean|discover\w*)\b/,
    /\b(asombr\w*|maravill\w*|estrella\w*|universo|magia|magico|descubr\w*|oceano)\b/,
  ] },
];

/** Minúsculas y sin acentos (para que un mismo patrón sirva con o sin ellos). */
function normalize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'") // apóstrofo tipográfico → recto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * Cuenta, por categoría, cuántas de las entradas activadas la respaldan (una entrada cuenta UNA vez por categoría, diga lo que diga).
 * @param {{ content?: string, keys?: string[] }[]} entries
 * @returns {Record<string, number>}
 */
export function moodScores(entries) {
  const scores = {};
  for (const entry of Array.isArray(entries) ? entries : []) {
    if (!entry || typeof entry !== 'object') continue;
    const text = normalize(`${entry.content || ''} ${(Array.isArray(entry.keys) ? entry.keys : []).join(' ')}`);
    for (const cat of CATEGORIES) {
      if (cat.patterns.some((re) => re.test(text))) scores[cat.id] = (scores[cat.id] || 0) + 1;
    }
  }
  return scores;
}

/**
 * Emoción de un mensaje a partir de los recuerdos que usó (`Message.loreUsed`), o `null` si no procede o no hay una categoría clara.
 * Procede solo con `MOOD_MIN_ACTIVATED` o más recuerdos activados POR TEMA (los "siempre presentes" no cuentan: se envían en cada turno,
 * no los activó el mensaje). Habla solo si una categoría queda respaldada por al menos `MOOD_MIN_SUPPORT` de ellos Y por más que cualquier otra
 * (un empate no es "claro": no se muestra nada).
 * @param {{ content?: string, keys?: string[], always?: boolean }[]|undefined} loreUsed
 * @returns {{ id: string, label: string, support: number, total: number }|null}
 */
export function deriveMood(loreUsed) {
  const topic = (Array.isArray(loreUsed) ? loreUsed : []).filter((e) => e && e.always !== true);
  if (topic.length < MOOD_MIN_ACTIVATED) return null;
  const scores = moodScores(topic);
  const ranked = CATEGORIES.map((c) => ({ c, n: scores[c.id] || 0 })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n);
  if (!ranked.length) return null;
  const [best, second] = ranked;
  if (best.n < MOOD_MIN_SUPPORT) return null;
  if (second && second.n === best.n) return null;
  return { id: best.c.id, label: best.c.label, support: best.n, total: topic.length };
}

/**
 * Texto para mostrar junto al timestamp ("sintiendo nostalgia"), o '' si no se debe mostrar nada.
 * @param {Parameters<typeof deriveMood>[0]} loreUsed
 * @returns {string}
 */
export function moodText(loreUsed) {
  const mood = deriveMood(loreUsed);
  return mood ? `sintiendo ${mood.label}` : '';
}

/** Etiquetas posibles (para pruebas y documentación). */
export const MOOD_LABELS = Object.freeze(CATEGORIES.map((c) => c.label));
