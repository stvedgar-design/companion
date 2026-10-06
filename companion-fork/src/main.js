import { EMPTY_DRAFT, CORE_PERSONALITY, TEMPERAMENT, RELATIONSHIPS, LIFE_OUTSIDE_CHAT, VOICE, HAIR_LENGTH, BODY_TYPES, SKIN_TONES, EYE_COLORS, HAIR_COLORS, APPEARANCE_EXTRAS, createSeed, toCharacterCardV2, validateDraft } from './domain/seed.js';
import { conversationFor, createEpisode, emptyWorkspace, episodesFor, findEpisodeById, normalizeWorkspace, setActiveEpisode } from './domain/workspace.js';
import { loadWorkspace, saveWorkspace } from './storage/local-store.js';
import { generateContinuitySummary, generateMemorySuggestions, generateReply, testConnection } from './llm/koboldcpp.js';
import { buildMemoryPrompt, nextMemoryBatch, parseMemoryProposals } from './memory/manager.js';
import { backupSummary, createPrivateBackup, mergeWorkspaces, readPrivateBackup, validateBackupPassphrase } from './storage/private-backup.js';

const root = document.querySelector('#app');
const steps = ['Who are they?', 'Core personality', 'Temperament', 'Starting relationship', 'Life outside chat', 'Voice', 'Appearance'];
let state = {
  workspace: emptyWorkspace(), view: 'catalog', step: 0, draft: { ...EMPTY_DRAFT },
  activeId: null, reviewSeed: null, saved: false, saveError: '', chatError: '', continuityError: '', episodeError: '', settingsMessage: '', memorySettingsMessage: '', generating: false, summarizing: false, editingMessage: null, memoryProcessing: false, pendingBackup: null, backupMessage: '',
};

const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const newId = prefix => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
const checked = (list = [], item) => list.includes(item) ? 'checked' : '';
const field = (name, title, example, rows = 1, optional = true) => `<label class="field"><span>${title}${optional ? ' <em>optional</em>' : ' <em>required</em>'}</span>${rows === 1
  ? `<input name="${name}" maxlength="500" placeholder="${example}" value="${escapeHtml(state.draft[name])}">`
  : `<textarea name="${name}" rows="${rows}" maxlength="1000" placeholder="${example}">${escapeHtml(state.draft[name])}</textarea>`}<small>${optional ? 'Leave blank if you want the model to improvise. Example wording is only a guide.' : (name === 'name' ? 'Add a name to continue.' : 'This is used as a flexible guide for the character.')}</small></label>`;

async function persist() {
  if (state.view === 'create') {
    state.workspace.draft = state.draft;
    state.workspace.step = state.step;
  }
  try {
    await saveWorkspace(state.workspace);
    state.saved = true; state.saveError = '';
    const status = document.querySelector('#save-status');
    if (status) status.textContent = 'Saved on this device';
    return true;
  } catch (error) {
    state.saved = false; state.saveError = error.message;
    const status = document.querySelector('#save-status');
    if (status) status.textContent = 'Could not save. Keep this page open and try again.';
    return false;
  }
}

function progress() {
  const total = steps.length + 1;
  return `<div class="progress-wrap"><div class="progress-copy"><span>Step ${state.step + 1} of ${total}</span><span>${steps[state.step]}</span></div><div class="progress-track" role="progressbar" aria-valuenow="${state.step + 1}" aria-valuemin="1" aria-valuemax="${total}"><span style="width:${((state.step + 1) / total) * 100}%"></span></div></div>`;
}

function chipGroup(title, values, key, options = {}) {
  const selected = state.draft[key] ?? [];
  const max = options.max ?? '';
  return `<fieldset class="field chip-field"><legend>${title} <em>${options.optional === false ? 'choose one' : 'optional'}</em></legend><div class="tag-list">${values.map(item => `<label class="choice-chip"><input type="${options.single ? 'radio' : 'checkbox'}" ${options.single ? `name="pick-${key}"` : ''} data-list="${key}" ${options.single ? 'data-single="true"' : ''} ${max ? `data-max="${max}"` : ''} value="${escapeHtml(item)}" ${options.single ? (selected === item ? 'checked' : '') : checked(selected, item)}><span>${escapeHtml(item)}</span></label>`).join('')}</div>${max ? `<small>Choose up to ${max}.</small>` : ''}</fieldset>`;
}

function singleChipGroup(title, values, key, required = false) {
  return chipGroup(title, values, key, { single: true, optional: !required });
}

function customChipInput(key, example) {
  const values = state.draft[key] ?? [];
  return `<div class="custom-chip-entry"><label class="field"><span>Add your own (optional)</span><div class="custom-chip-row"><input data-custom-input="${key}" maxlength="60" placeholder="${escapeHtml(example)}"><button class="secondary-button" data-add-custom="${key}" type="button">Add</button></div><small>Your words become selectable character-card traits. Example: ${escapeHtml(example)}</small></label><div class="tag-list custom-chip-list">${values.map((item, index) => `<button class="selected-custom-chip" type="button" data-remove-custom="${key}" data-index="${index}" aria-label="Remove ${escapeHtml(item)}">${escapeHtml(item)} <span aria-hidden="true">×</span></button>`).join('')}</div></div>`;
}

function singleAppearance(title, key, values) {
  return chipGroup(title, values, key, { single: true });
}

function multiAppearance(title, key, values) {
  return chipGroup(title, values, key);
}

function render() {
  document.body.classList.toggle('chat-active', state.view === 'chat');
  if (state.view === 'create') return renderCreator();
  if (state.view === 'review') return renderReview();
  if (state.view === 'settings') return renderSettings();
  if (state.view === 'memory') return renderMemoryReview();
  if (state.view === 'episodes') return renderEpisodes();
  if (state.view === 'chat') return renderChat();
  return renderCatalog();
}

function renderCatalog() {
  document.body.classList.remove('chat-active');
  const characters = state.workspace.characters;
  root.innerHTML = `<div class="hero"><p class="eyebrow">Your space</p><h1>Your companions</h1><p class="lede">Pick up a conversation or create someone new.</p></div>
    <div class="catalog-actions"><button id="open-settings" class="secondary-button" type="button">Connection settings</button><button id="new-companion" class="primary-button" type="button">Create a companion <span aria-hidden="true">＋</span></button></div>
    ${state.saveError ? `<p class="form-error" role="alert">${escapeHtml(state.saveError)}</p>` : ''}
    ${characters.length ? `<section class="companion-grid">${characters.map(character => {
      const identity = character.identity ?? {};
      const conversation = conversationFor(state.workspace, character.id);
      const last = conversation.messages.at(-1);
      const avatar = character.presentation?.avatarDataUrl ? `<img class="avatar-image" src="${escapeHtml(character.presentation.avatarDataUrl)}" alt="">` : escapeHtml((identity.name || '?').slice(0, 1).toUpperCase());
      const episodeCount = episodesFor(state.workspace, character.id).length;
      return `<article class="companion-card"><div class="companion-avatar" aria-hidden="true">${avatar}</div><div class="companion-copy"><h2>${escapeHtml(identity.name || 'Companion')}</h2><p>${escapeHtml(identity.personality || identity.permanentAppearance || 'A new story is ready to begin.')}</p>${last ? `<small>${escapeHtml(last.text.slice(0, 100))}</small>` : ''}</div><div class="card-story-actions"><button class="primary-button card-chat-button" data-chat="${escapeHtml(character.id)}" type="button">${last ? 'Continue story' : 'Start chatting'} <span aria-hidden="true">→</span></button><button class="text-button" data-episodes="${escapeHtml(character.id)}" type="button">${episodeCount} ${episodeCount === 1 ? 'episode' : 'episodes'}</button></div></article>`;
    }).join('')}</section>` : `<section class="card empty-catalog"><div class="empty-orbit">✳</div><h2>Your first companion is ready to begin</h2><p>Create a character, then come back here to start chatting with them.</p><button id="empty-create" class="primary-button" type="button">Create your first companion <span aria-hidden="true">→</span></button></section>`}
    <p class="save-status">${state.saved ? 'Your companions, episodes, and conversations are saved on this device. Create a private backup before reinstalling the app or moving to another device.' : 'Saving your workspace…'}</p>`;
  root.querySelector('#open-settings').addEventListener('click', openSettings);
  root.querySelector('#new-companion').addEventListener('click', beginCreate);
  root.querySelector('#empty-create')?.addEventListener('click', beginCreate);
  root.querySelectorAll('[data-chat]').forEach(button => button.addEventListener('click', () => openChat(button.dataset.chat)));
  root.querySelectorAll('[data-episodes]').forEach(button => button.addEventListener('click', () => openEpisodes(button.dataset.episodes)));
}

function beginCreate() {
  if (state.workspace.draft) {
    state.draft = { ...EMPTY_DRAFT, ...state.workspace.draft };
    for (const key of Object.keys(EMPTY_DRAFT)) if (Array.isArray(EMPTY_DRAFT[key]) && !Array.isArray(state.draft[key])) state.draft[key] = [];
    state.step = Math.max(0, Math.min(state.workspace.step, steps.length - 1));
  } else {
    state.draft = { ...EMPTY_DRAFT };
    state.step = 0;
  }
  state.reviewSeed = null;
  state.view = 'create';
  render();
}

function renderCreator() {
  document.body.classList.remove('chat-active');
  const d = state.draft;
  const content = [
    `${field('name', 'Name', 'e.g. Alma', 1, false)}${singleChipGroup('Gender', ['Male', 'Female'], 'gender', true)}<p class="hint-card">These are the only gender choices in this creator. Your selection becomes an explicit identity fact.</p>`,
    `${chipGroup('Choose up to 3 core traits', CORE_PERSONALITY, 'corePersonality', { max: 3 })}${customChipInput('customCorePersonality', 'e.g. quietly competitive')}`,
    `${chipGroup('Choose up to 3 temperament traits', TEMPERAMENT, 'temperament', { max: 3 })}${customChipInput('customTemperament', 'e.g. patient under pressure')}`,
    `${chipGroup('How does the relationship begin?', RELATIONSHIPS, 'relationship')}${customChipInput('customRelationship', 'e.g. former travel companions')}`,
    `${chipGroup('What do they enjoy outside your conversations?', LIFE_OUTSIDE_CHAT, 'lifeOutsideChat')}${customChipInput('customLifeOutsideChat', 'e.g. restore old furniture')}`,
    `${chipGroup('How should their voice feel?', VOICE, 'voice')}${customChipInput('customVoice', 'e.g. uses gentle dry humor')}`,
    `${singleAppearance('Hair length', 'hairLength', HAIR_LENGTH)}${singleAppearance('Body type', 'bodyType', BODY_TYPES)}${singleAppearance('Skin tone', 'skinTone', SKIN_TONES)}${singleAppearance('Eye color', 'eyeColor', EYE_COLORS)}${singleAppearance('Hair color', 'hairColor', HAIR_COLORS)}${multiAppearance('Additional details', 'appearanceExtras', APPEARANCE_EXTRAS)}${customChipInput('customAppearance', 'e.g. a small crescent-shaped scar on the chin')}
      <section class="clothing-guidance"><h2>Clothing style</h2><p>This describes their general taste, not a fixed outfit. The model uses it to choose clothes that suit the character and scene; what they wear can still change from one moment to another.</p>${field('clothingStyle', 'Describe their clothing style', 'e.g. relaxed vintage layers, natural fabrics, and muted colors', 2, false)}</section>
      <p class="hint-card">Selected traits become the companion’s identity seed. Opening messages are suggested from the starting relationship and can be edited in review.</p>`,
  ][state.step];
  root.innerHTML = `<div class="creator-heading"><div><p class="eyebrow">Build a character, one choice at a time</p><h1>${steps[state.step]}</h1><p class="lede">${['Start with the two facts that identify them.','Pick up to three defining traits, then add your own if you like.','Choose how their natural emotional style comes across.','Set the starting dynamic; it can evolve through your conversations.','Give them interests and routines beyond this chat.','Choose a speaking style the model can follow.','Shape their lasting appearance and general clothing taste.'][state.step]}</p></div><span class="step-count">${String(state.step + 1).padStart(2, '0')} <i>/ 08</i></span></div>${progress()}<section class="card creator-card"><div class="step-content">${content}</div><div class="nav-row"><button id="cancel-create" class="secondary-button" type="button">${state.step ? 'Back' : 'Cancel'}</button><button id="next" class="primary-button" type="button">${state.step === steps.length - 1 ? 'Review companion' : 'Continue'} <span aria-hidden="true">→</span></button></div><p id="form-error" class="form-error" role="alert"></p><p class="save-status">${escapeHtml(state.saveError || 'Your choices save as you go.')}</p></section>`;
  bindCreator();
}

function bindCreator() {
  root.querySelectorAll('input[name]:not([data-choice]), textarea[name]').forEach(el => el.addEventListener('input', () => { state.draft[el.name] = el.value; state.workspace.draft = state.draft; persist(); }));
  root.querySelectorAll('[data-list]').forEach(el => el.addEventListener('change', () => {
    const key = el.dataset.list;
    if (el.dataset.single) state.draft[key] = el.checked ? el.value : '';
    else {
      const customKey = ({ corePersonality: 'customCorePersonality', temperament: 'customTemperament' })[key];
      const count = (state.draft[key] ?? []).length + (customKey ? (state.draft[customKey] ?? []).length : 0);
      if (el.checked && el.dataset.max && count >= Number(el.dataset.max)) { el.checked = false; showFieldError(`Choose up to ${el.dataset.max} traits in this section.`); return; }
      state.draft[key] = el.checked ? [...new Set([...(state.draft[key] ?? []), el.value])] : (state.draft[key] ?? []).filter(x => x !== el.value);
    }
    state.workspace.draft = state.draft; persist();
  }));
  root.querySelectorAll('[data-add-custom]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.addCustom;
    const input = root.querySelector(`[data-custom-input="${key}"]`);
    const value = input?.value.trim();
    if (!value) { input?.focus(); return; }
    const target = ({ customCorePersonality: 'corePersonality', customTemperament: 'temperament' })[key];
    const count = (state.draft[key] ?? []).length + (target ? (state.draft[target] ?? []).length : 0);
    if (target && count >= 3) { showFieldError('Choose up to 3 traits in this section, including your own.'); return; }
    if ((state.draft[key] ?? []).some(item => item.toLowerCase() === value.toLowerCase())) { showFieldError('That custom trait is already in your list.'); return; }
    state.draft[key] = [...(state.draft[key] ?? []), value]; state.workspace.draft = state.draft; render(); persist();
  }));
  root.querySelectorAll('[data-remove-custom]').forEach(button => button.addEventListener('click', () => {
    const key = button.dataset.removeCustom; state.draft[key].splice(Number(button.dataset.index), 1); state.workspace.draft = state.draft; render(); persist();
  }));
  root.querySelector('#cancel-create').addEventListener('click', () => {
    if (state.step > 0) { state.step--; render(); persist(); }
    else { state.view = 'catalog'; state.workspace.draft = null; state.workspace.step = 0; render(); persist(); }
  });
  root.querySelector('#next').addEventListener('click', async () => {
    if (state.step === 0 && !state.draft.name.trim()) { showFieldError('Add a name to continue.'); root.querySelector('[name="name"]').focus(); return; }
    if (state.step === 0 && !state.draft.gender) { showFieldError('Choose Male or Female to continue.'); return; }
    if (state.step === steps.length - 1 && !state.draft.clothingStyle.trim()) { showFieldError('Describe their general clothing style to continue.'); root.querySelector('[name="clothingStyle"]').focus(); return; }
    if (state.step < steps.length - 1) { state.step++; render(); await persist(); return; }
    const result = validateDraft(state.draft);
    if (!result.valid) { root.querySelector('#form-error').textContent = Object.values(result.errors)[0]; return; }
    state.reviewSeed = createSeed(state.draft);
    state.view = 'review';
    render();
  });
}

function showFieldError(message) {
  const target = root.querySelector('#form-error');
  if (target) target.textContent = message;
}

function renderReview() {
  document.body.classList.remove('chat-active');
  const s = state.reviewSeed;
  const avatar = s.presentation?.avatarDataUrl;
  const profile = (image, size = 'large') => image ? `<img class="avatar-image avatar-image-${size}" src="${escapeHtml(image)}" alt="${escapeHtml(s.identity.name)} profile photo">` : `<span class="avatar-placeholder avatar-placeholder-${size}" aria-hidden="true">${escapeHtml((s.identity.name || '?').slice(0, 1).toUpperCase())}</span>`;
  const dashboard = [
    ['Who are they?', [['Name', s.identity.name], ['Gender', s.identity.gender]]],
    ['Core personality', [['Selected traits', s.identity.corePersonality.join(', ')]]],
    ['Temperament', [['Selected traits', s.identity.temperament.join(', ')]]],
    ['Starting relationship', [['Starting dynamic', s.identity.startingRelationship.join(', ')]]],
    ['Life outside chat', [['Interests and routines', s.identity.initialBehaviors.join(', ')]]],
    ['Voice', [['Voice cues', s.identity.voiceStyle.join(', ')]]],
    ['Appearance', [['Permanent appearance', s.identity.permanentAppearance], ['Clothing style guidance', s.preferences.clothingStyle]]],
  ];
  const sectionCards = dashboard.map(([title, fields]) => `<section class="review-section"><h2>${title}</h2>${fields.map(([label, value]) => `<div class="review-value"><span class="review-label">${label}</span><p>${value ? escapeHtml(value) : '<span class="empty-note">Not defined</span>'}</p></div>`).join('')}</section>`).join('');
  root.innerHTML = `<div class="creator-heading"><div><p class="eyebrow">Step 08 · Identity dashboard</p><h1>Companion Review</h1><p class="lede">This is the identity seed the model will follow. Review what is established before saving.</p></div><span class="step-count">08 <i>/ 08</i></span></div><section class="card review-card"><div class="review-avatar-panel">${profile(avatar)}<div><h2>${escapeHtml(s.identity.name)}</h2><p>Profile photo</p></div><label class="secondary-button avatar-upload-button" for="avatar-upload">${avatar ? 'Change photo' : 'Add profile photo'}</label><input id="avatar-upload" class="visually-hidden" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Add a profile photo"></div>
    ${sectionCards}<div class="review-section review-scene"><h2>Conversation starters</h2><p class="field-help">Suggested from ${escapeHtml(s.identity.startingRelationship.join(', ') || 'the starting relationship')}. Edit any of these before saving.</p>
      <label class="field"><span>Opening scene <em>optional</em></span><textarea data-scene="scenario" rows="2" maxlength="1000">${escapeHtml(s.scene.scenario)}</textarea></label>
      <label class="field"><span>First message</span><textarea data-scene="greeting" rows="3" maxlength="1000">${escapeHtml(s.scene.greeting)}</textarea></label>
      <label class="field"><span>Example dialogue</span><textarea data-scene="exampleDialogue" rows="4" maxlength="2000">${escapeHtml(s.scene.exampleDialogue)}</textarea></label></div>
    <div class="note-card"><span class="note-icon">✳</span><p>Every chosen cue is written into Character Card V2 fields and a CompanionF identity extension. Your appearance profile remains private and separate. The photo is used as the card image and stays on this device.</p></div>
    <div class="nav-row"><button id="review-back" class="secondary-button" type="button">Back to Appearance</button><button id="save-companion" class="primary-button" type="button">Save companion <span aria-hidden="true">✓</span></button></div><div class="export-actions"><button id="export" class="text-button" type="button">Export Character Card V2 (JSON)</button>${avatar ? '<button id="export-png" class="text-button" type="button">Export Character Card PNG with photo</button>' : ''}</div><p id="avatar-status" class="connection-status" role="status"></p></section>`;
  root.querySelector('#review-back').addEventListener('click', () => { state.view = 'create'; state.step = steps.length - 1; render(); });
  root.querySelector('#avatar-upload').addEventListener('change', async event => {
    const file = event.target.files?.[0]; if (!file) return;
    const status = root.querySelector('#avatar-status');
    if (file.size > 8 * 1024 * 1024) { status.textContent = 'Choose an image smaller than 8 MB.'; return; }
    try {
      s.presentation = { ...s.presentation, avatarDataUrl: await resizeAvatar(file) };
      state.draft.avatarDataUrl = s.presentation.avatarDataUrl; state.workspace.draft = state.draft; await persist(); renderReview();
    } catch { status.textContent = 'That image could not be opened. Choose a PNG, JPEG, or WebP image.'; }
  });
  root.querySelector('#save-companion').addEventListener('click', async () => {
    s.memory ??= { memories: [], cursorMessageId: null, pendingTaskId: null };
    state.workspace.characters.push(s);
    const firstEpisode = { id: newId('episode'), title: 'First conversation', scenario: s.scene?.scenario ?? '', summary: null, mutableState: { clothingTags: [] }, memoryCursorMessageId: null, messages: [], createdAt: new Date().toISOString(), updatedAt: null, isOpening: false };
    state.workspace.episodes[s.id] = [firstEpisode];
    state.workspace.activeEpisodeIds[s.id] = firstEpisode.id;
    state.workspace.conversations[s.id] = firstEpisode;
    state.workspace.selectedCharacterId = s.id;
    state.workspace.draft = null;
    await persist();
    state.reviewSeed = null;
    state.view = 'catalog';
    render();
  });
  root.querySelectorAll('[data-scene]').forEach(input => input.addEventListener('input', () => {
    const key = input.dataset.scene;
    s.scene[key] = input.value;
    state.draft[key] = input.value;
    state.workspace.draft = state.draft;
    persist();
  }));
  root.querySelector('#export').addEventListener('click', () => downloadJson(toCharacterCardV2(s), `${safeFilename(s.identity.name)}.json`));
  root.querySelector('#export-png')?.addEventListener('click', async () => {
    try { const png = await makeCharacterCardPng(s.presentation.avatarDataUrl, toCharacterCardV2(s)); downloadDataUrl(png, `${safeFilename(s.identity.name)}.png`); }
    catch (error) { root.querySelector('#avatar-status').textContent = `The PNG card could not be prepared: ${error.message}`; }
  });
}

function resizeAvatar(file) {
  return new Promise((resolve, reject) => {
    const image = new Image(); const url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
      const context = canvas.getContext('2d');
      const side = Math.min(image.naturalWidth, image.naturalHeight);
      context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, 512, 512);
      URL.revokeObjectURL(url); resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Invalid image')); };
    image.src = url;
  });
}

function downloadDataUrl(dataUrl, filename) {
  const link = Object.assign(document.createElement('a'), { href: dataUrl, download: filename }); link.click();
}

async function makeCharacterCardPng(avatarDataUrl, card) {
  const image = new Image(); image.src = avatarDataUrl;
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = reject; });
  const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
  canvas.getContext('2d').drawImage(image, 0, 0);
  const source = await (await fetch(canvas.toDataURL('image/png'))).arrayBuffer();
  const bytes = new Uint8Array(source); const payload = new TextEncoder().encode(`chara\0${btoa(unescape(encodeURIComponent(JSON.stringify(card))))}`);
  const type = new TextEncoder().encode('tEXt'); const data = new Uint8Array(type.length + payload.length); data.set(type); data.set(payload, type.length);
  const chunk = new Uint8Array(data.length + 12); const view = new DataView(chunk.buffer); view.setUint32(0, data.length); chunk.set(data, 4); view.setUint32(data.length + 8, crc32(data));
  let insert = 8;
  while (insert < bytes.length) { const length = new DataView(bytes.buffer, bytes.byteOffset + insert, 4).getUint32(0); const name = String.fromCharCode(...bytes.slice(insert + 4, insert + 8)); insert += length + 12; if (name === 'IHDR') break; }
  const out = new Uint8Array(bytes.length + chunk.length); out.set(bytes.slice(0, insert)); out.set(chunk, insert); out.set(bytes.slice(insert), insert + chunk.length);
  return URL.createObjectURL(new Blob([out], { type: 'image/png' }));
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function openSettings() {
  history.pushState({ companionView: 'settings' }, '', '#settings');
  state.view = 'settings';
  state.settingsMessage = '';
  renderSettings();
}

function openMemoryReview() {
  history.pushState({ companionView: 'memory', characterId: state.activeId }, '', '#memories');
  state.view = 'memory';
  renderMemoryReview();
}

function renderMemoryReview() {
  document.body.classList.remove('chat-active');
  const character = activeCharacter();
  if (!character) { state.view = 'catalog'; renderCatalog(); return; }
  const items = (character.memory?.memories ?? []).filter(item => item.status !== 'discarded');
  const tasks = state.workspace.memoryTasks.filter(task => task.characterId === character.id && ['pending', 'running', 'failed'].includes(task.status));
  root.innerHTML = `<div class="creator-heading"><div><p class="eyebrow">Memory for ${escapeHtml(character.identity.name)}</p><h1>Memory review</h1><p class="lede">New exchanges are sent to your configured memory model for review. Suggestions stay local and need your approval before they can guide future replies.</p></div></div><section class="card memory-review-card">
    ${state.saveError ? `<p class="form-error" role="alert">${escapeHtml(state.saveError)} Your changes are still on screen; keep the app open and try again.</p>` : ''}
    ${!(state.workspace.settings.memoryModel?.url || state.workspace.settings.memoryServerUrl) ? '<p class="hint-card">Connect the CPU memory model in Connection settings to start reviewing new exchanges.</p>' : ''}
    ${tasks.map(task => `<div class="hint-card" role="status">${task.status === 'running' ? 'Reviewing recent conversation…' : task.status === 'failed' ? `Could not review this conversation: ${escapeHtml(task.error)} <button class="text-button" data-memory-retry="${escapeHtml(task.id)}" type="button">Try again</button>` : 'Memory review is waiting to run.'}</div>`).join('')}
    ${items.length ? items.map(item => `<article class="memory-item ${item.status === 'confirmed' ? 'is-confirmed' : ''}"><p class="memory-type">${item.status === 'confirmed' ? 'Confirmed memory' : 'Suggested memory'} · ${escapeHtml(item.type.replaceAll('_', ' '))}</p><label class="field"><span>Memory</span><textarea data-memory-content="${escapeHtml(item.id)}" rows="3" maxlength="500" ${item.status === 'confirmed' ? 'readonly' : ''}>${escapeHtml(item.content)}</textarea></label><details><summary>Why was this suggested?</summary>${(item.evidence ?? []).map(evidence => `<blockquote>${escapeHtml(evidence.quote)}</blockquote>`).join('')}</details>${item.status === 'proposed' ? `<div class="memory-actions"><button class="secondary-button" data-memory-edit="${escapeHtml(item.id)}" type="button">Save edit</button><button class="primary-button" data-memory-confirm="${escapeHtml(item.id)}" type="button">Confirm</button><button class="text-button" data-memory-discard="${escapeHtml(item.id)}" type="button">Discard</button></div>` : ''}</article>`).join('') : '<p class="empty-note">No memory suggestions yet. After three complete exchanges, the CPU model will look for a few useful details to review.</p>'}
    <div class="nav-row"><button id="memory-back" class="secondary-button" type="button">Back to chat</button></div></section>`;
  root.querySelector('#memory-back').addEventListener('click', () => history.back());
  root.querySelectorAll('[data-memory-edit]').forEach(button => button.addEventListener('click', async () => updateMemory(button.dataset.memoryEdit, 'edit')));
  root.querySelectorAll('[data-memory-confirm]').forEach(button => button.addEventListener('click', async () => updateMemory(button.dataset.memoryConfirm, 'confirm')));
  root.querySelectorAll('[data-memory-discard]').forEach(button => button.addEventListener('click', async () => updateMemory(button.dataset.memoryDiscard, 'discard')));
  root.querySelectorAll('[data-memory-retry]').forEach(button => button.addEventListener('click', () => retryMemoryTask(button.dataset.memoryRetry)));
}

async function updateMemory(memoryId, action) {
  const character = activeCharacter();
  const item = character?.memory?.memories.find(memory => memory.id === memoryId);
  if (!item) return;
  const textarea = root.querySelector(`[data-memory-content="${CSS.escape(memoryId)}"]`);
  const content = textarea?.value.trim();
  if (!content) return;
  item.content = content;
  item.updatedAt = new Date().toISOString();
  if (action === 'confirm') item.status = 'confirmed';
  if (action === 'discard') item.status = 'discarded';
  await persist();
  renderMemoryReview();
}

function renderSettings() {
  document.body.classList.remove('chat-active');
  const settings = state.workspace.settings;
  root.innerHTML = `<div class="hero"><p class="eyebrow">Make it yours</p><h1>Model connections</h1><p class="lede">The chat model talks with your companion. The memory model receives new exchanges and reviews them for suggestions. Both run at addresses you choose.</p></div><section class="card settings-card">
    <label class="field"><span>Chat model address</span><input id="chat-model-url" type="url" autocomplete="url" placeholder="http://100.x.x.x:5001" value="${escapeHtml(settings.chatModel?.url || settings.serverUrl)}"><small>Example: http://100.x.x.x:5001</small></label>
    <div class="connection-actions"><button id="test-connection" class="secondary-button" type="button">Test chat model</button><button id="save-settings" class="primary-button" type="button">Save settings</button></div><p id="connection-status" class="connection-status" role="status">${escapeHtml(state.settingsMessage || (settings.chatModel?.url || settings.serverUrl ? 'Chat model connection has not been tested in this session.' : 'Add the chat model address.'))}</p>
    <hr class="soft-rule"><label class="field"><span>Memory model address</span><input id="memory-model-url" type="url" autocomplete="url" placeholder="http://100.x.x.x:5002" value="${escapeHtml(settings.memoryModel?.url || settings.memoryServerUrl)}"><small>For a desktop KoboldCpp server, use its Tailscale address on Android. localhost points to the phone when opened in the APK.</small></label>
    <div class="connection-actions"><button id="test-memory-connection" class="secondary-button" type="button">Test memory model</button></div><p id="memory-connection-status" class="connection-status" role="status">${escapeHtml(state.memorySettingsMessage || (settings.memoryModel?.url || settings.memoryServerUrl ? 'Memory model connection has not been tested in this session.' : 'Add the CPU model address to enable memory suggestions.'))}</p>
    <hr class="soft-rule"><label class="field"><span>Your name in chat</span><input id="user-name" maxlength="60" value="${escapeHtml(settings.userName)}" placeholder="You"></label>
    <div class="settings-pair"><label class="field"><span>Reply length</span><input id="max-length" type="number" min="32" max="1024" step="16" value="${Number(settings.maxLength) || 180}"><small>Maximum tokens per reply</small></label><label class="field"><span>Creativity</span><input id="temperature" type="number" min="0" max="2" step="0.05" value="${Number(settings.temperature)}"><small>Temperature</small></label><label class="field"><span>Context length</span><input id="context-length" type="number" min="512" max="262144" step="512" value="${Number(settings.contextLength) || 4096}"><small>Auto-detected when available</small></label></div>
    <p class="hint-card">The installed app connects directly to the address you choose, including local HTTP and Tailscale addresses. In a browser preview, browser security or CORS may still restrict HTTP. No prompt is sent by the connection test.</p>
      <hr class="soft-rule"><section class="backup-panel" aria-labelledby="backup-heading"><h2 id="backup-heading">Private app backup</h2><p>This encrypted file includes your settings, appearance profile, companions, episodes, chats, memories and theme. Save it somewhere safe before reinstalling the app or moving to another device. Keep the password separate; it cannot be recovered.</p>
      <label class="field"><span>Backup password</span><input id="backup-password" type="password" autocomplete="new-password" minlength="12" placeholder="At least 12 characters"><small>Use a password you do not use for another account.</small></label>
      <label class="field"><span>Confirm backup password</span><input id="backup-password-confirm" type="password" autocomplete="new-password" minlength="12"></label>
      <div class="connection-actions"><button id="create-backup" class="secondary-button" type="button">Create encrypted backup</button></div>
      <label class="field"><span>Restore from backup</span><input id="backup-file" type="file" accept=".companion-backup,application/json"><small>Choose a Companion backup file, then enter its password to inspect what it contains.</small></label>
      <label class="field"><span>Backup password</span><input id="restore-password" type="password" autocomplete="current-password"></label>
      <div class="connection-actions"><button id="inspect-backup" class="secondary-button" type="button">Inspect backup</button></div>
      ${state.pendingBackup ? `<div class="backup-preview" role="region" aria-label="Backup contents"><h3>Backup contents</h3><p>${state.pendingBackup.summary.characters} companion${state.pendingBackup.summary.characters === 1 ? '' : 's'} · ${state.pendingBackup.summary.conversations} conversation${state.pendingBackup.summary.conversations === 1 ? '' : 's'} · ${state.pendingBackup.summary.messages} messages</p><ul>${state.pendingBackup.summary.characterNames.map(name => `<li>${escapeHtml(name)}</li>`).join('')}</ul><fieldset class="field"><legend>How should this backup be restored?</legend><label class="backup-choice"><input type="radio" name="restore-mode" value="merge" checked> Add its data to what is on this device. Existing settings and matching data stay in place.</label><label class="backup-choice"><input type="radio" name="restore-mode" value="replace"> Replace app data on this device with this backup.</label></fieldset><div class="connection-actions"><button id="restore-backup" class="primary-button" type="button">Restore backup</button><button id="cancel-backup" class="text-button" type="button">Cancel</button></div></div>` : ''}
      <p class="connection-status" role="status">${escapeHtml(state.backupMessage)}</p></section>
    <div class="nav-row"><button id="settings-back" class="secondary-button" type="button">Back to companions</button></div>
  </section>`;
  root.querySelector('#settings-back').addEventListener('click', async () => { readSettingsForm(); await persist(); history.back(); });
  root.querySelector('#save-settings').addEventListener('click', async () => {
    readSettingsForm(); await persist();
    const status = root.querySelector('#connection-status');
    if (status) status.textContent = state.saveError ? 'Settings could not be saved. Try again.' : 'Settings saved on this device.';
    if (!state.saveError) void resumeMemoryTasks();
  });
  root.querySelector('#test-connection').addEventListener('click', runConnectionTest);
  root.querySelector('#test-memory-connection').addEventListener('click', runMemoryConnectionTest);
  root.querySelector('#create-backup').addEventListener('click', createBackupFile);
  root.querySelector('#inspect-backup').addEventListener('click', inspectBackupFile);
  root.querySelector('#restore-backup')?.addEventListener('click', restoreBackupFile);
  root.querySelector('#cancel-backup')?.addEventListener('click', () => { state.pendingBackup = null; state.backupMessage = 'Restore cancelled.'; renderSettings(); });
}

async function createBackupFile() {
  const password = root.querySelector('#backup-password').value;
  const confirmation = root.querySelector('#backup-password-confirm').value;
  if (!validateBackupPassphrase(password)) { state.backupMessage = 'Use a backup password with at least 12 characters.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  if (password !== confirmation) { state.backupMessage = 'The passwords do not match. Check both fields and try again.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  try {
    readSettingsForm();
    if (!(await persist())) throw new Error('Settings could not be saved. Try again before creating a backup.');
    const content = await createPrivateBackup(state.workspace, localStorage.getItem('companion-theme') || 'light', password);
    downloadJsonFile(content, `companion-backup-${new Date().toISOString().slice(0, 10)}.companion-backup`, 'application/json');
    state.backupMessage = 'Encrypted backup created. Keep its password somewhere safe.';
  } catch (error) { state.backupMessage = error.message || 'Could not create the backup. Try again.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  renderSettings();
}

async function inspectBackupFile() {
  const file = root.querySelector('#backup-file').files?.[0];
  const password = root.querySelector('#restore-password').value;
  if (!file) { state.backupMessage = 'Choose a backup file first.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  if (!password) { state.backupMessage = 'Enter the password for this backup.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  if (file.size > 50 * 1024 * 1024) { state.backupMessage = 'This backup is larger than the supported 50 MB file size.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  try {
    const contents = await readPrivateBackup(await file.text(), password);
    state.pendingBackup = { ...contents, summary: backupSummary(contents.workspace) };
    state.backupMessage = 'Review the contents and choose how to restore them.';
  } catch (error) { state.pendingBackup = null; state.backupMessage = error.message || 'Could not inspect this backup.'; root.querySelector('.backup-panel [role="status"]').textContent = state.backupMessage; return; }
  renderSettings();
}

async function restoreBackupFile() {
  if (!state.pendingBackup) return;
  const mode = root.querySelector('input[name="restore-mode"]:checked')?.value;
  if (mode === 'replace' && !window.confirm('Replace the app data on this device with this backup? The current data will be replaced.')) return;
  const restored = mode === 'replace' ? state.pendingBackup.workspace : mergeWorkspaces(state.workspace, state.pendingBackup.workspace);
  try {
    await saveWorkspace(restored);
    state.workspace = restored;
    localStorage.setItem('companion-theme', state.pendingBackup.theme);
    document.documentElement.dataset.theme = state.pendingBackup.theme;
    state.pendingBackup = null;
    state.backupMessage = mode === 'replace' ? 'Backup restored on this device.' : 'Backup data added. Existing settings and matching data were kept.';
    renderSettings();
  } catch (error) { state.backupMessage = error.message || 'Restore failed. Your current data is still available; try again.'; renderSettings(); }
}

function readSettingsForm() {
  const settings = state.workspace.settings;
  settings.serverUrl = root.querySelector('#chat-model-url').value.trim();
  settings.chatModel = { url: settings.serverUrl };
  settings.memoryServerUrl = root.querySelector('#memory-model-url').value.trim();
  settings.memoryModel = { url: settings.memoryServerUrl };
  settings.userName = root.querySelector('#user-name').value.trim() || 'You';
  settings.maxLength = Math.min(1024, Math.max(32, Number(root.querySelector('#max-length').value) || 180));
  const temp = Number(root.querySelector('#temperature').value);
  settings.temperature = Number.isFinite(temp) ? Math.min(2, Math.max(0, temp)) : 0.8;
  settings.contextLength = Math.min(262144, Math.max(512, Number(root.querySelector('#context-length').value) || 4096));
}

async function runConnectionTest() {
  const button = root.querySelector('#test-connection');
  const status = root.querySelector('#connection-status');
  readSettingsForm();
  button.disabled = true; button.textContent = 'Testing…'; status.textContent = 'Checking KoboldCpp…';
  try {
    const result = await testConnection(state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl);
    state.workspace.settings.serverUrl = result.url;
    state.workspace.settings.chatModel = { url: result.url };
    state.workspace.settings.contextLength = result.contextLength;
    state.settingsMessage = `Connected to ${result.model}.`;
    await persist();
    status.textContent = state.settingsMessage;
    const contextField = root.querySelector('#context-length');
    if (contextField) contextField.value = String(result.contextLength);
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; button.textContent = 'Test connection'; }
}

async function runMemoryConnectionTest() {
  const button = root.querySelector('#test-memory-connection');
  const status = root.querySelector('#memory-connection-status');
  readSettingsForm();
  button.disabled = true; button.textContent = 'Testing…'; status.textContent = 'Checking memory model…';
  try {
    const result = await testConnection(state.workspace.settings.memoryModel?.url || state.workspace.settings.memoryServerUrl);
    state.workspace.settings.memoryServerUrl = result.url;
    state.workspace.settings.memoryModel = { url: result.url };
    root.querySelector('#memory-model-url').value = result.url;
    state.memorySettingsMessage = `Memory model ready: ${result.model}.`;
    await persist();
    status.textContent = state.memorySettingsMessage;
    void resumeMemoryTasks();
  } catch (error) {
    status.textContent = error.message;
  } finally { button.disabled = false; button.textContent = 'Test memory model'; }
}

function openEpisodes(characterId) {
  const character = state.workspace.characters.find(item => item.id === characterId);
  if (!character) return;
  state.activeId = characterId;
  state.view = 'episodes';
  history.pushState({ companionView: 'episodes', characterId }, '', '#episodes');
  renderEpisodes();
}

function renderEpisodes() {
  document.body.classList.remove('chat-active');
  const character = activeCharacter();
  if (!character) { state.view = 'catalog'; renderCatalog(); return; }
  const episodes = episodesFor(state.workspace, character.id);
  const activeId = state.workspace.activeEpisodeIds?.[character.id];
  root.innerHTML = `<div class="hero"><p class="eyebrow">Your stories</p><h1>${escapeHtml(character.identity.name)}’s episodes</h1><p class="lede">Each episode has its own scene and continuity. Starting one keeps this companion’s identity and confirmed memories, without carrying over another scene’s details.</p></div>
    ${episodes.length ? `<section class="episode-list">${episodes.map(episode => `<article class="episode-card ${episode.id === activeId ? 'is-current' : ''}"><div><p class="episode-kicker">${episode.id === activeId ? 'Current episode' : 'Episode'} · ${episode.messages.length} messages</p><h2>${escapeHtml(episode.title)}</h2><p>${escapeHtml(episode.scenario)}</p>${episode.summary?.content ? `<small>Continuity saved through ${escapeHtml(formatMessageTime(episode.summary.updatedAt))}</small>` : ''}</div><button class="primary-button" data-open-episode="${escapeHtml(episode.id)}" type="button">${episode.id === activeId ? 'Continue' : 'Open episode'} <span aria-hidden="true">→</span></button></article>`).join('')}</section>` : '<p class="hint-card">Your first episode will appear here.</p>'}
    <section class="card new-episode-card"><h2>Start a new episode</h2><p>Give this story a setting or starting moment. The scene is kept separate from your other episodes.</p><form id="new-episode-form"><label class="field"><span>Starting scene</span><textarea id="new-episode-scenario" rows="4" maxlength="1500" required placeholder="For example: You and Maya meet at a small bookshop on a rainy afternoon."></textarea></label><button class="primary-button" type="submit">Create episode <span aria-hidden="true">→</span></button></form><p class="connection-status" role="status">${escapeHtml(state.episodeError || '')}</p></section>
    <div class="nav-row"><button id="episodes-back" class="secondary-button" type="button">Back</button></div>`;
  root.querySelectorAll('[data-open-episode]').forEach(button => button.addEventListener('click', () => openChat(character.id, button.dataset.openEpisode)));
  root.querySelector('#new-episode-form').addEventListener('submit', async event => {
    event.preventDefault();
    const previousEpisodeId = state.workspace.activeEpisodeIds?.[character.id];
    let createdEpisode;
    try {
      createdEpisode = createEpisode(state.workspace, character, root.querySelector('#new-episode-scenario').value);
      state.episodeError = '';
      if (!(await persist())) {
        state.workspace.episodes[character.id] = state.workspace.episodes[character.id].filter(item => item.id !== createdEpisode.id);
        if (previousEpisodeId) setActiveEpisode(state.workspace, character.id, previousEpisodeId);
        throw new Error('The episode could not be saved. Your existing stories are still here; please try again.');
      }
      const episode = conversationFor(state.workspace, character.id);
      await openChat(character.id, episode.id);
    } catch (error) { state.episodeError = error.message; renderEpisodes(); }
  });
  root.querySelector('#episodes-back').addEventListener('click', () => history.back());
}

async function openChat(characterId, episodeId = null) {
  const character = state.workspace.characters.find(item => item.id === characterId);
  if (!character) return;
  const selectedEpisode = episodeId ? setActiveEpisode(state.workspace, characterId, episodeId) : conversationFor(state.workspace, characterId);
  if (!selectedEpisode) return;
  state.activeId = characterId;
  state.workspace.selectedCharacterId = characterId;
  state.chatError = '';
  state.view = 'chat';
  history.pushState({ companionView: 'chat', characterId, episodeId: selectedEpisode.id }, '', '#chat');
  const conversation = conversationFor(state.workspace, characterId);
  state.workspace.conversations[characterId] = conversation;
  if (!conversation.isOpening && !conversation.messages.length && character.scene?.greeting) {
    const name = character.identity.name;
    const user = state.workspace.settings.userName || 'You';
    const greeting = character.scene.greeting.replace(/\{\{char\}\}/gi, name).replace(/\{\{user\}\}/gi, user);
    conversation.messages.push({ id: newId('message'), role: 'assistant', text: greeting, createdAt: new Date().toISOString() });
  }
  const saved = await persist();
  renderChat();
  if (!saved) return;
  if (conversation.isOpening && (state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl)) await generateEpisodeOpening(character, conversation);
}

async function generateEpisodeOpening(character, episode) {
  if (state.generating || !episode.isOpening) return;
  state.generating = true; state.chatError = '';
  renderChat();
  try {
    const reply = await generateReply(character, [], state.workspace.settings, episode);
    episode.messages.push({ id: newId('message'), role: 'assistant', text: reply, alternatives: [reply], variantIndex: 0, createdAt: new Date().toISOString() });
    episode.isOpening = false;
    episode.updatedAt = new Date().toISOString();
    if (!(await persist())) { episode.messages.pop(); episode.isOpening = true; throw new Error('The opening scene could not be saved. Your episode is still here; try again.'); }
  } catch (error) { state.chatError = error.message; }
  finally { state.generating = false; if (state.view === 'chat') renderChat(); }
}

async function summarizeActiveEpisode(character, episode) {
  if (state.summarizing || state.generating || !(state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl)) return;
  state.summarizing = true; state.continuityError = '';
  renderChat();
  try {
    const summary = await generateContinuitySummary(character, episode, state.workspace.settings);
    const previousSummary = episode.summary;
    const previousUpdatedAt = episode.updatedAt;
    episode.summary = { ...summary, updatedAt: new Date().toISOString() };
    episode.updatedAt = new Date().toISOString();
    if (!(await persist())) { episode.summary = previousSummary; episode.updatedAt = previousUpdatedAt; throw new Error('The summary could not be saved. Your original messages are still available; try again.'); }
  } catch (error) { state.continuityError = error.message || 'Could not save a continuity summary. Your messages are still here; try again.'; }
  finally { state.summarizing = false; if (state.view === 'chat') renderChat(); void resumeMemoryTasks(); }
}

async function addEpisodeTag(event, episode) {
  event.preventDefault();
  const input = root.querySelector('#episode-tag-input');
  const value = input.value.trim().slice(0, 60);
  if (!value || episode.mutableState.clothingTags.some(tag => tag.toLocaleLowerCase() === value.toLocaleLowerCase())) return;
  if (episode.mutableState.clothingTags.length >= 30) { state.continuityError = 'This episode already has 30 details. Remove one before adding another.'; renderChat(); return; }
  state.continuityError = '';
  episode.mutableState.clothingTags.push(value);
  episode.updatedAt = new Date().toISOString();
  await persist(); renderChat();
}

async function removeEpisodeTag(episode, index) {
  if (index < 0 || index >= episode.mutableState.clothingTags.length) return;
  episode.mutableState.clothingTags.splice(index, 1);
  episode.updatedAt = new Date().toISOString();
  await persist(); renderChat();
}

function invalidateSummaryIfEdited(episode, changedIndex) {
  const throughIndex = episode.summary?.throughMessageId ? episode.messages.findIndex(message => message.id === episode.summary.throughMessageId) : -1;
  if (episode.summary && (throughIndex < 0 || changedIndex <= throughIndex)) episode.summary = null;
}

async function retrySave() {
  if (await persist()) { state.chatError = ''; renderChat(); }
}

function activeCharacter() {
  return state.workspace.characters.find(item => item.id === state.activeId);
}

function renderChat() {
  document.body.classList.add('chat-active');
  const character = activeCharacter();
  if (!character) { state.view = 'catalog'; renderCatalog(); return; }
  const conversation = conversationFor(state.workspace, character.id);
  const messages = conversation.messages;
  const lastIsUser = messages.at(-1)?.role === 'user';
  const configured = Boolean(state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl);
  const initials = String(character.identity.name || 'C').trim().split(/\s+/).slice(0, 2).map(part => part[0]).join('').toUpperCase();
  const avatar = character.presentation?.avatarDataUrl ? `<img class="avatar-image" src="${escapeHtml(character.presentation.avatarDataUrl)}" alt="">` : escapeHtml(initials);
  const proposedCount = (character.memory?.memories ?? []).filter(item => item.status === 'proposed').length;
  const summaryIndex = conversation.summary?.throughMessageId ? messages.findIndex(message => message.id === conversation.summary.throughMessageId) : -1;
  const unsummarizedCount = summaryIndex >= 0 ? messages.length - summaryIndex - 1 : messages.length;
  root.innerHTML = `<section class="chat-shell" aria-label="Chat with ${escapeHtml(character.identity.name)}"><div class="chat-topbar"><button id="chat-back" class="chat-back-button" type="button" aria-label="Back to companions"><span aria-hidden="true">‹</span></button><div class="chat-person"><div class="chat-avatar" aria-hidden="true">${avatar}</div><div class="chat-person-copy"><h1>${escapeHtml(character.identity.name)}</h1><p><span class="presence-dot ${configured ? 'is-ready' : ''}"></span>${configured ? 'Your conversation' : 'Connection needed'}</p></div></div><button id="chat-settings" class="chat-more-button" type="button" aria-label="Chat settings"><span aria-hidden="true">•••</span></button></div><div id="chat-settings-menu" class="chat-settings-menu" hidden><button id="chat-episodes" type="button">Episodes</button><button id="chat-theme" type="button">${document.documentElement.dataset.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}</button><button id="chat-memory" type="button">Memory review${proposedCount ? ` · ${proposedCount}` : ''}</button><button id="chat-connection" type="button">Connection settings</button></div>
    ${!configured ? `<div class="connection-banner"><div><strong>One small step before you chat</strong><p>Connect your KoboldCpp server to hear back from ${escapeHtml(character.identity.name)}.</p></div><button id="connect-from-chat" class="secondary-button" type="button">Connect</button></div>` : ''}
    <div class="episode-toolbar"><span>${escapeHtml(conversation.title || 'First conversation')}</span>${messages.length >= 24 && unsummarizedCount > 0 ? `<button id="summarize-episode" class="text-button" type="button" ${!configured || state.summarizing || state.generating ? 'disabled' : ''}>${state.summarizing ? 'Saving continuity…' : conversation.summary ? `Update continuity · ${unsummarizedCount} new` : 'Save continuity summary'}</button>` : ''}</div>
    ${state.continuityError ? `<p class="continuity-error" role="alert">${escapeHtml(state.continuityError)}</p>` : ''}
    ${conversation.summary?.content ? `<details class="continuity-summary"><summary>Continuity saved · ${escapeHtml(formatMessageTime(conversation.summary.updatedAt))}</summary><p>${escapeHtml(conversation.summary.content)}</p><small>Original messages are still saved in this episode.</small></details>` : ''}
    <details class="episode-state"><summary>Episode details${conversation.mutableState?.clothingTags?.length ? ` · ${conversation.mutableState.clothingTags.length}` : ''}</summary><p>Details here belong to this episode and never change the companion’s permanent identity.</p><div class="episode-tags">${(conversation.mutableState?.clothingTags ?? []).map((tag, index) => `<button type="button" data-remove-episode-tag="${index}" aria-label="Remove ${escapeHtml(tag)}">${escapeHtml(tag)} <span aria-hidden="true">×</span></button>`).join('')}</div><form id="episode-tag-form"><input id="episode-tag-input" maxlength="60" placeholder="Add an outfit or scene detail" aria-label="Add an episode detail"><button class="text-button" type="submit">Add</button></form></details>
    <section class="message-list" id="message-list" aria-label="Conversation">${messages.length ? messages.map((message, index) => {
      const variants = Array.isArray(message.alternatives) && message.alternatives.length ? message.alternatives : [message.text];
      const selected = Math.max(0, Math.min(Number(message.variantIndex) || 0, variants.length - 1));
      const editing = state.editingMessage === index;
      const controls = message.role === 'assistant'
        ? `<button type="button" data-message-action="edit" data-index="${index}" ${state.generating ? 'disabled' : ''}>Edit</button>${index === messages.length - 1 ? `<button type="button" data-message-action="regenerate" data-index="${index}" ${state.generating || !configured ? 'disabled' : ''}>Regenerate</button>` : ''}${variants.length > 1 ? `<span class="variant-control"><button type="button" data-message-action="previous" data-index="${index}" aria-label="Previous reply" ${selected === 0 || state.generating ? 'disabled' : ''}>‹</button><span>${selected + 1} / ${variants.length}</span><button type="button" data-message-action="next" data-index="${index}" aria-label="Next reply" ${selected === variants.length - 1 || state.generating ? 'disabled' : ''}>›</button></span>` : ''}<button type="button" data-message-action="delete" data-index="${index}" ${state.generating ? 'disabled' : ''}>Delete</button>`
        : `<button type="button" data-message-action="edit" data-index="${index}" ${state.generating ? 'disabled' : ''}>Edit</button><button type="button" data-message-action="delete" data-index="${index}" ${state.generating ? 'disabled' : ''}>Delete</button>`;
      return `<article class="message ${message.role === 'user' ? 'user-message' : 'assistant-message'}" aria-label="${message.role === 'user' ? escapeHtml(state.workspace.settings.userName || 'You') : escapeHtml(character.identity.name)}">${editing ? `<form class="message-edit-form" data-edit-form="${index}"><textarea maxlength="4000" required>${escapeHtml(message.text)}</textarea><div><button type="submit">Save</button><button type="button" data-message-action="cancel-edit" data-index="${index}">Cancel</button></div></form>` : `<p>${formatMessageText(message.text)}</p><time>${formatMessageTime(message.createdAt)}</time><div class="message-actions">${controls}</div>`}</article>`;
    }).join('') : `<div class="chat-empty"><div class="chat-welcome-mark" aria-hidden="true">${escapeHtml(initials)}</div><p class="chat-welcome-kicker">A little space for the two of you</p><h2>Where would you like to begin?</h2><p class="chat-welcome-copy">Start with a thought, a question, or a small hello.</p>${configured ? '<div class="starter-prompts"><button type="button" data-starter="How has your day been?">How has your day been?</button><button type="button" data-starter="Tell me a little about yourself.">Tell me about yourself</button><button type="button" data-starter="Let’s make up a story together.">Start a little story</button></div>' : ''}</div>`}${state.generating ? `<article class="message assistant-message typing-message" aria-label="${escapeHtml(character.identity.name)} is replying"><p><span class="typing-dots">Thinking…</span></p></article>` : ''}</section>
    ${state.saveError ? `<div class="chat-error" role="alert"><p>A change may not have been saved: ${escapeHtml(state.saveError)}</p><button id="retry-save" class="text-button" type="button">Try saving again</button></div>` : ''}
    ${state.chatError ? `<div class="chat-error" role="alert"><p>${escapeHtml(state.chatError)}</p>${lastIsUser ? '<button id="retry-reply" class="text-button" type="button">Try again</button>' : conversation.isOpening ? '<button id="retry-opening" class="text-button" type="button">Try opening the scene again</button>' : ''}</div>` : lastIsUser && !state.generating ? '<div class="chat-error"><p>This message is waiting for a reply.</p><button id="retry-reply" class="text-button" type="button">Generate reply</button></div>' : ''}
    <form id="chat-form" class="chat-composer"><textarea id="chat-input" rows="1" maxlength="4000" placeholder="Write a message…" aria-label="Write a message" ${(!configured || state.generating) ? 'disabled' : ''}></textarea><button class="send-button" type="submit" aria-label="Send message" ${(!configured || state.generating) ? 'disabled' : ''}><span aria-hidden="true">↑</span></button></form><p class="chat-local-note">Saved on this device · Episode details stay with this story</p></section>`;
  root.querySelector('#chat-back').addEventListener('click', () => history.back());
  root.querySelector('#chat-settings').addEventListener('click', () => { const menu = root.querySelector('#chat-settings-menu'); menu.hidden = !menu.hidden; });
  root.querySelector('#chat-theme').addEventListener('click', () => {
    const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('companion-theme', theme);
    renderChat();
    root.querySelector('#chat-settings-menu').hidden = false;
  });
  root.querySelector('#chat-connection').addEventListener('click', openSettings);
  root.querySelector('#chat-memory').addEventListener('click', openMemoryReview);
  root.querySelector('#chat-episodes').addEventListener('click', () => openEpisodes(character.id));
  root.querySelector('#summarize-episode')?.addEventListener('click', () => summarizeActiveEpisode(character, conversation));
  root.querySelectorAll('[data-remove-episode-tag]').forEach(button => button.addEventListener('click', () => removeEpisodeTag(conversation, Number(button.dataset.removeEpisodeTag))));
  root.querySelector('#episode-tag-form').addEventListener('submit', event => addEpisodeTag(event, conversation));
  root.querySelector('#connect-from-chat')?.addEventListener('click', openSettings);
  root.querySelector('#retry-reply')?.addEventListener('click', generateLastReply);
  root.querySelector('#retry-opening')?.addEventListener('click', () => generateEpisodeOpening(character, conversation));
  root.querySelector('#retry-save')?.addEventListener('click', retrySave);
  root.querySelector('#chat-form').addEventListener('submit', sendMessage);
  root.querySelectorAll('[data-message-action]').forEach(button => button.addEventListener('click', () => handleMessageAction(button.dataset.messageAction, Number(button.dataset.index))));
  root.querySelectorAll('[data-edit-form]').forEach(form => form.addEventListener('submit', event => saveMessageEdit(event, Number(form.dataset.editForm))));
  root.querySelectorAll('[data-starter]').forEach(button => button.addEventListener('click', () => {
    const input = root.querySelector('#chat-input');
    input.value = button.dataset.starter;
    input.focus();
  }));
  const list = root.querySelector('#message-list');
  list.scrollTop = list.scrollHeight;
}

function formatMessageTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function formatMessageText(value) {
  const parts = String(value ?? '').split(/(\*[^*\n]+\*)/g);
  return parts.map(part => part.startsWith('*') && part.endsWith('*') && part.length > 2
    ? `<span class="stage-direction">${escapeHtml(part.slice(1, -1))}</span>`
    : escapeHtml(part)).join('');
}

async function handleMessageAction(action, index) {
  if (state.generating) return;
  const character = activeCharacter();
  if (!character) return;
  const conversation = conversationFor(state.workspace, character.id);
  const message = conversation.messages[index];
  if (!message) return;
  if (action === 'edit') { state.editingMessage = index; renderChat(); root.querySelector(`[data-edit-form="${index}"] textarea`)?.focus(); return; }
  if (action === 'cancel-edit') { state.editingMessage = null; renderChat(); return; }
  if (action === 'delete') {
    if (message.role === 'user') {
      let end = index + 1;
      while (end < conversation.messages.length && conversation.messages[end].role !== 'user') end++;
      conversation.messages.splice(index, end - index);
    } else conversation.messages.splice(index, 1);
    invalidateSummaryIfEdited(conversation, index);
    state.editingMessage = null;
    state.chatError = '';
  } else if (action === 'previous' || action === 'next') {
    const alternatives = Array.isArray(message.alternatives) && message.alternatives.length ? message.alternatives : [message.text];
    const current = Number(message.variantIndex) || 0;
    const next = current + (action === 'next' ? 1 : -1);
    if (next < 0 || next >= alternatives.length) return;
    message.alternatives = alternatives;
    message.variantIndex = next;
    message.text = alternatives[next];
    invalidateSummaryIfEdited(conversation, index);
  } else if (action === 'regenerate') {
    if (message.role !== 'assistant' || index !== conversation.messages.length - 1 || !(state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl)) return;
    await regenerateMessage(character, conversation, index);
    return;
  }
  conversation.updatedAt = new Date().toISOString();
  state.workspace.conversations[character.id] = conversation;
  await persist();
  renderChat();
}

async function saveMessageEdit(event, index) {
  event.preventDefault();
  const character = activeCharacter();
  if (!character || state.generating) return;
  const conversation = conversationFor(state.workspace, character.id);
  const message = conversation.messages[index];
  const edited = root.querySelector(`[data-edit-form="${index}"] textarea`)?.value.trim();
  if (!message || !edited) return;
  message.text = edited;
  invalidateSummaryIfEdited(conversation, index);
  if (message.role === 'assistant') { message.alternatives = [edited]; message.variantIndex = 0; }
  else {
    let end = index + 1;
    while (end < conversation.messages.length && conversation.messages[end].role !== 'user') end++;
    conversation.messages.splice(index + 1, end - index - 1);
  }
  conversation.updatedAt = new Date().toISOString();
  state.workspace.conversations[character.id] = conversation;
  state.editingMessage = null;
  state.chatError = '';
  await persist();
  renderChat();
}

async function regenerateMessage(character, conversation, index) {
  const target = conversation.messages[index];
  state.generating = true;
  state.chatError = '';
  renderChat();
  try {
    const replacement = await generateReply(character, conversation.messages.slice(0, index), state.workspace.settings, conversation);
    const alternatives = Array.isArray(target.alternatives) && target.alternatives.length ? [...target.alternatives] : [target.text];
    alternatives.push(replacement);
    target.alternatives = alternatives;
    target.variantIndex = alternatives.length - 1;
    target.text = replacement;
    invalidateSummaryIfEdited(conversation, index);
    conversation.updatedAt = new Date().toISOString();
    state.workspace.conversations[character.id] = conversation;
    await persist();
  } catch (error) {
    state.chatError = error.message;
  } finally {
    state.generating = false;
    if (state.view === 'chat') renderChat();
  }
}

async function sendMessage(event) {
  event.preventDefault();
  if (state.generating) return;
  const input = root.querySelector('#chat-input');
  const text = input.value.trim();
  if (!text) return;
  const character = activeCharacter();
  const conversation = conversationFor(state.workspace, character.id);
  conversation.messages.push({ id: newId('message'), role: 'user', text, createdAt: new Date().toISOString() });
  conversation.updatedAt = new Date().toISOString();
  state.workspace.conversations[character.id] = conversation;
  state.chatError = '';
  if (!(await persist())) { state.chatError = 'This message could not be saved on this device, so no reply was generated. Keep the app open and try again.'; renderChat(); return; }
  renderChat();
  await generateLastReply();
}

async function generateLastReply() {
  const character = activeCharacter();
  if (!character || state.generating) return;
  const conversation = conversationFor(state.workspace, character.id);
  if (conversation.messages.at(-1)?.role !== 'user') return;
  state.generating = true; state.chatError = '';
  renderChat();
  try {
    const reply = await generateReply(character, conversation.messages, state.workspace.settings, conversation);
    conversation.messages.push({ id: newId('message'), role: 'assistant', text: reply, alternatives: [reply], variantIndex: 0, createdAt: new Date().toISOString() });
    conversation.isOpening = false;
    conversation.updatedAt = new Date().toISOString();
    state.workspace.conversations[character.id] = conversation;
    await persist();
  } catch (error) {
    state.chatError = error.message;
  } finally {
    state.generating = false;
    if (state.view === 'chat') renderChat();
    if (!state.chatError) void queueMemoryReview(character, conversation);
  }
}

async function queueMemoryReview(character, conversation, processBacklog = false) {
  if (!(state.workspace.settings.memoryModel?.url || state.workspace.settings.memoryServerUrl) || character.memory?.pendingTaskId) return;
  const memoryCharacter = { ...character, memory: { ...character.memory, cursorMessageId: conversation.memoryCursorMessageId ?? null } };
  const task = nextMemoryBatch(memoryCharacter, conversation.messages, processBacklog ? 1 : undefined);
  if (!task) return;
  task.episodeId = conversation.id;
  character.memory ??= { memories: [], cursorMessageId: null, pendingTaskId: null };
  character.memory.pendingTaskId = task.id;
  state.workspace.memoryTasks.push(task);
  if (!await persist()) return;
  void processMemoryTask(task.id);
}

async function resumeMemoryTasks() {
  if (state.memoryProcessing || state.summarizing || !(state.workspace.settings.memoryModel?.url || state.workspace.settings.memoryServerUrl)) return;
  const task = state.workspace.memoryTasks.find(item => item.status === 'pending');
  if (task) await processMemoryTask(task.id);
  else {
    for (const character of state.workspace.characters) {
      const conversation = conversationFor(state.workspace, character.id);
      if (!character.memory?.pendingTaskId) await queueMemoryReview(character, conversation);
      if (state.memoryProcessing) return;
    }
  }
}

async function processMemoryTask(taskId) {
  if (state.memoryProcessing) return;
  const task = state.workspace.memoryTasks.find(item => item.id === taskId);
  if (!task || !['pending', 'failed'].includes(task.status)) return;
  if (state.generating || state.summarizing) { setTimeout(() => processMemoryTask(taskId), 1200); return; }
  const character = state.workspace.characters.find(item => item.id === task.characterId);
  const memoryModelUrl = state.workspace.settings.memoryModel?.url || state.workspace.settings.memoryServerUrl;
  if (!character || !memoryModelUrl) return;
  state.memoryProcessing = true;
  task.status = 'running'; task.attempts = (task.attempts || 0) + 1; task.updatedAt = new Date().toISOString(); task.error = '';
  if (!await persist()) { state.memoryProcessing = false; task.status = 'pending'; return; }
  if (state.generating || state.summarizing) {
    state.memoryProcessing = false; task.status = 'pending'; await persist();
    setTimeout(() => processMemoryTask(taskId), 1200);
    return;
  }
  const sourceEpisode = findEpisodeById(state.workspace, task.episodeId) ?? conversationFor(state.workspace, character.id);
  try {
    const response = await generateMemorySuggestions(memoryModelUrl, buildMemoryPrompt(character, task));
    const liveMessages = new Map(sourceEpisode.messages.map(message => [message.id, message.text]));
    const sourceChanged = task.sourceMessages.some(message => liveMessages.get(message.id) !== message.text);
    if (sourceChanged) {
      task.status = 'cancelled'; task.error = 'The source conversation changed during review. The updated messages will be reviewed instead.';
      character.memory.pendingTaskId = null;
      task.updatedAt = new Date().toISOString();
      return;
    }
    const proposals = parseMemoryProposals(response, task, character.memory?.memories ?? []);
    character.memory ??= { memories: [], cursorMessageId: null, pendingTaskId: null };
    character.memory.memories.push(...proposals);
    character.memory.cursorMessageId = task.sourceMessageIds.at(-1) ?? character.memory.cursorMessageId;
    sourceEpisode.memoryCursorMessageId = task.sourceMessageIds.at(-1) ?? sourceEpisode.memoryCursorMessageId;
    character.memory.pendingTaskId = null;
    task.status = 'complete'; task.updatedAt = new Date().toISOString();
    task.error = proposals.length ? '' : 'No verifiable memory suggestions were found.';
  } catch (error) {
    task.status = 'failed'; task.error = error.message || 'The memory review failed. Try again.'; task.updatedAt = new Date().toISOString();
    character.memory ??= { memories: [], cursorMessageId: null, pendingTaskId: task.id };
    character.memory.pendingTaskId = task.id;
  } finally {
    state.memoryProcessing = false;
    const saved = await persist();
    if (state.activeId === character.id && ['chat', 'memory'].includes(state.view)) {
      if (state.view === 'memory') renderMemoryReview(); else renderChat();
    }
    if (saved && (task.status === 'complete' || task.status === 'cancelled')) void queueMemoryReview(character, sourceEpisode, true);
  }
}

function retryMemoryTask(taskId) {
  const task = state.workspace.memoryTasks.find(item => item.id === taskId);
  if (!task || task.status !== 'failed') return;
  task.status = 'pending'; task.error = '';
  void persist().then(saved => { if (saved) processMemoryTask(taskId); });
}

function downloadJson(value, filename) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click(); URL.revokeObjectURL(url);
}

function downloadJsonFile(value, filename, type) {
  const url = URL.createObjectURL(new Blob([value], { type }));
  const link = Object.assign(document.createElement('a'), { href: url, download: filename });
  link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function safeFilename(name) {
  return String(name).replace(/[^a-z0-9-_]+/gi, '-').replace(/^-|-$/g, '') || 'character';
}

async function start() {
  const theme = localStorage.getItem('companion-theme');
  if (theme) document.documentElement.dataset.theme = theme;
  history.replaceState({ companionView: 'catalog' }, '', `${location.pathname}${location.search}`);
  try {
    state.workspace = normalizeWorkspace(await loadWorkspace());
    state.saved = true;
    if (state.workspace.draft) {
      state.draft = { ...EMPTY_DRAFT, ...state.workspace.draft };
      for (const [key, value] of Object.entries(EMPTY_DRAFT)) if (Array.isArray(value) && !Array.isArray(state.draft[key])) state.draft[key] = [];
      state.step = Math.max(0, Math.min(state.workspace.step, steps.length - 1));
      state.view = 'create';
    } else {
      state.view = 'catalog';
    }
    await persist();
  } catch (error) {
    state.saveError = `Local storage could not be opened (${error.message}). You can continue, but changes may not survive closing this page.`;
  }
  render();
  void resumeMemoryTasks();
}

window.addEventListener('keydown', event => {
  if (event.key === 'Escape' && ['chat', 'settings', 'episodes'].includes(state.view)) history.back();
});
window.addEventListener('popstate', async event => {
  const destination = event.state?.companionView;
  state.chatError = '';
  if (destination === 'chat' && event.state.characterId) {
    state.activeId = event.state.characterId;
    const episode = event.state.episodeId ? setActiveEpisode(state.workspace, event.state.characterId, event.state.episodeId) : conversationFor(state.workspace, event.state.characterId);
    state.view = 'chat';
    renderChat();
    const character = activeCharacter();
    if (character && episode?.isOpening && (state.workspace.settings.chatModel?.url || state.workspace.settings.serverUrl)) void generateEpisodeOpening(character, episode);
    return;
  }
  if (destination === 'episodes' && event.state.characterId) {
    state.activeId = event.state.characterId;
    state.view = 'episodes';
    renderEpisodes();
    return;
  }
  if (destination === 'memory' && event.state.characterId) {
    state.activeId = event.state.characterId;
    state.view = 'memory';
    renderMemoryReview();
    return;
  }
  if (state.view === 'chat' || state.view === 'settings' || state.view === 'memory' || state.view === 'episodes') {
    state.view = 'catalog';
    await persist();
    renderCatalog();
  }
});
start();
