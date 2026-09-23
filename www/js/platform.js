// www/js/platform.js
//
// Única capa de acceso a "plataforma" (selección de archivos, guardado de
// blobs). Hoy corre en una WebView normal; cuando el proyecto se empaquete
// como APK con Capacitor, este archivo es el que se sustituirá por APIs
// nativas de Android (selector de archivos nativo, guardado en almacenamiento
// del dispositivo). Por eso se mantiene deliberadamente pequeño y sin
// dependencias: nadie más en la app debe tocar <input type=file> ni <a
// download> directamente.

/**
 * Abre el selector de archivos del sistema y resuelve con los archivos
 * elegidos.
 * @param {{ multiple?: boolean }} [opts]
 * @returns {Promise<File[]>} [] si el usuario cancela.
 */
export function pickFiles(opts = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    // Sin atributo `accept`: en Android, un `accept` con tipos de imagen
    // abre la galería en vez del explorador de archivos, y ahí no se
    // pueden elegir archivos .json.
    if (opts.multiple) input.multiple = true;
    input.style.position = 'fixed';
    input.style.top = '-9999px';
    input.style.left = '-9999px';
    document.body.appendChild(input);

    let settled = false;

    const cleanup = () => {
      input.removeEventListener('change', onChange);
      input.removeEventListener('cancel', onCancel);
      window.removeEventListener('focus', onFocus);
      if (input.parentNode) input.parentNode.removeChild(input);
    };

    const settle = (files) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(files);
    };

    const onChange = () => {
      settle(Array.from(input.files || []));
    };

    // Soportado en WebViews de Chromium recientes: se dispara al cerrar el
    // selector sin elegir nada.
    const onCancel = () => {
      settle([]);
    };

    // Respaldo para navegadores sin evento 'cancel': si la ventana recupera
    // el foco y no llegó 'change' poco después, se asume cancelación.
    const onFocus = () => {
      setTimeout(() => {
        if (!settled) settle([]);
      }, 300);
    };

    input.addEventListener('change', onChange);
    input.addEventListener('cancel', onCancel);
    window.addEventListener('focus', onFocus);

    input.click();
  });
}

/**
 * Descarga un blob con el nombre de archivo indicado.
 * @param {Blob} blob
 * @param {string} filename
 * @returns {Promise<void>}
 */
export async function saveBlob(blob, filename) {
  const capacitor = window.Capacitor;
  if (capacitor && capacitor.isNativePlatform && capacitor.isNativePlatform()) {
    await saveBlobNative(blob, filename, capacitor);
    return;
  }
  saveBlobWeb(blob, filename);
}

function saveBlobWeb(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  if (a.parentNode) a.parentNode.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// En el APK (WebView de Android), `<a download>` con un blob: URL no dispara
// ninguna descarga real: el clic no hace nada y no lanza ningún error, así
// que el guardado fallaba en silencio. Por eso ahí se usan los plugins
// nativos Filesystem + Share: se escribe el archivo en el almacenamiento de
// la app y se abre el panel nativo de "Compartir/Guardar" para que el
// usuario elija dónde dejarlo (Drive, Archivos, etc.).
async function saveBlobNative(blob, filename, capacitor) {
  const plugins = capacitor.Plugins || {};
  const { Filesystem, Share } = plugins;
  if (!Filesystem || !Share) {
    throw new Error('No se pudo guardar el archivo: faltan los plugins nativos de la app.');
  }
  const base64 = await blobToBase64(blob);
  let uri;
  try {
    const result = await Filesystem.writeFile({
      path: filename,
      data: base64,
      directory: 'CACHE',
    });
    uri = result.uri;
  } catch (err) {
    throw new Error('No se pudo guardar el archivo en el teléfono.');
  }
  try {
    await Share.share({
      title: filename,
      dialogTitle: 'Guardar ' + filename,
      url: uri,
    });
  } catch (err) {
    // El usuario cerró el panel de compartir sin elegir nada: no es un error real.
    if (err && /cancel/i.test(err.message || '')) return;
    throw new Error('No se pudo abrir el panel para guardar el archivo.');
  }
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo a guardar.'));
    reader.readAsDataURL(blob);
  });
}
