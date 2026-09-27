// www/js/cards/import.js
// Orquesta el import completo de una character card: parseo + avatar + guardado.

import { parseCardFile } from './parse.js';
import { makeAvatar } from './avatar.js';
import { saveCharacter, newId } from '../state.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';

/**
 * Parsea un archivo de character card, genera su avatar (si trae imagen) y
 * guarda el personaje resultante.
 * @param {File} file
 * @returns {Promise<import('../state.js').Character>}
 */
export async function importCardFile(file) {
  const { card, avatarBlob } = await parseCardFile(file);

  let avatar = '';
  if (avatarBlob) {
    avatar = await makeAvatar(avatarBlob);
  }

  const now = Date.now();
  const character = {
    id: newId(),
    name: card.name,
    avatar,
    card,
    avatarMode: 'mini',
    created: now,
    updated: now,
    last: '',
  };

  const saved = await saveCharacter(character);
  logEvent(TEL_EVENTS.CHARACTER_CREATED, { characterId: saved.id, method: 'imported' });
  return saved;
}
