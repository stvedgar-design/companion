// www/js/ui/settings.js
// Hoja de ajustes: servidor, nombre, generación, formato del prompt y copia de seguridad.

import { getSettings, saveSettings, exportBackup, importBackup } from '../state.js';
import { connect } from '../api/kobold.js';
import { pickFiles, saveBlob } from '../platform.js';

const SLIDER_DEBOUNCE_MS = 400;

export function openSettings(app) {
  const node = document.createElement('div');
  node.className = 'settings';
  node.innerHTML = `
    <h3 class="sheet__title">Ajustes</h3>

    <div class="field">
      <label class="field__label" for="settings-url">Servidor</label>
      <div class="settings-row">
        <input class="inp" id="settings-url" type="url" inputmode="url"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
        <button class="btn btn--ghost btn--sm" id="settings-test" type="button">Probar</button>
      </div>
      <div class="status" id="settings-status"></div>
    </div>

    <div class="field">
      <label class="field__label" for="settings-user">Tu nombre en el chat</label>
      <input class="inp" id="settings-user" type="text" autocomplete="off">
    </div>

    <div class="field">
      <label class="field__label" for="settings-len">Longitud de respuesta: <span id="settings-len-v"></span> tokens</label>
      <input class="inp" type="range" id="settings-len" min="60" max="500" step="10">
    </div>

    <div class="field">
      <label class="field__label" for="settings-temp">Creatividad: <span id="settings-temp-v"></span></label>
      <input class="inp" type="range" id="settings-temp" min="0.3" max="1.4" step="0.05">
    </div>

    <div class="field">
      <label class="field__label" for="settings-mode">Formato del prompt</label>
      <select class="inp" id="settings-mode">
        <option value="plain">Texto simple (recomendado)</option>
        <option value="chat">Plantilla del modelo</option>
      </select>
      <div class="field__hint">Texto simple funciona con cualquier modelo. Cambia a plantilla solo si tu modelo responde raro.</div>
    </div>

    <div class="field">
      <label class="field__label">Copia de seguridad</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-export" type="button">Exportar copia</button>
        <button class="btn btn--ghost btn--sm" id="settings-import" type="button">Importar copia</button>
      </div>
    </div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    url: q('#settings-url'),
    test: q('#settings-test'),
    status: q('#settings-status'),
    user: q('#settings-user'),
    len: q('#settings-len'),
    lenV: q('#settings-len-v'),
    temp: q('#settings-temp'),
    tempV: q('#settings-temp-v'),
    mode: q('#settings-mode'),
    exportBtn: q('#settings-export'),
    importBtn: q('#settings-import'),
  };

  let lenTimer = null;
  let tempTimer = null;

  getSettings().then((settings) => {
    els.url.value = settings.url;
    els.user.value = settings.user;
    els.len.value = settings.maxLen;
    els.lenV.textContent = settings.maxLen;
    els.temp.value = settings.temp;
    els.tempV.textContent = settings.temp;
    els.mode.value = settings.mode;
  });

  els.user.addEventListener('input', () => {
    saveSettings({ user: els.user.value.trim() });
  });

  els.len.addEventListener('input', () => {
    const value = clamp(Math.round(+els.len.value / 10) * 10, 60, 500);
    els.lenV.textContent = value;
    clearTimeout(lenTimer);
    lenTimer = setTimeout(() => saveSettings({ maxLen: value }), SLIDER_DEBOUNCE_MS);
  });

  els.temp.addEventListener('input', () => {
    const value = clamp(+els.temp.value, 0.3, 1.4);
    els.tempV.textContent = value;
    clearTimeout(tempTimer);
    tempTimer = setTimeout(() => saveSettings({ temp: value }), SLIDER_DEBOUNCE_MS);
  });

  els.mode.addEventListener('change', () => {
    saveSettings({ mode: els.mode.value });
  });

  els.test.addEventListener('click', async () => {
    els.status.className = 'status';
    els.status.textContent = 'Conectando…';
    els.test.disabled = true;
    try {
      const { url, model, ctx } = await connect(els.url.value);
      await saveSettings({ url, ctx });
      els.status.className = 'status status--ok';
      els.status.textContent = 'Conectado: ' + model;
    } catch (err) {
      els.status.className = 'status status--err';
      els.status.textContent = err.message;
    } finally {
      els.test.disabled = false;
    }
  });

  els.exportBtn.addEventListener('click', async () => {
    els.exportBtn.disabled = true;
    try {
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      await saveBlob(blob, `companion-copia-${date}.json`);
    } catch (err) {
      app.toast(err.message || 'No se pudo exportar la copia.');
    } finally {
      els.exportBtn.disabled = false;
    }
  });

  els.importBtn.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    els.importBtn.disabled = true;
    try {
      const { characters } = await importBackup(files[0]);
      app.toast(`Se restauraron ${characters} personajes`);
      app.closeSheet();
      app.navigate('home', {}, { replace: true });
    } catch (err) {
      app.toast(err.message || 'No se pudo importar la copia.');
      els.importBtn.disabled = false;
    }
  });

  app.openSheet(node);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
