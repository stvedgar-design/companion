// www/js/diagnostics/domphases.js
// UI-005: fases del banco de pruebas de estrés que necesitan pantalla (dibujar, desplazar, repintar). Todas trabajan sobre un
// "escenario" propio (`createStage`), NUNCA sobre el chat ni el hub reales, y con datos sintéticos. Reciben `env` (ver runner.js).
// No hay un test de Node de estas funciones (necesitan un navegador): se verifican en el navegador integrado; ver docs/HISTORIAL.md.

import { summarizeFrames, createThrottle, STREAM_PAINT_MS, charsPerBubbleLine } from '../perf.js';
import { formatMessage } from '../ui/format.js';
import { buildSyntheticRow, driveScroll } from '../ui/fluency.js';
import { makeMessages, makeStreamChunks } from './synth.js';
import { dataChats, dataBurst, dataHub, dataBackup } from './dataphases.js';
import { summarizeTimes, mean, themeLabel } from './plan.js';

// Los mismos skins y modos que `ui/shell.js` (THEMES) y `themes.css`.
export const THEMES = ['penumbra-claude']; // UI-024: un solo skin (antes 5); los archivados no se cargan, así que no se pueden medir
export const MODES = ['dark', 'light'];

/** Se lanza cuando el usuario cancela; el runner la reconoce y limpia. */
export class DiagAbort extends Error {
  constructor() {
    super('Prueba cancelada.');
    this.name = 'DiagAbort';
  }
}

const now = () => performance.now();
const nextFrame = () => new Promise((resolve) => {
  const t = setTimeout(resolve, 120); // si la pantalla no dibuja (segundo plano) no se cuelga
  requestAnimationFrame(() => { clearTimeout(t); resolve(); });
});

/** Escenario: una lista con las clases del chat real, que llena el espacio disponible de `host`. */
export function createStage(host) {
  const list = document.createElement('div');
  list.className = 'scroll chat-messages';
  list.style.cssText = 'flex:1;min-height:0;';
  host.appendChild(list);
  return { list, perLine: () => charsPerBubbleLine(list.clientWidth) };
}

function buildRows(messages, perLine) {
  const frag = document.createDocumentFragment();
  for (const m of messages) frag.appendChild(buildSyntheticRow(m.role, m.text, perLine));
  return frag;
}

/** Dibuja todos los mensajes en la lista y mide cuánto tarda (construir + insertar + calcular el layout). */
function renderAll(stage, messages) {
  const t0 = now();
  const frag = buildRows(messages, stage.perLine());
  const buildMs = now() - t0;
  stage.list.replaceChildren(frag);
  void stage.list.scrollHeight; // fuerza el layout: cuenta como costo de dibujar
  return { buildMs, renderMs: now() - t0, nodes: stage.list.getElementsByTagName('*').length };
}

// Avatares sintéticos: pocas imágenes distintas (JPEG de 256 px, como los avatares reales) reutilizadas.
const avatarCache = [];
export function makeAvatar(i) {
  const k = i % 6;
  if (avatarCache[k] !== undefined) return avatarCache[k];
  let url = '';
  try {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const hue = (k * 57) % 360;
    const grad = g.createLinearGradient(0, 0, 256, 256);
    grad.addColorStop(0, `hsl(${hue} 60% 35%)`);
    grad.addColorStop(1, `hsl(${(hue + 60) % 360} 70% 60%)`);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    for (let n = 0; n < 24; n++) {
      g.fillStyle = `hsla(${(hue + n * 15) % 360} 70% 70% / 0.35)`;
      g.beginPath();
      g.arc(((n * 97 + k * 31) % 256), ((n * 53 + k * 71) % 256), 12 + ((n * 7) % 40), 0, Math.PI * 2);
      g.fill();
    }
    url = c.toDataURL('image/jpeg', 0.8);
  } catch {
    url = '';
  }
  avatarCache[k] = url;
  return url;
}

// ---------- fase 1: chats largos ----------

export async function phaseChats(env) {
  env.status('Creando chats de prueba…');
  const stage = env.stage;
  const { rows, messagesBySize } = await dataChats({ state: env.state, sizes: env.profile.chatSizes });
  env.check();
  const sizes = [];
  for (const row of rows) {
    env.status(`Dibujando el chat de ${row.size} mensajes…`);
    await nextFrame();
    const r = renderAll(stage, messagesBySize[row.size]);
    await nextFrame();
    sizes.push({ size: row.size, genMs: row.genMs, saveMs: row.saveMs, loadMs: row.loadMs, sizeKB: row.sizeKB, buildMs: r.buildMs, renderMs: r.renderMs, nodes: r.nodes });
    env.check();
  }
  env.shared.messagesBySize = messagesBySize; // se reutiliza en la fase de desplazamiento
  return { sizes };
}

// ---------- fase 2: desplazamiento ----------

export async function phaseScroll(env) {
  const stage = env.stage;
  const big = Math.max(...env.profile.chatSizes);
  const messages = (env.shared.messagesBySize && env.shared.messagesBySize[big]) || makeMessages(big, { seed: 42 });
  renderAll(stage, messages);
  await nextFrame();
  const speeds = [];
  for (const speed of env.profile.scrollSpeeds) {
    env.check();
    env.status(`Desplazando (${speed} px/s)…`);
    stage.list.scrollTop = 0;
    await nextFrame();
    const deltas = await driveScroll(stage.list, env.profile.scrollSeconds, speed);
    speeds.push({ speedPxS: speed, ...summarizeFrames(deltas) });
  }
  return { speeds };
}

// ---------- fase 3: respuesta llegando ----------

// Entrega los fragmentos a `perSecond` por segundo (corrigiendo la deriva del reloj) y llama a `onChunk(chunk)`.
async function deliver(chunks, perSecond, onChunk, env) {
  const gap = 1000 / perSecond;
  const start = now();
  for (let i = 0; i < chunks.length; i++) {
    const wait = start + i * gap - now();
    if (wait > 1) await env.sleep(wait);
    onChunk(chunks[i]);
    if (i % 20 === 0) env.check();
  }
}

export async function phaseStreaming(env) {
  const { list } = env.stage;
  const chunks = makeStreamChunks(env.profile.streamWords);
  const runs = [];
  for (const tps of env.profile.streamTokensPerSec) {
    for (const mode of ['perFragment', 'throttled']) {
      env.check();
      env.status(`Simulando una respuesta (${tps} fragmentos/s, ${mode === 'perFragment' ? 'repintando siempre' : 'con el ritmo de la app'})…`);
      list.replaceChildren();
      const row = buildSyntheticRow('char', '*.*', 30);
      const bubble = row.firstElementChild;
      list.appendChild(row);
      let text = '';
      const costs = [];
      const paint = () => {
        const t = now();
        bubble.innerHTML = formatMessage(text, { role: 'char', quoteDialogue: false });
        void list.scrollHeight;
        list.scrollTop = list.scrollHeight;
        costs.push(now() - t);
      };
      const throttle = createThrottle(paint, STREAM_PAINT_MS);
      const t0 = now();
      await deliver(chunks, tps, (c) => {
        text += c;
        if (mode === 'perFragment') paint();
        else throttle.schedule();
      }, env);
      if (mode === 'throttled') {
        await env.sleep(STREAM_PAINT_MS + 20); // deja vaciar la cola final
        throttle.flush();
      }
      const s = summarizeTimes(costs);
      runs.push({ tokensPerSec: tps, mode, ...(mode === 'throttled' ? { paintEveryMs: STREAM_PAINT_MS } : {}), updates: s.n, meanMs: s.meanMs, p95Ms: s.p95Ms, maxMs: s.maxMs, totalMs: Math.round(now() - t0), chars: text.length });
    }
  }
  return { runs };
}

// ---------- fase 4: ráfaga de mensajes ----------

export async function phaseBurst(env) {
  const { list } = env.stage;
  list.replaceChildren();
  env.status(`Enviando ${env.profile.burstCount} mensajes seguidos…`);
  const perLine = env.stage.perLine();
  const r = await dataBurst({
    state: env.state,
    count: env.profile.burstCount,
    renderStep: async (i, m) => {
      const t = now();
      list.appendChild(buildSyntheticRow(m.role, m.text, perLine));
      void list.scrollHeight;
      list.scrollTop = list.scrollHeight;
      const dt = now() - t;
      if (i % 10 === 0) env.check();
      await env.sleep(0); // cede el turno como lo haría la app entre mensajes
      return dt;
    },
  });
  const save = summarizeTimes(r.saveTimes);
  const render = summarizeTimes(r.renderTimes);
  return { count: r.count, saveMeanMs: save.meanMs, saveP95Ms: save.p95Ms, saveMaxMs: save.maxMs, renderMeanMs: render.meanMs, renderP95Ms: render.p95Ms, renderMaxMs: render.maxMs, stored: r.stored };
}

// ---------- fase 5: los aspectos (UI-024: un skin × claro/oscuro = 2; antes 10) ----------

export async function phaseSkins(env) {
  const stage = env.stage;
  const html = document.documentElement;
  const original = { theme: html.dataset.theme, mode: html.dataset.mode };
  const combos = [];
  try {
    renderAll(stage, makeMessages(env.profile.skinListSize, { seed: 42 }));
    for (const theme of THEMES) {
      for (const mode of MODES) {
        env.check();
        env.status(`Probando ${themeLabel(theme, mode)}…`);
        html.dataset.theme = theme;
        html.dataset.mode = mode;
        await nextFrame();
        await nextFrame();
        stage.list.scrollTop = 0;
        const deltas = await driveScroll(stage.list, env.profile.skinSeconds, 3000);
        combos.push({ theme, mode, ...summarizeFrames(deltas) });
      }
    }
  } finally {
    // Siempre se devuelve el aspecto que tenía el usuario (también si se cancela o falla).
    if (original.theme) html.dataset.theme = original.theme; else delete html.dataset.theme;
    if (original.mode) html.dataset.mode = original.mode; else delete html.dataset.mode;
  }
  return { combos };
}

// ---------- fase 6: lista de personajes ----------

function buildHubCard(character) {
  const card = document.createElement('div');
  card.className = 'home-card';
  const avatar = document.createElement('div');
  avatar.className = 'home-card__avatar';
  if (character.avatar) {
    const img = document.createElement('img');
    img.src = character.avatar;
    img.alt = '';
    avatar.appendChild(img);
  }
  const scrim = document.createElement('div');
  scrim.className = 'home-card__scrim';
  const name = document.createElement('div');
  name.className = 'home-card__name';
  name.textContent = character.name;
  const sub = document.createElement('div');
  sub.className = 'home-card__sub';
  sub.textContent = 'Sin mensajes';
  scrim.append(name, sub);
  avatar.appendChild(scrim);
  const row = document.createElement('div');
  row.className = 'home-card__row';
  const btn = document.createElement('button');
  btn.className = 'btn btn--sm home-card__continue';
  btn.type = 'button';
  btn.textContent = 'Continuar';
  row.appendChild(btn);
  card.append(avatar, row);
  return card;
}

export async function phaseHub(env) {
  const counts = [];
  for (const count of env.profile.hubCounts) {
    env.check();
    env.status(`Creando ${count} personajes de prueba…`);
    const d = await dataHub({ state: env.state, count, makeAvatar });
    env.status(`Dibujando la lista de ${count} personajes…`);
    // Contenedor con la misma estructura que el hub real (`.scroll > .home-grid > .home-card`).
    const scroller = document.createElement('div');
    scroller.className = 'scroll';
    scroller.style.cssText = 'flex:1;min-height:0;';
    const grid = document.createElement('div');
    grid.className = 'home-grid';
    scroller.appendChild(grid);
    env.stage.list.replaceWith(scroller);
    try {
      let t = now();
      const frag = document.createDocumentFragment();
      for (const c of d.characters) frag.appendChild(buildHubCard(c));
      grid.appendChild(frag);
      void scroller.scrollHeight;
      const buildMs = now() - t;
      t = now();
      const imgs = [...grid.querySelectorAll('img')];
      // `decode()` no termina si la app está en segundo plano: se limita a 8 s para que la fase nunca se cuelgue.
      await Promise.race([
        Promise.all(imgs.map((im) => (im.decode ? im.decode().catch(() => {}) : Promise.resolve()))),
        env.sleep(8000),
      ]);
      const decodeMs = now() - t;
      await nextFrame();
      const deltas = await driveScroll(scroller, env.profile.hubScrollSeconds, 2500);
      counts.push({ count, writeMs: d.writeMs, listMs: d.listMs, buildMs, decodeMs, ...summarizeFrames(deltas) });
    } finally {
      scroller.replaceWith(env.stage.list);
    }
  }
  return { counts };
}

// ---------- fase 7: copia de seguridad ----------

export async function phaseBackup(env) {
  env.status('Exportando e importando una copia de prueba…');
  const r = await dataBackup({ state: env.state, characters: 10, chats: 5, perChat: 300, makeAvatar });
  return r;
}

// ---------- fase 8: resistencia (solo Extendida) ----------

export function heapMB() {
  const m = typeof performance !== 'undefined' && performance.memory;
  return m && Number.isFinite(m.usedJSHeapSize) ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
}

export async function phaseEndurance(env) {
  const rounds = [];
  const short = { ...env.profile, scrollSpeeds: [3000], scrollSeconds: 3, streamTokensPerSec: [120], streamWords: 90, burstCount: 30, chatSizes: [300] };
  for (let i = 0; i < env.profile.enduranceRounds; i++) {
    env.check();
    env.status(`Resistencia: vuelta ${i + 1} de ${env.profile.enduranceRounds}…`);
    const sub = { ...env, profile: short };
    const c = await phaseChats(sub);
    void c;
    const s = await phaseScroll(sub);
    const st = await phaseStreaming(sub);
    const b = await phaseBurst(sub);
    const perFrag = st.runs.find((x) => x.mode === 'perFragment');
    rounds.push({
      scrollMeanMs: s.speeds[0].meanMs,
      streamMeanMs: perFrag ? perFrag.meanMs : mean(st.runs.map((x) => x.meanMs)),
      saveMeanMs: b.saveMeanMs,
      heapMB: heapMB(),
      domNodes: document.getElementsByTagName('*').length,
    });
  }
  return { rounds };
}

export const DOM_PHASES = {
  chats: phaseChats,
  scroll: phaseScroll,
  streaming: phaseStreaming,
  burst: phaseBurst,
  skins: phaseSkins,
  hub: phaseHub,
  backup: phaseBackup,
  endurance: phaseEndurance,
};
