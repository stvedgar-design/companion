// www/js/ui/settings.js
// Hoja de ajustes: servidor, nombre, formato del prompt y copia de seguridad.
// UI-011: los deslizadores de longitud (Settings.maxLen) y creatividad (Settings.temp) se quitaron
// de la pantalla; los campos siguen en state.js y api/kobold.js los sigue enviando igual.

import { getSettings, saveSettings, exportBackup, importBackup } from '../state.js';
import { connect } from '../api/kobold.js';
import { pickFiles, saveBlob } from '../platform.js';
import { createPinHash, verifyPin } from '../lock.js';
import { openAppearance } from './appearance.js';
import { APP_VERSION } from '../version.js';
import { runFluencyTest, FLUENCY_SECONDS } from './fluency.js';

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
      <label class="field__label" for="settings-mode">Formato del prompt</label>
      <select class="inp" id="settings-mode">
        <option value="chat">Plantilla del modelo (recomendado)</option>
        <option value="plain">Texto simple</option>
      </select>
      <div class="field__hint">Plantilla del modelo suele dar mejores respuestas de roleplay. Si tu modelo responde raro con esa opción, probá con "Texto simple", que funciona igual con cualquier modelo pero sin su plantilla de chat.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-variety" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Ayuda a que las respuestas no se repitan</span>
      </label>
      <div class="field__hint">Si tu personaje empieza a repetir las mismas palabras o temas, la siguiente respuesta lleva una nota breve pidiéndole variar. No hace el chat más lento.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-format" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Corregir formato automáticamente</span>
      </label>
      <div class="field__hint">Cada respuesta empieza ya dentro de una acción en cursiva, y si llega con asteriscos mal puestos pero con el diálogo entre comillas, se muestra bien (diálogo normal, el resto en cursiva). Los mensajes sin asteriscos ni comillas no se tocan. No hace el chat más lento.</div>
    </div>

    <div class="field">
      <label class="field__label">Bloqueo con PIN</label>
      <div id="settings-pin-body"></div>
    </div>

    <div class="field">
      <label class="field__label">Apariencia</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-appearance" type="button">Skin y fondo del chat</button>
      </div>
    </div>

    <div class="field">
      <label class="field__label">Copia de seguridad</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-export" type="button">Exportar copia</button>
        <button class="btn btn--ghost btn--sm" id="settings-import" type="button">Importar copia</button>
      </div>
    </div>

    <div class="field">
      <label class="field__label">Prueba de fluidez</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-fluency" type="button">Medir fluidez (${FLUENCY_SECONDS} s)</button>
      </div>
      <div class="field__hint">Desliza el chat solo durante unos segundos y mide qué tan fluido va. Si tienes un chat abierto lo usa; si no, uno de prueba. No se envía nada a ningún lado.</div>
      <div class="field__hint" id="settings-fluency-result" hidden style="white-space:pre-line"></div>
      <div class="settings-row" id="settings-fluency-copyrow" hidden>
        <button class="btn btn--ghost btn--sm" id="settings-fluency-copy" type="button">Copiar resultado</button>
      </div>
    </div>

    <div class="settings-version">Companion v${APP_VERSION}</div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    url: q('#settings-url'),
    test: q('#settings-test'),
    status: q('#settings-status'),
    user: q('#settings-user'),
    mode: q('#settings-mode'),
    variety: q('#settings-variety'),
    format: q('#settings-format'),
    pinBody: q('#settings-pin-body'),
    appearanceBtn: q('#settings-appearance'),
    exportBtn: q('#settings-export'),
    importBtn: q('#settings-import'),
    fluency: q('#settings-fluency'),
    fluencyResult: q('#settings-fluency-result'),
    fluencyCopyRow: q('#settings-fluency-copyrow'),
    fluencyCopy: q('#settings-fluency-copy'),
  };

  getSettings().then((settings) => {
    els.url.value = settings.url;
    els.user.value = settings.user;
    els.mode.value = settings.mode;
    els.variety.checked = settings.varietyAssist === true;
    els.format.checked = settings.formatAssist !== false;
    renderPinBody(settings);
  });

  function renderPinBody(settings) {
    if (settings.pinHash) {
      els.pinBody.innerHTML = `
        <div class="status status--ok">Bloqueo activado: te va a pedir el PIN cada vez que abras la app.</div>
        <div class="settings-row">
          <input class="inp" id="pin-current" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN actual, para desactivar">
          <button class="btn btn--sm btn--danger" id="pin-deactivate" type="button">Desactivar</button>
        </div>
      `;
      const current = q('#pin-current');
      const deactivateBtn = q('#pin-deactivate');
      deactivateBtn.addEventListener('click', async () => {
        const ok = await verifyPin(current.value, settings.pinSalt, settings.pinHash);
        if (!ok) {
          app.toast('PIN incorrecto.');
          return;
        }
        settings = await saveSettings({ pinSalt: '', pinHash: '' });
        renderPinBody(settings);
        app.toast('Bloqueo desactivado.');
      });
    } else {
      els.pinBody.innerHTML = `
        <div class="settings-row">
          <input class="inp" id="pin-new" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN nuevo (4 o más dígitos)">
        </div>
        <div class="settings-row">
          <input class="inp" id="pin-confirm" type="password" inputmode="numeric" autocomplete="off" placeholder="Repetir PIN">
          <button class="btn btn--ghost btn--sm" id="pin-activate" type="button">Activar</button>
        </div>
        <div class="field__hint">Opcional. Si lo activás, no hay forma de recuperarlo si lo olvidás: tendrías que borrar los datos de la app (y perder los personajes/chats) para volver a entrar.</div>
      `;
      const pinNew = q('#pin-new');
      const pinConfirm = q('#pin-confirm');
      const activateBtn = q('#pin-activate');
      activateBtn.addEventListener('click', async () => {
        const pin = pinNew.value;
        if (pin.length < 4) {
          app.toast('El PIN tiene que tener al menos 4 dígitos.');
          return;
        }
        if (pin !== pinConfirm.value) {
          app.toast('Los dos PIN no coinciden.');
          return;
        }
        activateBtn.disabled = true;
        try {
          const { salt, hash } = await createPinHash(pin);
          settings = await saveSettings({ pinSalt: salt, pinHash: hash });
          renderPinBody(settings);
          app.toast('Bloqueo activado.');
        } catch (err) {
          app.toast('No se pudo activar el bloqueo.');
        } finally {
          activateBtn.disabled = false;
        }
      });
    }
  }

  els.user.addEventListener('input', () => {
    saveSettings({ user: els.user.value.trim() });
  });

  els.mode.addEventListener('change', () => {
    saveSettings({ mode: els.mode.value });
  });

  els.variety.addEventListener('change', () => {
    saveSettings({ varietyAssist: els.variety.checked });
  });

  els.format.addEventListener('change', () => {
    saveSettings({ formatAssist: els.format.checked });
  });

  els.appearanceBtn.addEventListener('click', () => {
    openAppearance(app);
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

  // UI-001: mide la fluidez del desplazamiento (ver ui/fluency.js). Nada sale del teléfono.
  let fluencyText = '';
  els.fluency.addEventListener('click', async () => {
    els.fluency.disabled = true;
    els.fluencyCopyRow.hidden = true;
    els.fluencyResult.hidden = false;
    els.fluencyResult.textContent = `Midiendo… no toques la pantalla durante ${FLUENCY_SECONDS} segundos.`;
    try {
      const { text } = await runFluencyTest({ host: node });
      fluencyText = text;
      els.fluencyResult.textContent = text;
      els.fluencyCopyRow.hidden = false;
    } catch (err) {
      els.fluencyResult.textContent = 'No se pudo hacer la prueba.';
    } finally {
      els.fluency.disabled = false;
    }
  });

  els.fluencyCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fluencyText);
      app.toast('Resultado copiado.');
    } catch (err) {
      app.toast('No se pudo copiar. Puedes seleccionar el texto y copiarlo a mano.');
    }
  });

  els.exportBtn.addEventListener('click', async () => {
    els.exportBtn.disabled = true;
    try {
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      const { savedToDevice } = await saveBlob(blob, `companion-copia-${date}.json`);
      if (savedToDevice) app.toast('Copia guardada en Documentos del teléfono.');
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
