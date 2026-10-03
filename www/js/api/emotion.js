// www/js/api/emotion.js — HUM-002: qué siente el USUARIO según lo que acaba de escribir. Puro y SIN modelo (cero latencia): listas de palabras en
// español e inglés sobre texto sin tildes ni apóstrofos, con manejo de negación y sin los falsos positivos conocidos de HUM-001 (p. ej. "solo"
// = "only" en español no es tristeza). Lo usan `presence.js` (ánimo del personaje + instrucción de registro) y `moments.js` (picos emocionales).
//
// Ocho emociones: triste/desanimado (`sad`), estresado/ansioso (`stressed`), enojado/frustrado (`angry`), feliz/emocionado (`happy`),
// orgulloso por un logro (`proud`), asustado (`scared`), cansado (`tired`) y cariñoso (`affectionate`).
//
// Reglas de lectura (todas con test en tests/emotion.test.mjs):
//   · Se mira solo la parte de la frase ANTERIOR a la palabra (hasta una coma, punto, "pero"/"but"…): ahí vive la negación ("no estoy triste",
//     "I'm not really sad", "ya no me siento mal").
//   · Si la palabra es una pregunta o un comentario sobre el PERSONAJE ("¿estás triste?", "you seem tired") o sobre un tercero ("mi amigo está
//     triste", "she is stressed") no cuenta como emoción del usuario; con una marca de primera persona ("mi jefe me tiene estresado") sí.
//   · Cada mensaje da una fuerza (0 a 2): suma de las pistas distintas encontradas + un extra si hay un intensificador ("muy", "so", "really").
//   · Los últimos 3 mensajes del usuario se combinan con decaimiento (el último pesa 1, el anterior 0,5, el otro 0,3): una mención suave en el
//     penúltimo mensaje ya no alcanza (UMBRAL), una intensa sí.
// Nunca se adivina: sin una emoción por encima del umbral devuelve null.

/** Emociones reconocidas, de mayor a menor prioridad en un empate. */
export const EMOTIONS = Object.freeze(['sad', 'scared', 'stressed', 'angry', 'tired', 'proud', 'happy', 'affectionate']);

/** Pesos de los últimos mensajes del usuario (el más reciente primero). */
export const MESSAGE_WEIGHTS = Object.freeze([1, 0.5, 0.3]);

/** Fuerza total mínima para decir que el usuario siente algo. */
export const EMOTION_THRESHOLD = 0.8;

/** Tope de fuerza que aporta un solo mensaje. */
const MAX_STRENGTH = 2;

/** Extra por un intensificador ("muy triste", "so stressed"). */
const INTENSIFIER_BONUS = 0.3;

/** Minúsculas, sin tildes y SIN apóstrofos ("don't" → "dont", "I'm" → "im"). */
export function norm(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’‘`´]/g, '');
}

// Cada emoción: lista de pistas { re, w, direct? }. `w` es lo que suma una pista fuerte (1) o débil (0,6). `direct` (cariño) = va dirigida al
// personaje ("te quiero"), así que no se descarta por llevar un "tú". Las expresiones van sobre texto ya normalizado.
const LEXICON = {
  sad: [
    { re: /\b(sad|sadly|sadness|saddened|unhappy|miserable|hopeless|heartbroken|heartbreak|devastated|grieving|grief|depressed|depression|gloomy)\b/g, w: 1 },
    { re: /\b(cry|cries|cried|crying|sobbing|tears)\b/g, w: 1 },
    { re: /\b(lonely|loneliness)\b/g, w: 1 },
    { re: /\b(feel(ing)?|felt|am|im) (so |very |really |kind of |a bit |a little )?(down|empty|numb|blue)\b/g, w: 1 },
    { re: /\b(feel(ing)?|felt|am|im) (so |very |really |kind of )?alone\b/g, w: 1 },
    { re: /\b(bad|rough|awful|terrible|horrible|shitty) (day|week|night|time)\b/g, w: 0.8 },
    { re: /\b(broke up|breakup|passed away|funeral|divorce)\b/g, w: 0.8 },
    { re: /\b(my )?heart hurts( so much| a lot)?\b/g, w: 0.8 },
    { re: /\b(triste|tristes|tristeza|entristec\w*|llor[ao]\w*|llanto|lagrimas|deprimid[oa]s?|depresion|desanimad[oa]s?|desconsolad[oa]s?|desolad[oa]s?|destrozad[oa]s?|abatid[oa]s?|melancoli\w*|soledad)\b/g, w: 1 },
    { re: /\bme siento (muy |tan |bastante |medio |un poco )?(sol[oa]|vacio|vacia|mal|fatal|bajoneado|bajoneada|decaido|decaida|hecho polvo|hecha polvo)\b/g, w: 1 },
    { re: /\b(mal|pesimo|horrible|fatal|terrible) dia\b|\bdia (malo|pesimo|horrible|fatal|terrible)\b|\bmala (semana|racha|noche)\b/g, w: 0.8 },
    { re: /\bsin ganas de (nada|vivir|hacer nada)\b|\bno tengo ganas de nada\b/g, w: 1 },
    { re: /\bme duele (mucho |tanto )?(el corazon|el alma|todo)\b/g, w: 0.8 },
    { re: /[😢😭😞😔☹🥺💔]/gu, w: 0.8 },
  ],
  stressed: [
    { re: /\b(stress|stressed|stressful|stressing|anxious|anxiety|overwhelm\w*|worried|worry|worries|worrying|nervous|on edge|swamped|freaking out|pressure)\b/g, w: 1 },
    { re: /\b(too much|so much) (to do|work|pressure|going on)\b/g, w: 0.8 },
    { re: /\bcant (cope|handle|take it|breathe)\b/g, w: 1 },
    { re: /\b(estres\w*|ansios[oa]s?|ansiedad|agobi\w*|abrumad[oa]s?|preocupad[oa]s?|preocupa|nervios[oa]s?|nervios|presion|desbordad[oa]s?|saturad[oa]s?)\b/g, w: 1 },
    { re: /\bno puedo mas\b|\bno doy mas\b|\bme supera\b/g, w: 0.8 },
    { re: /[😰😓😩😫]/gu, w: 0.6 },
  ],
  angry: [
    { re: /\b(angry|anger|furious|livid|pissed|pissed off|irritated|annoyed|annoying|frustrated|frustrating|frustration|fed up|outraged|resentful)\b/g, w: 1 },
    { re: /\b(sick of|tired of) (this|it|him|her|them|all|everything|people)\b/g, w: 0.8 },
    { re: /\b(so|really|very|im|am) mad\b|\bmad (at|about|with)\b/g, w: 1 },
    { re: /\bi (hate|despise)\b/g, w: 0.8 },
    { re: /\b(enoj\w*|enfad\w*|furios[oa]s?|molest[oa]s?|frustrad[oa]s?|frustracion|harto|harta|hartos|hartas|rabia|indignad[oa]s?|cabread[oa]s?|irritad[oa]s?|fastidiad[oa]s?)\b/g, w: 1 },
    { re: /\b(odio|detesto) (esto|eso|todo|cuando|que)\b/g, w: 0.8 },
    { re: /[😡😠🤬]/gu, w: 0.8 },
  ],
  happy: [
    { re: /\b(happy|glad|thrilled|overjoyed|delighted|stoked|yay|woohoo|wohoo|hooray|awesome|amazing|wonderful|fantastic)\b/g, w: 1 },
    { re: /\b(so|really|very) (excited|happy)\b|\bexcited (about|for|to)\b|\bim excited\b|\bcant wait\b/g, w: 1 },
    { re: /\b(good|great|amazing|big) news\b|\bbest (day|news)\b|\bhaha+h*\b|\bhehe+\b|\blol\b|\blmao\b/g, w: 0.6 },
    { re: /\b(feliz|felices|contento|contenta|contentos|contentas|emocionad[oa]s?|ilusionad[oa]s?|alegre|alegria|genial|increible|maravillos[oa]s?|fantastic[oa]s?|jaja+j*|jeje+j*|jiji+)\b/g, w: 1 },
    { re: /\b(buenas|muy buenas) noticias\b|\bque bueno\b|\bme encanta\b|\bme muero de ganas\b/g, w: 0.8 },
    { re: /[😂😄😁🤣😆😊😃🎉🥳]/gu, w: 0.6 },
  ],
  proud: [
    { re: /\b(proud|so proud|achievement|accomplished|accomplishment|graduated|graduation|promoted|promotion|nailed it|first place|got the job|got accepted|got in)\b/g, w: 1 },
    { re: /\bi (passed|won|did it|made it|finished (my|the)|got (the|a|my) (job|promotion|offer|raise|scholarship|degree))\b/g, w: 1 },
    { re: /\b(orgullos[oa]s?|orgullo|logro|logre|lo logre|me gradue|me recibi|me ascendieron|ascenso|aprobe|pase el examen|me dieron el (trabajo|puesto|empleo)|consegui (el|la|mi) (trabajo|puesto|beca|empleo)|gane (el|la|un|una)|primer lugar|termine (mi|la|el) (tesis|carrera|proyecto|curso|libro|maraton))\b/g, w: 1 },
    { re: /\b(me felicitaron|lo hice)\b/g, w: 0.6 },
  ],
  scared: [
    { re: /\b(scared|afraid|terrified|frightened|petrified|fear|fearful|nightmare|nightmares|panic|panicking|spooked|creeped out)\b/g, w: 1 },
    { re: /\b(asustad[oa]s?|aterrad[oa]s?|aterrorizad[oa]s?|miedo|pavor|pesadilla|pesadillas|susto|panico)\b/g, w: 1 },
    { re: /\b(heard|hear) (a|some) (noise|sound)\b|\bescuche (un|algo)? ?ruido\b/g, w: 0.5 },
    { re: /[😨😱😰]/gu, w: 0.5 },
  ],
  tired: [
    { re: /\b(tired(?! of)|sleepy|exhausted|drained|worn out|burnt out|burned out|burnout|knackered|dead tired|no energy|zero energy)\b/g, w: 1 },
    { re: /\b(cansad[oa]s?|cansancio|agotad[oa]s?|agotamiento|rendid[oa]s?|quemad[oa]s?|hecho polvo|hecha polvo|sin energia|sin fuerzas|no doy mas)\b/g, w: 1 },
    { re: /\b(tengo|con|me da|me muero de|muerto de|muerta de) (mucho |tanto |demasiado |un monton de )?sueno\b|\bmuero de sueno\b/g, w: 1 },
    { re: /[😴🥱]/gu, w: 0.6 },
  ],
  affectionate: [
    { re: /\b(love you|miss you|missed you|thinking of you|thinking about you|thought of you|hug|hugs|hugged|kiss|kisses|cuddle|cuddles|cuddling|snuggle|babe|baby girl|darling|sweetheart|honey)\b/g, w: 1, direct: true },
    { re: /\b(te quiero|te amo|te extrano|te extrane|te echo de menos|te adoro|abrazo|abrazos|abrazarte|beso|besos|besarte|carino|carinos|mimos|mi amor|cielito|pensando en ti|pense en ti|pienso en ti)\b/g, w: 1, direct: true },
    { re: /[❤💕😘🥰💖💗😍💞]/gu, w: 1, direct: true },
  ],
};

const NEGATORS = new Set(['no', 'nunca', 'jamas', 'ni', 'tampoco', 'not', 'never', 'dont', 'didnt', 'doesnt', 'isnt', 'arent', 'wasnt', 'werent', 'aint', 'cant', 'cannot', 'wont', 'hardly', 'barely', 'sin', 'nothing', 'nada']);
const YOU_WORDS = new Set(['you', 'your', 'youre', 'yours', 'u', 'ur', 'tu', 'tus', 'estas', 'eres', 'pareces', 'parece', 'seems', 'seem', 'looks', 'ves', 'sientes', 'sientas', 'siente', 'sienten', 'tienes', 'vos', 'sos']);
const OTHER_WORDS = new Set([
  'he', 'she', 'they', 'hes', 'shes', 'theyre', 'his', 'her', 'their', 'ella', 'ellos', 'ellas',
  'friend', 'friends', 'amigo', 'amiga', 'amigos', 'amigas', 'mom', 'mother', 'dad', 'father', 'mama', 'papa', 'madre', 'padre',
  'sister', 'brother', 'hermana', 'hermano', 'wife', 'husband', 'esposa', 'esposo', 'novia', 'novio', 'boyfriend', 'girlfriend',
  'boss', 'jefe', 'jefa', 'dog', 'cat', 'perro', 'perra', 'gato', 'gata', 'people', 'gente', 'everyone', 'todos', 'abuela', 'abuelo', 'tio', 'tia', 'hijo', 'hija',
]);
const FIRST_PERSON = new Set(['i', 'im', 'ive', 'ill', 'me', 'estoy', 'stoy', 'siento', 'soy', 'tengo', 'feel', 'feeling', 'felt', 'myself']);
const INTENSIFIERS = new Set(['muy', 'tan', 'super', 'so', 'really', 'very', 'extremely', 'totally', 'demasiado', 'mucho', 'bastante', 'realmente', 'tanto', 'completely', 'absolutely']);
const CLAUSE_BREAK = /[.,;:!?¿¡\n\r()]|\b(pero|but|aunque|though|sino|however|although|y luego|and then)\b/g;

// Texto de la frase que va ANTES de la posición `index`, solo de la misma cláusula, como lista de palabras.
function clauseWordsBefore(text, index) {
  const head = text.slice(0, index);
  let start = 0;
  let m;
  CLAUSE_BREAK.lastIndex = 0;
  while ((m = CLAUSE_BREAK.exec(head))) start = m.index + m[0].length;
  return head.slice(start).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * Fuerza de CADA emoción en UN mensaje (0 si no aparece). Pura.
 * @param {string} text
 * @returns {Record<string, number>}
 */
export function emotionStrengths(text) {
  const t = norm(text);
  const out = {};
  if (!t.trim()) return out;
  for (const emotion of EMOTIONS) {
    const found = new Map(); // palabra encontrada → peso (cada palabra distinta cuenta una vez)
    let intensified = false;
    for (const clue of LEXICON[emotion]) {
      clue.re.lastIndex = 0;
      let m;
      while ((m = clue.re.exec(t))) {
        if (m[0] === '') { clue.re.lastIndex++; continue; }
        const before = clauseWordsBefore(t, m.index);
        const near = before.slice(-3);
        if (before.slice(-4).some((w) => NEGATORS.has(w))) continue; // "no estoy triste", "no es que este triste"
        if (!clue.direct) {
          if (near.some((w) => YOU_WORDS.has(w))) continue; // "¿estás triste?", "you seem tired": habla del personaje
          if (near.some((w) => OTHER_WORDS.has(w)) && !near.some((w) => FIRST_PERSON.has(w))) continue; // "mi amigo está triste"
        }
        if (!found.has(m[0]) || found.get(m[0]) < clue.w) found.set(m[0], clue.w);
        if (before.slice(-2).some((w) => INTENSIFIERS.has(w))) intensified = true;
      }
    }
    if (!found.size) continue;
    // La pista más fuerte cuenta entera; cada palabra distinta más suma la mitad de su peso.
    const weights = [...found.values()].sort((a, b) => b - a);
    const strength = weights[0] + weights.slice(1).reduce((sum, w) => sum + w * 0.5, 0);
    out[emotion] = Math.min(MAX_STRENGTH, strength + (intensified ? INTENSIFIER_BONUS : 0));
  }
  return out;
}

/**
 * Perfil de los últimos mensajes del usuario: fuerza de cada emoción con decaimiento (el último pesa 1, el anterior 0,5, el otro 0,3). Pura.
 * @param {string[]} userTexts  Los últimos mensajes del usuario, el MÁS RECIENTE primero.
 * @returns {Record<string, number>}
 */
export function emotionProfile(userTexts) {
  const profile = {};
  (Array.isArray(userTexts) ? userTexts : []).slice(0, MESSAGE_WEIGHTS.length).forEach((text, i) => {
    for (const [emotion, s] of Object.entries(emotionStrengths(text))) profile[emotion] = (profile[emotion] || 0) + s * MESSAGE_WEIGHTS[i];
  });
  return profile;
}

/**
 * La emoción dominante del usuario ahora mismo, o null (nunca se adivina: debajo del umbral no hay emoción).
 * @param {string[]} userTexts  El más reciente primero.
 * @returns {{ id: string, score: number, profile: Record<string, number> }|null}
 */
export function detectEmotion(userTexts) {
  const profile = emotionProfile(userTexts);
  let best = null;
  for (const id of EMOTIONS) {
    const score = profile[id] || 0;
    if (score >= EMOTION_THRESHOLD && (!best || score > best.score + 1e-9)) best = { id, score, profile };
  }
  return best;
}

/** HUM-003: fuerza mínima de UN mensaje para contarlo como pico emocional (un «estoy triste» suelto, 1,0, no alcanza; «estoy muy triste», 1,3, sí). */
export const PEAK_STRENGTH = 1.2;
/** HUM-003: palabras mínimas del mensaje de un pico (hace falta algo que citar). */
export const PEAK_MIN_WORDS = 5;

/**
 * HUM-003: ¿este mensaje del usuario es un PICO emocional (una emoción clara e intensa, con algo que contar)? El cansancio no es un momento. Pura.
 * @param {string} text
 * @returns {{ emotion: string, strength: number }|null}
 */
export function emotionPeak(text) {
  if (String(text || '').trim().split(/\s+/).filter(Boolean).length < PEAK_MIN_WORDS) return null;
  const strengths = emotionStrengths(text);
  let best = null;
  for (const emotion of EMOTIONS) {
    if (emotion === 'tired') continue;
    const strength = strengths[emotion] || 0;
    if (strength >= PEAK_STRENGTH && (!best || strength > best.strength + 1e-9)) best = { emotion, strength };
  }
  return best;
}
