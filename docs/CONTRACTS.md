# CONTRATOS COMPARTIDOS — Proyecto "Companion"

> **Actualizado el 2026-09-23 (DOC-001) contra el código real.** Este archivo
> nació como el contrato de los 6 módulos iniciales y quedó atrás; ahora sus
> §3 (árbol de archivos), §4 (typedefs), §5 (firmas de `state.js`, plataforma
> y motor), §6 (vistas) y §7 (HTML/tokens) reflejan el código actual. Las
> partes históricas que se conservan van marcadas "(histórico)". **Si algo
> aquí contradice al código, manda el código** y hay que corregir este
> archivo. Estado global del proyecto: `docs/NOTES.md`, "Estado vigente".

> Este bloque es idéntico en los 6 prompts del proyecto y es la única fuente de verdad. Otras instancias de IA construyen los demás módulos en paralelo, sin ver tu conversación. Si algo del contrato te parece mejorable, respétalo igual y anótalo en tus "Notas de integración". Nunca cambies nombres, firmas ni formas de datos por tu cuenta.

## 1. Qué es el proyecto

App móvil de chat estilo "AI companion" (referencia visual: Nomi AI; oscura, morada, limpia) para hablar con personajes de roleplay usando un servidor **KoboldCpp propio del usuario**, accesible por red privada (Tailscale, por ejemplo `http://100.x.x.x:5001`, siempre http, nunca https). El usuario pega la URL, carga una character card (PNG o JSON, formato Tavern V1/V2/V3) y chatea. Todo corre en el cliente; no hay backend propio.

Hoy se abre desde `http://localhost` y más adelante se empaquetará como APK de Android con Capacitor (WebView de Chromium). El usuario usa **solo un teléfono Android**.

Existe un **prototipo funcional en un solo archivo, `companion.html`**, que el usuario adjunta a tu conversación. Es tu referencia de comportamiento y de estilo: contiene lógica ya probada (lectura de cards PNG, streaming SSE, armado de prompt, manejo del teclado en móvil). NO es la estructura final: ahora todo se divide en módulos. Copia su comportamiento, no su organización.

## 2. Reglas técnicas para todos los módulos

- JavaScript vanilla con módulos ES (`<script type="module">`). Sin npm, sin bundler, sin frameworks, sin librerías externas. Única dependencia externa permitida: Google Fonts (Literata — cambiada desde Outfit el 2026-09-23, ver `docs/NOTES.md`; el skin iMessage usa la fuente del sistema en su lugar, sin dependencia externa) enlazada desde `index.html`.
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

Árbol **actual** (2026-09-23):

```
www/
  index.html
  css/     tokens.css  base.css  chat.css  home.css  themes.css
  js/
    main.js   platform.js   state.js   lock.js   images.js   version.js
    api/     kobold.js  prompt.js  lorebook.js
    cards/   parse.js  avatar.js  import.js
    ui/      shell.js  setup.js  home.js  chats.js  chat.js  settings.js
             lock.js  appearance.js  chat-background.js  format.js
  dev/       design-preview.html
tests/       cards  format  kobold  lock  lorebook  prompt  state  (*.test.mjs, node:test)
docs/        CONTRACTS.md  DESIGN.md  NOTES.md  CONTRACT-*.md  examples/
.github/workflows/build-apk.yml      capacitor.config.json      package.json
```

Notas: `js/lock.js` (raíz, hash de PIN, puro) y `js/ui/lock.js` (pantalla) son
dos archivos distintos aunque el contrato dice que los nombres de archivo son
únicos — esa regla del contrato original ya no se cumple para `lock.js`.
`android/` no está versionado (lo genera el workflow). `theme-glass.css` ya
no existe (lo reemplazó `themes.css`).

Reparto original por módulo (histórico; los archivos posteriores no tienen un
"módulo" asignado):

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
 * @typedef {Object} LoreEntry  Lorebook automático (adenda, ver docs/NOTES.md "Lorebook por personaje" y www/js/api/lorebook.js).
 * @property {string} id
 * @property {string[]} keys        // palabras/frases que activan esta entrada
 * @property {string} content       // el hecho en sí, en texto plano, conciso
 * @property {number} updated       // ms desde epoch
 * @property {'auto'|'manual'} source  // 'auto' = generado por el lorebook automático
 */

/**
 * @typedef {Object} Character
 * @property {string} id
 * @property {string} name          // copia de card.name
 * @property {string} avatar        // data URL JPEG cuadrado, o '' si no hay imagen
 * @property {Card} card
 * @property {'none'|'mini'|'large'} avatarMode   // por defecto 'mini'
 * @property {number} created       // ms desde epoch
 * @property {LoreEntry[]} lorebook // memoria de largo plazo, compartida entre todos los chats de este personaje (por personaje, no por chat: docs/NOTES.md)
 * @property {LoreEntry[]} lorebookPrevious   // MEM-001 v2: copia del lorebook justo antes de la última actualización de memoria (un solo nivel de "Deshacer"); [] por defecto
 * @property {number} lorebookPreviousAt      // MEM-001 v2: cuándo se guardó esa copia (ms); 0 = no hay nada que deshacer (distingue "sin copia" de "el lorebook estaba vacío")
 * @property {string} chatBackground            // data URL JPEG del fondo de SUS chats, '' si no hay
 * @property {number} chatBackgroundBrightness  // 20 a 180 (%), 100 = sin cambios
 * @property {boolean} chatBackgroundFade       // fundido a negro en la mitad inferior
 * @property {'fill'|'stretch'} chatBackgroundFit // 'fill' cubre y recorta; 'stretch' deforma sin recortar
 *
 * Campos NO declarados en el typedef de state.js pero presentes en la práctica:
 * `updated` (ms) y `last` (string) los escribe cards/import.js al importar una
 * card; NADIE los mantiene después (saveChatMessages ya no toca al personaje).
 * `listCharacters()` ordena por `updated` descendente, o sea, por fecha de
 * importación. La vista previa del hub sale de `Chat.last`, no de `Character.last`.
 * `sanitizeCharacterExtras()` solo valida `lorebook` y `chatBackground*`; el resto
 * del objeto se guarda tal cual.
 */

/**
 * @typedef {Object} Chat  Store `chatMeta` (los mensajes van aparte, en `chatMsgs`). Adenda multi-chat.
 * @property {string} id
 * @property {string} characterId
 * @property {string} title         // '' => la UI muestra la fecha de creación
 * @property {string} scenario      // se suma al scenario de la card, nunca lo reemplaza
 * @property {number} created
 * @property {number} updated       // lo actualiza saveChatMessages
 * @property {string} last          // vista previa del último mensaje del chat (máx. 90 caracteres, sin asteriscos)
 * @property {number} lastExportAt  // ms del último respaldo automático de este chat (0 = nunca)
 * @property {number} lorebookMessageCount  // nº de mensajes de ESTE chat ya usados para actualizar el lorebook del personaje (marcador; no guarda entradas)
 */

/**
 * @typedef {Object} Message
 * @property {'user'|'char'} role
 * @property {string} text          // texto crudo; los *asteriscos* se formatean solo al mostrar
 * @property {number} ts            // ms desde epoch
 */

/**
 * @typedef {Object} Settings  Un único registro (store `settings`, clave 'main').
 * @property {string} url           // origen de KoboldCpp sin barra final, ej. 'http://100.x.x.x:5001'
 * @property {string} user          // nombre del usuario en el chat ('' => se usa "User")
 * @property {number} maxLen        // tokens máximos por respuesta, 60 a 500, por defecto 220
 * @property {number} temp          // temperatura, 0.3 a 1.4, por defecto 0.85
 * @property {'plain'|'chat'} mode  // 'chat' = plantilla del modelo vía /v1/chat/completions (POR DEFECTO); 'plain' = texto simple
 * @property {number} ctx           // contexto máximo del modelo; lo rellena connect(); 512 a 200000, por defecto 4096
 * @property {string} pinSalt       // '' si el bloqueo con PIN está desactivado
 * @property {string} pinHash       // '' si está desactivado; SHA-256 salteado (ver www/js/lock.js)
 * @property {'nomi'|'glass'|'imessage'} theme  // skin visual (www/css/themes.css), por defecto 'nomi'
 * @property {'dark'|'light'} themeMode         // claro/oscuro, aplica a cualquier skin, por defecto 'dark'
 *
 * Los antiguos `chatBackground*` YA NO están en Settings (pasaron a Character).
 */
```

## 5. APIs públicas por módulo (firmas exactas)

### `www/js/state.js` (módulo 03). Todo es asíncrono

Firmas reales exportadas (2026-09-23). IndexedDB `companion` v2, stores `settings`,
`characters`, `chats` (legado, solo lectura para migrar), `chatMeta`, `chatMsgs`.
`createState(backend)` permite un backend en memoria para tests.

```js
getSettings(): Promise<Settings>                    // siempre con valores por defecto aplicados y saneados
saveSettings(patch: Partial<Settings>): Promise<Settings>   // merge parcial
listCharacters(): Promise<Character[]>              // ordenados por `updated` desc; carga TODOS los objetos completos (avatar y fondo incluidos)
getCharacter(id: string): Promise<Character|null>
saveCharacter(character: Character): Promise<Character>   // put del objeto ENTERO tal cual (sin validar más que el id); NO modifica `updated`
saveCharacterLorebook(characterId: string, lorebook: LoreEntry[], previous?: LoreEntry[]|null): Promise<Character>
   // Relee el personaje al guardar y modifica SOLO `lorebook`, `lorebookPrevious` y `lorebookPreviousAt` (no pisa avatar/fondo).
   // `previous`: arreglo = guarda esa copia para "Deshacer" (con la hora actual); null = la borra; undefined = la deja como estaba.
saveCharacterBackground(characterId: string, patch: Partial<Pick<Character,'chatBackground'|'chatBackgroundBrightness'|'chatBackgroundFade'|'chatBackgroundFit'>>): Promise<Character>  // merge parcial, relee al guardar
deleteCharacter(id: string): Promise<void>          // transacción atómica: borra el personaje y TODOS sus chats (chatMeta + chatMsgs) y el chat legado
listChats(characterId: string): Promise<Chat[]>     // por `updated` desc
getChat(chatId: string): Promise<Chat|null>         // metadatos
getChatMessages(chatId: string): Promise<Message[]|null>   // null si el chat aún no tiene mensajes guardados
saveChatMessages(chatId: string, messages: Message[]): Promise<void>  // transacción atómica: mensajes + meta (last, updated)
createChat(characterId: string, opts?: { title?: string, scenario?: string }): Promise<Chat>
renameChat(chatId: string, title: string): Promise<Chat>
markChatExported(chatId: string): Promise<Chat>     // fija lastExportAt = ahora (respaldo automático)
markChatLorebookProgress(chatId: string, count: number): Promise<Chat>
deleteChat(chatId: string): Promise<void>
migrateLegacyChats(): Promise<void>                 // convierte el chat único viejo de cada personaje; idempotente; se llama al arrancar (main.js)
exportBackup(): Promise<Blob>                       // JSON: { app:'companion', version:2, exported, settings, characters, chats:{[chatId]:Chat}, chatMessages:{[chatId]:Message[]} }; incluye pinSalt/pinHash dentro de settings
importBackup(file: File|Blob): Promise<{ characters: number }>  // el ARCHIVO GANA por id (personajes, chatMeta, chatMsgs) sin comparar fechas ni avisar; NO restaura settings (ni url, ni user, ni PIN, ni tema); acepta v2 y v1; requiere `characters` como array
newId(): string
```

`getChat`/`saveChat` **por personaje** (contrato original, `Message[]` por `id` de
personaje) ya no existen: se reemplazaron por el modelo `Chat` (adenda
multi-chat, `docs/NOTES.md`). `saveChat` ya no actualiza `character.last` ni
`character.updated`.

**Otros formatos de archivo que produce la app** (no son un "backup" de
`importBackup`): el log de un chat (`chatExportBlob()` en `ui/chat.js`) es
`{ app:'companion', kind:'chat-log', version:2, exported, character:{id,name}, chat:{id,title,scenario}, messages }`
y solo lo lee el menú del chat, "Importar chat" (`onImportChat`), que únicamente
usa `messages`. Es también el formato del respaldo automático.

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
buildPlainPrompt(card: Card, messages: Message[], settings: Settings, chatScenario?: string, loreBlock?: string): { prompt: string, stop: string[] }
buildChatMessages(card: Card, messages: Message[], settings: Settings, chatScenario?: string, loreBlock?: string): { messages: {role:'system'|'user'|'assistant', content:string}[], stop: string[] }
   // `chatScenario` (adenda multi-chat) y `loreBlock` (adenda lorebook, ver docs/NOTES.md
   // "Lorebook por personaje" y api/lorebook.js) son desviaciones sobre la firma original de
   // este contrato — ambos opcionales, '' por defecto. `loreBlock` ya viene armado
   // (formatLoreBlock) con las entradas seleccionadas.
scenarioGreeting(character: Character, settings: Settings, chatScenario: string): Message[]   // nota de escenario en *asteriscos* como primer mensaje de un chat con escenario propio
estimateContextUsage(card: Card, messages: Message[], settings: Settings, chatScenario?: string, loreBlock?: string): { approxTokens: number, budgetTokens: number, ratio: number }
cleanReply(text: string, charName: string): string
trimPartial(text: string): string
// kobold.js: el ÚNICO lugar con fetch
normUrl(raw: string): string                                  // '' si no es válida; devuelve solo el origen (sin ruta ni barra final)
connect(rawUrl: string): Promise<{ url: string, model: string, ctx: number }>   // NO guarda nada. Lanza Error en español
generateReply(opts: {
  character: Character,            // adenda lorebook: se lee `character.lorebook` (compartido entre chats), no `chat.lorebook`
  chat?: Chat,                     // adenda multi-chat: trae `scenario`
  messages: Message[],            // historial SIN la respuesta que se va a generar
  settings: Settings,
  signal?: AbortSignal,
  onToken?: (chunk: string) => void
}): Promise<{ text: string, truncated: boolean, aborted: boolean }>
   // Si `signal` aborta: pide al servidor detener la generación y RESUELVE con lo recibido (aborted:true). Nunca lanza por abort.
   // Otros fallos: lanza Error con `message` en español apto para mostrar tal cual y `code` ('INVALID_URL'|'NETWORK'|'MIXED_CONTENT'|'HTTP'|'SERVER').
completeOnce(prompt: string, settings: Settings, opts?: { temp?: number, maxLen?: number, signal?: AbortSignal, genkey?: string }): Promise<string>
   // Adenda lorebook (docs/NOTES.md "Lorebook por personaje"): completado de una sola vez sin
   // streaming contra /api/v1/generate, para la extracción de lorebook. Mismos códigos de error
   // que generateReply(), más `'ABORTED'` (MEM-001 v2) cuando `signal` cancela la llamada; con `genkey`
   // además se le pide al servidor cortar la generación (POST /api/extra/abort).

// lorebook.js (adenda, ver docs/NOTES.md "Lorebook por personaje"): puro, sin DOM ni fetch
// MEM-001 v2: extracción ADITIVA, una línea, hasta 3 entradas, compatible con el servidor real (docs/NOTES.md, "MEM-001 v2").
shouldUpdateLorebook(chat: Chat, messageCount: number): boolean   // dispara por chat (cada LOREBOOK_UPDATE_EVERY_MESSAGES = 20); el lorebook resultante se guarda en el personaje
buildExtractionPrompt(character: Character, settings: Settings, windowMessages: Message[], existingEntries?: LoreEntry[]): string
   // Ventana = últimos ≤20 mensajes, recortados desde el más antiguo para caber en settings.ctx; solo lleva las KEYS existentes;
   // termina en LOREBOOK_EXTRACT_PREFILL ('['): quien llama debe anteponerlo a la respuesta antes de parsear.
fitExtractionWindow(lines: string[], budgetChars: number): string[]
parseExtractionResponse(rawText: string): { keys: any, content: any }[]|null
   // Acepta arreglo en una línea, {"entries":[…]}, objeto suelto, campos k/c o keys/content, keys sin comillas, y RESCATA los
   // objetos completos de un arreglo truncado. [] = "sin novedades" (devuelve []); no reconocible = null. Nunca lanza.
applyExtraction(previousEntries: LoreEntry[], incomingEntries: object[], opts?: { now?: number, ignoreKeys?: string[] }): { entries: LoreEntry[], added: number, updated: number, changed: boolean }
   // Pura y aditiva: agrega; actualiza una `auto` que comparte key Y habla de lo mismo (≥50 % de palabras); NUNCA elimina ni
   // modifica `manual`; solo descarta `auto` antiguas al pasar LOREBOOK_MAX_ENTRIES.
parseKeysInput(text: string): string[]
editLoreEntry(entries: LoreEntry[], id: string, patch: { content: string, keys: string[] }, now?: number): LoreEntry[]|null   // la entrada pasa a source:'manual'
removeLoreEntry(entries: LoreEntry[], id: string): LoreEntry[]
createLoreUpdater(deps): { maybeRun(), runNow(), abort(), isRunning(), getStatus() }
   // Actualizador con dependencias inyectables (probado sin DOM ni red). maybeRun() = automático (no arranca con el chat ocupado);
   // runNow() = "Actualizar memoria ahora"; abort() = el usuario envió un mensaje. Resultado: { kind: ok|nochange|unparsed|unavailable|
   // aborted|error|skipped|busy|toolittle, added?, updated? }.
selectLoreEntries(entries: LoreEntry[], recentMessages: Message[], opts?: { scanCount?: number, charBudget?: number }): LoreEntry[]
formatLoreBlock(entries: LoreEntry[]): string
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
saveBlob(blob: Blob, filename: string): Promise<{ savedToDevice: boolean }>   // APK: Filesystem.writeFile en Directory.DOCUMENTS + panel Compartir opcional (savedToDevice:true); navegador: <a download> (false). Puede lanzar Error en español.
autoBackupBlob(blob: Blob, filename: string): Promise<boolean>   // respaldo silencioso: solo APK, escribe en Documents/Companion-backups/<filename>; nunca lanza; false si no pudo o si no es APK
```

Otros módulos sin contrato original: `www/js/lock.js` (`createPinHash(pin)`,
`verifyPin(pin, salt, hash)`; SHA-256 salteado, una sola pasada), `www/js/images.js`
(`resizeImageToDataUrl(blob, maxDim=1280, quality=0.82)`, `averageColorFromDataUrl(dataUrl)`),
`www/js/version.js` (`APP_VERSION`).

UI adicional: `ui/settings.js` → `openSettings(app)`; `ui/appearance.js` →
`openAppearance(app)` (skin + modo claro/oscuro, global); `ui/chat-background.js` →
`openChatBackground(app, character)` (fondo del personaje). `ui/shell.js` exporta
además `applyTheme`, `applyThemeMode`, `setGlassTint`.

## 6. Contrato de vistas y de `AppApi`

`main.js` (módulo 02) crea el objeto `app` y lo pasa a cada vista:

```js
/**
 * @typedef {Object} AppApi
 * @property {(view:'setup'|'home'|'chats'|'chat', params?:object, opts?:{replace?:boolean}) => void} navigate
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

Parámetros de `show`: `setup` y `home` no reciben; `chats` recibe `{ characterId: string }`
(si el personaje no tiene chats, crea uno y entra directo); `chat` recibe `{ chatId: string }`
(ya NO `{ characterId }`: ese era el contrato original, previo a la adenda multi-chat).
Flujo: `home` → `chats` → `chat`.

Vista `lock` (PIN): existe como sección `#view-lock` y en `VIEW_NAMES` de `shell.js`, pero
**no es una vista navegable**: `main.js` no la registra en `views` ni la acepta `navigate`.
`ui/lock.js` exporta `init(root)` y `show({ salt, hash }): Promise<void>` (no resuelve hasta
que se ingresa el PIN correcto; no tiene `hide`) y se muestra una sola vez al arrancar, antes
de elegir la vista inicial (`setup` si no hay `settings.url`, si no `home`).

## 7. Contrato de HTML y CSS

**Esqueleto de `index.html`** (actual):

```html
<div id="app" class="app">
  <section id="view-lock"  class="view"></section>
  <section id="view-setup" class="view"></section>
  <section id="view-home"  class="view"></section>
  <section id="view-chats" class="view"></section>
  <section id="view-chat"  class="view"></section>
  <div id="sheet" class="sheet"><div id="sheet-card" class="sheet__card"></div></div>
  <div id="toast" class="toast" role="status" aria-live="polite"></div>
</div>
```

Clases de estado: `.view.is-active`, `.sheet.is-open`, `.toast.is-visible`.
Orden de hojas de estilo: `tokens.css`, `base.css`, `chat.css`, `home.css`, `themes.css`.
`<html>` lleva `data-theme` y `data-mode` (los pone `ui/shell.js`); `themes.css` define
un bloque completo por cada combinación skin+modo. Los componentes no conocen los skins:
solo leen tokens (ver `docs/NOTES.md`, "Rearquitectura del sistema de skins").
El módulo 02 mantiene actualizadas en `:root` las variables `--vh` (alto visible real, se reduce cuando aparece el teclado) y `--vt` (desplazamiento superior del viewport visual). `.app` las usa para que el cuadro de texto nunca quede tapado por el teclado. No uses `100vh` en ningún lado.

**Variables de `tokens.css`** (el módulo 01 puede afinar los valores, no los nombres):

```
--color-bg  --color-surface  --color-surface-2  --color-line  --color-text  --color-muted
--color-accent  --color-accent-2  --color-accent-soft  --color-danger  --color-ok  --color-overlay
--grad-user  --grad-avatar  --color-muted-on-accent
--surface-blur  --app-bg  --glass-tint-rgb     (materiales de skin; ver docs/DESIGN.md)
--font
--fs-xs --fs-sm --fs-md --fs-lg --fs-xl --fs-2xl --fs-3xl
--radius-sm --radius-md --radius-lg --radius-pill
--space-1 --space-2 --space-3 --space-4 --space-5 --space-6
--dur-fast --dur
--sat --sab          (safe-area superior e inferior)
```

Valores de partida (del prototipo): fondo `#181924`, superficie `#20222f`, burbuja del personaje `#2d2f40` (`--color-surface-2`), línea `#383b52`, texto `#f3f3f8`, apagado `#9b9eb8`, acento `#8b1fe0` / `#a24cf2`, peligro `#f0566a`, ok `#6ee7a8`, burbuja del usuario `linear-gradient(135deg,#7a12d6,#9b3ff0)`, avatar por defecto `linear-gradient(135deg,#5b1fa8,#c04bd6)`, fuente Outfit (reemplazada por Literata, ver `docs/NOTES.md`).

**Clases base de `base.css`** (las puede usar cualquier módulo):

- Estructura: `.app`, `.view`, `.topbar` (con `.topbar__title`), `.scroll` (contenedor con `flex:1` y scroll vertical), `.footbar`.
- Controles: `.ib` (botón de icono 44 px con un `<svg>` de 24 px adentro), `.btn` (+ `.btn--ghost`, `.btn--danger`, `.btn--sm`), `.inp` (para `input`, `select` y `textarea`), `.field` (con `.field__label` y `.field__hint`), `.chip` (+ `.chip--ok`, `.chip--err`), `.spinner`.
- Contenido: `.av` (círculo con `<img>` o `<span>` con la inicial; tamaños `.av--sm` 36 px, `.av--md` 58 px, `.av--lg` 132 px), `.list-row` (con `.list-row__main`, `.list-row__title`, `.list-row__sub`), `.empty` (estado vacío), `.status` (+ `.status--ok`, `.status--err`).
- Capas: `.sheet`, `.sheet__card`, `.sheet__title`, `.menu-item` (+ `.menu-item--danger`), `.toast`.
- Además, `input[type=range]` y `select` con estilo propio sin necesidad de clase.

**Prefijos:** el CSS de cada módulo usa su propio prefijo y no redefine nada de `base.css`: `chat-` (en `chat.css`), `home-`, `setup-`, `settings-` y `appearance-` (en `home.css`). Solo puede usar variables de `tokens.css` y clases de `base.css` listadas aquí.

## 8. Entrega

1. Crea cada archivo de "Tus archivos" con su ruta exacta y **completo**. Si tienes herramienta para crear archivos, créalos y preséntalos todos. Si no, entrega un bloque de código por archivo con la ruta como título.
2. Si puedes ejecutar código: ejecuta tus tests y comprueba la sintaxis de cada `.js` con `node --check`. Si no puedes, dilo con claridad y escribe los tests igualmente.
3. Cierra con **"Notas de integración"** (máximo 12 líneas): exports reales, supuestos, y cualquier desviación del contrato con el motivo.
4. No hagas preguntas antes de empezar. Si `companion.html` no está adjunto, avísalo en una línea y continúa guiándote por este contrato.
5. No crees ni modifiques archivos de otros módulos. El usuario está en un teléfono: tu mensaje final debe ser corto.
