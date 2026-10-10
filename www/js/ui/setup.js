// www/js/ui/setup.js
// Vista de conexión inicial: ingresa tu API Key de OpenRouter y empieza a conversar.

import { getSettings, saveSettings } from '../state.js';
import { connect, DEFAULT_FREE_MODEL } from '../api/kobold.js';

let app = null;
let els = {};
let redirectTimer = null;

export function init(root, appApi) {
  app = appApi;

  root.innerHTML = `
    <div class="setup">
      <h1 class="setup-title">Companion</h1>
      <p class="setup-lead">Ingresa tu API Key de OpenRouter para conectar tu companion en la nube.</p>

      <div class="field">
        <label class="field__label" for="setup-key">API Key de OpenRouter</label>
        <input class="inp" id="setup-key" type="password"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"
               placeholder="sk-or-v1-...">
        <div class="field__hint">Tu clave personal creada en openrouter.ai/settings/keys. Se guarda solo en este dispositivo.</div>
      </div>

      <div class="field">
        <label class="field__label" for="setup-model">Modelo de IA</label>
        <input class="inp" id="setup-model" type="text"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"
               placeholder="${DEFAULT_FREE_MODEL}">
        <div class="field__hint">Puedes empezar gratis con: <button type="button" class="btn btn--ghost btn--sm" id="setup-free-btn" style="display:inline-block;padding:2px 8px;font-size:12px;min-height:unset;">Usar modelo gratis</button></div>
      </div>

      <div class="field">
        <label class="field__label" for="setup-user">Tu nombre en el chat</label>
        <input class="inp" id="setup-user" type="text" autocomplete="off"
               placeholder="Cómo te llama el personaje">
      </div>

      <button class="btn setup-go" id="setup-go" type="button">Conectar</button>
      <div class="status" id="setup-status"></div>
    </div>
  `;

  els = {
    key: root.querySelector('#setup-key'),
    model: root.querySelector('#setup-model'),
    freeBtn: root.querySelector('#setup-free-btn'),
    user: root.querySelector('#setup-user'),
    go: root.querySelector('#setup-go'),
    status: root.querySelector('#setup-status'),
  };

  els.freeBtn.addEventListener('click', () => {
    els.model.value = DEFAULT_FREE_MODEL;
  });

  els.go.addEventListener('click', onConnect);
}

export async function show() {
  const settings = await getSettings();
  els.key.value = settings.apiKey || '';
  els.model.value = settings.model || DEFAULT_FREE_MODEL;
  els.user.value = settings.user || '';
  els.status.className = 'status';
  els.status.textContent = '';
  els.go.disabled = false;
}

export function hide() {
  if (redirectTimer) {
    clearTimeout(redirectTimer);
    redirectTimer = null;
  }
}

async function onConnect() {
  const apiKey = els.key.value.trim();
  const model = els.model.value.trim() || DEFAULT_FREE_MODEL;
  const user = els.user.value.trim();

  if (!apiKey) {
    els.status.className = 'status status--err';
    els.status.textContent = 'Por favor ingresa tu API Key de OpenRouter.';
    return;
  }

  els.go.disabled = true;
  els.status.className = 'status';
  els.status.textContent = 'Conectando con OpenRouter…';

  try {
    const { url, model: connectedModel, ctx } = await connect({ apiKey, model });
    await saveSettings({ apiKey, model: connectedModel, ctx, user, url });
    els.status.className = 'status status--ok';
    els.status.textContent = 'Conectado a OpenRouter: ' + connectedModel;
    redirectTimer = setTimeout(() => {
      redirectTimer = null;
      app.navigate('home', {}, { replace: true });
    }, 500);
  } catch (err) {
    els.status.className = 'status status--err';
    els.status.textContent = err.message;
    els.go.disabled = false;
  }
}
