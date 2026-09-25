// www/js/ui/appearance.js
// Hoja de apariencia: elegir el skin visual (Nomi/Glass/iMessage) y claro u
// oscuro. Global, aplica a toda la app. El fondo de chat es otra cosa —
// es por personaje, se edita desde el menú ⋮ del chat (ver ui/chat-background.js).

import { getSettings, saveSettings } from '../state.js';
import { applyTheme, applyThemeMode, applyGlassEffect } from './shell.js';

const SKINS = [
  { value: 'nomi', label: 'Nomi' },
  { value: 'glass', label: 'Glass' },
  { value: 'imessage', label: 'iMessage' },
];

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
      <div class="field__label">Skin</div>
      <div class="appearance-skins">
        ${SKINS.map((s) => `
          <button class="appearance-skin" type="button" data-value="${s.value}">
            <span class="appearance-skin__swatch appearance-skin__swatch--${s.value}" aria-hidden="true"></span>
            ${s.label}
          </button>
        `).join('')}
      </div>
    </div>

    <div class="field" id="appearance-glass-field" style="display:none">
      <label class="field__label" for="appearance-glass">Efecto de vidrio</label>
      <select class="inp" id="appearance-glass">
        <option value="full">Completo</option>
        <option value="bars">Solo en barras</option>
        <option value="off">Desactivado</option>
      </select>
      <div class="field__hint">Solo para el skin Glass. Las opciones más ligeras pueden ir mejor en teléfonos modestos; las superficies siguen siendo translúcidas.</div>
    </div>

    <div class="field__hint">El fondo de chat (imagen, brillo, etc.) es por personaje — se edita desde el menú ⋮ dentro de cada chat.</div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    modeBtns: Array.from(node.querySelectorAll('[data-mode-value]')),
    skinBtns: Array.from(node.querySelectorAll('[data-value]')),
    glassField: q('#appearance-glass-field'),
    glass: q('#appearance-glass'),
  };

  function renderMode(themeMode) {
    els.modeBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', btn.dataset.modeValue === themeMode);
    });
    // Las muestras de skin representan un skin EN el modo elegido — no el
    // que esté activo ahora mismo en el resto de la app (ver home.css).
    els.skinBtns.forEach((btn) => {
      const swatch = btn.querySelector('.appearance-skin__swatch');
      if (swatch) swatch.classList.toggle('appearance-skin__swatch--light', themeMode === 'light');
    });
  }

  function renderSkin(theme) {
    els.skinBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', btn.dataset.value === theme);
    });
    // UI-007: el efecto de vidrio solo tiene sentido con Glass; en los demás skins no se muestra.
    els.glassField.style.display = theme === 'glass' ? '' : 'none';
  }

  getSettings().then((settings) => {
    renderMode(settings.themeMode);
    renderSkin(settings.theme);
    els.glass.value = settings.glassEffect;
  });

  els.glass.addEventListener('change', async () => {
    const glassEffect = els.glass.value;
    await saveSettings({ glassEffect });
    applyGlassEffect(glassEffect);
  });

  els.modeBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const themeMode = btn.dataset.modeValue === 'light' ? 'light' : 'dark';
      await saveSettings({ themeMode });
      renderMode(themeMode);
      applyThemeMode(themeMode);
    });
  });

  els.skinBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const theme = SKINS.some((s) => s.value === btn.dataset.value) ? btn.dataset.value : 'nomi';
      await saveSettings({ theme });
      renderSkin(theme);
      applyTheme(theme);
    });
  });

  app.openSheet(node);
}
