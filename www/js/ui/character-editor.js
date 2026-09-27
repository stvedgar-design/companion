// www/js/ui/character-editor.js
// CCC-001: creador y editor de personajes propios. Una sola pantalla (hoja) sirve para las dos cosas:
// sin `opts.character` arma uno nuevo desde cero; con `opts.character` lee y edita cualquier personaje
// ya existente (creado con este flujo o importado). Todo se ensambla en una Card compatible con
// `chara_card_v2` vía `cards/build.js` y se guarda con `saveCharacter()`, igual que una card importada
// (docs/CONTRACT-HANDOFF.md, sección CCC-001: "no un pipeline de datos paralelo").

import { saveCharacter, newId } from '../state.js';
import { pickFiles } from '../platform.js';
import { makeAvatar } from '../cards/avatar.js';
import {
  buildCharacterCard,
  NAME_MAX,
  DESCRIPTION_MAX,
  SCENARIO_MAX,
  FIRST_MES_MAX,
  MES_EXAMPLE_MAX,
  PERSONALITY_TEXT_MAX,
} from '../cards/build.js';
import { PERSONALITY_TAGS, MAX_PERSONALITY_TAGS, sanitizePersonalityTags } from '../personality-tags.js';
import { sanitizeAppearance, APPEARANCE_FIXED_MAX, APPEARANCE_CURRENT_MAX } from '../character-appearance.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function textField({ label, hint, max, rows, value, placeholder }) {
  const field = el('div', 'field');
  field.appendChild(el('label', 'field__label', label));
  const input = el(rows ? 'textarea' : 'input', 'inp');
  if (rows) input.rows = rows;
  else input.type = 'text';
  input.maxLength = max;
  input.value = value || '';
  input.placeholder = placeholder || '';
  input.setAttribute('aria-label', label);
  input.autocomplete = 'off';
  field.appendChild(input);
  const counter = el('div', 'field__hint');
  const refresh = () => { counter.textContent = `${input.value.length} / ${max} caracteres`; };
  refresh();
  input.addEventListener('input', refresh);
  field.appendChild(counter);
  if (hint) field.appendChild(el('div', 'field__hint', hint));
  return { field, input };
}

/**
 * @param {{ openSheet: Function, closeSheet: Function, toast: Function, navigate: Function }} app
 * @param {{ character?: import('../state.js').Character, onSaved?: (updated: import('../state.js').Character) => void }} [opts]
 *   Sin `character`: crea uno nuevo (al guardar, navega a sus chats). Con `character`: lo edita en el
 *   sitio (al guardar, avisa y llama a `onSaved` con la copia guardada, sin navegar).
 */
export function openCharacterEditor(app, opts = {}) {
  const editing = !!opts.character;
  const source = opts.character || null;
  const card = source ? source.card : null;

  const node = el('div', 'character-editor');
  node.appendChild(el('h3', 'sheet__title', editing ? `Ver personaje: ${source.name}` : 'Crear personaje'));
  if (!editing) {
    node.appendChild(el('div', 'field__hint', 'Pocos pasos, para que no se sienta como escribir una card larga a mano. Puedes volver a editar todo después.'));
  }

  // ---------- avatar ----------
  let avatarDataUrl = source ? source.avatar : '';
  const avatarRow = el('div', 'settings-row');
  const avatarPreview = el('div', 'av av--md');
  const renderAvatarPreview = () => {
    avatarPreview.replaceChildren();
    if (avatarDataUrl) {
      const img = el('img');
      img.src = avatarDataUrl;
      img.alt = '';
      avatarPreview.appendChild(img);
    } else {
      avatarPreview.appendChild(el('span', null, (nameField.input.value || '?').trim().charAt(0).toUpperCase()));
    }
  };
  const avatarBtn = el('button', 'btn btn--sm', editing ? 'Cambiar foto' : 'Elegir foto (opcional)');
  avatarBtn.type = 'button';
  avatarBtn.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    avatarBtn.disabled = true;
    const dataUrl = await makeAvatar(files[0]);
    avatarBtn.disabled = false;
    if (!dataUrl) {
      app.toast('No se pudo usar esa imagen como avatar.');
      return;
    }
    avatarDataUrl = dataUrl;
    renderAvatarPreview();
  });
  avatarRow.append(avatarPreview, avatarBtn);
  node.appendChild(avatarRow);

  // ---------- nombre ----------
  const nameField = textField({ label: 'Nombre', max: NAME_MAX, value: source ? source.name : '', placeholder: 'Ej.: Mia' });
  node.appendChild(nameField.field);
  renderAvatarPreview();

  // ---------- personalidad (pills o texto libre) ----------
  const personalityWrap = el('div', 'field');
  personalityWrap.appendChild(el('div', 'field__label', 'Personalidad'));
  const personalityBody = el('div');
  personalityWrap.appendChild(personalityBody);
  node.appendChild(personalityWrap);

  let usingTags = editing ? (source.personalityTags && source.personalityTags.length > 0) : true;
  let selectedTags = editing ? sanitizePersonalityTags(source.personalityTags) : [];
  const freeTextInitial = editing && !usingTags ? (card.personality || '') : '';

  function renderPersonality() {
    personalityBody.replaceChildren();
    if (usingTags) {
      const hint = el('div', 'field__hint', `Elige hasta ${MAX_PERSONALITY_TAGS}. Se arman en una frase legible al guardar.`);
      const picker = el('div', 'tag-picker');
      for (const tag of PERSONALITY_TAGS) {
        const btn = el('button', 'tag-pill', tag.label);
        btn.type = 'button';
        btn.classList.toggle('tag-pill--active', selectedTags.includes(tag.id));
        btn.addEventListener('click', () => {
          if (selectedTags.includes(tag.id)) {
            selectedTags = selectedTags.filter((id) => id !== tag.id);
          } else {
            if (selectedTags.length >= MAX_PERSONALITY_TAGS) {
              app.toast(`Máximo ${MAX_PERSONALITY_TAGS} etiquetas.`);
              return;
            }
            selectedTags = [...selectedTags, tag.id];
          }
          renderPersonality();
        });
        picker.appendChild(btn);
      }
      personalityBody.append(picker, hint);
    } else {
      const area = el('textarea', 'inp');
      area.rows = 2;
      area.maxLength = PERSONALITY_TEXT_MAX;
      area.value = freeTextInitial;
      area.setAttribute('aria-label', 'Personalidad');
      area.addEventListener('input', () => { freeTextValue = area.value; });
      let freeTextValue = area.value;
      personalityBody._getFreeText = () => freeTextValue;
      const convertBtn = el('button', 'btn btn--ghost btn--sm', 'Convertir a etiquetas');
      convertBtn.type = 'button';
      convertBtn.addEventListener('click', () => {
        usingTags = true;
        selectedTags = [];
        renderPersonality();
      });
      const hint = el(
        'div',
        'field__hint',
        'Esta card no usa etiquetas: se muestra como texto libre, tal cual la trajo. Puedes editarla aquí, o convertirla a etiquetas (empieza sin ninguna elegida, para no inventar matices que el texto original no tenía).'
      );
      personalityBody.append(area, hint, convertBtn);
    }
  }
  renderPersonality();

  // ---------- descripción / escenario / primer mensaje / ejemplo ----------
  const description = textField({
    label: 'Descripción / trasfondo',
    max: DESCRIPTION_MAX,
    rows: 3,
    value: card ? card.description : '',
    placeholder: 'Quién es, cómo es. En inglés, el modelo responde mejor.',
  });
  const scenario = textField({
    label: 'Situación actual',
    max: SCENARIO_MAX,
    rows: 2,
    value: card ? card.scenario : '',
    placeholder: 'Dónde y en qué momento están (opcional).',
  });
  const firstMes = textField({
    label: 'Primer mensaje',
    max: FIRST_MES_MAX,
    rows: 3,
    value: card ? card.first_mes : '',
    placeholder: 'Cómo saluda la primera vez.',
  });
  const mesExample = textField({
    label: 'Ejemplo de diálogo (opcional)',
    max: MES_EXAMPLE_MAX,
    rows: 2,
    value: card ? card.mes_example : '',
    placeholder: 'Un intercambio corto que muestre su forma de hablar.',
  });
  node.append(description.field, scenario.field, firstMes.field, mesExample.field);

  // ---------- apariencia (MEM-009, reutilizado tal cual) ----------
  const savedAppearance = sanitizeAppearance(source ? source.appearance : undefined);
  node.appendChild(el('div', 'field__label', 'Apariencia'));
  const fixed = textField({
    label: 'Rasgos fijos',
    hint: 'Lo que no cambia: complexión, pelo, ojos, algún rasgo distintivo.',
    max: APPEARANCE_FIXED_MAX,
    rows: 2,
    value: savedAppearance.fixed,
    placeholder: 'Ej.: short and slim, pink hair, violet eyes',
  });
  const current = textField({
    label: 'Ropa o estado de ahora',
    hint: 'Lo que cambia seguido: qué lleva puesto, si está despeinada…',
    max: APPEARANCE_CURRENT_MAX,
    rows: 2,
    value: savedAppearance.current,
    placeholder: 'Ej.: a white oversized hoodie and jeans',
  });
  node.append(fixed.field, current.field);

  // ---------- estilo de formato ----------
  const formatWrap = el('div', 'field');
  formatWrap.appendChild(el('div', 'field__label', 'Estilo de escritura'));
  const formatSkins = el('div', 'appearance-skins');
  const nomiBtn = el('button', 'appearance-skin', 'Nomi (con *acciones*)');
  const plainBtn = el('button', 'appearance-skin', 'Libre (sin asteriscos)');
  nomiBtn.type = 'button';
  plainBtn.type = 'button';
  formatSkins.append(nomiBtn, plainBtn);
  formatWrap.appendChild(formatSkins);
  formatWrap.appendChild(
    el(
      'div',
      'field__hint',
      '"Nomi" (como Mia o Theo): las acciones van entre asteriscos y la respuesta arranca ya dentro de una, si tienes esa ayuda activada en Ajustes. "Libre" (como Ani): sin asteriscos ni comillas, nunca se le fuerza ese formato.'
    )
  );
  node.appendChild(formatWrap);

  let formatStyle = editing && source.formatStyle === 'plain' ? 'plain' : 'nomi';
  function renderFormatStyle() {
    nomiBtn.classList.toggle('appearance-skin--active', formatStyle === 'nomi');
    plainBtn.classList.toggle('appearance-skin--active', formatStyle === 'plain');
  }
  nomiBtn.addEventListener('click', () => { formatStyle = 'nomi'; renderFormatStyle(); });
  plainBtn.addEventListener('click', () => { formatStyle = 'plain'; renderFormatStyle(); });
  renderFormatStyle();

  // ---------- guardar ----------
  const status = el('div', 'field__label');
  const saveBtn = el('button', 'btn', editing ? 'Guardar' : 'Crear personaje');
  saveBtn.type = 'button';
  node.append(saveBtn, status);

  saveBtn.addEventListener('click', async () => {
    if (!nameField.input.value.trim()) {
      status.textContent = 'El nombre es obligatorio.';
      return;
    }
    saveBtn.disabled = true;
    status.textContent = '';
    try {
      const builtCard = buildCharacterCard({
        name: nameField.input.value,
        personalityTags: usingTags ? selectedTags : [],
        personalityText: usingTags ? '' : (personalityBody._getFreeText ? personalityBody._getFreeText() : freeTextInitial),
        description: description.input.value,
        scenario: scenario.input.value,
        firstMes: firstMes.input.value,
        mesExample: mesExample.input.value,
      });
      const appearance = sanitizeAppearance({ fixed: fixed.input.value, current: current.input.value, updated: Date.now() });
      const personalityTags = usingTags ? selectedTags : [];

      if (editing) {
        const updated = {
          ...source,
          name: builtCard.name,
          avatar: avatarDataUrl,
          card: builtCard,
          appearance,
          formatStyle,
          personalityTags,
        };
        const saved = await saveCharacter(updated);
        // TEL-001: solo si la apariencia (MEM-009) de verdad cambió — nunca el contenido, solo que se editó.
        if (appearance.fixed !== savedAppearance.fixed || appearance.current !== savedAppearance.current) {
          logEvent(TEL_EVENTS.APPEARANCE_EDITED, { characterId: saved.id });
        }
        app.toast('Guardado.');
        if (opts.onSaved) opts.onSaved(saved);
        app.closeSheet();
      } else {
        const now = Date.now();
        const character = {
          id: newId(),
          name: builtCard.name,
          avatar: avatarDataUrl,
          card: builtCard,
          avatarMode: 'mini',
          created: now,
          updated: now,
          last: '',
          lorebook: [],
          lorebookPrevious: [],
          lorebookPreviousAt: 0,
          appearance,
          formatStyle,
          personalityTags,
        };
        const saved = await saveCharacter(character);
        logEvent(TEL_EVENTS.CHARACTER_CREATED, { characterId: saved.id, method: 'guided' });
        app.closeSheet();
        app.navigate('chats', { characterId: saved.id });
      }
    } catch (err) {
      status.textContent = 'No se pudo guardar. No se cambió nada.';
      saveBtn.disabled = false;
    }
  });

  app.openSheet(node);
}
