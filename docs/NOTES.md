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

## Subsistema de memoria/lorebook automático (2026-09-23)

Implementado completo según `docs/CONTRACT-LOREBOOK.md`. Resumen de qué se
hizo y las decisiones tomadas en los puntos marcados `[TU CRITERIO]` en ese
contrato:

- **Nuevo `www/js/api/lorebook.js`**: módulo puro (sin DOM, sin fetch).
  `LOREBOOK_UPDATE_EVERY_MESSAGES = 40` (dentro del rango sugerido, sin
  razón para desviarse). `LOREBOOK_MAX_ENTRIES = 24`,
  `LOREBOOK_MAX_ENTRY_CHARS = 320`, `LOREBOOK_INJECT_CHAR_BUDGET = 1000`
  caracteres inyectados por turno (~300 tokens), `LOREBOOK_SCAN_LAST_MESSAGES = 3`,
  `LOREBOOK_EXTRACT_TEMP = 0.3`. Funciones: `shouldUpdateLorebook`,
  `buildExtractionPrompt`, `parseExtractionResponse` (JSON directo → bloque
  `[...]`/`{...}` balanceado dentro del texto → `null` si nada sirve, nunca
  lanza), `sanitizeLoreEntries` (valida forma, trunca, dedupea por
  contenido, tope de cantidad), `selectLoreEntries` (keyword matching
  contra los últimos mensajes, estilo World Info, con tope de caracteres),
  `formatLoreBlock`.
- **`state.js`**: `Chat` suma `lorebook: LoreEntry[]` (`[]` por defecto) y
  `lorebookMessageCount: number` (`0` por defecto) — chats guardados antes
  de este cambio siguen cargando sin romperse (`sanitizeChat` les aplica
  los valores por defecto, y además valida cada entrada de lorebook
  individual por si un backup externo trae algo corrupto). Nueva
  `saveChatLorebook(chatId, lorebook, lorebookMessageCount)`, mismo patrón
  que `renameChat`/`markChatExported`.
- **`kobold.js`**: nueva `completeOnce(prompt, settings, opts)` — completado
  de una sola vez sin streaming contra `/api/v1/generate`, para la
  extracción de lorebook, con su propia `temp` (independiente de
  `settings.temp`) y un timeout de 2 minutos (más tolerante que las
  llamadas de chat normales: corre en segundo plano, sin que el usuario
  esté esperando). `generateReply()` ahora arma `loreBlock` con
  `selectLoreEntries`/`formatLoreBlock` a partir de `chat.lorebook` y se lo
  pasa a `buildPlainPrompt`/`buildChatMessages` (y al respaldo sin
  streaming).
- **`prompt.js`**: `headBlock`, `buildPlainPrompt`, `buildChatMessages` y
  `estimateContextUsage` suman un parámetro `loreBlock` (string, `''` por
  defecto) que se inyecta justo debajo del bloque `Scenario:` cuando no
  está vacío. Ver `docs/CONTRACTS.md` §5, actualizado con estas firmas.
- **`chat.js`**: `maybeUpdateLorebook()`, enganchada en `persistChat()` al
  lado de `maybeAutoBackup()` — mismo estilo "mejor esfuerzo total": nunca
  bloquea, nunca lanza, nunca le muestra nada al usuario si falla. Nueva
  entrada de menú (⋮) "Ver lorebook" con una hoja de solo lectura (contenido
  + keys de cada entrada, ordenadas por más reciente) — cumple el mínimo
  pedido por el contrato §4.6; editar/borrar a mano queda pendiente (ver
  más abajo).
- **Decisión sobre reintentos fallidos** (el contrato dejaba elegir): si
  `completeOnce()` responde pero el texto no se puede parsear como
  lorebook, `lorebookMessageCount` **se avanza igual** (se pierde esa
  ventana puntual de memoria, pero no se reintenta en cada mensaje
  siguiente reenviando un historial cada vez más grande contra un modelo
  que ya mostró que no sabe seguir el formato). Si en cambio falla la
  llamada en sí (red, servidor apagado), el contador **no avanza** — ahí sí
  conviene reintentar pronto. Ver el comentario junto a `maybeUpdateLorebook()`
  en `chat.js`.
- **Merge de entradas**: el prompt de extracción ya le pide al modelo el
  lorebook completo actualizado (nuevas + vigentes, sin las que se
  contradijeron), así que `sanitizeLoreEntries()` no intenta fusionar con
  lo anterior — solo valida, trunca y dedupea por seguridad. La única
  excepción son las entradas `source:'manual'`, que esta función nunca
  toca ni descarta (hoy no hay forma de crearlas — es una previsión para
  cuando exista la "memoria curada" del roadmap, sección siguiente).
- **Cobertura de las 4 categorías que pidió el usuario** (identidad de
  usuario/personaje, momentos compartidos, gustos/percepciones, estado de
  la relación): están en el prompt de extracción como guía, no como
  estructura rígida — el esquema de datos sigue siendo el `LoreEntry` plano
  del contrato (compatible con Tavern world info), sin campos de categoría
  separados, para no romper ese formato de intercambio pensado para el
  proyecto de worldbook externo del usuario. Ver la nota de alcance más
  abajo sobre el "estado de la relación" en particular.
- Tests nuevos: `tests/lorebook.test.mjs` (23 tests, cubre todo lo puro del
  módulo) + tests sumados a `state.test.mjs` (incluido uno que verifica que
  un chat guardado sin `lorebook` sigue cargando bien), `prompt.test.mjs` y
  `kobold.test.mjs` (incluida la inyección real vía `generateReply` y
  `completeOnce` contra un servidor de prueba, más tests actualizados tras
  el cambio a lorebook por personaje descrito más abajo). 137 tests en
  total ahora.
  No se probó contra un servidor KoboldCpp real (no había uno disponible en
  esta sesión) — se verificó a mano en el navegador (ver más abajo) con
  datos de lorebook sembrados directo en IndexedDB, y la lógica de
  extracción/parseo con mocks en los tests.
- Verificado a mano en el navegador integrado (375×812, `companion-web`):
  se sembró un chat con dos entradas de lorebook y se confirmó que el menú
  (⋮) → "Ver lorebook" las muestra correctamente (contenido + keys). No se
  probó el disparo automático real (requiere un servidor KoboldCpp
  respondiendo) ni el APK nativo.

**Nota de alcance sobre la visión original del usuario** (memoria tipo
Nomi AI: identidad, momentos compartidos, preferencias/percepciones,
estado de la relación — ver su mensaje pidiendo este trabajo): las primeras
tres categorías encajan bien con la inyección por keyword ya decidida en el
contrato (una anécdota o un gusto se mencionan y ahí matchea). El "estado de
la relación" es distinto: es la categoría que más se beneficiaría de estar
*siempre* presente en el prompt, no solo cuando una palabra clave la
dispara — pero el contrato fija deliberadamente la inyección por keyword
(nunca "meter todo siempre") para no comerse el presupuesto de contexto ya
ajustado del usuario, y esa restricción sigue siendo la correcta con
hardware limitado. No se resolvió con una excepción especial para no
complicar el mecanismo de inyección sin que el usuario lo pida — queda
anotado acá como una tensión real entre la visión original y la
implementación, no resuelta unilateralmente.

**Pendiente para más adelante** (no bloqueante, no pedido en este encargo):
editar/borrar entradas de lorebook a mano (hoy son de solo lectura), y la
"memoria curada" del roadmap (`docs/CONTRACT-HANDOFF.md` §7.1) que dejaría
fijar hechos a mano (`source:'manual'`, ya soportado por el esquema aunque
hoy nada lo genera) — y, si el usuario todavía quiere el dashboard visual
por personaje que mencionó, es una pantalla nueva aparte de este encargo
(el contrato solo pedía una vista mínima de solo lectura).

### Cambio de diseño: lorebook por personaje, no por chat (2026-09-23)

El contrato original (`docs/CONTRACT-LOREBOOK.md` §4.1) fijaba el lorebook
**por chat**, explícitamente dejando la alternativa "por personaje" como
algo a validar con el usuario antes de decidirlo. El usuario la validó y
pidió el cambio en la misma sesión: su objetivo declarado con todo este
proyecto es acercarse lo más posible a un companion persistente al estilo
Nomi AI dentro de las limitaciones de su hardware (sin memoria vectorial ni
nada más pesado) — y para eso, un mismo personaje tiene que "recordar" lo
mismo sin importar en qué chat se estableció un hecho. Mezclar lore de
escenarios distintos ya no se consideró un riesgo mayor que ese objetivo.

Cambios técnicos (`www/js/state.js`, `www/js/api/kobold.js`, `www/js/ui/chat.js`):

- `Character` suma `lorebook: LoreEntry[]` (compartido entre todos sus
  chats). `Chat` ya NO tiene `lorebook`; conserva `lorebookMessageCount`
  como marcador de *disparo* — cada chat sigue avisando por su cuenta
  cuándo le tocó cruzar el umbral de mensajes nuevos, pero las entradas que
  resultan de esa extracción se guardan en el personaje, no en el chat.
- `state.js`: `saveChatLorebook()` se separó en dos funciones con una sola
  responsabilidad cada una: `saveCharacterLorebook(characterId, lorebook)`
  (guarda las entradas) y `markChatLorebookProgress(chatId, count)` (avanza
  el marcador de ese chat). `getCharacter()`/`listCharacters()` ahora
  sanean `lorebook` igual que `getChat()` ya saneaba el suyo, así que un
  personaje guardado antes de este cambio sigue cargando con `lorebook: []`
  sin romperse.
- `kobold.js`: `generateReply()` arma el bloque de lorebook a inyectar a
  partir de `character.lorebook`, no de `chat.lorebook`.
- `chat.js`: `maybeUpdateLorebook()` lee/actualiza `character.lorebook`
  (compartido) y `chat.lorebookMessageCount` (del chat actual) por
  separado; la hoja "Ver lorebook" del menú ahora se titula con el nombre
  del personaje y lista su lorebook completo, sin importar desde qué chat
  se abra.
- No hubo datos reales que migrar: esta feature se implementó y se cambió
  de diseño dentro de la misma sesión, antes de que ningún chat real
  acumulara lorebook propio.

## Portabilidad y calidad a futuro (2026-09-23)

El usuario pidió, en su rol de "producto" (no como bug ni feature puntual),
una lectura de ingeniero sobre qué tan preparada está la app para cambios
grandes de hardware/plataforma más adelante, y un pulso general de qué
subiría el "estándar de calidad" del proyecto. Queda anotado acá para no
repetir el análisis en una sesión futura.

### A) Cambiar de placa de video / usar un modelo más grande

Ya es modular sin cambios: toda la comunicación de red vive en
`www/js/api/kobold.js`, contra los endpoints estándar de KoboldCpp
(`/api/v1/model`, `/api/v1/generate`, `/v1/chat/completions`,
`/api/extra/generate/stream`). Mientras el servidor nuevo siga hablando esa
misma API (cualquier KoboldCpp más nuevo, y probablemente text-generation-webui
u otros con modo de compatibilidad OpenAI), un modelo más grande no requiere
tocar código — `connect()` ya lee el contexto real del modelo
(`true_max_context_length`) y todo lo demás (prompt, historial, lorebook) se
adapta a `settings.ctx`. Si el usuario migrara a un servidor con una API
distinta, el cambio quedaría contenido en ese único archivo, no esparcido
por la app. Con más contexto disponible también tendría sentido revisar a
mano las constantes de `lorebook.js` (`LOREBOOK_INJECT_CHAR_BUDGET`,
`LOREBOOK_MAX_ENTRIES`) — hoy están pensadas para contextos chicos (4-8K).

### B) Portar a iOS

Viable sin reescribir la app: Capacitor soporta iOS como plataforma de
primera clase igual que Android (`npx cap add ios`), reusando el 100% de
`www/` tal cual. Lo que sí hace falta, y es trabajo real aunque acotado:
- Una Mac con Xcode para compilar/firmar (no hay forma de evitarlo; GitHub
  Actions tiene runners macOS si no se quiere depender de una Mac propia,
  con menos minutos gratis que los runners Linux).
- Excepción de ATS (App Transport Security) en `Info.plist` para permitir
  `http://` hacia el servidor KoboldCpp por Tailscale — el equivalente
  exacto en iOS del `androidScheme: "http"` que ya se configuró para
  Android.
- Los plugins ya usados (`@capacitor/filesystem`, `@capacitor/share`) son
  multiplataforma — la lógica de `platform.js` debería andar en iOS con
  cambios menores, no una reescritura.
- Para uso 100% personal (instalar en su propio iPhone vía Xcode, sin subir
  nada a la App Store) **no aplica la revisión estricta de Apple** — esa
  revisión es solo para publicar en la App Store. Sí hace falta una cuenta
  de Apple Developer (gratuita alcanza para instalar en el propio
  dispositivo, pero la app deja de funcionar a los 7 días y hay que
  reinstalarla desde Xcode; la cuenta paga, US$99/año, evita ese límite).

### C) Firma de APKs: por qué reinstalar borra los chats, y cómo arreglarlo

Causa raíz confirmada leyendo `.github/workflows/build-apk.yml`: el
workflow corre `npx cap add android` en cada build, sobre un runner de
GitHub Actions que arranca limpio cada vez — no hay ningún `android/`
versionado en el repo ni un keystore de depuración persistente. Gradle
genera (o usa) el keystore de depuración desde `~/.android/debug.keystore`,
que en un runner nuevo **no existe todavía**, así que se crea uno nuevo al
azar en cada build. Resultado: cada APK queda firmado con una clave
distinta, y Android trata eso como una app distinta con el mismo nombre —
por eso exige desinstalar la versión anterior antes de instalar la nueva
(no es un bug de esta app, es el comportamiento esperado de Android ante
una firma que cambió).

Arreglo (no implementado todavía, no era prioridad en esta sesión): generar
un keystore de depuración una sola vez y reusarlo en cada build. El
keystore de depuración de Android no es sensible (contraseña pública y
conocida, `android`/`android`, no sirve para firmar nada que vaya a la Play
Store) — es común y aceptado commitearlo al repo o guardarlo en un secreto
de GitHub Actions y volcarlo a `~/.android/debug.keystore` (o referenciarlo
desde `android/app/build.gradle`) antes de `gradlew assembleDebug`. Una vez
hecho esto, **instalar una APK nueva encima de la vieja actualiza la app
conservando los datos de IndexedDB**, como cualquier app normal — dejaría
de hacer falta el export/import manual solo para actualizar de versión.

**Importante mientras tanto**: "Ajustes → Exportar copia" (`exportBackup()`
en `state.js`) ya guarda personajes, chats Y mensajes completos, no solo
ajustes — a pesar del nombre del botón. Es la red de seguridad real hoy
para actualizar de versión sin perder nada; solo hay que acordarse de
correrlo antes de desinstalar.

### D) Requisito de Google de "developer verification" para sideloading

Google anunció (2025) que a partir de ciertas versiones de Android va a
exigir que hasta las apps instaladas por fuera de Play Store (sideloading,
que es como se instala esta app hoy) vengan de un "desarrollador
verificado", con despliegue gradual por país empezando por unos pocos
mercados y expandiéndose después. Esto es una política externa en
movimiento y esta nota puede quedar desactualizada — antes de que el
usuario cambie de teléfono/versión de Android, conviene chequear el estado
actual de "Android Developer Verification" en la documentación oficial de
Google. Si llega a aplicar a su dispositivo, la mitigación conocida es
registrarse como desarrollador verificado (proceso de identidad, no
equivale a publicar la app en la Play Store ni a pasar su revisión de
contenido) — no debería impedir seguir usando una app personal sin
publicar, pero sí podría agregar un paso de registro que hoy no hace falta.

### Lista de mejoras sugeridas (calidad/profesionalismo, no urgentes)

Pulso general pedido por el usuario para que sus próximos aportes sean
"más creativos que técnicos". Ninguna de estas se implementó en esta
sesión — quedan para cuando el usuario las priorice:

- **Gate de tests en el CI**: `build-apk.yml` hoy compila el APK sin correr
  `node --test` antes. Agregar ese paso es barato y evita que un cambio
  roto termine instalado en el teléfono real.
- **Firma de depuración estable** (ver punto C) — la mejora de calidad de
  vida más concreta y de mayor impacto de esta lista.
- **Mostrar la versión de la app en algún lado de la UI** (ajustes o
  splash), para que el usuario sepa si una instalación nueva "prendió" de
  verdad.
- **Pantalla para ver los respaldos existentes** (ya estaba en el roadmap
  de `CONTRACT-HANDOFF.md` §7.4): hoy los respaldos automáticos quedan en
  `Documents/Companion-backups/` sin ninguna forma de listarlos desde la
  app.
- **Editar/borrar entradas de lorebook a mano**, y más adelante "memoria
  curada" (hechos fijados a mano, ver `CONTRACT-HANDOFF.md` §7.1) — ambos
  ya anotados como pendientes del encargo de lorebook.
- **Temas/skins alternativos**: totalmente viable con bajo costo de
  ingeniería gracias a que `tokens.css` centraliza todos los colores — un
  segundo archivo de variables (p. ej. estética "glass"/vidrio esmerilado,
  como la referencia visual que mostró el usuario: botones con
  `backdrop-filter: blur()`, superficies semitransparentes, colores sólidos
  de fondo difuminados) + un selector en Ajustes que alterne qué hoja de
  variables se carga, sin tocar la lógica de ninguna pantalla. Es la
  puerta de entrada más barata para que el usuario aporte diseño sin tocar
  JS.
- **Diagnóstico exportable**: hoy, si la extracción de lorebook falla
  silenciosamente (a propósito, ver la sección del lorebook más arriba), no
  hay forma de saber por qué sin abrir las herramientas de desarrollador.
  Una pantalla simple de "ver el último error" (guardado en memoria, no
  persistente) ayudaría a diagnosticar problemas reales sin exponer nada al
  usuario en el flujo normal.

## Skins (Nomi/Glass) y fondo de chat personalizado (2026-09-23)

El usuario pidió arrancar la lista de mejoras de la sección anterior,
empezando por la que más ilusión le hacía: un segundo skin visual "Glass"
(vidrio esmerilado, inspirado en apps tipo Grok Companion/Ani) y un fondo
de chat personalizable con imagen propia. Implementado junto con las dos
mejoras "rápidas" de esa misma lista (gate de tests en el CI, versión
visible en Ajustes). Las dos restantes (pantalla de respaldos, editar
lorebook a mano) quedaron pendientes a propósito — ver el motivo al final
de esta sección.

- **`state.js`**: `Settings` suma `theme` (`'nomi'|'glass'`, por defecto
  `'nomi'`), `chatBackground` (data URL JPEG, `''` por defecto),
  `chatBackgroundBrightness` (20–180%, 100 por defecto),
  `chatBackgroundFade` (boolean) y `chatBackgroundFit` (`'fill'|'stretch'`).
  Es una configuración **global**, no por personaje ni por chat — decisión
  de alcance (ver más abajo).
- **Nuevo `www/js/images.js`**: utilidades de imagen compartidas (mismo
  estilo que `cards/avatar.js`, toca canvas/Image): `resizeImageToDataUrl()`
  reduce el fondo elegido a un JPEG liviano (máx. 1280px de lado, calidad
  0.82) antes de guardarlo — guardarlo a resolución completa en
  `Settings` (un solo registro en IndexedDB, leído/escrito seguido) sería
  un desperdicio de espacio en hardware limitado. `averageColorFromDataUrl()`
  calcula el color promedio de una imagen muestreando a 16×16 px, barato,
  para el tinte del skin "glass".
- **Nuevo `www/css/theme-glass.css`**: único archivo que toca clases de
  otros módulos (`.topbar`, `.sheet__card`, `.chat-bubble`, etc.) a
  propósito — ese es su trabajo, cambiar la piel visual sin tocar HTML ni
  lógica de ninguna pantalla. Todo vive bajo `[data-theme="glass"]`
  (atributo en `<html>`, ver `ui/shell.js` `applyTheme()`), así que en el
  skin por defecto (`nomi`) este archivo no hace nada. Convierte
  `--color-surface`/`--color-surface-2`/`--color-line` en versiones
  translúcidas y agrega `backdrop-filter: blur()` a las superficies
  (topbar, hojas, burbujas, composer, botones fantasma, chips, inputs);
  el color de acento (botones de acción, burbuja del usuario) se mantiene
  vívido a propósito, no se vuelve translúcido.
- **Tinte "glass" responsivo al fondo** (pedido explícito del usuario):
  `--glass-tint-rgb` es una variable CSS (`"R G B"`, sin comas, para poder
  usarla con `rgb(var(...) / alpha)`) que por defecto calca `--color-bg`.
  Cuando el usuario elige un fondo de chat, `ui/appearance.js` calcula su
  color promedio (`averageColorFromDataUrl`) y lo aplica con
  `shell.setGlassTint()` como estilo inline en `<html>` (gana por
  especificidad al valor por defecto de la hoja de estilos). Se recalcula
  también al arrancar la app (`main.js`) si ya había un fondo guardado.
  Verificado a mano: con un fondo de prueba azul/verde, todas las
  superficies del skin Glass (incluida la propia hoja de Apariencia) se
  tiñeron de ese mismo tono.
- **Fondo de chat**: nuevo elemento `.chat-bg` (y `.chat-bg__fade` para el
  fundido a negro opcional) dentro de `.chat-messageswrap`, detrás de
  `.chat-messages` (que pasó a `position:relative; z-index:1`). Deliberado:
  el fondo queda **detrás de los mensajes, no detrás de la barra superior
  ni del composer** — extender el fondo a pantalla completa hubiera
  requerido tocar `.topbar`/`.chat-composer` desde `chat.css`, violando la
  regla del proyecto de "cada módulo de CSS no redefine clases de otro
  módulo" (esas dos clases son de `base.css`). Es una limitación de alcance
  consciente, no un olvido — si el usuario quiere el efecto de pantalla
  completa (más parecido a la imagen de referencia que mostró, tipo Grok
  Companion), es una extensión chica pero requiere decidir cómo respetar
  o flexibilizar esa regla primero.
- **Controles de fondo** (`ui/appearance.js`, hoja nueva "Apariencia",
  accesible desde Ajustes y desde el menú ⋮ del chat): elegir imagen
  (reusa `pickFiles()` de `platform.js`), quitar imagen, brillo (slider,
  `filter: brightness()`), fundido a negro (toggle, gradiente CSS fijo),
  ajuste "llenar" (`background-size: cover`, recorta) vs "estirar"
  (`100% 100%`, deforma) — nombres literales que pidió el usuario. Tiene su
  propia vista previa en miniatura dentro de la hoja.
- **Bug real encontrado y corregido durante la verificación en el
  navegador**: los controles que se ocultan con el atributo `hidden`
  (`#appearance-remove`, `#appearance-bg-controls`) no se escondían,
  porque las clases `.btn`/`.field` (`base.css`) fijan su propio `display`,
  que empata en especificidad con la regla `[hidden]` de la hoja de
  estilos del navegador y gana por venir después en la cascada. Mismo
  problema que ya existía (y ya estaba resuelto) para `.chat-avatarpanel`/
  `.chat-scrolldown` en `chat.css`: cada clase que se oculta con `hidden`
  y también fija su propio `display` necesita su propio override
  `.clase[hidden]{ display:none; }`. Se agregaron esos overrides
  (`.appearance-removebtn[hidden]`, `.appearance-bgcontrols[hidden]`,
  `.appearance-preview__empty[hidden]`) a `home.css`. Vale la pena
  recordarlo si se agregan más controles con `hidden` en el futuro.
- **Otro detalle encontrado en la verificación**: la muestra visual del
  skin "Nomi" en la hoja de Apariencia usaba `var(--color-surface-2)`, que
  el propio skin "Glass" redefine globalmente — con Glass activo, la
  muestra de "Nomi" se veía transparente en vez de mostrar cómo es
  realmente ese skin. Se cambió a un color fijo (`#2d2f40`, el valor real
  de esa variable en `tokens.css`) para que la muestra sea estable sin
  importar qué skin esté activo.
- **Refresco en vivo sin salir del chat**: la hoja de Apariencia se abre
  encima del chat (no lo reemplaza), así que sin más, un cambio de fondo no
  se vería hasta salir y volver a entrar. Se agregó un evento de DOM propio
  (`'companion:appearancechange'`, mismo patrón que ya usa `shell.js` con
  `'shell:sheetopen'`/`'shell:sheetclose'` para desacoplar módulos) que
  `chat.js` escucha para refrescar su fondo al instante. El cambio de skin
  no necesitó esto: es un atributo en `<html>`, así que CSS puro ya lo
  refleja en cualquier pantalla ya renderizada.
- **`.github/workflows/build-apk.yml`**: nuevo paso `npm test` antes de
  compilar Android — evita que un cambio roto termine convertido en un APK
  descargable.
- **Versión visible**: nuevo `www/js/version.js` (`APP_VERSION`, hoy
  `'1.1.0'`, sin build/bundler no hay forma de inyectarla automáticamente
  desde `package.json` — se actualizan los dos a mano juntos), mostrada al
  pie de la hoja de Ajustes.
- Tests nuevos en `state.test.mjs` para los campos de apariencia
  (`theme`, `chatBackground*`) — 139 tests en total. Los archivos nuevos
  que tocan DOM/canvas (`images.js`, `ui/appearance.js`) no tienen tests
  automáticos, mismo criterio que `platform.js`/`cards/avatar.js`: se
  verificaron a mano en el navegador integrado (375×812), incluido subir
  una imagen de prueba, cambiar de skin, y confirmar el tinte "glass"
  reaccionando al color de esa imagen.

**Por qué quedaron afuera la pantalla de respaldos y la edición manual del
lorebook** (ambas de la misma lista, el usuario pidió arrancar "con
todas"): son features grandes y aisladas por su cuenta, no una extensión
del trabajo de skins/fondo. La pantalla de respaldos en particular depende
por completo de `Filesystem.readdir` de Capacitor — un plugin nativo que
no existe en el navegador, así que no hay forma de verificarla en este
entorno de desarrollo sin un APK real; construirla "a ciegas" sin poder
probarla choca con el estándar de calidad que pidió el usuario. Quedan
para la próxima ronda.

## Qué NO se ha hecho todavía (pendiente real, no roto)

- Probar en un APK real (no solo navegador): el fix de exportación a
  `Directory.DOCUMENTS`, el respaldo automático a
  `Documents/Companion-backups/`, y el bloqueo con PIN.
- Ajustes de IA (temperatura/longitud) por personaje o por chat en vez de
  solo globales: el usuario está más interesado en continuidad narrativa
  (ligado al punto del lorebook) que en esto por ahora.
- Búsqueda dentro de un chat largo: idea validada como "buena", sin
  implementar todavía.
- Editar/borrar entradas de lorebook a mano.
- Pantalla para ver los respaldos automáticos existentes
  (`Documents/Companion-backups/`), solo se puede probar en un APK real.
