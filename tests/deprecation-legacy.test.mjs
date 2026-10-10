import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sheetSrc = readFileSync(new URL('../www/js/ui/character-sheet.js', import.meta.url), 'utf8');
const koboldSrc = readFileSync(new URL('../www/js/api/kobold.js', import.meta.url), 'utf8');
const chatSrc = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
const homeSrc = readFileSync(new URL('../www/js/ui/home.js', import.meta.url), 'utf8');
const memoryUiSrc = readFileSync(new URL('../www/js/ui/character-memory.js', import.meta.url), 'utf8');
const lorebookSrc = readFileSync(new URL('../www/js/api/lorebook.js', import.meta.url), 'utf8');

test('DEPRECATION: character-sheet.js no muestra campo rígido de Relación ni Su día', () => {
  assert.ok(!sheetSrc.includes('Relación:'));
  assert.ok(!sheetSrc.includes('Su día:'));
  assert.ok(!sheetSrc.includes('identityProposal'));
  assert.match(sheetSrc, /Diario de recuerdos de/);
});

test('DEPRECATION: kobold.js no inyecta directiva rígida de relationship ni sobreescribe muestreadores', () => {
  assert.match(koboldSrc, /relationship\s*=\s*null;/);
  // No debe forzar samplers en client-side
  assert.ok(!koboldSrc.includes('top_p:'));
  assert.ok(!koboldSrc.includes('top_k:'));
  assert.ok(!koboldSrc.includes('rep_pen:'));
});

test('DEPRECATION: chat.js no muestra tarjetas de nivel RPG, propuesta de identidad ni resumen invasivo en la cabecera de memoria', () => {
  assert.ok(!chatSrc.includes('wrap.appendChild(buildRelationshipBlock'));
  assert.ok(!chatSrc.includes('wrap.appendChild(buildIdentityCard'));
  assert.ok(!chatSrc.includes('wrap.appendChild(buildContinuityCard'));
  assert.match(chatSrc, /Diario vivo de vivencias/);
});

test('DEPRECATION: home.js no dispara síntesis de identidad ni generación sintética de vida en background y auto-registra contexto', () => {
  assert.ok(!homeSrc.includes('maybeSynthesizeIdentities'));
  assert.ok(!homeSrc.includes('maybeWriteLife'));
  assert.match(homeSrc, /if\s*\(ctx\s*&&\s*ctx\s*!==\s*settings\.ctx\)/);
});

test('DEPRECATION: chat.js no ejecuta maybeSaveMoment con comillas en segundo plano', () => {
  assert.match(chatSrc, /function maybeSaveMoment\([^)]*\)\s*\{\s*\/\/\s*Deprecado/);
});

test('DEPRECATION: memory cards y modales no tienen botón ni residuo de pulir ni referencias a modelos concretos', () => {
  assert.ok(!memoryUiSrc.includes('Pulir'));
  assert.ok(!memoryUiSrc.includes('✨'));
  assert.ok(!chatSrc.includes('✨'));
  assert.ok(!chatSrc.includes('Llama 3B'));
});

test('DEPRECATION: parseExtractionResponse tolera bloques markdown y etiquetas think de Qwen 3.5', () => {
  assert.ok(lorebookSrc.includes('<think>'));
  assert.ok(lorebookSrc.includes('```'));
});
