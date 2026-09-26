// www/js/ui/backup-import.js
// BKP-001: flujo de "Importar copia": leer el archivo UNA vez, mostrar en lenguaje llano qué trae y qué ya existe, dejar elegir
// («Solo agregar lo que falta» por defecto, «Restaurar todo» con advertencia, Cancelar) y decir al final qué se hizo. Nunca escribe
// nada hasta que el usuario elige; la lógica (comparar, decidir, escribir todo-o-nada) vive en `backup.js` y `state.js`.

import { analyzeBackupFile, importBackupData, exportBackup } from '../state.js';
import { describeAnalysis, describeResult, replaceWarning } from '../backup.js';
import { saveBlob } from '../platform.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};
const lines = (arr, cls = 'field__hint') => {
  const d = el('div', cls, arr.join('\n'));
  d.style.whiteSpace = 'pre-line';
  return d;
};

const counts = (a) => [a.conflictCharacters && `${a.conflictCharacters} ${a.conflictCharacters === 1 ? 'personaje' : 'personajes'}`, a.conflictChats && `${a.conflictChats} ${a.conflictChats === 1 ? 'chat' : 'chats'}`].filter(Boolean).join(' y ') || 'los datos';

// Confirmación DENTRO de la hoja: reemplaza su contenido en vez de cerrarla y abrir otra (cerrar y reabrir una hoja de inmediato
// choca con la entrada de historial que `main.js` empuja/saca por cada hoja). Devuelve true/false; si el usuario cierra la hoja
// (toca fuera o "atrás") la promesa no se resuelve y el flujo simplemente termina sin cambiar nada.
function askInSheet(app, { message, confirmText, cancelText, danger = false }) {
  return new Promise((resolve) => {
    const node = el('div', 'settings');
    const text = el('p', 'sheet__title', message);
    const row = el('div');
    row.style.cssText = 'display:flex;gap:var(--space-3, 12px);margin-top:var(--space-4, 16px)';
    const no = el('button', 'btn btn--ghost', cancelText);
    no.type = 'button';
    no.style.flex = '1';
    no.addEventListener('click', () => resolve(false));
    const yes = el('button', danger ? 'btn btn--danger' : 'btn', confirmText);
    yes.type = 'button';
    yes.style.flex = '1';
    yes.addEventListener('click', () => resolve(true));
    row.append(no, yes);
    node.append(text, row);
    app.openSheet(node);
  });
}

/**
 * @param {object} app  el objeto `app` (openSheet, closeSheet, confirmDialog, toast, navigate)
 * @param {File|{text: () => Promise<string>}} file  el archivo elegido
 * @returns {Promise<void>}
 */
export async function startImport(app, file) {
  let loaded;
  try {
    loaded = await analyzeBackupFile(file);
  } catch (err) {
    app.toast(err.message || 'No se pudo leer la copia de seguridad.');
    return;
  }
  showChoice(app, loaded.data, loaded.analysis);
}

function showChoice(app, data, analysis) {
  const node = el('div', 'settings');
  node.append(el('h3', 'sheet__title', 'Restaurar copia de seguridad'));
  node.append(lines(describeAnalysis(analysis)));

  // Ajustes (URL del servidor, nombre, aspecto, PIN): solo con un teléfono vacío se restauran solos; si ya hay datos, solo si se marca.
  let includeSettings = false;
  if (analysis.hasSettings) {
    if (analysis.existingEmpty) {
      includeSettings = true;
      node.append(el('div', 'field__hint', 'Como tu teléfono está vacío, se restaurarán también tus ajustes (servidor, tu nombre, aspecto y, si tenías, el PIN de bloqueo).'));
    } else {
      const label = el('label');
      label.style.cssText = 'display:flex;align-items:flex-start;gap:8px;margin:12px 0';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.style.cssText = 'accent-color:var(--color-accent, #8b1fe0);margin-top:3px';
      box.addEventListener('change', () => { includeSettings = box.checked; });
      label.append(box, el('span', '', 'También restaurar los ajustes de la copia (servidor, tu nombre, aspecto y PIN). Reemplaza los actuales.'));
      node.append(label);
    }
  }

  const status = el('div', 'status');
  const actions = el('div');
  actions.style.cssText = 'display:flex;flex-direction:column;gap:var(--space-3, 12px);margin-top:var(--space-4, 16px)';

  const add = el('button', 'btn', analysis.existingEmpty ? 'Restaurar la copia' : 'Solo agregar lo que falta (recomendado)');
  add.type = 'button';
  const all = el('button', 'btn btn--danger', 'Restaurar todo (reemplaza lo que ya existe)');
  all.type = 'button';
  const cancel = el('button', 'btn btn--ghost', 'Cancelar');
  cancel.type = 'button';
  actions.append(add);
  if (!analysis.existingEmpty) {
    actions.append(all);
    if (!analysis.warnNewer) actions.append(el('div', 'field__hint', '«Solo agregar» no toca nada de lo que ya tienes. «Restaurar todo» reemplaza lo que ya tienes por lo de la copia.'));
    else {
      const warn = el('div', 'status status--err', replaceWarning(analysis));
      warn.style.whiteSpace = 'pre-line';
      actions.append(warn);
    }
  }
  actions.append(cancel);
  node.append(actions, status);

  const busy = (on) => { for (const b of [add, all, cancel]) b.disabled = on; };

  add.addEventListener('click', () => run('merge'));
  all.addEventListener('click', () => confirmReplace());
  cancel.addEventListener('click', () => {
    app.closeSheet();
    app.toast('No se cambió nada.');
  });

  async function confirmReplace() {
    const risky = analysis.warnNewer;
    const ok = await askInSheet(app, {
      message: `Se reemplazarán ${counts(analysis)} que ya tienes y que también están en la copia.` +
        (risky ? ' ¡Hay datos tuyos más nuevos o más completos que los de la copia: se perderían!' : '') +
        ' Antes se guardará una copia de lo que tienes ahora. ¿Continuar?',
      danger: true,
      confirmText: 'Restaurar todo',
      cancelText: 'Volver',
    });
    if (!ok) {
      showChoice(app, data, analysis);
      return;
    }
    // Copia de lo actual, ANTES de tocar nada. Si no se puede guardar, se pregunta de nuevo.
    let saved = true;
    let savedToDevice = false;
    try {
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      ({ savedToDevice } = await saveBlob(blob, `companion-antes-de-restaurar-${date}.json`));
    } catch {
      saved = false;
    }
    if (!saved) {
      const go = await askInSheet(app, {
        message: 'No se pudo guardar la copia de lo que tienes ahora. Si sigues, lo que se reemplace no se podrá recuperar. ¿Restaurar de todos modos?',
        danger: true,
        confirmText: 'Restaurar de todos modos',
        cancelText: 'Cancelar',
      });
      if (!go) {
        showChoice(app, data, analysis);
        return;
      }
    }
    app.openSheet(node);
    await run('replace', saved ? (savedToDevice ? 'Antes se guardó una copia de lo que tenías en Documentos del teléfono («companion-antes-de-restaurar…»).' : 'Antes se descargó una copia de lo que tenías («companion-antes-de-restaurar…»).') : '');
  }

  async function run(mode, extraNote = '') {
    busy(true);
    status.className = 'status';
    status.textContent = 'Restaurando…';
    try {
      const result = await importBackupData(data, { mode, includeSettings });
      showResult(app, result, extraNote);
    } catch (err) {
      busy(false);
      status.className = 'status status--err';
      status.textContent = (err && err.message) || 'No se pudo restaurar la copia. No se cambió nada de tus datos.';
    }
  }

  app.openSheet(node);
}

function showResult(app, result, extraNote) {
  const node = el('div', 'settings');
  node.append(el('h3', 'sheet__title', 'Copia restaurada'));
  node.append(lines(describeResult(result), 'field__label'));
  if (extraNote) node.append(el('div', 'field__hint', extraNote));
  const ok = el('button', 'btn', 'Listo');
  ok.type = 'button';
  ok.style.marginTop = 'var(--space-4, 16px)';
  ok.addEventListener('click', () => {
    app.closeSheet();
    app.navigate('home', {}, { replace: true });
  });
  node.append(ok);
  app.openSheet(node);
}
