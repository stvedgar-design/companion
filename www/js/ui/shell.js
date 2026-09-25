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
// cuando la hoja se cierra por cualquier motivo (tocar fuera, atrás, botón).
let sheetCloseCallback = null;

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

const THEMES = ['nomi', 'glass', 'imessage'];

// Skin visual activo (ver www/css/themes.css). Puro atributo en <html>:
// todo lo demás es CSS, así que cambiar de skin se refleja al instante en
// cualquier pantalla ya renderizada, sin que cada vista tenga que saber que
// existe. `themes.css` define cada combinación skin+modo con
// [data-theme="x"][data-mode="y"], así que los dos atributos son
// independientes — cambiar uno no toca el otro.
export function applyTheme(theme) {
  document.documentElement.dataset.theme = THEMES.includes(theme) ? theme : 'nomi';
  syncThemeColorMeta();
}

// UI-007: efecto de vidrio de Glass ('full' | 'bars' | 'off'). Solo un atributo en <html>: themes.css lo
// aplica únicamente al skin Glass, así que en los demás skins no cambia nada.
export const GLASS_EFFECTS = ['full', 'bars', 'off'];
export function applyGlassEffect(value) {
  document.documentElement.dataset.glass = GLASS_EFFECTS.includes(value) ? value : 'full';
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

export function toast(text, ms = 3800) {
  const node = el('toast');
  if (!node) return;
  node.textContent = text;
  node.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('is-visible'), ms);
}

export function openSheet(node) {
  const sheet = el('sheet');
  const card = el('sheet-card');
  if (!sheet || !card) return;

  const wasOpen = sheet.classList.contains('is-open');
  if (wasOpen) {
    // Reemplazo: cualquier confirmDialog pendiente en la hoja anterior se
    // cancela, pero no tocamos el historial (sigue siendo "una hoja abierta").
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

export function isSheetOpen() {
  const sheet = el('sheet');
  return !!sheet && sheet.classList.contains('is-open');
}

export function closeSheet() {
  const sheet = el('sheet');
  if (!sheet || !sheet.classList.contains('is-open')) return;

  sheet.classList.remove('is-open');
  const card = el('sheet-card');
  if (card) card.replaceChildren();

  const cb = sheetCloseCallback;
  sheetCloseCallback = null;

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

    // Cubre cierre por toque fuera de la tarjeta y por "atrás" (que en
    // main.js termina llamando a closeSheet()).
    sheetCloseCallback = () => settle(false);

    openSheet(wrap);
  });
}
