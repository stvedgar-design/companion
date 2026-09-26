import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseColor, composite, luminance, contrastRatio } from '../www/js/ui/contrast.js';

const css = (name) => readFileSync(new URL(`../www/css/${name}`, import.meta.url), 'utf8');

test('UI-008: contrastRatio con valores conocidos de WCAG', () => {
  assert.equal(contrastRatio('#000000', '#ffffff').toFixed(2), '21.00');
  assert.equal(contrastRatio('#ffffff', '#000000').toFixed(2), '21.00'); // simétrica
  assert.equal(contrastRatio('#123456', '#123456').toFixed(2), '1.00');
  assert.equal(contrastRatio('#767676', '#ffffff').toFixed(2), '4.54'); // el gris más claro que pasa 4.5:1 sobre blanco
  assert.equal(contrastRatio('#777777', '#ffffff').toFixed(2), '4.48');
  assert.ok(Number.isNaN(contrastRatio('rojo', '#fff')));
});

test('UI-008: parseColor entiende hex corto/largo, rgb/rgba con comas y con espacios y barra de alfa', () => {
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#8b1fe0'), { r: 139, g: 31, b: 224, a: 1 });
  assert.deepEqual(parseColor('rgba(255, 255, 255, 0.72)'), { r: 255, g: 255, b: 255, a: 0.72 });
  assert.deepEqual(parseColor('rgb(24 25 36 / 0.46)'), { r: 24, g: 25, b: 36, a: 0.46 });
  assert.deepEqual(parseColor('rgb(1, 2, 3)'), { r: 1, g: 2, b: 3, a: 1 });
  assert.equal(parseColor('transparente'), null);
  assert.equal(parseColor(null), null);
});

test('UI-008: un texto translúcido se compone sobre el fondo antes de medir', () => {
  const half = contrastRatio('rgba(255,255,255,0.5)', '#000000');
  assert.ok(half < 21 && half > 1);
  const opaque = contrastRatio('#808080', '#000000'); // 0.5 de blanco sobre negro = #808080
  assert.ok(Math.abs(half - opaque) < 0.05);
  // un fondo translúcido se compone sobre lo que hay detrás
  assert.deepEqual(composite({ r: 0, g: 0, b: 0, a: 0.5 }, { r: 255, g: 255, b: 255, a: 1 }), { r: 127.5, g: 127.5, b: 127.5, a: 1 });
  assert.ok(luminance({ r: 255, g: 255, b: 255 }) > luminance({ r: 0, g: 0, b: 1 }));
});

// ---- tabla de contraste por skin/modo y rol, calculada desde el CSS real ----

function loadSkins() {
  const skins = {};
  for (const m of css('themes.css').matchAll(/\[data-theme="([\w-]+)"\]\[data-mode="(\w+)"\]\s*\{([^}]*)\}/g)) {
    const tokens = {};
    for (const d of m[3].matchAll(/(--[\w-]+):\s*([^;]+?);/g)) tokens[d[1]] = d[2].trim().replace(/\s+/g, ' ');
    if (tokens['--color-bg']) skins[`${m[1]}/${m[2]}`] = tokens; // solo los bloques completos (no los ajustes de efecto de vidrio)
  }
  return skins;
}

const resolveVars = (v, t) => v.replace(/var\((--[\w-]+)\)/g, (_, n) => t[n] ?? '');
const colorStops = (v) => [...v.matchAll(/(#[0-9a-f]{3,6}|rgba?\([^)]*\))/gi)].map((x) => x[1]);

function roles(t) {
  const bg = parseColor(t['--color-bg']);
  // --color-surface-2 puede ser un degradado (Penumbra): se mide contra el PEOR de sus tramos
  const charStops = colorStops(resolveVars(t['--color-surface-2'], t)).map((c) => composite(parseColor(c), bg));
  const worstOnChar = (fg) => Math.min(...charStops.map((b) => contrastRatio(fg, b)));
  const userStops = colorStops(resolveVars(t['--grad-user'], t)).map((c) => composite(parseColor(c), bg));
  const worstOnUser = (fg) => Math.min(...userStops.map((b) => contrastRatio(fg, b)));
  return {
    charText: worstOnChar(t['--color-text']),
    charEm: worstOnChar(t['--color-em'] || t['--color-muted']),
    userText: worstOnUser(parseColor(t['--color-on-user'] || t['--color-text'])),
    userEm: worstOnUser(parseColor(t['--color-muted-on-accent'])),
  };
}

// Umbral por skin/modo. 4.5 = objetivo WCAG AA. Las excepciones son el MÁXIMO que se logra sin cambiar el
// color de la burbuja del usuario (color de identidad del skin): ver docs/HISTORIAL.md, "UI-008".
const AA = 4.5;
// UI-021: la cursiva del usuario se tiñe con el color de cada skin para distinguirse del texto (que ya es blanco/negro
// puro, sin margen). Decisión del usuario: 4,0:1 como piso en los skins con margen; en los dos skins donde el texto
// mismo no llega a 4 (Glass claro, iMessage oscuro) la cursiva queda ~0,5 por debajo del texto.
const EM4 = 4.0;
const FLOORS = {
  'nomi/dark':      { charText: 7, charEm: AA, userText: AA,  userEm: EM4 },
  'nomi/light':     { charText: 7, charEm: AA, userText: AA,  userEm: EM4 },
  'glass/dark':     { charText: 7, charEm: AA, userText: AA,  userEm: EM4 },
  'glass/light':    { charText: 7, charEm: AA, userText: 3.8, userEm: 3.3 }, // burbuja violeta clara: blanco da 3.88 como máximo
  'imessage/dark':  { charText: 7, charEm: AA, userText: 3.6, userEm: 3.2 }, // azul de iOS con texto blanco: 3.65 como máximo
  'imessage/light': { charText: 7, charEm: AA, userText: AA,  userEm: EM4 },
  // UI-009: los skins nuevos nacen con 4,5:1 en todos los roles (el contraste es parte del diseño de la paleta).
  'penumbra/dark':         { charText: 7, charEm: AA, userText: AA, userEm: EM4 },
  'penumbra/light':        { charText: 7, charEm: AA, userText: AA, userEm: EM4 },
  'penumbra-claude/dark':  { charText: 7, charEm: AA, userText: AA, userEm: EM4 },
  'penumbra-claude/light': { charText: 7, charEm: AA, userText: AA, userEm: EM4 },
};

test('UI-008/UI-009: contraste de texto y cursiva sobre cada burbuja, en los 10 skins/modos', () => {
  const skins = loadSkins();
  assert.deepEqual(Object.keys(skins).sort(), Object.keys(FLOORS).sort());
  for (const [key, t] of Object.entries(skins)) {
    const r = roles(t);
    for (const [role, floor] of Object.entries(FLOORS[key])) {
      assert.ok(r[role] >= floor, `${key} ${role}: ${r[role].toFixed(2)} < ${floor}`);
    }
  }
});

test('UI-021: la cursiva del usuario es un color distinto del texto del usuario en cada skin/modo, teñido con su identidad', () => {
  for (const [key, t] of Object.entries(loadSkins())) {
    const text = parseColor(t['--color-on-user'] || t['--color-text']);
    const em = parseColor(t['--color-muted-on-accent']);
    assert.ok(em && em.a === 1, `${key}: la cursiva del usuario es un color sólido`);
    const dist = Math.abs(em.r - text.r) + Math.abs(em.g - text.g) + Math.abs(em.b - text.b);
    assert.ok(dist >= 24, `${key}: cursiva demasiado parecida al texto (distancia ${dist.toFixed(0)})`);
  }
});

test('UI-008: ninguna regla fuerza un valor fijo para la cursiva del usuario: respeta el token de cada skin', () => {
  const chat = css('chat.css');
  const rule = /\.chat-row--user \.chat-bubble em\s*\{([^}]*)\}/.exec(chat);
  assert.ok(rule, 'falta la regla de respaldo');
  assert.match(rule[1], /var\(--color-muted-on-accent/);
  // el único valor fijo que queda es el respaldo dentro de var(), no la regla en sí
  assert.ok(!/color:\s*rgba?\(/.test(rule[1].replace(/var\([^)]*\)/g, '')));
});

test('UI-008: la burbuja del usuario usa el token de texto de cada skin', () => {
  assert.match(css('chat.css'), /\.chat-row--user \.chat-bubble\s*\{[^}]*color:\s*var\(--color-on-user, var\(--color-text\)\)/);
});

// ---- UI-009: Penumbra y Penumbra Claude ----

test('UI-009: los skins nuevos usan solo tokens (sin backdrop-filter en ningún componente) y ambos modos existen', () => {
  const skins = loadSkins();
  for (const name of ['penumbra', 'penumbra-claude']) {
    for (const mode of ['dark', 'light']) {
      const t = skins[`${name}/${mode}`];
      assert.ok(t, `${name}/${mode}`);
      assert.equal(t['--surface-backdrop'], 'none');
      assert.equal(t['--bars-backdrop'], 'none');
      assert.ok(!/blur\(/.test(Object.values(t).join(' ')), 'sin blur en ningún token');
    }
  }
  // themes.css no declara `backdrop-filter` como propiedad (solo tokens): los componentes lo leen de las variables
  assert.ok(!/^\s*(-webkit-)?backdrop-filter\s*:/m.test(css('themes.css')));
});

test('UI-009: Penumbra y Penumbra Claude son hermanos: mismas propiedades y misma estructura; solo cambian la paleta y (UI-015) la tipografía', () => {
  const skins = loadSkins();
  for (const mode of ['dark', 'light']) {
    const a = skins[`penumbra/${mode}`];
    const b = skins[`penumbra-claude/${mode}`];
    assert.deepEqual(Object.keys(a).sort(), Object.keys(b).sort());
    assert.equal(a['--surface-backdrop'], b['--surface-backdrop']);
    assert.notEqual(a['--color-bg'], b['--color-bg']);
    assert.notEqual(a['--grad-user'], b['--grad-user']);
  }
});

// ---- UI-015: cursiva y color independientes por skin; una tipografía propia por skin ----

test('UI-015: cada bloque de Penumbra/Penumbra Claude define su PROPIO --color-em (sin fugas entre hermanos) y las reglas de cursiva no dependen del skin', () => {
  const skins = loadSkins();
  const em = {};
  for (const skin of ['penumbra', 'penumbra-claude']) {
    for (const mode of ['dark', 'light']) {
      const v = skins[`${skin}/${mode}`]['--color-em'];
      assert.match(v, /^#[0-9a-f]{6}$/i, `${skin}/${mode} debe definir --color-em`);
      em[`${skin}/${mode}`] = v.toLowerCase();
    }
  }
  assert.equal(new Set(Object.values(em)).size, 4, 'los 4 modos tienen un --color-em distinto');
  assert.equal(em['penumbra/dark'], '#ebc987'); // DESIGN.md: dorado champán propio de Penumbra oscuro (no el terracota de Claude)
  // ningún bloque fuera de un skin concreto redefine --color-em ni --font (una redefinición suelta pisaría a un hermano)
  const themes = css('themes.css').replace(/\[data-theme="[\w-]+"\]\[data-mode="\w+"\]\s*\{[^}]*\}/g, '');
  assert.ok(!/--color-em\s*:/.test(themes.replace(/\/\*[\s\S]*?\*\//g, '')), '--color-em solo en bloques completos de skin');
  // la cursiva es una regla de componente única e incondicional
  assert.match(css('chat.css'), /\.chat-bubble em\s*\{\s*color:\s*var\(--em-color\);\s*font-style:\s*italic;/);
});

test('UI-015: cada skin tiene su tipografía; las incluidas en la app traen romana e itálica reales, archivos y licencia', () => {
  const skins = loadSkins();
  const expected = { nomi: 'Literata', glass: 'Figtree', penumbra: 'Lora', 'penumbra-claude': 'Source Serif 4' };
  for (const [skin, family] of Object.entries(expected)) {
    for (const mode of ['dark', 'light']) {
      assert.ok(skins[`${skin}/${mode}`]['--font'].startsWith(`'${family}'`), `${skin}/${mode} usa ${family}`);
    }
  }
  for (const mode of ['dark', 'light']) assert.ok(!/^'/.test(skins[`imessage/${mode}`]['--font']), 'iMessage usa la fuente del sistema');
  // las cuatro familias incluidas son distintas entre sí
  assert.equal(new Set(Object.values(expected)).size, 4);
  const tokens = css('tokens.css');
  for (const family of Object.values(expected)) {
    for (const style of ['normal', 'italic']) {
      const blocks = [...tokens.matchAll(new RegExp(`@font-face\\s*\\{[^}]*font-family:\\s*'${family}';[^}]*font-style:\\s*${style};[^}]*\\}`, 'g'))];
      assert.ok(blocks.length >= 2, `${family} ${style}: faltan @font-face (latin y latin-ext)`);
      for (const b of blocks) {
        const file = b[0].match(/url\(\.\.\/fonts\/([^)]+)\)/)[1];
        assert.ok(existsSync(new URL(`../www/fonts/${file}`, import.meta.url)), `existe ${file}`);
        assert.ok(!/https?:/.test(b[0]), 'sin fuentes de internet');
      }
    }
    assert.ok(existsSync(new URL(`../www/fonts/OFL-${family.replace(/ /g, '-')}.txt`, import.meta.url)), `licencia de ${family}`);
  }
});

// ---- UI-022: punto de estado del hub con tono por franja del día ----

test('UI-022: los 4 tonos del punto de estado (por franja y por modo) contrastan ≥3:1 con el fondo de todos los skins', () => {
  const home = css('home.css');
  const tone = { dark: {}, light: {} };
  for (const m of home.matchAll(/(\[data-mode='light'\] )?\.home-status\[data-part='(\w+)'\]\s*\{\s*--dot-ok:\s*(#[0-9a-f]{6})/gi)) {
    tone[m[1] ? 'light' : 'dark'][m[2]] = m[3];
  }
  for (const mode of ['dark', 'light']) assert.deepEqual(Object.keys(tone[mode]).sort(), ['madrugada', 'manana', 'noche', 'tarde'], mode);
  for (const [key, t] of Object.entries(loadSkins())) {
    const mode = key.split('/')[1];
    for (const [part, color] of Object.entries(tone[mode])) {
      const cr = contrastRatio(color, t['--color-bg']);
      assert.ok(cr >= 3, `${key} ${part}: punto ${color} sobre ${t['--color-bg']} = ${cr.toFixed(2)} < 3`);
    }
  }
});

test('UI-022: "sin conexión" se distingue por la forma (anillo hueco), no solo por el color', () => {
  const home = css('home.css');
  const ok = /\.home-status\[data-state='ok'\] i\s*\{([^}]*)\}/.exec(home)[1];
  const err = /\.home-status\[data-state='err'\] i\s*\{([^}]*)\}/.exec(home)[1];
  assert.match(ok, /background:\s*var\(--dot-ok\)/);
  assert.match(err, /background:\s*transparent/);
  assert.match(err, /border:\s*[\d.]+px solid var\(--color-danger\)/);
});

// ---- UI-023: tipografía dividida (experimental) ----

test('UI-023: el token --font-dialogue existe y la regla solo actúa con html[data-split-font="on"], solo en el personaje y sin tocar la cursiva', () => {
  assert.match(css('tokens.css'), /--font-dialogue:\s*[^;]*sans-serif;/);
  const chat = css('chat.css');
  // ninguna regla usa --font-dialogue fuera del atributo (apagado = idéntico a antes)
  for (const m of chat.matchAll(/([^{}]*)\{[^}]*--font-dialogue[^}]*\}/g)) {
    assert.match(m[1], /\[data-split-font="on"\] \.chat-row--char \.chat-bubble--split/, m[1]);
  }
  assert.match(chat, /\[data-split-font="on"\] \.chat-row--char \.chat-bubble--split em\s*\{\s*font-family:\s*var\(--font\);/);
  // ningún skin redefine --font-dialogue (es uno solo, global)
  assert.ok(!/--font-dialogue/.test(css('themes.css')));
});
