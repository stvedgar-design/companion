import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const baseCss = readFileSync(new URL('../www/css/base.css', import.meta.url), 'utf8');
const chatCss = readFileSync(new URL('../www/css/chat.css', import.meta.url), 'utf8');
const chatJs = readFileSync(new URL('../www/js/ui/chat.js', import.meta.url), 'utf8');
const charMemJs = readFileSync(new URL('../www/js/ui/character-memory.js', import.meta.url), 'utf8');

test('FASE 13 - Módulo 1: .view.is-active tiene transición cinética acelerada por GPU y respeta reduced-motion', () => {
  assert.match(baseCss, /\.view\.is-active\s*\{[^}]*animation:\s*view-fade-in/);
  assert.match(baseCss, /@keyframes view-fade-in\s*\{/);
  assert.match(baseCss, /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.view\.is-active\s*\{\s*animation:\s*none;\s*\}\s*\}/);
});

test('FASE 13 - Módulo 2: Rompehielos contextuales para chats vacíos en template, script y estilos', () => {
  assert.match(chatJs, /id="chat-icebreakers"/, 'el template tiene el contenedor de rompehielos');
  assert.match(chatJs, /function renderIcebreakers\(\)/, 'función de render de sugerencias');
  assert.match(chatJs, /function hideIcebreakers\(\)/, 'función de desvanecimiento suave');
  assert.match(chatJs, /function getIcebreakerSuggestions\(\)/, 'generador de sugerencias contextuales');
  assert.match(chatCss, /\.chat-icebreakers\s*\{/, 'estilos del contenedor de rompehielos');
  assert.match(chatCss, /\.chat-icebreaker-pill\s*\{/, 'estilos de las píldoras de sugerencia');
});

test('FASE 13 - Módulo 3: deleteMessage en chat.js utiliza confirmDialog modal en vez de borrar directo', () => {
  assert.match(chatJs, /async function deleteMessage\(i\)\s*\{[\s\S]*?app\.confirmDialog\(/);
  assert.match(chatJs, /danger:\s*true/);
});

test('FASE 13 - Módulo 4: Botón de scroll al fondo utiliza desplazamiento suave y respuesta háptica', () => {
  assert.match(chatJs, /scrollDown\.addEventListener\('click',\s*\(\)\s*=>\s*\{[^}]*haptics\.tap\(\)[^}]*scrollToBottom\(true,\s*true\)/);
  assert.match(chatJs, /behavior:\s*'smooth'/);
  assert.match(chatJs, /const NEAR_BOTTOM_PX = 200;/);
});

test('FASE 13 - Módulo 5: Pulido editorial en Ficha de Memoria con bisel y micro-animación de salida', () => {
  assert.match(baseCss, /\.mem-card\s*\{[^}]*box-shadow:\s*inset 0 1px 0 0 rgba\(255, 238, 225, 0\.08\)/);
  assert.match(baseCss, /\.mem-card\.is-leaving\s*\{/);
  assert.match(baseCss, /\.mem-actions \.btn\s*\{[^}]*font-family:\s*var\(--font-ui/);
  assert.match(charMemJs, /card\.classList\.add\('is-leaving'\)/);
});

test('FASE 13 - Módulo 6: Estabilidad ante teclado virtual móvil con scroll-padding-bottom', () => {
  assert.match(chatCss, /\.chat-messageswrap\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--composer-h,\s*60px\)\s*\+\s*var\(--sab,\s*0px\)\)/);
  assert.match(chatCss, /\.chat-messages\s*\{[^}]*scroll-padding-bottom:\s*calc\(var\(--composer-h,\s*60px\)\s*\+\s*var\(--sab,\s*0px\)\)/);
});
