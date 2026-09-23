# CONTRATOS COMPARTIDOS — Proyecto "Companion"

> Este bloque es idéntico en los 6 prompts del proyecto y es la única fuente de verdad. Otras instancias de IA construyen los demás módulos en paralelo, sin ver tu conversación. Si algo del contrato te parece mejorable, respétalo igual y anótalo en tus "Notas de integración". Nunca cambies nombres, firmas ni formas de datos por tu cuenta.

## 1. Qué es el proyecto

App móvil de chat estilo "AI companion" (referencia visual: Nomi AI; oscura, morada, limpia) para hablar con personajes de roleplay usando un servidor **KoboldCpp propio del usuario**, accesible por red privada (Tailscale, por ejemplo `http://100.x.x.x:5001`, siempre http, nunca https). El usuario pega la URL, carga una character card (PNG o JSON, formato Tavern V1/V2/V3) y chatea. Todo corre en el cliente; no hay backend propio.

Hoy se abre desde `http://localhost` y más adelante se empaquetará como APK de Android con Capacitor (WebView de Chromium). El usuario usa **solo un teléfono Android**.

Existe un **prototipo funcional en un solo archivo, `companion.html`**, que el usuario adjunta a tu conversación. Es tu referencia de comportamiento y de estilo: contiene lógica ya probada (lectura de cards PNG, streaming SSE, armado de prompt, manejo del teclado en móvil). NO es la estructura final: ahora todo se divide en módulos. Copia su comportamiento, no su organización.

## 2. Reglas técnicas para todos los módulos

- JavaScript vanilla con módulos ES (`<script type="module">`). Sin npm, sin bundler, sin frameworks, sin librerías externas. Única dependencia externa permitida: Google Fonts (Outfit) enlazada desde `index.html`.
- Objetivo: WebView de Chromium reciente en Android, pantalla táctil de 360 a 430 px de ancho. Sin hover; usa `:active` y `:focus-visible`.
- Identificadores de código en inglés. Comentarios y textos de interfaz en español neutro.
- Sin variables globales. `localStorage`/IndexedDB solo dentro de `www/js/state.js`. `fetch` a servidores solo dentro de `www/js/api/kobold.js`. Prohibido `alert`, `confirm` y `prompt` nativos: usa `app.confirmDialog` y `app.toast`.
- Cada archivo se entrega completo. Nada de "// resto igual" ni marcadores de relleno.
- Nunca insertes texto de usuario, modelo o card con `innerHTML` sin escapar. Usa `textContent` o `escapeHtml`.
- Nunca falles en silencio. Los errores para el usuario van en español, claros y accionables (qué pasó y qué hacer).
- Accesibilidad mínima: `aria-label` en botones de solo icono, `:focus-visible` visible, contraste AA, zonas táctiles de al menos 44 px, `prefers-reduced-motion` respetado.
- La app es un cliente de chat neutral: muestra las conversaciones tal cual, sin filtrarlas, modificarlas ni comentarlas.

## 3. Estructura del proyecto y propiedad de archivos

Cada instancia crea SOLO sus archivos. Si necesitas algo de otro módulo, úsalo exactamente como lo define este contrato.

```
www/
  index.html
  css/     tokens.css  base.css  chat.css  home.css
  js/
    main.js   platform.js   state.js
    api/     kobold.js  prompt.js
    cards/   parse.js  avatar.js  import.js
    ui/      shell.js  setup.js  home.js  settings.js  chat.js  format.js
  dev/       design-preview.html
tests/       *.test.mjs   (node:test, sin dependencias)
docs/        CONTRACTS.md  DESIGN.md
```

| Módulo | Archivos que crea |
|---|---|
| 01 Diseño | `www/css/tokens.css`, `www/css/base.css`, `www/dev/design-preview.html`, `docs/DESIGN.md` |
| 02 Shell y plataforma | `www/index.html`, `www/js/main.js`, `www/js/ui/shell.js`, `www/js/platform.js` |
| 03 Datos | `www/js/state.js`, `www/js/cards/parse.js`, `www/js/cards/avatar.js`, `www/js/cards/import.js`, `tests/cards.test.mjs`, `tests/state.test.mjs` |
| 04 Motor | `www/js/api/kobold.js`, `www/js/api/prompt.js`, `tests/prompt.test.mjs`, `tests/kobold.test.mjs` |
| 05 Chat | `www/js/ui/chat.js`, `www/js/ui/format.js`, `www/css/chat.css`, `tests/format.test.mjs` |
| 06 Inicio, setup y ajustes | `www/js/ui/setup.js`, `www/js/ui/home.js`, `www/js/ui/settings.js`, `www/css/home.css` |

Los imports son ESM relativos y siempre con extensión `.js`. Los tests importan desde `../www/js/...`. Los nombres de archivo (sin ruta) son únicos en todo el proyecto.

## 4. Tipos de datos (los mismos en todo el proyecto)

```js
/**
 * @typedef {Object} Card  Card normalizada: todos los campos siempre presentes.
 * @property {string} name
 * @property {string} description
 * @property {string} personality
 * @property {string} scenario
 * @property {string} first_mes
 * @property {string} mes_example
 * @property {string} system_prompt
 * @property {string} post_history_instructions
 * @property {string[]} alternate_greetings   // [] si no hay
 * @property {object|null} character_book     // lorebook crudo; hoy no se usa, pero NO se descarta
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name          // copia de card.name
 * @property {string} avatar        // data URL JPEG cuadrado, o '' si no hay imagen
 * @property {Card} card
 * @property {'none'|'mini'|'large'} avatarMode   // por defecto 'mini'
 * @property {number} created       // ms desde epoch
 * @property {number} updated       // ms; lo actualiza saveChat
 * @property {string} last          // vista previa del último mensaje (máx. 90 caracteres, sin asteriscos)
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'char'} role
 * @property {string} text          // texto crudo; los *asteriscos* se formatean solo al mostrar
 * @property {number} ts            // ms desde epoch
 */

/**
 * @typedef {Object} Settings
 * @property {string} url           // origen de KoboldCpp sin barra final, ej. 'http://100.75.55.22:5001'
 * @property {string} user          // nombre del usuario en el chat ('' => se usa "User")
 * @property {number} maxLen        // tokens máximos por respuesta, 60 a 500, por defecto 220
 * @property {number} temp          // temperatura, 0.3 a 1.4, por defecto 0.85
 * @property {'plain'|'chat'} mode  // 'plain' = texto simple (por defecto); 'chat' = plantilla del modelo vía /v1/chat/completions
 * @property {number} ctx           // contexto máximo del modelo; lo rellena connect(); por defecto 4096
 */
```

## 5. APIs públicas por módulo (firmas exactas)

### `www/js/state.js` (módulo 03). Todo es asíncrono

```js
getSettings(): Promise<Settings>                    // siempre con valores por defecto aplicados
saveSettings(patch: Partial<Settings>): Promise<Settings>
listCharacters(): Promise<Character[]>              // ordenados por `updated` descendente
getCharacter(id: string): Promise<Character|null>
saveCharacter(character: Character): Promise<Character>   // crea o actualiza; NO modifica `updated`
deleteCharacter(id: string): Promise<void>          // borra también su chat
getChat(id: string): Promise<Message[]|null>        // null si aún no existe chat
saveChat(id: string, messages: Message[]): Promise<void>  // además actualiza character.last y character.updated
exportBackup(): Promise<Blob>                       // JSON: { app:'companion', version:1, exported, settings, characters, chats }
importBackup(file: File|Blob): Promise<{ characters: number }>  // mezcla por id; NO pisa settings.url
newId(): string
```

### `www/js/cards/*` (módulo 03)

```js
// parse.js
readPngCard(buffer: ArrayBuffer): Promise<object|null>      // JSON crudo de la card o null si el PNG no trae card
normCard(json: object): Card
parseCardFile(file: File): Promise<{ card: Card, avatarBlob: Blob|null }>   // detecta PNG/JSON por contenido, no por extensión
// avatar.js
makeAvatar(blob: Blob, size?: number): Promise<string>      // data URL JPEG cuadrado (por defecto 384); '' si falla
// import.js
importCardFile(file: File): Promise<Character>              // parsea + avatar + saveCharacter. Lanza Error con mensaje en español
```

### `www/js/api/*` (módulo 04)

```js
// prompt.js: puro, sin DOM ni fetch
subMacros(text: string, charName: string, userName: string): string        // {{char}} <BOT> {{user}} <USER>
initialMessages(character: Character, settings: Settings, greetingIndex?: number): Message[]
   // greetingIndex 0 = card.first_mes (por defecto); i >= 1 = card.alternate_greetings[i-1]. Devuelve [] si no hay saludo.
buildPlainPrompt(card: Card, messages: Message[], settings: Settings): { prompt: string, stop: string[] }
buildChatMessages(card: Card, messages: Message[], settings: Settings): { messages: {role:'system'|'user'|'assistant', content:string}[], stop: string[] }
cleanReply(text: string, charName: string): string
trimPartial(text: string): string
// kobold.js: el ÚNICO lugar con fetch
normUrl(raw: string): string                                  // '' si no es válida; devuelve solo el origen (sin ruta ni barra final)
connect(rawUrl: string): Promise<{ url: string, model: string, ctx: number }>   // NO guarda nada. Lanza Error en español
generateReply(opts: {
  character: Character,
  messages: Message[],            // historial SIN la respuesta que se va a generar
  settings: Settings,
  signal?: AbortSignal,
  onToken?: (chunk: string) => void
}): Promise<{ text: string, truncated: boolean, aborted: boolean }>
   // Si `signal` aborta: pide al servidor detener la generación y RESUELVE con lo recibido (aborted:true). Nunca lanza por abort.
   // Otros fallos: lanza Error con `message` en español apto para mostrar tal cual y `code` ('INVALID_URL'|'NETWORK'|'MIXED_CONTENT'|'HTTP'|'SERVER').
```

### `www/js/ui/format.js` y `www/js/ui/settings.js` (módulos 05 y 06)

```js
// format.js
escapeHtml(text: string): string
formatMessage(text: string): string     // HTML seguro: *acción* => <em>, **x** => <strong>, \n => <br>; tolera un asterisco sin cerrar (streaming)
// settings.js
openSettings(app: AppApi): void         // abre la hoja de ajustes con app.openSheet
```

### `www/js/platform.js` (módulo 02). Única capa que se sustituirá por APIs nativas en la versión APK

```js
pickFiles(opts?: { multiple?: boolean }): Promise<File[]>   // [] si el usuario cancela. Usa <input type=file> SIN atributo `accept` (en Android, un accept con tipos de imagen abre la galería en vez del explorador de archivos)
saveBlob(blob: Blob, filename: string): Promise<void>       // descarga/guardado de un archivo
```

## 6. Contrato de vistas y de `AppApi`

`main.js` (módulo 02) crea el objeto `app` y lo pasa a cada vista:

```js
/**
 * @typedef {Object} AppApi
 * @property {(view:'setup'|'home'|'chat', params?:object, opts?:{replace?:boolean}) => void} navigate
 * @property {() => void} back                  // atrás del historial (el botón/gesto atrás de Android hace lo mismo)
 * @property {(text:string, ms?:number) => void} toast
 * @property {(node:HTMLElement) => void} openSheet     // muestra `node` dentro de la hoja inferior
 * @property {() => void} closeSheet
 * @property {(message:string, opts?:{confirmText?:string, cancelText?:string, danger?:boolean}) => Promise<boolean>} confirmDialog
 */
```

Cada vista (`ui/setup.js`, `ui/home.js`, `ui/chat.js`) exporta exactamente:

```js
export function init(root: HTMLElement, app: AppApi): void      // se llama UNA vez al arrancar; construye su DOM dentro de `root`
export async function show(params?: object): Promise<void>      // se llama cada vez que la vista pasa a estar activa
export function hide(): void                                    // se llama al salir de la vista (limpiar timers, abortar tareas)
```

Parámetros de `show`: `setup` y `home` no reciben; `chat` recibe `{ characterId: string }`.

## 7. Contrato de HTML y CSS

**Esqueleto de `index.html`** (exacto; lo escribe el módulo 02 y lo estilizan 01, 05 y 06):

```html
<div id="app" class="app">
  <section id="view-setup" class="view"></section>
  <section id="view-home"  class="view"></section>
  <section id="view-chat"  class="view"></section>
  <div id="sheet" class="sheet"><div id="sheet-card" class="sheet__card"></div></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</div>
```

Clases de estado: `.view.is-active`, `.sheet.is-open`, `.toast.is-visible`.
Orden de hojas de estilo: `tokens.css`, `base.css`, `chat.css`, `home.css`.
El módulo 02 mantiene actualizadas en `:root` las variables `--vh` (alto visible real, se reduce cuando aparece el teclado) y `--vt` (desplazamiento superior del viewport visual). `.app` las usa para que el cuadro de texto nunca quede tapado por el teclado. No uses `100vh` en ningún lado.

**Variables de `tokens.css`** (el módulo 01 puede afinar los valores, no los nombres):

```
--color-bg  --color-surface  --color-surface-2  --color-line  --color-text  --color-muted
--color-accent  --color-accent-2  --color-accent-soft  --color-danger  --color-ok  --color-overlay
--grad-user  --grad-avatar
--font
--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl
--radius-sm --radius-md --radius-lg --radius-pill
--space-1 --space-2 --space-3 --space-4 --space-5 --space-6
--dur-fast --dur
--sat --sab          (safe-area superior e inferior)
```

Valores de partida (del prototipo): fondo `#181924`, superficie `#20222f`, burbuja del personaje `#2d2f40` (`--color-surface-2`), línea `#383b52`, texto `#f3f3f8`, apagado `#9b9eb8`, acento `#8b1fe0` / `#a24cf2`, peligro `#f0566a`, ok `#6ee7a8`, burbuja del usuario `linear-gradient(135deg,#7a12d6,#9b3ff0)`, avatar por defecto `linear-gradient(135deg,#5b1fa8,#c04bd6)`, fuente Outfit.

**Clases base de `base.css`** (las puede usar cualquier módulo):

- Estructura: `.app`, `.view`, `.topbar` (con `.topbar__title`), `.scroll` (contenedor con `flex:1` y scroll vertical), `.footbar`.
- Controles: `.ib` (botón de icono 44 px con un `<svg>` de 24 px adentro), `.btn` (+ `.btn--ghost`, `.btn--danger`, `.btn--sm`), `.inp` (para `input`, `select` y `textarea`), `.field` (con `.field__label` y `.field__hint`), `.chip` (+ `.chip--ok`, `.chip--err`), `.spinner`.
- Contenido: `.av` (círculo con `<img>` o `<span>` con la inicial; tamaños `.av--sm` 36 px, `.av--md` 58 px, `.av--lg` 132 px), `.list-row` (con `.list-row__main`, `.list-row__title`, `.list-row__sub`), `.empty` (estado vacío), `.status` (+ `.status--ok`, `.status--err`).
- Capas: `.sheet`, `.sheet__card`, `.sheet__title`, `.menu-item` (+ `.menu-item--danger`), `.toast`.
- Además, `input[type=range]` y `select` con estilo propio sin necesidad de clase.

**Prefijos:** el CSS de cada módulo usa su propio prefijo y no redefine nada de `base.css`: `chat-` (en `chat.css`), `home-`, `setup-` y `settings-` (en `home.css`). Solo puede usar variables de `tokens.css` y clases de `base.css` listadas aquí.

## 8. Entrega

1. Crea cada archivo de "Tus archivos" con su ruta exacta y **completo**. Si tienes herramienta para crear archivos, créalos y preséntalos todos. Si no, entrega un bloque de código por archivo con la ruta como título.
2. Si puedes ejecutar código: ejecuta tus tests y comprueba la sintaxis de cada `.js` con `node --check`. Si no puedes, dilo con claridad y escribe los tests igualmente.
3. Cierra con **"Notas de integración"** (máximo 12 líneas): exports reales, supuestos, y cualquier desviación del contrato con el motivo.
4. No hagas preguntas antes de empezar. Si `companion.html` no está adjunto, avísalo en una línea y continúa guiándote por este contrato.
5. No crees ni modifiques archivos de otros módulos. El usuario está en un teléfono: tu mensaje final debe ser corto.
