// www/js/cards/avatar.js
// Genera el avatar cuadrado (data URL JPEG) a partir del PNG de una character card.
// Único archivo de "Datos" que toca el DOM (canvas e imágenes).

const BACKGROUND = '#20222f';
const TOP_BIAS = 0.15; // el rostro suele estar arriba: recorta con este sesgo del sobrante vertical

function loadViaImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      resolve({
        drawable: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        cleanup: () => URL.revokeObjectURL(url),
      });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('No se pudo decodificar la imagen.'));
    };
    img.src = url;
  });
}

async function loadDrawable(blob) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      drawable: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      cleanup: () => { if (bitmap.close) bitmap.close(); },
    };
  }
  return loadViaImageElement(blob);
}

function canvasToDataUrl(canvas) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }).then(
      (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo generar el avatar.'));
        reader.readAsDataURL(blob);
      }),
    );
  }
  return Promise.resolve(canvas.toDataURL('image/jpeg', 0.85));
}

/**
 * Recorta `blob` a un cuadrado (sesgo hacia arriba), lo dibuja sobre un fondo
 * sólido (para PNG con transparencia) y devuelve un data URL JPEG.
 * @param {Blob} blob
 * @param {number} [size]
 * @returns {Promise<string>} data URL JPEG cuadrado, o '' si la imagen no se puede decodificar.
 */
/** UI-027: lado largo de la foto grande de la ficha (la pequeña de siempre, 384, sigue igual para círculos). */
export const AVATAR_LARGE_SIZE = 1024;

/**
 * UI-027: genera las DOS versiones a la vez a partir de la misma imagen de origen — la pequeña de
 * siempre (para círculos: hub, cabecera, burbujas) y una grande (para la foto de la ficha, que se ve
 * borrosa con solo 384px a todo el ancho). Mismo recorte cuadrado con sesgo hacia arriba en ambas.
 * @param {Blob} blob
 * @returns {Promise<{avatar: string, avatarLarge: string}>}
 */
export async function makeAvatarSet(blob, crop) {
  const [avatar, avatarLarge] = await Promise.all([makeAvatar(blob, 384, crop), makeAvatar(blob, AVATAR_LARGE_SIZE, crop)]);
  return { avatar, avatarLarge };
}

/**
 * UI-037: `crop` opcional = `{ sx, sy, side }`, el cuadrado de la imagen ORIGINAL (en sus píxeles) que el usuario
 * eligió en la pantalla de recorte (ui/image-crop.js). Sin `crop` se mantiene el recorte automático de siempre
 * (cuadrado centrado con sesgo hacia arriba), que sigue usando la importación de cards. El tamaño de salida no
 * cambia (384 y 1024): el recorte manual no infla el almacenamiento.
 */
export async function makeAvatar(blob, size = 384, crop) {
  if (!blob) return '';

  let loaded;
  try {
    loaded = await loadDrawable(blob);
  } catch {
    return '';
  }

  const { drawable, width, height, cleanup } = loaded;
  try {
    if (!width || !height) return '';

    let side = Math.min(width, height);
    let offsetX = (width - side) / 2;
    let offsetY = (height - side) * TOP_BIAS;
    if (crop && Number.isFinite(crop.side) && crop.side > 0) {
      side = Math.min(crop.side, width, height);
      offsetX = Math.min(width - side, Math.max(0, Number.isFinite(crop.sx) ? crop.sx : 0));
      offsetY = Math.min(height - side, Math.max(0, Number.isFinite(crop.sy) ? crop.sy : 0));
    }

    let canvas;
    if (typeof document !== 'undefined' && document.createElement) {
      canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
    } else if (typeof OffscreenCanvas !== 'undefined') {
      canvas = new OffscreenCanvas(size, size);
    } else {
      return '';
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return '';

    ctx.fillStyle = BACKGROUND;
    ctx.fillRect(0, 0, size, size);
    ctx.drawImage(drawable, offsetX, offsetY, side, side, 0, 0, size, size);

    return await canvasToDataUrl(canvas);
  } catch {
    return '';
  } finally {
    cleanup();
  }
}
