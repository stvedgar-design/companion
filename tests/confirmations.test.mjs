import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheetSrc = readFileSync(new URL('../www/js/ui/character-sheet.js', import.meta.url), 'utf8');
const lookSrc = readFileSync(new URL('../www/js/ui/character-look.js', import.meta.url), 'utf8');
const editorSrc = readFileSync(new URL('../www/js/ui/character-editor.js', import.meta.url), 'utf8');
const gallerySrc = readFileSync(new URL('../www/js/ui/character-gallery.js', import.meta.url), 'utf8');
const chatsSrc = readFileSync(new URL('../www/js/ui/chats.js', import.meta.url), 'utf8');
const chatSrc = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
const memSrc = readFileSync(new URL('../www/js/ui/character-memory.js', import.meta.url), 'utf8');

test('UX-CONFIRM: character-sheet incluye confirmación en Editar, Duplicar y Editar apariencia', () => {
  assert.match(sheetSrc, /editBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(sheetSrc, /duplicateBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(sheetSrc, /appearanceBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: character-look incluye confirmación en Guardar y Borrar todo', () => {
  assert.match(lookSrc, /saveBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(lookSrc, /clearBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: character-editor incluye confirmación al guardar cambios en personaje existente', () => {
  assert.match(editorSrc, /function renderEditScreen[\s\S]*?saveBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: character-gallery incluye confirmación en Guardar nota, Usar como fondo, Usar como avatar y Eliminar foto', () => {
  assert.match(gallerySrc, /saveNoteBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(gallerySrc, /setBgBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(gallerySrc, /setAvatarBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(gallerySrc, /deleteBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: chats.js incluye confirmación en Renombrar, Guardar título, Restaurar y Borrar episodio', () => {
  assert.match(chatsSrc, /rename\.addEventListener\('click',\s*async\s*\(e\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatsSrc, /saveBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatsSrc, /restore\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatsSrc, /async function onDelete\(chat\)\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: chat.js incluye confirmación en editar mensaje, guardar edición/borrado, restaurar episodio, editar recuerdo y restaurar recuerdo archivado', () => {
  assert.match(chatSrc, /if \(action === 'edit'\)\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatSrc, /function openEditSheet[\s\S]*?saveBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatSrc, /async function onRestoreEpisode\(\)\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatSrc, /function openLoreEdit[\s\S]*?saveBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
  assert.match(chatSrc, /function openLoreArchiveSheet[\s\S]*?restoreBtn\.addEventListener\('click',\s*async\s*\(\)\s*=>\s*\{[\s\S]*?app\.confirmDialog/);
});

test('UX-CONFIRM: character-memory.js consulta hooks.confirmDialog antes de ejecutar editar, archivar, pulir o regenerar', () => {
  assert.match(memSrc, /hooks\.confirmDialog/);
  assert.match(memSrc, /¿Editar el estado de la relación\?/);
  assert.match(memSrc, /¿Regenerar el estado de la relación con el modelo\?/);
  assert.match(memSrc, /¿Editar este recuerdo\?/);
  assert.match(memSrc, /¿Archivar este recuerdo\?/);
});
