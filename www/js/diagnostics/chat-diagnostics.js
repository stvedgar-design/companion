// www/js/diagnostics/chat-diagnostics.js
// Diagnóstico técnico forense de la conversación activa.
// Módulo puro (sin DOM): calcula métricas de volumetría, contexto, regeneración y recuerdos.

import { variantCount, activeVariantIndex } from '../variants.js';

const CHARS_PER_TOKEN = 3.3;

/**
 * Calcula el reporte técnico forense de un chat y su companion.
 * @param {object} params
 * @param {import('../state.js').Character} params.character
 * @param {import('../state.js').Chat} params.chat
 * @param {import('../state.js').Message[]} params.messages
 * @param {import('../state.js').Settings} params.settings
 * @returns {object} Métricas estructuradas y texto listo para copiar.
 */
export function buildChatDiagnosticsModel({ character, chat, messages = [], settings = {} }) {
  const total = messages.length;
  const userMsgs = messages.filter((m) => m && m.role === 'user');
  const charMsgs = messages.filter((m) => m && m.role === 'char');

  const userChars = userMsgs.reduce((acc, m) => acc + (m.text ? m.text.length : 0), 0);
  const charChars = charMsgs.reduce((acc, m) => acc + (m.text ? m.text.length : 0), 0);

  const avgUserChars = userMsgs.length ? Math.round(userChars / userMsgs.length) : 0;
  const avgCharChars = charMsgs.length ? Math.round(charChars / charMsgs.length) : 0;

  const avgUserTokens = Math.round(avgUserChars / CHARS_PER_TOKEN);
  const avgCharTokens = Math.round(avgCharChars / CHARS_PER_TOKEN);

  // Regeneraciones y variantes
  let totalRegenerations = 0;
  let messagesWithVariants = 0;
  const discardedVariants = [];

  for (let idx = 0; idx < messages.length; idx++) {
    const m = messages[idx];
    if (m && m.role === 'char' && Array.isArray(m.variants) && m.variants.length > 1) {
      messagesWithVariants++;
      totalRegenerations += m.variants.length - 1;
      const activeIdx = activeVariantIndex(m);
      m.variants.forEach((v, vIdx) => {
        if (vIdx !== activeIdx) {
          discardedVariants.push({
            msgIndex: idx,
            variantIndex: vIdx + 1,
            totalVariants: m.variants.length,
            textSnippet: v.text ? (v.text.length > 120 ? v.text.slice(0, 120) + '…' : v.text) : '',
            charCount: v.text ? v.text.length : 0,
          });
        }
      });
    }
  }

  const regenRatePct = charMsgs.length ? Math.round((messagesWithVariants / charMsgs.length) * 100) : 0;

  // Último mensaje del personaje (tiempos y rendimiento)
  let lastCharMsg = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i] && messages[i].role === 'char') {
      lastCharMsg = messages[i];
      break;
    }
  }

  const lastMeta = lastCharMsg && lastCharMsg.meta ? lastCharMsg.meta : null;
  const lastSpeedTps = lastMeta && lastMeta.totalMs > 0 && lastMeta.chars > 0
    ? Math.round(((lastMeta.chars / CHARS_PER_TOKEN) / (lastMeta.totalMs / 1000)) * 10) / 10
    : null;

  // Recuerdos inyectados en la conversación
  const recentLoreUsed = (lastCharMsg && Array.isArray(lastCharMsg.loreUsed)) ? lastCharMsg.loreUsed : [];
  const lorebookTotal = (character && Array.isArray(character.lorebook)) ? character.lorebook.length : 0;
  const lorebookAlways = (character && Array.isArray(character.lorebook)) ? character.lorebook.filter((e) => e && e.always).length : 0;

  // Contexto y tokens
  const ctx = (settings && settings.ctx) || 10240;
  const maxLen = (settings && settings.maxLen) || 220;
  const budget = Math.max(1, ctx - maxLen);

  // Estimación de contexto usado
  const headChars = 500; // base aproximada de cabecera
  const historyChars = userChars + charChars + (total * 12);
  const approxTokens = Math.ceil((headChars + historyChars) / CHARS_PER_TOKEN);
  const ratio = Math.round((approxTokens / budget) * 100);

  // Identidad
  const hasIdentityCore = !!(character && character.identityCore);
  const idTraits = (character && character.identityCore && character.identityCore.traits) || [];

  // Texto formateado técnico para copiar y enviar al desarrollador
  const textLines = [
    `=== COMPANION CHAT DIAGNOSTICS ===`,
    `Fecha: ${new Date().toISOString()}`,
    `Companion: ${character ? character.name : 'Unknown'} (ID: ${character ? character.id : '?'})`,
    `Chat ID: ${chat ? chat.id : '?'} | Modo: ${settings.mode || 'chat'}`,
    ``,
    `[1. VOLUMETRÍA Y TOKENOMICS]`,
    `- Total mensajes: ${total} (Usuario: ${userMsgs.length}, Companion: ${charMsgs.length})`,
    `- Longitud media usuario: ${avgUserChars} caracteres (~${avgUserTokens} tokens)`,
    `- Longitud media companion: ${avgCharChars} caracteres (~${avgCharTokens} tokens)`,
    `- Ratio caracteres usuario vs companion: ${userChars > 0 ? (charChars / userChars).toFixed(2) : 'N/A'}x`,
    ``,
    `[2. SALUD GENERATIVA Y REGENERACIONES]`,
    `- Mensajes regenerados: ${messagesWithVariants} de ${charMsgs.length} (${regenRatePct}%)`,
    `- Total regeneraciones ejecutadas: ${totalRegenerations}`,
    `- Último TTFT (Time to First Token): ${lastMeta ? lastMeta.ttftMs + ' ms' : 'N/A'}`,
    `- Tiempo total última respuesta: ${lastMeta ? (lastMeta.totalMs / 1000).toFixed(2) + ' s' : 'N/A'}`,
    `- Velocidad estimada última respuesta: ${lastSpeedTps ? lastSpeedTps + ' tokens/s' : 'N/A'}`,
    ...(discardedVariants.length ? [
      `- Variantes descartadas (${discardedVariants.length}):`,
      ...discardedVariants.slice(-3).map((v) => `  * Msg #${v.msgIndex} (v${v.variantIndex}/${v.totalVariants}, ${v.charCount} chars): "${v.textSnippet}"`),
    ] : [`- Variantes descartadas: Ninguna`]),
    ``,
    `[3. ANATOMÍA DEL CONTEXTO (VENTANA ${ctx} TOKENS)]`,
    `- Tokens estimados usados: ~${approxTokens} de ${budget} libres (${ratio}%)`,
    `- Estado de ventana: ${ratio >= 100 ? 'VENTANA SATURADA (Recorte activo de turnos antiguos)' : 'VENTANA SALUDABLE (Historial íntegro en memoria viva)'}`,
    `- Identity Core activo: ${hasIdentityCore ? 'SÍ (' + idTraits.join(', ') + ')' : 'NO (Card CCv2 estándar)'}`,
    ``,
    `[4. TRAZABILIDAD DE MEMORIA Y RECUERDOS]`,
    `- Recuerdos en almacén: ${lorebookTotal} (${lorebookAlways} siempre presentes)`,
    `- Recuerdos inyectados en último turno (${recentLoreUsed.length}):`,
    ...(recentLoreUsed.length
      ? recentLoreUsed.map((u) => `  * [${u.always ? 'ALWAYS' : 'TOPIC'}] (ID: ${u.id || '?'}): "${u.content ? (u.content.length > 90 ? u.content.slice(0, 90) + '…' : u.content) : ''}"`)
      : [`  * Ningún recuerdo inyectado en el último turno`]),
    `==================================`
  ];

  return {
    raw: {
      total,
      userCount: userMsgs.length,
      charCount: charMsgs.length,
      avgUserTokens,
      avgCharTokens,
      messagesWithVariants,
      totalRegenerations,
      regenRatePct,
      lastMeta,
      lastSpeedTps,
      approxTokens,
      budget,
      ratio,
      hasIdentityCore,
      recentLoreUsed,
      lorebookTotal,
      lorebookAlways,
      discardedVariants,
    },
    reportText: textLines.join('\n'),
  };
}
