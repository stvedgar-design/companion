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

const VIEW_NAMES = ['setup', 'home', 'chats', 'chat'];

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
