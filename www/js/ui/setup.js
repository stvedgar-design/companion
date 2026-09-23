// www/js/ui/setup.js
// Vista de conexión inicial: pega la URL de KoboldCpp y el nombre de usuario.

import { getSettings, saveSettings } from '../state.js';
import { connect } from '../api/kobold.js';

let app = null;
let els = {};
let redirectTimer = null;

export function init(root, appApi) {
  app = appApi;

  root.innerHTML = `
    <div class="setup">
      <h1 class="setup-title">Companion</h1>
      <p class="setup-lead">Pega la URL de tu KoboldCpp y empieza a chatear con tus character cards.</p>

      <div class="field">
        <label class="field__label" for="setup-url">URL de KoboldCpp</label>
        <input class="inp" id="setup-url" type="url" inputmode="url"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false"
               placeholder="http://100.x.x.x:5001">
        <div class="field__hint">Es la dirección de Tailscale de tu PC con el puerto de KoboldCpp.</div>
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
    url: root.querySelector('#setup-url'),
    user: root.querySelector('#setup-user'),
    go: root.querySelector('#setup-go'),
    status: root.querySelector('#setup-status'),
  };

  els.go.addEventListener('click', onConnect);
}

export async function show() {
  const settings = await getSettings();
  els.url.value = settings.url || '';
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
  const rawUrl = els.url.value;
  const user = els.user.value.trim();

  els.go.disabled = true;
  els.status.className = 'status';
  els.status.textContent = 'Conectando…';

  try {
    const { url, model, ctx } = await connect(rawUrl);
    await saveSettings({ url, ctx, user });
    els.status.className = 'status status--ok';
    els.status.textContent = 'Conectado: ' + model;
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
