// www/js/ui/diagnostics.js
// UI-005: pantallas del "Diagnóstico y rendimiento" (Ajustes): elegir la duración, ver el progreso a pantalla completa, leer y
// exportar el informe, compararlo con la corrida anterior y ofrecer reanudar una prueba interrumpida. La lógica vive en
// `www/js/diagnostics/` (pura y probada); aquí solo hay pantalla. Los datos de la prueba son sintéticos y viven en una base aparte.

import { PROFILES, estimateSeconds, phasesFor, isResumable, progressSummary, compareRuns, buildReport, describeResults, themeLabel } from '../diagnostics/plan.js';
import { loadRuns, loadProgress, clearProgress } from '../diagnostics/store.js';
import { runStressTest, runFingerTest, discardInterrupted } from '../diagnostics/runner.js';
import { saveBlob } from '../platform.js';
import { getSettings } from '../state.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const fmtDate = (t) => {
  const d = new Date(t);
  const p = (x) => String(x).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const minutes = (s) => (s < 90 ? `${Math.max(1, Math.round(s / 10) * 10)} segundos` : `${Math.round(s / 60)} minutos`);

// ---------- pantalla de entrada (hoja) ----------

export function openDiagnostics(app) {
  const node = el('div', 'settings');
  node.append(el('h3', 'sheet__title', 'Diagnóstico y rendimiento'));

  const intro = el('div', 'field__hint', 'Mide qué tan fluida va la app en este teléfono. Usa chats y personajes INVENTADOS que se crean en un lugar aparte y se borran solos al terminar: no toca ni muestra tus episodios. Nada sale del teléfono salvo que tú exportes el informe.');
  node.append(intro);

  const field = el('div', 'field');
  field.append(el('label', 'field__label', 'Duración'));
  let chosen = 'quick';
  for (const p of Object.values(PROFILES)) {
    const label = el('label');
    label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:8px 0';
    const input = document.createElement('input');
    input.type = 'radio';
    input.name = 'diag-profile';
    input.value = p.id;
    input.checked = p.id === chosen;
    input.style.cssText = 'accent-color:var(--color-accent, #8b1fe0);margin-top:3px';
    input.addEventListener('change', () => { chosen = p.id; });
    const text = el('span');
    text.append(el('b', '', p.label), document.createTextNode(` — ${p.approx}`));
    if (p.id === 'extended') text.append(el('div', 'field__hint', 'Repite cada fase 3 veces con pausas de 15 segundos para que el teléfono no se caliente de más, y busca si la app se pone más lenta con el uso.'));
    label.append(input, text);
    field.append(label);
  }
  node.append(field);

  node.append(el('div', 'field__hint', 'Antes de empezar: deja el teléfono cargando, con la pantalla encendida y sin otras apps abiertas. La app intentará mantener la pantalla encendida; si tu teléfono no lo permite, el informe lo dirá y conviene que pongas el bloqueo de pantalla en "nunca" mientras dure la prueba. Si tu servidor está encendido, al final se le harán algunas preguntas cortas (de a una por vez).'));

  const run = el('button', 'btn', 'Ejecutar prueba de estrés');
  run.type = 'button';
  run.addEventListener('click', () => startRun(app, chosen, null));
  node.append(run);

  const runs = loadRuns();
  if (runs.length) {
    const hist = el('div', 'field');
    hist.append(el('label', 'field__label', 'Corridas anteriores'));
    runs.slice(0, 6).forEach((r, i) => {
      const b = el('button', 'menu-item', `${fmtDate(r.finishedAt || r.startedAt)} · ${PROFILES[r.profile] ? PROFILES[r.profile].label : r.profile} · ${themeLabel(r.theme, r.mode)}`);
      b.type = 'button';
      b.addEventListener('click', () => showReport(app, r, runs[i + 1] || null));
      hist.append(b);
    });
    node.append(hist);
  }

  app.openSheet(node);
}

// ---------- ejecución (pantalla completa) ----------

function createOverlay(onCancelRequest) {
  const root = el('div', 'diag-overlay');
  root.style.cssText = 'position:fixed;inset:0;z-index:3000;display:flex;flex-direction:column;background:var(--color-bg);color:var(--color-text);font-family:var(--font)';
  const head = el('div');
  head.style.cssText = 'padding:12px 16px;display:flex;flex-direction:column;gap:4px;border-bottom:1px solid var(--color-line);flex:none';
  const title = el('b', '', 'Prueba de estrés');
  const plain = el('div', 'field__hint', '');
  const status = el('div', 'field__hint', '');
  const bar = document.createElement('div');
  bar.style.cssText = 'height:4px;border-radius:2px;background:var(--color-line);overflow:hidden';
  const fill = document.createElement('div');
  fill.style.cssText = 'height:100%;width:0;background:var(--color-accent)';
  bar.append(fill);
  const cancel = el('button', 'btn btn--ghost btn--sm', 'Cancelar prueba');
  cancel.type = 'button';
  cancel.style.alignSelf = 'flex-start';
  cancel.addEventListener('click', onCancelRequest);
  head.append(title, plain, status, bar, cancel);
  const stage = el('div');
  stage.style.cssText = 'flex:1;min-height:0;display:flex;flex-direction:column';
  root.append(head, stage);
  document.body.append(root);
  document.body.classList.add('diag-running');
  const onBack = () => onCancelRequest();
  document.addEventListener('companion:diag-back', onBack);
  return {
    stage,
    setTitle: (t) => { title.textContent = t; },
    setPlain: (t) => { plain.textContent = t; },
    setStatus: (t) => { status.textContent = t; },
    setProgress: (f) => { fill.style.width = `${Math.round(Math.max(0, Math.min(1, f)) * 100)}%`; },
    setCancelVisible: (v) => { cancel.hidden = !v; },
    remove() {
      document.removeEventListener('companion:diag-back', onBack);
      document.body.classList.remove('diag-running');
      root.remove();
    },
  };
}

async function startRun(app, profileId, resume) {
  app.closeSheet();
  const ctl = new AbortController();
  let asking = false;
  const overlay = createOverlay(async () => {
    if (asking) return;
    asking = true;
    const ok = await app.confirmDialog('¿Cancelar la prueba de estrés? Se descartan los datos de prueba y no se guarda el informe.', { confirmText: 'Cancelar prueba', cancelText: 'Seguir' });
    asking = false;
    if (ok) ctl.abort();
  });
  let settings = null;
  try {
    settings = await getSettings(); // solo para la fase con servidor (URL, formato); no se guarda en el informe
  } catch {
    settings = null;
  }
  try {
    const run = await runStressTest({
      profileId, resume, host: overlay.stage, signal: ctl.signal, settings,
      onStatus: (t) => overlay.setStatus(t),
      onPhase: ({ index, total, title, plain, rep, reps }) => {
        overlay.setTitle(`Fase ${index + 1} de ${total}: ${title}${reps > 1 ? ` (repetición ${rep} de ${reps})` : ''}`);
        overlay.setPlain(plain);
        overlay.setProgress((index + (rep - 1) / reps) / total);
      },
    });
    overlay.remove();
    const prev = loadRuns().find((r) => r.startedAt !== run.startedAt) || null;
    showReport(app, run, prev, true);
  } catch (err) {
    overlay.remove();
    if (err && err.name === 'DiagAbort') app.toast('Prueba cancelada. Se borraron los datos de prueba.');
    else app.toast((err && err.message) || 'No se pudo terminar la prueba.');
  }
}

// ---------- informe ----------

function reportBlob(run) {
  const { text, json } = buildReport(run);
  return new Blob([JSON.stringify({ ...json, text }, null, 2)], { type: 'application/json' });
}

export function showReport(app, run, prev, justFinished = false) {
  const node = el('div', 'settings');
  node.append(el('h3', 'sheet__title', 'Informe de rendimiento'));
  const { text } = buildReport(run);
  const headLines = text.split('\n\n')[0].split('\n');
  const head = el('div', 'field__hint', headLines.join('\n'));
  head.style.whiteSpace = 'pre-line';
  node.append(head);

  for (const s of describeResults(run.results, run.profile)) {
    const sec = el('div', 'field');
    sec.append(el('label', 'field__label', s.title));
    const body = el('div', 'field__hint', s.lines.join('\n'));
    body.style.whiteSpace = 'pre-line';
    sec.append(body);
    node.append(sec);
  }

  const cmp = prev ? compareRuns(prev, run) : [];
  if (cmp.length) {
    const sec = el('div', 'field');
    sec.append(el('label', 'field__label', 'Comparado con la vez anterior'));
    const body = el('div', 'field__hint', cmp.join('\n'));
    body.style.whiteSpace = 'pre-line';
    sec.append(body);
    node.append(sec);
  }
  if (run.finger) {
    const sec = el('div', 'field');
    sec.append(el('label', 'field__label', 'Con el dedo'));
    const body = el('div', 'field__hint', run.finger.text);
    body.style.whiteSpace = 'pre-line';
    sec.append(body);
    node.append(sec);
  }

  const row = el('div', 'settings-row');
  const copy = el('button', 'btn btn--ghost btn--sm', 'Copiar informe completo');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(buildReport(run).text + (cmp.length ? '\n\n== Comparado con la vez anterior ==\n' + cmp.join('\n') : ''));
      app.toast('Informe copiado.');
    } catch {
      app.toast('No se pudo copiar. Usa "Exportar como archivo".');
    }
  });
  const exp = el('button', 'btn btn--ghost btn--sm', 'Exportar como archivo');
  exp.type = 'button';
  exp.addEventListener('click', async () => {
    try {
      const d = new Date(run.finishedAt || Date.now()).toISOString().slice(0, 10);
      const { savedToDevice } = await saveBlob(reportBlob(run), `companion-diagnostico-${d}.json`);
      if (savedToDevice) app.toast('Informe guardado en Documentos del teléfono.');
    } catch {
      app.toast('No se pudo exportar el informe.');
    }
  });
  row.append(copy, exp);
  node.append(row);

  if (justFinished) {
    const finger = el('button', 'btn btn--ghost btn--sm', 'Prueba opcional con el dedo (30 s)');
    finger.type = 'button';
    finger.addEventListener('click', () => startFinger(app, run, prev));
    const wrap = el('div', 'settings-row');
    wrap.append(finger);
    node.append(wrap);
    node.append(el('div', 'field__hint', 'La prueba con el dedo compara tu deslizamiento real contra el automático.'));
  }
  app.openSheet(node);
}

async function startFinger(app, run, prev) {
  app.closeSheet();
  const ctl = new AbortController();
  const overlay = createOverlay(() => ctl.abort());
  overlay.setTitle('Prueba con el dedo');
  overlay.setPlain('Desliza el chat de arriba abajo y de vuelta, con la velocidad y el estilo con que lo haces normalmente, durante 30 segundos.');
  try {
    const res = await runFingerTest({ host: overlay.stage, seconds: 30, signal: ctl.signal, onTick: (left) => { overlay.setStatus(`Quedan ${left} s`); overlay.setProgress(1 - left / 30); } });
    overlay.remove();
    run.finger = { text: res.text, scrolledPx: res.scrolledPx, summary: res.summary };
    try {
      const runs = loadRuns();
      const i = runs.findIndex((r) => r.startedAt === run.startedAt);
      if (i >= 0) {
        runs[i] = { ...runs[i], finger: run.finger };
        localStorage.setItem('companion.diag.runs', JSON.stringify(runs));
      }
    } catch {
      /* el historial es opcional */
    }
  } catch {
    overlay.remove();
  }
  showReport(app, run, prev, false);
}

// ---------- reanudar una prueba interrumpida ----------

/** Al abrir la app: si una prueba quedó a medias, ofrece continuar desde la última fase completada o descartarla. */
export async function offerResume(app) {
  const progress = loadProgress();
  if (!progress) return;
  if (!isResumable(progress)) {
    await discardInterrupted();
    return;
  }
  const s = progressSummary(progress);
  const ok = await app.confirmDialog(
    `Se interrumpió una prueba de estrés ${s.profileLabel.toLowerCase()} (terminó ${s.done} de ${s.total} fases). ¿Quieres continuar desde la fase «${s.nextTitle}» o descartarla? Los datos de prueba nunca se mezclan con los tuyos.`,
    { confirmText: 'Continuar', cancelText: 'Descartar' }
  );
  if (ok) {
    startRun(app, progress.profile, progress);
  } else {
    await discardInterrupted();
    app.toast('Prueba descartada.');
  }
}

export { estimateSeconds, phasesFor, minutes };
