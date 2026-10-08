// www/js/api/memory-clustering.js
// FASE 17 (PARETO-010): Agrupación temática determinista de recuerdos y síntesis de memoria evolutiva.
// Módulo puro: sin DOM, sin dependencias de red.

const STOPWORDS = new Set([
  'a', 'al', 'algo', 'ante', 'bajo', 'cabe', 'cada', 'como', 'con', 'contra', 'de', 'del',
  'desde', 'donde', 'durante', 'e', 'el', 'ella', 'ellas', 'ellos', 'en', 'entre', 'era',
  'erais', 'eran', 'eras', 'eres', 'es', 'esa', 'esas', 'ese', 'eso', 'esos', 'esta',
  'estaba', 'estado', 'estais', 'estan', 'estar', 'estas', 'este', 'esto', 'estos', 'estoy',
  'fue', 'fueron', 'fui', 'fuimos', 'ha', 'habia', 'habian', 'habla', 'hablan', 'hace',
  'hacen', 'hacia', 'hasta', 'hay', 'la', 'las', 'le', 'les', 'lo', 'los', 'mas', 'me',
  'mi', 'mis', 'mismo', 'muy', 'nada', 'nos', 'nosotras', 'nosotros', 'o', 'otra', 'otras',
  'otro', 'otros', 'para', 'pero', 'poco', 'por', 'porque', 'que', 'quien', 'quienes',
  'se', 'sea', 'sean', 'segun', 'ser', 'sera', 'seran', 'si', 'sido', 'siempre', 'sin',
  'sobre', 'sois', 'somos', 'son', 'soy', 'su', 'sus', 'suya', 'suyas', 'suyo', 'suyos',
  'tambien', 'tanto', 'te', 'tenia', 'tenian', 'ti', 'tiene', 'tienen', 'toda', 'todas',
  'todo', 'todos', 'tras', 'tu', 'tus', 'tuve', 'tuvimos', 'tuviste', 'un', 'una', 'unas',
  'uno', 'unos', 'usted', 'ustedes', 'va', 'vamos', 'van', 'vaya', 'vayan', 'vosotras',
  'vosotros', 'voy', 'y', 'ya', 'yo',
  // English common words
  'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and', 'any', 'are',
  'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below', 'between', 'both',
  'but', 'by', 'could', 'did', 'do', 'does', 'doing', 'down', 'during', 'each', 'few',
  'for', 'from', 'further', 'had', 'has', 'have', 'having', 'he', 'her', 'here', 'hers',
  'herself', 'him', 'himself', 'his', 'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its',
  'itself', 'just', 'me', 'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off',
  'on', 'once', 'only', 'or', 'other', 'ought', 'our', 'ours', 'ourselves', 'out', 'over',
  'own', 'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
  'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
  'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
  'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your',
  'yours', 'yourself', 'yourselves'
]);

function normalizeWord(w) {
  return String(w || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '');
}

function extractSalientWords(text, names = []) {
  const nameSet = new Set((names || []).map(normalizeWord).filter(Boolean));
  const rawWords = String(text || '').split(/\s+/);
  const salient = new Set();
  for (const raw of rawWords) {
    const w = normalizeWord(raw);
    if (w.length >= 4 && !STOPWORDS.has(w) && !nameSet.has(w)) {
      salient.add(w);
    }
  }
  return salient;
}

function normalizeKeyList(keys, names = []) {
  const nameSet = new Set((names || []).map(normalizeWord).filter(Boolean));
  const result = [];
  const seen = new Set();
  for (const k of Array.isArray(keys) ? keys : []) {
    const norm = normalizeWord(k);
    if (norm.length >= 3 && !STOPWORDS.has(norm) && !nameSet.has(norm) && !seen.has(norm)) {
      seen.add(norm);
      result.push(norm);
    }
  }
  return result;
}

/**
 * Agrupa entradas de lorebook recurrentes o afines en clusters temáticos.
 * Excluye entradas marcadas como 'always: true' (hechos fundamentales inmutables).
 * Solo devuelve clusters con 2 o más entradas.
 *
 * @param {import('../state.js').LoreEntry[]} entries
 * @param {{ charName?: string, userName?: string }} [opts]
 * @returns {{ id: string, topic: string, keys: string[], entries: import('../state.js').LoreEntry[] }[]}
 */
export function clusterLorebookEntries(entries, opts = {}) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter((e) => e && typeof e.content === 'string' && e.content.trim() && e.always !== true);

  if (list.length < 2) return [];

  const names = [opts.charName, opts.userName].filter(Boolean);
  const metadata = list.map((entry) => {
    const keys = normalizeKeyList(entry.keys, names);
    const words = extractSalientWords(entry.content, names);
    return { entry, keys, words };
  });

  // Grafo de similitud entre entradas
  const parent = Array.from({ length: list.length }, (_, i) => i);
  function find(i) {
    if (parent[i] === i) return i;
    parent[i] = find(parent[i]);
    return parent[i];
  }
  function union(i, j) {
    const rootI = find(i);
    const rootJ = find(j);
    if (rootI !== rootJ) parent[rootI] = rootJ;
  }

  for (let i = 0; i < metadata.length; i++) {
    for (let j = i + 1; j < metadata.length; j++) {
      const a = metadata[i];
      const b = metadata[j];

      // Criterio 1: comparten al menos 1 key común
      let sharedKeysCount = 0;
      for (const k of a.keys) {
        if (b.keys.includes(k)) sharedKeysCount++;
      }

      // Criterio 2: comparten al menos 2 palabras salientes en contenido
      let sharedWordsCount = 0;
      for (const w of a.words) {
        if (b.words.has(w)) sharedWordsCount++;
      }

      if (sharedKeysCount >= 1 || sharedWordsCount >= 2) {
        union(i, j);
      }
    }
  }

  // Agrupar por raíz
  const groups = new Map();
  for (let i = 0; i < metadata.length; i++) {
    const root = find(i);
    if (!groups.has(root)) groups.set(root, []);
    groups.get(root).push(metadata[i]);
  }

  const clusters = [];
  for (const [rootIdx, group] of groups.entries()) {
    if (group.length < 2) continue;

    // Calcular frecuencia de keys y palabras salientes para el topic
    const keyFreq = new Map();
    const allKeys = new Set();
    for (const item of group) {
      for (const k of item.keys) {
        allKeys.add(k);
        keyFreq.set(k, (keyFreq.get(k) || 0) + 1);
      }
      for (const w of item.words) {
        keyFreq.set(w, (keyFreq.get(w) || 0) + 1);
      }
    }

    // Elegir la clave más frecuente como topic representativo
    let topKey = '';
    let topCount = 0;
    for (const [k, count] of keyFreq.entries()) {
      if (count > topCount) {
        topCount = count;
        topKey = k;
      }
    }

    const topic = topKey ? topKey.charAt(0).toUpperCase() + topKey.slice(1) : 'Memorias compartidas';
    const clusterEntries = group.map((item) => item.entry);
    const clusterId = 'cluster_' + (topKey || 'topic') + '_' + clusterEntries.map(e => e.id).sort().join('_').slice(0, 32);

    clusters.push({
      id: clusterId,
      topic,
      keys: Array.from(allKeys).slice(0, 5),
      entries: clusterEntries,
    });
  }

  return clusters;
}

/**
 * Genera el prompt para el modelo secundario en CPU (5002) solicitando la consolidación madura.
 *
 * @param {{ charName: string, userName: string, topic: string, entries: import('../state.js').LoreEntry[] }} params
 * @returns {string}
 */
export function buildConsolidationPrompt({ charName, userName, topic, entries }) {
  const N = charName || 'Character';
  const U = userName || 'User';
  const list = (entries || []).map((e) => `- ${e.content}`).join('\n');

  return (
    `[Task: below are recurring memory notes between ${N} and ${U} about the theme "${topic}". ` +
    `Synthesize these separate notes into ONE cohesive, mature, third-person memory sentence. ` +
    `Preserve all key factual details and mutual emotional meaning, but remove redundancy and conversational quotes. ` +
    `Under 240 characters. Same language as the memories. Reply with ONLY the single consolidated sentence, no asterisks, no quotes.\n\n` +
    `Original memories:\n${list}\n\nConsolidated memory sentence:]`
  );
}

/**
 * Limpia y normaliza el texto consolidado recibido del modelo.
 *
 * @param {string} raw
 * @param {string} [fallback]
 * @returns {string}
 */
export function parseConsolidationResponse(raw, fallback = '') {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  // Quitar comillas envolventes o prefijos comunes
  text = text.replace(/^["'«“]|["'»”]$/g, '').trim();
  text = text.replace(/^(Consolidated memory sentence|Synthesized memory|Summary|Resumen|Memoria consolidada):\s*/i, '').trim();

  if (!text || text.length < 10) return String(fallback || '').trim();
  if (text.length > 280) text = text.slice(0, 280).trim();
  return text;
}

/**
 * Aplica la consolidación de un cluster en el objeto Character.
 * Traslada las entradas consolidadas a `lorebookArchive` y añade la nueva entrada consolidada a `lorebook`.
 *
 * @param {import('../state.js').Character} character
 * @param {string[]} entryIdsToConsolidate
 * @param {string} consolidatedText
 * @param {string[]} [consolidatedKeys]
 * @param {number} [now]
 * @returns {import('../state.js').Character}
 */
export function applyClusterConsolidation(character, entryIdsToConsolidate, consolidatedText, consolidatedKeys = [], now = Date.now()) {
  if (!character) return character;
  const idsSet = new Set(entryIdsToConsolidate || []);
  const currentLorebook = Array.isArray(character.lorebook) ? character.lorebook : [];
  const currentArchive = Array.isArray(character.lorebookArchive) ? character.lorebookArchive : [];

  const toArchive = currentLorebook.filter((e) => idsSet.has(e.id)).map((e) => ({
    ...e,
    archivedAt: now,
  }));

  const keptLorebook = currentLorebook.filter((e) => !idsSet.has(e.id));

  // Claves para la nueva entrada: las provistas o extraídas de los elementos archivados
  const keys = Array.isArray(consolidatedKeys) && consolidatedKeys.length
    ? consolidatedKeys
    : Array.from(new Set(toArchive.flatMap((e) => e.keys || []))).slice(0, 4);

  const newEntry = {
    id: 'l' + now.toString(36) + Math.random().toString(36).slice(2, 8),
    keys: keys.length ? keys : ['recuerdo'],
    content: String(consolidatedText || '').trim(),
    updated: now,
    source: 'manual', // marcamos manual para proteger la decisión del co-autor
  };

  return {
    ...character,
    lorebook: [...keptLorebook, newEntry],
    lorebookArchive: [...currentArchive, ...toArchive],
    lorebookPrevious: currentLorebook,
    lorebookPreviousAt: now,
  };
}
