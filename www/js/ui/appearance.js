// www/js/ui/appearance.js
// Hoja de apariencia: elegir el skin visual (Nomi/Glass) y el fondo
// personalizado del chat (imagen, brillo, fundido a negro, ajuste).

import { getSettings, saveSettings } from '../state.js';
import { pickFiles } from '../platform.js';
import { resizeImageToDataUrl, averageColorFromDataUrl } from '../images.js';
import { applyTheme, setGlassTint } from './shell.js';

const BG_MAX_DIM = 1280;
const BG_QUALITY = 0.82;
const BRIGHTNESS_DEBOUNCE_MS = 150;

// Otras vistas (hoy solo chat.js) escuchan este evento para refrescar su
// fondo sin tener que salir y volver a entrar — la hoja de apariencia se
// abre encima de la vista actual, no reemplaza la vista.
function notifyChange(settings) {
  document.dispatchEvent(new CustomEvent('companion:appearancechange', { detail: settings }));
}

export function openAppearance(app) {
  const node = document.createElement('div');
  node.className = 'appearance';
  node.innerHTML = `
    <h3 class="sheet__title">Apariencia</h3>

    <div class="field">
      <div class="field__label">Skin</div>
      <div class="appearance-skins">
        <button class="appearance-skin" type="button" data-value="nomi">
          <span class="appearance-skin__swatch appearance-skin__swatch--nomi" aria-hidden="true"></span>
          Nomi
        </button>
        <button class="appearance-skin" type="button" data-value="glass">
          <span class="appearance-skin__swatch appearance-skin__swatch--glass" aria-hidden="true"></span>
          Glass
        </button>
      </div>
    </div>

    <div class="field">
      <div class="field__label">Fondo del chat</div>
      <div class="appearance-preview" id="appearance-preview">
        <div class="appearance-preview__empty" id="appearance-preview-empty">Sin imagen</div>
        <div class="appearance-preview__fade" id="appearance-preview-fade" hidden></div>
      </div>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="appearance-pick" type="button">Elegir imagen</button>
        <button class="btn btn--ghost btn--sm appearance-removebtn" id="appearance-remove" type="button" hidden>Quitar</button>
      </div>
    </div>

    <div class="field appearance-bgcontrols" id="appearance-bg-controls" hidden>
      <label class="field__label" for="appearance-brightness">Brillo: <span id="appearance-brightness-v"></span>%</label>
      <input class="inp" type="range" id="appearance-brightness" min="20" max="180" step="5">
      <div class="settings-row appearance-toggles">
        <button class="btn btn--ghost btn--sm" id="appearance-fade" type="button">Fundido a negro: no</button>
        <button class="btn btn--ghost btn--sm" id="appearance-fit" type="button">Ajuste: llenar</button>
      </div>
      <div class="field__hint">"Llenar" recorta la imagen para cubrir la pantalla sin deformarla. "Estirar" la deforma para ocupar todo el espacio sin recortar nada.</div>
    </div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    skinBtns: Array.from(node.querySelectorAll('.appearance-skin')),
    preview: q('#appearance-preview'),
    previewEmpty: q('#appearance-preview-empty'),
    previewFade: q('#appearance-preview-fade'),
    pickBtn: q('#appearance-pick'),
    removeBtn: q('#appearance-remove'),
    bgControls: q('#appearance-bg-controls'),
    brightness: q('#appearance-brightness'),
    brightnessV: q('#appearance-brightness-v'),
    fadeBtn: q('#appearance-fade'),
    fitBtn: q('#appearance-fit'),
  };

  let current = null;
  let brightnessTimer = null;

  function renderSkin(theme) {
    els.skinBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', btn.dataset.value === theme);
    });
  }

  function renderBackground(settings) {
    const hasBg = !!settings.chatBackground;
    els.previewEmpty.hidden = hasBg;
    els.removeBtn.hidden = !hasBg;
    els.bgControls.hidden = !hasBg;
    els.preview.style.backgroundImage = hasBg ? `url("${settings.chatBackground}")` : '';
    els.preview.style.backgroundSize = settings.chatBackgroundFit === 'stretch' ? '100% 100%' : 'cover';
    els.preview.style.filter = `brightness(${settings.chatBackgroundBrightness}%)`;
    els.previewFade.hidden = !settings.chatBackgroundFade;
    els.brightness.value = settings.chatBackgroundBrightness;
    els.brightnessV.textContent = settings.chatBackgroundBrightness;
    els.fadeBtn.textContent = `Fundido a negro: ${settings.chatBackgroundFade ? 'sí' : 'no'}`;
    els.fitBtn.textContent = `Ajuste: ${settings.chatBackgroundFit === 'stretch' ? 'estirar' : 'llenar'}`;
  }

  getSettings().then((settings) => {
    current = settings;
    renderSkin(settings.theme);
    renderBackground(settings);
  });

  els.skinBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const theme = btn.dataset.value === 'glass' ? 'glass' : 'nomi';
      current = await saveSettings({ theme });
      renderSkin(theme);
      applyTheme(theme);
    });
  });

  els.pickBtn.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    els.pickBtn.disabled = true;
    try {
      const dataUrl = await resizeImageToDataUrl(files[0], BG_MAX_DIM, BG_QUALITY);
      if (!dataUrl) {
        app.toast('No se pudo usar esa imagen.');
        return;
      }
      current = await saveSettings({ chatBackground: dataUrl });
      renderBackground(current);
      notifyChange(current);
      const rgb = await averageColorFromDataUrl(dataUrl);
      setGlassTint(rgb);
    } catch (err) {
      app.toast('No se pudo usar esa imagen.');
    } finally {
      els.pickBtn.disabled = false;
    }
  });

  els.removeBtn.addEventListener('click', async () => {
    current = await saveSettings({ chatBackground: '' });
    renderBackground(current);
    notifyChange(current);
    setGlassTint(null);
  });

  els.brightness.addEventListener('input', () => {
    const value = Math.max(20, Math.min(180, Math.round(+els.brightness.value / 5) * 5));
    els.brightnessV.textContent = value;
    els.preview.style.filter = `brightness(${value}%)`;
    clearTimeout(brightnessTimer);
    brightnessTimer = setTimeout(async () => {
      current = await saveSettings({ chatBackgroundBrightness: value });
      notifyChange(current);
    }, BRIGHTNESS_DEBOUNCE_MS);
  });

  els.fadeBtn.addEventListener('click', async () => {
    const fade = !(current && current.chatBackgroundFade);
    current = await saveSettings({ chatBackgroundFade: fade });
    renderBackground(current);
    notifyChange(current);
  });

  els.fitBtn.addEventListener('click', async () => {
    const fit = current && current.chatBackgroundFit === 'stretch' ? 'fill' : 'stretch';
    current = await saveSettings({ chatBackgroundFit: fit });
    renderBackground(current);
    notifyChange(current);
  });

  app.openSheet(node);
}
