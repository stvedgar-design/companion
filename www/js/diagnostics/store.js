// www/js/diagnostics/store.js
// UI-005: guardado LOCAL del historial de corridas y del progreso de una corrida en curso. Usa localStorage (no la base de datos
// de los chats) para no tocar el esquema de los datos reales: si falla o se borra, solo se pierde el historial de diagnóstico.
// Todo está envuelto en try/catch: el almacenamiento puede lanzar (modo privado, sin espacio…) y la app debe seguir igual.

import { pushRun } from './plan.js';

export const RUNS_KEY = 'companion.diag.runs';
export const PROGRESS_KEY = 'companion.diag.progress';

function getStorage(storage) {
  if (storage) return storage;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

function readJson(key, storage) {
  const s = getStorage(storage);
  if (!s) return null;
  try {
    const raw = s.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key, value, storage) {
  const s = getStorage(storage);
  if (!s) return false;
  try {
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export const loadRuns = (storage) => {
  const v = readJson(RUNS_KEY, storage);
  return Array.isArray(v) ? v : [];
};
export const saveRun = (run, storage) => writeJson(RUNS_KEY, pushRun(loadRuns(storage), run), storage);
export const loadProgress = (storage) => readJson(PROGRESS_KEY, storage);
export const saveProgress = (progress, storage) => writeJson(PROGRESS_KEY, progress, storage);
export function clearProgress(storage) {
  const s = getStorage(storage);
  try {
    if (s) s.removeItem(PROGRESS_KEY);
  } catch {
    /* nada */
  }
}
