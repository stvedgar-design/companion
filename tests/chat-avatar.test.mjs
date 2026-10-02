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
  // UI-038: el tamaño ya no es fijo (34px) sino veces el texto, y la fila no puede pasar del 100 % del chat
  assert.match(chatCss, /max-width:\s*min\(100%, calc\(88% \+ var\(--char-avatar-size\) \+ var\(--space-2\)\)\)/);
  assert.match(chatCss, /--char-avatar-size:\s*calc\(var\(--msg-font-size, 17px\) \* var\(--char-avatar-k\)\)/);
});

test('UI-038: Ajustes ofrece 3 opciones nombradas para el texto y 3 para la foto, juntas en "Apariencia"', () => {
  const settings = readFileSync(new URL('../www/js/ui/settings.js', import.meta.url), 'utf8');
  assert.match(settings, /const SIZE_LABELS = \['Pequeño', 'Mediano', 'Grande'\]/);
  const iText = settings.indexOf('id="settings-fontsize"');
  const iAvatar = settings.indexOf('id="settings-avatarsize"');
  const iAppearance = settings.indexOf('<div class="menu-group" aria-hidden="true">Apariencia</div>');
  const iNext = settings.indexOf('<div class="menu-group" aria-hidden="true">Datos</div>');
  assert.ok(iAppearance < iText && iText < iAvatar && iAvatar < iNext, 'los dos controles están seguidos, dentro de la sección Apariencia');
  assert.match(settings, /Tamaño del texto de los mensajes/);
  assert.match(settings, /Tamaño de la foto junto a los mensajes/);
  const shell = readFileSync(new URL('../www/js/ui/shell.js', import.meta.url), 'utf8');
  assert.match(shell, /export function applyChatAvatarSize/);
  const main = readFileSync(new URL('../www/js/main.js', import.meta.url), 'utf8');
  assert.match(main, /shell\.applyChatAvatarSize\(settings\.chatAvatarSize\)/, 'se aplica al arrancar');
});

test('UI-038: chat.css define los tres tamaños de foto como veces el texto (no píxeles sueltos)', () => {
  assert.match(chatCss, /--char-avatar-k:\s*2\.6;/);
  assert.match(chatCss, /:root\[data-chat-avatar="small"\]\s*\{\s*--char-avatar-k:\s*2;/);
  assert.match(chatCss, /:root\[data-chat-avatar="large"\]\s*\{\s*--char-avatar-k:\s*3\.3;/);
});

test('UI-039 (pedido del usuario): el slider de opacidad vive junto al brillo del fondo y solo desvanece el fondo de la burbuja, no el texto', () => {
  const bgSheet = readFileSync(new URL('../www/js/ui/chat-background.js', import.meta.url), 'utf8');
  const iBright = bgSheet.indexOf('id="bg-brightness"');
  const iBubbles = bgSheet.indexOf('id="bg-bubbles"');
  const iFade = bgSheet.indexOf('id="bg-fade"');
  assert.ok(iBright > 0 && iBright < iBubbles && iBubbles < iFade, 'mismo grupo (bg-controls), justo después del brillo');
  // el texto nunca se desvanece: ninguna regla pone `opacity` en la burbuja misma; solo en su ::before
  assert.doesNotMatch(chatCss, /\.chat-bubble\s*\{[^}]*opacity/);
  assert.match(chatCss, /\.chat--translucent \.chat-bubble::before\s*\{[^}]*opacity:\s*var\(--bubble-opacity/);
  const chat = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(chat, /classList\.toggle\('chat--translucent', pct < 100\)/, 'con 100 % no hay ninguna regla nueva en juego');
});
