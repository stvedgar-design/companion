// www/js/ui/contrast.js
// UI-008: contraste de color (WCAG 2.x), puro y sin DOM. Lo usan los tests para vigilar que el texto y la cursiva se
// lean bien sobre las burbujas de cada skin/modo (ver tests/contrast.test.mjs y docs/HISTORIAL.md, "UI-008").

/**
 * Convierte un color CSS a { r, g, b, a } (r/g/b 0-255, a 0-1). Acepta #rgb, #rrggbb, rgb()/rgba() con comas o con
 * espacios y `/ alfa`. Devuelve null si no lo entiende.
 * @param {string} input
 * @returns {{ r: number, g: number, b: number, a: number }|null}
 */
export function parseColor(input) {
  const s = String(input == null ? '' : input).trim().toLowerCase();
  let m = /^#([0-9a-f]{3})$/.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((c) => parseInt(c + c, 16));
    return { r, g, b, a: 1 };
  }
  m = /^#([0-9a-f]{6})$/.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 };
  }
  m = /^rgba?\(\s*([^)]+)\)$/.exec(s);
  if (m) {
    const parts = m[1].split(/[\s,/]+/).filter(Boolean).map((p) => (p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p)));
    if (parts.length < 3 || parts.slice(0, 3).some((n) => !Number.isFinite(n))) return null;
    const a = parts.length > 3 && Number.isFinite(parts[3]) ? Math.min(1, Math.max(0, parts[3])) : 1;
    return { r: parts[0], g: parts[1], b: parts[2], a };
  }
  return null;
}

/** Pone `fg` (posiblemente translúcido) encima de `bg` (opaco) y devuelve el color resultante, opaco. */
export function composite(fg, bg) {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** Luminancia relativa WCAG de un color opaco. */
export function luminance({ r, g, b }) {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/**
 * Relación de contraste WCAG entre texto `fg` y fondo `bg` (1 a 21). Si `fg` es translúcido se compone sobre `bg`;
 * si `bg` es translúcido se compone antes sobre `under` (por defecto negro).
 * @param {string|object} fg  color CSS o { r, g, b, a }
 * @param {string|object} bg
 * @param {string|object} [under]  lo que hay detrás de un `bg` translúcido
 * @returns {number}
 */
export function contrastRatio(fg, bg, under = '#000000') {
  const f = typeof fg === 'string' ? parseColor(fg) : fg;
  let b = typeof bg === 'string' ? parseColor(bg) : bg;
  const u = typeof under === 'string' ? parseColor(under) : under;
  if (!f || !b || !u) return NaN;
  if (b.a < 1) b = composite(b, u);
  const text = f.a < 1 ? composite(f, b) : f;
  const l1 = luminance(text);
  const l2 = luminance(b);
  const [hi, lo] = l1 >= l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}
