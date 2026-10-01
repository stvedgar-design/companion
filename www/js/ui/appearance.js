// www/js/ui/appearance.js
// Hoja de apariencia: claro u oscuro y tipografía dividida. Global, aplica a toda la app. UI-024: ya no se elige skin (la app
// tiene uno solo, Penumbra Claude; los demás están archivados en css/themes-archived.css). El fondo de chat es otra cosa —
// es por personaje, se edita desde su ficha (UI-032; ver ui/chat-background.js).

import { getSettings, saveSettings } from '../state.js';
import { applyThemeMode, applySplitTypography } from './shell.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';

export function openAppearance(app) {
  const node = document.createElement('div');
  node.className = 'appearance';
  node.innerHTML = `
    <h3 class="sheet__title">Apariencia</h3>

    <div class="field">
      <div class="field__label">Modo</div>
      <div class="appearance-skins">
        <button class="appearance-skin" type="button" data-mode-value="dark">Oscuro</button>
        <button class="appearance-skin" type="button" data-mode-value="light">Claro</button>
      </div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="appearance-split" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Tipografía dividida: narración en un estilo, diálogo en otro</span>
      </label>
      <div class="field__hint">Experimental. En los mensajes del personaje que traen acciones en cursiva, el diálogo se ve con letra sin serifas y la acción conserva la letra del skin. Apagado, todo se ve como siempre.</div>
    </div>

    <div class="field__hint">El tamaño del texto de los mensajes se elige en Ajustes → Apariencia. El fondo de chat (imagen, brillo, etc.) es por personaje — se edita desde su ficha (toca el nombre del personaje dentro de un chat).</div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    modeBtns: Array.from(node.querySelectorAll('[data-mode-value]')),
    split: q('#appearance-split'),
  };

  function renderMode(themeMode) {
    els.modeBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', btn.dataset.modeValue === themeMode);
    });
  }

  getSettings().then((settings) => {
    renderMode(settings.themeMode);
    els.split.checked = settings.splitTypography === true;
  });

  els.split.addEventListener('change', async () => {
    const splitTypography = els.split.checked;
    await saveSettings({ splitTypography });
    applySplitTypography(splitTypography);
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'splitTypography', enabled: splitTypography });
  });

  els.modeBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const themeMode = btn.dataset.modeValue === 'light' ? 'light' : 'dark';
      await saveSettings({ themeMode });
      renderMode(themeMode);
      applyThemeMode(themeMode);
    });
  });

  app.openSheet(node);
}
