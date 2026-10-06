// www/js/ui/character-look.js
// MEM-009 / PARETO-002: hoja para editar la apariencia de un personaje por capas
// (Capa 0: cuerpo inmutable, Capa 1: lencería/íntima, Capa 2: atuendo exterior, Capa 3: accesorios/regalos).

import { saveCharacterAppearance } from '../state.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';
import {
  APPEARANCE_FIXED_MAX,
  APPEARANCE_CURRENT_MAX,
  APPEARANCE_UNDERWEAR_MAX,
  APPEARANCE_ACCESSORIES_MAX,
  sanitizeAppearance,
} from '../character-appearance.js';

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
  input.value = value || '';
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
 * @param {(updated: import('../state.js').Character) => void} [onSaved]
 */
export function openCharacterAppearance(app, character, onSaved) {
  const saved = sanitizeAppearance(character.appearance);
  const node = el('div', 'appearance');
  node.appendChild(el('h3', 'sheet__title', `Apariencia de ${character.name}`));
  node.appendChild(
    el(
      'div',
      'field__hint',
      'Sistema de apariencia por capas: define su cuerpo, su lencería, su ropa de ahora y sus accesorios o regalos recibidos. ' +
        'Escríbelo en el idioma de la conversación (normalmente inglés).'
    )
  );

  const fixed = textField({
    label: 'Capa 0: Rasgos físicos y cuerpo',
    hint: 'Lo que no cambia: complexión, estatura, pelo, ojos, marcas o detalles anatómicos íntimos.',
    max: APPEARANCE_FIXED_MAX,
    rows: 3,
    value: saved.fixed,
    placeholder: 'Ej.: petite athletic build, long dark hair, hazel eyes, small birthmark on hip',
  });

  const underwear = textField({
    label: 'Capa 1: Ropa interior / Lencería',
    hint: 'Lo que viste en la intimidad: lencería de encaje, ropa interior básica o desnudez.',
    max: APPEARANCE_UNDERWEAR_MAX,
    rows: 2,
    value: saved.underwear || '',
    placeholder: 'Ej.: black silk lace bra and matching panties',
  });

  const current = textField({
    label: 'Capa 2: Atuendo exterior actual',
    hint: 'La ropa que lleva puesta encima ahora mismo (vestido, jeans, sudadera).',
    max: APPEARANCE_CURRENT_MAX,
    rows: 2,
    value: saved.current,
    placeholder: 'Ej.: emerald green sundress with white sneakers',
  });

  const accessories = textField({
    label: 'Capa 3: Accesorios y regalos',
    hint: 'Objetos con valor afectivo o que porta habitualmente (los lentes que le regalaste, un collar, reloj).',
    max: APPEARANCE_ACCESSORIES_MAX,
    rows: 2,
    value: saved.accessories || '',
    placeholder: 'Ej.: gold pendant necklace gifted by Edgar, round silver-framed reading glasses',
  });

  node.append(fixed.field, underwear.field, current.field, accessories.field);

  const status = el('div', 'field__label');
  const saveBtn = el('button', 'btn', 'Guardar');
  saveBtn.type = 'button';
  const clearBtn = el('button', 'btn btn--ghost', 'Borrar todo');
  clearBtn.type = 'button';
  clearBtn.disabled = !saved.fixed && !saved.current && !saved.underwear && !saved.accessories;
  const row = el('div', 'settings-row');
  row.append(saveBtn, clearBtn);
  node.append(row, status);

  let base = saved;
  async function save(patch) {
    saveBtn.disabled = true;
    clearBtn.disabled = true;
    try {
      const before = base;
      const updated = await saveCharacterAppearance(character.id, patch);
      const next = sanitizeAppearance(updated.appearance);
      if (
        next.fixed !== before.fixed ||
        next.current !== before.current ||
        next.underwear !== before.underwear ||
        next.accessories !== before.accessories
      ) {
        logEvent(TEL_EVENTS.APPEARANCE_EDITED, { characterId: character.id });
      }
      base = next;
      fixed.input.value = next.fixed;
      underwear.input.value = next.underwear;
      current.input.value = next.current;
      accessories.input.value = next.accessories;
      status.textContent = 'Guardado con éxito.';
      if (onSaved) onSaved(updated);
    } catch {
      status.textContent = 'No se pudo guardar. No se cambió nada.';
    } finally {
      saveBtn.disabled = false;
      clearBtn.disabled = !base.fixed && !base.current && !base.underwear && !base.accessories;
    }
  }

  saveBtn.addEventListener('click', () =>
    save({
      fixed: fixed.input.value,
      underwear: underwear.input.value,
      current: current.input.value,
      accessories: accessories.input.value,
    })
  );

  clearBtn.addEventListener('click', () =>
    save({ fixed: '', underwear: '', current: '', accessories: '' })
  );

  app.openSheet(node);
}
