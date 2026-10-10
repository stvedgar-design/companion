import { PSYCHOLOGICAL_TRAITS, WORLDVIEW_SUGGESTIONS, VULNERABILITY_PRESETS, ENCOUNTER_SUGGESTIONS } from '../data/identity-core.js';
import { haptics } from './haptics.js';
// www/js/ui/character-editor.js
// CCC-001: creador y editor de personajes propios. EDITAR (`opts.character` presente) sigue siendo una
// sola pantalla con todos los campos a la vez, sin cambios. CREAR (CCC-004) es un asistente guiado en
// pasos, con una pantalla de personalidades de partida (plantillas) para no empezar de cero. Los dos flujos comparten
// EXACTAMENTE los mismos campos, guías, botones "Ejemplo" y función de guardado (`buildCharacterCard`):
// el wizard solo reorganiza su presentación (ver `buildFormFields()` más abajo), no reescribe el
// formulario (docs/CONTRACT-HANDOFF.md, sección CCC-001: "no un pipeline de datos paralelo").

import { saveCharacter, newId } from '../state.js';
import { chooseAvatar } from './image-crop.js';
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
import { CHARACTER_ARCHETYPES } from '../data/character-archetypes.js';
import { applyGender, archetypeForGender, sanitizeGender, GENDER_LABELS } from '../pronoun-substitution.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';

// CCC-002: ejemplos de referencia para el botón "Ejemplo" de cada campo. Inventados a propósito (nunca
// contenido real de un personaje del usuario); en inglés, como el resto del contenido narrativo de las
// cards (ver personality-tags.js) — es lo que de verdad se manda al modelo.
// CCC-005: escritos UNA sola vez con pronombres neutros (they/their) y convertidos según el género elegido
// (pronoun-substitution.js; ver ahí la regla de qué puede ir después de "they").
const EXAMPLE_PERSONALITY_TAGS = ['curious', 'playful', 'loyal'];
const EXAMPLE_PERSONALITY_TEXT = "Warm and a little shy at first, but fiercely loyal once they're sure of you. Quick to tease, slow to open up about what they're really feeling.";
const EXAMPLE_DESCRIPTION = "A quiet art student who just moved to the city. Still finding their way around, but always curious about everyone they've met so far.";
const EXAMPLE_SCENARIO = "It's a quiet evening at their apartment, and they've been waiting for you to show up for a while now.";
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
 * CCC-005: `exampleText` viene con pronombres neutros; se muestra y se inserta ya convertido al género
 * elegido en ese momento (`genderHub`), y el texto del panel se actualiza si el género cambia.
 * @param {{ confirmDialog: Function }} app
 * @param {{ label: string, exampleText: string, getValue: () => string, setValue: (text: string) => void, genderHub: { get: () => string, subscribe: (fn: () => void) => void } }} opts
 */
function exampleBlock(app, { label, exampleText, getValue, setValue, genderHub }) {
  const wrap = el('div', 'field-example');
  const toggleBtn = el('button', 'btn btn--ghost btn--sm', 'Ejemplo');
  toggleBtn.type = 'button';
  toggleBtn.setAttribute('aria-expanded', 'false');
  const panel = el('div', 'field-example__panel');
  panel.hidden = true;
  const exampleEl = el('p', 'field-example__text', applyGender(exampleText, genderHub.get()));
  genderHub.subscribe(() => { exampleEl.textContent = applyGender(exampleText, genderHub.get()); });
  panel.appendChild(exampleEl);
  const insertBtn = el('button', 'btn btn--ghost btn--sm', 'Usar este ejemplo');
  insertBtn.type = 'button';
  insertBtn.addEventListener('click', async () => {
    const current = (getValue() || '').trim();
    if (current) {
      const ok = await app.confirmDialog(`Esto va a reemplazar lo que ya escribiste en "${label}". ¿Reemplazar?`, { confirmText: 'Reemplazar' });
      if (!ok) return;
    }
    setValue(applyGender(exampleText, genderHub.get()));
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
 * Construye TODOS los campos del formulario (avatar, nombre, personalidad, descripción, situación,
 * primer mensaje, ejemplo de diálogo, apariencia, instrucciones) — exactamente como antes del wizard
 * (CCC-002). Compartido por el flujo de edición (pantalla única) y por el wizard de creación (CCC-004),
 * que solo decide en qué contenedor va cada `.field` y cuándo se ve.
 * @param {{ confirmDialog: Function, toast: Function }} app
 * @param {{ editing: boolean, source: import('../state.js').Character|null }} ctx
 */
function buildFormFields(app, { editing, source }) {
  const card = source ? source.card : null;

  // ---------- género (CCC-005) ----------
  // Solo decide los pronombres de plantillas y ejemplos; se guarda en `Character.gender` y se puede cambiar
  // después. Cambiarlo NUNCA reescribe lo que ya está en los campos (el usuario pudo editarlo).
  let gender = sanitizeGender(source ? source.gender : undefined);
  const genderListeners = [];
  const genderHub = { get: () => gender, subscribe: (fn) => { genderListeners.push(fn); } };
  const genderField = el('div', 'field');
  genderField.appendChild(el('div', 'field__label', 'Género'));
  genderField.appendChild(el('div', 'field__hint', 'Solo ajusta los pronombres (she/her, he/his, they/their) de las plantillas y los ejemplos. No cambia nada más.'));
  const genderPicker = el('div', 'tag-picker');
  genderPicker.setAttribute('role', 'radiogroup');
  genderPicker.setAttribute('aria-label', 'Género');
  const renderGender = () => {
    genderPicker.replaceChildren();
    for (const { id, label } of GENDER_LABELS) {
      const btn = el('button', 'tag-pill', label);
      btn.type = 'button';
      btn.setAttribute('role', 'radio');
      btn.setAttribute('aria-checked', String(gender === id));
      btn.classList.toggle('tag-pill--active', gender === id);
      btn.addEventListener('click', () => {
        if (gender === id) return;
        gender = id;
        renderGender();
        for (const fn of genderListeners) fn();
      });
      genderPicker.appendChild(btn);
    }
  };
  renderGender();
  genderField.appendChild(genderPicker);

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
    avatarBtn.disabled = true;
    try {
      // UI-037: selector → recorte manual → las dos imágenes finales (mismo componente que "Cambiar foto").
      const set = await chooseAvatar(app);
      if (!set) return;
      avatarDataUrl = set.avatar;
      avatarLargeDataUrl = set.avatarLarge;
      renderAvatarPreview();
    } finally {
      avatarBtn.disabled = false;
    }
  });
  avatarRow.append(avatarPreview, avatarBtn);

  // ---------- nombre ----------
  const nameField = textField({ label: 'Nombre', max: NAME_MAX, value: source ? source.name : '', placeholder: 'Ej.: Mia' });
  renderAvatarPreview();

  // ---------- personalidad (pills o texto libre) ----------
  const personalityWrap = el('div', 'field');
  personalityWrap.appendChild(el('div', 'field__label', 'Personalidad'));
  personalityWrap.appendChild(el('div', 'field__hint', 'Cómo es y cómo cambia. Puedes elegir una personalidad ya hecha, etiquetas sueltas, o escribirla con tus propias palabras.'));
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
      personalityExamplePanel.appendChild(el('p', 'field-example__text', applyGender(EXAMPLE_PERSONALITY_TEXT, gender)));
      const insertBtn = el('button', 'btn btn--ghost btn--sm', 'Usar este ejemplo');
      insertBtn.type = 'button';
      insertBtn.addEventListener('click', async () => {
        const area = personalityBody.querySelector('textarea');
        if (!area) return;
        if (area.value.trim()) {
          const ok = await app.confirmDialog('Esto va a reemplazar lo que ya escribiste. ¿Reemplazar?', { confirmText: 'Reemplazar' });
          if (!ok) return;
        }
        area.value = applyGender(EXAMPLE_PERSONALITY_TEXT, gender);
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
  // CCC-006: elegir una de las personalidades de partida (con capas) también para un personaje que ya existe.
  // Solo reemplaza el campo Personalidad del formulario; nada se guarda hasta pulsar Guardar/Crear.
  const pickBtn = el('button', 'btn btn--ghost btn--sm', 'Elegir una personalidad');
  pickBtn.type = 'button';
  pickBtn.setAttribute('aria-expanded', 'false');
  const pickPanel = el('div', 'field-example__panel');
  pickPanel.hidden = true;
  function renderPickPanel(pending) {
    pickPanel.replaceChildren();
    if (pending) {
      pickPanel.appendChild(el('p', 'field-example__text', `Esto va a reemplazar la personalidad que ya tienes con la de "${pending.label}". ¿Reemplazar?`));
      const row = el('div', 'wizard-overwrite__actions');
      const cancel = el('button', 'btn btn--ghost btn--sm', 'Cancelar');
      cancel.type = 'button';
      cancel.addEventListener('click', () => renderPickPanel(null));
      const ok = el('button', 'btn btn--sm', 'Reemplazar');
      ok.type = 'button';
      ok.addEventListener('click', () => { applyPickedPersonality(pending); });
      row.append(cancel, ok);
      pickPanel.appendChild(row);
      return;
    }
    pickPanel.appendChild(el('p', 'field-example__text', 'Cada una describe cómo es al principio, qué la hace cambiar y cómo actúa después. Solo cambia el campo Personalidad.'));
    for (const archetype of CHARACTER_ARCHETYPES) {
      const item = el('button', 'archetype-card');
      item.type = 'button';
      item.appendChild(el('div', 'archetype-card__label', archetype.label));
      item.appendChild(el('div', 'archetype-card__tagline', archetype.tagline));
      item.addEventListener('click', () => {
        if (hasPersonalityContent()) renderPickPanel(archetype);
        else applyPickedPersonality(archetype);
      });
      pickPanel.appendChild(item);
    }
  }
  function applyPickedPersonality(archetype) {
    applyPersonalityText(applyGender(archetype.personality, gender));
    pickPanel.hidden = true;
    pickBtn.setAttribute('aria-expanded', 'false');
    pickBtn.textContent = 'Elegir una personalidad';
    renderPickPanel(null);
  }
  pickBtn.addEventListener('click', () => {
    const show = pickPanel.hidden;
    pickPanel.hidden = !show;
    pickBtn.setAttribute('aria-expanded', String(show));
    pickBtn.textContent = show ? 'Ocultar personalidades' : 'Elegir una personalidad';
    if (show) renderPickPanel(null);
  });
  personalityWrap.append(personalityExampleBtn, personalityExamplePanel, pickBtn, pickPanel);
  const personalityBody = el('div');
  personalityWrap.appendChild(personalityBody);

  let usingTags = editing ? (source.personalityTags && source.personalityTags.length > 0) : true;
  let selectedTags = editing ? sanitizePersonalityTags(source.personalityTags) : [];
  let freeTextInitial = editing && !usingTags ? (card.personality || '') : '';
  const currentFreeText = () => (personalityBody._getFreeText ? personalityBody._getFreeText() : freeTextInitial);
  const hasPersonalityContent = () => (usingTags ? selectedTags.length > 0 : !!currentFreeText().trim());
  // CCC-006: una personalidad con capas es texto libre (no etiquetas): se carga en el campo de texto.
  function applyPersonalityText(text) { usingTags = false; freeTextInitial = text; personalityBody._getFreeText = null; renderPersonality(); }

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
      area.rows = 6;
      area.maxLength = PERSONALITY_TEXT_MAX;
      area.value = freeTextInitial;
      area.setAttribute('aria-label', 'Personalidad');
      const counter = el('div', 'field__hint');
      const refreshCounter = () => { counter.textContent = `${area.value.length} / ${PERSONALITY_TEXT_MAX} caracteres`; };
      refreshCounter();
      area.addEventListener('input', () => { freeTextValue = area.value; refreshCounter(); });
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
        'Texto libre. Una buena personalidad tiene tres partes: cómo es al principio, qué hace que cambie (algo que haces tú) y cómo actúa después. Así se adapta a la escena en vez de repetirse. "Convertir a etiquetas" empieza sin ninguna elegida y descarta este texto.'
      );
      personalityBody.append(area, counter, hint, convertBtn);
    }
    if (!personalityExamplePanel.hidden) renderPersonalityExample();
  }
  renderPersonality();
  genderListeners.push(() => { if (!personalityExamplePanel.hidden) renderPersonalityExample(); updateIdentityPreview(); });

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
    genderHub,
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
    genderHub,
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
    genderHub,
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
    genderHub,
    label: 'Ejemplo de diálogo',
    exampleText: EXAMPLE_MES_EXAMPLE,
    getValue: () => mesExample.input.value,
    setValue: (text) => { mesExample.input.value = text; mesExample.input.dispatchEvent(new Event('input')); },
  }));

  // ---------- apariencia (MEM-009, reutilizado tal cual) ----------
  const savedAppearance = sanitizeAppearance(source ? source.appearance : undefined);
  const appearanceLabel = el('div', 'field__label', 'Apariencia');
  const fixed = textField({
    label: 'Rasgos fijos',
    hint: 'Lo que no cambia: complexión, pelo, ojos, algún rasgo distintivo.',
    max: APPEARANCE_FIXED_MAX,
    rows: 2,
    value: savedAppearance.fixed,
    placeholder: 'Ej.: short and slim, pink hair, violet eyes',
  });
  fixed.field.appendChild(exampleBlock(app, {
    genderHub,
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
    genderHub,
    label: 'Ropa o estado de ahora',
    exampleText: EXAMPLE_APPEARANCE_CURRENT,
    getValue: () => current.input.value,
    setValue: (text) => { current.input.value = text; current.input.dispatchEvent(new Event('input')); },
  }));

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
    genderHub,
    label: 'Instrucciones',
    exampleText: EXAMPLE_INSTRUCTIONS,
    getValue: () => instructions.input.value,
    setValue: (text) => { instructions.input.value = text; instructions.input.dispatchEvent(new Event('input')); },
  }));

  // CCC-003: el selector "Nomi/Libre" de la rama original queda OCULTO — en `main`, `formatStyle` todavía
  // no conecta con `formatAssist` ni con la reparación de asteriscos de `format.js` (decisión de producto
  // pendiente del arquitecto). El campo se conserva tal cual venía (o 'nomi' al crear) para no perder datos
  // ni obligar a una migración el día que se decida conectarlo.
  const formatStyle = editing && source.formatStyle === 'plain' ? 'plain' : 'nomi';

  // FASE 21: Identity Core fields
  const existingCore = source ? source.identityCore : null;
  let selectedTraits = new Set(existingCore && Array.isArray(existingCore.traits) ? existingCore.traits : ['observadora', 'cálida']);

  const worldview = textField({
    label: 'Cosmovisión & Lente',
    hint: 'Cómo interpreta la realidad y le da sentido a lo que vive.',
    rows: 2,
    max: 300,
    value: existingCore ? (existingCore.worldview || '') : '',
  });

  const vulnerability = textField({
    label: 'La grieta interior & Defensa',
    hint: 'La contradicción, temor o mecanismo de defensa que oculta tras su actitud habitual.',
    rows: 2,
    max: 300,
    value: existingCore ? (existingCore.vulnerability || '') : '',
  });

  const origin = textField({
    label: 'Dinámica de contacto inicial',
    hint: 'La situación y el ambiente en el segundo cero del encuentro.',
    rows: 2,
    max: 300,
    value: existingCore ? (existingCore.origin || existingCore.dynamic || '') : '',
  });

  const previewCard = el('div', 'identity-preview-card');
  function updateIdentityPreview() {
    previewCard.replaceChildren();
    const header = el('div', 'identity-preview-card__header');
    const av = el('div', 'av av--sm');
    if (avatarDataUrl) {
      const img = el('img');
      img.src = avatarDataUrl;
      av.appendChild(img);
    } else {
      av.appendChild(el('span', null, (nameField.input.value || '?').trim().charAt(0).toUpperCase()));
    }
    const info = el('div');
    info.appendChild(el('div', 'identity-preview-card__name', (nameField.input.value || 'Companion').trim()));
    const gObj = GENDER_LABELS.find((g) => g.id === gender);
    const genderLabel = gObj ? gObj.label : 'Presencia';
    info.appendChild(el('div', 'identity-preview-card__nature', genderLabel));
    header.append(av, info);
    previewCard.appendChild(header);

    const traitsWrap = el('div', 'identity-preview-card__traits');
    for (const t of selectedTraits) {
      traitsWrap.appendChild(el('span', 'chip chip--topic', t));
    }
    previewCard.appendChild(traitsWrap);

    const body = el('div', 'identity-preview-card__body');
    const parts = [];
    const wv = worldview.input.value.trim();
    const vul = vulnerability.input.value.trim();
    const orig = origin.input.value.trim();
    if (wv) parts.push(wv);
    if (vul) parts.push(`Grieta: ${vul}`);
    if (orig) parts.push(`Escena: ${orig}`);
    body.textContent = parts.join(' · ') || 'Completa su presencia, temperamento y mundo interior para ver la identidad cobrar vida.';
    previewCard.appendChild(body);
  }

  nameField.input.addEventListener('input', updateIdentityPreview);
  vulnerability.input.addEventListener('input', updateIdentityPreview);
  origin.input.addEventListener('input', updateIdentityPreview);
  updateIdentityPreview();

  let alternateGreetingsList = card && Array.isArray(card.alternate_greetings) ? [...card.alternate_greetings] : [];
  return {
    worldview, vulnerability, origin, previewCard, updateIdentityPreview,
    getSelectedTraits: () => Array.from(selectedTraits),
    setSelectedTraits: (set) => { selectedTraits = new Set(set); updateIdentityPreview(); },
    toggleTrait: (t) => {
      if (selectedTraits.has(t)) {
        if (selectedTraits.size > 2) selectedTraits.delete(t);
      } else {
        if (selectedTraits.size < 6) selectedTraits.add(t);
      }
      updateIdentityPreview();
    },
    getIdentityCore: () => ({
      traits: Array.from(selectedTraits),
      worldview: worldview.input.value.trim(),
      vulnerability: vulnerability.input.value.trim(),
      origin: origin.input.value.trim(),
      dynamic: origin.input.value.trim(),
      stage: (existingCore && existingCore.stage) || 'early',
      updated: Date.now()
    }),
    avatarRow, avatarBtn, nameField, genderField, personalityWrap,
    description, scenario, firstMes, mesExample,
    appearanceLabel, fixed, current, instructions,
    formatStyle,
    getAlternateGreetings: () => alternateGreetingsList,
    setAlternateGreetings: (list) => { alternateGreetingsList = list; },
    getGender: () => gender,
    getAvatar: () => ({ avatarDataUrl, avatarLargeDataUrl }),
    // Estado de personalidad, para que el wizard pueda aplicar una personalidad de partida o leerla al guardar.
    getPersonalityTags: () => (usingTags ? selectedTags : []),
    getPersonalityText: () => (usingTags ? '' : currentFreeText()),
    applyPersonalityTags: (tags) => { usingTags = true; selectedTags = [...tags]; renderPersonality(); },
    applyPersonalityText,
    hasPersonalityContent,
  };
}

/**
 * Arma la Card y guarda, igual en el flujo de edición y al terminar el wizard de creación: una sola
 * función de guardado (CCC-004, requisito "misma función de guardado/validación").
 */
async function saveFromFields(app, fields, { editing, source, opts }) {
  const builtCard = buildCharacterCard({
    name: fields.nameField.input.value,
    personalityTags: fields.getPersonalityTags(),
    personalityText: fields.getPersonalityText(),
    description: fields.description.input.value,
    scenario: fields.scenario.input.value,
    firstMes: fields.firstMes.input.value,
    mesExample: fields.mesExample.input.value,
    instructions: fields.instructions.input.value,
    alternateGreetings: fields.getAlternateGreetings ? fields.getAlternateGreetings() : [],
  });
  const appearance = sanitizeAppearance({ fixed: fields.fixed.input.value, current: fields.current.input.value, updated: Date.now() });
  const personalityTags = fields.getPersonalityTags();
  const { avatarDataUrl, avatarLargeDataUrl } = fields.getAvatar();

  if (editing) {
    const identityCore = fields.getIdentityCore ? fields.getIdentityCore() : undefined;
    const updated = {
      ...source,
      name: builtCard.name,
      avatar: avatarDataUrl,
      avatarLarge: avatarLargeDataUrl,
      card: builtCard,
      ...(identityCore ? { identityCore } : (source && source.identityCore ? { identityCore: source.identityCore } : {})),
      appearance,
      formatStyle: fields.formatStyle,
      personalityTags,
      gender: fields.getGender(),
    };
    const saved = await saveCharacter(updated);
    // TEL-002: solo si la apariencia de verdad cambió — nunca el contenido, solo que se editó.
    const before = sanitizeAppearance(source ? source.appearance : undefined);
    if (appearance.fixed !== before.fixed || appearance.current !== before.current) {
      logEvent(TEL_EVENTS.APPEARANCE_EDITED, { characterId: saved.id });
    }
    app.toast('Guardado.');
    if (opts.onSaved) opts.onSaved(saved);
    app.closeSheet();
  } else {
    const now = Date.now();
    const identityCore = fields.getIdentityCore ? fields.getIdentityCore() : undefined;
    const character = {
      id: newId(),
      name: builtCard.name,
      avatar: avatarDataUrl,
      avatarLarge: avatarLargeDataUrl,
      card: builtCard,
      ...(identityCore ? { identityCore } : {}),
      avatarMode: 'mini',
      created: now,
      updated: now,
      last: '',
      lorebook: [],
      lorebookPrevious: [],
      lorebookPreviousAt: 0,
      appearance,
      formatStyle: fields.formatStyle,
      personalityTags,
      gender: fields.getGender(),
    };
    const saved = await saveCharacter(character);
    logEvent(TEL_EVENTS.CHARACTER_CREATED, { characterId: saved.id, method: 'guided' });
    app.closeSheet();
    app.navigate('chats', { characterId: saved.id });
  }
}

/**
 * CCC-004: pantalla única de edición — exactamente el formulario de siempre (CCC-002), sin pasos.
 */
function renderEditScreen(app, fields, ctx) {
  const node = el('div', 'character-editor');
  node.appendChild(el('h3', 'sheet__title', `Ver personaje: ${ctx.source.name}`));
  node.append(fields.avatarRow, fields.nameField.field, fields.genderField, fields.personalityWrap);
  node.append(fields.description.field, fields.scenario.field, fields.firstMes.field, fields.mesExample.field);
  node.appendChild(fields.appearanceLabel);
  node.append(fields.fixed.field, fields.current.field, fields.instructions.field);

  const status = el('div', 'field__label');
  const saveBtn = el('button', 'btn', 'Guardar');
  saveBtn.type = 'button';
  node.append(saveBtn, status);

  saveBtn.addEventListener('click', async () => {
    if (!fields.nameField.input.value.trim()) {
      status.textContent = 'El nombre es obligatorio.';
      return;
    }
    if (app.confirmDialog) {
      const ok = await app.confirmDialog(`¿Guardar los cambios en ${fields.nameField.input.value.trim()}?`, { confirmText: 'Guardar' });
      if (!ok) return;
    }
    saveBtn.disabled = true;
    status.textContent = '';
    try {
      await saveFromFields(app, fields, ctx);
    } catch (err) {
      status.textContent = 'No se pudo guardar. No se cambió nada.';
      saveBtn.disabled = false;
    }
  });

  app.openSheet(node, { fullscreen: true });
}

/**
 * CCC-004: wizard de creación, en pasos, con selección de personalidad de partida (plantilla) como paso 2. Reutiliza
 * los mismos `fields` que la edición (ver `buildFormFields`) — solo cambia cómo se agrupan y se muestran.
 * El botón/gesto "atrás" de Android retrocede un paso (ver `companion:wizard-back` en main.js), salvo en
 * el primer paso, donde sale de la creación (mismo comportamiento que tenía el creador de antes: sin
 * confirmación, ya que hoy tampoco la tiene al tocar fuera de la hoja).
 */
function renderWizard(app, fields, ctx) {
  const node = el('div', 'character-editor');
  node.appendChild(el('h3', 'sheet__title', 'Crear companion'));
  const progress = el('div', 'field__hint wizard-progress');
  node.appendChild(progress);

  // Compatibilidad con CCC-006: inicialización o ajuste de personalidad
  const archetype = CHARACTER_ARCHETYPES[0];
  if (archetype && fields.applyPersonalityText) {
    fields.applyPersonalityText(archetype.personality);
  }

  // ---------- paso 1: La Presencia y la Voz ----------
  const step1 = el('div', 'wizard-step');
  step1.appendChild(el('div', 'field__hint', 'Define quién se manifiesta ante ti: su nombre, su voz gramatical y su imagen inicial.'));
  const identityStatus = el('div', 'field__label');
  step1.append(fields.avatarRow, fields.nameField.field, fields.genderField, fields.fixed.field, identityStatus);

  // ---------- paso 2: El Temperamento (El Actor — Agencia & Comunión) ----------
  const step2 = el('div', 'wizard-step');
  step2.appendChild(el('div', 'field__label', 'El Temperamento'));
  step2.appendChild(el('div', 'field__hint', 'Cómo se manifiesta su energía y conducta cotidiana en el espacio social (Agencia & Comunión):'));

  const traitsWrap = el('div', 'wizard-traits-container');
  const categories = [
    { key: 'agency', title: 'Agencia (Iniciativa, Asertividad y Distancia)' },
    { key: 'communion', title: 'Comunión (Calidez, Vínculo y Apertura)' },
    { key: 'passion', title: 'Textura y Resonancia Emocional' },
  ];

  function renderTraitsGroups() {
    traitsWrap.replaceChildren();
    const activeTraits = new Set(fields.getSelectedTraits ? fields.getSelectedTraits() : []);
    for (const cat of categories) {
      const group = el('div', 'traits-group');
      group.appendChild(el('div', 'traits-group__title', cat.title));
      const picker = el('div', 'tag-picker');
      const items = PSYCHOLOGICAL_TRAITS.filter((t) => t.category === cat.key);
      for (const item of items) {
        const btn = el('button', 'tag-pill', item.label);
        btn.type = 'button';
        const isSelected = activeTraits.has(item.id);
        btn.classList.toggle('tag-pill--active', isSelected);
        btn.title = item.hint;
        btn.addEventListener('click', () => {
          haptics.tap();
          if (fields.toggleTrait) fields.toggleTrait(item.id);
          renderTraitsGroups();
          updatePersonalityFromTraits();
        });
        picker.appendChild(btn);
      }
      group.appendChild(picker);
      traitsWrap.appendChild(group);
    }
  }

  function updatePersonalityFromTraits() {
    const active = fields.getSelectedTraits ? fields.getSelectedTraits() : [];
    if (active.length && fields.applyPersonalityText) {
      const traitLabels = active.map((id) => {
        const tr = PSYCHOLOGICAL_TRAITS.find((t) => t.id === id);
        return tr ? tr.label.toLowerCase() : id;
      });
      const gender = fields.getGender ? fields.getGender() : 'neutral';
      const text = `Presencia ${traitLabels.join(', ')}. Su actitud se adapta orgánicamente a la cercanía y a lo que sucede en cada momento.`;
      fields.applyPersonalityText(applyGender(text, gender));
    }
  }

  renderTraitsGroups();
  step2.appendChild(traitsWrap);

  // ---------- paso 3: El Mundo Interior y la Tensión Psicológica (El Agente) ----------
  const step3 = el('div', 'wizard-step');
  step3.appendChild(el('div', 'field__label', 'El Mundo Interior'));
  step3.appendChild(el('div', 'field__hint', 'La mirada con la que interpreta la realidad y la sombra o defensa que guarda dentro:'));

  if (fields.worldview) {
    step3.appendChild(fields.worldview.field);
    const wvSuggRow = el('div', 'tag-picker');
    wvSuggRow.style.marginBottom = 'var(--space-3)';
    for (const sugg of WORLDVIEW_SUGGESTIONS) {
      const btn = el('button', 'tag-pill', sugg.label);
      btn.type = 'button';
      btn.title = sugg.text;
      btn.addEventListener('click', () => {
        haptics.tap();
        fields.worldview.input.value = sugg.text;
        fields.worldview.input.dispatchEvent(new Event('input'));
      });
      wvSuggRow.appendChild(btn);
    }
    step3.appendChild(wvSuggRow);
  }

  if (fields.vulnerability) {
    step3.appendChild(fields.vulnerability.field);
    const vulnPresetsRow = el('div', 'tag-picker');
    vulnPresetsRow.style.marginBottom = 'var(--space-2)';
    for (const preset of VULNERABILITY_PRESETS) {
      const pBtn = el('button', 'tag-pill', preset.label);
      pBtn.type = 'button';
      pBtn.title = preset.text;
      pBtn.addEventListener('click', () => {
        haptics.tap();
        fields.vulnerability.input.value = preset.text;
        fields.vulnerability.input.dispatchEvent(new Event('input'));
      });
      vulnPresetsRow.appendChild(pBtn);
    }
    step3.appendChild(vulnPresetsRow);
  }

  // ---------- paso 4: El Umbral del Vínculo (El Autor & Génesis) ----------
  const step4 = el('div', 'wizard-step');
  step4.appendChild(el('div', 'field__label', 'El Umbral del Vínculo'));
  step4.appendChild(el('div', 'field__hint', 'El segundo cero donde se cruzan las miradas y comienza la relación:'));

  if (fields.origin) {
    step4.appendChild(fields.origin.field);
    const encSuggRow = el('div', 'tag-picker');
    encSuggRow.style.marginBottom = 'var(--space-3)';
    for (const enc of ENCOUNTER_SUGGESTIONS) {
      const eBtn = el('button', 'tag-pill', enc.label);
      eBtn.type = 'button';
      eBtn.title = enc.text;
      eBtn.addEventListener('click', () => {
        haptics.tap();
        fields.origin.input.value = enc.text;
        fields.origin.input.dispatchEvent(new Event('input'));
      });
      encSuggRow.appendChild(eBtn);
    }
    step4.appendChild(encSuggRow);
  }

  step4.appendChild(fields.firstMes.field);
  if (fields.previewCard) step4.appendChild(fields.previewCard);

  const saveStatus = el('div', 'field__label');
  const saveBtn = el('button', 'btn', 'Dar vida al companion');
  saveBtn.type = 'button';
  saveBtn.style.marginTop = 'var(--space-4)';
  step4.append(saveBtn, saveStatus);

  const steps = [step1, step2, step3, step4];
  node.append(...steps);

  // ---------- navegación ----------
  const navRow = el('div', 'wizard-nav');
  const backBtn = el('button', 'btn btn--ghost', 'Atrás');
  backBtn.type = 'button';
  const nextBtn = el('button', 'btn', 'Siguiente');
  nextBtn.type = 'button';
  navRow.append(backBtn, nextBtn);
  node.appendChild(navRow);

  let stepIndex = 0;

  function updateBackButtonHook() {
    document.body.classList.toggle('wizard-step-active', stepIndex > 0);
  }
  function onWizardBack() {
    if (stepIndex > 0) goToStep(stepIndex - 1);
  }
  document.addEventListener('companion:wizard-back', onWizardBack);
  document.addEventListener('shell:sheetclose', cleanupWizardBackHook, { once: true });
  function cleanupWizardBackHook() {
    document.removeEventListener('companion:wizard-back', onWizardBack);
    document.body.classList.remove('wizard-step-active');
  }

  function goToStep(i) {
    stepIndex = Math.max(0, Math.min(steps.length - 1, i));
    steps.forEach((s, idx) => { s.hidden = idx !== stepIndex; });
    const isLastStep = stepIndex === steps.length - 1;
    backBtn.hidden = stepIndex === 0;
    nextBtn.hidden = isLastStep;
    navRow.hidden = backBtn.hidden && nextBtn.hidden;
    progress.textContent = `Paso ${stepIndex + 1} de ${steps.length}`;
    if (fields.updateIdentityPreview) fields.updateIdentityPreview();
    renderTraitsGroups();
    updateBackButtonHook();
    const sheetCard = document.getElementById('sheet-card');
    if (sheetCard) sheetCard.scrollTop = 0;
  }

  backBtn.addEventListener('click', () => goToStep(stepIndex - 1));
  nextBtn.addEventListener('click', () => {
    if (stepIndex === 0) {
      if (!fields.nameField.input.value.trim()) {
        identityStatus.textContent = 'El nombre es obligatorio.';
        return;
      }
      identityStatus.textContent = '';
    }
    goToStep(stepIndex + 1);
  });

  saveBtn.addEventListener('click', async () => {
    if (!fields.nameField.input.value.trim()) {
      saveStatus.textContent = 'El nombre es obligatorio.';
      goToStep(0);
      return;
    }
    saveBtn.disabled = true;
    saveStatus.textContent = '';
    try {
      await saveFromFields(app, fields, ctx);
    } catch (err) {
      saveStatus.textContent = 'No se pudo guardar. No se cambió nada.';
      saveBtn.disabled = false;
    }
  });

  goToStep(0);
  app.openSheet(node, { fullscreen: true });
}

export function openCharacterEditor(app, opts = {}) {
  const editing = !!opts.character;
  const source = opts.character || null;
  const ctx = { editing, source, opts };
  const fields = buildFormFields(app, { editing, source });

  if (editing) {
    renderEditScreen(app, fields, ctx);
  } else {
    renderWizard(app, fields, ctx);
  }
}
