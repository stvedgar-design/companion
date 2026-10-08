// www/js/api/memory-clustering.js
// FASE 19 (PARETO-012): Refinamiento y síntesis emocional de recuerdos individuales con IA.
// Módulo puro: sin DOM, sin dependencias de red.

/**
 * Genera los mensajes estructurados para el modelo secundario en CPU (Llama 3.2 3B Instruct)
 * para pulir y sintetizar un recuerdo individual en una frase íntima, evocadora y con textura emocional,
 * erradicando redacciones clínicas, forenses o burocráticas ("X le dijo a Y que...").
 *
 * @param {{ charName?: string, userName?: string, content: string }} params
 * @returns {{ role: string, content: string }[]}
 */
export function buildMemoryRefinePrompt({ charName, userName, content }) {
  const N = charName || 'Character';
  const U = userName || 'User';
  const raw = String(content || '').replace(/\s+/g, ' ').trim();

  const system =
    `You are an expert literary editor specializing in intimate, character-driven fiction and emotional memory synthesis.\n` +
    `Your task is to rewrite a raw roleplay note into a single evocative, deeply emotional, third-person memory sentence between ${N} and ${U}.\n\n` +
    `CRITICAL GUIDELINES:\n` +
    `1. Focus on emotional resonance, sensory intimacy, tenderness, and mutual connection.\n` +
    `2. STRICTLY FORBIDDEN: Clinical, forensic, or transactional phrasing (NEVER write "${U} told ${N} that...", "${U} mentioned needing to...", "${N} states...").\n` +
    `3. Write from an intimate third-person narrator perspective, honoring both ${N} and ${U}.\n` +
    `4. Keep the EXACT same language as the original note (Spanish if in Spanish, English if in English).\n` +
    `5. Length: EXACTLY ONE single sentence, under 180 characters. No line breaks.\n` +
    `6. Output ONLY the refined memory sentence. Do not add quotes, asterisks, preambles, or commentary.\n\n` +
    `EXAMPLES:\n` +
    `- English Raw: "${U} mentioned needing to cook and shower before work; ${U} told ${N} he would wake her up later to make love again."\n` +
    `  English Refined: "A tender, quiet dawn where ${U} and ${N} shared soft whispered promises and warm closeness before the day began."\n` +
    `- Spanish Raw: "${U} le dijo a ${N} que tenía que ir a trabajar temprano y que quería abrazarla antes de salir."\n` +
    `  Spanish Refined: "Un amanecer cálido y pausado donde ${U} y ${N} compartieron un abrazo estrecho y promesas suaves antes de empezar el día."`;

  const user = `Rewrite this memory note into a single evocative, emotionally resonant memory sentence:\n"${raw}"`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

/**
 * Formato plano alternativo con sintaxis Llama 3.2 Instruct para endpoints /api/v1/generate.
 *
 * @param {{ charName?: string, userName?: string, content: string }} params
 * @returns {string}
 */
export function buildMemoryRefinePlainPrompt({ charName, userName, content }) {
  const N = charName || 'Character';
  const U = userName || 'User';
  const raw = String(content || '').replace(/\s+/g, ' ').trim();

  return (
    `<|begin_of_text|><|start_header_id|>system<|end_header_id|>\n\n` +
    `You are an expert intimate fiction and character memory editor. ` +
    `Refine raw roleplay notes into deeply emotional, evocative, third-person memories between ${N} and ${U}.\n` +
    `Focus on emotional resonance, sensory intimacy, and mutual tenderness.\n` +
    `Never write clinically or transactionally (no "${U} told ${N}...", no "${N} states...").\n` +
    `Keep the same language as the original note. Exactly ONE single sentence, under 180 characters.\n` +
    `Output ONLY the polished memory sentence, no quotes, no commentary.<|eot_id|>` +
    `<|start_header_id|>user<|end_header_id|>\n\n` +
    `Rewrite this memory note into a single evocative, emotionally resonant memory sentence:\n"${raw}"<|eot_id|>` +
    `<|start_header_id|>assistant<|end_header_id|>\n\n`
  );
}

/**
 * Limpia y normaliza el recuerdo individual refinado recibido del modelo.
 *
 * @param {string} raw
 * @param {string} [fallback]
 * @returns {string}
 */
export function parseMemoryRefineResponse(raw, fallback = '') {
  let text = String(raw || '').replace(/\s+/g, ' ').trim();
  text = text.replace(/^["'«“]|["'»”]$/g, '').trim();
  text = text.replace(/^(Refined|Polished|Memory|Recuerdo|Memoria|Refined memory|Polished memory|Resultado):\s*/i, '').trim();
  text = text.replace(/^["'«“]|["'»”]$/g, '').trim();

  if (!text || text.length < 5) return String(fallback || '').trim();

  if (text.length > 220) {
    const sentenceMatch = text.match(/^([^.!?]+[.!?])/);
    if (sentenceMatch && sentenceMatch[1].length >= 20) {
      text = sentenceMatch[1].trim();
    } else {
      text = text.slice(0, 220).replace(/[,;][^,;]*$/, '').trim() + '.';
    }
  }
  return text;
}

/**
 * Mantenido por retrocompatibilidad con tests existentes: devuelve siempre []
 * para erradicar la consolidación invasiva de clusters.
 */
export function clusterLorebookEntries() {
  return [];
}

/**
 * Mantenido por retrocompatibilidad.
 */
export function buildConsolidationPrompt() {
  return '';
}

/**
 * Mantenido por retrocompatibilidad.
 */
export function parseConsolidationResponse(raw, fallback = '') {
  return parseMemoryRefineResponse(raw, fallback);
}

/**
 * Mantenido por retrocompatibilidad.
 */
export function applyClusterConsolidation(character) {
  return character;
}
