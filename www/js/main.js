// www/js/main.js
// Arranque de la app: crea el objeto `app` (AppApi), inicializa las tres
// vistas y gobierna la navegación con el historial del navegador para que
// el botón/gesto "atrás" de Android funcione tanto entre pantallas como
// para cerrar hojas abiertas. UI-014: en el APK ese botón se intercepta con
// el plugin @capacitor/app (ver "Botón atrás de Android" más abajo).

import * as shell from './ui/shell.js';
import * as state from './state.js';
import { decideBack } from './nav.js';
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
  popstateCount++;
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
  transitioning = true;
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
  } finally {
    transitioning = false;
  }
}

// --- Botón atrás de Android (UI-014) -------------------------------------
// Sin este listener, Capacitor cierra la app o retrocede por su cuenta. Aquí
// se reutiliza la navegación que ya existe: cerrar la hoja abierta (que
// devuelve su entrada de historial), retroceder con `back()` (lo mismo que la
// flecha de la barra superior) o salir solo desde la raíz. La decisión vive
// en `nav.js` (`decideBack`, pura y probada).

const BACK_DEBOUNCE_MS = 300; // pulsaciones repetidas rápido no saltan dos pantallas
const BACK_FALLBACK_MS = 400; // si `history.back()` no produjo ningún cambio, se va al hub
let popstateCount = 0;
let transitioning = false; // true mientras una vista se está abriendo desde el historial
let lastBackAt = 0;

function onAndroidBack() {
  const now = Date.now();
  if (transitioning || now - lastBackAt < BACK_DEBOUNCE_MS) return;
  lastBackAt = now;

  const action = decideBack({ sheetOpen: shell.isSheetOpen(), view: currentView });
  if (action === 'close-sheet') {
    shell.closeSheet();
  } else if (action === 'back') {
    const seen = popstateCount;
    back();
    // Red de seguridad: si por algún motivo no había entrada anterior en el
    // historial, no dejamos al usuario atrapado sin respuesta al "atrás".
    setTimeout(() => {
      if (popstateCount === seen && !transitioning && currentView && currentView !== 'home') {
        navigate('home', undefined, { replace: true });
      }
    }, BACK_FALLBACK_MS);
  } else {
    exitApp();
  }
}

function nativeAppPlugin() {
  const capacitor = window.Capacitor;
  const plugins = capacitor && capacitor.Plugins;
  return plugins && plugins.App ? plugins.App : null;
}

function exitApp() {
  const plugin = nativeAppPlugin();
  if (plugin && typeof plugin.exitApp === 'function') plugin.exitApp();
}

// Solo existe dentro del APK; en el navegador no hay `Capacitor.Plugins.App`
// y no se hace nada (la navegación por historial sigue igual que antes).
function registerAndroidBack() {
  const plugin = nativeAppPlugin();
  if (!plugin || typeof plugin.addListener !== 'function') return;
  try {
    const registered = plugin.addListener('backButton', onAndroidBack);
    if (registered && typeof registered.catch === 'function') registered.catch((err) => console.error(err));
  } catch (err) {
    console.error(err);
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
  registerAndroidBack();

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

  shell.applyTheme(settings.theme);
  shell.applyThemeMode(settings.themeMode);
  shell.applyGlassEffect(settings.glassEffect);
  // El tinte del skin "glass" (ver themes.css) ya no se calcula acá: el
  // fondo de chat es por personaje (ver docs/NOTES.md, "Fondo de chat por
  // personaje"), así que lo aplica ui/chat.js al entrar a un chat, y lo
  // vuelve a soltar al salir — fuera de un chat no hay un personaje del que
  // sacar un tinte.

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
