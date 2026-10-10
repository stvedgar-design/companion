// www/js/ui/character-sheet.js
// UI-027: ficha del personaje — pantalla de LECTURA primero (foto grande, relación, rasgos, descripción,
// apariencia, recuerdos), con un botón "Editar" que abre el editor de CCC-001/CCC-003. Es una hoja más
// (como "Ver personaje" o "Ver lorebook"): el botón/gesto atrás de Android ya la cierra sola (nav.js,
// `decideBack` trata cualquier hoja abierta igual, sin código nuevo acá). Se abre al tocar el nombre del
// personaje en la cabecera del chat (chat.js) o de la lista de chats (chats.js) — ver esos dos archivos
// para las entradas. Pura lectura de memoria/relación: no cambia lorebook ni relationship.js.

import { saveCharacter, getCharacter } from '../state.js';
import { defaultIdentity } from '../api/identity-synthesis.js';
import { defaultLife } from '../api/life.js';
import { defaultFollowUps } from '../api/followups.js';
import { defaultMailbox, unreadCount, sanitizeMailbox } from '../api/mailbox.js';
import { openMailbox, touchInteraction } from './mailbox.js';
import { sanitizeAppearance } from '../character-appearance.js';
import { PERSONALITY_TAGS } from '../personality-tags.js';
import { formatDateOnly } from '../msgtime.js';
import { openCharacterEditor } from './character-editor.js';
import { openCharacterAppearance } from './character-look.js';
import { openChatBackground } from './chat-background.js';
import { chooseAvatar } from './image-crop.js';
import { openCharacterGallery } from './character-gallery.js';
import { haptics } from './haptics.js';

const ICON_BACK = '<svg viewBox="0 0 24 24"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function personalityLabel(id) {
  const tag = PERSONALITY_TAGS.find((t) => t.id === id);
  return tag ? tag.label : id;
}

/**
 * UI-033: datos de un personaje NUEVO e independiente, duplicado de `character` — misma ficha (nombre
 * con sufijo, personalidad, descripción, situación actual, primer mensaje, ejemplo de diálogo,
 * apariencia, instrucciones de CCC-002, avatar, fondo de chat), pero en el mismo estado que un
 * personaje recién creado respecto a memoria y relación: sin chats (no es asunto de esta función: los
 * chats se guardan aparte, con su propio `characterId`, y nunca se tocan acá), sin lorebook, sin
 * resumen de continuidad (vive en `Chat`, no en `Character`) y con la relación en `early`. Pura, sin
 * guardar nada — quien llama hace `saveCharacter(duplicateCharacterData(original))`.
 *
 * Decisión documentada: el avatar (`avatar`/`avatarLarge`) y el fondo de chat (`chatBackground*`) se
 * guardan como data URL DENTRO del propio registro del personaje (no como blobs en un store aparte),
 * así que copiar el objeto los copia de verdad — no hay ninguna referencia compartida con el original
 * que pueda romperse si uno de los dos se borra después.
 * @param {import('../state.js').Character} character
 * @returns {import('../state.js').Character}
 */
export function duplicateCharacterData(character) {
  const now = Date.now();
  return {
    ...character,
    // Mismo patrón que `newId()` en state.js (no se importa de ahí para mantener esta función pura y
    // testeable sin IndexedDB: ese `newId` exportado depende de la instancia por defecto del backend real).
    id: 'c' + now.toString(36) + Math.random().toString(36).slice(2, 8),
    name: `${character.name} (copia)`,
    created: now,
    updated: now,
    last: '',
    lorebook: [],
    gallery: [],
    lorebookPrevious: [],
    lorebookPreviousAt: 0,
    lorebookTombstones: [],
    lorebookTombstonesPrevious: [],
    lorebookArchive: [],
    relationship: { text: '', level: 'early', updated: 0, source: 'auto' },
    mailbox: defaultMailbox(), // PROACT-001: el buzón y la marca de interacción son de ESE personaje
    identity: defaultIdentity(), // MEM-019: la síntesis nace de SUS recuerdos; el duplicado no tiene ninguno
    followUps: defaultFollowUps(), // HUM-004: los pendientes y el cumpleaños que dijo el usuario son de ESE personaje
    life: defaultLife(), // HUM-005: su día es de ESE personaje
  };
}

/**
 * Qué mostrar y qué ocultar en la ficha, a partir del personaje — función pura, sin DOM, para poder
 * probarla. "Rasgos" nunca inventa etiquetas para una card importada sin `personalityTags`: si no las
 * tiene, usa el texto libre de `card.personality` tal cual; si tampoco hay texto, se oculta la sección.
 * @param {import('../state.js').Character|null|undefined} character
 * @returns {{
 *   name: string, initial: string, heroSrc: string,
 *   relationshipText: string,
 *   traits: {kind:'tags', labels: string[]} | {kind:'text', text: string} | null,
 *   createdText: string,
 *   description: string,
 *   appearance: {fixed: string, current: string} | null,
 *   memoriesCount: number,
 * }}
 */
export function characterSheetModel(character) {
  const name = (character && typeof character.name === 'string' && character.name.trim()) || 'Sin nombre';
  const card = (character && character.card) || {};
  const tags = character && Array.isArray(character.personalityTags) ? character.personalityTags.filter((t) => typeof t === 'string') : [];
  const personalityText = (typeof card.personality === 'string' && card.personality.trim()) || '';
  const traits = tags.length
    ? { kind: 'tags', labels: tags.map(personalityLabel) }
    : personalityText
      ? { kind: 'text', text: personalityText }
      : null;

  const appearanceRaw = sanitizeAppearance(character && character.appearance);
  const appearance = appearanceRaw.fixed || appearanceRaw.current ? appearanceRaw : null;

  const description = (typeof card.description === 'string' && card.description.trim()) || '';
  const memoriesCount = Array.isArray(character && character.lorebook)
    ? character.lorebook.filter((e) => e && typeof e.content === 'string' && e.content.trim()).length
    : 0;

  return {
    name,
    initial: name.charAt(0).toUpperCase(),
    heroSrc: (character && (character.avatarLarge || character.avatar)) || '',
    traits,
    createdText: formatDateOnly(character && character.created),
    description,
    appearance,
    memoriesCount,
    galleryCount: Array.isArray(character && character.gallery) ? character.gallery.length : 0,
    mailboxUnread: unreadCount(character), // PROACT-001: notas del buzón sin abrir
    mailboxCount: sanitizeMailbox(character && character.mailbox).notes.filter((n) => n.status !== 'dismissed').length,
  };
}

function field(label, contentNode) {
  const wrap = el('div', 'field');
  wrap.appendChild(el('div', 'field__label', label));
  wrap.appendChild(contentNode);
  return wrap;
}

/**
 * @param {{ openSheet: Function, closeSheet: Function, toast: Function, navigate: Function }} app
 * @param {import('../state.js').Character} character
 * @param {{ onUpdated?: (updated: import('../state.js').Character) => void, openMemories?: () => void }} [opts]
 *   `onUpdated` se llama tras editar o cambiar la foto, con el personaje guardado (el llamador refresca su
 *   propia copia). `openMemories` lleva a la pantalla de memoria existente (distinta según se haya entrado
 *   desde un chat abierto o desde la lista de chats — ver chat.js/chats.js).
 */
export function openCharacterSheet(app, character, opts = {}) {
  let current = character;
  touchInteraction(character && character.id); // PROACT-001: visitó la ficha

  function render() {
    const m = characterSheetModel(current);
    const node = el('div', 'char-sheet');

    // ---------- 1. foto grande ----------
    const hero = el('div', 'char-sheet__hero');
    if (m.heroSrc) {
      const img = el('img');
      img.src = m.heroSrc;
      img.alt = '';
      hero.appendChild(img);
    } else {
      const fallback = el('div', 'char-sheet__hero-fallback');
      const circle = el('div', 'av av--lg');
      circle.appendChild(el('span', null, m.initial));
      fallback.appendChild(circle);
      hero.appendChild(fallback);
    }
    hero.appendChild(el('div', 'char-sheet__hero-fade'));
    const backBtn = el('button', 'char-sheet__back', '');
    backBtn.type = 'button';
    backBtn.setAttribute('aria-label', 'Volver');
    backBtn.innerHTML = ICON_BACK;
    backBtn.addEventListener('click', () => app.closeSheet());
    hero.appendChild(backBtn);
    node.appendChild(hero);

    // ---------- 2. nombre + Editar ----------
    const nameRow = el('div', 'char-sheet__namerow');
    nameRow.appendChild(el('h2', 'char-sheet__name', m.name));
    const editBtn = el('button', 'btn btn--ghost btn--sm', 'Editar');
    editBtn.type = 'button';
    editBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog(`¿Deseas editar los datos de ${m.name}?`, { confirmText: 'Editar' });
        if (!ok) return;
      }
      openCharacterEditor(app, {
        character: current,
        onSaved: (updated) => {
          current = updated;
          if (opts.onUpdated) opts.onUpdated(updated);
        },
      });
    });
    const nameActions = el('div', 'char-sheet__nameactions');
    nameActions.appendChild(editBtn);
    const duplicateBtn = el('button', 'btn btn--ghost btn--sm', 'Duplicar');
    duplicateBtn.type = 'button';
    duplicateBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog(`¿Duplicar a ${m.name} como un personaje nuevo e independiente?`, { confirmText: 'Duplicar' });
        if (!ok) return;
      }
      duplicateBtn.disabled = true;
      try {
        const saved = await saveCharacter(duplicateCharacterData(current));
        app.closeSheet();
        await app.navigate('chats', { characterId: saved.id });
        openCharacterSheet(app, saved, {});
      } catch {
        app.toast('No se pudo duplicar el personaje.');
        duplicateBtn.disabled = false;
      }
    });
    nameActions.appendChild(duplicateBtn);
    nameRow.appendChild(nameActions);
    node.appendChild(nameRow);



    // ---------- 4. rasgos ----------
    if (m.traits) {
      let content;
      if (m.traits.kind === 'tags') {
        content = el('div', 'char-sheet__chips');
        for (const label of m.traits.labels) content.appendChild(el('span', 'chip', label));
      } else {
        content = el('div', '', m.traits.text);
      }
      node.appendChild(field('Rasgos', content));
    }

    // ---------- 5. creada ----------
    if (m.createdText) {
      node.appendChild(field('Creada', el('div', '', m.createdText)));
    }



    // ---------- 6. descripción y apariencia ----------
    if (m.description) {
      node.appendChild(field('Descripción', el('div', '', m.description)));
    }
    if (m.appearance) {
      const body = el('div');
      if (m.appearance.fixed) body.appendChild(el('div', '', m.appearance.fixed));
      if (m.appearance.current) body.appendChild(el('div', 'field__hint', m.appearance.current));
      node.appendChild(field('Apariencia', body));
    }

    // ---------- 6b. editar apariencia (UI-031: antes vivía en el menú ⋮ del chat, junto a "Cambiar avatar") ----------
    const appearanceBtn = el('button', 'menu-item', 'Editar apariencia');
    appearanceBtn.type = 'button';
    appearanceBtn.addEventListener('click', async () => {
      if (app.confirmDialog) {
        const ok = await app.confirmDialog(`¿Deseas editar la apariencia de ${m.name}?`, { confirmText: 'Editar' });
        if (!ok) return;
      }
      openCharacterAppearance(app, current, (updated) => {
        current = updated;
        if (opts.onUpdated) opts.onUpdated(updated);
        render();
      });
    });
    node.appendChild(appearanceBtn);

    // ---------- 6c. fondo de chat (UI-032: antes vivía en el menú ⋮ del chat) ----------
    const bgBtn = el('button', 'menu-item', 'Fondo de chat');
    bgBtn.type = 'button';
    bgBtn.addEventListener('click', () => openChatBackground(app, current));
    node.appendChild(bgBtn);

    // ---------- 6e. álbum de fotos (FASE 14 / PARETO-008) ----------
    const galleryCountText = m.galleryCount === 1 ? '1 ilustración' : `${m.galleryCount} ilustraciones`;
    const galleryBtn = el('button', 'menu-item', `Álbum de fotos de ${m.name} · ${galleryCountText}`);
    galleryBtn.type = 'button';
    galleryBtn.dataset.role = 'gallery';
    galleryBtn.addEventListener('click', () => {
      haptics.tap();
      openCharacterGallery(app, current, {
        onUpdated: async (freshChar) => {
          if (freshChar) {
            current = freshChar;
          } else {
            const fresh = await getCharacter(current.id);
            if (fresh) current = fresh;
          }
          if (opts.onUpdated) opts.onUpdated(current);
          render();
        },
      });
    });
    node.appendChild(galleryBtn);

    // ---------- 6d. buzón (PROACT-001): solo si hay notas; el indicador «nueva(s)» se apaga al abrirlo ----------
    if (m.mailboxCount > 0) {
      const mailBtn = el('button', 'menu-item', `Buzón de ${m.name}${m.mailboxUnread ? ` · ${m.mailboxUnread} nueva${m.mailboxUnread === 1 ? '' : 's'}` : ''}`);
      mailBtn.type = 'button';
      mailBtn.dataset.role = 'mailbox';
      mailBtn.addEventListener('click', () => {
        openMailbox(app, current, {
          onBack: async () => {
            const fresh = await getCharacter(current.id);
            if (fresh) current = fresh;
            render();
          },
        });
      });
      node.appendChild(mailBtn);
    }

    // ---------- 7. recuerdos (Fase 21: Diario de Recuerdos limpio) ----------
    const memBtn = el('button', 'menu-item', `Diario de recuerdos de ${m.name} · ${m.memoriesCount} recuerdo${m.memoriesCount === 1 ? '' : 's'}`);
    memBtn.type = 'button';
    memBtn.addEventListener('click', () => {
      if (opts.openMemories) opts.openMemories();
    });
    node.appendChild(memBtn);

    // ---------- 8. cambiar foto ----------
    const photoBtn = el('button', 'btn btn--ghost', 'Cambiar foto');
    photoBtn.type = 'button';
    photoBtn.style.marginTop = 'var(--space-3, 12px)';
    photoBtn.addEventListener('click', async () => {
      photoBtn.disabled = true;
      try {
        // UI-037: selector → recorte manual → las dos imágenes finales (mismo componente que el creador).
        const set = await chooseAvatar(app);
        if (!set) return;
        const saved = await saveCharacter({ ...current, avatar: set.avatar, avatarLarge: set.avatarLarge });
        current = saved;
        if (opts.onUpdated) opts.onUpdated(saved);
        render();
      } catch {
        app.toast('No se pudo guardar la foto.');
      } finally {
        photoBtn.disabled = false;
      }
    });
    node.appendChild(photoBtn);

    app.openSheet(node, { fullscreen: true });
  }

  render();
}
