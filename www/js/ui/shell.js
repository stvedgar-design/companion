// www/js/ui/shell.js
// Capa de UI de bajo nivel: cambia de vista, muestra avisos y hojas inferiores,
// y mantiene la app dentro de la parte visible de la pantalla aunque aparezca
// el teclado. No contiene lógica de negocio ni conoce el historial del
// navegador (eso vive en main.js).
//
// Eventos internos que dispara sobre `document` (no son parte del contrato
// público, pero main.js los escucha para sincronizar el historial):
//   'shell:sheetopen'  -> la hoja pasó de cerrada a abierta
//   'shell:sheetclose' -> la hoja pasó de abierta a cerrada

const VIEW_NAMES = ['lock', 'setup', 'home', 'chats', 'chat'];

function el(id) {
  return document.getElementById(id);
}

let toastTimer = null;

// Callback interno usado solo por confirmDialog para resolver su promesa
// cuando SU capa de la hoja se cierra por cualquier motivo (tocar fuera,
// atrás, botón).
let sheetCloseCallback = null;

// UI-036: pila de capas debajo de la que está visible ahora mismo. Cada vez
// que confirmDialog se abre con una hoja YA abierta debajo (p. ej. el editor
// de personaje), su contenido y su sheetCloseCallback se guardan aquí en vez
// de perderse; closeSheet() los restaura si hay algo que restaurar, y solo
// cierra la hoja entera de verdad cuando la pila queda vacía. openSheet()
// (reemplazo top-level, no anidado) vacía la pila: ese contenido guardado ya
// no tiene sentido si se navega a una hoja totalmente distinta.
let sheetStack = [];

function fitViewport() {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  const top = vv ? vv.offsetTop : 0;
  document.documentElement.style.setProperty('--vh', height + 'px');
  document.documentElement.style.setProperty('--vt', top + 'px');
}

export function initShell() {
  fitViewport();

  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', fitViewport);
    window.visualViewport.addEventListener('scroll', fitViewport);
  }
  window.addEventListener('resize', fitViewport);
  window.addEventListener('orientationchange', fitViewport);

  const sheet = el('sheet');
  if (sheet) {
    sheet.addEventListener('click', (event) => {
      if (event.target === sheet) closeSheet();
    });
  }
}

export function showView(name) {
  if (VIEW_NAMES.indexOf(name) === -1) return;
  for (const n of VIEW_NAMES) {
    const view = el('view-' + n);
    if (view) view.classList.toggle('is-active', n === name);
  }
}

// UI-024: un único skin, "Penumbra Claude". Los demás (Nomi, Glass, iMessage, Penumbra) están archivados en css/themes-archived.css
// (que no se carga); para reactivar alguno, ver la cabecera de ese archivo. `Settings.glassEffect` (UI-007) ya no tiene efecto.
export const THEMES = ['penumbra-claude'];

// Skin visual activo (ver www/css/themes.css). Puro atributo en <html>:
// todo lo demás es CSS, así que se refleja al instante en cualquier pantalla
// ya renderizada, sin que cada vista tenga que saber que existe.
// `themes.css` define cada combinación skin+modo con
// [data-theme="x"][data-mode="y"], así que los dos atributos son
// independientes — cambiar uno no toca el otro. Cualquier valor que no sea un skin activo cae en Penumbra Claude.
export function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : THEMES[0];
  syncThemeColorMeta();
}

// UI-023: "Tipografía dividida" (experimental, apagada por defecto). Solo un atributo en <html>: chat.css cambia la fuente del
// diálogo de los mensajes con acciones únicamente cuando vale "on"; sin el atributo, todo se ve exactamente como siempre.
export function applySplitTypography(on) {
  if (on === true) document.documentElement.dataset.splitFont = 'on';
  else delete document.documentElement.dataset.splitFont;
}

// UI-026/UI-038: tamaño del texto de los mensajes (15, 17 o 19px; 17 por defecto). Solo una variable CSS que
// lee `.chat-bubble` (chat.css) — el ancho de las burbujas no depende de ella (ver tokens.css).
export function applyMessageFontSize(px) {
  const n = Number(px);
  document.documentElement.style.setProperty('--msg-font-size', `${Number.isFinite(n) ? n : 17}px`);
}

// UI-038: tamaño de la foto del personaje junto a sus burbujas ('small'|'medium'|'large'). Solo un atributo en <html>;
// chat.css convierte cada valor en veces el tamaño del texto (--char-avatar-k). Sin valor válido, 'medium'.
export function applyChatAvatarSize(size) {
  document.documentElement.dataset.chatAvatar = ['small', 'medium', 'large'].includes(size) ? size : 'medium';
}

// Claro/oscuro, aplica sobre cualquier skin (ver themes.css).
export function applyThemeMode(mode) {
  document.documentElement.dataset.mode = mode === 'light' ? 'light' : 'dark';
  syncThemeColorMeta();
}

// El color de la barra de estado de Android (meta theme-color) tiene que
// seguir a --color-bg del tema activo, si no queda desentonando cuando se
// cambia a un skin/modo distinto del oscuro morado original.
function syncThemeColorMeta() {
  const meta = document.querySelector('meta[name="theme-color"]');
  if (!meta) return;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
  if (bg) meta.setAttribute('content', bg);
}

// Tinte de las superficies del skin "glass", derivado del color promedio del
// fondo de chat elegido (ver images.js / ui/appearance.js). `rgb` es
// {r,g,b} o null para volver al tinte por defecto de ese modo (themes.css).
export function setGlassTint(rgb) {
  if (rgb) {
    document.documentElement.style.setProperty('--glass-tint-rgb', `${rgb.r} ${rgb.g} ${rgb.b}`);
  } else {
    document.documentElement.style.removeProperty('--glass-tint-rgb');
  }
}

// MEM-012: además del texto llano de siempre, un aviso puede ser tocable (`onClick`, p. ej. para ir a
// ver el recuerdo nuevo) y/o "prominente" (`prominent`, un poco más de presencia visual — cambio de
// nivel de relación). Un solo nodo en el DOM (`#toast`): un aviso nuevo siempre reemplaza al anterior,
// así que nunca hay dos apilados.
let toastClickHandler = null;
export function toast(text, opts = {}) {
  const node = el('toast');
  if (!node) return;
  const { ms = 3800, onClick, prominent = false } = typeof opts === 'number' ? { ms: opts } : opts;
  node.textContent = text;
  node.classList.add('is-visible');
  node.classList.toggle('toast--prominent', !!prominent);
  if (toastClickHandler) {
    node.removeEventListener('click', toastClickHandler);
    toastClickHandler = null;
  }
  node.classList.toggle('toast--tappable', !!onClick);
  if (onClick) {
    toastClickHandler = () => {
      node.classList.remove('is-visible');
      onClick();
    };
    node.addEventListener('click', toastClickHandler);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), ms);
}

export function openSheet(node) {
  const sheet = el('sheet');
  const card = el('sheet-card');
  if (!sheet || !card) return;

  const wasOpen = sheet.classList.contains('is-open');
  if (wasOpen) {
    // Reemplazo top-level (no un confirmDialog anidado): cualquier capa
    // guardada para restaurar después deja de tener sentido, y el
    // confirmDialog pendiente (si lo había) se cancela — pero no tocamos el
    // historial (sigue siendo "una hoja abierta").
    sheetStack = [];
    const cb = sheetCloseCallback;
    sheetCloseCallback = null;
    if (cb) cb();
  }

  card.replaceChildren(node);
  sheet.classList.add('is-open');

  if (!wasOpen) {
    document.dispatchEvent(new CustomEvent('shell:sheetopen'));
  }
}

// UI-036: variante de openSheet() para confirmDialog. Si ya había una hoja
// abierta, guarda su contenido actual (y el sheetCloseCallback que tuviera)
// en sheetStack en vez de descartarlo, para que closeSheet() pueda
// restaurarlo cuando esta capa se cierre.
function pushSheetLayer(node, onDismiss) {
  const sheet = el('sheet');
  const card = el('sheet-card');
  if (!sheet || !card) {
    onDismiss();
    return;
  }

  const wasOpen = sheet.classList.contains('is-open');
  if (wasOpen) {
    sheetStack.push({ node: card.firstChild, callback: sheetCloseCallback });
  }
  sheetCloseCallback = onDismiss;
  card.replaceChildren(node);
  sheet.classList.add('is-open');

  if (!wasOpen) {
    document.dispatchEvent(new CustomEvent('shell:sheetopen'));
  }
}

export function isSheetOpen() {
  const sheet = el('sheet');
  return !!sheet && sheet.classList.contains('is-open');
}

export function closeSheet() {
  const sheet = el('sheet');
  if (!sheet || !sheet.classList.contains('is-open')) return;

  const cb = sheetCloseCallback;
  sheetCloseCallback = null;

  if (sheetStack.length > 0) {
    // Esta capa (p. ej. un confirmDialog) estaba anidada sobre una hoja que
    // ya estaba abierta: se restaura su contenido en vez de cerrar todo. La
    // hoja sigue abierta de principio a fin, así que no hay evento ni
    // historial que tocar.
    const prev = sheetStack.pop();
    const card = el('sheet-card');
    if (card && prev.node) card.replaceChildren(prev.node);
    sheetCloseCallback = prev.callback;
    if (cb) cb();
    return;
  }

  sheet.classList.remove('is-open');
  const card = el('sheet-card');
  if (card) card.replaceChildren();

  document.dispatchEvent(new CustomEvent('shell:sheetclose'));
  if (cb) cb();
}

export function confirmDialog(message, opts = {}) {
  const confirmText = opts.confirmText || 'Aceptar';
  const cancelText = opts.cancelText || 'Cancelar';
  const danger = !!opts.danger;

  return new Promise((resolve) => {
    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    const wrap = document.createElement('div');

    const text = document.createElement('p');
    text.className = 'sheet__title';
    text.textContent = message;
    wrap.appendChild(text);

    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = 'var(--space-3, 12px)';
    actions.style.marginTop = 'var(--space-4, 16px)';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn--ghost';
    cancelBtn.style.flex = '1';
    cancelBtn.textContent = cancelText;
    cancelBtn.addEventListener('click', () => {
      settle(false);
      closeSheet();
    });

    const okBtn = document.createElement('button');
    okBtn.type = 'button';
    okBtn.className = danger ? 'btn btn--danger' : 'btn';
    okBtn.style.flex = '1';
    okBtn.textContent = confirmText;
    okBtn.addEventListener('click', () => {
      settle(true);
      closeSheet();
    });

    actions.appendChild(cancelBtn);
    actions.appendChild(okBtn);
    wrap.appendChild(actions);

    // pushSheetLayer cubre tanto el caso normal (confirmDialog es la única
    // hoja) como el anidado (p. ej. sobre el editor de personaje, UI-036):
    // en ambos, cierre por botón, por tocar fuera o por "atrás" (que en
    // main.js termina llamando a closeSheet()) resuelve la promesa con
    // settle(false) salvo que ya se haya resuelto por un botón.
    pushSheetLayer(wrap, () => settle(false));
  });
}
