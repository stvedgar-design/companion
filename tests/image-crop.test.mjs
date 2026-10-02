// tests/image-crop.test.mjs — UI-037: matemática del recorte manual y su conexión con los dos puntos de elegir foto.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  frameSizeFor, frameOrigin, minScale, maxScale, initialView, clampView, panView, zoomAbout,
  zoomFraction, scaleFromFraction, cropRect, MAX_ZOOM, TOP_BIAS,
} from '../www/js/image-crop-math.js';

// Foto vertical típica de Stable Diffusion (832×1216) en un escenario de teléfono.
const stageW = 351;
const stageH = 540;
const frame = frameSizeFor(stageW, stageH);
const G = { imgW: 832, imgH: 1216, stageW, stageH, frame };
const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≈ ${b}`);

test('frameSizeFor: casi todo el lado corto, nunca 0', () => {
  assert.equal(frame, Math.floor(351 * 0.86));
  assert.equal(frameSizeFor(0, 0), 1);
});

test('vista inicial: zoom mínimo, marco dentro de la imagen, centrada y con sesgo hacia arriba', () => {
  const v = initialView(G);
  near(v.s, minScale(G));
  const r = cropRect(v, G);
  near(r.side, 832, 1e-6);          // el lado corto de la imagen entra justo en el marco
  near(r.sx, 0);
  near(r.sy, (1216 - 832) * TOP_BIAS, 1e-6); // igual que el recorte automático de antes
});

test('arrastrar: el marco nunca sale de la imagen (se queda pegado al borde)', () => {
  let v = initialView(G);
  v = panView(v, 0, 100000, G); // arrastrar la imagen hacia abajo "para siempre" = ver el borde superior
  near(cropRect(v, G).sy, 0);
  v = panView(v, 0, -100000, G);
  near(cropRect(v, G).sy + cropRect(v, G).side, 1216, 1e-6);
  v = panView(v, 100000, 0, G);
  near(cropRect(v, G).sx, 0);
});

test('zoom: limitado entre el mínimo y 6 veces; el punto bajo el dedo se queda quieto', () => {
  const v0 = initialView(G);
  assert.equal(zoomAbout(v0, 0.0001, 100, 100, G).s, minScale(G));
  near(zoomAbout(v0, 1e9, 100, 100, G).s, maxScale(G));
  near(maxScale(G) / minScale(G), MAX_ZOOM);
  // punto del marco (centro): antes y después del zoom apunta al mismo píxel de la imagen
  const { fx, fy } = frameOrigin(G);
  const cx = fx + frame / 2, cy = fy + frame / 2;
  const before = { x: (cx - v0.tx) / v0.s, y: (cy - v0.ty) / v0.s };
  const v1 = zoomAbout(v0, v0.s * 3, cx, cy, G);
  const after = { x: (cx - v1.tx) / v1.s, y: (cy - v1.ty) / v1.s };
  near(after.x, before.x, 1e-6);
  near(after.y, before.y, 1e-6);
  // con zoom 3×, el recorte es un tercio del lado
  near(cropRect(v1, G).side, 832 / 3, 1e-6);
});

test('control deslizante: 0 = mínimo, 1 = máximo, y es reversible', () => {
  near(scaleFromFraction(0, G), minScale(G));
  near(scaleFromFraction(1, G), maxScale(G));
  near(scaleFromFraction(5, G), maxScale(G));
  const v = { ...initialView(G), s: scaleFromFraction(0.5, G) };
  near(zoomFraction(v, G), 0.5, 1e-9);
});

test('imagen horizontal y cuadrada: el recorte siempre es un cuadrado dentro de la imagen', () => {
  for (const [w, h] of [[1216, 832], [500, 500], [4000, 3000], [64, 4000]]) {
    const g = { imgW: w, imgH: h, stageW, stageH, frame };
    for (const f of [0, 0.3, 1]) {
      let v = { ...initialView(g), s: scaleFromFraction(f, g) };
      for (const [dx, dy] of [[0, 0], [9999, -9999], [-9999, 9999]]) {
        v = panView(clampView(v, g), dx, dy, g);
        const r = cropRect(v, g);
        assert.ok(r.side > 0 && r.sx >= -1e-9 && r.sy >= -1e-9, `${w}x${h}`);
        assert.ok(r.sx + r.side <= w + 1e-6 && r.sy + r.side <= h + 1e-6, `${w}x${h} fuera de la imagen`);
        assert.ok(r.side <= Math.min(w, h) + 1e-6);
      }
    }
  }
});

test('UI-037: el creador y "Cambiar foto" usan el MISMO componente; el fondo del chat no lo usa', () => {
  const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8');
  const editor = read('../www/js/ui/character-editor.js');
  const sheet = read('../www/js/ui/character-sheet.js');
  const bg = read('../www/js/ui/chat-background.js');
  assert.match(editor, /chooseAvatar\(app\)/);
  assert.match(sheet, /chooseAvatar\(app\)/);
  assert.doesNotMatch(editor, /makeAvatarSet/);
  assert.doesNotMatch(sheet, /makeAvatarSet/);
  assert.doesNotMatch(bg, /image-crop|chooseAvatar/);
  // importar una card (PNG con la imagen incrustada) NO pasa por el recorte manual: sigue igual
  const imp = read('../www/js/cards/import.js');
  assert.match(imp, /makeAvatarSet\(avatarBlob\)/);
});

test('UI-037: makeAvatar sin recorte conserva el comportamiento anterior; con recorte lo usa', () => {
  const src = readFileSync(new URL('../www/js/cards/avatar.js', import.meta.url), 'utf8');
  assert.match(src, /export async function makeAvatarSet\(blob, crop\)/);
  assert.match(src, /export async function makeAvatar\(blob, size = 384, crop\)/);
  assert.match(src, /let offsetY = \(height - side\) \* TOP_BIAS;/, 'el recorte automático de siempre sigue ahí');
});
