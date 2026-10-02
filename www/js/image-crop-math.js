// www/js/image-crop-math.js
// UI-037: matemática pura del recorte manual de la foto de perfil (sin DOM; la usa ui/image-crop.js).
//
// Geometría (todo en píxeles de la pantalla de recorte, "escenario"):
//   - `frame` es el lado del marco cuadrado, fijo y centrado en el escenario (stageW × stageH).
//   - La imagen se dibuja con escala `s` (píxel de pantalla por píxel de la imagen) y su esquina
//     superior izquierda en (tx, ty).
//   - El marco SIEMPRE queda dentro de la imagen: no se puede elegir una zona fuera de ella.
// Así lo que se ve dentro del marco es exactamente lo que se guarda (cropRect).

export const MAX_ZOOM = 6; // veces la escala mínima (la que hace que la imagen apenas cubra el marco)
export const TOP_BIAS = 0.15; // mismo sesgo hacia arriba que usaba el recorte automático de antes (cards/avatar.js)

/**
 * @typedef {{ imgW: number, imgH: number, stageW: number, stageH: number, frame: number }} CropGeom
 * @typedef {{ s: number, tx: number, ty: number }} CropView
 */

/** Posición del marco dentro del escenario. */
export function frameOrigin(g) {
  return { fx: (g.stageW - g.frame) / 2, fy: (g.stageH - g.frame) / 2 };
}

/** Lado del marco: ocupa casi todo el lado corto del escenario, con un margen para ver lo que queda fuera. */
export function frameSizeFor(stageW, stageH) {
  return Math.max(1, Math.floor(Math.min(stageW, stageH) * 0.86));
}

/** Escala mínima: la imagen apenas cubre el marco por su lado más corto. */
export function minScale(g) {
  return g.frame / Math.min(g.imgW, g.imgH);
}

export function maxScale(g) {
  return minScale(g) * MAX_ZOOM;
}

/** Vista inicial: zoom mínimo, centrada en horizontal y con el sesgo hacia arriba en vertical. */
export function initialView(g) {
  const s = minScale(g);
  const { fx, fy } = frameOrigin(g);
  const overflowX = g.imgW * s - g.frame;
  const overflowY = g.imgH * s - g.frame;
  return clampView({ s, tx: fx - overflowX / 2, ty: fy - overflowY * TOP_BIAS }, g);
}

/** Ajusta escala y posición para que el marco quede siempre dentro de la imagen. */
export function clampView(view, g) {
  const s = Math.min(maxScale(g), Math.max(minScale(g), view.s));
  const { fx, fy } = frameOrigin(g);
  const minTx = fx + g.frame - g.imgW * s; // borde derecho de la imagen alineado con el del marco
  const minTy = fy + g.frame - g.imgH * s;
  return {
    s,
    tx: Math.min(fx, Math.max(minTx, view.tx)),
    ty: Math.min(fy, Math.max(minTy, view.ty)),
  };
}

/** Mueve la imagen (arrastrar). */
export function panView(view, dx, dy, g) {
  return clampView({ s: view.s, tx: view.tx + dx, ty: view.ty + dy }, g);
}

/** Cambia la escala manteniendo quieto el punto (ax, ay) del escenario (pellizco, rueda o control de zoom). */
export function zoomAbout(view, newScale, ax, ay, g) {
  const s = Math.min(maxScale(g), Math.max(minScale(g), newScale));
  const k = s / view.s;
  return clampView({ s, tx: ax - (ax - view.tx) * k, ty: ay - (ay - view.ty) * k }, g);
}

/** Nivel de zoom 0..1 para el control deslizante (0 = mínimo, 1 = máximo), en escala logarítmica. */
export function zoomFraction(view, g) {
  return Math.log(view.s / minScale(g)) / Math.log(MAX_ZOOM);
}

export function scaleFromFraction(fraction, g) {
  const f = Math.min(1, Math.max(0, fraction));
  return minScale(g) * Math.pow(MAX_ZOOM, f);
}

/**
 * Cuadrado de la imagen original (en sus píxeles) que queda dentro del marco: lo que se guarda.
 * @returns {{ sx: number, sy: number, side: number }}
 */
export function cropRect(view, g) {
  const { fx, fy } = frameOrigin(g);
  const side = Math.min(g.frame / view.s, g.imgW, g.imgH);
  const sx = Math.min(g.imgW - side, Math.max(0, (fx - view.tx) / view.s));
  const sy = Math.min(g.imgH - side, Math.max(0, (fy - view.ty) / view.s));
  return { sx, sy, side };
}
