// www/js/backup.js
// BKP-001: importación SEGURA de copias de seguridad. Módulo puro (sin DOM ni almacenamiento): valida el archivo, lo normaliza
// (copias v1 y v2), lo COMPARA con lo que ya hay en el teléfono (análisis), decide qué escribir según el modo elegido (plan) y
// redacta los textos en lenguaje llano. `state.js` ejecuta el plan en UNA sola transacción (todo o nada).

export const CHAT_LOG_MESSAGE =
  'Ese archivo es el registro de UN chat (el respaldo automático o «Exportar este chat»). Se importa desde el menú ⋮ del chat con «Importar chat», no desde aquí.';

/**
 * Lee y valida el texto de un archivo de copia. Lanza un Error con un mensaje comprensible si no sirve.
 * @param {string} text
 */
export function parseBackupText(text) {
  let data;
  try {
    data = JSON.parse(String(text).replace(/^﻿/, ''));
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  if (data && typeof data === 'object' && data.app === 'companion' && data.kind === 'chat-log') throw new Error(CHAT_LOG_MESSAGE);
  if (!data || typeof data !== 'object' || data.app !== 'companion' || !Array.isArray(data.characters)) {
    throw new Error('Ese archivo no es una copia de seguridad válida de Companion.');
  }
  return data;
}

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x) => (Number.isFinite(x) ? x : null);

/**
 * Forma común de una copia v1 o v2: `{ version, exported, characters[], chats[], settings }`.
 * Cada chat: `{ id, characterId, title, updated, messages (array|null), legacy, raw }`. Solo lectura defensiva: no descarta nada útil.
 */
export function normalizeBackup(data) {
  const characters = (Array.isArray(data.characters) ? data.characters : []).filter((c) => isObj(c) && typeof c.id === 'string' && c.id);
  const chats = [];
  const isV2 = data.version === 2 && isObj(data.chats);
  if (isV2) {
    const byId = isObj(data.chatMessages) ? data.chatMessages : {};
    for (const key of Object.keys(data.chats)) {
      const c = data.chats[key];
      if (!isObj(c) || typeof c.id !== 'string' || !c.id || typeof c.characterId !== 'string' || !c.characterId) continue;
      chats.push({ id: c.id, characterId: c.characterId, title: typeof c.title === 'string' ? c.title : '', updated: num(c.updated), messages: Array.isArray(byId[key]) ? byId[key] : Array.isArray(byId[c.id]) ? byId[c.id] : null, legacy: false, raw: c });
    }
  } else if (isObj(data.chats)) {
    // Copia del formato viejo: un chat por personaje, con la lista de mensajes directamente.
    for (const characterId of Object.keys(data.chats)) {
      if (!Array.isArray(data.chats[characterId])) continue;
      chats.push({ id: characterId, characterId, title: 'Chat restaurado', updated: null, messages: data.chats[characterId], legacy: true, raw: null });
    }
  }
  return {
    version: isV2 ? 2 : 1,
    exported: typeof data.exported === 'string' || Number.isFinite(data.exported) ? data.exported : null,
    characters,
    chats,
    settings: isObj(data.settings) ? data.settings : null,
  };
}

const memories = (c) => (Array.isArray(c && c.lorebook) ? c.lorebook.length : 0);

/**
 * Compara la copia con lo que ya hay en el teléfono.
 * @param {ReturnType<typeof normalizeBackup>} norm
 * @param {{ characters: {id:string, name?:string, updated?:number, lorebook?:unknown[]}[], chats: {id:string, characterId:string, title?:string, updated?:number}[], messageCounts: Record<string, number> }} existing
 */
export function analyzeBackup(norm, existing) {
  const exChars = new Map(existing.characters.map((c) => [c.id, c]));
  const exChats = new Map(existing.chats.map((c) => [c.id, c]));
  const conflicts = [];
  let newCharacters = 0;
  let newChats = 0;
  let orphanChats = 0;
  const backupCharIds = new Set(norm.characters.map((c) => c.id));

  for (const c of norm.characters) {
    const ex = exChars.get(c.id);
    if (!ex) {
      newCharacters++;
      continue;
    }
    const bu = num(c.updated);
    const eu = num(ex.updated);
    conflicts.push({
      kind: 'character', id: c.id, name: typeof c.name === 'string' ? c.name : ex.name || '',
      backupMemories: memories(c), existingMemories: memories(ex),
      existingMoreMemories: memories(ex) > memories(c),
      existingNewer: bu !== null && eu !== null && eu > bu,
    });
  }
  let totalMessages = 0;
  for (const ch of norm.chats) {
    const backupMessages = ch.messages ? ch.messages.length : 0;
    totalMessages += backupMessages;
    const ex = exChats.get(ch.id);
    if (!ex) {
      newChats++;
      if (!backupCharIds.has(ch.characterId) && !exChars.has(ch.characterId)) orphanChats++;
      continue;
    }
    const existingMessages = existing.messageCounts[ch.id] || 0;
    const bu = ch.updated;
    const eu = num(ex.updated);
    conflicts.push({
      kind: 'chat', id: ch.id, title: ch.title || ex.title || '', backupMessages, existingMessages,
      backupUpdated: bu, existingUpdated: eu,
      existingMore: existingMessages > backupMessages,
      existingNewer: bu !== null && eu !== null && eu > bu,
    });
  }
  const chatConflicts = conflicts.filter((c) => c.kind === 'chat');
  return {
    version: norm.version,
    exported: norm.exported,
    counts: { characters: norm.characters.length, chats: norm.chats.length, messages: totalMessages },
    existingEmpty: existing.characters.length === 0 && existing.chats.length === 0,
    newCharacters,
    newChats,
    orphanChats,
    conflicts,
    conflictChats: chatConflicts.length,
    conflictCharacters: conflicts.length - chatConflicts.length,
    /** ¿Hay algo que ya tienes que es más nuevo o más completo que la copia? (lo que "Restaurar todo" destruiría) */
    warnNewer: conflicts.some((c) => c.existingNewer || c.existingMore || c.existingMoreMemories),
    newerChats: chatConflicts.filter((c) => c.existingNewer || c.existingMore).length,
    hasSettings: !!norm.settings,
  };
}

/**
 * Decide qué se escribe. `merge` ("solo agregar lo que falta") NUNCA toca un id que ya existe; `replace` escribe todo (lo
 * de la copia gana). Los chats de un personaje que no está ni en la copia ni en el teléfono se omiten en `merge`.
 * @param {ReturnType<typeof normalizeBackup>} norm
 * @param {{ characters: {id:string}[], chats: {id:string}[] }} existing
 * @param {{ mode?: 'merge'|'replace', includeSettings?: boolean }} [opts]
 */
export function planImport(norm, existing, opts = {}) {
  const mode = opts.mode === 'replace' ? 'replace' : 'merge';
  const exChars = new Set(existing.characters.map((c) => c.id));
  const exChats = new Set(existing.chats.map((c) => c.id));
  const backupCharIds = new Set(norm.characters.map((c) => c.id));
  const stats = { addedCharacters: 0, replacedCharacters: 0, skippedCharacters: 0, addedChats: 0, replacedChats: 0, skippedChats: 0, orphanChats: 0 };
  const characters = [];
  const chats = [];
  for (const c of norm.characters) {
    if (exChars.has(c.id)) {
      if (mode === 'replace') {
        characters.push(c);
        stats.replacedCharacters++;
      } else stats.skippedCharacters++;
    } else {
      characters.push(c);
      stats.addedCharacters++;
    }
  }
  for (const ch of norm.chats) {
    const exists = exChats.has(ch.id);
    const hasCharacter = backupCharIds.has(ch.characterId) || exChars.has(ch.characterId);
    if (exists && mode === 'merge') {
      stats.skippedChats++;
      continue;
    }
    if (!exists && !hasCharacter && mode === 'merge') {
      stats.orphanChats++;
      continue;
    }
    chats.push(ch);
    if (exists) stats.replacedChats++;
    else stats.addedChats++;
  }
  return { mode, characters, chats, stats, settings: opts.includeSettings && norm.settings ? norm.settings : null };
}

// ---------- textos en lenguaje llano ----------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/** Fecha corta "12/09/2026 14:30" de la marca `exported` (ISO o número); '' si no se puede leer. */
export function formatExported(exported) {
  const d = new Date(exported);
  if (exported === null || exported === undefined || Number.isNaN(d.getTime())) return '';
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** Líneas que resumen la copia y lo que ya tienes. */
export function describeAnalysis(a) {
  const lines = [];
  const when = formatExported(a.exported);
  lines.push(when ? `Esta copia es del ${when}.` : 'Esta copia no trae la fecha en que se hizo.');
  lines.push(`Tiene ${plural(a.counts.characters, 'personaje', 'personajes')}, ${plural(a.counts.chats, 'chat', 'chats')} y ${a.counts.messages === 1 ? '1 mensaje' : `${fmt(a.counts.messages)} mensajes`}.`);
  if (a.existingEmpty) lines.push('Tu teléfono no tiene personajes ni chats todavía.');
  else {
    const have = [];
    if (a.conflictCharacters) have.push(plural(a.conflictCharacters, 'personaje', 'personajes'));
    if (a.conflictChats) have.push(plural(a.conflictChats, 'chat', 'chats'));
    lines.push(have.length ? `Ya tienes en tu teléfono ${have.join(' y ')} de esta copia.` : 'Nada de esta copia existe todavía en tu teléfono.');
    const fresh = [];
    if (a.newCharacters) fresh.push(plural(a.newCharacters, 'personaje', 'personajes'));
    if (a.newChats) fresh.push(plural(a.newChats, 'chat', 'chats'));
    if (fresh.length) lines.push(`Lo que te falta y se agregaría: ${fresh.join(' y ')}.`);
    if (a.newerChats) lines.push(`${plural(a.newerChats, 'chat que ya tienes tiene', 'chats que ya tienes tienen')} más mensajes o cambios más nuevos que la copia.`);
  }
  if (a.orphanChats) lines.push(`${plural(a.orphanChats, 'chat', 'chats')} de la copia no tiene su personaje y no se agregaría al elegir «Solo agregar».`);
  return lines;
}

/** Advertencia destacada de "Restaurar todo" (vacía si no hay riesgo). */
export function replaceWarning(a) {
  if (!a.warnNewer) return '';
  const parts = [];
  if (a.newerChats) parts.push(plural(a.newerChats, 'chat', 'chats'));
  const mem = a.conflicts.filter((c) => c.kind === 'character' && c.existingMoreMemories).length;
  if (mem) parts.push(plural(mem, 'personaje con más recuerdos', 'personajes con más recuerdos'));
  const what = parts.length ? `: ${parts.join(' y ')}` : '';
  return `¡Ojo! «Restaurar todo» pisaría cosas tuyas que son más nuevas o más completas que las de la copia${what}. Esos cambios se perderían (por eso antes se guarda una copia de lo que tienes ahora).`;
}

/** Líneas con lo que se hizo, en lenguaje llano. */
export function describeResult(r) {
  const lines = [];
  const added = [];
  if (r.addedCharacters) added.push(plural(r.addedCharacters, 'personaje', 'personajes'));
  if (r.addedChats) added.push(plural(r.addedChats, 'chat', 'chats'));
  lines.push(added.length ? `Se agregó: ${added.join(' y ')}.` : 'No se agregó nada nuevo.');
  const rep = [];
  if (r.replacedCharacters) rep.push(plural(r.replacedCharacters, 'personaje', 'personajes'));
  if (r.replacedChats) rep.push(plural(r.replacedChats, 'chat', 'chats'));
  if (rep.length) lines.push(`Se reemplazó: ${rep.join(' y ')}.`);
  const skip = [];
  if (r.skippedCharacters) skip.push(plural(r.skippedCharacters, 'personaje que ya tenías', 'personajes que ya tenías'));
  if (r.skippedChats) skip.push(plural(r.skippedChats, 'chat que ya tenías', 'chats que ya tenías'));
  if (r.orphanChats) skip.push(plural(r.orphanChats, 'chat sin su personaje', 'chats sin su personaje'));
  if (skip.length) lines.push(`Se omitió (no se tocó): ${skip.join(', ')}.`);
  if (r.droppedMessages) lines.push(`${plural(r.droppedMessages, 'mensaje dañado se descartó', 'mensajes dañados se descartaron')}.`);
  if (r.settingsRestored) lines.push('Se restauraron también tus ajustes (servidor, nombre, aspecto y PIN).');
  return lines;
}
