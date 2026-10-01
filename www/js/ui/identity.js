// www/js/ui/identity.js
// MEM-019: conecta el sintetizador de identidad (api/identity-synthesis.js, puro) con la app. Corre en segundo plano desde el hub, SOLO cuando
// el hub acaba de confirmar que el servidor responde (misma razón y mismo patrón que MEM-018: cada llamada al modelo invalida la caché de prompt
// del servidor y encarece la SIGUIENTE respuesta, así que nunca se dispara en mitad de un chat). Revisa a cada personaje y propone solo a quien
// le toca (`identityDue`: muy poco frecuente). Servidor apagado = no corre y no anota nada; el próximo chequeo lo reintenta solo.

import { getCharacter, getSettings, listCharacters, saveCharacterIdentity } from '../state.js';
import { completeOnce, completeChatOnce } from '../api/kobold.js';
import { cleanRecap, verifyRecap } from '../api/continuity.js';
import { createIdentitySynthesizer, identityDue } from '../api/identity-synthesis.js';

let activeSettings = null;
let stopRequested = false; // el usuario abrió un chat: no empezar con el siguiente personaje

const synthesizer = createIdentitySynthesizer({
  loadCharacter: (id) => getCharacter(id),
  loadSettings: async () => {
    activeSettings = await getSettings();
    return activeSettings;
  },
  complete: (request, opts) =>
    request.mode === 'chat' ? completeChatOnce(request.messages, activeSettings, opts) : completeOnce(request.prompt, activeSettings, opts),
  cleanText: cleanRecap,
  verifyText: verifyRecap,
  updateIdentity: (characterId, mutator) => saveCharacterIdentity(characterId, mutator),
});

/**
 * Revisa a todos los personajes y genera la propuesta a quien le toque (de a uno). Nunca lanza.
 * @returns {Promise<{ proposed: string[] }>} ids de los personajes que recibieron una propuesta nueva
 */
export async function maybeSynthesizeIdentities() {
  const proposed = [];
  stopRequested = false;
  try {
    for (const character of await listCharacters()) {
      if (stopRequested) break;
      if (!identityDue(character).due) continue;
      const result = await synthesizer.maybeRun(character.id);
      if (result.kind === 'ok') proposed.push(character.id);
      else if (result.kind === 'aborted' || result.kind === 'error') break; // servidor caído o el usuario abrió un chat: no insistir con los demás
    }
  } catch {
    // mejor esfuerzo: nunca rompe el hub
  }
  return { proposed };
}

/** Corta una síntesis en curso (el usuario abrió un chat); no se anota nada y se reintenta en el próximo chequeo. */
export function cancelBackgroundIdentity() {
  stopRequested = true;
  synthesizer.abort();
}

export function isIdentityRunning() {
  return synthesizer.isRunning();
}
