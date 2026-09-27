// www/js/ui/character-look.js
// MEM-009: hoja para editar la apariencia de un personaje (rasgos fijos + ropa/estado de ahora). Es por PERSONAJE (como el fondo y el
// lorebook): se abre desde el menú ⋮ de un chat, junto a "Cambiar avatar". La ficha es propia de la app, no forma parte de la card.

import { saveCharacterAppearance } from '../state.js';
import { APPEARANCE_FIXED_MAX, APPEARANCE_CURRENT_MAX, sanitizeAppearance } from '../character-appearance.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textField({ label, hint, max, rows, value, placeholder }) {
  const field = el('div', 'field');
  const lab = el('label', 'field__label', label);
  const input = el('textarea', 'inp');
  input.rows = rows;
  input.maxLength = max;
  input.value = value;
  input.placeholder = placeholder;
  input.setAttribute('aria-label', label);
  const counter = el('div', 'field__hint');
  const refresh = () => {
    counter.textContent = `${input.value.length} / ${max} caracteres`;
  };
  refresh();
  input.addEventListener('input', refresh);
  field.append(lab, input, counter, el('div', 'field__hint', hint));
  return { field, input };
}

/**
 * @param {{ openSheet: Function, toast: Function }} app
 * @param {import('../state.js').Character} character
 * @param {(updated: import('../state.js').Character) => void} [onSaved] se llama con el personaje guardado (chat.js refresca su copia).
 */
export function openCharacterAppearance(app, character, onSaved) {
  const saved = sanitizeAppearance(character.appearance);
  const node = el('div', 'appearance');
  node.appendChild(el('h3', 'sheet__title', `Apariencia de ${character.name}`));
  node.appendChild(
    el(
      'div',
      'field__hint',
      'Así se ve el personaje, para que no se contradiga ni tengas que describirlo cada vez. Es solo de este personaje (todos sus chats) y no forma parte de su card. ' +
        'Escríbelo en el idioma de la conversación (normalmente inglés) y en una línea.'
    )
  );

  const fixed = textField({
    label: 'Rasgos fijos',
    hint: 'Lo que no cambia: complexión, color de pelo y ojos, algún rasgo distintivo. Cambiarlo hace que la SIGUIENTE respuesta tarde más, una sola vez (~15-40 s).',
    max: APPEARANCE_FIXED_MAX,
    rows: 3,
    value: saved.fixed,
    placeholder: 'Ej.: short and slim, pink hair, violet eyes, a small scar on her chin',
  });
  const current = textField({
    label: 'Ropa o estado de ahora',
    hint: 'Lo que cambia seguido: qué lleva puesto, si está despeinada… Cambiarlo casi no se nota (1-3 s en la siguiente respuesta).',
    max: APPEARANCE_CURRENT_MAX,
    rows: 2,
    value: saved.current,
    placeholder: 'Ej.: a white oversized hoodie and jeans',
  });
  node.append(fixed.field, current.field);

  const status = el('div', 'field__label');
  const saveBtn = el('button', 'btn', 'Guardar');
  saveBtn.type = 'button';
  const clearBtn = el('button', 'btn btn--ghost', 'Borrar todo');
  clearBtn.type = 'button';
  clearBtn.disabled = !saved.fixed && !saved.current;
  const row = el('div', 'settings-row');
  row.append(saveBtn, clearBtn);
  node.append(row, status);

  let base = saved;
  async function save(patch) {
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    try {
      const updated = await saveCharacterAppearance(character.id, patch);
      const next = sanitizeAppearance(updated.appearance);
      const fixedChanged = next.fixed !== base.fixed;
      base = next;
      fixed.input.value = next.fixed;
      current.input.value = next.current;
      status.textContent = fixedChanged && next.fixed ? 'Guardado. La próxima respuesta puede tardar más, solo esa vez.' : 'Guardado.';
      if (onSaved) onSaved(updated);
    } catch {
      status.textContent = 'No se pudo guardar. No se cambió nada.';
    } finally {
      saveBtn.disabled = false;
      clearBtn.disabled = !base.fixed && !base.current;
    }
  }
  saveBtn.addEventListener('click', () => save({ fixed: fixed.input.value, current: current.input.value }));
  clearBtn.addEventListener('click', () => save({ fixed: '', current: '' }));

  app.openSheet(node);
}
