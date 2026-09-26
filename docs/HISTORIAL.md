# HISTORIAL.md — Historia completa del proyecto (solo bajo demanda)

> **No es lectura obligatoria.** Aquí está TODO el contenido histórico que antes
> vivía en `docs/NOTES.md` (líneas 194 en adelante de la versión anterior,
> contrato DOC-003, 2026-09-24), movido **tal cual**, sin reescribir. Consúltalo
> solo cuando necesites el detalle de una decisión, una medición o un informe;
> el punto de partida es `docs/NOTES.md`.
>
> **Aviso sobre las referencias internas:** el texto de abajo se escribió cuando
> todo estaba en `NOTES.md`. Las frases como "ver `docs/NOTES.md`, sección X",
> "más abajo" o "al final de este archivo" se refieren a secciones de ESTE archivo,
> salvo "Estado vigente", "Perfil del servidor y principios de producto" y
> "Registro de contratos", que siguen en `docs/NOTES.md`.

## Índice de secciones

- Línea de tiempo resumida
- Adenda grande: varios chats por personaje
- Cómo verificar que todo sigue sano
- Bug crítico corregido: exportar chats/backup no hacía nada en el APK
- Reorganización de Git (2026-09-22)
- Ronda de feedback tras probar el APK (2026-09-22)
- Segunda ronda de QoL (2026-09-23)
- Hub de personajes: segunda iteración visual (2026-09-23)
- Contratos de continuidad (2026-09-23)
- Subsistema de memoria/lorebook automático (2026-09-23)
- Portabilidad y calidad a futuro (2026-09-23)
- Skins (Nomi/Glass) y fondo de chat personalizado (2026-09-23)
- Tipografía Literata y color de *asteriscos* del usuario (2026-09-23)
- Rearquitectura del sistema de skins: temas completos, iMessage, claro/oscuro (2026-09-23)
- Fondo de chat por personaje + buscador de personajes (2026-09-23)
- Qué NO se ha hecho todavía (pendiente real, no roto)
- Propuesta: creador de personajes guiado (2026-09-23)
- Auditoría VER-001: recuperabilidad y seguridad de datos (2026-09-23)
- ARQ-001: firma estable del APK de depuración (2026-09-24)
- ARQ-002: firmar explícitamente con la llave fija (2026-09-24)
- MEM-001 v2: lorebook aditivo, compatible con el servidor real, con gestión manual (2026-09-24)
- FMT-001: un solo párrafo en modo "plantilla" y sin respuestas vacías (2026-09-24)
- MEM-002: memoria automática apagada por defecto (2026-09-24)

---

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
     **(SUPERADO por: "Hub de personajes: segunda iteración visual" — hoy
     son 2 columnas de tarjetas grandes; no volver a 3.)**

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

**(SUPERADO por: "Estado vigente" — hoy son 144 tests, no 88; el desglose de
abajo es el de aquel momento.)** 88 tests debería ser el número actual (22 de `state.test.mjs` cubriendo
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
enganchado a la carpeta personal completa del usuario (`<HOME-DEL-USUARIO>`) en vez
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
  **(Corrección DOC-002: "un archivo por chat" es INCORRECTO. El archivo se
  llama `<personaje>[-<título>].json`, no por `chatId`, así que dos chats sin
  título del mismo personaje se pisan entre sí. Ver VER-001, hallazgo 3;
  pendiente de un contrato futuro de respaldo automático.)**
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

**(SUPERADO en parte por MEM-001 v2, 2026-09-24 — ver "MEM-001 v2" al final: hoy
dispara cada 20 mensajes, no 40; la extracción es aditiva, de una línea y de
hasta 3 entradas, no "la lista completa"; la vista ya NO es de solo lectura
(editar, borrar, deshacer y "Actualizar memoria ahora"). Lo demás de esta
sección —inyección por keyword y sus topes, lorebook por personaje— sigue
vigente.)**

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
- **(SUPERADO por: "Cambio de diseño: lorebook por personaje, no por chat")
  — este punto y el de `saveChatLorebook` describen la versión "por chat":
  hoy `Chat` NO tiene `lorebook`, y `saveChatLorebook` se separó en
  `saveCharacterLorebook` + `markChatLorebookProgress`.**
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

**(IMPLEMENTADO en ARQ-001, 2026-09-24 — ver "ARQ-001: firma estable del
APK" al final.)** Arreglo propuesto entonces: generar
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
- **(YA IMPLEMENTADOS, ver "Skins…" y "Rearquitectura del sistema de skins":
  gate de tests en el CI, versión visible en Ajustes y temas/skins; el
  mecanismo descrito en este punto —una hoja de variables alternativa— fue
  reemplazado por `themes.css`.)** 
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

> **(SUPERADO en varios puntos, conservado como historia):** `chatBackground*`
> en `Settings` → ahora viven en `Character` (ver "Fondo de chat por
> personaje + buscador de personajes"); `theme-glass.css` (borrado) →
> `themes.css` (ver "Rearquitectura del sistema de skins"); `Settings.theme`
> hoy admite también `'imessage'` y existe `themeMode`; "139 tests" → 144;
> el tinte Glass ya no se calcula al arrancar sino al entrar a un chat.

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

## Tipografía Literata y color de *asteriscos* del usuario (2026-09-23)

Dos pedidos chicos de texto, resueltos en `tokens.css`/`chat.css` (y
replicados en `www/dev/design-preview.html`, la página de revisión de
diseño del módulo 01):

- **Cambio de fuente**: el usuario pidió algo con el espíritu de las
  tipografías propias de Anthropic (Anthropic Serif/Galaxie Copernicus,
  Tiempos Text de Klim Type Foundry) — "excelente lectura en pantalla,
  formas robustas pero académicas y elegantes". Esas fuentes puntuales son
  comerciales/licenciadas a Anthropic, así que no se pueden usar acá (y
  además el proyecto solo permite Google Fonts como dependencia externa,
  ver `docs/CONTRACTS.md` §2). Se eligió **Literata** en su lugar: una
  serif de Google/TypeTogether diseñada específicamente para lectura larga
  en pantalla (nació para Google Play Books), con formas robustas y un
  registro académico/editorial — el mismo espíritu, sin problema de
  licencia. Cambio de un solo lugar (`--font` en `tokens.css` + el link de
  Google Fonts en `index.html`), toda la app cambia de fuente a la vez,
  igual que ya pasa con los colores. Solo se piden los pesos que el CSS
  usa de verdad (400/500/600 — el 300 que traía Outfit no se usaba en
  ningún lado).
- **Color de *asteriscos* del usuario**: era un hex fijo (`#ffd9a0`,
  "durazno"), un parche de una sesión vieja para un bug real (el texto en
  asteriscos del usuario se imprimía del mismo color que la burbuja,
  invisible) — pero sin relación con el resto del sistema de variables, a
  diferencia del lado del personaje (`--color-muted`, que si es un token).
  Se reemplazó por un token nuevo, `--color-muted-on-accent` (blanco al
  72% de opacidad), aplicado con el mismo patrón que ya usa el lado del
  personaje: `.chat-row--user { --em-color: var(--color-muted-on-accent); }`.
  Blanco-atenuado en vez de otro color fijo a propósito: así se adapta solo
  a cualquier superficie de acento (hoy `--grad-user`, y ya se probó que se
  sigue viendo bien con la versión traslúcida de ese degradado que usa el
  skin Glass) en vez de quedar pisado como pasó con el durazno. Se
  mantuvo la regla de respaldo directa (`.chat-row--user .chat-bubble em`)
  que ya existía por si el navegador tiene problemas heredando la
  variable — actualizada al mismo valor, sigue siendo un literal a
  propósito (no un `var()`, para que sirva de respaldo real).

No hay tests automáticos para ninguno de los dos (son CSS puro, sin lógica
en JS) — verificado a mano en el navegador integrado: la fuente se ve en
toda la app (burbujas, botones, hojas), y el texto en asteriscos del
usuario ya no depende de un valor fijo.

## Rearquitectura del sistema de skins: temas completos, iMessage, claro/oscuro (2026-09-23)

El usuario reportó un bug real: al activar el skin Glass, el hub de
personajes (pantalla de inicio) seguía viéndose como Nomi. Pidió que
cambiar de skin fuera "un cambio de lenguaje visual coherente, no solo el
chat", sumó un pedido de un tercer skin estilo iMessage, y un toggle de
claro/oscuro para los tres. Esto no se resolvió parchando selectores sueltos
(que es como se había hecho Glass originalmente) — se reescribió cómo
funcionan los skins de raíz, porque el enfoque anterior era exactamente la
causa del bug.

### Causa raíz del bug reportado

`theme-glass.css` (el archivo original de Glass) ponía el resplandor
morado ambiente en `<body>` — pero `.app` (un `div` `position:fixed` que
cubre toda la pantalla, con su propio `background: var(--color-bg)` opaco)
se pinta encima y lo tapa por completo. El resplandor **nunca se vio en
ningún lado**, ni en el chat ni en el hub — en el chat no se notaba porque
ahí la diferencia visual la daban sobre todo el fondo de chat personalizado
y el blur de las burbujas, que sí funcionaban; en el hub, sin esos
elementos, no quedaba ninguna diferencia con Nomi. Bug real, no percepción.

### Por qué se rehizo el sistema entero en vez de agregar iMessage al lado

El patrón de `theme-glass.css` era: por cada skin nuevo, ir a buscar a mano
qué selectores de `base.css`/`chat.css`/`home.css` tocar. Es exactamente el
tipo de cosa donde es fácil olvidarse un elemento — ya pasó una vez (el
hub). Agregar un tercer skin (y multiplicarlo por claro/oscuro = 6
combinaciones) con ese mismo patrón iba a garantizar más casos así. Se
reemplazó por una arquitectura donde **los componentes (`base.css`,
`chat.css`, `home.css`) no saben que existen skins**: solo leen tokens de
`tokens.css`, siempre, en todos lados. Un skin nuevo es agregar un bloque
de tokens a `themes.css` (nuevo archivo, reemplaza a `theme-glass.css`,
que se borró) — nunca tocar los componentes.

Dos tokens-bisagra permiten que hasta los efectos "especiales" de Glass
(resplandor de fondo, blur) sigan siendo "solo CSS", sin que los
componentes sepan nada de Glass en particular:
- `--app-bg`: fondo de `.app` (con fallback a `--color-bg`) — Glass lo
  redefine con el resplandor (ahora sí puesto en `.app`, arreglando el bug);
  Nomi/iMessage no lo tocan.
- `--surface-blur`: usado como `backdrop-filter: blur(var(--surface-blur, 0px))`
  agregado directamente a los componentes reales que ya tenían una
  superficie propia (`.topbar`, `.sheet__card`, `.chat-composer`,
  `.chat-bubble`, `.chat-actionbtn`, `.chat-retry`, `.chat-scrolldown`,
  `.chat-send`, `.home-chip`, `.list-row:active`, `.btn--ghost`, `.chip`,
  `.inp`, `.toast`, `.menu-item:active`, `.ib:active`,
  `.appearance-preview`) — 0px salvo que un skin lo redefina, así que en
  Nomi/iMessage esas líneas no cambian nada (verificado: Nomi Dark quedó
  pixel a pixel igual a como estaba).

`themes.css` define 6 bloques `[data-theme="x"][data-mode="y"]`
(nomi/glass/imessage × dark/light), cada uno completo (todos los
`--color-*`, `--grad-user`, `--grad-avatar`, `--font`, `--surface-blur`, y
`--app-bg`/`--glass-tint-rgb` donde aplica) — no son diffs parciales unos de
otros. `www/js/ui/shell.js` pone `data-theme` y `data-mode` en `<html>` por
separado (`applyTheme()`/`applyThemeMode()`, cada uno independiente del
otro) y sincroniza `<meta name="theme-color">` con `--color-bg` del tema
activo (para que la barra de estado de Android combine, no solo el
contenido de la página).

### iMessage: paleta calcada de iOS real, sin blur

Colores tomados de los reales de iOS (`systemBlue`/`systemGray6`/
`label`/`secondaryLabel`, en sus variantes clara y oscura) — no los
inventé. Dos decisiones de alcance:
- **Sin blur** (`--surface-blur: 0px`): aunque iOS real sí difumina barras,
  se dejó así a propósito para que iMessage se distinga claramente de Glass
  en vez de leerse como "Glass pero celeste" — los colores y la forma de
  las burbujas ya alcanzan para reconocerlo.
- **Fuente del sistema** (`-apple-system, BlinkMacSystemFont, ...`), no
  Literata: es lo más fiel a como se ve Mensajes de verdad, y de paso no
  agrega una segunda fuente de Google Fonts a cargar.

`--grad-user` para iMessage es un color plano (`#0a84ff`/`#007aff`), no un
degradado — el nombre del token quedó igual (`--grad-user`, viejo de
cuando solo existía el degradado de Nomi) pero `background: var(--grad-user)`
acepta cualquier valor de fondo válido, gradiente o no, así que no hizo
falta cambiar el nombre ni el código que lo usa.

### Apariencia: modo claro/oscuro + 3 skins

`ui/appearance.js` ahora tiene una fila "Modo" (Oscuro/Claro, aplica a
cualquier skin) arriba de la fila "Skin" (Nomi/Glass/iMessage). Las
muestras de cada skin son snapshots con colores fijos en `home.css` — a
propósito no leen `var(--color-*)`, porque tienen que representar CADA
skin tal cual se ve, no el que esté activo ahora mismo en el resto de la
app (mismo motivo por el que la muestra de Nomi ya se había arreglado así
la sesión anterior). Cambian de variante clara/oscura según el toggle de
Modo, no según el tema activo real.

### Verificado a mano (navegador integrado, 375×812)

Las 6 combinaciones (3 skins × 2 modos), incluyendo: que Nomi Dark no
cambió nada visualmente respecto de antes; que el hub de personajes ahora
sí refleja Glass (resplandor visible, chip/buscador con blur); que iMessage
oscuro y claro se ven fieles a las capturas de referencia que mostró el
usuario (fondo negro/blanco, burbuja gris/blanca entrante, burbuja azul
saliente, tipografía del sistema); que `--color-muted-on-accent` (el texto
en *asteriscos* del usuario, arreglado la sesión anterior) se sigue leyendo
bien en los tres skins; y que `<meta name="theme-color">` cambia con el
tema. Sin tests automáticos nuevos (es CSS + un par de funciones de DOM en
`shell.js`, mismo criterio que el resto de temas/apariencia) — sí se
sumaron tests en `state.test.mjs` para los nuevos campos de `Settings`
(`theme` con tres valores válidos, `themeMode`).

## Fondo de chat por personaje + buscador de personajes (2026-09-23)

El usuario pidió dos cosas en el mismo mensaje, resolviendo de paso la
única pregunta que `docs/CONTRACT-CHARACTER-CREATOR.md` había dejado
abierta a propósito.

### Fondo de chat: de global a por personaje

Decisión del usuario, explícita: "cada personaje y solo en los chats
tendrá el fondo de pantalla custom. El resto de menús deben ser coherentes
en sus fondos con la skin que tenga aplicada la app." Se movieron
`chatBackground`, `chatBackgroundBrightness`, `chatBackgroundFade` y
`chatBackgroundFit` de `Settings` a `Character` — mismo patrón exacto que
ya se usó para el lorebook (`docs/NOTES.md`, "Lorebook por personaje"):
compartido entre todos los chats de ESE personaje, invisible para los
demás.

- **`state.js`**: los 4 campos salieron del typedef `Settings` y entraron al
  typedef `Character`. `sanitizeCharacterLorebook()` se renombró a
  `sanitizeCharacterExtras()` (ahora sanea lorebook Y fondo — mismo criterio
  que antes: personajes guardados antes de esta feature, o de cuando el
  fondo todavía era un ajuste global, cargan con los valores por defecto de
  siempre sin romperse). Nueva `saveCharacterBackground(characterId, patch)`
  con merge parcial, mismo estilo que `saveSettings(patch)`.
- **`ui/appearance.js`** quedó *solo* con skin + modo claro/oscuro (ajuste
  global de verdad, no tiene sentido que dependa de un personaje). Todo el
  código de fondo de chat que tenía antes se movió a un archivo nuevo,
  **`ui/chat-background.js`** (`openChatBackground(app, character)`), que
  solo se puede abrir con un personaje en mano — por eso vive en el menú ⋮
  del chat (`ui/chat.js`), nunca en Ajustes. El menú del chat ahora tiene
  dos ítems separados: "Apariencia" (global) y "Fondo del chat" (de ese
  personaje).
- **Tinte del skin Glass, ahora por sesión de chat, no por app**: antes se
  calculaba una vez al arrancar la app (fondo global). Ahora `ui/chat.js`
  lo calcula al entrar a un chat (`show()`, a partir de
  `character.chatBackground`) y lo **suelta** al salir (`hide()`, vuelve al
  tinte por defecto del tema) — así el resto de la app (hub, Ajustes) nunca
  se queda pegada con el tinte de "el último personaje que viste", que es
  justo lo que pedía la parte de "el resto de menús deben ser coherentes
  con la skin". Verificado a mano: fondo puesto en un personaje, tinte
  Glass reaccionando en la propia hoja de "Fondo del chat"; al volver al
  hub, el tinte vuelve al morado neutro de siempre (no se queda con el
  tono del fondo que se acababa de ver).
- El evento de DOM que usa `chat.js` para refrescar el fondo sin salir y
  volver a entrar se renombró de `'companion:appearancechange'` a
  `'companion:chatbackgroundchange'` (más preciso ahora que el skin y el
  fondo son cosas separadas) y ahora viaja con el `Character` actualizado,
  no con `Settings`.
- Esto también resuelve la tensión que `docs/CONTRACT-CHARACTER-CREATOR.md`
  §3.3 había dejado abierta a propósito ("¿el fondo debería ser por
  personaje?") — ya se actualizó ese documento con la decisión tomada.

### Buscador de personajes en el hub

Ya existía un `<input>` de búsqueda en `home.js` (filtraba por nombre), pero
solo se mostraba automáticamente con más de 6 personajes — con pocos, no
había forma de saber que existía. El usuario confirmó sumarlo de forma
minimalista: un ícono de lupa en la barra superior del hub que, al tocarlo,
despliega la misma barra de siempre para escribir (no un panel nuevo ni una
pantalla aparte — se evaluó y se descartó por ser más trabajo de ingeniería
sin sumar nada funcional sobre reusar el input que ya filtraba bien). Se
sacó la condición de "más de 6 personajes"; ahora el ícono siempre está,
independientemente de cuántos personajes haya. `.home-search` pasó de
`hidden` a una transición de `max-height`/`opacity` (mismo patrón que
`.chat-avatarpanel--collapsed` en `chat.css`) para que abrir/cerrar la
barra sea un despliegue suave, no un salto brusco.

### Verificación

144 tests (`node --test tests/*.test.mjs`), incluidos nuevos para
`saveCharacterBackground` (merge parcial, validación de rangos, un
personaje no pisa el fondo de otro) y para personajes/ajustes guardados
antes de esta migración (sin campos de fondo en `Character`, o con ellos
todavía en `Settings` de una versión vieja). Verificado a mano en el
navegador integrado (375×812): dos personajes con fondos distintos, cada
uno visible solo en su propio chat; el buscador filtrando en vivo y
limpiándose al cerrar.

## Qué NO se ha hecho todavía (pendiente real, no roto)

- Probar en un APK real (no solo navegador): el fix de exportación a
  `Directory.DOCUMENTS`, el respaldo automático a
  `Documents/Companion-backups/`, y el bloqueo con PIN.
- Ajustes de IA (temperatura/longitud) por personaje o por chat en vez de
  solo globales: el usuario está más interesado en continuidad narrativa
  (ligado al punto del lorebook) que en esto por ahora.
- Búsqueda dentro de un chat largo (buscar texto entre los mensajes de una
  conversación): idea validada como "buena", sin implementar todavía —
  **distinto** del buscador de personajes en el hub, que ya está hecho.
- Editar/borrar entradas de lorebook a mano.
- Pantalla para ver los respaldos automáticos existentes
  (`Documents/Companion-backups/`), solo se puede probar en un APK real.
- **Creador de personajes guiado** (propuesta escrita, no autorizada):
  ver `docs/CONTRACT-CHARACTER-CREATOR.md`.

## Propuesta: creador de personajes guiado (2026-09-23)

El usuario adjuntó la character card de "Mia" (copiada en
`docs/examples/mia-card-reference.json`), un personaje que armó con ayuda
de una instancia anterior de Claude Code y que según él "funciona
ridículamente bien" en chats largos (90+ mensajes) y cambios de escenario.
Pidió, en este orden: que se estudiara a fondo esa card, que se documentara
una propuesta de "creador de personajes" para el hub (no solo importar
archivos, también crear desde la app, con foto y — quizás — fondo) **antes
de escribir código**, y una opinión profesional sobre si conviene arrancar
con un enfoque de opciones tipo pill/preset (para no gastar contexto de
más con cards larguísimas) en vez de texto libre sin estructura.

Se escribió `docs/CONTRACT-CHARACTER-CREATOR.md` con: el análisis campo por
campo de por qué la card de Mia funciona (en corto: las reglas de estilo de
escritura viven dentro de `description`, no en `system_prompt`/
`post_history_instructions` que quedan vacíos; `personality` es una lista
corta de tags, no un párrafo; `scenario` queda vacío a propósito porque ya
existe por chat; `first_mes`/`mes_example` demuestran el formato en vez de
solo describirlo) y una recomendación: un creador **híbrido** — pills para
la capa estructural (estilo de escritura, rasgos de personalidad: un
espacio de diseño chico, bien entendido, y responsable de la coherencia
que el usuario quiere preservar) y texto libre guiado con límite de
caracteres (mismo patrón que `SCENARIO_MAX` en `chats.js`) para la capa de
contenido (nombre, descripción, saludo — inherentemente abierta, no
"pill-eable" sin perder lo que hace único a cada personaje). El documento
dejaba explícita una tensión no resuelta a propósito: el fondo de chat era
entonces un ajuste global, no por personaje, así que ofrecerlo en el creador
implicaría o pisar el ajuste global o extender el modelo de datos — se
recomendaba no sumarlo a la v1 hasta que el usuario decidiera cuál de las dos
quería. **(SUPERADO por: `docs/CONTRACT-CHARACTER-CREATOR.md` §3.3 y la
sección "Fondo de chat por personaje + buscador de personajes" — la tensión
ya está resuelta: el fondo es por personaje.)**

No se escribió ni una línea de código de la feature en sí — es
explícitamente una propuesta para que el usuario la revise, no un encargo
ya autorizado (a diferencia de `docs/CONTRACT-LOREBOOK.md`, que sí era un
encargo directo). Cualquier instancia que retome este trabajo debe
confirmar el alcance con el usuario antes de empezar a implementar.

## Auditoría VER-001: recuperabilidad y seguridad de datos (2026-09-23)

Contrato VER-001 (solo lectura: no se modificó ningún archivo de código).
Método: lectura del código real, escaneo de todo el historial de git, y
ejecución de tres comprobaciones contra los módulos reales desde un
directorio temporal fuera del proyecto (truncado del lorebook, nombres del
respaldo automático, `importBackup`). Línea base de tests antes y después:
**144 de 144 en verde** (`node --test tests/*.test.mjs`).

Leyenda: **H** = Hecho (leído en el código o ejecutado; con archivo y
función), **I** = Inferencia (deducción), **S** = Supuesto (no verificable
sin un APK real u otro entorno). Severidad P0 (pérdida de datos clara) a P3.

### Tabla de hallazgos

| # | Hallazgo | Evidencia | H/I/S | Sev. |
|---|---|---|---|---|
| 1 | El respaldo automático NO es una copia completa: solo guarda el log del chat (mensajes + `{id,name}` del personaje + título y escenario del chat). No incluye la card, el avatar, el fondo, el lorebook, `avatarMode` ni `Settings`. | `ui/chat.js: chatExportBlob()`, `maybeAutoBackup()` | H | P1 |
| 2 | Ese archivo no lo acepta `importBackup` ("Ese archivo no es una copia de seguridad válida"). Solo lo lee "Importar chat", que exige tener ya el personaje y un chat abierto y usa únicamente `messages` (título y escenario del archivo se ignoran). En una instalación limpia hay que re-importar la card original, crear un chat y luego importar el log; se pierden lorebook, avatar/fondo cambiados y escenario. Los mensajes sí son recuperables. | `state.js: importBackup` (exige `Array.isArray(data.characters)`); `ui/chat.js: onImportChat`; ejecutado (C1) | H | P1 (P0 si "restaurable" se entiende como estado completo) |
| 3 | Colisión de nombres: el archivo se llama `<personaje>[-<título>].json`. Dos chats del mismo personaje sin título (el chat automático de `chats.js: show()` nace sin título, y el título de "Nuevo chat" es opcional) comparten archivo y **cada respaldo pisa al del otro**. Igual con dos personajes de igual nombre, y con nombres sin letras latinas, cuyo `slug` queda vacío y cae en `chat.json`. Contradice "un archivo por chat" de esta misma documentación. | `ui/chat.js: chatSlug()`, `slugify()`; ejecutado (B): dos chats sin título → `mia.json` y `mia.json` | H | P1 |
| 4 | Sin generaciones: un solo archivo por nombre, sobrescrito en cada respaldo (cada ≥10 min de actividad). Renombrar un chat crea un archivo nuevo y deja el viejo huérfano. | `platform.js: autoBackupBlob`, `AUTO_BACKUP_INTERVAL_MS` | H | P2 |
| 5 | Atomicidad de la escritura no verificada: el código llama a `Filesystem.writeFile` sobre el mismo nombre, sin temporal + renombrado propio. No se pudo leer la fuente del plugin (la consulta a GitHub devolvió 404), así que no se sabe si trunca antes de escribir. | `platform.js: autoBackupBlob` | S (no verificable sin leer el plugin / APK real) | P2 |
| 6 | El mensaje del usuario SÍ se guarda en IndexedDB **antes** de pedir la respuesta (`await persistChat()` y después `await generate()`), en una transacción atómica mensajes+meta. Esto es lo correcto. | `ui/chat.js: onSendClick`; `state.js: saveChatMessages` (`backend.atomic`) | H | — (positivo) |
| 7 | La respuesta parcial solo vive en memoria mientras se genera: se guarda al terminar, al abortar o al salir del chat (`hide()`). No hay guardado periódico ni manejo de segundo plano (no existe `visibilitychange`/`pagehide`). Si Android mata la app a mitad de una respuesta, el mensaje del usuario queda guardado pero la respuesta parcial se pierde. | `ui/chat.js: generate()`, `hide()`; búsqueda de `visibilitychange` sin resultados | H (código) / S (que Android mate el proceso) | P2 |
| 8 | Si la red se corta con texto ya recibido, la respuesta parcial se guarda (`truncated:true`) pero `chat.js` ignora ese indicador: no avisa al usuario. Si no hubo nada de texto, aparece un aviso y el botón "Reintentar respuesta". | `api/kobold.js: generateReply` (catch); `ui/chat.js: generate()` | H | P3 |
| 9 | Un fallo al guardar (`saveChatMessages`) sí llega a un aviso visible ("No se pudo guardar la conversación."), pero es un toast de ~4 s: sin indicador persistente, sin reintento, y la generación continúa. Si además falla la creación inicial del chat, otro toast. | `ui/chat.js: persistChat()`, `show()`; `ui/shell.js: toast` | H | P3 |
| 10 | `importBackup`: **gana el archivo** sin comparar fechas y sin avisar. Ejecutado (C2): un respaldo viejo importado sobre un chat de 5 mensajes lo dejó en 1, borró el lorebook (0 entradas) y vació el avatar. `ui/settings.js` no pide confirmación y solo muestra "Se restauraron N personajes". No es transaccional (`put` uno a uno). No restaura `Settings` (ni URL, ni nombre de usuario, ni PIN, ni tema). | `state.js: importBackup`; `ui/settings.js` (botón importar); ejecutado (C2) | H | P1 |
| 11 | Lorebook: la extracción pide "la lista completa actualizada" con `maxLen` = el de chat (220 por defecto, 60–500), pero una lista de hasta 24 entradas × 320 caracteres necesita mucho más. Si el modelo se queda sin tokens, el parser cae al primer `{…}` completo y **el lorebook se reemplaza por 1 entrada**. Ejecutado (A): 8 entradas → 1. También borra todo si el modelo devuelve `[]` o envuelve la lista en un objeto (`{"entries":[…]}`): 8 → 0. Solo se salva si el texto no es JSON (parse = `null`). | `ui/chat.js: maybeUpdateLorebook()` (`completeOnce` sin `maxLen`); `api/lorebook.js: parseExtractionResponse`, `sanitizeLoreEntries`; ejecutado (A) y comprobación extra | H | P1 — **CORREGIDO por MEM-001 v2 (2026-09-24)**: la extracción es aditiva (nunca reemplaza la lista), pide ≤3 entradas en una línea, rescata arreglos truncados y una respuesta vacía/`[]`/no entendida no reduce nada (tests). |
| 12 | Lorebook y chat compiten por el servidor: `maybeUpdateLorebook()` se dispara dentro de `persistChat()`, sin `await`, justo antes de `generate()`; en el mensaje que cruza el umbral (cada 40) salen dos peticiones casi a la vez. No hay cola ni bloqueo entre `completeOnce` y `generateReply`. Qué pasa depende del servidor (cola, o "ocupado"). Además `completeOnce` no envía `genkey` ni llama a `/api/extra/abort`: si el cliente se rinde a los 2 min, el servidor sigue generando. Si la llamada falla por HTTP (p. ej. "ocupado"), el contador no avanza y se reintenta en cada guardado siguiente. | `ui/chat.js: persistChat()`, `onSendClick`; `api/kobold.js: completeOnce`, `generateReply` | H (código) / S (comportamiento del servidor) | P1 — **CORREGIDO por MEM-001 v2**: la extracción no arranca con el chat ocupado, se cancela al enviar (con `genkey` + `/api/extra/abort`, medido) y el servidor encola (medido). Queda el costo de caché (ver "Informe de latencia"). |
| 13 | Con el PC apagado (uso fuera de casa), `completeOnce` espera hasta 2 min por intento (timeout, no rechazo inmediato) y no hay más de uno a la vez (`lorebookUpdateInFlight`). No pierde datos; solo reintenta. | `ui/chat.js`, `api/kobold.js: COMPLETE_ONCE_TIMEOUT_MS` | H (código) / I (efecto) | P3 |
| 14 | `saveCharacterLorebook` y `saveCharacterBackground` releen el personaje al guardar, así que la extracción larga NO pisa avatar ni fondo. Lo que queda pisable es lo contrario: `onCycleAvatarMode` y `onChangeAvatar` guardan el objeto entero en memoria; la copia en memoria se refresca al terminar la extracción del mismo chat, por lo que no encontré un camino realista, solo una ventana de milisegundos. Con "editar lorebook a mano" (MEM-001) este patrón de reemplazo total sí pasará a ser un riesgo real. | `state.js: saveCharacterLorebook`, `saveCharacterBackground`; `ui/chat.js: maybeUpdateLorebook`, `onCycleAvatarMode`, `onChangeAvatar` | H / I | P3 (hoy) — **MITIGADO parcialmente por MEM-001 v2**: las ediciones manuales y la extracción releen el lorebook justo antes de guardar y `saveCharacterLorebook` solo toca los campos de lorebook; `character` en memoria se refresca tras cada guardado. `onCycleAvatarMode`/`onChangeAvatar` siguen guardando el objeto entero (sin cambio). |
| 15 | Datos personales en texto plano fuera del almacenamiento privado: ver pregunta 8. La copia manual incluye `pinSalt`/`pinHash`; el PIN (≥4 dígitos, sin máximo) usa SHA-256 con sal y una sola pasada, así que un PIN corto se rompe por fuerza bruta. El PIN es un bloqueo de pantalla: los datos de IndexedDB no están cifrados. | `state.js: exportBackup`; `lock.js: hashPin`; `platform.js` | H | P2 |
| 16 | Proyecto Android: `allowBackup="true"` (plantilla de Capacitor), sin `debuggable` explícito (el APK de `assembleDebug` es depurable), y `usesCleartextTraffic` no aparece en la plantilla. Ver pregunta 7. | plantilla oficial de Capacitor 6.x; `build-apk.yml`; `capacitor.config.json` | H (plantilla) / I (APK generado) / S (Auto Backup real) | P2 |
| 17 | Cada APK se firma con un keystore distinto (causa ya documentada): actualizar exige desinstalar. La copia manual completa (v2) es entonces la única vía real de conservar personajes, chats y lorebook al actualizar, y es manual. | `build-apk.yml` (sin `android/` ni keystore versionados); sección "Portabilidad…", punto C | H | P1 (para futuras versiones) — **Corregido y verificado en teléfono**: ARQ-001 (2026-09-24) falló la verificación en el CI (build #14) y ARQ-002 lo corrige con firma explícita. **Verificado en un teléfono real (Hecho, tester, 2026-09-24): el APK nuevo se instaló encima del anterior, sin desinstalar, y los datos se conservaron** |
| 18 | Rendimiento con muchos personajes: `listCharacters()` carga objetos completos (avatar y fondo incluidos) y se llama dos veces al arrancar (`migrateLegacyChats` en `main.js`, luego el hub); además `buildLastPreviews` hace un `getAll('chatMeta')` por personaje. Ver pregunta 10. | `state.js: listCharacters`; `main.js: boot`; `ui/home.js: show`, `buildLastPreviews` | H | P2 |
| 19 | `Character.updated` no se mantiene nunca después de importar; `listCharacters()` ordena por él, así que el hub ordena por fecha de importación y no por actividad. No es pérdida de datos. | `cards/import.js`; `state.js: listCharacters`, `saveChatMessages` | H | P3 |
| 20 | Repositorio público: sin secretos ni archivos personales. Tres detalles menores (P3) y ausencia de `.gitignore`. Ver pregunta 1. | escaneo de `git rev-list --all` | H | P3 |

### Respuestas a las 10 preguntas

**1. Repositorio público (hecha primero).** Alcance del escaneo: los 10
commits de `git rev-list --all` (una sola rama, `main`; sin tags ni stash), el
árbol actual (47 archivos) y todos los blobs; no hay blobs binarios ni de más
de 200 KB. *Que el repositorio sea público* es un dato aportado por el
usuario: **S** (la herramienta `gh` no estaba disponible para comprobarlo).
- **Rutas de todo el historial** (`git log --all --name-only`): solo archivos
  del proyecto (código, tests, docs, workflow). No aparece ninguna ruta de
  `.ssh`, `.bash_history`, keystores (`*.jks`/`*.p12`), `.env`, Papelera
  (`.local/share/Trash`), copias de seguridad de chats ni documentos
  personales. La única ruta desaparecida es `www/css/theme-glass.css`
  (borrada a propósito, código de la app). **H**.
- **Patrones de secretos** en todos los blobs (claves PEM/SSH, tokens de
  GitHub, claves tipo AWS/Google/Slack/OpenAI, asignaciones
  `password/secret/token/apikey`, `storepass`, correos electrónicos, nombres
  `*.ts.net`, IPs privadas 192.168/10./172.16): **sin coincidencias**. Las
  palabras "keystore" solo aparecen en la prosa de `docs/NOTES.md` y
  `docs/CONTRACT-HANDOFF.md`. **H**.
- **Metadatos de commits**: un único autor (la cuenta de GitHub del proyecto) con un correo
  de relleno, no el correo real del usuario. **H**.
- **`.git/config`**: solo la URL del remoto, sin credenciales embebidas. **H**.
- **Hallazgos menores (P3), sin copiar su contenido y sin cambiar nada:**
  1. *Dirección IP de una red privada Tailscale*, presente como ejemplo en
     `tests/state.test.mjs` y `docs/CONTRACTS.md` (unas 10 líneas en cada
     archivo, en varios commits; un único valor). No es un secreto ni es
     alcanzable desde fuera de la tailnet, pero revela que existe ese
     servidor. Que sea la IP real del usuario es **S**.
  2. *Ruta absoluta con el nombre de usuario del PC*, en `docs/NOTES.md` y
     `docs/CONTRACT-HANDOFF.md` (en el historial de git; la ruta del
     proyecto y la del directorio personal).
  3. *Contenido personal*: `docs/examples/mia-card-reference.json` es una
     character card creada por el usuario que menciona su nombre. El usuario
     decidirá qué hacer con ella.
  4. *No existe `.gitignore`*: nada impide añadir por accidente
     `android/`, `node_modules/`, un keystore o un backup. P3 (P2 si se
     versiona `android/`).
  5. Sin `package-lock.json` versionado y con dependencias con rango `^`: el
     CI instala versiones no fijadas (riesgo de cadena de suministro y de
     builds no reproducibles). Los artefactos de `Actions` de un repositorio
     público los puede descargar cualquier cuenta de GitHub (**I**); el APK
     no contiene datos del usuario ni secretos.
- **Recomendación** (nada se ejecutó): no hace falta rotar credenciales porque
  no hay ninguna. Para los detalles 1–3, no reescribir historia ni hacer
  `push --force`; decidir si se quiere retirar la card de Mia o sustituir la
  IP por un ejemplo genérico *hacia adelante*. Aunque se borrara hoy, seguiría
  en el historial público. Añadir un `.gitignore` sería un contrato aparte.
  Como buena práctica: no escribir más IPs, rutas ni nombres reales en la
  documentación (usar `<IP-TAILSCALE>`, `<RUTA-DEL-PROYECTO>`).

**2. Contenido del respaldo automático.** Un JSON
`{app:'companion', kind:'chat-log', version:2, exported, character:{id,name},
chat:{id,title,scenario}, messages}`. **No** incluye la card completa, el
avatar, el fondo, el lorebook ni `chatBackground*`, y **no** incluye
`Settings` (por tanto tampoco `pinSalt`/`pinHash`). *Evidencia:*
`ui/chat.js: chatExportBlob()`. **H**. (La copia manual de Ajustes,
`exportBackup()`, sí lleva personajes completos y `Settings` con el hash del
PIN.)

**3. Restaurar en instalación limpia.** El log **no** entra por
`importBackup` (rechazado, ejecutado). Solo entra por "Importar chat" del menú
del chat, que requiere un personaje y un chat ya existentes y reemplaza los
mensajes (con confirmación). En una instalación limpia: re-importar la card
original, crear un chat, importar el log. Se recuperan los mensajes; no el
lorebook, ni el avatar/fondo personalizados, ni título/escenario del chat, ni
los ajustes; el personaje obtiene un `id` nuevo. **H**. Que el archivo
exista y sea legible en `Documents/Companion-backups/` tras reinstalar
depende de que la escritura funcione en Android: **S, no verificable fuera
de un APK real** (la 4.ª APK del usuario es anterior a esta función).

**4. Nombres, sobrescritura, generaciones y atomicidad.** Nombre =
`<slug del personaje>[-<slug del título>].json`; se sobrescribe en cada
respaldo (≥10 min y ≥2 mensajes); una sola generación; colisiones descritas en
el hallazgo 3 (ejecutado). Atomicidad: el código no hace temporal +
renombrado y no se pudo verificar cómo escribe el plugin: **S**. Un fallo se
traga en silencio (devuelve `false`) y se reintenta en el siguiente guardado
(`markChatExported` solo se llama si tuvo éxito).

**5. Secuencia de persistencia al enviar.** (1) el mensaje se añade en
memoria; (2) `await persistChat()` → `saveChatMessages` (transacción
atómica de mensajes + meta) → dispara sin esperar `maybeAutoBackup()` y
`maybeUpdateLorebook()`; (3) `await generate()`. **El mensaje del usuario
queda guardado antes de `generateReply`.** **H**. La respuesta parcial se
acumula solo en memoria y se guarda: al terminar, al abortar (Detener), al
salir del chat (`hide()`) o al fallar la red con texto ya recibido (guardada
como parcial recortada, sin aviso). Segundo plano: no hay ningún manejo; si
el proceso muere, se pierde la parcial (hallazgo 7). Los fallos de
`saveChatMessages` llegan a un toast (hallazgo 9). Un solapamiento entre
`hide()` y el `finally` de `generate()` reescribe siempre el mismo par
`chat`/`messages` en memoria; una ventana teórica de cruce entre chats
existe solo durante el `await` de `show()` y dura milisegundos (**I**, no
reproducida).

**6. Conflicto de `id` en `importBackup`.** Gana el archivo para personajes,
metadatos de chat y mensajes; no compara `updated`; no avisa; no restaura
`Settings`. Ejecutado (C2): pisa datos nuevos con uno viejo. **H**.

**7. Persistencia y proyecto Android.**
- `navigator.storage.persist()`: sí se llama, una vez, al crear la instancia
  de estado (`state.js: requestPersistence`), sin comprobar el resultado.
  **H**. Su efecto real en el WebView de Android: **S**.
- El proyecto Android se genera en cada build (`npx cap add android`,
  `build-apk.yml`); `android/` no está versionado. En la plantilla oficial de
  Capacitor 6.x: `android:allowBackup="true"`; no hay `android:debuggable` ni
  `android:usesCleartextTraffic` ni reglas de backup (`fullBackupContent`,
  `dataExtractionRules`); único permiso `INTERNET`. **H** (plantilla).
  `assembleDebug` compila la variante *debug*, que es depurable: **I**.
  `capacitor.config.json` fija `androidScheme:"http"` y `cleartext:true`; no
  se pudo confirmar si el CLI lo traduce a un atributo del manifiesto: **S**.
  Consecuencias: con depuración USB activa se pueden leer los datos de la
  app; `allowBackup` permite la copia automática de Android a la cuenta de
  Google (puede o no incluir IndexedDB, y puede o no restaurarse tras una
  reinstalación con otra firma): **S, no verificable fuera de APK real**.

**8. Datos personales fuera del almacenamiento privado** (todo texto plano,
JSON sin cifrar):
- `Documents/<nombre>.json` (`platform.js: saveBlobNative`, además se ofrece
  el panel Compartir con ese archivo): copia completa manual
  (`companion-copia-<fecha>.json`: personajes con card/avatar/fondo/lorebook,
  todos los chats, `Settings` con URL del servidor, nombre de usuario y hash
  del PIN) y log de un chat (`companion-chat-<slug>-<fecha>.json`).
- `Documents/Companion-backups/<slug>.json` (`autoBackupBlob`): log de chat
  completo, automático y silencioso.
- Red: los mensajes viajan por `http://` (cleartext) al KoboldCpp del usuario
  (dentro del túnel de Tailscale); la app además carga la fuente Literata
  desde Google Fonts (`index.html`), lo que expone la IP a Google. Portapapeles
  solo cuando el usuario pulsa "Copiar".
- No hay `localStorage`, cookies, `console.log` de datos ni telemetría.
  **H** (búsqueda en `www/`).

**9. Lorebook (solo lectura de código).** Resultado guardado con
`saveCharacterLorebook(targetCharacterId, lorebook)`, que **relee** el
personaje en el momento de guardar y solo cambia `lorebook`: no pisa avatar
ni fondo. El objeto leído antes de `completeOnce()` se usa para el prompt y
como `baseLorebook` (para conservar entradas `manual`, hoy inexistentes, y
como valor de reserva si el texto no se puede parsear). Lo que sí puede
quedar obsoleto es ese `baseLorebook`: cualquier cambio hecho entre la
lectura y el guardado (hoy nada, porque no hay UI de edición) se pierde por
el reemplazo total. El mayor riesgo no es obsolescencia sino el hallazgo 11
(truncado/`[]`/objeto envuelto → lorebook reducido o vaciado). Sobre el
servidor: la extracción no bloquea la app pero sí coincide con la petición
del chat (hallazgo 12) y, si el cliente se rinde, el servidor sigue
generando. **H/S** según se indica.

**10. Tamaño de datos.** Avatar: JPEG 384 px, calidad 0,85; fondo: JPEG máx.
1280 px, calidad 0,82; ambos como data URL base64 dentro de `Character`.
`listCharacters()` los carga completos (`backend.getAll('characters')`) en el
hub y también al arrancar (`migrateLegacyChats`). **H**. Estimación (**I**,
no medida): un fondo típico de 90–250 KB en binario ≈ 0,12–0,33 MB en base64
y un avatar de 20–45 KB; con 30 personajes con fondo ≈ **4–10 MB de fondos +
1–2 MB de avatares**, leídos dos veces al arrancar y retenidos en memoria
mientras el hub está abierto, más ~30 lecturas completas del store de
metadatos de chats. Es manejable en un teléfono actual pero crece lineal; la
copia manual con 30 personajes ronda 5–15 MB y se envía a Android como
base64 por el puente de Capacitor (`blobToBase64`): si ese tamaño es un
problema en gama baja es **S, no verificable fuera de APK real**.

### Lo que NO se pudo verificar (y por qué)

Todo lo que depende de Android/Capacitor real: que `Documents/` acepte la
escritura y cómo (atomicidad, permisos), el comportamiento de
`storage.persist()`, `allowBackup`/Auto Backup, el límite de tamaño del
puente base64, qué hace el WebView al pasar a segundo plano, y cómo responde
KoboldCpp ante dos peticiones simultáneas (depende de su versión y de si se
lanzó con `--multiuser`). Ninguna función nueva se ha probado en el teléfono
del usuario (tiene la 4.ª APK, muy anterior). No se probó contra un servidor
KoboldCpp real.

### Contexto aportado por el usuario tras la auditoría (Hecho, por el usuario)

La 4.ª APK del teléfono no contiene datos valiosos; no hay riesgo por
reinstalar hoy. El servidor KoboldCpp es su PC personal, que se apaga al
salir de casa. MEM-001 (proteger y gestionar el lorebook, incluido un botón
"Actualizar memoria ahora") está autorizado en principio, sin implementar. ARQ-001
quedó autorizado después y se implementó (ver su sección al final).

### Contratos de corrección que esta auditoría sugiere (sin autorizar)

Ninguno está implementado ni autorizado; son insumos para el arquitecto:
1. Respaldo automático completo y sin colisiones (nombre por `chatId`,
   generaciones, escritura segura, incluir personaje/lorebook, importable por
   `importBackup`).
2. Importación de copias con confirmación y protección contra pisar datos
   más nuevos.
3. MEM-001 (ya autorizado en principio): hallazgos 11, 12 y 14 son su punto
   de partida (subir `maxLen` de la extracción o extraer por lotes; no
   reemplazar el lorebook si la respuesta es vacía o inesperada; no lanzar
   la extracción a la vez que la respuesta del chat; botón manual).
4. ARQ-001: firma estable (hallazgo 17) — implementado, falló en el CI y fue
   corregido por ARQ-002; **pendiente de verificar en teléfono**.
5. Guardado incremental de la respuesta parcial y manejo de segundo plano.
6. `.gitignore` y `package-lock.json`.

## ARQ-001: firma estable del APK de depuración (2026-09-24)

**Estado:** implementado, pero **su primera versión FALLÓ en el CI** (build
\#14, commit "ARQ-001: firma estable del APK de depuración en el CI"): el paso
"Verificar que el APK lleva la firma estable esperada" detuvo el job porque el
APK salió con una huella distinta a la esperada. **Corregido por ARQ-002** (ver
su sección, más abajo). Lo que sigue describe el diseño original de ARQ-001; el
paso 1 (copiar la llave a `~/.android/debug.keystore`) resultó insuficiente y el
paso 3 (verificación) sí funcionó como se diseñó.

Huellas del fallo (transcritas por el usuario desde una captura del log; pueden
tener errores de lectura):
- Esperada: `41ce1e19…1494dc` (la del keystore versionado)
- Obtenida: `4db5ccb9…8b19c5` (otro certificado)
No se subió ningún APK. **Causa NO confirmada** (Inferencia: Gradle no tomó
`~/.android/debug.keystore` con la llave copiada, o usó otro almacén).

**Qué se hizo.**
- `signing/companion-debug.keystore`: llave JKS generada una sola vez con
  `keytool` (alias `androiddebugkey`, storepass y keypass `android`, RSA 2048,
  SHA256withRSA, validez 36500 días ≈ 100 años). Está versionada en el repo a
  propósito: el usuario no administra secretos de GitHub y es una llave de
  depuración sin valor. **Es SOLO de depuración: NUNCA usarla para firmar
  algo que se publique en una tienda.**
- `signing/EXPECTED-CERT-SHA256.txt`: huella SHA-256 pública del certificado
  (hex en minúsculas, sin `:`), la que el CI compara contra el APK.
- `.github/workflows/build-apk.yml`, tres pasos nuevos, todos DESPUÉS de
  `npx cap add android` (que regenera `android/` desde cero):
  1. copia la llave a `~/.android/debug.keystore` (donde Gradle la busca);
  2. inyecta `versionCode` (= `github.run_number`, crece en cada build) y
     `versionName` (= `version` de `package.json`) en
     `android/app/build.gradle`; **si el reemplazo no coincide, el job
     falla**;
  3. tras `assembleDebug`, corre `apksigner verify --print-certs` y compara el
     SHA-256 del certificado con el archivo anterior; **si difiere, el job
     falla**, antes de subir el artifact.
- No cambió: `applicationId` (`com.companion.app`), `androidScheme` (`"http"`),
  el gate `npm test`, nada bajo `www/` ni `tests/`.

**Por qué versionCode = run_number.** Android solo deja "actualizar" encima
si el `versionCode` nuevo es ≥ al instalado; el `1` fijo que trae Capacitor
habría bloqueado actualizaciones entre builds distintos con la misma firma.

**Cómo regenerar la llave si se pierde o hay que cambiarla** (implica que
TODOS los teléfonos deban desinstalar la app una vez, perdiendo sus datos
locales: exportar una copia antes):
```
keytool -genkeypair -keystore signing/companion-debug.keystore -storetype JKS \
  -alias androiddebugkey -storepass android -keypass android \
  -keyalg RSA -keysize 2048 -validity 36500 \
  -dname "CN=Companion Debug,O=Companion,C=XX"
keytool -list -v -keystore signing/companion-debug.keystore -storepass android
```
y copiar el valor `SHA256` (sin `:`, en minúsculas) a
`signing/EXPECTED-CERT-SHA256.txt`. No añadir `*.keystore` a ningún
`.gitignore` (SEC-001 debe dejar `signing/` fuera de sus reglas).

**Verificación.**
- Hecho: la llave abre con storepass/keypass `android`, el alias existe y la
  huella del archivo coincide con `keytool -list -v`. Los pasos de inyección
  se probaron localmente contra el `build.gradle` real que genera
  `npx cap add android` (Capacitor 6): reemplaza `versionCode 1` y
  `versionName "1.0"`, y falla con error si la línea no existe. El YAML del
  workflow se parsea bien. 144/144 tests en verde.
- **Supuesto (no verificable sin el CI):** que Gradle use
  `~/.android/debug.keystore` con este JKS, que `apksigner` esté en
  `$ANDROID_HOME/build-tools/*/` del runner y que su salida contenga
  `certificate SHA-256 digest`. Si algo de esto falla, el job en rojo lo
  avisa (no se publica un APK con firma equivocada). No hay `gh` para leer
  los logs de Actions desde aquí.
- **Supuesto (solo con un teléfono):** que instalar un APK sobre otro
  conserve los datos; se comprueba con MARCA-1 (sección 8 del contrato) al
  instalar el APK de MEM-001 sin desinstalar.

**Aviso operativo.** El primer APK con esta firma exige desinstalar la
versión anterior UNA vez (el usuario ya sabe que no hay datos valiosos en
ella). Desde el siguiente, actualizar encima debería conservar los datos.

## ARQ-002: firmar explícitamente con la llave fija (2026-09-24)

**Estado:** implementado; **pendiente de verificar en el CI y en un teléfono**.
Corrige el fallo de ARQ-001 (ver arriba).

**Qué cambió** (solo `.github/workflows/build-apk.yml` y esta documentación):
- Tras `assembleDebug` hay tres pasos nuevos, en este orden:
  1. **Localizar apksigner**: busca `apksigner` en
     `$ANDROID_HOME/build-tools/*/` (o `$ANDROID_SDK_ROOT`), elige la versión
     más alta y la deja en `$APKSIGNER`. Si no la encuentra, el job falla con un
     mensaje claro.
  2. **Re-firmar el APK**: `apksigner sign` con
     `signing/companion-debug.keystore` (alias `androiddebugkey`, contraseñas
     `android`), escribe a `--out app-debug-resigned.apk` y reemplaza a
     `app-debug.apk`. Así la firma ya no depende de dónde busque Gradle su
     llave.
  3. **Verificar**: `apksigner verify --verbose --print-certs`; imprime en el
     log el DN del certificado, el SHA-256 esperado y el obtenido, y falla si
     alguno de los certificados del APK difiere del esperado, si no se puede
     leer ninguno, o si la firma es inválida.
- El artifact subido es el APK re-firmado y verificado.
- Se conserva la inyección de `versionCode` (= `github.run_number`) y
  `versionName`. También se conserva el paso que copia la llave a
  `~/.android/debug.keystore` (es inofensivo y sirve de respaldo si Gradle sí
  la toma); la firma que cuenta es la explícita.
- No cambió: `signing/companion-debug.keystore`,
  `signing/EXPECTED-CERT-SHA256.txt`, `applicationId`, `androidScheme`
  (`"http"`), el gate `npm test`, nada bajo `www/` ni `tests/`.
- **No se "arregló" copiando la huella obtenida al archivo de esperadas**: eso
  habría validado la llave equivocada.

**Verificación.**
- Hecho: la huella de `signing/EXPECTED-CERT-SHA256.txt`
  (`41ce1e190b07…1494dc`) coincide con `keytool -list -v` del keystore
  versionado (SHA-256 `41:CE:1E:19:0B:07:…:14:94:DC`). El YAML se parsea sin
  errores. La lógica de los pasos "Localizar" y "Verificar" se probó
  localmente con un `apksigner` simulado en tres casos: huella igual (pasa),
  huella distinta (falla mostrando esperada y obtenida) y salida sin
  certificado (falla). 144/144 tests en verde.
- **Supuesto (no verificable sin el CI):** que `apksigner sign` acepte el
  keystore JKS tal cual, que `apksigner` exista en el runner y que su salida
  tenga las líneas `certificate DN` y `certificate SHA-256 digest` (así fue en
  el build #14, que llegó a ese punto). No hay Android SDK local ni `gh` para
  leer los logs de Actions; si el build sale en rojo, el mensaje del paso
  indica cuál requisito falló.
- **Supuesto (solo con un teléfono):** que instalar un APK sobre otro
  conserve los datos; se comprueba con "MARCA-1" al instalar el APK de MEM-001
  v2 sin desinstalar el anterior.

**Aviso operativo (igual que ARQ-001).** El primer APK con la firma estable
exige desinstalar la versión anterior una vez.

## MEM-001 v2: lorebook aditivo, compatible con el servidor real, con gestión manual (2026-09-24)

**Estado:** implementado y probado en el PC (tests + navegador integrado a
375×812 contra el servidor real del usuario). **NO probado en un APK/teléfono.**
Reemplaza al MEM-001 anterior (anulado). Leyenda: **Hecho** = medido o ejecutado
aquí; **Inferencia**; **Supuesto** = no verificado.

### Paso 0 — mediciones contra el servidor real (Hecho)

Servidor: KoboldCpp 1.121, `Mahou-1.5-mistral-nemo-12B.IQ4_XS`, contexto 6144,
en el PC del usuario (`http://localhost:5001`). Método: scripts de Node
desechables (no versionados) que llaman a `/api/v1/generate`,
`/v1/chat/completions` y `/api/extra/generate/stream`, incluidas las funciones
reales de la app (`generateReply`, `completeOnce`, builders de prompt) con la
card de Mia. No se cambió ninguna bandera ni script del servidor.

| # | Pregunta | Medición | Resultado |
|---|---|---|---|
| a | ¿`max_length` > 160 se recorta? | `/api/v1/generate` con prompt de continuación numérica sin saltos de línea, `max_length` 200 / 400 / 1024 | **Sí: 160 tokens** en los tres (161 según `/api/extra/tokencount`, que cuenta +1). Con `max_length` 100 → 100. En `/v1/chat/completions`, `max_tokens` 400 → `completion_tokens` máximo 160. |
| b1 | ¿Se ignora el `stop_sequence` de la petición? | Continuación `A\nB\nC…`; peticiones sin `stop_sequence`, con `[]` y con `["Z"]` | **Sí, en el endpoint nativo:** las tres cortan en el primer `\n` (respuesta `"Q"`). Igual en `/api/extra/generate/stream`. |
| b2 | ¿Se ignora la temperatura/`top_k`? | `temperature:0, top_k:1` ×4 en nativo → 3 salidas distintas; en chat completions ×4 → 2 distintas | **Sí**: los `gendefaults` sobrescriben el muestreo de la petición. |
| b3 | Modo "plantilla" (tester: salió con líneas en blanco) | `/v1/chat/completions` con el `stop` real de la app (`["\nEdgar:"]`): 6/6 respuestas con `\n` (prompt genérico), 4/8 (Mia, no streaming), 6/8 (`generateReply`, streaming). Sin `stop`: **0/6**. Con `stop:["\n","\nEdgar:"]`: **0/6**. `stop:[]`: 1/6. | **El corte en `\n` NO se aplica en ese endpoint cuando la petición trae su propio `stop`** (el de la app). |
| b4 | Modo "texto simple" | `generateReply` con `mode:'plain'` (endpoint `/api/extra/generate/stream`), 8 respuestas forzando párrafos: 0/8 con `\n`; nativo `/api/v1/generate`: 0/8. Efecto secundario: respuestas de 2 eventos (casi vacías) cuando el modelo empieza con `\n`. | El corte SÍ se aplica siempre. |
| c1 | Latencia normal | Historial de 61 mensajes (~2400 tokens), respuestas cortas: primer token **0,5–0,6 s**, total 1,3–1,8 s. Primera petición en frío: 13,6–16,7 s (≈145 tokens/s de procesamiento de prompt). | — |
| c2 | Efecto de una extracción sobre la SIGUIENTE respuesta del chat | Extracción con ventana de 40 mensajes (prompt actual, 5,1k caracteres): siguiente respuesta con primer token en **20,1 s** (3 medidas: 19,3 / 20,0 / 21,0 s) frente a 0,5 s. Extracción con ventana de 12 mensajes (2,4k caracteres): **23,1 s** (22,1 / 23,1 / 24,2). | **La caché de prompt del servidor se invalida** y el chat reprocesa todo el historial. El costo NO baja con un prompt de extracción más corto. Crece con el historial. |
| c3 | Alternativa: extracción como continuación del MISMO prefijo del chat (`/v1/chat/completions` con el historial + un mensaje de instrucción) | 3 ciclos | Primer token de la respuesta siguiente **0,47 s** (baseline 0,60 s): **sin penalización**; la extracción tardó 1,3 s. **Pero** no se validó como extractor: sin `stop` el servidor cortó en `\n` y devolvió solo "```json" / "[" (habría que usar prefill/`stop`). |
| c4 | Duración de la extracción (prompt nuevo, ventana de 10 mensajes) | 6 ciclos | ~2,7 s de media; con charla sin contenido, 0,3 s. |
| c5 | Prompt ANTERIOR (terminaba en `JSON:`) | 6 ciclos | **5 de 6 salidas inservibles** (`" "` o `" ["`): el modelo empezaba con `\n` y el servidor cortaba. En la práctica la extracción anterior casi nunca producía nada (fallaba en silencio, avanzando el marcador). |
| d | Dos peticiones simultáneas | Dos generaciones de 160 tokens con 300 ms de diferencia | **Se encolan**: A terminó a los 15,0 s, B a los 21,5 s; ambas 200, sin "ocupado". |
| e | Cancelación | `genkey` + `POST /api/extra/abort` a los 2,5 s | Respondió `{"success":"true"}` y la petición devolvió lo generado hasta entonces (62 caracteres) a los 2,5 s. **Solo cerrar la conexión del cliente** (AbortController): la siguiente petición pequeña tardó 5,3 s (esperó a que el servidor terminara). |

**No medido / Supuesto:** el timeout de 2 min con el servidor APAGADO real (se
probó un puerto cerrado, que falla al instante, no el timeout; el timeout está
cubierto solo por el código y los tests con dobles); nada desde el teléfono
(Tailscale, WebView, Android en segundo plano); el efecto de la caché con
historiales de ~4–5k tokens (se midió con ~2,4k; por la proporcionalidad se
espera ~35–40 s, **Inferencia**).

### Qué se implementó

- **Extracción aditiva de una línea** (`api/lorebook.js`): pide como máximo
  **3 entradas** nuevas/actualizadas como arreglo compacto `[{"k":[…],"c":"…"}]`,
  `c` ≤ 140 caracteres, en el idioma de la conversación, con las **keys**
  existentes (no el contenido) para evitar duplicados. El prompt termina en un
  **prefill** (`[`) para que el modelo siga en la misma línea (sin él, ver c5).
  Ventana: solo los últimos ≤ 20 mensajes desde el marcador, recortados desde el
  más antiguo con una estimación conservadora de **3 caracteres por token**
  (prompt.js usa 3,3) reservando 160 tokens de salida y 64 de margen.
  `LOREBOOK_EXTRACT_MAX_TOKENS = 160` (lo medido); no se pide nada por encima.
- **Parseo tolerante**: arreglo de una línea, `{"entries":[…]}`, objeto suelto,
  campos `k`/`c` y `keys`/`content`, texto alrededor, keys sin comillas (error
  observado con el modelo real: `"k":[Laura, sister]`), y **rescate de los objetos
  completos de un arreglo truncado**. `[]` = sin novedades; irreconocible = sin
  cambios.
- **`applyExtraction()`** (pura): agrega; actualiza una entrada `auto` que
  comparte al menos una key normalizada **y** habla de lo mismo (≥ 50 % de
  palabras de contenido en común); nunca elimina ni modifica `manual`; respeta
  `LOREBOOK_MAX_ENTRIES` descartando primero las `auto` más antiguas por
  `updated` (nunca las recién tocadas ni las manuales); quita de las keys nuevas
  el nombre del usuario y del personaje. *Desviación deliberada del contrato:* con
  solo "comparte una key" una key genérica ("work") habría reemplazado un
  recuerdo distinto (panadería → hospital de la hermana) y eso es pérdida
  silenciosa; por eso se exige además similitud de contenido. Si no se cumple,
  se agrega como entrada aparte.
- **Marcador**: sin cambio de regla (avanza si el servidor respondió aunque el
  texto no se entienda; NO avanza con fallo de red, abort o timeout).
  `LOREBOOK_UPDATE_EVERY_MESSAGES`: **40 → 20**.
- **Deshacer** (un nivel): `Character.lorebookPrevious` (+ `lorebookPreviousAt`,
  campo extra necesario para distinguir "no hay copia" de "el lorebook estaba
  vacío"). Se guarda el estado anterior antes de aplicar una actualización que
  cambie algo. Personajes/copias sin esos campos cargan con `[]`/`0`.
  `saveCharacterLorebook(id, lorebook, previous?)` relee el personaje y solo toca
  los campos de lorebook.
- **Prioridad al chat** (`createLoreUpdater`, probado con dobles): no arranca
  mientras hay una generación (`busy`) ni un envío en curso (`sendInFlight`); si
  el umbral se cruza entonces, se difiere y se reintenta al terminar
  (`finally` de `onSendClick`, o el `persistChat()` final de `generate()`). Si el
  usuario envía (o regenera) con una extracción en curso, se **aborta** (sin
  guardar ni avanzar el marcador) y se envía `POST /api/extra/abort` con el
  `genkey` (Hecho: funciona). `completeOnce` ganó `opts.signal` y `opts.genkey`
  (código `ABORTED`). Se conserva `lorebookUpdateInFlight` (ahora `running`) y el
  timeout de 2 min. El commit **relee** el lorebook antes de guardar, así una
  edición manual hecha durante la extracción no se pisa.
- **Hoja "Ver lorebook"** (`ui/chat.js`): lista con origen (automática / escrita
  o editada por ti); **Editar** (una entrada editada pasa a `manual`; se valida
  contenido y ≥ 1 key, sin `alert`); **Borrar** con confirmación; **Deshacer
  última actualización** (con confirmación; avisa si no hay nada); estado de la
  última actualización (solo en memoria); **Actualizar memoria ahora**
  (deshabilitado si hay respuesta/extracción en curso, avisa "Aún hay poca
  conversación para recordar" con < 4 mensajes, muestra progreso y termina siempre
  con un mensaje comprensible, incl. servidor apagado). Las confirmaciones son
  pantallas DENTRO de la misma hoja (`app.openSheet` reemplaza contenido) en vez
  de `app.confirmDialog`: este último CIERRA la hoja y reabrir otra enseguida es
  justo la carrera con el historial documentada en "Bugs reales…". Los fallos de
  la extracción automática no muestran errores en el chat. Todo el texto se
  inserta con `textContent`.

### Verificación (Hecho)

- `node --check` en cada archivo tocado; `node --test tests/*.test.mjs`:
  **174 de 174** en verde (antes 144). Nuevos: parseo (una línea, envoltorio,
  campos cortos/largos, truncado con rescate, keys sin comillas, `[]`, basura),
  `applyExtraction` (agrega, actualiza sin duplicar, no reemplaza recuerdos
  distintos, respeta el tope, no toca `manual`, entradas inválidas), ventana por
  presupuesto, edición/borrado, actualizador (no arranca con el chat ocupado, abort
  sin guardar ni avanzar marcador, servidor caído, respuestas vacías/truncadas
  nunca reducen, releer antes de guardar, `runNow`), y en `state.test.mjs`
  `lorebookPrevious` por defecto, deshacer y que guardar el lorebook no pisa un
  `chatBackground*`/avatar cambiados entretanto.
- Navegador integrado 375×812 contra el servidor real: "Actualizar memoria
  ahora" (3 recuerdos nuevos en inglés, ~5 s), editar (incluida la validación),
  borrar (cancelar y confirmar), deshacer (y el aviso al repetir), servidor
  apagado simulado con un puerto cerrado (mensaje comprensible, lorebook
  intacto), "poca conversación", botones deshabilitados durante una respuesta, y
  la prioridad al chat: con 20 mensajes nuevos la extracción **esperó** a que
  terminara la respuesta y, al enviar un segundo mensaje mientras corría, se
  **abortó** (`/api/extra/abort` con su `genkey`) y la respuesta del chat salió
  enseguida; después se reintentó sola. Sin errores de JavaScript en consola.
- **No probado en un APK real**: nada de esto se ha visto en el teléfono.

### Informe de latencia (requiere decisión del arquitecto y del usuario)

**Medido:** cada extracción, automática (cada 20 mensajes) o manual, hace que la
SIGUIENTE respuesta del chat tarde **~20 s más** en un chat de ~2400 tokens
(frente a 0,5 s de primer token normal), porque el servidor tiene una sola caché
de prompt y la extracción la reemplaza. No depende de lo corto que sea el prompt
de extracción, y crece con el largo del chat. Es incompatible con "ninguna
función puede empeorar de forma perceptible la latencia del chat" **si se aplica
tal cual**, aunque el contrato lo prevé (informar, no resolver). No se cambió la
configuración del servidor. Opciones (sin implementar):
1. **Aceptarlo** (~1 pico de +20 s cada 20 mensajes). Es lo implementado.
2. **Hacer la extracción como continuación del mismo prefijo del chat** (medido
   en c3: 0 penalización y 1,3 s). Falta validar la calidad del extractor por ese
   endpoint (requiere `stop`/prefill propios) y cambia el diseño de este
   contrato (la ventana pasaría a ser el propio prompt del chat). Es la opción
   que más protege la latencia.
3. **Solo manual** (quitar el disparo automático): el usuario elige cuándo pagar
   la espera, por ejemplo al final de una sesión.
4. Espaciar el disparo automático (p. ej. cada 60–80 mensajes) o dispararlo al
   salir del chat.

### Observación del tester: párrafos en modo "plantilla del modelo" (Hecho)

Explicación medida (Paso 0, b3/b4): el modo "plantilla del modelo" usa
`/v1/chat/completions`; ahí el corte en `\n` de los `gendefaults` solo se aplica
si la petición NO envía `stop`, y la app envía `["\n<usuario>:"]`
(`prompt.js: buildChatMessages`). El modo "texto simple" usa
`/api/extra/generate/stream` (respaldo `/api/v1/generate`), donde el corte SÍ se
aplica siempre. **Arreglo mínimo sugerido (no hecho: fuera del alcance de
MEM-001 v2, toca el flujo de respuesta):** añadir `"\n"` a la lista `stop` de
`buildChatMessages()` (medido: `["\n","\nEdgar:"]` → 0/6 respuestas con salto).
Efecto secundario a vigilar: si el modelo empieza con `\n`, la respuesta queda
vacía (ya ocurre en "texto simple"). `Settings.maxLen` > 160 no tiene efecto
real en ningún modo, y `Settings.temp` tampoco (el servidor impone 0,8).

### Hallazgos de VER-001

- **11** (reemplazo total por truncado): corregido.
- **12** (compite con el chat): corregido (diferir, abortar con `genkey`,
  servidor encola: medido). **Queda** el costo de caché de arriba.
- **13** (PC apagado, espera de 2 min): **sin cambio** (no pierde datos; el
  botón manual muestra el mensaje de "servidor no disponible" al terminar).
- **14** (reemplazo total al guardar): mitigado (ver la tabla de VER-001).
- Sigue como **Supuesto**: comportamiento en el teléfono (Tailscale, segundo
  plano), timeout real con el servidor apagado, historiales largos.

### Límites conocidos de la calidad de la memoria (Hecho, observado)

El modelo (12B, muestreo impuesto por el servidor) a veces devuelve frases de una
sola palabra ("Laura") o keys que son frases ("edgar's sister") que casi nunca
coincidirán en la inyección por keyword. El prompt exige frases completas con
sujeto y keys entre comillas, y el usuario puede corregir con "Editar". Sobre
una conversación de 18 mensajes con hechos, antes de añadir la reparación de keys
sin comillas el parseo funcionó 7 de 8 veces (el fallo fue justo ese error); con
el prompt y la reparación finales, 8 de 8. Son muestras chicas: la tasa real con
el modelo del usuario se conocerá usando la app.

**Observación en el teléfono real (Hecho, tester, 2026-09-24):** "Actualizar memoria
ahora" funcionó (última actualización "correcta, 1 nueva"), pero la lista mostró 2
entradas casi duplicadas, con keys "personality" y "person who loves physical
touch". Con la regla de inyección vigente (solo si una key aparece en los últimos 3
mensajes) esas entradas casi nunca llegarían al prompt. Pendientes (contrato futuro,
sin autorizar): higiene de keys (palabras sueltas, sin genéricas), fusión de
casi-duplicados aunque las keys difieran y recuerdos "siempre presentes" con tope de
caracteres. Ver "Estado vigente" en `NOTES.md`.

## FMT-001: un solo párrafo en modo "plantilla" y sin respuestas vacías (2026-09-24)

**Qué cambió y por qué.** El modo por defecto (`mode:'chat'`, `/v1/chat/completions`)
no cortaba en `\n`, porque el corte de los `gendefaults` del servidor no se aplica
cuando la petición trae su propio `stop` (Paso 0 de MEM-001 v2, b3). Cambios:
1. `prompt.js: buildChatMessages()` devuelve `stop = ['\n', '\n<usuario>:']`. Solo
   afecta a la respuesta del chat; `completeOnce()` (extracción del lorebook) no usa
   `buildChatMessages` y no cambió. El modo "texto simple" no se tocó.
2. `kobold.js: generateReplyNonEmpty(opts, generate = generateReply)` (nueva): si el
   texto final, tras `trim()`, queda vacío, reintenta UNA vez y en silencio (no
   reintenta abortos ni errores). Mientras lo recibido sea solo espacios, no llama a
   `onToken` (se retiene y se entrega junto con el primer texto real): el usuario ve
   los puntos de "escribiendo" y nunca texto que aparece y desaparece.
3. `chat.js: generate()` usa `generateReplyNonEmpty`. Si sigue vacía tras el reintento
   muestra un aviso ("El personaje no respondió. Toca «Reintentar respuesta».").

**Comportamiento anterior ante una respuesta vacía (Hecho, leído del código):** no
había reintento ni aviso; `generate()` quitaba el mensaje vacío de la lista sin
guardarlo y `renderMessages()` mostraba "Reintentar respuesta" (el último mensaje
era del usuario). Es decir, nunca se guardaba un mensaje vacío; eso se conserva.

**Mediciones (Hecho; servidor real, KoboldCpp 1.121, card de Mia
`docs/examples/mia-card-reference.json`, funciones reales de la app: `generateReply` /
`generateReplyNonEmpty`, usuario con nombre de prueba, scripts desechables no
versionados).** Cada fila = 20 respuestas; "con salto" = la respuesta contiene `\n`.

| Escenario | Modo | Antes: con salto / vacías | Después: con salto / vacías (reintentos) |
|---|---|---|---|
| Chat de 20 turnos seguidos | plantilla | 1/20 / 0 | 0/20 / 0 (0) |
| Chat de 20 turnos seguidos | texto simple | 0/20 / 0 | 0/20 / 0 (0) |
| 20 chats nuevos de 1 mensaje | plantilla | 0/20 / 0 | 0/20 / 0 (0) |
| 20 chats nuevos de 1 mensaje | texto simple | 0/20 / 0 | 0/20 / 0 (0) |
| Estrés: se le pide "dos párrafos" (12 peticiones, `stop` viejo vs nuevo, plantilla) | plantilla | **10/12** / 0 | **0/12** / 0 |

Lectura: con la card real de Mia el problema es raro (1 de 80 antes; el tester lo vio
en una instalación nueva), pero el estrés demuestra que el `stop` viejo sí deja pasar
varios párrafos y el nuevo lo impide. Latencia media por respuesta: sin diferencia
apreciable (plantilla ~3,2 s antes y después; texto simple 2–6 s, variable). **No se
observó ninguna respuesta vacía en las 160 respuestas medidas, así que el reintento
automático NO se ejercitó contra el servidor real** (solo con dobles en los tests y con
un servidor simulado en el navegador, ver abajo); su costo real (unos segundos por
reintento) es una **Inferencia**. La condición de parada (más de 1 de cada 20 vacías tras el
reintento) no se dio.

**Verificación en el navegador integrado (375×812) contra el servidor real (Hecho):**
5 respuestas seguidas de Mia en modo plantilla pidiéndole incluso "párrafos" y un
cuento: las 5 en un solo párrafo (0 `<p>`, 0 `<br>`), ninguna vacía, ninguna guardada
con `\n`. Con la respuesta simulada como vacía dos veces: exactamente 2 llamadas al
servidor, ningún mensaje del personaje guardado, aviso visible y botón "Reintentar
respuesta".

**Tests:** 182 en verde (`node --test tests/*.test.mjs`); nuevos: `stop` con `"\n"` y la
regla del usuario; reintento único; sin reintento en aborto/error; sin texto a
medias en `onToken`; servidor simulado (1.ª vacía, 2.ª con texto).

**No probado:** en el teléfono (APK/WebView); el timeout con el servidor apagado.
**Pendiente sin contrato:** `Settings.maxLen` > 160 y `Settings.temp` no tienen efecto
real con este servidor (recorta a 160 tokens; impone su muestreo); habría que
informarlo en Ajustes.

## MEM-002: memoria automática apagada por defecto (2026-09-24)

**Decisión y razón.** El principio de producto nº 1 del usuario es la latencia y
prohíbe empeorarla de forma perceptible sin su autorización. MEM-001 v2 midió que
cada extracción (automática o manual) invalida la caché de prompt del servidor y la
SIGUIENTE respuesta del chat tarda ~20 s más en vez de ~0,5 s de primer token (Paso
0, c2: 19,3–21,0 s con ventana de 40 mensajes; 22,1–24,2 s con ventana de 12; el
costo no baja con un prompt más corto y crece con el historial). Con el disparo
automático activo, cada ~20 mensajes aparecería esa pausa. Por eso el disparo
automático queda **apagado por defecto** y el usuario lo activa a sabiendas. La
alternativa medida en c3 (extraer como continuación del mismo prefijo del chat:
penalización 0, 1,3 s) NO está validada en calidad de extracción.

**Qué cambió.**
- `state.js`: `Settings.lorebookAuto: boolean`, por defecto `false`; el saneado solo
  acepta `=== true`. Settings guardados (o copias v1/v2) sin el campo cargan con
  `false`; `importBackup` no lee ni exige el campo (además no restaura Settings).
- `api/lorebook.js: createLoreUpdater().maybeRun()`: única línea nueva de lógica: si
  `ctx.settings.lorebookAuto !== true` devuelve `{kind:'skipped'}` antes de mirar el
  conteo. `runNow()` (manual), la extracción, la aplicación aditiva, el deshacer, la
  edición y el aborto al enviar NO cambiaron.
- `ui/chat.js` (hoja "Ver lorebook"): casilla "Actualizar automáticamente cada 20
  mensajes" (apagada por defecto) con el aviso "Mientras actualiza, la siguiente
  respuesta de tu personaje puede tardar más (en pruebas, unos 20 segundos o más).";
  bajo "Actualizar memoria ahora": "La siguiente respuesta puede tardar más. Conviene
  usarlo al terminar de chatear."; el texto de "sin recuerdos" ya no dice que se
  generan solos. Al activar la casilla se guarda el ajuste y el marcador de disparo
  del chat abierto se fija a su conteo actual de mensajes (sin extracción
  retroactiva inmediata). Es una casilla nativa (no hay componente "interruptor"
  en el proyecto); se conservan las pantallas internas de la hoja (no usa
  `app.confirmDialog`).

**Limitación conocida (Inferencia):** el marcador solo se ajusta en el chat abierto
al activar. Otros chats del mismo personaje conservan su marcador antiguo; si ya
acumulaban ≥20 mensajes desde él, tras activar la opción la extracción se disparará
en el siguiente mensaje que se envíe en ese chat (con la ventana de los últimos 10
mensajes). Es el comportamiento de siempre para un chat "vencido"; no se cambió.

**Verificación (Hecho).** 187 tests en verde (nuevos: default y saneado de
`lorebookAuto`, Settings sin el campo, copia v2 sin el campo; con `false` cruzar el
umbral no dispara ni guarda ni avanza el marcador; con `true` sí; la manual funciona
con ambos valores). En el navegador integrado (375×812): casilla visible y apagada
por defecto, avisos legibles; al activarla el ajuste se guardó (`true`) y el
marcador del chat de prueba pasó a 25 (= mensajes del chat); se volvió a apagar y se
limpiaron los datos de prueba. **No probado:** teléfono/APK; el efecto de latencia
real en el teléfono.

**Pendiente de evaluación (sin contrato):** opción 2 (extraer sobre el prefijo del
chat; medir calidad, VER-004) y opción 4 (espaciar el disparo o dispararlo al salir
del chat).

## MEM-003: recuerdos concretos, con keys útiles y sin duplicados (2026-09-24)

**Estado:** implementado; 207 tests en verde (187 + 20); probado contra el servidor real y
en el navegador integrado (375×812). **NO probado en el teléfono/APK.** **Hecho** = medido
aquí; **Inferencia**; **Supuesto**.

### Qué se hizo (`www/js/api/lorebook.js`, `www/js/ui/chat.js`)
1. **Prompt de extracción:** hechos concretos en tercera persona que nombren a AMBOS
   ("Sam told Mia that the dog Bruno is afraid of thunder", ejemplo sintético), sin
   "I/my/he/she/they/the user"; 1 a 3 keys de UNA palabra, sin nombres ni genéricas. Se
   conservan: una línea, ≤3 entradas, ≤140 caracteres, idioma de la charla, prefill `[`.
2. **`normalizeLoreKeys(keys, content, {names})`** (pura; solo `auto`, nunca lo escrito a
   mano): divide frases en palabras, quita stopwords (en/es), nombres, genéricas y <3 letras;
   sin duplicados (sin acentos, se guarda con ellos); máx. 4; si no queda ninguna, deriva 2
   del contenido (las más largas). Escrituras no latinas se dejan tal cual.
   **Genéricas** (forma base; también `s/es/d/ed/ing`): personality, person, people, user,
   character, characteristic, trait, fact, emotion, feeling, feel, thing, like, love,
   enjoy, memory, note, info, information; personalidad, persona, usuario, personaje,
   caracteristica, rasgo, hecho, emocion, sentimiento, cosa, gusta(n), encanta(n), disfruta, quiere.
3. **Hechos sin nombre:** `isUnnamedPronounFact` descarta un hecho `auto` cuyo sujeto es
   he/she/they/él/ella/ellos/ellas y no menciona ningún nombre. **Decisión mía, medida:**
   añadí la primera persona (I, we, my, yo, mi…) porque en la 1.ª ronda con el servidor 3 de
   39 salieron como "My neighbor Marta lent me her ladder". "El" sin acento es artículo y
   NO cuenta. También se descartan hechos de <3 palabras.
4. **Inyección — hallado:** `selectLoreEntries` comparaba por SUBCADENA ("art" coincidía con
   "start"). Ahora es por palabra completa, sin mayúsculas ni acentos, plurales `s/es`
   ("hand"~"hands"), keys de varias palabras contiguas, keys no latinas como subcadena.
   No se cambió nada más (tope, orden).
5. **Fusión** (`areNearDuplicates`, `mergeNearDuplicates`): solapamiento sobre palabras de
   contenido **≥ 0,6 y ≥ 2 compartidas** (valor sugerido, sin cambios: los 4 recuerdos reales
   de "physical touch" dan 0,67 y 1,0; hechos distintos, 0–0,25). Se conserva el contenido
   con más palabras, se unen las keys. Nunca interviene una `manual`. `applyExtraction`
   conserva su ruta de siempre (misma key y ≥50 % → el nuevo reemplaza) y añade la
   fusión sin key en común. **Límite (Inferencia):** dos hechos cortos sobre el mismo
   sujeto ("Bruno loves the park" / "Bruno fears thunder") solapan 0,67 y se fusionarían,
   perdiendo uno; subir el umbral rompe el caso obligatorio. Es deshacible.
6. **"Limpiar recuerdos"** (`cleanupLorebook`, `cleanStoredLorebook`, botón en la hoja):
   normaliza keys y fusiona SOLO las `auto`; guarda antes el estado en `lorebookPrevious`
   (se deshace); sin cambios NO escribe; no usa el servidor; "Limpié N recuerdos y fusioné
   M". Nunca borra nada que no se fusione (una entrada con pronombre sin parecido se conserva).

### Medición contra el servidor real (Hecho; KoboldCpp 1.121, Mahou 12B)
3 conversaciones SINTÉTICAS de 12 mensajes (usuario "Sam", personaje "Mia"), 15 corridas por
prompt, sin entradas previas, todas juzgadas con la misma higiene nueva. Scripts desechables.

| | Anterior | Nuevo (1.ª ronda) | Final |
|---|---|---|---|
| Corridas sin parsear | 0/15 | 0/15 | 0/15 |
| Entradas guardadas / nombran a Sam o Mia | 40 / 29 (73 %) | 39 / 36 (92 %) | 39 / **39 (100 %)** |
| Con ≥1 key que aparece en la charla | 34 (85 %) | 37 (95 %) | **38 (97 %)** |
| Keys que eran frases | 34 de 70 | 2 de 90 | **0 de 95** |

Con el prompt anterior salían fragmentos sin sujeto ("a golden retriever"); con el nuevo no.
**Residual:** 2–3 keys pegadas ("plumjam"), un error de tecleo ("bruino") y algún hecho
vago. Extracción media 5,4 s (antes) y 5,6 s (ahora). **No medido:** efecto en la latencia
del chat (no cambió el número ni el lugar de las llamadas; la automática sigue apagada).

### Verificación
- Tests: `normalizeLoreKeys`, pronombres, palabra completa, fusión (caso obligatorio, hechos
  distintos, `manual` intacta), las **7 entradas reales** del tester (U y C) → 4 o menos con
  `["factory","scent"]` y `["clumsy","technology"]`, y `cleanStoredLorebook` con el estado
  real (copia en `lorebookPrevious`, el deshacer restaura). Tres tests antiguos usaban datos
  artificiales que hoy incumplen el contrato a propósito (hechos de 1–2 palabras, keys de 2
  letras, 6 "hechos" casi idénticos): se cambiaron por contenido realista.
- Navegador (375×812): 7 automáticas + 1 manual → "Limpié 4 recuerdos y fusioné 3"; la manual
  intacta; "Deshacer" devolvió las 8 originales. Sin errores de consola; datos borrados.
- **No probado:** teléfono/APK; disparo automático; el efecto sobre lo que Mia responde.
**Sugerencia para la card:** ninguna. **Pendiente:** "siempre presente" (MEM-004).

## MEM-004: recuerdos "siempre presentes" y colocación que no invalida la caché (2026-09-24)

**Estado:** implementado; 226 tests en verde (207 + 19); Paso 0 y pruebas de estilo contra el
servidor real; hoja verificada en el navegador (375×812). **NO probado en el teléfono/APK.**

### Paso 0 — latencia de la SIGUIENTE respuesta (Hecho; KoboldCpp 1.121, Mahou 12B, `/v1/chat/completions`)
Historial sintético con la card de Mia; cada medida = "prima" la caché con el turno anterior y
mide el primer token del siguiente (5 repeticiones por celda; la varianza fue ≤0,1 s, el
procesamiento del prompt es determinista). Bloque de ~500 caracteres; solo cambia el bloque.

| Caso (turno anterior → medido) | ~2 440 tokens | ~4 020 tokens |
|---|---|---|
| a: cabecera, sin cambios | 1,1 s | 1,2 s |
| b: cabecera, bloque DISTINTO | **22,5 s** | **40,1 s** |
| b0: cabecera, aparece un bloque (antes vacío) | 22,4 s | 39,6 s |
| c1: al final (en el último mensaje del usuario), bloque distinto | 2,2 s | 2,4 s |
| c2: al final como `system` intercalado, bloque distinto | 2,2 s | 2,5 s |
| c1_0: al final, aparece un bloque | 1,7 s | 1,9 s |

Conclusión: (b) penaliza ≫3 s y crece con el chat; (c) queda a ~1 s de (a). Se cumple la
condición del contrato → **el bloque "por tema" va al final**. Coincide con MEM-001 v2 (~20 s).
Alternativa `system` intercalado (c2): misma latencia; no se eligió porque el contrato pide no
asumir que la plantilla lo admite (no se verificó con otras plantillas).

### Decisión de colocación y por qué
- **Siempre presentes → cabecera** (`loreBlock`, 5.º parámetro de los builders): es estable.
  Cada vez que el usuario lo edita, UNA respuesta paga la relectura (~22–40 s); la hoja lo avisa.
- **Por tema → final** (`topicBlock`, 6.º parámetro), solo en el prompt construido:
  - Plantilla: se antepone al contenido del ÚLTIMO mensaje `user` de la copia enviada
    (`[Known facts (from memory):\n- …]\n\n<mensaje>`). Sin mensajes `system` intercalados.
  - Texto simple: línea entre corchetes justo antes de la última línea del usuario.
  - Los mensajes guardados no se tocan (test) y el presupuesto del historial descuenta el bloque.
- **Ejemplo (texto simple / plantilla)**, con 1 siempre presente y 1 por tema:
  `…Always keep in mind:\n- Sam gets anxious in crowded places…\n\n[Start of chat]\nMia: *I smile.* Hi Sam.\n[Known facts (from memory):\n- Sam told Mia that the dog Bruno is afraid of thunder]\nSam: Thunder shook the house…\nMia:`
  y `[system] …Always keep in mind:\n- …` · `[user] [Start of roleplay]` · `[assistant] *I smile.* Hi Sam.` ·
  `[user] [Known facts (from memory):\n- …]\n\nThunder shook the house…`.

### Diseño e implementación
- `LoreEntry.always?: boolean` (`state.js`): solo se guarda `true`; una `always` es siempre `manual`
  (también al importar). Entradas y copias sin el campo cargan idénticas (tests).
- `LOREBOOK_ALWAYS_CHAR_BUDGET` = 500; `LOREBOOK_TOTAL_CHAR_BUDGET` = 1200; el tope "por tema"
  sigue en 1000 pero baja a `1200 − usado por las siempre presentes` (con 500 usados, 700).
  **Sin siempre presentes nada cambia** (1000). Si no caben, la primera que no cabe y las
  siguientes NO se envían y la hoja lo avisa. `estimateContextUsage` suma el bloque real y reserva
  el "por tema".
- Nunca las toca la vía automática (aplicar, fusionar, limpiar, expulsar por tope) ni la marca.
- Hoja: secciones "Siempre presentes" (contador "N / 500") y "Por tema"; interruptor "Siempre
  presente (Mia lo tiene en mente siempre)" en Editar (casilla nativa). No se puede crear una
  entrada desde cero (solo editar existentes; sin cambio).
- Sin entradas el prompt es idéntico: fuzz de 600 casos × 5 comparaciones contra la versión
  anterior (git) más un test con valores literales.

### Pruebas de estilo (Hecho; 10 corridas por celda, `/v1/chat/completions`, card de Mia)
- Bloque por tema al final: recuerda el nombre del perro 10/10 y el instrumento 10/10 (sin
  bloque, 10/10 y 0/10: el perro ya salía del historial); no lo menciona sin venir a cuento
  0/10; formato (1 párrafo, asteriscos pares, sin eco del bloque) 30/30; largo medio 112 vs 109.
  Un texto alternativo ("use naturally, never quote") dio lo mismo → se dejó el actual.
- Texto simple (bloque final): recuerda 10/10 (sin bloque 0/10), formato 10/10.
- Siempre presente en la cabecera: 0/10 de repetición forzada en un tema ajeno; formato 19/20
  (una respuesta con un asterisco suelto; ruido a este tamaño). **Su efecto positivo NO se
  demostró** con la prueba usada: sin él, Mia ya aludía a la multitud 7/10 por su card (con él, 8/10).

### Verificación
Tests nuevos: `always` por defecto/saneado/`manual`/copias previas; selección con presupuestos,
orden, desborde y suma ≤1200; sin duplicar entre bloques; la vía automática no las toca; prompt
idéntico sin entradas y colocación en ambos modos con mensajes guardados intactos. Navegador
(375×812): secciones, contador, aviso de desborde, interruptor guardado, indicador de contexto
con la reserva. **No probado:** teléfono/APK; otras plantillas de modelo; el efecto real en Mia.
**Sugerencia para la card (no aplicada):** ninguna.

## MEM-005: keys que reflejan cómo habla el usuario y fusión de paráfrasis (2026-09-24)

**Estado:** implementado; 245 tests en verde (226 + 19 entre MEM-005 y FMT-004). Medido contra el servidor
real (KoboldCpp 1.121, Mahou 12B, `/api/v1/generate`). **NO probado en el teléfono/APK.**

### Bug de fusión: causa real (Hecho, reproducido con datos sintéticos)
El contrato suponía que la fusión estaba condicionada a "sin key en común". **No es así**: `applyExtraction` ya
comparaba por contenido también con la misma key, y `mergeNearDuplicates` ignora las keys. La causa era que la
comparación de contenido veía "invite" e "invited" como palabras distintas (`stemLite` solo quitaba `s`). Caso
mínimo, mismas keys `coffee, date`: "Sam did not invite Mia to a coffee date" / "Sam has never invited Mia out
for coffee" → 1 palabra compartida de 3 (0,33 < 0,6) → dos entradas. Con el mismo caso y "invited" en ambas,
sí se fusionaba. **Límite:** no vi las dos entradas reales del tester (solo su captura descrita), así que la
causa está reproducida con frases sintéticas equivalentes (Inferencia de que era esa en su caso).

### Corrección (`www/js/api/lorebook.js`)
1. `stemLite` (solo para comparar, nunca se guarda) ahora también quita `ed`/`ing`, una `e` final y desdobla la
   consonante doble: invite/invited/inviting → "invit". Con eso el caso mínimo da 2/3 y se fusiona.
2. Mismas keys (2 o más, en cualquier orden) → umbral de solapamiento 0,5 en vez de 0,6
   (`LOREBOOK_MERGE_OVERLAP_SAME_KEYS`; `areNearDuplicates(a, b, names, {keysA, keysB})`), tanto al extraer
   (`applyExtraction`) como en "Limpiar recuerdos" (`mergeNearDuplicates`). Con UNA sola key no cambia nada.
3. **Caso obligatorio de MEM-003 intacto:** los 226 tests anteriores pasan sin tocarlos; hechos distintos
   ("Bruno barks loudly" / "Bruno sleeps all day", perro vs. lago) siguen sin fusionarse.

### Prompt de extracción (final)
Sobre el de MEM-003 solo cambia la instrucción de keys: "1 to 3 keywords about its topic: single lowercase words…
Then, if {U}'s own lines in the excerpt contain a distinctive noun or verb about that fact, add 1 more keyword
copied EXACTLY as {U} wrote it; if there is no clear one, skip it." El ejemplo pasó a
`{"k":["bruno","thunder","hides"],…}`. Máximo de keys: 4 (3 del tema + 1 del usuario).
`normalizeLoreKeys` NO necesitó cambios (verificado con test: hands, kiss, touch, whisper, squeeze, hug no son
genéricas; nombres y palabras de 1 letra siguen fuera). Nota: "love"/"like" siguen siendo genéricas a propósito.

### Residual de primera persona
Medido: 0 de 87 hechos con I/my/me/we en las 18+18 corridas (MEM-003 ya descartaba el sujeto pronombre sin
nombre). Como red de seguridad añadí `hasFirstPersonVoice` (I, me, my, we, our, yo, mi, nosotros…, FUERA de
comillas): `normalizeIncoming` descarta un hecho `auto` que la cumple aunque nombre a ambos ("Sam told Mia that my
dog…"). Con test de falsos positivos ("Milan", "mint", una cita entre comillas). Es una decisión mía, no medida.

### Medición contra el servidor real (Hecho)
3 conversaciones SINTÉTICAS de 12 mensajes (Sam, frases cortas en 2.ª persona con acciones físicas; Mia), 6 rondas
× 3 conversaciones = **18 corridas por prompt**, alternando prompts, sin entradas previas, misma higiene para juzgar.
Métrica: qué fracción de las keys resultantes aparece literalmente (sin acentos, plural/`ed`/`ing`) en los mensajes
del USUARIO.

| | Anterior | Nuevo (final) | Variante B* |
|---|---|---|---|
| Corridas / sin parsear | 18 / 0 | 18 / 0 | 18 / 0 |
| Entradas (por corrida) | 43 (2,4) | 44 (2,4) | 39 (2,2) |
| Keys por entrada | 2,2 | 2,9 | 2,5 |
| Keys literales en mensajes del usuario (ventana) | 84/95 = **88 %** | 124/129 = **96 %** | 86/98 = 88 % |
| Keys literales en los ÚLTIMOS 3 mensajes del usuario | 20/95 = **21 %** | 36/129 = **28 %** | 12/98 = 12 % |
| Entradas que nombran a Sam o Mia | 100 % | 98 % | 100 % |
| Hechos en primera persona | 0 | 0 | 0 |
| Extracción media | 7,3 s | 7,0 s | 5,5 s |

*Variante B: "prefiere las palabras exactas de Sam sobre sinónimos"; peor, se descartó.
**Lectura honesta:** la mejora es real pero moderada (+8 y +7 puntos, muestra chica). La mayoría de las keys ya
salían de la conversación; y el límite mayor es que los hechos suelen venir de mensajes antiguos, así que una key
no reaparece en los 3 últimos mensajes aunque sea literal. Los datos sintéticos no incluyen "hands/kiss/touch"
como hechos; el efecto sobre el habla real del usuario **no está medido**. Los scripts eran desechables (en `/tmp`).

### Tests nuevos (`tests/lorebook.test.mjs`)
Paráfrasis coffee/date en dos extracciones, en la misma pasada y en "Limpiar recuerdos" (con un hecho distinto
que se conserva); umbral 0,5 solo con 2+ keys iguales; `hasFirstPersonVoice`; key literal del usuario conservada.
Tests antiguos ajustados: ninguno. **Pendiente:** probar en el teléfono; medir con habla real del usuario.
**Sugerencia para la card:** ninguna.

## FMT-004: repetición temática del personaje — detector y ayuda opcional (2026-09-24)

**Estado:** implementado y **apagado por defecto** (`Settings.varietyAssist`); medición **no concluyente**.
Tests en verde (incluidos `tests/variety.test.mjs`, 11, y el saneado en `state.test.mjs`). **NO probado en el teléfono.**

### Qué se hizo
- `www/js/api/variety.js` (puro): `themeWords` deriva del propio personaje las palabras que aparecen en ≥2 de sus
  últimos 3 turnos (raíces de 4+ letras, sin stopwords ni nombres; sin lista fija); `detectRepetition` marca una
  respuesta si reutiliza ≥2 de esas palabras; `varietyNeeded(messages)` mira el ÚLTIMO turno contra los 3 anteriores.
  Con menos de 3 turnos previos no marca nada. Calibrado con tests: eje repetido → sí; otro tema → no; un rasgo
  constante con una sola palabra suelta ("curious") → no; otro personaje (cocinero) → igual.
- **Opción implementada: (a) proactiva.** Si `varietyAssist` está activo y `varietyNeeded`, `generateReply` añade
  `[Note: vary your wording…]` (`VARIETY_NOTE`, genérica, sin nombrar a nadie) al FINAL del prompt, junto al bloque
  "por tema" (`prompt.js`, 7.º parámetro `varietyNote`). Solo en el prompt construido; los mensajes guardados no se
  tocan; sin nota el prompt es idéntico (test). **(b) regenerar** no se implementó en la app: obligaría a mostrar
  texto en streaming y luego reemplazarlo; solo se simuló en la medición.
- Ajustes: casilla "Ayuda a que las respuestas no se repitan" (`settings.js`); `state.js` la sanea (solo `true`
  estricto; copias previas cargan en `false`).
- **Toqué `www/js/api/kobold.js`** (no estaba en el alcance escrito, pero `generateReply` es quien arma los prompts).
- Card de Mia: NO tocada.

### Medición (Hecho, pequeña) — card SINTÉTICA "Tessa" (bibliotecaria "curiosa", `mes_example` con explore/learn/discover)
18 turnos de usuario que cambian de tema, `/v1/chat/completions`, formato del chat real. Eje = explor/learn/discover/
grow/understand/journey/curio/wonder/adventure/fascinat. Ronda 1 completa (4 condiciones × 18 turnos; se miden los
turnos ≥3 → 15 respuestas por condición):

| Condición | Con ≥1 palabra del eje | Con ≥2 | Media por respuesta | Marcadas por el detector | Largo | Formato ok |
|---|---|---|---|---|---|---|
| Base (sin nota) | 40 % | 7 % | 0,47 | 0 % | 233 | 100 % |
| Proactivo (con detector) | 33 % | 20 % | 0,73 | 0 % | 255 | 93 % |
| Nota siempre puesta | 33 % | 13 % | 0,53 | 100 % nota | 315 | 87 % |
| Regenerar una vez | 27 % | 7 % | 0,33 | 0 % | 224 | 100 % |

Ninguna respuesta repitió el texto de la nota. El proactivo nunca se activó (el detector no marcó ningún turno),
así que sus números son ruido. **Conclusión: no concluyente.** Una primera pasada con otra card sintética (botánica,
antes del cierre del PC; solo se conservan los números de la consola) dio base 45 respuestas: 56 % con ≥1 palabra del
eje y 2 % marcadas: tampoco reproduce el problema de Mia (~2 palabras del eje por respuesta hacia el mensaje 20–40).
La ronda 2 NO se ejecutó (ver abajo). Latencia: la nota va al final; la generación tardó 2,9 s (base) vs 4,6 s
(nota siempre; respuestas más largas), no medí el efecto de caché (no hace falta: solo aparece si se activa).

### Ronda detenida por memoria (decisión del usuario, 2026-09-24)
Un cierre del PC durante una medición anterior llevó a vigilar `free -m` entre pasadas (una sola petición a la
vez, escritura a disco tras cada respuesta). Memoria usada (MB): antes 5072 → base 5133 → proactive 5165 → always
5209 → regen 5215 (+143 en 4 pasadas, frenándose: +6 en la última). Cada pasada era un proceso nuevo, así que no es
una fuga del script; sospecha (Inferencia) de otros programas del PC. Se paró por la regla acordada y no se siguió:
con esta card 18 turnos no reproducen el problema, y repetir la ronda no lo arreglaría.

### Conclusión y sugerencias
`varietyAssist` queda apagado por defecto. Para decidir hace falta una prueba con conversaciones largas (40+ turnos)
(ver Pendientes de `NOTES.md`). **Sugerencia para la card de Mia (NO aplicada, no medida):** un segundo `mes_example`
con otro tono (sin explore/learn/understand) probablemente reduciría el sesgo del vocabulario a coste cero de código.

## FMT-002: medir y reducir los fallos de asteriscos en la generación (2026-09-25)

**Estado:** implementado; `Settings.formatAssist` **activa por defecto** (la medición lo justifica). **NO probado en el teléfono.**
Tests en verde (292). Código: `api/formatcheck.js` (validador), `prompt.js` (parámetro `prefill`), `kobold.js` (`generateReply`),
`state.js`, `ui/settings.js` (casilla "Ayuda de formato de Mia"). Card de Mia: NO tocada.

### Validador (`www/js/api/formatcheck.js`, puro, 14 tests)
V1 asteriscos simples impares (los `**` aparte; un `*` aislado entre espacios no cuenta); V2 ≥2 frases sin ningún asterisco;
V3 hay `**`; M1 `startsOutside` (métrica, no error); **V4 (heurística)** la respuesta empieza fuera de asteriscos con una
frase que parece narración ("My eyes widen and I smile."). V4 medida: **0 falsos positivos en 83 tramos de habla** (`mes_example` y
`first_mes` de la card de Mia + tramos fuera de asteriscos de las respuestas bien formadas de la condición B) y los dos
ejemplos del contrato se distinguen (narración inicial → V4; "Oh dear, I hope I didn't cause any confusion!" → no). Recall ≈63 %
(26 de 41 respuestas que empezaban fuera de asteriscos; el resto, en su mayoría, ambiguas o habla): es una COTA INFERIOR.

### Paso 0 — medición contra el servidor real (Hecho; conversaciones SINTÉTICAS y neutras, card de Mia, KoboldCpp local)
Modo por defecto ("plantilla"), `ctx` 6144, autojuego (cada respuesta entra al historial). Ronda 1: 6 charlas × 10 turnos,
mensajes de usuario cortos. **Ronda 2 (más parecida al uso real):** 3 charlas × 25 turnos, mensajes de usuario largos con
acciones. C2 = recordatorio reformulado tras ver que C empeoraba. `finish=length` (cortada por el límite de 160 tokens): solo 1 de
los 11 V1 de A en la ronda 2 → el corte por longitud NO es la causa principal.

| Ronda 2 (n=75) | V1 | V2 | V3 (`**`) | V4 | **V1+V2** | **algún fallo** | empieza fuera (M1) | largo | 1.er token | total |
|---|---|---|---|---|---|---|---|---|---|---|
| A base | 11 | 0 | 39 | 10 | 11 (15 %) | 48 (64 %) | 56 % | 293 | 609 ms | 3,96 s |
| **B arranca en `*`** | **0** | **0** | **0** | **0** | **0 (0 %)** | **0 (0 %)** | 0 % | 286 | 603 ms | 3,85 s |
| C2 recordatorio al final | 15 | 0 | 40 | 4 | 15 (20 %) | 43 (57 %) | 43 % | 235 | 1492 ms | 4,20 s |
| D historial contaminado (n=66) | 13 | 1 | 35 | 10 | 14 (21 %) | 48 (73 %) | 61 % | 295 | 2524 ms* | 5,88 s* |

| Ronda 1 (n=60; D n=42) | V1 | V2 | V3 | V4 | V1+V2 | algún fallo | largo | 1.er token |
|---|---|---|---|---|---|---|---|---|
| A base | 1 | 0 | 4 | 23 | 1 (2 %) | 27 (45 %) | 271 | 379 ms |
| B arranca en `*` | 0 | 0 | 0 | 0 | 0 | 0 (0 %) | 250 | 380 ms |
| C recordatorio (1.ª redacción) | 6 | 3 | 22 | 3 | 9 (15 %) | 30 (50 %) | 225 | 1151 ms |
| D contaminado | 5 | 1 | 4 | 13 | 6 (14 %) | 20 (48 %) | 297 | 1829 ms* |

\* D cambia un mensaje antiguo del historial, así que invalida la caché del servidor: su latencia NO es representativa.
**Modo "texto simple"** (2 charlas × 20 turnos, n=40 por condición): A 0/40 fallos y B 0/40; largo 202 vs 246. En ese modo
el modelo ya arranca bien solo (M1 0 %); el prefill no hace falta ahí, pero no daña.

Lectura (Hecho salvo donde se indica):
- **B elimina TODOS los tipos de fallo medidos** (0/135 respuestas en las dos rondas) y además elimina las comillas del habla
  (A usó comillas en 35 de 75 respuestas; la card pide "sin comillas") y las envolturas `**…**` (V3, 52 % de A en la ronda 2).
  Sin cambio de latencia (1.er token 603 vs 609 ms; total 3,85 vs 3,96 s) ni de largo (286 vs 293; −8 % en la ronda 1).
- **C (recordatorio) empeora**: más `**`, respuestas que "reconocen" el recordatorio ("[Reminder acknowledged.]"), y el
  1.er token tarda +0,5–0,9 s (el texto extra en el último mensaje del usuario rompe la caché de prefijo) → descartado.
- **La tasa de V1+V2 (contrato) depende mucho de la muestra:** 2 % con mensajes cortos, 15 % con los largos y ricos en
  acciones. En ambos B llega a 0 y la reducción (≥ la mitad) se cumple; con la ronda 1 sola no habría poder para decidirlo.
- **Contagio (D):** ronda 1 14 % frente a 0 % de A en los mismos turnos (6/42 vs 0/42); ronda 2 21 % frente a 17 % (14/66 vs
  11/66). Sugiere un contagio leve, pero NO lo demuestra (muestra pequeña, resultados dispares). No hay efecto claro de la
  posición: V1+V2 en la ronda 2 por tercios 3/24, 4/27, 4/24 (sin tendencia; los datos reales del usuario tampoco son concluyentes).
- **Coste de B (Inferencia, a vigilar en el teléfono):** toda respuesta ahora empieza con una acción (el formato Nomi permite
  empezar con habla). Puede sentirse más uniforme; por eso hay interruptor.

### Implementación
`formatAssist` (`true` por defecto; copias y ajustes antiguos sin el campo cargan en `true`; solo un `false` estricto la apaga).
Con ella: en modo plantilla se envía un último mensaje `assistant` con `*` (KoboldCpp 1.121 lo CONTINÚA: verificado, incluso con
un texto de prueba); en texto simple el prompt termina en `\nMia: *`. `generateReply` antepone el `*` al texto mostrado y
guardado solo cuando llega texto (una respuesta vacía sigue vacía y `generateReplyNonEmpty` la reintenta igual; si el modelo
ya abre su propia `*` no se duplica). El `stop` con `"\n"` no cambia. Los mensajes guardados no se tocan en el prompt.
### Opciones descartadas / para el arquitecto
- **Regeneración automática** por fallo de formato: NO implementada (costaría ~4-6 s en las respuestas afectadas; con B ya no hace falta).
- Recordatorio al final del prompt (C/C2): descartado (empeora y añade latencia).
- **Hallazgo:** en "texto simple" los fallos medidos fueron 0/40 frente a 64 % en plantilla (ronda 2). Es una alternativa, pero el
  usuario eligió plantilla por calidad de rol y no se midió esa calidad; no se cambia el defecto.
- **Sugerencia para la card de Mia (NO aplicada):** más turnos de `mes_example` que muestren la alternancia acción/diálogo sin `**`.
- El corte a 160 tokens casi nunca es la causa de un `*` impar (1 de 11), así que no se añadió recorte por `finish_reason`.
Scripts de medición desechables (fuera del repo); datos sintéticos, sin contenido de chats reales.

## FMT-003: renderizado tolerante de asteriscos (2026-09-25)

**Estado:** implementado, SOLO visual. Verificado en el navegador integrado; **NO probado en el teléfono.**
- `format.js`: `formatMessage(text, { role })` y `normalizeCharAsterisks(text)` (pura, lineal, sin regex con retroceso).
  Con `role:'char'`: N1 `**`→`*`; N2 una `*` que parece apertura (tras `.`/`!`/`?`/`…` y espacio, y antes de una letra) dentro
  de una cursiva abierta cierra la anterior; un cierre sin apertura y una `*` suelta al principio o al final se ocultan. Solo
  se repara si hay número impar de `*` o una apertura dentro de otra (el resto queda como antes). "5 * 3" sigue literal; una
  cursiva abierta al final (streaming) sigue en cursiva. Usuario o sin rol: comportamiento anterior (incluidas las negritas).
- `chat.js`: pasa el rol en las 2 llamadas (burbuja normal y burbuja en streaming). No se toca `messages` ni lo enviado al modelo (test).
- **Decisión** (leve ampliación del contrato): la regla "apertura dentro de una cursiva abierta" también se aplica con número
  PAR de asteriscos (`*A. *B.* C.*`); si no, durante el streaming el par se invertía hasta que llegaba el siguiente `*`.
- Casos (23 tests nuevos: 16 casos de tabla + 7 pruebas): impar a mitad de mensaje, par con nueva apertura tras `.`/`…`, envoltura `**…**` con simples, `*` suelto
  al final / al principio, "5 * 3", streaming (cursiva abierta, apertura vacía, par roto), sin asteriscos, formato correcto, `**` en
  usuario, HTML escapado, mensajes congelados sin cambios, rendimiento.
- **Rendimiento (Hecho, PC):** 200 mensajes de 700 caracteres: 0,69→1,59 ms (bien formados) y 0,55→2,01 ms (rotos): ≈+1,5 ms por lista completa.
- Navegador integrado (375×812): mensajes con `*` rotos se ven limpios; "5 * 3" del usuario literal; la casilla de Ajustes guarda y restaura.

## UI-011: quitar los deslizadores de longitud y creatividad de Ajustes (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812): Ajustes sin deslizadores, `maxLen`/`temp` intactos en el estado. **NO probado en el teléfono.**
- `ui/settings.js`: se eliminaron los dos campos ("Longitud de respuesta" y "Creatividad"), sus referencias, los temporizadores de
  guardado, `clamp` y `SLIDER_DEBOUNCE_MS` (ya sin uso). Nada más de Ajustes cambió.
- **NO se tocó** `state.js` (esquema y valores por defecto iguales: `maxLen` 220, `temp` 0.85 y lo que cada usuario ya tuviera
  guardado) ni `api/kobold.js` (sigue enviando `settings.maxLen`/`settings.temp` en cada petición, líneas ~163, 250, 352, 368) ni
  el formato de backup: las copias v1/v2 con estos campos importan igual. Para reintroducir el control basta volver a pintar
  los dos `<input type="range">` y guardar con `saveSettings({ maxLen })` / `({ temp })`.
- Test nuevo (`kobold.test.mjs`): `generateReply` sigue enviando `maxLen`/`temp` en modo plantilla y texto simple.
- Motivo (decisión del usuario): el servidor los ignora (medido en MEM-001 v2, Paso 0) y nunca los usa.

## UI-013: hub, "Continuar" al chat más reciente y retrato a la lista de chats (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono.**
- Antes: el retrato y "Continuar" llamaban al mismo `open` (`navigate('chats', …)`). Ahora (`ui/home.js`): el retrato
  (`.home-card__avatar`, clic y teclado Enter/Espacio) sigue yendo a la lista de chats; "Continuar" llama a `continueTarget`.
- `www/js/nav.js` (nuevo, puro): `continueTarget(characterId, chats)` devuelve `{view:'chat', params:{chatId}}` con el chat de
  `updated` más reciente (empate: el primero de la lista, que `listChats` ya entrega ordenada) o, sin chats,
  `{view:'chats', params:{characterId}}`: esa vista ya crea un chat y entra directo (`chats.js` `show()`), así que el caso
  "personaje sin chats" se conserva sin tocar `chats.js`.
- `home.js` guarda la lista de chats por personaje en `buildLastPreviews` (la misma consulta `listChats` que ya hacía para la vista
  previa: sin consultas nuevas). El borrado y demás acciones de la tarjeta no cambiaron.
- Historial: "Continuar" apila `home → chat`, así que "atrás" desde ese chat vuelve al hub; el menú del chat conserva
  "Volver a los chats de este personaje".
- **Verificado (Hecho, navegador integrado):** con un personaje de 2 chats, "Continuar" abrió el más reciente (no el primero
  creado); el retrato abrió la lista con ambos; "atrás" volvió al hub; con un personaje sin chats "Continuar" creó 1 y entró.
- Tests: 4 nuevos en `tests/nav.test.mjs` (varios chats, uno, ninguno/datos malos, empate).

## UI-014: el botón "atrás" de Android navega dentro de la app (2026-09-25)

**Estado:** implementado. **Verificado solo en el navegador con un plugin simulado; NO probado en un Android real.**
- **Hecho (leído):** antes no había ningún listener de `backButton`. `main.js` ya llevaba la navegación con el historial del
  navegador (`pushState` por vista y por hoja abierta); sin el plugin, Capacitor decide por su cuenta qué hace "atrás".
- `package.json`: añadido `@capacitor/app` (`^6.0.1`, misma línea que el resto de Capacitor 6). No existe `package-lock.json` y el CI
  usa `npm install` antes de `npx cap add android`/`cap sync`, así que el plugin entra en el APK sin más cambios (Inferencia: el
  CI no se ha ejecutado con este cambio todavía).
- `nav.js` (puro, probado): `decideBack({ sheetOpen, view })` → `'close-sheet'` (hoja o diálogo abierto), `'back'` (vista `chat`
  o `chats`) o `'exit'` (raíz: `home` o `setup`, o sin vista activa, p. ej. con el PIN de bloqueo puesto).
- `main.js`: `registerAndroidBack()` registra `App.addListener('backButton', …)` solo si existe `Capacitor.Plugins.App` (en el
  navegador no hace nada). Acciones: cerrar la hoja con `shell.closeSheet()` (que ya devuelve su entrada de historial); retroceder
  con `back()` = `history.back()`, o sea lo mismo que la flecha de la barra superior (el chat ya guarda y cancela en `hide()`);
  salir con `App.exitApp()` solo en la raíz. Protecciones: 300 ms entre pulsaciones y no actuar mientras una vista se abre desde el
  historial (evita saltar dos pantallas), y una red de seguridad: si `history.back()` no produce ningún cambio en 400 ms, va al hub
  (con reemplazo) en vez de quedar sin respuesta.
- `shell.js`: nueva `isSheetOpen()`. La flecha propia de la interfaz no cambió.
- **Verificado (Hecho, navegador 375×812 con `Capacitor.Plugins.App` simulado en una página temporal, ya borrada):** chat→lista→hub
  con dos "atrás"; en el hub, un "atrás" llama a `exitApp` una vez y la app sigue en el hub; con una hoja abierta (menú del chat)
  el primer "atrás" solo la cierra y el segundo cambia de pantalla; un diálogo de "Borrar personaje" se cancela sin borrar nada;
  3 pulsaciones seguidas dan un solo paso; con `history.back` anulado, "atrás" en un chat va al hub. Sin el plugin (navegador
  normal), la flecha y `history.back()` funcionan como antes.
- **NO verificado (requiere el teléfono):** que el APK lleve el plugin y que `Capacitor.Plugins.App` se rellene como los otros
  plugins; que un gesto de "atrás" real llegue al listener; salir de la app desde el hub; el comportamiento con el teclado abierto.
- Tests: 3 nuevos en `tests/nav.test.mjs` (`decideBack`).

## UI-010: indicador de memoria usada por mensaje (2026-09-25)

**Estado:** implementado; **NO probado en el teléfono.** Sin cambios de latencia: la selección ya se calculaba antes de llamar al servidor; solo se guarda.
- **Captura** (`api/lorebook.js`): `buildLoreBlocks` devuelve además `used: LoreUsed[]` = las "siempre presentes" que caben en su tope y las
  "por tema" que coinciden y caben en el presupuesto, o sea lo que REALMENTE viaja en el prompt (no las candidatas). Son COPIAS
  (`toLoreUsed`: `{id, keys, content, always}`). La lógica de selección y de presupuestos (MEM-004) no se tocó. `generateReply` lo
  devuelve como `loreUsed` en sus 3 salidas (normal, abortada, cortada por red); `generateReplyNonEmpty` lo propaga.
- **Guardado** (`ui/chat.js`, `generate()`): `reply.loreUsed = result.loreUsed` (`[]` si ninguno). Regenerar lo recalcula. Si la respuesta se
  cancela antes de que `generateReply` devuelva, el mensaje queda sin `loreUsed` (sin dato → sin icono).
- **Esquema** (`state.js`): `Message.loreUsed?`. `sanitizeLoreUsed` (exportada) se aplica AL LEER en `getChatMessages` y solo toca ese campo:
  no es un array → sin dato; entradas inválidas se descartan; un array no vacío sin ninguna entrada válida → sin dato (mejor sin
  icono que uno falso); en mensajes de usuario se quita. El resto de campos y los mensajes sin el campo pasan idénticos; lo guardado en
  IndexedDB no se reescribe al leer. Copias v1/v2 sin el campo importan igual (test).
- **Visualización** (`chat.js` + `chat.css`): `loreIndicatorState(msg)` → `none` (sin icono: mensajes anteriores, del usuario), `muted`
  (`loreUsed:[]`, gris `--color-muted` con opacidad .55) o `active` (`--color-accent-2` del skin, relleno). Marcapáginas de 15 px bajo la burbuja,
  zona táctil 44×32 px. Tocarlo abre `app.openSheet` con el detalle: "Siempre presente"/"Por tema", contenido guardado, palabras clave y,
  si `compareLoreUsed` lo detecta contra el lorebook actual del personaje, "Este recuerdo fue editado o borrado después." (también si solo
  se marcó/desmarcó "siempre presente"). Tocar el icono no selecciona el mensaje.
- **Verificado (Hecho, navegador 375×812):** mensaje antiguo sin icono; `loreUsed:[]` gris; con recuerdos, de acento (nomi/glass `rgb(162,76,242)`, iMessage azul
  `rgb(64,156,255)`/`rgb(51,157,255)`, claro y oscuro); la hoja muestra los 3 recuerdos con los avisos de editado/borrado. **De punta a punta** con un
  servidor KoboldCpp simulado local: al enviar "Cuéntame de Bruno y el café" el mensaje nuevo se guardó con `loreUsed` = [l1 siempre presente, l2 por tema].
- Tests nuevos (9): `used` sin/con coincidencias y como copia; recorte por presupuesto (tema y siempre presentes); `loreIndicatorState`;
  `compareLoreUsed` (editado, borrado, contenido original conservado); guardado/lectura y saneado en `state`; `importBackup` con y sin campo;
  `generateReply` devuelve `loreUsed` (`[]` / entradas enviadas). Los tests con DOM (icono gris/coloreado) se cubren con la función pura + el navegador.

## UI-012: "Corregir formato automáticamente" y comillas como señal de diálogo (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono.** Solo visual: no cambia `messages`, lo guardado ni el prompt.
- **Nombre del interruptor (decisión final):** "Corregir formato automáticamente", con un texto de ayuda que dice lo que hace sin nombrar personajes.
  El campo interno `Settings.formatAssist` conserva su nombre (sin migración; copias antiguas cargan igual).
- **Hallazgo (código real vs. contrato):** `formatAssist` controlaba solo el ARRANQUE de la respuesta en `*` (FMT-002, en `kobold.js`); la reparación
  visual de FMT-003 nunca dependió de él (siempre activa). Comportamiento exacto con el interruptor APAGADO, que se conserva: la reparación de
  FMT-003 sigue activa igual que antes; lo único que el interruptor apagado desactiva de lo nuevo es la regla 2 (comillas). Con él encendido
  (por defecto) actúan las 4 reglas. `chat.js` pasa `quoteDialogue: settings.formatAssist !== false` (`formatOpts`); un cambio del
  interruptor se nota al volver a entrar al chat.
- **Reglas** (`format.js`, solo mensajes del personaje, decididas mensaje por mensaje, sin depender de qué personaje es):

| # | Condición (en este orden) | Resultado |
|---|---|---|
| 1 | asteriscos SIMPLES (rachas de exactamente un `*`; los `**` no cuentan) en número par y > 0 | emparejamiento de FMT-003, sin cambios (aunque haya comillas: quedan literales) |
| 2 | si no, y hay comillas (`"` `“` `”`; el apóstrofo no cuenta) | tramos entre comillas = diálogo normal (comillas ocultas); el resto = cursiva; todo `*` se oculta |
| 3 | si no, y hay algún asterisco (impar sin comillas, o solo `**…**`) | reparación best-effort de FMT-003 |
| 4 | sin asteriscos ni comillas (p. ej. Ani) | texto tal cual, sin cursiva ni transformación |

  Detalles de la regla 2: una comilla sin cerrar (streaming) deja el resto como diálogo; los tramos de solo espacios no se vuelven cursiva; el diálogo
  se escapa como HTML igual que todo. Con número IMPAR de `*` y comillas gana la 2 (p. ej. `*A. *B.* "C."` → `<em>A. B.</em> C.`), no la reparación de FMT-003.
- Tests (23 nuevos en `format.test.mjs`): tabla de 18 casos que cubre R1–R4 (incluido "estilo Ani"), interruptor apagado = resultado exacto de FMT-003,
  usuario sin cambios, mensajes congelados sin cambios, rendimiento (200 mensajes de ~700 caracteres < 400 ms).
- Navegador: `Sam smiles, then "Hi there. I missed you." and waves softly.*` → cursiva/diálogo/cursiva sin `*` ni comillas visibles; el mensaje con `*…*` bien
  emparejado y comillas se ve como antes; un mensaje estilo Ani ("hey you! i'm so happy…") idéntico; comillas tipográficas correctas; etiqueta nueva en Ajustes.
- **Para el arquitecto (fuera de este contrato, NO tocado):** `formatAssist` activo hace que `kobold.js` arranque TODA respuesta con `*`, sea cual
  sea el personaje (FMT-002 no distingue). A un personaje sin asteriscos (Ani) le empezaría cada respuesta dentro de una acción. Conviene decidir si
  el arranque en `*` debe depender del personaje (p. ej. por su `mes_example`) antes de que el usuario chatee con Ani con el interruptor encendido.
- **Riesgo conocido de la regla 2 (según contrato):** un mensaje sin asteriscos que cite algo entre comillas (`I love the "Mona Lisa" painting`) mostrará el resto en cursiva.

## MEM-006: "Estado de la relación" (2026-09-25)

**Estado final: implementado en su versión LOCAL, sin modelo (ver "Decisión final" al final de esta sección).** Primero se probó la versión con el modelo y se detuvo por la condición de parada del contrato; esa parte queda como historia.

### Intento con el modelo (DESCARTADO)
El contrato manda parar y reportar si el resumen tiende a inventar información que no está en el lorebook. **Hecho (medido)**: ocurre.
- **Qué se probó:** contra el KoboldCpp real (Mahou-1.5-mistral-nemo-12B, contexto 6144, 160 tokens), con recuerdos SINTÉTICOS de "Sam" y "Mia" (3, 2 y 7 entradas). Prompt: "escribe 2-4 frases en tercera persona usando SOLO las notas, sin
  inventar nada", con la frase inicial "Mia and Sam" ya escrita (prefill, para evitar la respuesta vacía por `\n`). Latencia 2,5-6,8 s por llamada. 8 corridas con el prompt A y 12 con dos prompts más estrictos (V2, V3).
- **Ejemplos (notas → resumen):**
  - Notas: "Sam le contó a Mia que su perro Bruno teme a los truenos" + "Sam trabaja en una fábrica". Resumen: "han estado más cerca **desde que empezaron a trabajar juntos en la fábrica**… **comentan sus mascotas en el almuerzo**…" (Mia no trabaja en la fábrica; lo del almuerzo no existe).
  - Con 7 notas: "**se consuelan mutuamente**" (solo Mia consoló a Sam); "Sam **aún no cumple** su promesa… **simboliza un deseo de escape**" (invención); "el prompt V3: **Sam comforted Mia** … to ease her fear" (los papeles al revés).
  - "Mia and Sam, **who are coworkers**" (V3); "Sam's revelation about his dog **caused Mia anxiety** when they first touched hands" (V2: une dos hechos que no tienen relación).
  - Añadidos de opinión sin base: "tensión subyacente", "nueva relación", "confianza", "rutina reconfortante".
- **Prompts más estrictos (V2/V3: "cada frase debe repetir algo de las notas", prohibir palabras como "bond/trust", 1-2 frases) reducen las invenciones pero NO las eliminan**: siguen
  apareciendo cambios de quién hizo qué y detalles nuevos. El servidor impone su propio muestreo (`--gendefaultsoverwrite`), así que la temperatura baja de la petición no ayuda.
- **Por qué importa:** es un texto sobre "cómo va la relación" que el usuario leería como cierto; un dato falso (o un papel invertido) en un tema emocional es peor que no tener resumen.
- El código de ese intento (rama local `mem-006-en-espera`: prompt, limpieza, `Character.relationshipStatus`, actualizador con cancelación) NO se usó y la rama se eliminó al adoptar la decisión final.
- **Opciones para el arquitecto (sin implementar):** (a) NO usar el modelo: mostrar un "resumen" armado solo con las propias entradas (p. ej. las 3-5 más recientes/importantes, tal cual), sin riesgo de invención;
  (b) seguir con el modelo pero enseñando SIEMPRE junto al resumen las entradas de origen y el aviso "puede contener errores", o pedir que el usuario lo revise/edite antes de guardarlo;
  (c) aceptar el riesgo con un aviso visible; (d) posponerlo hasta contar con un modelo más fiable. Recomendación: (a) o (b).

### Decisión final (del usuario, 2026-09-25): opción (a), armado LOCAL sin modelo
**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono.** Cero llamadas al servidor, cero latencia, nada inventado.
- `www/js/api/relationship.js` (puro, sin imports ni red): `relationshipSummary(entries)` → `{ total, always[], lastUpdated, level, phrase }` y `relationshipAgeText` ("hace 2 días").
  Frase fija por cantidad de recuerdos (umbrales elegidos por Claude Code, ajustables en 2 constantes): 0 → "Todavía no hay recuerdos guardados." (no afirma nada de la relación);
  1-4 → "Todavía se están conociendo."; 5-11 → "Ya han compartido bastante."; 12 o más → "Tienen una relación con mucha historia acumulada." (el lorebook admite hasta 24).
- `ui/chat.js`: `buildRelationshipBlock` pinta, arriba de la hoja "Ver lorebook" (justo bajo el estado de la última actualización), el bloque "Estado de la relación": la frase, "N recuerdos en total · M siempre presentes",
  los "siempre presentes" con su texto exacto, "Última actualización de la memoria: hace X" (la fecha más reciente entre los recuerdos) y la nota "Se arma solo con tus recuerdos guardados (los de abajo); no usa el servidor".
  Los recuerdos de origen siguen debajo en las listas "Siempre presentes" y "Por tema". Se calcula cada vez que se abre la hoja; NO se guarda nada.
- **Diferencias con el contrato original (por la nueva decisión):** no hay botón "Actualizar estado de la relación", ni cancelación al enviar un mensaje, ni campo `Character.relationshipStatus` (no hay nada que persistir, así que no hay cambio de esquema ni riesgo para copias antiguas).
- Tests (8 nuevos, `tests/relationship.test.mjs`): vacío/datos malos, umbrales en sus límites, las tres frases, total y "siempre presentes" con texto exacto, última fecha, pureza (no altera lo recibido) y que el módulo no usa red, texto de "hace X".
- Navegador: con 7 recuerdos ("Ya han compartido bastante." / 7 en total · 1 siempre presente / hace 2 días), con 0 (solo "Todavía no hay recuerdos guardados.") y con 13 ("mucha historia acumulada", 2 siempre presentes, "hace 1 hora").

## UI-006: menú de mensaje compacto (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono.**
- **Antes (Hecho, leído en el código):** `buildMessageRow` creaba para CADA fila un contenedor `.chat-row__actions` con 3 botones (Editar, Borrar, Copiar) o 4 (+ Regenerar
  si `isLast && role === 'char'`), ocultos por CSS hasta seleccionar la fila; solo se creaban si no había respuesta en curso. Con 250 mensajes: ~1 000 botones en el DOM.
- **Diseño elegido:** UN solo menú (`.chat-row__actions`, con `role="menu"` y botones `role="menuitem"`), construido la primera vez que se toca un mensaje y después MOVIDO
  (`appendChild`) a la fila seleccionada; se saca de la fila al cerrar. Así el menú queda exactamente donde estaba (debajo de la burbuja, mismos botones y CSS: no hay cálculo de
  coordenadas ni cambia el aspecto), el gesto sigue siendo el de siempre (tocar el mensaje; tocarlo otra vez lo cierra) y no se añade ningún gesto que compita con el scroll o con seleccionar texto.
  Alternativa descartada: menú flotante posicionado con coordenadas (más código, más casos de borde con el teclado y el scroll, y no aporta nada al usuario).
- `ui/msgmenu.js` (nuevo, puro): `MESSAGE_ACTIONS` y `availableMessageActions({ role, isLast, busy })`: Editar, Borrar y Copiar siempre; Regenerar solo en el ÚLTIMO mensaje del personaje; con respuesta en curso, ninguna (idéntico a las condiciones anteriores; test).
  `chat.js`: `ensureMessageMenu`/`openMessageMenu`/`runMessageAction`; `clearSelection()` ahora también saca el menú y lo usan `renderMessages()`, `hide()` y volver. CSS: solo `.chat-actionbtn[hidden]`.
- **Cierre del menú:** al tocar el mismo mensaje, al tocar otro (se mueve), al tocar fuera de los mensajes, al ejecutar cualquier acción (antes "Copiar" lo dejaba abierto), al hacer scroll (con una guarda de 300 ms para el ajuste de posición al abrirlo) y en cada re-render.
- **Verificado (Hecho):** con 252 mensajes: 0 menús y 0 botones en reposo, 1 menú y 4 botones (constante) al seleccionar; tras 30 toques rápidos seguidos en mensajes distintos sigue 1 menú, en el último tocado; "Regenerar" solo en el último del personaje;
  Editar abre la hoja de edición; Borrar quita el mensaje y lo guarda (252 → 251); Regenerar (contra un servidor simulado) sustituyó la respuesta y la guardó; tocar fuera cierra.
  **Límites de la prueba:** el navegador de prueba no permite el portapapeles (sale el aviso "No se pudo copiar", código sin cambios) y, con el panel oculto, no entrega eventos `scroll` reales: el cierre por scroll se comprobó disparando el evento a mano.
- Tests (4 nuevos, `msgmenu.test.mjs`): acciones y orden, condiciones de Regenerar, sin menú con respuesta en curso, equivalencia con la condición anterior.
- **Para el arquitecto (fuera de contrato, NO tocado):** "Regenerar" quita la respuesta anterior ANTES de pedir la nueva (`regenerate()` en `chat.js`). Si el servidor está apagado, la respuesta anterior se pierde
  (comprobado: sin servidor, el último mensaje del personaje desapareció y quedó guardado así). Es lógica de regeneración (NO TOCAR en este contrato), pero conviene un contrato aparte por la sensibilidad a pérdida de datos.

## UI-007: calidad de efectos visuales ajustable (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono. Sin medición de rendimiento** (UI-005 aún no se ejecutó: se implementa igual y la medición queda para después, como permite el contrato).
- **Antes (Hecho, `grep`):** 21 declaraciones `backdrop-filter: blur(var(--surface-blur, 0px))` (+ sus `-webkit-`): `base.css` (topbar, .ib:active, .btn--ghost, .inp, .chip, .list-row:active, .sheet__card, .menu-item:active, .toast),
  `chat.css` (.chat-bubble, .chat-actionbtn, .chat-retry, .chat-scrolldown, .chat-composer, .chat-send), `home.css` (.home-chip, .appearance-preview). Nomi/iMessage: `blur(0px)`; Glass: `blur(20px)`.
- **Tokens:** `--surface-backdrop` (todo menos barras) y `--bars-backdrop` (solo `.topbar` y `.chat-composer`): `none` en Nomi/iMessage, `blur(var(--glass-blur))` en Glass; reemplazan a `--surface-blur` en las 21 declaraciones. Añadido `--sheet-surface` (fondo de la hoja; por defecto `--color-surface`).
- **Ajuste:** `Settings.glassEffect` `'full'|'bars'|'off'`, saneado (`'full'` por defecto; copias y registros anteriores sin el campo cargan en `'full'`; valores raros → `'full'`). `shell.applyGlassEffect` lo pone como `data-glass` en `<html>` (también al arrancar);
  `themes.css` lo aplica solo con `[data-theme="glass"]`. `full` = como siempre; `bars` = blur solo en barra superior y compositor; `off` = ninguno.
- **Opacidad (el contrato permite ajustarla):** sin blur las superficies translúcidas dejan ver el chat (comprobado en captura: la hoja de Apariencia se leía mal). En `bars`/`off` sube el alfa de Glass: oscuro superficie .46→.62, superficie-2 .60→.78; claro .50→.66, .68→.84; la hoja
  inferior (que tapa el chat) usa `--sheet-surface` .94/.95. `full` no cambia nada.
- **Selector:** Ajustes → Apariencia → "Efecto de vidrio" (Completo / Solo en barras / Desactivado) con la nota de que lo más ligero puede ir mejor en teléfonos modestos. **Decisión:** solo se muestra con el skin Glass activo (en los demás, oculto).
- **Verificado (Hecho):** comparación antes/después en los 6 skins/modos con 8 elementos del chat: 0 diferencias de posición/tamaño y 0 de color de fondo; en TODO el DOM de Nomi e iMessage (claro y oscuro) 0 elementos con `backdrop-filter` (antes: `blur(0px)`);
  Glass `full` idéntico a antes (`blur(20px)` en topbar, burbujas, composer, send, scrolldown, hoja, toast, input, chip); `bars` → solo `.topbar` y `.chat-composer`; `off` → ninguno. El selector aparece solo con Glass, guarda y aplica.
- **Nota técnica:** `blur(0px)` creaba contexto de apilamiento; `none` no. Sin efectos visibles en la comparación de posiciones/colores, y en el navegador la pantalla se ve igual.
- Tests: 1 nuevo (`state.test.mjs`, `glassEffect`) y se actualizó el de valores por defecto.

## UI-008: contraste, tipografía local, compositor y botón flotante (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812). **NO probado en el teléfono ni en modo avión real.**
- **Tipografía (Hecho, leído):** `index.html` descargaba Literata de Google Fonts (`fonts.googleapis.com`, pesos 400/500/600 SOLO romanos) en cada arranque; nunca hubo cursiva real: la *acción* del personaje se dibujaba con cursiva sintetizada.
  Ahora: `www/fonts/` con 12 `woff2` (Literata romana e itálica real, pesos 400/500/600, subconjuntos `latin` y `latin-ext`), `@font-face` en `css/tokens.css` (`font-display: block`), enlaces externos eliminados del `index.html`.
  **Origen y licencia:** paquete npm público `@fontsource/literata` 5.3.0 (fuentes de github.com/googlefonts/literata), archivos SIN modificar; **SIL Open Font License 1.1**, "Copyright 2017 The Literata Project Authors", sin Reserved Font Name (verificado en el archivo `LICENSE` del paquete,
  copiado a `www/fonts/OFL-Literata.txt`; origen y huellas SHA-256 en `www/fonts/README.md`). **Aumento del APK: ~239 KB** (245 104 bytes con la licencia y el README). Cirílico/griego/vietnamita no incluidos (caen a Georgia).
  iMessage sigue con la fuente del sistema. `www/dev/design-preview.html` (página de desarrollo, no es el punto de entrada) aún enlaza Google Fonts; no se tocó.
  **Verificado (Hecho):** al abrir el chat las peticiones de fuentes son solo `/fonts/literata-latin-{400,500,600}-normal.woff2` y `…-400-italic.woff2` (locales, 200 OK), ninguna a servidores externos; `document.fonts` los da como `loaded`; el `<em>` usa `italic` real.
- **Contraste (función pura `ui/contrast.js`: `parseColor`, `composite`, `luminance`, `contrastRatio`; test `contrast.test.mjs` que calcula la tabla desde el CSS real y falla si baja del umbral de cada skin).**
  Fondos de burbuja: personaje = `--color-surface-2` compuesto sobre `--color-bg`; usuario = el PEOR de los tramos de `--grad-user`.

| skin/modo | texto/personaje antes→después | cursiva/personaje | texto/usuario | cursiva/usuario |
|---|---|---|---|---|
| Nomi oscuro | 11,92 → 11,92 | 5,01 → 5,01 | 4,35 → **4,81** | 3,22 → **4,56** |
| Nomi claro | 13,44 → 13,44 | 4,00 → **4,51** | **2,23** → **4,81** | 3,22 → **4,56** |
| Glass oscuro | 15,78 → 15,78 | 6,63 → 6,63 | 5,73 → 5,73 | 4,07 → **5,45** |
| Glass claro | 14,67 → 14,67 | 4,84 → 4,84 | **2,81** → 3,88* | 2,75 → 3,70* |
| iMessage oscuro | 15,21 → 15,21 | 4,67 → 4,67 | 3,65 → 3,65* | 2,58 → 3,44* |
| iMessage claro | 17,32 → 17,32 | **2,69** → **4,51** | 5,23 → 5,23 | 2,77 → **4,68** |

  \* Excepciones documentadas: es el MÁXIMO alcanzable con texto blanco sobre la burbuja del usuario sin cambiar su color (identidad del skin: violeta claro de Glass claro, azul de iOS en iMessage oscuro). El test las fija como umbrales propios (3,8 / 3,6 / 3,4).
- **Cambios de CSS (solo tokens y la regla que los ignoraba):** (1) la regla `.chat-row--user .chat-bubble em { color: rgba(255,255,255,.72) }` ignoraba el token de cada skin (los tres modos claros definían .8/.85): ahora usa `var(--color-muted-on-accent)`;
  (2) `--color-muted-on-accent` sube a blanco casi opaco (.95-.96; iMessage claro: negro .85, coherente con su texto negro; antes mostraba cursiva BLANCA junto a texto NEGRO); (3) token nuevo `--color-em` (cursiva del personaje): solo Nomi claro `#6a677e` (antes `--color-muted` `#726f87`) e iMessage claro `#69696d` (antes `#8e8e93`, gris de iOS) lo redefinen; no cambia el resto del texto secundario del skin;
  (4) **ampliación de alcance (decisión de Claude Code, fácil de revertir):** token nuevo `--color-on-user` (texto normal sobre la burbuja del usuario, por defecto `--color-text`): en **Nomi claro y Glass claro el texto que el usuario escribe salía OSCURO sobre la burbuja violeta (2,23:1 y 2,81:1)**; ahora es blanco (4,81 y 3,88). También blanco en Nomi oscuro (4,35→4,81). No se tocaron fondos, acentos ni radios. Es texto principal, no secundario: si el arquitecto prefiere no cambiarlo, basta borrar `--color-on-user` de esos tres bloques.
  Nota de identidad: Nomi oscuro ("el look original") cambia apenas (texto `#f3f3f8`→`#fff`; cursiva del usuario más nítida).
- **Compositor:** `textarea.inp` (base.css) fijaba `min-height: 90px` y ganaba por especificidad; ahora `textarea.chat-composer__input { min-height: 48px }`. Medido: vacío 49 px, una línea 49, tres líneas 96, doce líneas 140 (el máximo de siempre).
- **Botón "volver abajo":** de centrado a la esquina inferior derecha (`right: var(--space-3)`), `opacity: .72` (1 al pulsarlo); mismo tamaño táctil de 44 px. Medido a 375 px: x=319–363, y=691–735.
- Tests nuevos (6, `contrast.test.mjs`): valores conocidos de WCAG, `parseColor`, composición de translúcidos, tabla de los 6 skins/modos con sus umbrales y las dos reglas de CSS.

## UI-009: dos skins nuevos, "Penumbra" y "Penumbra Claude" (2026-09-25)

**Estado:** implementado; verificado en el navegador integrado (375×812, claro y oscuro de los dos). **El usuario dará su opinión en el teléfono** (sin maqueta previa, como pidió); se ajusta en una siguiente iteración.
- **Estructura:** solo tokens en `themes.css` (4 bloques nuevos: `penumbra` y `penumbra-claude`, claro y oscuro), como Nomi/Glass/iMessage; misma tipografía (Literata incluida en UI-008), formas y radios (vienen de `tokens.css`), sin `backdrop-filter`
  (`--surface-backdrop`/`--bars-backdrop` = `none`; comprobado: 0 elementos con `backdrop-filter` en los 4). Burbujas OPACAS con degradado sutil (`--color-surface-2` y `--grad-user` como degradados, solo usados en `background`; el `--color-surface` sigue plano porque un componente lo usa como `background-color`).
- **Penumbra:** ciruela/violeta muy oscuro (`#140d1c`) con acento violeta y acento cálido ámbar (`--color-em` `#e6ad82`) para las *acciones* del personaje; claro: hueso `#f4efe8` y lavanda, con las acciones en un marrón cálido (`#8e4626`).
  **Penumbra Claude:** carbón cálido (`#1f1c19`) / crema (`#f5f0e8`) y terracota (`#b3512f`); inspirada SOLO en los colores de la interfaz de Claude, sin logotipo ni ningún elemento de marca. Tabla completa de tokens en `docs/DESIGN.md`.
- **Excepciones a "solo tokens" (documentadas, mínimas):** (1) `.chat-bubble { box-shadow: var(--bubble-edge, none) }` en `chat.css`: el "borde fino de luz" no se puede lograr solo con los tokens existentes; el token nuevo es `none` en los otros skins (comprobado: sin cambio en Nomi/Glass/iMessage);
  (2) `home.css`: muestras del selector (`.appearance-skin__swatch--penumbra[-claude]`, claro y oscuro) y la rejilla `.appearance-skins--grid` (3 columnas) porque 5 skins ya no caben en una fila; (3) **`state.js` y `shell.js` tenían la lista fija de 3 skins** (`sanitizeSettings` habría devuelto los nuevos a "nomi"): ahora aceptan los 5 (`state.js` no estaba en el alcance del contrato, pero era imprescindible).
- **Contraste desde el diseño** (mismo `contrastRatio` de UI-008; peor tramo del degradado; `contrast.test.mjs` ahora cubre 10 skins/modos con umbral 4,5 en los nuevos):

| skin/modo | texto/personaje | cursiva/personaje | texto/usuario | cursiva/usuario | blanco/acento | secundario/fondo |
|---|---|---|---|---|---|---|
| Penumbra oscuro | 13,12 | 7,84 | 5,69 | 5,38 | 5,28 | 7,35 |
| Penumbra claro | 11,14 | 5,01 | 4,92 | 4,67 | 6,21 | 5,88 |
| Penumbra Claude oscuro | 10,78 | 5,81 | 5,04 | 4,91 | 5,08 | 7,11 |
| Penumbra Claude claro | 11,04 | 4,79 | 5,04 | 4,91 | 5,68 | 5,77 |

  Todos ≥ 4,5:1, sin excepciones. Los valores de partida no pasaban (p. ej. cursiva del usuario en Claude 4,45): se ajustaron el degradado del usuario y el alfa antes de dar la paleta por buena.
- **Selector** (Apariencia): "Penumbra" y "Penumbra Claude" junto a los demás; el ajuste de vidrio (UI-007) sigue oculto salvo con Glass. Verificado: elegir "Penumbra Claude" guarda `theme` y aplica `data-theme`; los tres skins antiguos mantienen `box-shadow: none` en las burbujas.
- Tests: 2 nuevos (skins hermanos y sin blur) + el de guardado de skins ahora cubre los 5; 353 en total.

## VER-005: ¿búsqueda de memoria por significado en el hardware del usuario? (2026-09-25)

**Recomendación (a la vista): NO construir hoy la búsqueda por significado (embeddings) ni la tabla de sinónimos.** Solo, y únicamente si el uso real lo pide, la coincidencia difusa para errores de tipeo (umbral conservador). Razones, con números abajo: (1) una tabla de sinónimos cubre lo que su autor anticipó (8/8) pero casi nada de lo que no (2/16 en un juego "ciego"), y sus falsos positivos son por polisemia (5/12 negativos); (2) la coincidencia difusa arregla los tipeos (4/4) pero no el significado, y con umbrales laxos activa cosas sin relación (4 de 12 negativos); (3) lo único que ninguna mejora barata toca son los casos de **solo significado** (0/7 con todas): ahí solo sirven embeddings, y el lorebook tiene ≤24 entradas y "siempre presentes" para lo importante, así que el beneficio real es acotado. **Construir más adelante si:** el usuario nota (con el indicador de recuerdos de UI-010) que entradas importantes no se activan por significado y no basta marcarlas "siempre presente". Ver también el hallazgo de `--smartcache` (más abajo), que puede cambiar el costo de cualquier función que use una llamada extra al servidor.

**Estado de la Parte A (hardware real): NO se probó hoy** (el usuario pidió cerrar la sesión antes de proponerle la prueba; el contrato permite documentarla como "Supuesto, no verificado"). No se cargó ningún modelo de embeddings ni se cambió ninguna bandera del servidor. Para probarla: bajar UN modelo pequeño (p. ej. `bge-small-en-v1.5-q8_0.gguf`, 36,8 MB), añadir `--embeddingsmodel <ruta>` al arranque (lo haría el usuario, en una copia del script) y medir 5-10 respuestas del chat antes y después.

### Parte A — viabilidad técnica (Hecho / Supuesto)
- **Hecho (`--help` y `--version` del binario del usuario, 2026-09-25):** KoboldCpp **1.121** trae `--embeddingsmodel [archivo]`, `--embeddingsmaxctx [n]` y `--embeddingsgpu`. `/api/extra/version` reporta `"embeddings": false` solo porque hoy se arranca sin esa bandera.
- **Hecho (documentación oficial, wiki de KoboldCpp):** acepta modelos GGUF de embeddings, expuestos en `/v1/embeddings` y `/api/extra/embeddings`; por defecto se ejecutan en **CPU** (`--embeddingsgpu` los sube a GPU y la documentación dice que "normalmente no hace falta"). Nombres soportados: familias Nomic Embed, BGE, GTE, E5. Hay un caso público de un modelo (bge-m3) que no cargó por un tensor faltante: no todo GGUF de embeddings sirve.
- **Hecho (Hugging Face, `CompendiumLabs/bge-small-en-v1.5-gguf`):** archivos de 24,8 MB (q4_k_m), 36,8 MB (q8_0), 67,3 MB (f16) y 134 MB (f32): entran en el rango de 50-150 MB que pedía el contrato (los tamaños de otros modelos, p. ej. nomic-embed, NO se verificaron).
- **Hecho (observado en el PC, con el servidor apagado):** GPU AMD Ellesmere (RX 470/480/570/580) con **8 GiB de VRAM** (0,7 GiB ya usados por el escritorio); 15,5 GiB de RAM (10,8 GiB disponibles). El modelo de chat pesa 6,8 GB en disco (IQ4_XS).
- **Supuesto (NO verificado en hardware real):** un modelo de ~40 MB en CPU cabe sin tocar la VRAM del modelo de chat, y como el procesamiento del prompt del chat va en la GPU (Vulkan) no debería competir; **no se midió** el tiempo de carga, la memoria, la latencia por lote de 24 ni el efecto sobre las respuestas normales (lo que decide la viabilidad). El contrato pide medirlo solo con consentimiento del usuario y dice que el PC tuvo un cierre inesperado reciente.

### Parte B — ¿cuánto mejoran las alternativas baratas? (Hecho, sin modelo, script desechable fuera del repositorio)
Método: la función REAL `selectLoreEntries` (copia de `lorebook.js` con funciones internas expuestas) frente a: **(1) tabla de sinónimos** sobre `stemLite` (74 filas, 420 palabras, escrita y congelada ANTES de los casos) y **(2) coincidencia difusa** (distancia de edición con transposición ≤1 si la key tiene ≥6 letras, ≤2 si ≥10; o subcadena de ≥5 letras que cubra ≥75 % de la palabra). Casos inventados (Sam, Mia, Bruno, Laura…), cada uno con keys como las que pide el prompt de MEM-005 y un mensaje que **no contiene ninguna key** (se verificó). Tipos: `syn` (sinónimo/hiperónimo/coloquial), `morph` (otra forma de la palabra), `typo` (tipeo), `sem` (solo significado o conocimiento del mundo).

| Inglés (24 casos que SÍ deben activar; 12 que NO) | actual | tabla sinónimos | difusa | ambas |
|---|---|---|---|---|
| syn (8) | 0 | **8** | 0 | 8 |
| morph (5) | 0 | 4 | 2 | **5** |
| typo (4) | 0 | 0 | **4** | 4 |
| sem (7) | 0 | 0 | 0 | 0 |
| **Total** | **0/24** | **12/24** | **6/24** | **17/24** |
| Falsos positivos (de 12) | 1 | 5 | 5 | 9 |

- Español (10 casos, 6 negativos; los ejemplos del contrato, "reventado de laburar"): actual 0/10 · sinónimos 6/10 (FP 3/6) · difusa 1/10 (FP 0/6) · ambas 7/10 (FP 3/6). La flexión del español (p. ej. "cociné" vs "cocinar") tumba la tabla: 0/1.
- **Juego "ciego" (16 pares con sinónimos elegidos libremente, escrito DESPUÉS de congelar la tabla y sin mirarla): actual 0/16 · tabla 2/16 (12,5 %) · difusa 0/16.** Es la cifra que estima la cobertura real de una tabla pequeña; el 8/8 de arriba es optimista porque el autor de la tabla y de los casos es el mismo.
- Falsos positivos de la tabla: polisemia ("wiped" = limpió la mesa, "bike" = bicicleta vs moto, "dinner" activa "food", "doctor" activa una entrada de una enfermera, "pasta" = dinero/comida). De la difusa: palabras parecidas sin relación ("marred"/"married", "concern"/"concert", "winner"/"dinner", "hunter"/"hunger").
- Barrido del umbral de edición (largo mínimo de la key): 6 → tipeos 4/4, FP 5 · 7 → 4/4, FP 3 · **8 → 3/4, FP 1 (solo el que ya da el sistema actual)** · 9 → 3/4, FP 1. Si algún día se construye la difusa: mínimo 8 letras.
- Costo por turno con 24 entradas: actual 0,11 ms; difusa 0,68 ms (irrelevante frente a los ~0,7-15 s del modelo).
- **Límite del método:** los casos y su reparto por tipo son míos; los totales dependen de esa mezcla (lo informativo es la tasa por tipo). Con conversaciones reales del usuario se sabría qué tipos de fallo son los frecuentes.
- **No hay tercera columna (embeddings)** porque la Parte A no se probó.

### Hallazgo aparte (Hecho): `--smartcache`
La ayuda del binario del usuario incluye `--smartcache [límite]`: "guarda instantáneas del caché KV en la RAM" (requiere fast forward, activo por defecto). La restricción central de toda la memoria (una sola caché de prompt: una llamada aparte cuesta ~14-66 s en la siguiente respuesta, ver MEM-001 v2/MEM-004/MEM-007) **podría** dejar de existir con esa bandera, pero **no se probó** (habría que reiniciar el servidor con ella; el contrato prohíbe cambiarlo por iniciativa propia). Propuesta al arquitecto: una medición corta con el usuario (reiniciar con `--smartcache 2`, repetir la medición "llamada aparte → siguiente respuesta").

## MEM-007: resumen de continuidad por chat (2026-09-25/26)

**Estado:** implementado y **APAGADO por defecto** (`Settings.continuityAuto = false`) por costo de latencia (abajo). 397 tests en verde (353 + 44); interfaz verificada en el navegador integrado (375×812); Paso 0 y afinación medidos contra el servidor real (KoboldCpp 1.121, Mahou 12B, ctx 6144). **NO verificado** (el usuario pidió cerrar la sesión): el actualizador de punta a punta contra el servidor real (4.7 con `createContinuityUpdater`, incluida la compresión con el modelo), español, modo "texto simple", cancelar a mitad de una llamada, importar/exportar un chat en el navegador y todo en el teléfono/APK. Datos sintéticos (Sam, Mia); scripts desechables fuera del repo.

### Decisiones (con su evidencia)
1. **Técnica: "continuación del prefijo" (A1) y no una llamada aparte (B).** A1 = mismos mensajes del chat + un mensaje de usuario con el fragmento repetido y la instrucción + `assistant` "Recap:" con `stop:["\n"]` (`completeChatOnce`, `genkey` en el cuerpo: medido que aborta también en `/v1/chat/completions`). 16 conversaciones sintéticas × 3 técnicas (A0 = igual pero el rango se pide citando el inicio y el final; A1 = con el fragmento repetido; B = prompt nuevo solo con el fragmento). Latencia de la **siguiente** respuesta del chat (mediana; control = sin recuento):

| Régimen (prompt) | control | A0 | A1 | B (aparte) |
|---|---|---|---|---|
| ctx 2048, recorta (~1,6k tokens), 8 chats | 0,52 s | +0,01 | −0,01 | **+14,4 s** |
| ctx 6144, sin recorte (~3,5k*), 4 chats | 0,57 s | +0,03 | +0,04 | **+39,6 s** |
| ctx 6144, recorta (~5,5k), 4 chats | 0,73 s | −0,07 | −0,07 | **+56,2 s** |

  (*Inferencia por el tiempo en frío: 33,6 s.) Costo de la llamada en segundo plano (mediana): A0 3,9 s · A1 10,6 s (8-21 s; la primera tras un turno normal es la más lenta) · B 8,8 s. **c3 de MEM-001 v2 se confirma:** la vía A no invalida la caché; B sí, y crece con el chat. Hechos cubiertos del fragmento: A0 44/250 (18 %) · A1 86/232 (37 %) · B 113/233 (48 %).
2. **La redacción importa; se eligió "v3".** Con la redacción inicial (A1/v0), lectura manual de los 16 recuentos: **2 con datos NO respaldados (12,5 %)** (uno mezcló una invitación de otro momento del chat; otro inventó "lo perdonó"), 3-4 con quién-dijo-qué cruzado, 3 imprecisos, 6 limpios. Afinación sobre el MISMO fragmento (la caché no cambia): v2 ("ignora todo lo demás, solo este fragmento") 0 no respaldados en 10 pero el papel cruzado en 4/10 ("Sam ofreció consuelo" siendo Mia); **v3 = v2 + "di QUIÉN hizo o dijo cada cosa; si Mia ofreció, escribe Mia"**. Con mensajes de largo real (~300 car.; fragmentos de ~3 100): v3 **0 no respaldados, 0 mezclas, 8/10 recuentos totalmente limpios** (los 2 restantes: "Sam le dio un cactus a Mia" y "le pareció gracioso"), 54 % de hechos cubiertos; v2: 1 no respaldado y 1 mezcla. Es la redacción de producción (`recapInstruction`).
3. **Colocación: al FINAL del prompt, no en la cabecera (desviación del punto 4.4, justificada por la regla "latencia primero").** Chat de ~5 500 tokens, 2 repeticiones (control 0,74 s; cambio de texto medido):

| | aparece | cambia | estable (cada respuesta) |
|---|---|---|---|
| **Cabecera** (500 car.) | 67,5 s | **66,4 s** | 0,72 s |
| **Final** (500 car.) | 2,3 s | 3,0 s | **+2,05 s** (2,79) |
| **Final** (1 000 car.) | — | 4,7 s | **+3,78 s** (4,52) |

  Con la cabecera cada actualización costaría una respuesta de ~1 minuto (y llegarían cada ~5 turnos); al final hay un impuesto constante de ~0,35 s por cada 100 caracteres. Por eso el tope total baja a 800 (rango bajo del contrato) y el recuento a 400.
4. **Reserva fija en el presupuesto (medida, importante).** Si el bloque final se acorta o desaparece, el presupuesto crece, la ventana recupera mensajes por el FRENTE y el servidor rehace todo (~59-66 s). Solución: `CONTINUITY_RESERVE_CHARS = 880` siempre que haya resumen (`continuityBlockChars`, `continuityPadding` en `prompt.js`). Medido (2 repeticiones): con resumen de 300 → 800 → 350 → 600 caracteres la ventana no se movió (179/177 mensajes) y no hubo pausas; solo al **borrar** el resumen (desaparece) hubo ~59-66 s, una vez.
5. **Apagado por defecto:** el impuesto de +2-4 s por respuesta (×3-5 sobre 0,74 s en chats largos) es un empeoramiento perceptible que el principio nº 1 no permite sin autorización del usuario; y además la fidelidad medida (12,5 % de datos no respaldados con la redacción inicial; 0/10 con v3, muestra chica) pide leerlo antes de fiarse. El usuario lo enciende en "Resumen de este chat".

### Qué se implementó
- `state.js`: `Chat.continuitySummary {text, coveredUntil (ts del último mensaje resumido), updated}` (por `ts`: borrar/editar mensajes no lo desalinea); `sanitizeContinuity` (tope duro 2000; chats y copias anteriores cargan con el valor por defecto; copias con basura también); `saveChatContinuity` (no toca `updated`); **cola en memoria por chat** para todas las escrituras de `chatMeta` que leen y luego escriben (un test encontró que `saveChatMessages` + resumen a la vez pisaban `last`); `Settings.continuityAuto`.
- `api/prompt.js`: `formatContinuityBlock`, `continuityBlockChars`, `historyStartIndex` (misma cuenta que los armadores: test de consistencia sobre 300 casos), `historyBudgetChars` compartido (fuzz de 3 000 casos × 5 comparaciones: prompt IDÉNTICO al anterior sin resumen), parámetro `extras.continuity`.
- `api/continuity.js` (puro): disparo perezoso (`planContinuityUpdate`/`planForContext`: solo si el primer mensaje visible sin resumir caería fuera de la ventana con ~1 200 caracteres más; un chat que cabe entero nunca dispara), fragmento ≤3 000 car. (≥4 mensajes; nunca los últimos 4), `cleanRecap`, `verifyRecap` (nombres propios y números deben estar en el fragmento: en las 48 salidas del Paso 0 atrapó la única mezcla y no rechazó ninguna buena; en la afinación dio un falso rechazo por el apóstrofo posesivo "Marcus'", ya corregido y con test; NO detecta papeles cruzados ni emociones inventadas), acumulación tipo rollo y compresión con el modelo + verificación + respaldo sin modelo (descartar las frases más antiguas), `createContinuityUpdater` (prioridad al chat, aborta si el usuario envía, no pisa una edición manual hecha mientras corre, ≤2 intentos por fragmento, enfriamiento de 5 min si el servidor no responde).
- `api/kobold.js`: `completeChatOnce`; `generateReply` pasa el resumen del chat. `ui/chat.js`: menú ⋮ → "Resumen de este chat" (leer, editar a mano con contador, borrar con confirmación, interruptor, "Resumir ahora"); el indicador de contexto lo cuenta; **importar un chat reinicia (o restaura del archivo) el resumen**, porque hablaba de los mensajes reemplazados; exportar un chat lo incluye.
- Límites conocidos: lo ya recortado sin resumir no se puede recuperar (se resume solo lo visible; para un chat que ya era largo al activarlo, el usuario puede escribir el resumen inicial a mano); si se borran o editan mensajes ya cubiertos el resumen puede quedar algo desactualizado; escribir o editar el resumen a mano lo expone a que la compresión automática lo junte o quite las frases más antiguas.

### Respuesta a VER-004 (antes pendiente)
"Extraer sobre el prefijo del chat" se midió: **0 s de penalización** (A1) frente a +14/+40/+56 s (aparte). Lo que no sale gratis es *aplicar* el texto: al final cuesta ~+0,35 s por 100 caracteres por respuesta y en la cabecera ~1 minuto por cambio.
**Pendiente / propuestas:** colocación "anclada" (insertar el bloque delante de un mensaje fijo, no del último: sin impuesto por respuesta y una espera solo al actualizar) con precalentamiento de la caché tras cada actualización; medir `--smartcache` (ver VER-005); 4.7 con el actualizador real, español, texto simple y cancelación.

## Hallazgo (sin arreglar, propuesta LAT-001): pausas de ~1 minuto en chats largos (2026-09-26)

**Qué pasa (Hecho, medido):** cuando el chat ya recorta el historial, la mayoría de las respuestas tardan ~0,9 s porque el servidor "desliza" su caché, pero en algunos turnos tardan **~51-66 s** (el prompt entero se reprocesa: ~5 500 tokens a ~100 tokens/s). Dos causas independientes, ambas en `prompt.js` y ambas de la misma naturaleza: el prompt nuevo **no es "el anterior sin el principio"**, así que el servidor no puede reutilizar su caché.
1. **Mensaje de relleno `[Start of roleplay]` que aparece y desaparece al frente** (`buildChatMessages`, modo plantilla): se antepone cuando el primer mensaje que cabe es del personaje, y al deslizar la ventana el primero alterna entre "usuario" y "personaje". Medido: cada vez que APARECE (false→true) el turno tarda ~51-55 s; que desaparezca o se mantenga cuesta ~1 s. Sonda controlada con mensajes de largo variable: **9 pausas de ~51 s en 22 pasos, todas en un cambio false→true (9/9)**; con el frente siempre "usuario" (quitar el mensaje del personaje que quedaría al frente) **0 pausas en 20 pasos** (0,7-1,6 s). En turnos reales seguidos (14 turnos) hubo 2 pausas de ~55 s además del primero en frío.
2. **El bloque "por tema" (MEM-004) cambia de largo entre turnos** y el presupuesto del historial descuenta su tamaño real: cuando una respuesta lo lleva y la siguiente no, el presupuesto crece, la ventana recupera ~8 mensajes por el FRENTE y el servidor rehace todo. Medido (2 repeticiones × 4 alternancias, chat de ~5 500 tokens): presente ~3,1 s; **ausente justo después de presente: 65-66 s en 8 de 8**. MEM-004 midió este bloque solo en chats que aún no recortan (+1-2 s), por eso no lo vio. Lo mismo ocurre con la nota de variedad (FMT-004) y con cualquier bloque final de largo variable. (El mismo mecanismo se comprobó con el resumen de MEM-007: por eso lleva reserva fija.)
**Alcance probable (Inferencia):** afecta a chats que ya recortan (con mensajes de ~320 caracteres de media, como el del usuario, desde ~60 mensajes con ctx 6144) y, en el caso 2, con recuerdos "por tema" que se activan de forma intermitente.
**Propuesta LAT-001 (NO implementada; el usuario decidió el 2026-09-26 solo documentarla):** (a) *frente estable*: si el historial se recorta y el primer mensaje que cabe no es del usuario, quitarlo también (así nunca hace falta el mensaje de relleno salvo al inicio del chat); (b) *espacio fijo para los bloques finales*: descontar del presupuesto un espacio constante (el máximo del bloque "por tema" + variedad, y el del resumen) en vez del tamaño real de cada turno; (c) prueba: dos tests con el mismo historial y bloques de distinto largo que comprueban que el primer mensaje enviado no cambia, y una medición contra el servidor (0 pausas esperadas en 20+ pasos). Es un cambio chico, pero **cambia el prompt de los chats que ya recortan** (la ventana queda algo más chica en algunos turnos): por eso pide autorización y comparar con el prompt anterior en chats cortos (debe quedar idéntico).
**Cómo reproducirlo:** scripts desechables (no versionados) `probe.mjs`/`probe2.mjs` (ventana deslizante con `max_tokens: 2`) y `reserve-test.mjs`, sobre una conversación sintética de 231 mensajes con `ctx: 6144`.

### Actualización LAT-001 con `--smartcache` (2026-09-26, solo medición; sin código de producción)
**Condiciones (Hecho):** KoboldCpp 1.121, mismo modelo (Mahou-1.5-mistral-nemo-12B IQ4_XS), `ctx 6144`, ahora arrancado con `--smartcache` (sin número de límite; confirmado en la línea de arranque del proceso, `ps`; que actúa se deduce de los tiempos de abajo). Mismos scripts de la sesión M1 (`probe2.mjs natural 200 24` y `reserve-test.mjs 2`), una petición a la vez. Registros y un script nuevo (`irreg.mjs`) guardados fuera del repositorio, en `companion-mediciones-M1/lat001-smartcache`.
**Causa 1 (mensaje de relleno que aparece al frente): NO mejora.** Dos corridas de 24 pasos: 9 pausas en cada una (la primera en frío + **8 de 8** apariciones del relleno, false→true), todas de 43,1-44,0 s (media 43,5 s); los demás 15 pasos, 0,2-1,4 s. Antes: 9 pausas de ~51-55 s. La diferencia de ~8 s no es de `--smartcache`: el paso en frío también bajó (55 → 44-45 s), así que es velocidad general de esta sesión.
**Causa 2 (bloque "por tema" que se ausenta): mejora mucho, pero no la primera vez.** Antes: "ausente justo después de presente" = 65-67 s en 8 de 8. Ahora, 13 casos (alternancia estricta 2×4 + un patrón irregular de 19 turnos en una conversación nueva): **3 pausas de ~46 s** (la primera de cada serie) y **10 casos de 3,0-8,0 s** (el servidor recupera de la RAM una instantánea del prompt anterior con el mismo frente). "Resumen desaparece" (MEM-007) tampoco mejoró la primera vez: 46-47 s (antes 59-66 s), 2 de 2.
**Lectura (Inferencia, no verificada dentro del servidor):** las instantáneas sirven cuando el frente del prompt vuelve a ser el mismo (causa 2); no sirven cuando se INSERTA un mensaje delante (causa 1), y la primera vez de cada forma no tiene instantánea. Dependen de la RAM y se pierden al reiniciar el servidor; el límite de instantáneas no se probó.
**Conclusión para la decisión:** `--smartcache` no elimina LAT-001. La parte (a) *frente estable* sigue haciendo falta (es la causa frecuente: ~1 de cada 3 turnos en el experimento y no se alivia); la parte (b) *espacio fijo* queda como mejora menor (evita la primera espera de 46 s y no depende de la bandera). Límites: conversaciones sintéticas, un solo modelo, sin probar en el teléfono ni con tráfico real de chat (aquí los mensajes son de ~320 caracteres, sin pausas humanas entre turnos).

## LAT-001 (a) "frente estable": implementado y medido (2026-09-26)

**Autorización y alcance (Hecho):** el usuario pidió implementar SOLO la parte (a). La parte (b) "espacio fijo para los bloques finales" queda **descartada por ahora**: `--smartcache` (activo de forma permanente en el servidor del usuario) cubre la mayoría de esos casos (ver la actualización anterior; queda la primera espera de ~46 s de cada forma nueva).
**Cambio (`www/js/api/prompt.js`, función `stableFront`):** en modo plantilla, si el historial se recortó y el primer mensaje que cabe es del personaje, se descarta ese (y los siguientes hasta el primero del usuario). El mensaje `[Start of roleplay]` solo aparece al inicio real del chat (cuando todo el historial cabe y empieza en el personaje) o si en la ventana no hay ningún mensaje del usuario. `historyStartIndex` usa la misma regla, así que el resumen de continuidad (MEM-007) sigue coincidiendo con lo que realmente se envía. Modo "texto simple": sin cambios (nunca usó relleno). Un chat que cabe entero queda **idéntico** (test con el resultado literal). Coste: la ventana pierde como mucho 1 mensaje en los turnos en que antes empezaba en el personaje.
**Tests:** 397 → 404 (7 nuevos en `tests/prompt.test.mjs`: el primer mensaje enviado es siempre del usuario en 41 tamaños de chat recortado; dos turnos con distinto largo no cambian el frente; el relleno sigue en el inicio real; chat corto idéntico; sin mensajes de usuario no se descarta nada; `historyStartIndex` coincide con el armador; texto simple intacto).
**Medición contra el servidor real (Hecho):** KoboldCpp 1.121, mismo modelo, `ctx 6144`, **con `--smartcache`** (confirmado en la línea de arranque del proceso), una petición a la vez, mismo experimento de la causa 1 (`probe2.mjs natural`, con el código de producción ya corregido; conversación sintética de 221 mensajes, `max_tokens: 2`). Scripts y registros fuera del repositorio: `companion-mediciones-M1/lat001-frente/`.
| Corrida | Pasos | Pausas (>10 s) | Resto de pasos | Relleno enviado |
|---|---|---|---|---|
| Antes (sesión anterior, con `--smartcache`), n=200..223 | 24 (×2 corridas) | **9 de 24** en cada corrida: 1 en frío + **8 de 8** apariciones del relleno, 43,1-44,0 s | 0,2-1,4 s | 11 veces, apareciendo y desapareciendo |
| Después, n=200..223 | 24 | **1** (la de arranque en frío, 44,8 s; la forma del prompt es nueva) | 0,2-2,4 s (media ~0,9 s) | 0 |
| Después, n=120..143 (cruza de "cabe entero" a "recortado" en n=136) | 24 | **1** (arranque en frío, 37,6 s) | 0,6-1,5 s (media 0,83 s); el cruce en n=136 costó 1,0 s | 16 (chat sin recortar, legítimo), 0 después del recorte |
**Conclusión:** la causa 1 desaparece: de 8 de 8 pausas por aparición del relleno a 0 en 47 pasos (solo queda la espera en frío del primer turno de cada forma de prompt, que ya existía y que el servidor no puede evitar). **Límites:** conversaciones sintéticas (mensajes de largo variable, sin pausas humanas entre turnos), un solo modelo, sin probar en el teléfono ni con tráfico real de chat; solo se midió la causa 1 (la 2 no cambió: sigue dependiendo de `--smartcache`).

## MEM-008: estado de la relación también en la conversación (2026-09-26)

**Decisión previa (Hecho, del usuario):** usar el nivel que ya calcula `relationshipSummary().level` (pocos/varios/muchos recuerdos) para elegir una frase FIJA en inglés, con la etiqueta `Relationship so far:`, en la CABECERA del prompt junto a los "siempre presentes"; sin recuerdos no se envía nada. No se toca `relationship.js` ni "Ver lorebook".
**Frases (nombres reales de usuario y personaje, usuario primero):** pocos (1-4) `Sam and Mia are still getting to know each other.`; varios (5-11) `... have already shared quite a lot.`; muchos (12 o más) `... have a long shared history.` Línea completa: `Relationship so far: Sam and Mia have already shared quite a lot.`
**Implementación:** `prompt.js` exporta `formatRelationshipBlock(level, charName, userName)` y `headBlock` la coloca justo antes del bloque "siempre presentes" (entre el escenario y el diálogo de ejemplo). El nivel viaja en `extras.relationship` (armadores y `estimateContextUsage`) y como último parámetro de `historyStartIndex`. Lo calculan `kobold.js` (`generateReply`), `continuity.js` (la petición de resumen sigue siendo continuación EXACTA del prefijo del chat, y la ventana que usa para decidir qué resumir cuenta la línea) y `chat.js` (indicador de contexto). Sin nivel, con `none` o con un valor raro no se añade nada y el prompt queda idéntico al de antes (test con `deepEqual` en ambos modos). El texto solo va en la cabecera, nunca en los mensajes.
**Tests:** 404 → 409 (`prompt.test.mjs`: frases y nombres, colocación en ambos modos, idéntico sin nivel, misma cabecera turno a turno, el presupuesto la cuenta; `kobold.test.mjs`: de 0 a 12 recuerdos contra un servidor simulado; `continuity.test.mjs` actualizado para exigir la línea en el prefijo).
**Costo de latencia (Hecho, medido contra el servidor real, KoboldCpp 1.121, `--smartcache`, chat de 60 mensajes = 2 013 tokens, `max_tokens: 2`, una petición a la vez; registros en `companion-mediciones-M1/lat001-frente/relcost.jsonl`):** la línea añade ~15 tokens al prompt (2 013 → 2 026-2 028) y la respuesta con la misma línea repetida cuesta 0,19 s. **Cada CAMBIO de nivel invalida la caché de la cabecera:** none→few 14,6 s, few→several 14,3 s, several→many 14,3 s (frente a 13,6 s de un arranque en frío del mismo chat). O sea, una respuesta lenta cada vez que el personaje cruza el umbral de 1, 5 o 12 recuerdos (3 veces en total en la vida de un personaje), y una vez al actualizar la app en un chat cuyo personaje ya tiene recuerdos. El costo crece con el largo del chat (MEM-004: ~22 s con 2 440 tokens, ~40 s con 4 020, ~1 min con ~5 500; Inferencia para esos largos, aquí solo se midió 2 013). Borrar recuerdos y bajar de nivel cuesta lo mismo.
**No verificado:** el efecto de la frase en el comportamiento del modelo (no se midió si Mia responde distinto) ni en el teléfono.


## UI-016: el menú del mensaje era inalcanzable (2026-09-26, sesión Q3)

**Reproducción (Hecho, navegador integrado 375×812, datos sintéticos):** con el último mensaje del personaje (que lleva marcapáginas UI-010), el menú se abría en y=731..827 mientras la lista visible terminaba en y=747: solo 16 px de un menú de 96 px quedaban a la vista. Orden en la fila: burbuja, marcapáginas (`.chat-row__meta`, 32 px), menú.
**Causa raíz (dos fallos que se sumaban; el "toque fuera" NO era la causa: `onMessagesClick` ya excluía `.chat-row__actions` y `.chat-row__meta`, y la hoja de detalle vive fuera de la lista):**
1. Al abrirse, el menú no se desplazaba a la vista. El comentario de `onMessagesScroll` mencionaba un "ajuste de posición justo al abrirlo" que ya no existía en el código; el usuario tenía que hacer scroll para llegar a los botones, y ese scroll (pasados 300 ms) cerraba el menú.
2. Los 4 botones (72+75+76+98 px + huecos de 8) no cabían en una línea (302 px disponibles): "Regenerar" saltaba a una segunda línea y el menú medía 96 px en vez de 44.
**Cambios:** `msgmenu.js` gana dos funciones puras (`revealDelta`, `shouldCloseOnScroll`); `openMessageMenu` desplaza la lista (sin animación) hasta ver el menú entero y anota la posición resultante; el scroll solo cierra el menú si la lista se aleja más de 12 px de esa posición (un temblor del dedo o el propio ajuste ya no lo cierran; un scroll real sí, limpio, sin botones fantasma). `chat.css`: botones con `padding: 0 var(--space-3)` y hueco de 4 px → una sola línea de 44 px. El marcapáginas no se mueve ni cambia de tamaño al abrir el menú (el menú va DESPUÉS de él); su clic sigue sin cerrar el menú de otro mensaje.
**Verificado en el navegador:** último mensaje (con marcapáginas coloreado): menú entero y en una línea (y=695..739, lista hasta 747), sigue abierto medio segundo después; scroll de 5 px no lo cierra, de 120 px sí (el menú sale del DOM); tocar el marcapáginas de otro mensaje abre su hoja sin cerrar el menú; mensaje con marcapáginas gris: 3 botones, entero a la vista; un clic real en "Editar" abre la hoja de edición.
**Tests:** 409 → 415 (`tests/msgmenu.test.mjs`). **No verificado:** en el teléfono (WebView de Android), donde el tacto genera pequeños movimientos que aquí solo se simularon con `scrollTop`.

## UI-017: elegir entre respuestas regeneradas (2026-09-26, sesión Q3)

**Modelo de datos (decisión):** un mensaje del personaje conserva `text` y `loreUsed?` y esos campos son SIEMPRE los de la versión activa; solo cuando hay 2 o más versiones se añaden `variants: {text, loreUsed?}[]` y `activeVariant`. Así el armado del prompt (`prompt.js`), el resumen de continuidad, "Copiar", la vista previa del chat y el marcapáginas de memoria siguen leyendo `m.text`/`m.loreUsed` sin cambios, y el marcapáginas es "por variante" sin código extra. Un mensaje sin `variants` (todo lo guardado hasta hoy) es una lista de una sola versión y carga idéntico (test). La lógica vive en `www/js/variants.js` (pura: `addVariant`, `selectVariant`, `editActiveText`, `normalizeVariants`). Regla de verdad: si `text` y la variante activa no coinciden (otra ruta editó `text`), manda `text`. `sanitizeMessage` (ahora exportada) valida al leer: variantes malformadas se descartan dejando `text` intacto; nunca se descarta el mensaje.
**Regenerar:** la respuesta anterior sale de la lista solo mientras se genera (el historial que viaja termina en el mensaje del usuario, igual que antes); al terminar vuelve como una versión más y la nueva queda activa. Lo guardado en disco no cambia hasta que termina. **Mejora colateral (Hecho):** si el servidor falla o no responde, la respuesta anterior se conserva (antes se perdía). Una respuesta cortada a mano (parada) con texto parcial se guarda como versión, igual que antes se guardaba el parcial. Navegar (`‹ 2/3 ›` bajo la burbuja, después del marcapáginas; deshabilitado en los extremos) es instantáneo, sin servidor, y se guarda; no hay navegación mientras se genera. Editar cambia solo la versión activa; Borrar quita el mensaje entero con todas sus versiones (como hasta hoy, sin confirmación).
**Copias y exportación (decisión):** la copia de seguridad v2 (`exportBackup`) y el log de chat exportado incluyen TODAS las versiones (para no perder nada); el formato sigue siendo `version: 2` porque los campos son opcionales: versiones anteriores de la app que lean esos archivos ven `text` como siempre. Importar una copia/log sin `variants` funciona igual que antes; el import de chat ahora pasa cada mensaje por `sanitizeMessage` (conserva variantes y `loreUsed` válidos, descarta basura).
**Tests:** 415 → 423 (`tests/variants.test.mjs`: mensaje viejo idéntico; regenerar agrega sin borrar; navegar cambia la activa y el marcapáginas; editar solo la activa; el prompt (texto simple y plantilla) usa la versión activa; saneado de basura y de desajustes; guardar/leer, exportar/importar copia v2 y copia sin variantes).
**Verificado en el navegador (375×812) contra el servidor real:** regenerar dos veces → `3/3`; ‹ ‹ → `1/3` con el marcapáginas de la versión 1 (gris); lo guardado en IndexedDB tiene las 3 versiones y `text` = la activa; con la versión 1 activa se envió un mensaje y en el cuerpo de la petición viajó solo el texto de la versión 1 (no las otras dos); con el `fetch` simulado como caído, regenerar dejó el mensaje y su texto intactos. **No verificado:** en el teléfono; el comportamiento con chats muy largos.

## UI-018: saludo del hub según la hora (2026-09-26, sesión Q3)

**Cambio:** la franja del hub que mostraba el chip "Conectado · <modelo>" ahora muestra un saludo (`h2`, 20 px) y, al final de esa fila, un punto de estado de 10 px (verde conectado, rojo sin conexión, gris comprobando; área táctil de 44 px que sigue abriendo Ajustes, como el chip). El nombre del modelo ya no se muestra; queda en la etiqueta accesible (`aria-label`/`title`) del punto. El título "Chats" de la barra superior no cambia. La lógica de conexión (`connect`, `checkConnection`, `viewToken`) no se tocó.
**Franjas (hora local del dispositivo):** madrugada 0-5, mañana 6-11, tarde 12-19, noche 20-23 (`greeting.js`, puro). 5 frases genéricas por franja, sin nombres ni dependencia de red (incluye las dos de ejemplo del usuario: "Bienvenido de vuelta", "¿Desvelándote?"). `pickGreeting(hour, last, rand)` nunca devuelve la frase anterior si hay otra opción.
**Cuándo cambia la frase:** una vez por apertura de la app (`sessionGreeting`), no cada vez que se vuelve al hub (evita que "parpadee"); si cambia la franja con la app abierta, se elige otra. La última frase se guarda en `localStorage` (`companion.lastGreeting`) para no repetirla en la apertura siguiente; es solo una comodidad: si el almacenamiento falla se elige igual (dato no crítico, no toca IndexedDB ni `Settings`).
**Tests:** 423 → 428 (`tests/greeting.test.mjs`: límites de franja incluida la medianoche y valores raros, ≥5 frases distintas por franja, no repetir con cualquier valor aleatorio, franja correcta, todas las frases salen).
**Verificado en el navegador (375×812):** forzando la hora (8, 15, 22) salen frases de cada franja; volver al hub en la misma franja no la cambia; con `fetch` caído el punto pasa a rojo y su etiqueta dice "Sin conexión con el servidor". **No verificado:** varias aperturas reales de la app en el teléfono (el "no repetir" entre aperturas se probó solo con pruebas unitarias y con la lectura de `localStorage`).
