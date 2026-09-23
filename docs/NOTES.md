# NOTES.md — Estado del proyecto (actualizado)

Este archivo es el punto de partida para retomar el proyecto en una nueva
sesión (incluida una sesión de Claude Code). `CONTRACTS.md` sigue siendo el
contrato original de los 6 módulos base, pero **quedó parcialmente superado**
por la adenda multi-chat descrita más abajo — en caso de duda, este archivo
y el código mandan sobre `CONTRACTS.md`.

> **Si sos una instancia nueva de Claude Code retomando este proyecto**,
> empezá por `docs/CONTRACT-HANDOFF.md` — es el briefing completo de
> continuidad (rol, cómo trabajar con el usuario, estado real del
> repositorio git y por qué importa, roadmap). Si tu tarea puntual es el
> sistema de memoria/lorebook automático, el encargo detallado está en
> `docs/CONTRACT-LOREBOOK.md`.

## Línea de tiempo resumida

1. **Ensamblado inicial** de los 6 módulos (diseño, shell/plataforma, datos,
   motor, chat, inicio/setup/ajustes) según `CONTRACTS.md`. Sin desajustes
   entre módulos; 74/74 tests pasando.
2. **Empaquetado como APK** con Capacitor + GitHub Actions
   (`.github/workflows/build-apk.yml` compila un APK de depuración en cada
   push y lo deja como artifact descargable).
3. **Bugs reales encontrados usando la app** y corregidos:
   - *Ajustes no abría desde el menú del chat*: carrera entre `closeSheet()`
     seguido de `openSheet()` en el mismo tick contra el manejo asíncrono del
     historial (`history.back()`) en `main.js`. Se corrigió quitando los
     `closeSheet()` redundantes antes de abrir otra hoja (`chat.js`,
     función `onMenu`).
   - *Avatar duplicado en modo "large"*: `chat.js` mostraba el mini-avatar
     de la cabecera en todos los modos salvo `none`; ahora solo se muestra
     en modo `mini`.
   - *Texto entre asteriscos casi invisible*: en `chat.css`, el color del
     texto en cursiva (`em`) de las burbujas de usuario terminó casi
     idéntico al color del texto normal. Ahora usa un dorado/durazno
     (`#ffd9a0`) bien diferenciado, con una regla directa de respaldo
     (`.chat-row--user .chat-bubble em`) además de la variable
     `--em-color`, por si el navegador tiene algún problema heredando la
     variable CSS.
   - *`capacitor.config.json`*: `androidScheme` tiene que ser `"http"`, no
     `"https"` — la app habla con un servidor KoboldCpp propio en `http://`,
     y si la propia app carga como `https://` el navegador bloquea la
     conexión por contenido mixto.
4. **Features agregados** (no estaban en el contrato original de los 6
   módulos, se pidieron después de probar la app):
   - Subir un avatar manual a un personaje (útil para cards `.json` sin
     imagen incrustada): menú del chat (⋮) → "Cambiar avatar".
   - Exportar/importar el log de un chat como `.json`: menú del chat (⋮) →
     "Exportar este chat" / "Importar chat".
   - Grilla del hub de personajes: se ajustó de 2 a 3 columnas en
     `home.css` (2 columnas se veía "gigante" en celular).

## Adenda grande: varios chats por personaje

Cambio de estructura importante, documentado originalmente en
`09-adenda-multi-chat-por-personaje.md` (puede que ya no esté adjunto, pero
está totalmente implementado). Resumen de lo que cambió:

- **Nueva entidad `Chat`** (`www/js/state.js`): un personaje puede tener
  varios chats, cada uno con su propio `id`, `title`, `scenario` (se suma
  al `scenario` de la character card, nunca lo reemplaza), `last`,
  `created`/`updated`.
- **`state.js`**: `getChat`/`saveChat` (por `characterId`) fueron
  **reemplazados** por `listChats`, `getChat` (por `chatId`),
  `getChatMessages`, `saveChatMessages`, `createChat`, `renameChat`,
  `deleteChat`. `deleteCharacter` ahora borra también todos los chats del
  personaje. `migrateLegacyChats()` convierte automáticamente el chat único
  viejo de cada personaje (si existe) al nuevo formato, con el mismo `id`
  que el personaje; se llama una sola vez al arrancar (`main.js`, antes de
  mostrar cualquier vista) y es segura de correr más de una vez.
- **`prompt.js` / `kobold.js`**: `buildPlainPrompt`/`buildChatMessages`
  ahora reciben un 4º parámetro `chatScenario` (string). `generateReply`
  recibe `chat` además de `character`.
- **Pantalla nueva `www/js/ui/chats.js`**: lista los chats de un personaje
  (título, preview, fecha), con botón "+ Nuevo chat en este escenario"
  (título + escenario opcionales). Si el personaje no tiene chats todavía,
  crea uno automáticamente y entra directo (sin paso extra en el caso
  normal). Reutiliza clases ya existentes de `base.css`
  (`.list-row`, `.field`, `.empty`, etc.) — no se creó CSS nuevo.
- **Navegación** (`main.js`/`AppApi.navigate`): vista nueva `'chats'`.
  `home.js` ahora navega a `chats` (no a `chat`) al tocar un personaje, y
  su preview usa el `last` del chat más reciente de cada personaje
  (`listChats`), no un campo `character.last` (ese campo ya no se
  mantiene). `chat.js` ahora recibe `{ chatId }` en vez de
  `{ characterId }`, y su menú tiene "Volver a los chats de este
  personaje" en vez de "Empezar chat nuevo".
- **Backups**: `exportBackup`/`importBackup` usan un formato v2 (con
  `chats` + `chatMessages` separados), pero `importBackup` todavía acepta
  copias de seguridad viejas en formato v1.

## Cómo verificar que todo sigue sano

```
node --test tests/*.test.mjs
```

88 tests debería ser el número actual (22 de `state.test.mjs` cubriendo
chats/migración/backups, 24 de `prompt.test.mjs` incluyendo el escenario
del chat, más los de `format`/`cards`/`kobold`). Si alguien toca
`state.js`, `chat.js`, `chats.js`, `home.js` o `prompt.js`, correr esto
primero.

## Bug crítico corregido: exportar chats/backup no hacía nada en el APK

El usuario perdió conversaciones varias veces por esto. Causa: `saveBlob()`
(`www/js/platform.js`) usaba un `<a download>` con un `blob:` URL — funciona
en un navegador de escritorio, pero en el WebView de Android de Capacitor el
clic no dispara ninguna descarga real y **no lanza ningún error** (falla en
silencio). Importar sí funcionaba porque usa `<input type=file>`, que el
WebView sí soporta bien.

Arreglo: `saveBlob()` ahora detecta si corre dentro de la app nativa
(`window.Capacitor?.isNativePlatform()`). Si es así, en vez del truco del
link, escribe el archivo con el plugin nativo `Filesystem` y abre el panel
nativo "Compartir" (`Share`) para que el usuario elija dónde guardarlo
(Drive, Archivos, etc.) — es el único camino confiable en Android sin pedir
permisos de almacenamiento. Fuera de la app nativa (navegador normal) se
sigue usando el `<a download>` de siempre. Requiere dos plugins nuevos que
ya están en `package.json`: `@capacitor/filesystem` y `@capacitor/share`
(`npx cap sync android` los instala solos en el próximo build del workflow,
no hace falta tocar `build-apk.yml`).

No se pudo probar de punta a punta contra un APK real en esta sesión (sin
teléfono conectado); se verificó código y sintaxis, y que los 88 tests
existentes (que no cubren `platform.js`, es DOM-dependiente) siguen
pasando. **Recomendado probar exportar un chat en el próximo APK antes de
confiar en él para no perder conversaciones.**

## Reorganización de Git (2026-09-22)

El repositorio de git de este proyecto había quedado accidentalmente
enganchado a la carpeta personal completa del usuario (`/home/edgar`) en vez
de a esta carpeta, mezclando commits con archivos de la Papelera de
reciclaje. Se reemplazó por un repositorio nuevo y limpio, con historial
propio, viviendo solo dentro de `Documentos/companion/`, y se sobrescribió
`stvedgar-design/companion` en GitHub con el estado actual (el remoto sólo
tenía la primera versión, sin ninguno de los arreglos de este archivo).

## Ronda de feedback tras probar el APK (2026-09-22)

El usuario probó la APK con el fix de exportación y reportó varias cosas
más, todas ya corregidas:

- **Hub de personajes rediseñado (dos iteraciones)**: la grilla original de
  3 columnas con recuadros grandes se veía "enorme". Primero se probó una
  lista vertical tipo `.list-row` (mismo patrón que `chats.js`) — mejor en
  tamaño, pero el usuario la vio con demasiado texto en pantalla y pidió
  algo más visual, tipo el hub de Nomi AI (tarjetas grandes con foto,
  nombre y preview superpuestos, botón "Continuar"). Versión final: grilla
  de **2 columnas** (`.home-grid`/`.home-card` en `home.css`), cada tarjeta
  con la imagen del personaje en `aspect-ratio: 3/4`, un degradado
  (`.home-card__scrim`) con nombre + preview del último mensaje superpuesto
  sobre la imagen (legible encima de cualquier foto), y debajo un botón
  "Continuar" (`.btn--sm`) + ícono de borrar. Sin avatar cargado, se
  muestra la inicial centrada sobre el fondo `--grad-avatar` en vez de una
  imagen.
- **Exportar ahora guarda directo en el teléfono**: `saveBlobNative()`
  escribía en `Directory.CACHE` (carpeta privada de la app, invisible fuera
  de compartir); ahora escribe en `Directory.DOCUMENTS` (carpeta pública,
  visible en cualquier explorador de archivos) y el panel "Compartir" queda
  como atajo opcional que no bloquea si falla. `saveBlob()` devuelve
  `{ savedToDevice }` y `chat.js`/`settings.js` muestran un toast
  confirmando dónde quedó guardado.
- **Nota de escenario en vez de saludo por defecto**: si un chat nuevo
  tiene `chat.scenario` propio, ya no se usa `card.first_mes` (escrito para
  el escenario original de la card, casi nunca encaja) como primer mensaje.
  Nueva función pura `scenarioGreeting()` en `prompt.js` arma en su lugar
  una nota entre asteriscos con el propio escenario (ej.
  `*(A rainy train station at midnight...)*`), que `chat.js` usa solo al
  crear el chat por primera vez (no al usar "Cambiar saludo" a mano, que
  sigue trayendo el `first_mes`/saludos alternativos literales de la card).
- **Campo de escenario nuevo con guía y límite**: en `chats.js`, el
  `<textarea>` de escenario al crear un chat ahora tiene `placeholder` en
  inglés avisando que conviene escribirlo en ese idioma, `maxlength="500"`
  y un contador `n/500` en vivo (constante `SCENARIO_MAX`), para no inflar
  el prompt/tokens de cada mensaje.
- **Renombrar chats desde la lista**: `chats.js` ya tenía disponible
  `renameChat()` en `state.js` pero sin UI. Se agregó un botón de lápiz por
  fila (junto al de borrar) que abre una hoja con un campo de texto y
  guarda con `renameChat()`.

Tests: se agregaron 2 tests para `scenarioGreeting()` en
`prompt.test.mjs` (90 tests en total ahora). El resto de los cambios de
esta ronda son de UI/DOM (`home.js`, `chats.js`, `platform.js`), sin tests
automáticos por ser dependientes del navegador — se verificaron a mano
sirviendo `www/` con un server estático y datos de prueba inyectados en
IndexedDB (ver `.claude/launch.json`, config `companion-web`).

## Segunda ronda de QoL (2026-09-23)

- **Respaldo automático silencioso** (cierra el pendiente histórico de
  `Chat.lastExportAt`): `platform.js` tiene `autoBackupBlob()`, que escribe
  en el APK (nunca en el navegador) a `Documents/Companion-backups/` sin
  abrir ningún diálogo y sin lanzar nunca (mejor esfuerzo). `chat.js`
  (`maybeAutoBackup()`, enganchado en `persistChat()`) lo dispara cuando
  pasaron ≥10 min desde `chat.lastExportAt` y hay algo más que el saludo
  inicial; `state.js` suma `markChatExported(chatId)` para actualizar esa
  marca. Es un respaldo "en la sombra" (sobrescribe un archivo por chat),
  no reemplaza la exportación manual con nombre de archivo propio.
- **Indicador de contexto + contador de mensajes**: nueva función pura
  `estimateContextUsage(card, messages, settings, chatScenario)` en
  `prompt.js` (misma heurística caracteres/token que ya usaban los
  builders de prompt). Se muestra en el menú (⋮) del chat: "N mensajes (X
  tuyos, Y del personaje)" + "Contexto usado: ~Z%". Es aproximado, no una
  cuenta real de tokens (eso solo lo sabe el servidor).
- **Bloqueo con PIN (opcional)**: nuevo módulo puro `www/js/lock.js`
  (`createPinHash`/`verifyPin`, SHA-256 salteado vía Web Crypto, sin
  dependencias) + pantalla `www/js/ui/lock.js` (reutiliza las clases
  `.setup*` de home.css, sin CSS propio). Se activa/desactiva desde
  Ajustes → "Bloqueo con PIN"; guarda `pinSalt`/`pinHash` en `Settings`
  (vacíos = desactivado). `main.js` la muestra al arrancar, antes de
  decidir la vista inicial, si hay un PIN configurado — no hay forma de
  recuperarlo si se olvida (hay que borrar los datos de la app). Requirió
  sumar `'lock'` a `VIEW_NAMES` en `shell.js` y una nueva sección
  `#view-lock` en `index.html`.
- **Default del formato de prompt cambiado**: `DEFAULT_SETTINGS.mode` pasó
  de `'plain'` a `'chat'` (plantilla del modelo) en `state.js`, porque al
  usuario "texto simple" le daba peor resultado de roleplay. "Texto
  simple" sigue disponible como opción manual en Ajustes, con el hint
  actualizado explicando cuándo usar cada uno. Instalaciones existentes
  que ya tenían un `mode` guardado no cambian (solo afecta instalaciones
  nuevas o un valor inválido).

Tests nuevos: `tests/lock.test.mjs` (hash de PIN) y 2 tests de
`estimateContextUsage` en `prompt.test.mjs` — 95 tests en total. El
respaldo automático y el bloqueo con PIN son UI/DOM/Capacitor-dependientes,
sin tests automáticos; se verificaron a mano (el bloqueo completo:
activar, recargar, PIN incorrecto, PIN correcto — probado en el navegador
con datos de prueba en IndexedDB).

## Hub de personajes: segunda iteración visual (2026-09-23)

El usuario mostró como referencia el hub de personajes de **Nomi AI**
(tarjetas grandes con foto, nombre y preview superpuestos con degradado, y
un botón "Continuar"). La lista vertical tipo `.list-row` de la iteración
anterior de este mismo día quedó descartada por "mucho texto en pantalla".
Rediseño final: grilla de **2 columnas** (antes había sido 3, y antes de
eso una lista) — ver `www/css/home.css` (`.home-grid`/`.home-card*`) y
`www/js/ui/home.js`. Cada tarjeta: imagen en `aspect-ratio: 3/4` con
`.home-card__scrim` (degradado oscuro de abajo hacia arriba) conteniendo
nombre + preview del último mensaje, legible sobre cualquier foto; debajo
de la imagen, botón "Continuar" (`.btn--sm`) + ícono de borrar. Sin avatar
cargado, se muestra la inicial centrada sobre `--grad-avatar`. **No volver
a una lista de texto ni a 3+ columnas sin que el usuario lo pida
explícitamente** — ya se probaron y rechazó ambas.

## Contratos de continuidad (2026-09-23)

Esta conversación de Claude Code se estaba quedando sin contexto. Se
escribieron dos documentos nuevos en `docs/` para que el proyecto se
pueda retomar sin perder el hilo:

- **`docs/CONTRACT-HANDOFF.md`**: briefing completo para cualquier
  instancia nueva de Claude Code que continúe el proyecto — rol, cómo
  trabajar con este usuario en particular, estado real (y accidentado) del
  repositorio git y cómo no repetir el problema, resumen del estado
  actual, pendientes, y roadmap a mediano plazo.
- **`docs/CONTRACT-LOREBOOK.md`**: encargo detallado y autocontenido para
  construir el subsistema de memoria/lorebook automático (ver más abajo,
  "Qué NO se ha hecho todavía") — trigger cada N mensajes, esquema de
  datos, extracción vía el propio KoboldCpp del usuario, inyección
  acotada en el prompt.

## Qué NO se ha hecho todavía (pendiente real, no roto)

- **Subsistema de memoria/lorebook automático**: no empezado. Encargo
  completo en `docs/CONTRACT-LOREBOOK.md` — disparo cada 30–50 mensajes
  (constante configurable), lorebook por chat (no por personaje, para no
  mezclar escenarios distintos de un mismo personaje), separado de
  `character.card.character_book` (ese es lore importado de la card
  original, de solo lectura para este sistema). El usuario tiene un
  proyecto aparte, todavía sin construir, que va a consumir estos logs —
  por eso se evitó deliberadamente el resumen automático de todo el
  historial sin un estándar claro (ver el contrato para el razonamiento
  completo).
- Probar en un APK real (no solo navegador): el fix de exportación a
  `Directory.DOCUMENTS`, el respaldo automático a
  `Documents/Companion-backups/`, y el bloqueo con PIN.
- Ajustes de IA (temperatura/longitud) por personaje o por chat en vez de
  solo globales: el usuario está más interesado en continuidad narrativa
  (ligado al punto del lorebook) que en esto por ahora.
- Búsqueda dentro de un chat largo: idea validada como "buena", sin
  implementar todavía.
