// www/js/ui/character-sheet.js
// UI-027: ficha del personaje — pantalla de LECTURA primero (foto grande, relación, rasgos, descripción,
// apariencia, recuerdos), con un botón "Editar" que abre el editor de CCC-001/CCC-003. Es una hoja más
// (como "Ver personaje" o "Ver lorebook"): el botón/gesto atrás de Android ya la cierra sola (nav.js,
// `decideBack` trata cualquier hoja abierta igual, sin código nuevo acá). Se abre al tocar el nombre del
// personaje en la cabecera del chat (chat.js) o de la lista de chats (chats.js) — ver esos dos archivos
// para las entradas. Pura lectura de memoria/relación: no cambia lorebook ni relationship.js.

import { saveCharacter } from '../state.js';
import { relationshipDisplayText, relationshipSummary } from '../api/relationship.js';
import { sanitizeAppearance } from '../character-appearance.js';
import { PERSONALITY_TAGS } from '../personality-tags.js';
import { formatDateOnly } from '../msgtime.js';
import { openCharacterEditor } from './character-editor.js';
import { openCharacterAppearance } from './character-look.js';
import { makeAvatarSet } from '../cards/avatar.js';
import { pickFiles } from '../platform.js';

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
  const memoriesCount = relationshipSummary((character && character.lorebook) || []).total;

  return {
    name,
    initial: name.charAt(0).toUpperCase(),
    heroSrc: (character && (character.avatarLarge || character.avatar)) || '',
    relationshipText: relationshipDisplayText(character),
    traits,
    createdText: formatDateOnly(character && character.created),
    description,
    appearance,
    memoriesCount,
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
    editBtn.addEventListener('click', () => {
      openCharacterEditor(app, {
        character: current,
        onSaved: (updated) => {
          current = updated;
          if (opts.onUpdated) opts.onUpdated(updated);
        },
      });
    });
    nameRow.appendChild(editBtn);
    node.appendChild(nameRow);

    // ---------- 3. relación (MEM-014; nunca se toca, solo se lee) ----------
    node.appendChild(field('Relación', el('div', '', m.relationshipText)));

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
    appearanceBtn.addEventListener('click', () => {
      openCharacterAppearance(app, current, (updated) => {
        current = updated;
        if (opts.onUpdated) opts.onUpdated(updated);
        render();
      });
    });
    node.appendChild(appearanceBtn);

    // ---------- 7. recuerdos ----------
    const memBtn = el('button', 'menu-item', `${m.memoriesCount} recuerdo${m.memoriesCount === 1 ? '' : 's'} · Ver`);
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
      const files = await pickFiles();
      if (!files.length) return;
      photoBtn.disabled = true;
      try {
        const { avatar, avatarLarge } = await makeAvatarSet(files[0]);
        if (!avatar) {
          app.toast('No se pudo usar esa imagen como avatar.');
          return;
        }
        const saved = await saveCharacter({ ...current, avatar, avatarLarge });
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

    app.openSheet(node);
  }

  render();
}
