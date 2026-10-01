// www/js/ui/character-editor.js
// CCC-001: creador y editor de personajes propios. Una sola pantalla (hoja) sirve para las dos cosas:
// sin `opts.character` arma uno nuevo desde cero; con `opts.character` lee y edita cualquier personaje
// ya existente (creado con este flujo o importado). Todo se ensambla en una Card compatible con
// `chara_card_v2` vía `cards/build.js` y se guarda con `saveCharacter()`, igual que una card importada
// (docs/CONTRACT-HANDOFF.md, sección CCC-001: "no un pipeline de datos paralelo").

import { saveCharacter, newId } from '../state.js';
import { pickFiles } from '../platform.js';
import { makeAvatarSet } from '../cards/avatar.js';
import {
  buildCharacterCard,
  NAME_MAX,
  DESCRIPTION_MAX,
  SCENARIO_MAX,
  FIRST_MES_MAX,
  MES_EXAMPLE_MAX,
  PERSONALITY_TEXT_MAX,
  INSTRUCTIONS_MAX,
} from '../cards/build.js';
import { PERSONALITY_TAGS, MAX_PERSONALITY_TAGS, sanitizePersonalityTags } from '../personality-tags.js';
import { sanitizeAppearance, APPEARANCE_FIXED_MAX, APPEARANCE_CURRENT_MAX } from '../character-appearance.js';

// CCC-002: ejemplos de referencia para el botón "Ejemplo" de cada campo. Inventados a propósito (nunca
// contenido real de un personaje del usuario); en inglés, como el resto del contenido narrativo de las
// cards (ver personality-tags.js) — es lo que de verdad se manda al modelo.
const EXAMPLE_PERSONALITY_TAGS = ['curious', 'playful', 'loyal'];
const EXAMPLE_PERSONALITY_TEXT = 'Warm and a little shy at first, but fiercely loyal once she trusts you. Quick to tease, slow to open up about what she really feels.';
const EXAMPLE_DESCRIPTION = 'A quiet art student who just moved to the city. Still finding her way around, but always curious about the people she meets.';
const EXAMPLE_SCENARIO = "It's a quiet evening at her apartment, and she's been waiting for you to show up for a while now.";
const EXAMPLE_FIRST_MES = "*looks up and smiles as the door opens* Oh — you're finally here! I was starting to wonder if you got lost.";
const EXAMPLE_MES_EXAMPLE = "<START>\n{{user}}: What have you been up to today?\n{{char}}: *stretches and grins* Not much, actually. Just been waiting around for you, if I'm honest.";
const EXAMPLE_APPEARANCE_FIXED = 'Short and slim, pink hair, violet eyes.';
const EXAMPLE_APPEARANCE_CURRENT = 'A white oversized hoodie and jeans.';
const EXAMPLE_INSTRUCTIONS = 'Always stays in character and never breaks the fourth wall. Speaks in short, casual sentences.';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * CCC-002: botón "Ejemplo" plegable junto a un campo. Al abrirse, muestra un texto de ejemplo real
 * (nunca contenido del usuario) y un botón "Usar este ejemplo" que lo copia al campo — directo si está
 * vacío, con confirmación si ya tiene algo escrito (nunca se borra nada sin preguntar).
 * @param {{ confirmDialog: Function }} app
 * @param {{ label: string, exampleText: string, getValue: () => string, setValue: (text: string) => void }} opts
 */
function exampleBlock(app, { label, exampleText, getValue, setValue }) {
  const wrap = el('div', 'field-example');
  const toggleBtn = el('button', 'btn btn--ghost btn--sm', 'Ejemplo');
  toggleBtn.type = 'button';
  toggleBtn.setAttribute('aria-expanded', 'false');
  const panel = el('div', 'field-example__panel');
  panel.hidden = true;
  panel.appendChild(el('p', 'field-example__text', exampleText));
  const insertBtn = el('button', 'btn btn--ghost btn--sm', 'Usar este ejemplo');
  insertBtn.type = 'button';
  insertBtn.addEventListener('click', async () => {
    const current = (getValue() || '').trim();
    if (current) {
      const ok = await app.confirmDialog(`Esto va a reemplazar lo que ya escribiste en "${label}". ¿Reemplazar?`, { confirmText: 'Reemplazar' });
      if (!ok) return;
    }
    setValue(exampleText);
  });
  panel.appendChild(insertBtn);
  toggleBtn.addEventListener('click', () => {
    const show = panel.hidden;
    panel.hidden = !show;
    toggleBtn.setAttribute('aria-expanded', String(show));
    toggleBtn.textContent = show ? 'Ocultar ejemplo' : 'Ejemplo';
  });
  wrap.append(toggleBtn, panel);
  return wrap;
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
  // UI-027: se generan las dos versiones a la vez (pequeña para círculos, grande para la foto de la
  // ficha) desde la misma imagen de origen — ver cards/avatar.js.
  let avatarDataUrl = source ? source.avatar : '';
  let avatarLargeDataUrl = source ? source.avatarLarge || '' : '';
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
    const { avatar, avatarLarge } = await makeAvatarSet(files[0]);
    avatarBtn.disabled = false;
    if (!avatar) {
      app.toast('No se pudo usar esa imagen como avatar.');
      return;
    }
    avatarDataUrl = avatar;
    avatarLargeDataUrl = avatarLarge;
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
  personalityWrap.appendChild(el('div', 'field__hint', 'Cómo es: unas pocas palabras bastan. Elige etiquetas o descríbelo con tus propias palabras.'));
  const personalityExamplePanel = el('div', 'field-example__panel');
  personalityExamplePanel.hidden = true;
  function renderPersonalityExample() {
    personalityExamplePanel.replaceChildren();
    if (usingTags) {
      const labels = EXAMPLE_PERSONALITY_TAGS.map((id) => id.charAt(0).toUpperCase() + id.slice(1)).join(', ');
      personalityExamplePanel.appendChild(el('p', 'field-example__text', `Por ejemplo: ${labels}.`));
      const insertBtn = el('button', 'btn btn--ghost btn--sm', 'Usar este ejemplo');
      insertBtn.type = 'button';
      insertBtn.addEventListener('click', async () => {
        if (selectedTags.length) {
          const ok = await app.confirmDialog('Esto va a reemplazar las etiquetas que ya elegiste. ¿Reemplazar?', { confirmText: 'Reemplazar' });
          if (!ok) return;
        }
        selectedTags = [...EXAMPLE_PERSONALITY_TAGS];
        renderPersonality();
      });
      personalityExamplePanel.appendChild(insertBtn);
    } else {
      personalityExamplePanel.appendChild(el('p', 'field-example__text', EXAMPLE_PERSONALITY_TEXT));
      const insertBtn = el('button', 'btn btn--ghost btn--sm', 'Usar este ejemplo');
      insertBtn.type = 'button';
      insertBtn.addEventListener('click', async () => {
        const area = personalityBody.querySelector('textarea');
        if (!area) return;
        if (area.value.trim()) {
          const ok = await app.confirmDialog('Esto va a reemplazar lo que ya escribiste. ¿Reemplazar?', { confirmText: 'Reemplazar' });
          if (!ok) return;
        }
        area.value = EXAMPLE_PERSONALITY_TEXT;
        area.dispatchEvent(new Event('input'));
      });
      personalityExamplePanel.appendChild(insertBtn);
    }
  }
  const personalityExampleBtn = el('button', 'btn btn--ghost btn--sm', 'Ejemplo');
  personalityExampleBtn.type = 'button';
  personalityExampleBtn.setAttribute('aria-expanded', 'false');
  personalityExampleBtn.addEventListener('click', () => {
    const show = personalityExamplePanel.hidden;
    personalityExamplePanel.hidden = !show;
    personalityExampleBtn.setAttribute('aria-expanded', String(show));
    personalityExampleBtn.textContent = show ? 'Ocultar ejemplo' : 'Ejemplo';
    if (show) renderPersonalityExample();
  });
  personalityWrap.append(personalityExampleBtn, personalityExamplePanel);
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
    if (!personalityExamplePanel.hidden) renderPersonalityExample();
  }
  renderPersonality();

  // ---------- descripción / escenario / primer mensaje / ejemplo ----------
  const description = textField({
    label: 'Descripción / trasfondo',
    hint: 'Quién es y de dónde viene, en pocas frases.',
    max: DESCRIPTION_MAX,
    rows: 3,
    value: card ? card.description : '',
    placeholder: 'Quién es, cómo es. En inglés, el modelo responde mejor.',
  });
  description.field.appendChild(exampleBlock(app, {
    label: 'Descripción / trasfondo',
    exampleText: EXAMPLE_DESCRIPTION,
    getValue: () => description.input.value,
    setValue: (text) => { description.input.value = text; description.input.dispatchEvent(new Event('input')); },
  }));
  const scenario = textField({
    label: 'Situación actual',
    hint: 'Dónde está el personaje y qué está pasando justo antes de este chat.',
    max: SCENARIO_MAX,
    rows: 2,
    value: card ? card.scenario : '',
    placeholder: 'Dónde y en qué momento están (opcional).',
  });
  scenario.field.appendChild(exampleBlock(app, {
    label: 'Situación actual',
    exampleText: EXAMPLE_SCENARIO,
    getValue: () => scenario.input.value,
    setValue: (text) => { scenario.input.value = text; scenario.input.dispatchEvent(new Event('input')); },
  }));
  const firstMes = textField({
    label: 'Primer mensaje',
    hint: 'Cómo saluda la primera vez que hablan.',
    max: FIRST_MES_MAX,
    rows: 3,
    value: card ? card.first_mes : '',
    placeholder: 'Cómo saluda la primera vez.',
  });
  firstMes.field.appendChild(exampleBlock(app, {
    label: 'Primer mensaje',
    exampleText: EXAMPLE_FIRST_MES,
    getValue: () => firstMes.input.value,
    setValue: (text) => { firstMes.input.value = text; firstMes.input.dispatchEvent(new Event('input')); },
  }));
  const mesExample = textField({
    label: 'Ejemplo de diálogo (opcional)',
    hint: 'Un intercambio corto que muestre cómo habla. Si quieres, escribe <START> al principio y luego algunas líneas con {{user}} y {{char}}: {{user}} se reemplaza por tu nombre y {{char}} por el del personaje cuando hablan.',
    max: MES_EXAMPLE_MAX,
    rows: 2,
    value: card ? card.mes_example : '',
    placeholder: 'Un intercambio corto que muestre su forma de hablar.',
  });
  mesExample.field.appendChild(exampleBlock(app, {
    label: 'Ejemplo de diálogo',
    exampleText: EXAMPLE_MES_EXAMPLE,
    getValue: () => mesExample.input.value,
    setValue: (text) => { mesExample.input.value = text; mesExample.input.dispatchEvent(new Event('input')); },
  }));
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
  fixed.field.appendChild(exampleBlock(app, {
    label: 'Rasgos fijos',
    exampleText: EXAMPLE_APPEARANCE_FIXED,
    getValue: () => fixed.input.value,
    setValue: (text) => { fixed.input.value = text; fixed.input.dispatchEvent(new Event('input')); },
  }));
  const current = textField({
    label: 'Ropa o estado de ahora',
    hint: 'Lo que cambia seguido: qué lleva puesto, si está despeinada…',
    max: APPEARANCE_CURRENT_MAX,
    rows: 2,
    value: savedAppearance.current,
    placeholder: 'Ej.: a white oversized hoodie and jeans',
  });
  current.field.appendChild(exampleBlock(app, {
    label: 'Ropa o estado de ahora',
    exampleText: EXAMPLE_APPEARANCE_CURRENT,
    getValue: () => current.input.value,
    setValue: (text) => { current.input.value = text; current.input.dispatchEvent(new Event('input')); },
  }));
  node.append(fixed.field, current.field);

  // ---------- instrucciones (CCC-002: reglas de comportamiento, no personalidad ni descripción) ----------
  const instructions = textField({
    label: 'Instrucciones (opcional)',
    hint: 'Reglas de comportamiento que no son personalidad ni descripción. Por ejemplo: nunca rompe el personaje, siempre habla en tercera persona.',
    max: INSTRUCTIONS_MAX,
    rows: 2,
    value: card ? card.post_history_instructions : '',
    placeholder: 'Ej.: nunca rompe el personaje.',
  });
  instructions.field.appendChild(exampleBlock(app, {
    label: 'Instrucciones',
    exampleText: EXAMPLE_INSTRUCTIONS,
    getValue: () => instructions.input.value,
    setValue: (text) => { instructions.input.value = text; instructions.input.dispatchEvent(new Event('input')); },
  }));
  node.appendChild(instructions.field);

  // CCC-003: el selector "Nomi/Libre" de la rama original queda OCULTO — en `main`, `formatStyle` todavía
  // no conecta con `formatAssist` ni con la reparación de asteriscos de `format.js` (decisión de producto
  // pendiente del arquitecto). El campo se conserva tal cual venía (o 'nomi' al crear) para no perder datos
  // ni obligar a una migración el día que se decida conectarlo.
  const formatStyle = editing && source.formatStyle === 'plain' ? 'plain' : 'nomi';

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
        instructions: instructions.input.value,
      });
      const appearance = sanitizeAppearance({ fixed: fixed.input.value, current: current.input.value, updated: Date.now() });
      const personalityTags = usingTags ? selectedTags : [];

      if (editing) {
        const updated = {
          ...source,
          name: builtCard.name,
          avatar: avatarDataUrl,
          avatarLarge: avatarLargeDataUrl,
          card: builtCard,
          appearance,
          formatStyle,
          personalityTags,
        };
        const saved = await saveCharacter(updated);
        app.toast('Guardado.');
        if (opts.onSaved) opts.onSaved(saved);
        app.closeSheet();
      } else {
        const now = Date.now();
        const character = {
          id: newId(),
          name: builtCard.name,
          avatar: avatarDataUrl,
          avatarLarge: avatarLargeDataUrl,
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
