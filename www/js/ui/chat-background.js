// www/js/ui/chat-background.js
// Hoja de fondo de chat: imagen, brillo, fundido a negro y ajuste — por
// PERSONAJE (ver docs/NOTES.md, "Fondo de chat por personaje"), no global.
// Se abre desde el menú ⋮ de un chat (ver ui/chat.js), nunca desde Ajustes:
// fuera de un chat no hay un personaje al que asignarle el fondo.

import { saveCharacterBackground } from '../state.js';
import { pickFiles } from '../platform.js';
import { resizeImageToDataUrl, averageColorFromDataUrl } from '../images.js';
import { setGlassTint } from './shell.js';

const BG_MAX_DIM = 1280;
const BG_QUALITY = 0.82;
const BRIGHTNESS_DEBOUNCE_MS = 150;

// chat.js escucha este evento para refrescar el fondo sin salir y volver a
// entrar — esta hoja se abre encima del chat, no lo reemplaza.
function notifyChange(character) {
  document.dispatchEvent(new CustomEvent('companion:chatbackgroundchange', { detail: character }));
}

/**
 * @param {import('../../main.js').AppApi} app
 * @param {import('../state.js').Character} character
 */
export function openChatBackground(app, character) {
  const node = document.createElement('div');
  node.className = 'appearance';
  node.innerHTML = `
    <h3 class="sheet__title">Fondo del chat con ${character.name}</h3>

    <div class="field">
      <div class="appearance-preview" id="bg-preview">
        <div class="appearance-preview__empty" id="bg-preview-empty">Sin imagen</div>
        <div class="appearance-preview__fade" id="bg-preview-fade" hidden></div>
      </div>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="bg-pick" type="button">Elegir imagen</button>
        <button class="btn btn--ghost btn--sm appearance-removebtn" id="bg-remove" type="button" hidden>Quitar</button>
      </div>
      <div class="field__hint">Solo se ve en los chats de ${character.name}. El resto de la app sigue el fondo del skin activo.</div>
    </div>

    <div class="field appearance-bgcontrols" id="bg-controls" hidden>
      <label class="field__label" for="bg-brightness">Brillo: <span id="bg-brightness-v"></span>%</label>
      <input class="inp" type="range" id="bg-brightness" min="20" max="180" step="5">
      <div class="settings-row appearance-toggles">
        <button class="btn btn--ghost btn--sm" id="bg-fade" type="button">Fundido a negro: no</button>
        <button class="btn btn--ghost btn--sm" id="bg-fit" type="button">Ajuste: llenar</button>
      </div>
      <div class="field__hint">"Llenar" recorta la imagen para cubrir la pantalla sin deformarla. "Estirar" la deforma para ocupar todo el espacio sin recortar nada.</div>
    </div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    preview: q('#bg-preview'),
    previewEmpty: q('#bg-preview-empty'),
    previewFade: q('#bg-preview-fade'),
    pickBtn: q('#bg-pick'),
    removeBtn: q('#bg-remove'),
    bgControls: q('#bg-controls'),
    brightness: q('#bg-brightness'),
    brightnessV: q('#bg-brightness-v'),
    fadeBtn: q('#bg-fade'),
    fitBtn: q('#bg-fit'),
  };

  let current = character;
  let brightnessTimer = null;

  function render(c) {
    const hasBg = !!c.chatBackground;
    els.previewEmpty.hidden = hasBg;
    els.removeBtn.hidden = !hasBg;
    els.bgControls.hidden = !hasBg;
    els.preview.style.backgroundImage = hasBg ? `url("${c.chatBackground}")` : '';
    els.preview.style.backgroundSize = c.chatBackgroundFit === 'stretch' ? '100% 100%' : 'cover';
    els.preview.style.filter = `brightness(${c.chatBackgroundBrightness}%)`;
    els.previewFade.hidden = !c.chatBackgroundFade;
    els.brightness.value = c.chatBackgroundBrightness;
    els.brightnessV.textContent = c.chatBackgroundBrightness;
    els.fadeBtn.textContent = `Fundido a negro: ${c.chatBackgroundFade ? 'sí' : 'no'}`;
    els.fitBtn.textContent = `Ajuste: ${c.chatBackgroundFit === 'stretch' ? 'estirar' : 'llenar'}`;
  }

  render(current);

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
      current = await saveCharacterBackground(current.id, { chatBackground: dataUrl });
      render(current);
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
    current = await saveCharacterBackground(current.id, { chatBackground: '' });
    render(current);
    notifyChange(current);
    setGlassTint(null);
  });

  els.brightness.addEventListener('input', () => {
    const value = Math.max(20, Math.min(180, Math.round(+els.brightness.value / 5) * 5));
    els.brightnessV.textContent = value;
    els.preview.style.filter = `brightness(${value}%)`;
    clearTimeout(brightnessTimer);
    brightnessTimer = setTimeout(async () => {
      current = await saveCharacterBackground(current.id, { chatBackgroundBrightness: value });
      notifyChange(current);
    }, BRIGHTNESS_DEBOUNCE_MS);
  });

  els.fadeBtn.addEventListener('click', async () => {
    const fade = !current.chatBackgroundFade;
    current = await saveCharacterBackground(current.id, { chatBackgroundFade: fade });
    render(current);
    notifyChange(current);
  });

  els.fitBtn.addEventListener('click', async () => {
    const fit = current.chatBackgroundFit === 'stretch' ? 'fill' : 'stretch';
    current = await saveCharacterBackground(current.id, { chatBackgroundFit: fit });
    render(current);
    notifyChange(current);
  });

  app.openSheet(node);
}
