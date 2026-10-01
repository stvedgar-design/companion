// tests/chat-avatar.test.mjs — UI-028: avatar junto a la burbuja del personaje, cabecera limpia.
// chat.js no se puede importar como módulo (DOM/estado propio, ver el resto de tests que lo tocan:
// siempre por texto fuente, nunca con `import`) — mismo patrón que continuity.test.mjs (MEM-010) y
// character-editor.test.mjs (CCC-003).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
const chatCss = readFileSync(new URL('../www/css/chat.css', import.meta.url), 'utf8');

test('UI-028: la cabecera ya no arma ningún avatar propio (ni el círculo chico ni el retrato grande expandible)', () => {
  assert.doesNotMatch(chat, /chat-head-avbtn|chat-head-av\b|chat-avatarpanel|onCycleAvatarMode|applyAvatarMode|AVATAR_MODES/);
  assert.doesNotMatch(chatCss, /\.chat-head__avbtn|\.chat-avatarpanel/);
});

test('UI-028: el avatar junto a la burbuja solo se arma en el PRIMER mensaje de una racha del personaje', () => {
  assert.match(chat, /messages\[i - 1\]\.role !== 'char'/);
  assert.match(chat, /chat-row__avatarspace/, 'el resto de la racha reserva el espacio sin repetir el avatar');
  assert.match(chat, /setAvatarEl\(avatarSlot, character\)/, 'reutiliza character.avatar tal cual (mismo data: URL en cada fila)');
});

test('UI-028: la burbuja en streaming se busca por clase, no por posición (ya no es siempre el primer hijo de la fila)', () => {
  assert.match(chat, /streamBubble = row \? row\.querySelector\('\.chat-bubble'\) : null;/);
  assert.doesNotMatch(chat, /row\.firstElementChild/);
});

test('UI-028: el menú de acciones de un mensaje del personaje se alinea con la burbuja, no con el avatar', () => {
  assert.match(chat, /chat-row__body.*\)\.appendChild\(menu\)/);
});

test('UI-028/UI-031: cambiar la foto o editar el personaje (ambos ahora solo desde la ficha) refresca los avatares de los mensajes (no queda un avatar viejo en pantalla)', () => {
  // UI-031: "Cambiar avatar" y "Ver personaje" se quitaron del menú ⋮; editar y cambiar foto viven en
  // character-sheet.js y ambos pasan por el mismo `onUpdated`, que acá refresca la lista una sola vez.
  assert.match(chat, /onOpenCharacterSheet\(\)[\s\S]*?onUpdated:[\s\S]*?renderMessages\(\);/);
  const sheet = readFileSync(new URL('../www/js/ui/character-sheet.js', import.meta.url), 'utf8');
  const calls = sheet.match(/opts\.onUpdated\(/g) || [];
  assert.ok(calls.length >= 2, 'tanto "Editar" como "Cambiar foto" (y ahora "Editar apariencia") deben avisar a onUpdated');
});

test('UI-028: el ancho de la burbuja del personaje se compensa EXACTAMENTE con el tamaño del avatar + el hueco (no un número suelto)', () => {
  assert.match(chatCss, /max-width:\s*calc\(88% \+ var\(--char-avatar-size\) \+ var\(--space-2\)\)/);
  assert.match(chatCss, /--char-avatar-size:\s*34px/);
});
