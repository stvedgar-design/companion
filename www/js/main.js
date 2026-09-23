// www/js/main.js
// Arranque de la app: crea el objeto `app` (AppApi), inicializa las tres
// vistas y gobierna la navegación con el historial del navegador para que
// el botón/gesto "atrás" de Android funcione tanto entre pantallas como
// para cerrar hojas abiertas.

import * as shell from './ui/shell.js';
import * as state from './state.js';
import * as lockView from './ui/lock.js';
import * as setupView from './ui/setup.js';
import * as homeView from './ui/home.js';
import * as chatsView from './ui/chats.js';
import * as chatView from './ui/chat.js';

const views = {
  setup: setupView,
  home: homeView,
  chats: chatsView,
  chat: chatView,
};

let currentView = null;
let currentParams;

// true mientras la entrada actual del historial corresponde a una hoja
// abierta (empujada por el listener de 'shell:sheetopen' más abajo).
let sheetHistoryPushed = false;

const app = {
  navigate,
  back,
  toast: shell.toast,
  openSheet: shell.openSheet,
  closeSheet: shell.closeSheet,
  confirmDialog: shell.confirmDialog,
};

/**
 * Cambia de vista: oculta la actual, activa la nueva y actualiza el
 * historial. Si `show()` de la nueva vista falla, avisa y vuelve atrás.
 */
async function navigate(view, params, opts = {}) {
  if (!views[view] || typeof views[view].show !== 'function') return;
  const replace = !!opts.replace;

  // Si había una hoja abierta, su entrada de historial se consume aquí
  // mismo (con replaceState más abajo) en vez de dejar que el cierre la
  // saque por su cuenta; así se evita una carrera entre closeSheet() y el
  // pushState/replaceState de esta navegación.
  const wasSheetOpen = sheetHistoryPushed;
  if (wasSheetOpen) sheetHistoryPushed = false;
  shell.closeSheet();

  const prevView = currentView;
  const useReplace = replace || wasSheetOpen;

  try {
    if (prevView && views[prevView] && typeof views[prevView].hide === 'function') {
      views[prevView].hide();
    }
    shell.showView(view);
    await views[view].show(params);
    currentView = view;
    currentParams = params;
    writeHistory(view, params, useReplace);
  } catch (err) {
    console.error(err);
    shell.toast('No se pudo abrir esa pantalla.');
    const fallback = prevView && prevView !== view ? prevView : 'home';
    if (fallback === view) return;
    shell.showView(fallback);
    currentView = fallback;
    currentParams = undefined;
    writeHistory(fallback, undefined, useReplace);
    try {
      await views[fallback].show(undefined);
    } catch (err2) {
      console.error(err2);
    }
  }
}

function writeHistory(view, params, replace) {
  const entry = { view, params };
  if (replace) {
    history.replaceState(entry, '');
  } else {
    history.pushState(entry, '');
  }
}

function back() {
  history.back();
}

// --- Sincronización de hojas con el historial ---------------------------
// shell.js no conoce el historial; avisa por eventos cuando una hoja pasa
// de cerrada a abierta o de abierta a cerrada, y aquí se traduce a
// pushState/back para que el botón atrás de Android cierre la hoja.

document.addEventListener('shell:sheetopen', () => {
  sheetHistoryPushed = true;
  history.pushState({ view: currentView, params: currentParams, sheet: true }, '');
});

document.addEventListener('shell:sheetclose', () => {
  if (sheetHistoryPushed) {
    sheetHistoryPushed = false;
    history.back();
  }
});

window.addEventListener('popstate', (event) => {
  if (sheetHistoryPushed) {
    // "Atrás" con una hoja abierta: solo la cierra, no cambia de vista.
    sheetHistoryPushed = false;
    shell.closeSheet();
    return;
  }

  const st = event.state;
  const targetView = st && st.view ? st.view : currentView;
  const targetParams = st ? st.params : undefined;

  if (targetView === currentView) {
    // Misma vista (p. ej. resultado de haber cerrado una hoja antes): nada
    // que hacer, evita un salto de vista fantasma.
    return;
  }

  switchViewFromHistory(targetView, targetParams);
});

async function switchViewFromHistory(view, params) {
  if (!views[view] || typeof views[view].show !== 'function') return;
  const prevView = currentView;
  try {
    if (prevView && views[prevView] && typeof views[prevView].hide === 'function') {
      views[prevView].hide();
    }
    shell.showView(view);
    await views[view].show(params);
    currentView = view;
    currentParams = params;
  } catch (err) {
    console.error(err);
    shell.toast('No se pudo volver a esa pantalla.');
    navigate('home', undefined, { replace: true });
  }
}

// --- Errores globales -----------------------------------------------------

window.onerror = function (message, source, lineno, colno, error) {
  console.error(error || message);
  shell.toast('Ocurrió un error inesperado.');
};

window.addEventListener('unhandledrejection', (event) => {
  console.error(event.reason);
  shell.toast('Ocurrió un error inesperado.');
});

// --- Arranque ---------------------------------------------------------

async function boot() {
  shell.initShell();

  lockView.init(document.getElementById('view-lock'));
  setupView.init(document.getElementById('view-setup'), app);
  homeView.init(document.getElementById('view-home'), app);
  chatsView.init(document.getElementById('view-chats'), app);
  chatView.init(document.getElementById('view-chat'), app);

  try {
    await state.migrateLegacyChats();
  } catch (err) {
    console.error(err);
    // No bloquea el arranque: en el peor caso, algunos chats viejos
    // quedan sin migrar hasta el siguiente intento.
  }

  const settings = await state.getSettings();

  if (settings.pinHash) {
    shell.showView('lock');
    await lockView.show({ salt: settings.pinSalt, hash: settings.pinHash });
  }

  const initial = settings && settings.url ? 'home' : 'setup';

  currentView = initial;
  currentParams = undefined;
  shell.showView(initial);
  history.replaceState({ view: initial, params: undefined }, '');
  await views[initial].show(undefined);
}

boot().catch((err) => {
  console.error(err);
  renderBootError(err);
});

function renderBootError(err) {
  const root = document.getElementById('app');
  if (!root) return;
  root.innerHTML = '';

  const wrap = document.createElement('div');
  wrap.style.cssText =
    'display:flex;flex-direction:column;align-items:center;justify-content:center;' +
    'height:100%;padding:24px;text-align:center;gap:16px;';

  const msg = document.createElement('p');
  const reason = err && err.message ? err.message : 'error desconocido.';
  msg.textContent = 'No se pudo iniciar la aplicación: ' + reason;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = 'Reintentar';
  btn.addEventListener('click', () => location.reload());

  wrap.appendChild(msg);
  wrap.appendChild(btn);
  root.appendChild(wrap);
}
