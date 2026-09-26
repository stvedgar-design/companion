// www/js/diagnostics/runner.js
// UI-005: orquesta una corrida del banco de pruebas de estrés: mantiene la pantalla encendida, ejecuta las fases del perfil
// (con repeticiones y pausas de enfriamiento en la Extendida), guarda el progreso tras cada fase para poder reanudar, arma el
// informe y LIMPIA (borra la base aislada, devuelve el aspecto del usuario). Solo usa el almacén aislado (`isolated.js`).

import { createDiagState, wipeDiagDb } from './isolated.js';
import { wipeAll } from './dataphases.js';
import { DOM_PHASES, DiagAbort, createStage } from './domphases.js';
import { PROFILES, phasesFor, newProgress, nextPhase, recordPhase, parseHardware, buildReport } from './plan.js';
import { makeMessages, makeSyntheticCard } from './synth.js';
import { saveProgress, clearProgress, saveRun } from './store.js';
import { generateReplyNonEmpty, connect } from '../api/kobold.js';
import { APP_VERSION } from '../version.js';
import { summarizeFrames, formatFluencyReport } from '../perf.js';
import { buildSyntheticRow } from '../ui/fluency.js';
import { charsPerBubbleLine } from '../perf.js';

const sleepMs = (ms) => new Promise((r) => setTimeout(r, ms));

// Máximo que puede tardar una fase (una repetición) antes de darla por colgada (p. ej. la app pasó a segundo plano y algo no terminó).
export const PHASE_WATCHDOG_MS = 6 * 60 * 1000;

/** Si la app no está visible (segundo plano, pantalla apagada) las mediciones no valen: se espera a que vuelva. */
async function waitVisible(status, signal) {
  if (document.visibilityState === 'visible') return;
  status('La app está en segundo plano: vuelve a abrirla para continuar (o cancela la prueba)…');
  await new Promise((resolve) => {
    const done = () => {
      document.removeEventListener('visibilitychange', on);
      if (signal) signal.removeEventListener('abort', done);
      resolve();
    };
    const on = () => {
      if (document.visibilityState === 'visible') done();
    };
    document.addEventListener('visibilitychange', on);
    if (signal) signal.addEventListener('abort', done); // cancelar siempre funciona, aunque la app siga en segundo plano
  });
}

// Ejecuta `fn(env)` con su propio "token": si vence el tiempo, la fase se da por fallida y sus llamadas a `check()` lanzan, así una
// fase colgada no sigue tocando el escenario mientras corre la siguiente.
function runWithWatchdog(baseEnv, fn, ms) {
  const token = { dead: false };
  const env = { ...baseEnv, check: () => { baseEnv.check(); if (token.dead) throw new Error('fase descartada por tiempo'); } };
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      token.dead = true;
      reject(new Error('la fase tardó demasiado (¿la app pasó a segundo plano?).'));
    }, ms);
    fn(env).then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

/** Datos del equipo que el WebView expone. Nada sale del teléfono. */
export async function collectHardware() {
  const raw = {
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: navigator.deviceMemory,
    screenWidth: screen.width,
    screenHeight: screen.height,
    devicePixelRatio: window.devicePixelRatio,
  };
  try {
    const hi = navigator.userAgentData && navigator.userAgentData.getHighEntropyValues ? await navigator.userAgentData.getHighEntropyValues(['model', 'platformVersion']) : null;
    if (hi) {
      raw.uaModel = hi.model;
      raw.uaPlatformVersion = hi.platformVersion;
    }
  } catch {
    /* sin datos de alta entropía: se usa el user agent */
  }
  return parseHardware(raw);
}

/**
 * Pide mantener la pantalla encendida (Screen Wake Lock del WebView). No hay plugin nativo: si el WebView no lo ofrece o lo rechaza
 * se devuelve 'unsupported'/'denied' y el informe lo dice (habría que ajustar el bloqueo de pantalla del teléfono a mano).
 * @returns {Promise<{ status: 'acquired'|'unsupported'|'denied', release: () => void }>}
 */
export async function acquireWakeLock() {
  if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return { status: 'unsupported', release() {} };
  let sentinel = null;
  let released = false;
  const request = async () => {
    sentinel = await navigator.wakeLock.request('screen');
  };
  try {
    await request();
  } catch {
    return { status: 'denied', release() {} };
  }
  // El sistema suelta el bloqueo si la app pasa a segundo plano: se vuelve a pedir al regresar.
  const onVisible = () => {
    if (!released && document.visibilityState === 'visible' && (!sentinel || sentinel.released)) request().catch(() => {});
  };
  document.addEventListener('visibilitychange', onVisible);
  return {
    status: 'acquired',
    release() {
      released = true;
      document.removeEventListener('visibilitychange', onVisible);
      try {
        if (sentinel) sentinel.release();
      } catch {
        /* nada */
      }
    },
  };
}

// ---------- fase con servidor (opcional) ----------

async function phaseServer(env, settings) {
  if (!settings || !settings.url) return { skipped: 'no hay un servidor configurado.' };
  env.status('Buscando tu servidor…');
  try {
    await Promise.race([connect(settings.url), new Promise((_, rej) => setTimeout(() => rej(new Error('tiempo')), 4000))]);
  } catch {
    return { skipped: 'el servidor no respondió (¿está apagado?). Se puede repetir con el servidor encendido.' };
  }
  const character = { name: 'Prueba', card: makeSyntheticCard(0), lorebook: [] };
  const chat = { scenario: '', continuitySummary: null };
  const sizes = [];
  for (const size of env.profile.serverSizes) {
    env.check();
    env.status(`Pidiendo una respuesta en un chat de ${size} mensajes (una a la vez)…`);
    const messages = makeMessages(size, { seed: 1000 }); // mismo chat que va creciendo: cada tamaño es un prefijo del siguiente
    const t0 = performance.now();
    let first = 0;
    let chars = 0;
    try {
      const result = await generateReplyNonEmpty({
        character, chat, messages, settings, signal: env.signal,
        onToken: (chunk) => { if (!first) first = performance.now(); chars += chunk.length; },
      });
      if (env.signal && env.signal.aborted) throw new DiagAbort();
      sizes.push({ size, ttftMs: first ? first - t0 : performance.now() - t0, totalMs: performance.now() - t0, chars: (result && result.text ? result.text.length : chars) });
    } catch (err) {
      if (err instanceof DiagAbort || (env.signal && env.signal.aborted)) throw new DiagAbort();
      return sizes.length ? { reps: [{ sizes }], partialError: err.message } : { failed: err.message || 'error del servidor' };
    }
  }
  return { reps: [{ sizes }] };
}

/**
 * Ejecuta (o reanuda) una corrida completa.
 * @param {{
 *   profileId: 'quick'|'full'|'extended',
 *   resume?: object,                  // progreso guardado a continuar
 *   host: HTMLElement,                // contenedor a pantalla completa donde se dibuja el escenario
 *   signal: AbortSignal,              // para cancelar
 *   settings: object|null,            // ajustes reales SOLO para la fase con servidor (URL, modo, ctx…); no se guardan en el informe
 *   onStatus: (text: string) => void,
 *   onPhase: (info: { index: number, total: number, title: string, plain: string, rep: number, reps: number }) => void,
 * }} opts
 * @returns {Promise<object>} la corrida (ver `buildReport`)
 */
export async function runStressTest({ profileId, resume, host, signal, settings, onStatus, onPhase }) {
  const profile = PROFILES[profileId] || PROFILES.quick;
  const html = document.documentElement;
  const theme = html.dataset.theme;
  const mode = html.dataset.mode;

  await wipeDiagDb(); // parte siempre de cero: cualquier resto de una prueba anterior se descarta
  const state = createDiagState();
  const wake = await acquireWakeLock();
  const hardware = resume && resume.hardware ? resume.hardware : await collectHardware();
  let progress = resume ? { ...resume, interrupted: true } : newProgress({ profile: profile.id, theme, mode, appVersion: APP_VERSION, hardware });
  progress.wakeLock = wake.status;
  progress.profile = profile.id;
  saveProgress(progress);

  const stage = createStage(host);
  const env = {
    state, profile, stage, shared: {}, signal,
    status: (t) => onStatus && onStatus(t),
    check: () => { if (signal && signal.aborted) throw new DiagAbort(); },
    sleep: sleepMs,
  };

  try {
    const all = phasesFor(profile.id);
    for (;;) {
      const phase = nextPhase(progress);
      if (!phase) break;
      const index = all.findIndex((p) => p.id === phase.id);
      const reps = phase.id === 'server' || phase.id === 'endurance' ? 1 : profile.reps;
      let result;
      try {
        if (phase.id === 'server') {
          await waitVisible(env.status, signal);
          onPhase && onPhase({ index, total: all.length, title: phase.title, plain: phase.plain, rep: 1, reps: 1 });
          result = await phaseServer(env, settings);
        } else {
          const repResults = [];
          for (let rep = 1; rep <= reps; rep++) {
            env.check();
            if (rep > 1) {
              for (let left = Math.round(profile.cooldownMs / 1000); left > 0; left--) {
                env.status(`Enfriando el teléfono… ${left} s`);
                await sleepMs(1000);
                env.check();
              }
            }
            await waitVisible(env.status, signal);
            onPhase && onPhase({ index, total: all.length, title: phase.title, plain: phase.plain, rep, reps });
            await wipeAll(state); // cada repetición parte del mismo estado: sin datos de la anterior
            stage.list.replaceChildren();
            repResults.push(await runWithWatchdog(env, DOM_PHASES[phase.id], PHASE_WATCHDOG_MS));
          }
          result = { reps: repResults };
        }
      } catch (err) {
        if (err instanceof DiagAbort) throw err;
        result = { failed: (err && err.message) || 'error inesperado' };
      }
      progress = recordPhase(progress, phase.id, result);
      saveProgress(progress);
    }
    const run = {
      profile: profile.id, startedAt: progress.startedAt, finishedAt: Date.now(), appVersion: progress.appVersion || APP_VERSION,
      theme: progress.theme || theme, mode: progress.mode || mode, hardware: progress.hardware || hardware, wakeLock: progress.wakeLock,
      interrupted: !!progress.interrupted, results: progress.results,
    };
    run.report = buildReport(run).text;
    saveRun(run);
    clearProgress();
    return run;
  } catch (err) {
    if (err instanceof DiagAbort) clearProgress(); // cancelada a propósito: no hay nada que reanudar
    throw err;
  } finally {
    wake.release();
    stage.list.remove();
    await wipeDiagDb(); // limpieza: la base aislada desaparece (si la app muere antes, se borra al abrirla de nuevo)
  }
}

/**
 * Prueba opcional "con el dedo": un chat sintético en el que el usuario desliza ~`seconds` s; se miden los cuadros MIENTRAS se mueve.
 * @returns {Promise<{ text: string, summary: object, scrolledPx: number }>}
 */
export async function runFingerTest({ host, seconds = 30, signal, onTick }) {
  const stage = createStage(host);
  const perLine = charsPerBubbleLine(stage.list.clientWidth);
  const frag = document.createDocumentFragment();
  for (const m of makeMessages(300, { seed: 42 })) frag.appendChild(buildSyntheticRow(m.role, m.text, perLine));
  stage.list.appendChild(frag);
  const deltas = [];
  let scrolled = 0;
  await new Promise((resolve) => {
    let last = 0;
    let lastTop = stage.list.scrollTop;
    let lastMove = 0;
    let began = 0;
    const tick = (now) => {
      if (!began) began = now;
      if (last) {
        const top = stage.list.scrollTop;
        if (top !== lastTop) {
          scrolled += Math.abs(top - lastTop);
          lastTop = top;
          lastMove = now;
        }
        if (now - lastMove < 150 && lastMove) deltas.push(now - last); // solo cuadros mientras se mueve
      }
      last = now;
      const left = seconds - (now - began) / 1000;
      if (onTick) onTick(Math.max(0, Math.ceil(left)));
      if (left > 0 && !(signal && signal.aborted)) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  stage.list.remove();
  const summary = summarizeFrames(deltas);
  let text = formatFluencyReport(summary, { theme: document.documentElement.dataset.theme, mode: document.documentElement.dataset.mode, source: 'synthetic', rows: 300, seconds }).replace('desplazamiento automático', 'deslizando con el dedo');
  if (scrolled < 3000) text += '\nOjo: deslizaste poco (menos de 3.000 px); los números pueden no ser representativos.';
  return { text, summary, scrolledPx: Math.round(scrolled) };
}

/** Borra la base aislada y descarta un progreso guardado (al descartar una corrida interrumpida). */
export async function discardInterrupted() {
  clearProgress();
  return wipeDiagDb();
}
