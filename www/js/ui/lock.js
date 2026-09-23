// www/js/ui/lock.js
// Pantalla de bloqueo con PIN (opcional, se activa/desactiva desde
// settings.js). No es una vista más del sistema de navegación normal de
// main.js: se muestra una única vez al arrancar, antes de decidir la vista
// inicial, y su `show()` no resuelve hasta que se ingresa el PIN correcto.
// Reutiliza las clases `.setup*` de home.css (mismo look que la pantalla de
// conexión inicial) — no necesita CSS propio.

import { verifyPin } from '../lock.js';

let els = {};

export function init(root) {
  root.innerHTML = `
    <div class="setup">
      <h1 class="setup-title">Bloqueada</h1>
      <p class="setup-lead">Ingresá tu PIN para entrar a Companion.</p>
      <div class="field">
        <input class="inp" id="lock-input" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN">
        <div class="field__hint" id="lock-error" hidden>PIN incorrecto. Probá de nuevo.</div>
      </div>
      <button class="btn setup-go" id="lock-go" type="button">Desbloquear</button>
    </div>
  `;
  els = {
    input: root.querySelector('#lock-input'),
    go: root.querySelector('#lock-go'),
    error: root.querySelector('#lock-error'),
  };
}

/**
 * Muestra la pantalla y no resuelve hasta que se ingresa el PIN correcto.
 * @param {{ salt: string, hash: string }} pin
 * @returns {Promise<void>}
 */
export function show({ salt, hash }) {
  return new Promise((resolve) => {
    els.input.value = '';
    els.error.hidden = true;

    const tryUnlock = async () => {
      els.go.disabled = true;
      const ok = await verifyPin(els.input.value, salt, hash);
      els.go.disabled = false;
      if (ok) {
        els.go.removeEventListener('click', tryUnlock);
        els.input.removeEventListener('keydown', onKeydown);
        resolve();
        return;
      }
      els.error.hidden = false;
      els.input.value = '';
      els.input.focus();
    };

    const onKeydown = (e) => {
      if (e.key === 'Enter') tryUnlock();
    };

    els.go.addEventListener('click', tryUnlock);
    els.input.addEventListener('keydown', onKeydown);
    els.input.focus();
  });
}
