// www/js/images.js
// Utilidades de imágenes compartidas: redimensionar a un data URL liviano y
// calcular el color promedio de una imagen (para el tinte del skin "glass",
// ver ui/appearance.js). Toca el DOM (canvas/Image), igual que cards/avatar.js.

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('No se pudo decodificar la imagen.'));
    img.src = src;
  });
}

function canvasToDataUrl(canvas, quality) {
  if (typeof canvas.convertToBlob === 'function') {
    return canvas.convertToBlob({ type: 'image/jpeg', quality }).then(
      (blob) => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('No se pudo procesar la imagen.'));
        reader.readAsDataURL(blob);
      }),
    );
  }
  return Promise.resolve(canvas.toDataURL('image/jpeg', quality));
}

function makeCanvas(w, h) {
  if (typeof document !== 'undefined' && document.createElement) {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  return null;
}

/**
 * Redimensiona `blob` para que su lado más largo no supere `maxDim`,
 * conservando la proporción (sin recortar), y devuelve un data URL JPEG
 * liviano. Pensado para fondos de chat elegidos por el usuario: no hace
 * falta guardar la imagen a resolución completa.
 * @param {Blob} blob
 * @param {number} [maxDim]
 * @param {number} [quality]
 * @returns {Promise<string>} '' si la imagen no se puede decodificar.
 */
export async function resizeImageToDataUrl(blob, maxDim = 1280, quality = 0.82) {
  if (!blob) return '';
  let url;
  try {
    url = URL.createObjectURL(blob);
    const img = await loadImage(url);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (!w || !h) return '';

    const scale = Math.min(1, maxDim / Math.max(w, h));
    const outW = Math.max(1, Math.round(w * scale));
    const outH = Math.max(1, Math.round(h * scale));

    const canvas = makeCanvas(outW, outH);
    if (!canvas) return '';
    const ctx = canvas.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(img, 0, 0, outW, outH);
    return await canvasToDataUrl(canvas, quality);
  } catch {
    return '';
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}

const SAMPLE_SIZE = 16;

/**
 * Calcula el color RGB promedio de una imagen, muestreando a baja
 * resolución para que sea barato. Usado para que el tinte del skin "glass"
 * (ver www/css/theme-glass.css) reaccione al fondo de chat elegido.
 * @param {string} dataUrl
 * @returns {Promise<{r:number, g:number, b:number}|null>} null si falla.
 */
export async function averageColorFromDataUrl(dataUrl) {
  if (!dataUrl) return null;
  try {
    const img = await loadImage(dataUrl);
    const canvas = makeCanvas(SAMPLE_SIZE, SAMPLE_SIZE);
    if (!canvas) return null;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, SAMPLE_SIZE, SAMPLE_SIZE);
    const { data } = ctx.getImageData(0, 0, SAMPLE_SIZE, SAMPLE_SIZE);

    let r = 0, g = 0, b = 0, count = 0;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      count++;
    }
    if (!count) return null;
    return { r: Math.round(r / count), g: Math.round(g / count), b: Math.round(b / count) };
  } catch {
    return null;
  }
}
