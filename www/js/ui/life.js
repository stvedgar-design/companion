// www/js/ui/life.js
// HUM-005: conecta el escritor del día del personaje (api/life.js, puro) con la app. Corre en segundo plano desde el hub, SOLO cuando el hub acaba de confirmar
// que el servidor responde (misma razón y mismo patrón que MEM-018/MEM-019/PROACT-001: el servidor atiende de a una petición y cada llamada encarece la
// siguiente respuesta del chat, así que nunca se dispara dentro de un chat). De a un personaje, una vez al día cada uno; servidor apagado = no anota nada y el
// próximo chequeo lo reintenta. Abrir un chat lo corta (`cancelBackgroundLife`).

import { getCharacter, getSettings, listCharacters, saveCharacterLife } from '../state.js';
import { completeOnce, completeChatOnce } from '../api/kobold.js';
import { verifyRecap } from '../api/continuity.js';
import { createLifeWriter, lifeDue } from '../api/life.js';
import { computeMood, MOODS } from '../api/presence.js';

let activeSettings = null;
let stopRequested = false;

const writer = createLifeWriter({
  loadCharacter: (id) => getCharacter(id),
  loadSettings: async () => {
    activeSettings = await getSettings();
    return activeSettings;
  },
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, activeSettings, opts) : completeOnce(request.prompt, activeSettings, opts),
  verifyText: verifyRecap,
  updateLife: (characterId, mutator) => saveCharacterLife(characterId, mutator),
  // El ánimo del momento en palabras del prompt (el guardado, o el que toca por la hora y el día).
  moodPrompt: (character, date) => {
    const mood = computeMood({ prev: character.mood, now: date, characterId: character.id, tags: character.personalityTags });
    const def = MOODS.find((m) => m.id === mood.id);
    return def ? def.prompt : '';
  },
});

/**
 * Revisa a todos los personajes y escribe el día de hoy de quien no lo tenga (de a uno). Nunca lanza.
 * @returns {Promise<{ written: string[] }>}
 */
export async function maybeWriteLife() {
  const written = [];
  stopRequested = false;
  try {
    const settings = await getSettings();
    if (!settings || settings.ownLife !== true) return { written };
    for (const character of await listCharacters()) {
      if (stopRequested) break;
      if (!lifeDue(character, new Date()).due) continue;
      const result = await writer.maybeRun(character.id);
      if (result.kind === 'ok') written.push(character.id);
      else if (result.kind === 'aborted' || result.kind === 'error') break; // servidor caído o el usuario abrió un chat: no insistir con los demás
    }
  } catch {
    // mejor esfuerzo: nunca rompe el hub
  }
  return { written };
}

/** Corta un día en curso (el usuario abrió un chat); no se anota nada y se reintenta en el próximo chequeo. */
export function cancelBackgroundLife() {
  stopRequested = true;
  writer.abort();
}
