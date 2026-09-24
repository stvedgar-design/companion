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

## Estado vigente (verificado contra el código el 2026-09-23, contrato DOC-001)

> Una página. Si otra sección de este archivo o de otro documento dice algo
> distinto, **manda esta sección y el código**. Las secciones antiguas de
> abajo se conservan como historia y llevan la marca "(SUPERADO por: …)"
> cuando ya no describen la realidad.

**Arquitectura.** JavaScript vanilla con módulos ES, sin bundler para el
runtime (`www/`). Empaquetado como APK con Capacitor; el workflow
(`.github/workflows/build-apk.yml`) corre `npm test`, `npx cap add android`
y `assembleDebug` en cada push (`android/` NO está versionado). Desde ARQ-001
firma con una llave de depuración fija versionada en `signing/`; como la
primera versión falló en el CI, ARQ-002 re-firma el APK explícitamente con
`apksigner` y verifica la huella (ver "ARQ-001" y "ARQ-002"). Persistencia
solo en `www/js/state.js` (IndexedDB `companion`, versión 2, stores
`settings`, `characters`, `chats` [legado], `chatMeta`, `chatMsgs`). `fetch`
solo en `www/js/api/kobold.js`. Skins = solo tokens en `www/css/themes.css`
(3 skins × claro/oscuro). Vistas: `lock` (solo al arrancar, fuera de la
navegación), `setup`, `home`, `chats`, `chat`. Versión: `APP_VERSION`
(`www/js/version.js`) y `package.json` coinciden (`1.1.0`).

**Modelo de datos actual** (fuente de verdad: typedefs de `state.js`):
- `Settings` (1 registro, clave `main`): `url`, `user`, `maxLen`, `temp`,
  `mode` (`'chat'` por defecto | `'plain'`), `ctx`, `pinSalt`, `pinHash`,
  `theme` (`nomi|glass|imessage`), `themeMode` (`dark|light`).
- `Character` (store `characters`): `id`, `name`, `avatar` (data URL),
  `card` (Card normalizada), `avatarMode`, `created`, `lorebook: LoreEntry[]`
  (por personaje, compartido entre sus chats), `lorebookPrevious: LoreEntry[]` y
  `lorebookPreviousAt` (MEM-001 v2: copia del lorebook antes de la última
  actualización de memoria, un nivel de "Deshacer"; `[]`/`0` = nada que
  deshacer), `chatBackground` (data URL),
  `chatBackgroundBrightness`, `chatBackgroundFade`, `chatBackgroundFit`.
  Además `updated` y `last`: los escribe `cards/import.js` al importar, pero
  **nada los mantiene** después (el hub ordena por `updated`, o sea por fecha
  de importación, no por actividad reciente; la vista previa sale del chat).
- `Chat` (store `chatMeta`): `id`, `characterId`, `title`, `scenario`,
  `created`, `updated`, `last`, `lastExportAt`, `lorebookMessageCount`
  (marcador de disparo del lorebook; ya NO guarda entradas).
- `Message` (store `chatMsgs`, un array por `chatId`): `role` (`user|char`),
  `text`, `ts`.
- `LoreEntry`: `id`, `keys[]`, `content`, `updated`, `source` (`auto|manual`).
- Backup manual: JSON `{app:'companion', version:2, exported, settings,
  characters, chats, chatMessages}`; `importBackup` también acepta v1.
  El respaldo automático NO tiene este formato (ver VER-001, más abajo).

**Implementado:** multi-chat por personaje con escenario propio; exportar/
importar chat y copia completa; respaldo automático silencioso a
`Documents/Companion-backups/` (solo APK); PIN opcional; indicador de
contexto; hub de 2 columnas con lupa de búsqueda; lorebook automático por
personaje (MEM-001 v2: cada 20 mensajes, extracción aditiva de una línea vía
KoboldCpp, inyección por keyword, hoja "Ver lorebook" con editar/borrar/deshacer
y "Actualizar memoria ahora"); 3 skins × claro/oscuro; fondo de chat por
personaje; CI con gate de tests; versión visible en Ajustes; 174 tests (`node
--test tests/*.test.mjs`).

**Pendiente:** todo lo anterior **sin probar en un APK real** (el teléfono
del usuario tiene la 4.ª APK del repositorio, muy anterior); pantalla de respaldos; búsqueda dentro de un chat; ajustes de IA por personaje; creador de
personajes guiado (solo propuesta, no autorizado). Añadido por DOC-002
(2026-09-24), a raíz de VER-001 y de las decisiones del arquitecto:
- Respaldo automático completo: un archivo por `chatId` (hoy NO es así, ver
  VER-001 hallazgo 3), con personaje y lorebook, restaurable.
- Guardado de respuesta parcial y manejo de segundo plano
  (`visibilitychange`/`pagehide`; VER-001 hallazgo 7).
- `.gitignore` y `package-lock.json` (sin excluir `signing/`; VER-001
  hallazgo 20).
- Imágenes (avatar, fondo) fuera del registro del personaje (VER-001
  hallazgo 18).
- ~~Prueba de la memoria (lorebook) contra el servidor real~~: hecha desde el PC
  en MEM-001 v2 (Paso 0 y prueba de la hoja en el navegador integrado);
  **sigue pendiente la prueba desde el teléfono con el APK.**
- Latencia de la memoria: cada actualización de memoria hace que la SIGUIENTE
  respuesta del chat tarde ~15–25 s más (invalida la caché de prompt del
  servidor). Ver "MEM-001 v2 → Informe de latencia"; decisión pendiente del
  arquitecto y del usuario.
- El modo "plantilla del modelo" (`/v1/chat/completions`) no corta en `\n`, por lo
  que puede devolver dos párrafos (formato Nomi = un párrafo). Causa medida y
  arreglo sugerido en "MEM-001 v2 → Observación del tester"; sin contrato aún.

## Perfil del servidor y principios de producto (contrato DOC-002, 2026-09-24)

> Referencia rápida para cualquier instancia nueva. Estos hechos definen qué
> diseños tienen sentido; léelos antes de proponer funciones de memoria,
> prompts largos o cambios de formato.

**Servidor — Hecho (aportado por el usuario)**, no medido por el proyecto:
- KoboldCpp 1.121 en el PC personal del usuario (se apaga cuando sale de
  casa; la app lo alcanza por su red privada, `<IP-TAILSCALE>`, o por
  `http://localhost:5001` cuando se prueba en el propio PC).
- Modelo: Mahou-1.5-mistral-nemo-12B, cuantización IQ4_XS (~6,4 GB; ruta
  `<RUTA-DEL-MODELO>`).
- GPU AMD de la familia RX 470/480/570/580 vía Vulkan, todas las capas en GPU;
  15 GiB de RAM; CPU de 12 hilos con AVX2.
- Lanzado con: `--usevulkan 0 --gpulayers 99 --contextsize 6144 --genlimit 160
  --port 5001 --gendefaults {...} --gendefaultsoverwrite`. Los `gendefaults`
  fijan temperature 0.8, top_p 1.0, top_k 0, min_p 0.05, rep_pen 1.06, DRY y
  presence_penalty 0.15, y `stop_sequence: ["\n"]`. No se lanza con
  `--multiuser`.
- Respuesta típica del chat: ~6 segundos. Los scripts y la configuración del
  servidor (`jugar.sh`, `config.env`, …) están fuera del proyecto y NO se
  modifican desde aquí.

**Hecho (MEDIDO en MEM-001 v2, Paso 0, 2026-09-24, contra ese mismo servidor,
KoboldCpp 1.121, contexto 6144):** el supuesto original resultó cierto en lo
esencial, con un matiz importante por endpoint. Detalle y números en "MEM-001
v2 → Paso 0". Resumen:
- El servidor corta CADA respuesta a **160 tokens**, sin importar el
  `max_length`/`max_tokens` pedido (200, 400 y 1024 dieron 160). Vale para todos
  los endpoints probados. Por tanto `Settings.maxLen` por encima de 160 no tiene
  efecto real.
- Los parámetros de muestreo de la petición (`temperature`, `top_k`) **se
  ignoran** (`--gendefaultsoverwrite`): con `temperature:0, top_k:1` la salida
  siguió variando.
- **El corte en el primer `\n` depende del endpoint:** en `/api/v1/generate` y
  `/api/extra/generate/stream` (modo "texto simple") se aplica SIEMPRE, incluso
  si la petición manda otro `stop_sequence`; en `/v1/chat/completions` (modo
  "plantilla del modelo") solo se aplica si la petición NO envía `stop`, y la
  app sí lo envía (`["\n<usuario>:"]`), así que ahí NO se corta y salen párrafos.
- Dos peticiones simultáneas se **encolan** (ambas responden 200; la segunda
  espera a la primera); no hay error de "ocupado".
- `POST /api/extra/abort` con el `genkey` de la petición SÍ corta la generación
  en el servidor; cerrar la conexión del cliente NO (el servidor sigue
  generando y bloquea la petición siguiente).
- Una respuesta que empieza con `\n` llega VACÍA (se corta antes del primer
  carácter). Consecuencia: el prompt de extracción usa un "prefill" (ver MEM-001 v2).

**Principios de producto (decisiones del usuario; no las cambies sin él):**
1. **Latencia primero.** "Un chat de 20 minutos no debería ocupar 1 hora."
   Ninguna función puede empeorar de forma perceptible la latencia del chat
   sin autorización del usuario.
2. **Local y sin censura.** El proyecto existe para no depender de servicios
   comerciales que deprecan modelos.
3. **Formato "Nomi", no SillyTavern.** Cada turno del personaje es UN solo
   párrafo, en primera persona: `*acción en cursiva*` seguida de diálogo sin
   comillas (p. ej. `*Me sonrojo y bajo la mirada.* Y-yo soy Mia.`). El
   usuario escribe igual.
4. **Conversación en inglés, interfaz en español.** El texto que se le pide al
   modelo (p. ej. la memoria) debe ir en el idioma de la conversación.
5. **Un personaje principal.** Mia es el único personaje de uso regular; su
   card no ha cambiado desde la primera versión.
6. **El servidor puede estar apagado.** Toda función que lo use debe fallar
   con elegancia y sin perder datos.
7. Los chats históricos del usuario solo existen como capturas de pantalla; el
   teléfono no tiene datos valiosos en la app (versión muy antigua).

**Dónde está cada decisión:** lorebook por personaje → "Cambio de diseño:
lorebook por personaje, no por chat"; fondo por personaje → "Fondo de chat
por personaje + buscador"; skins → "Rearquitectura del sistema de skins";
firma del APK y reinstalación → "Portabilidad y calidad a futuro", punto C y
"ARQ-001: firma estable del APK";
fix de exportación en APK → "Bug crítico corregido…"; respaldo automático,
PIN, default `mode` → "Segunda ronda de QoL"; hub de 2 columnas → "Hub de
personajes: segunda iteración visual"; auditoría de recuperabilidad →
"Auditoría VER-001"; reglas de trabajo con el usuario → `CONTRACT-HANDOFF.md`.

## Registro de contratos

| ID | Título | Estado | Notas |
|---|---|---|---|
| DOC-001 | Reconciliar la documentación con el estado real | Autorizado — ejecutado el 2026-09-23 (solo `docs/`; el commit lo confirma `git log`) | Esta sección, "Estado vigente", marcas "SUPERADO", `CONTRACTS.md` reescrito a los typedefs reales y aviso al inicio de `CONTRACT-LOREBOOK.md`. |
| VER-001 | Auditoría de recuperabilidad y seguridad de datos | Autorizado — ejecutado el 2026-09-23; informe en "Auditoría VER-001" (al final de este archivo) | Solo lectura: no cambia comportamiento. Los hallazgos P0/P1 requieren contratos de corrección aparte (sin autorizar). |
| ARQ-001 | Firma estable del APK | Implementado el 2026-09-24; **la verificación falló en el CI** (build #14: la huella del APK no coincidió con la esperada); **corregido por ARQ-002** | Ver "ARQ-001" y "ARQ-002" (al final de este archivo). Llave en `signing/`, workflow actualizado. |
| ARQ-002 | Corregir la firma del APK: firmar explícitamente con la llave fija | Autorizado — implementado el 2026-09-24 (este lote); **pendiente de verificar en el CI y en un teléfono real** | El workflow re-firma con `apksigner sign` y verifica la huella. Ver "ARQ-002". |
| DOC-002 | Registrar perfil del servidor, principios de producto y estado real de los contratos | Autorizado — ejecutado el 2026-09-24 (este lote; solo `docs/`) | Sección "Perfil del servidor y principios de producto", este Registro, pendientes de "Estado vigente" y rutas con marcadores. |
| MEM-001 v2 | Lorebook: actualizaciones aditivas compatibles con el servidor real, protección contra pérdida y gestión manual | Autorizado — **implementado el 2026-09-24** (sesión B); Paso 0 ejecutado contra el servidor real; **pendiente de probar en el teléfono** | Ver "MEM-001 v2" (al final de este archivo). Reporta un problema de latencia que requiere decisión. Reemplaza al MEM-001 anterior. |
| BKP-001 | Importación de copias segura: confirmar, no pisar datos nuevos, todo o nada | **Autorizado; sin implementar** (sesión posterior a MEM-001 v2, solo cuando el usuario lo pida) | Punto de partida: hallazgos 2 y 10 de VER-001. |
| MEM-001 (v1) | (Anulado) versión anterior de MEM-001 | **ANULADO**, reemplazado por MEM-001 v2 | Asumía que el servidor podía devolver una lista larga con saltos de línea. |
| (previos) | `CONTRACT-LOREBOOK.md` (implementado, parcialmente superado), `CONTRACT-CHARACTER-CREATOR.md` (propuesta, no autorizada), `CONTRACT-HANDOFF.md` (briefing) | — | Ver los avisos al inicio de cada uno. |

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
| 17 | Cada APK se firma con un keystore distinto (causa ya documentada): actualizar exige desinstalar. La copia manual completa (v2) es entonces la única vía real de conservar personajes, chats y lorebook al actualizar, y es manual. | `build-apk.yml` (sin `android/` ni keystore versionados); sección "Portabilidad…", punto C | H | P1 (para futuras versiones) — **Corregido, pendiente de verificar en teléfono**: ARQ-001 (2026-09-24) falló la verificación en el CI (build #14) y ARQ-002 lo corrige con firma explícita |
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
