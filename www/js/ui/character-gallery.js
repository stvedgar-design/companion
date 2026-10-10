// www/js/ui/character-gallery.js
// FASE 14 (PARETO-008): Galería Visual Estilo Instagram y Diario de Ilustraciones.
// Permite coleccionar las ilustraciones locales del companion, contemplarlas en
// una cuadrícula de 3 columnas (1:1), agregar notas privadas de hasta 500 caracteres
// (sin ningún impacto en el LLM ni consumo de tokens) y acciones directas para
// fijar como fondo de chat o avatar.

import {
  listCharacterGallery,
  saveGalleryItem,
  updateGalleryItemCaption,
  deleteGalleryItem,
  saveCharacterBackground,
  saveCharacter,
  getCharacter,
  GALLERY_CAPTION_MAX,
} from '../state.js';
import { pickFiles } from '../platform.js';
import { resizeImageToDataUrl } from '../images.js';
import { formatMessageFullTime } from '../msgtime.js';
import { moodHeadText } from '../api/presence.js';
import { haptics } from './haptics.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';
const ICON_ADD = '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>';
const ICON_COMMENT = '<svg viewBox="0 0 24 24"><path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.2L4 17.2V4h16v12z"/></svg>';
const ICON_EMPTY = '<svg viewBox="0 0 24 24"><path d="M4 5h16a2 2 0 012 2v10a2 2 0 01-2 2H4a2 2 0 01-2-2V7a2 2 0 012-2zm0 2v10h16V7H4zm4 3a1.5 1.5 0 110 3 1.5 1.5 0 010-3zm10 7H6l4-5 3 3.5 2-2.5 3 4z"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Abre la hoja de galería visual del companion en pantalla completa.
 * @param {{ openSheet: Function, closeSheet: Function, toast: Function, confirmDialog: Function }} app
 * @param {import('../state.js').Character} character
 * @param {{ onUpdated?: (updated: import('../state.js').Character) => void }} [opts]
 */
export function openCharacterGallery(app, character, opts = {}) {
  let current = character;
  const sheetNode = el('div', 'char-gallery');
  sheetNode.dataset.role = 'character-gallery';

  async function render() {
    sheetNode.innerHTML = '';
    const items = await listCharacterGallery(current.id);

    // 1. Cabecera editorial (Topbar)
    const topbar = el('div', 'char-gallery__topbar');
    const backBtn = el('button', 'ib', '');
    backBtn.type = 'button';
    backBtn.setAttribute('aria-label', 'Volver');
    backBtn.innerHTML = ICON_BACK;
    backBtn.addEventListener('click', () => {
      haptics.tap();
      app.closeSheet();
    });
    topbar.appendChild(backBtn);

    const title = el('h2', 'char-gallery__title', `${current.name} · Álbum`);
    topbar.appendChild(title);

    const addBtn = el('button', 'ib', '');
    addBtn.type = 'button';
    addBtn.setAttribute('aria-label', 'Agregar ilustración');
    addBtn.innerHTML = ICON_ADD;
    addBtn.addEventListener('click', async () => {
      haptics.tap();
      const files = await pickFiles({ accept: 'image/*', multiple: true });
      if (!files || !files.length) return;
      addBtn.disabled = true;
      let added = 0;
      for (const file of files) {
        try {
          const dataUrl = await resizeImageToDataUrl(file, 1280, 0.85);
          if (dataUrl) {
            await saveGalleryItem(current.id, { dataUrl, caption: '' });
            added++;
          }
        } catch {
          // Si falla una imagen particular, continuar con las siguientes
        }
      }
      if (added > 0) {
        haptics.action();
        app.toast(added === 1 ? 'Ilustración agregada.' : `${added} ilustraciones agregadas.`);
        const fresh = await getCharacter(current.id);
        if (fresh) current = fresh;
        if (opts.onUpdated) opts.onUpdated(current);
        render();
      } else {
        app.toast('No se pudo procesar la imagen elegida.');
      }
      addBtn.disabled = false;
    });
    topbar.appendChild(addBtn);
    sheetNode.appendChild(topbar);

    // 2. Mini-perfil del companion (Inspirado en Instagram)
    const profile = el('div', 'char-gallery__profile');
    const heroSrc = current.avatarLarge || current.avatar;
    if (heroSrc) {
      const avatarImg = el('img', 'char-gallery__avatar');
      avatarImg.src = heroSrc;
      avatarImg.alt = current.name;
      profile.appendChild(avatarImg);
    } else {
      const fallback = el('div', 'char-gallery__avatar-fallback', (current.name || 'C').charAt(0).toUpperCase());
      profile.appendChild(fallback);
    }

    const info = el('div', 'char-gallery__info');
    const countText = items.length === 1 ? '1 ilustración' : `${items.length} ilustraciones`;
    info.appendChild(el('div', 'char-gallery__count', countText));

    const moodStr = moodHeadText(current.mood);
    const subText = moodStr ? `Ánimo: ${moodStr}` : 'Diario visual privado';
    info.appendChild(el('div', 'char-gallery__mood', subText));
    profile.appendChild(info);
    sheetNode.appendChild(profile);

    // 3. Cuadrícula de 3 columnas
    if (items.length === 0) {
      const empty = el('div', 'gallery-empty');
      empty.innerHTML = `${ICON_EMPTY}<div class="gallery-empty__text">Aún no hay fotos en el álbum de ${current.name}. Toca '+' para agregar tus ilustraciones locales.</div>`;
      sheetNode.appendChild(empty);
    } else {
      const grid = el('div', 'gallery-grid');
      for (const item of items) {
        const itemEl = el('div', 'gallery-item');
        itemEl.tabIndex = 0;
        itemEl.setAttribute('role', 'button');
        itemEl.setAttribute('aria-label', item.caption || 'Ilustración');

        const img = el('img');
        img.src = item.dataUrl;
        img.alt = item.caption || '';
        img.loading = 'lazy';
        itemEl.appendChild(img);

        if (item.caption && item.caption.trim()) {
          const badge = el('div', 'gallery-item__badge');
          badge.innerHTML = ICON_COMMENT;
          itemEl.appendChild(badge);
        }

        itemEl.addEventListener('click', () => {
          haptics.tap();
          openLightbox(item);
        });
        grid.appendChild(itemEl);
      }
      sheetNode.appendChild(grid);
    }
  }

  // 4. Visor Lightbox detallado con edición de notas y acciones
  function openLightbox(item) {
    const lightbox = el('div', 'gallery-lightbox');

    // Topbar del lightbox
    const topbar = el('div', 'gallery-lightbox__topbar');
    const closeBtn = el('button', 'ib', '');
    closeBtn.type = 'button';
    closeBtn.setAttribute('aria-label', 'Cerrar detalle');
    closeBtn.innerHTML = ICON_BACK;
    closeBtn.addEventListener('click', () => {
      haptics.tap();
      lightbox.remove();
      render();
    });
    topbar.appendChild(closeBtn);

    const title = el('h3', 'gallery-lightbox__title', 'Detalle de ilustración');
    topbar.appendChild(title);

    const spacer = el('div', 'ib');
    spacer.style.visibility = 'hidden';
    topbar.appendChild(spacer);
    lightbox.appendChild(topbar);

    // Imagen completa en proporción natural
    const imgwrap = el('div', 'gallery-lightbox__imgwrap');
    const fullImg = el('img');
    fullImg.src = item.dataUrl;
    fullImg.alt = item.caption || '';
    imgwrap.appendChild(fullImg);
    lightbox.appendChild(imgwrap);

    // Cuerpo con fecha, editor de nota y acciones
    const body = el('div', 'gallery-lightbox__body');

    const dateStr = formatMessageFullTime(item.createdAt);
    body.appendChild(el('div', 'gallery-lightbox__date', `Guardada el ${dateStr}`));

    // Editor de nota
    const captionWrap = el('div', 'field');
    captionWrap.appendChild(el('label', 'field__label', 'Nota personal'));

    const textarea = el('textarea', 'inp gallery-lightbox__caption');
    textarea.maxLength = GALLERY_CAPTION_MAX;
    textarea.placeholder = 'Escribe una nota o recuerdo sobre esta ilustración...';
    textarea.value = item.caption || '';
    captionWrap.appendChild(textarea);

    const counter = el(
      'div',
      'field__hint',
      `${textarea.value.length} / ${GALLERY_CAPTION_MAX} · Privada (no se envía al LLM)`
    );
    captionWrap.appendChild(counter);

    textarea.addEventListener('input', () => {
      counter.textContent = `${textarea.value.length} / ${GALLERY_CAPTION_MAX} · Privada (no se envía al LLM)`;
    });

    const saveNoteBtn = el('button', 'btn btn--sm', 'Guardar nota');
    saveNoteBtn.type = 'button';
    saveNoteBtn.style.alignSelf = 'flex-start';
    saveNoteBtn.style.marginTop = 'var(--space-2, 8px)';
    saveNoteBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog('¿Guardar la nota personal de esta ilustración?', { confirmText: 'Guardar' });
        if (!ok) return;
      }
      saveNoteBtn.disabled = true;
      try {
        const cleanCaption = textarea.value.slice(0, GALLERY_CAPTION_MAX).trim();
        await updateGalleryItemCaption(current.id, item.id, cleanCaption);
        item.caption = cleanCaption;
        haptics.action();
        app.toast('Nota guardada.');
        const fresh = await getCharacter(current.id);
        if (fresh) current = fresh;
        if (opts.onUpdated) opts.onUpdated(current);
      } catch {
        app.toast('No se pudo guardar la nota.');
      } finally {
        saveNoteBtn.disabled = false;
      }
    });
    captionWrap.appendChild(saveNoteBtn);
    body.appendChild(captionWrap);

    // Acciones directas
    const actionsWrap = el('div', 'gallery-lightbox__actions');

    const setBgBtn = el('button', 'btn btn--ghost', 'Usar como fondo de chat');
    setBgBtn.type = 'button';
    setBgBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog('¿Establecer esta ilustración como fondo de chat?', { confirmText: 'Aplicar' });
        if (!ok) return;
      }
      setBgBtn.disabled = true;
      try {
        const updated = await saveCharacterBackground(current.id, { chatBackground: item.dataUrl });
        current = updated;
        document.dispatchEvent(new CustomEvent('companion:chatbackgroundchange', { detail: current }));
        haptics.action();
        app.toast('Fondo de chat actualizado.');
        if (opts.onUpdated) opts.onUpdated(current);
      } catch {
        app.toast('No se pudo actualizar el fondo.');
      } finally {
        setBgBtn.disabled = false;
      }
    });
    actionsWrap.appendChild(setBgBtn);

    const setAvatarBtn = el('button', 'btn btn--ghost', 'Usar como avatar');
    setAvatarBtn.type = 'button';
    setAvatarBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog('¿Establecer esta ilustración como avatar del personaje?', { confirmText: 'Aplicar' });
        if (!ok) return;
      }
      setAvatarBtn.disabled = true;
      try {
        const updated = await saveCharacter({
          ...current,
          avatar: item.dataUrl,
          avatarLarge: item.dataUrl,
        });
        current = updated;
        haptics.action();
        app.toast('Avatar actualizado.');
        if (opts.onUpdated) opts.onUpdated(current);
        const heroImg = profile.querySelector('.char-gallery__avatar');
        if (heroImg) heroImg.src = item.dataUrl;
      } catch {
        app.toast('No se pudo actualizar el avatar.');
      } finally {
        setAvatarBtn.disabled = false;
      }
    });
    actionsWrap.appendChild(setAvatarBtn);

    const deleteBtn = el('button', 'btn btn--danger', 'Eliminar foto');
    deleteBtn.type = 'button';
    deleteBtn.addEventListener('click', async () => {
      const ok = await app.confirmDialog('¿Eliminar esta ilustración del álbum? No podrás recuperarla.', {
        confirmText: 'Eliminar',
        danger: true,
      });
      if (!ok) return;
      deleteBtn.disabled = true;
      try {
        await deleteGalleryItem(current.id, item.id);
        haptics.action();
        app.toast('Ilustración eliminada.');
        const fresh = await getCharacter(current.id);
        if (fresh) current = fresh;
        if (opts.onUpdated) opts.onUpdated(current);
        lightbox.remove();
        render();
      } catch {
        app.toast('No se pudo eliminar la ilustración.');
        deleteBtn.disabled = false;
      }
    });
    actionsWrap.appendChild(deleteBtn);

    body.appendChild(actionsWrap);
    lightbox.appendChild(body);
    sheetNode.appendChild(lightbox);
  }

  render();
  app.openSheet(sheetNode, { fullscreen: true });
}
