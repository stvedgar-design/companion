// www/js/ui/image-crop.js
// UI-037: recorte manual de la foto de perfil de un personaje. Un solo componente para TODOS los puntos donde
// se elige una foto de avatar (creador/wizard y "Cambiar foto" de la ficha): `chooseAvatar(app)`.
//
// Decisión técnica (ver docs/HISTORIAL.md, "UI-037"): mover y hacer zoom en pantalla es solo CSS
// (`transform` sobre un <img>, barato y fluido); el canvas se usa UNA vez, al confirmar, para generar las dos
// imágenes finales (384 y 1024 px, las de siempre) a partir del cuadrado elegido (`makeAvatarSet(blob, crop)`).
// La pantalla es una capa propia encima de la hoja (no una hoja nueva): abrirla no destruye lo que el usuario
// ya escribió en el creador. Atrás de Android la cancela (clase `crop-active` + evento `companion:crop-back`,
// el mismo patrón que `wizard-step-active`).
//
// Gestos: un dedo (o el ratón) arrastra la imagen; dos dedos pellizcan para el zoom; un control deslizante y
// la rueda del ratón hacen lo mismo para quien no pellizca. El marco cuadrado es fijo; fuera de él la imagen
// se ve atenuada (así se ve la foto completa mientras se encuadra). El círculo punteado es lo que se ve
// recortado en el hub, la lista de chats y junto a las burbujas.

import { pickFiles } from '../platform.js';
import { makeAvatarSet } from '../cards/avatar.js';
import {
  frameSizeFor, frameOrigin, initialView, panView, zoomAbout, zoomFraction, scaleFromFraction, cropRect,
} from '../image-crop-math.js';

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function loadSize(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ img, w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error('No se pudo leer la imagen.'));
    img.src = url;
  });
}

/**
 * Muestra la pantalla de recorte para `file`.
 * @param {File|Blob} file
 * @returns {Promise<{ sx: number, sy: number, side: number } | null>} el cuadrado elegido, o null si cancela.
 *   Rechaza si la imagen no se puede leer.
 */
export function openImageCrop(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    loadSize(url).then(({ img, w, h }) => {
      if (!w || !h) throw new Error('Imagen vacía.');
      const root = document.getElementById('app') || document.body;
      const overlay = el('div', 'crop');
      overlay.setAttribute('role', 'dialog');
      overlay.setAttribute('aria-modal', 'true');
      overlay.setAttribute('aria-label', 'Ajustar foto');

      const head = el('div', 'crop__head');
      head.appendChild(el('div', 'crop__title', 'Ajustar foto'));
      head.appendChild(el('div', 'crop__hint', 'Arrastra para mover y pellizca (o usa el control) para acercar. Lo que queda dentro del marco es tu foto.'));

      const stage = el('div', 'crop__stage');
      stage.style.touchAction = 'none';
      img.className = 'crop__img';
      img.alt = '';
      img.draggable = false;
      const frameEl = el('div', 'crop__frame');
      frameEl.appendChild(el('div', 'crop__circle'));
      stage.append(img, frameEl);

      const controls = el('div', 'crop__controls');
      const zoomLabel = el('label', 'crop__zoomlabel', 'Zoom');
      const zoom = el('input', 'crop__zoom');
      zoom.type = 'range';
      zoom.min = '0';
      zoom.max = '1000';
      zoom.step = '1';
      zoom.setAttribute('aria-label', 'Zoom');
      zoomLabel.appendChild(zoom);
      const actions = el('div', 'crop__actions');
      const cancelBtn = el('button', 'btn btn--ghost', 'Cancelar');
      cancelBtn.type = 'button';
      const okBtn = el('button', 'btn', 'Usar esta foto');
      okBtn.type = 'button';
      actions.append(cancelBtn, okBtn);
      controls.append(zoomLabel, actions);

      overlay.append(head, stage, controls);
      root.appendChild(overlay);
      document.body.classList.add('crop-active');

      let geom = null;
      let view = null;
      const pointers = new Map(); // pointerId -> {x, y}
      let pinchStart = null;
      let done = false;

      function measure(keepView) {
        const rect = stage.getBoundingClientRect();
        const stageW = Math.max(1, rect.width);
        const stageH = Math.max(1, rect.height);
        const frame = frameSizeFor(stageW, stageH);
        geom = { imgW: w, imgH: h, stageW, stageH, frame };
        const { fx, fy } = frameOrigin(geom);
        frameEl.style.width = `${frame}px`;
        frameEl.style.height = `${frame}px`;
        frameEl.style.left = `${fx}px`;
        frameEl.style.top = `${fy}px`;
        view = initialView(geom);
        if (!keepView) zoom.value = '0';
        render();
      }

      function render() {
        img.style.width = `${w}px`;
        img.style.height = `${h}px`;
        img.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
        zoom.value = String(Math.round(zoomFraction(view, geom) * 1000));
      }

      function localPoint(ev) {
        const rect = stage.getBoundingClientRect();
        return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
      }

      function onDown(ev) {
        try { stage.setPointerCapture?.(ev.pointerId); } catch { /* puntero ya no activo: se sigue sin captura */ }
        pointers.set(ev.pointerId, localPoint(ev));
        if (pointers.size === 2) {
          const [a, b] = [...pointers.values()];
          pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y) || 1, s: view.s };
        }
      }
      function onMove(ev) {
        if (!pointers.has(ev.pointerId)) return;
        const prev = pointers.get(ev.pointerId);
        const now = localPoint(ev);
        pointers.set(ev.pointerId, now);
        if (pointers.size >= 2 && pinchStart) {
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          view = zoomAbout(view, pinchStart.s * (dist / pinchStart.dist), mid.x, mid.y, geom);
        } else if (pointers.size === 1) {
          view = panView(view, now.x - prev.x, now.y - prev.y, geom);
        }
        render();
      }
      function onUp(ev) {
        pointers.delete(ev.pointerId);
        if (pointers.size < 2) pinchStart = null;
      }
      function onWheel(ev) {
        ev.preventDefault();
        const p = localPoint(ev);
        view = zoomAbout(view, view.s * Math.exp(-ev.deltaY * 0.0015), p.x, p.y, geom);
        render();
      }
      function onSlider() {
        const { fx, fy } = frameOrigin(geom);
        // el zoom del control se ancla al centro del marco
        view = zoomAbout(view, scaleFromFraction(Number(zoom.value) / 1000, geom), fx + geom.frame / 2, fy + geom.frame / 2, geom);
        render();
      }
      function onResize() { measure(false); }

      function finish(result) {
        if (done) return;
        done = true;
        stage.removeEventListener('pointerdown', onDown);
        stage.removeEventListener('pointermove', onMove);
        stage.removeEventListener('pointerup', onUp);
        stage.removeEventListener('pointercancel', onUp);
        stage.removeEventListener('wheel', onWheel);
        zoom.removeEventListener('input', onSlider);
        window.removeEventListener('resize', onResize);
        document.removeEventListener('companion:crop-back', onBack);
        document.body.classList.remove('crop-active');
        overlay.remove();
        URL.revokeObjectURL(url);
        resolve(result);
      }
      function onBack() { finish(null); }

      stage.addEventListener('pointerdown', onDown);
      stage.addEventListener('pointermove', onMove);
      stage.addEventListener('pointerup', onUp);
      stage.addEventListener('pointercancel', onUp);
      stage.addEventListener('wheel', onWheel, { passive: false });
      zoom.addEventListener('input', onSlider);
      window.addEventListener('resize', onResize);
      document.addEventListener('companion:crop-back', onBack);
      cancelBtn.addEventListener('click', () => finish(null));
      okBtn.addEventListener('click', () => finish(cropRect(view, geom)));

      measure(false);
    }).catch((err) => {
      URL.revokeObjectURL(url);
      reject(err);
    });
  });
}

/**
 * Elegir una foto de avatar de principio a fin: selector de archivos → recorte manual → las dos imágenes finales.
 * Es el ÚNICO camino de elegir una foto de avatar (creador y ficha). Avisa si la imagen no sirve.
 * @param {{ toast: Function }} app
 * @returns {Promise<{ avatar: string, avatarLarge: string } | null>} null = cancelado o no se pudo usar.
 */
export async function chooseAvatar(app) {
  const files = await pickFiles();
  if (!files.length) return null;
  let crop;
  try {
    crop = await openImageCrop(files[0]);
  } catch {
    app.toast('No se pudo usar esa imagen como avatar.');
    return null;
  }
  if (!crop) return null; // canceló: no se cambia nada
  const set = await makeAvatarSet(files[0], crop);
  if (!set.avatar) {
    app.toast('No se pudo usar esa imagen como avatar.');
    return null;
  }
  return set;
}
