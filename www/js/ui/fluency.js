// www/js/ui/fluency.js
// UI-001: "Prueba de fluidez" (Ajustes). Desplaza solo la lista de mensajes durante unos segundos y mide cuánto tarda cada
// cuadro. Sobre el chat abierto si lo hay; si no, sobre un chat sintético de 80 mensajes creado (y borrado) aquí mismo.
// No lee ni guarda datos del usuario y no envía nada a ningún lado: el resultado es solo texto para copiar.

import { summarizeFrames, formatFluencyReport, stepScroll, estimateRowHeight, charsPerBubbleLine } from '../perf.js';
import { formatMessage } from './format.js';

export const FLUENCY_SECONDS = 5;
export const SYNTHETIC_ROWS = 80;
const WARMUP_FRAMES = 2;
const NO_FRAME_TIMEOUT_MS = 1500;

const ACTIONS = ['Sonrío y me acomodo el pelo.', 'Levanto una ceja, divertida.', 'Me inclino hacia adelante, curiosa.', 'Suspiro y miro por la ventana.'];
const TALK = ['Hola, ¿cómo estás hoy?', 'Eso suena a mentira, pero te creo.', 'Cuéntame más, tengo toda la noche.', 'Está bien, lo intentaremos otra vez mañana, pero prométeme que no te vas a rendir.'];

// Chat de prueba: mismas clases que el chat real (así el CSS del skin activo, `content-visibility` incluido, se aplica igual).
function buildSyntheticList(host, count) {
  const list = document.createElement('div');
  list.className = 'scroll chat-messages';
  list.style.cssText = 'height:280px;border-radius:var(--radius-md, 12px);margin-top:8px;';
  host.appendChild(list);
  const perLine = charsPerBubbleLine(list.clientWidth);
  for (let i = 0; i < count; i++) {
    const role = i % 2 ? 'user' : 'char';
    let text = `*${ACTIONS[i % ACTIONS.length]}* ${TALK[(i * 3) % TALK.length]}`;
    if (i % 3 === 0) text += ` *${ACTIONS[(i + 1) % ACTIONS.length]}* ${TALK[(i + 1) % TALK.length]}`;
    const row = document.createElement('div');
    row.className = 'chat-row ' + (role === 'user' ? 'chat-row--user' : 'chat-row--char');
    row.style.setProperty('--row-h', estimateRowHeight(text, perLine) + 'px');
    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    bubble.innerHTML = formatMessage(text, { role, quoteDialogue: false });
    row.appendChild(bubble);
    list.appendChild(row);
  }
  return list;
}

/**
 * Ejecuta la prueba. `host` es el elemento donde crear el chat de prueba si no hay un chat abierto.
 * Devuelve `{ text, summary }`; `text` es el informe en lenguaje llano.
 * @param {{ host: HTMLElement, seconds?: number }} opts
 */
export async function runFluencyTest({ host, seconds = FLUENCY_SECONDS }) {
  const chatList = document.getElementById('chat-messages');
  const chatOpen = !!chatList && chatList.offsetParent !== null && chatList.querySelector('.chat-row');
  const list = chatOpen ? chatList : buildSyntheticList(host, SYNTHETIC_ROWS);
  const rows = list.querySelectorAll('.chat-row').length;
  const startTop = list.scrollTop;
  const prevBehavior = list.style.scrollBehavior;
  list.style.scrollBehavior = 'auto';

  const deltas = [];
  await new Promise((resolve) => {
    let pos = list.scrollTop;
    let dir = 1;
    let last = 0;
    let frame = 0;
    let began = 0;
    const timeoutId = setTimeout(() => resolve(), NO_FRAME_TIMEOUT_MS + seconds * 1000 + 500); // por si la pantalla no dibuja (segundo plano)
    const tick = (now) => {
      if (!began) began = now;
      if (last) {
        const dt = now - last;
        frame++;
        if (frame > WARMUP_FRAMES) deltas.push(dt);
        const s = stepScroll({ pos, dir, dtMs: dt, max: list.scrollHeight - list.clientHeight });
        pos = s.pos;
        dir = s.dir;
        list.scrollTop = pos;
      }
      last = now;
      if (now - began < seconds * 1000) requestAnimationFrame(tick);
      else {
        clearTimeout(timeoutId);
        resolve();
      }
    };
    requestAnimationFrame(tick);
  });

  list.style.scrollBehavior = prevBehavior;
  if (chatOpen) list.scrollTop = startTop;
  else list.remove();

  const summary = summarizeFrames(deltas);
  const text = formatFluencyReport(summary, {
    theme: document.documentElement.dataset.theme,
    mode: document.documentElement.dataset.mode,
    source: chatOpen ? 'chat' : 'synthetic',
    rows,
    seconds,
  });
  return { text, summary };
}
