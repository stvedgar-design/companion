// www/js/cards/parse.js
// Lectura y normalización de character cards (Tavern V1/V2/V3), en PNG o JSON.
// Sin DOM. Detección por contenido, no por extensión ni por file.type.

const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const MAX_FILE_BYTES = 25 * 1024 * 1024; // 25 MB

function isPngSignature(bytes) {
  if (bytes.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) return false;
  }
  return true;
}

function latin1Slice(bytes, start, end) {
  let out = '';
  for (let i = start; i < end; i++) out += String.fromCharCode(bytes[i]);
  return out;
}

function decodeBase64Utf8Json(raw) {
  let binary;
  try {
    binary = atob(String(raw).trim());
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
}

async function inflateDeflate(bytes) {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('Este dispositivo no puede leer character cards PNG comprimidas.');
  }
  try {
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
    const buffer = await new Response(stream).arrayBuffer();
    return new Uint8Array(buffer);
  } catch {
    throw new Error('Ese PNG no trae una character card.');
  }
}

/**
 * Recorre los chunks de un PNG y extrae el JSON crudo de la character card
 * guardado en un chunk de texto `chara` (V1/V2) o `ccv3` (V3, tiene prioridad).
 * @param {ArrayBuffer} buffer
 * @returns {Promise<object|null>} JSON crudo de la card, o null si el PNG no trae card.
 */
export async function readPngCard(buffer) {
  const bytes = new Uint8Array(buffer);
  if (!isPngSignature(bytes)) return null;

  const found = {}; // key -> { text } | { bytes } (comprimido)
  let p = 8;
  while (p + 8 <= bytes.length) {
    const header = new DataView(bytes.buffer, bytes.byteOffset + p, 8);
    const len = header.getUint32(0);
    const type = latin1Slice(bytes, p + 4, p + 8);
    const dataStart = p + 8;
    const dataEnd = dataStart + len;
    if (dataEnd > bytes.length || len < 0) break;

    if (type === 'tEXt' || type === 'iTXt') {
      let z = dataStart;
      while (z < dataEnd && bytes[z] !== 0) z++;
      const key = latin1Slice(bytes, dataStart, z);
      if (key === 'chara' || key === 'ccv3') {
        if (type === 'tEXt') {
          found[key] = { text: latin1Slice(bytes, z + 1, dataEnd) };
        } else {
          // iTXt: keyword\0 compFlag compMethod langTag\0 translatedKeyword\0 text
          let cursor = z + 1;
          const compFlag = bytes[cursor]; cursor += 1;
          cursor += 1; // compression method, ignorado (0 = zlib/deflate)
          let langEnd = cursor;
          while (langEnd < dataEnd && bytes[langEnd] !== 0) langEnd++;
          cursor = langEnd + 1;
          let tkEnd = cursor;
          while (tkEnd < dataEnd && bytes[tkEnd] !== 0) tkEnd++;
          cursor = tkEnd + 1;
          const payload = bytes.slice(cursor, dataEnd);
          if (compFlag === 1) {
            found[key] = { bytes: payload };
          } else {
            found[key] = { text: latin1Slice(payload, 0, payload.length) };
          }
        }
      }
    }
    if (type === 'IEND') break;
    p = dataEnd + 4; // salta CRC
  }

  const chosen = found.ccv3 || found.chara;
  if (!chosen) return null;

  let base64Text;
  if (chosen.bytes) {
    const inflated = await inflateDeflate(chosen.bytes);
    base64Text = new TextDecoder('utf-8', { fatal: false }).decode(inflated);
  } else {
    base64Text = chosen.text;
  }
  return decodeBase64Utf8Json(base64Text);
}

function pickString(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v) return v;
  }
  return '';
}

function asString(v) {
  return typeof v === 'string' ? v : '';
}

/**
 * Normaliza el JSON crudo de una card (envoltorio V2/V3, formato plano, o alias
 * heredados) a una Card completa con todos los campos presentes.
 * @param {object} json
 * @returns {import('../state.js').Card}
 */
export function normCard(json) {
  const wrapped = json && typeof json === 'object' && json.spec && json.data && typeof json.data === 'object';
  const d = wrapped ? json.data : (json && typeof json === 'object' ? json : {});

  const alternateGreetings = Array.isArray(d.alternate_greetings)
    ? d.alternate_greetings.filter((g) => typeof g === 'string')
    : [];

  const characterBook = (d.character_book && typeof d.character_book === 'object')
    ? d.character_book
    : null;

  return {
    name: pickString(d.name, d.char_name) || 'Sin nombre',
    description: pickString(d.description, d.char_persona),
    personality: asString(d.personality),
    scenario: pickString(d.scenario, d.world_scenario),
    first_mes: pickString(d.first_mes, d.char_greeting),
    mes_example: pickString(d.mes_example, d.example_dialogue),
    system_prompt: asString(d.system_prompt),
    post_history_instructions: asString(d.post_history_instructions),
    alternate_greetings: alternateGreetings,
    character_book: characterBook,
  };
}

/**
 * Parsea un archivo de character card (PNG o JSON, detectado por contenido).
 * @param {File} file
 * @returns {Promise<{ card: import('../state.js').Card, avatarBlob: Blob|null }>}
 */
export async function parseCardFile(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw new Error('No se pudo leer el archivo.');
  }
  if (typeof file.size === 'number' && file.size > MAX_FILE_BYTES) {
    throw new Error('El archivo es demasiado grande.');
  }

  const buffer = await file.arrayBuffer();
  if (buffer.byteLength > MAX_FILE_BYTES) {
    throw new Error('El archivo es demasiado grande.');
  }

  const bytes = new Uint8Array(buffer);

  if (isPngSignature(bytes)) {
    const raw = await readPngCard(buffer);
    if (!raw) throw new Error('Ese PNG no trae una character card.');
    const avatarBlob = typeof file.slice === 'function'
      ? file.slice(0, file.size, file.type || 'image/png')
      : file;
    return { card: normCard(raw), avatarBlob };
  }

  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }
  text = text.replace(/^\uFEFF/, '');

  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('El archivo no es un JSON válido.');
  }

  return { card: normCard(raw), avatarBlob: null };
}
