# NOTES.md — Estado del proyecto (punto de partida)

Este archivo es la **memoria de arranque** del proyecto: se lee completo al
empezar una sesión (menos de ~300 líneas a propósito). Cómo se organiza la
documentación (contrato DOC-003, 2026-09-24):

- **`docs/CONTRACT-HANDOFF.md`** (secciones 0, 3 y 4): rol, cómo trabajar con el
  usuario y reglas de git. Léelo primero.
- **`docs/NOTES.md`** (este archivo, completo): "Estado vigente", "Perfil del
  servidor y principios de producto", "Registro de contratos", un resumen de los
  contratos recientes, la hoja de ruta acordada y el "Mapa de la historia".
- **`docs/HISTORIAL.md`**: TODA la historia detallada (decisiones, mediciones,
  informes de cada contrato). **Solo bajo demanda**: no lo leas entero; usa el
  "Mapa de la historia" de abajo y `grep -n '^## ' docs/HISTORIAL.md`.
- `docs/CONTRACTS.md`: tipos y firmas de los módulos (parcialmente superado: en
  caso de duda mandan "Estado vigente" y el código). `docs/CONTRACT-LOREBOOK.md`,
  `docs/CONTRACT-CHARACTER-CREATOR.md`: encargos específicos. `docs/DESIGN.md`:
  tokens de diseño.

Al terminar un contrato: registra su estado en el "Registro de contratos", deja
un resumen corto aquí (máx. ~15 líneas) y el informe completo en `HISTORIAL.md`.

## Estado vigente (verificado contra el código el 2026-09-23, contrato DOC-001)

> Una página. Si otra sección de este archivo o de otro documento dice algo
> distinto, **manda esta sección y el código**. Las secciones antiguas viven en
> `docs/HISTORIAL.md` (ver "Mapa de la historia" al final) y llevan la marca
> "(SUPERADO por: …)" cuando ya no describen la realidad.

**Arquitectura.** JavaScript vanilla con módulos ES, sin bundler para el
runtime (`www/`). Empaquetado como APK con Capacitor; el workflow
(`.github/workflows/build-apk.yml`) corre `npm test`, `npx cap add android`
y `assembleDebug` en cada push (`android/` NO está versionado). Desde ARQ-001
firma con una llave de depuración fija versionada en `signing/`; como la
primera versión falló en el CI, ARQ-002 re-firma el APK explícitamente con
`apksigner` y verifica la huella (ver "ARQ-001" y "ARQ-002" en `HISTORIAL.md`). Persistencia
solo en `www/js/state.js` (IndexedDB `companion`, versión 2, stores
`settings`, `characters`, `chats` [legado], `chatMeta`, `chatMsgs`). `fetch`
solo en `www/js/api/kobold.js`. Skins = solo tokens en `www/css/themes.css`
(3 skins × claro/oscuro). Vistas: `lock` (solo al arrancar, fuera de la
navegación), `setup`, `home`, `chats`, `chat`. Versión: `APP_VERSION`
(`www/js/version.js`) y `package.json` coinciden (`1.1.0`).

**Modelo de datos actual** (fuente de verdad: typedefs de `state.js`):
- `Settings` (1 registro, clave `main`): `url`, `user`, `maxLen`, `temp`,
  `mode` (`'chat'` por defecto | `'plain'`), `ctx`, `pinSalt`, `pinHash`,
  `theme` (`nomi|glass|imessage`), `themeMode` (`dark|light`), `lorebookAuto`
  (boolean, `false` por defecto; MEM-002: solo `true` activa la extracción
  automática de memoria).
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
  El respaldo automático NO tiene este formato (ver VER-001 en `HISTORIAL.md`).

**Implementado:** multi-chat por personaje con escenario propio; exportar/
importar chat y copia completa; respaldo automático silencioso a
`Documents/Companion-backups/` (solo APK); PIN opcional; indicador de
contexto; hub de 2 columnas con lupa de búsqueda; lorebook automático por
personaje (MEM-001 v2: extracción aditiva de una línea vía KoboldCpp, inyección
por keyword, hoja "Ver lorebook" con editar/borrar/deshacer y "Actualizar memoria
ahora"; MEM-002: la actualización automática cada 20 mensajes está APAGADA por
defecto y se activa con un interruptor en esa hoja); 3 skins × claro/oscuro; fondo
de chat por personaje; CI con gate de tests; versión visible en Ajustes; 187
tests (`node --test tests/*.test.mjs`).

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
  servidor). **Decisión (MEM-002, 2026-09-24):** la actualización automática
  queda apagada por defecto (`Settings.lorebookAuto`); la manual se conserva y
  avisa el costo. Siguen pendientes de evaluar las opciones 2 (extraer sobre el
  prefijo del chat, VER-004) y 4 (espaciar o disparar al salir del chat); ver
  "MEM-001 v2 → Informe de latencia" (en `HISTORIAL.md`) y "MEM-002".
- ~~El modo "plantilla del modelo" no corta en `\n` (posibles dos párrafos)~~:
  **corregido por FMT-001** (2026-09-24): `stop` incluye `"\n"` y una respuesta
  vacía se reintenta una vez. Ver "FMT-001" en `HISTORIAL.md`. Pendiente relacionado, sin
  contrato: `Settings.maxLen` (>160) y `Settings.temp` no tienen efecto real con
  este servidor (recorta a 160 tokens e impone su muestreo); informarlo en Ajustes.

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
v2 → Paso 0" (en `HISTORIAL.md`). Resumen:
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
  carácter). Consecuencia: el prompt de extracción usa un "prefill" (ver MEM-001 v2 en `HISTORIAL.md`).

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
8. **La app no trae datos personales del usuario precargados.** Lo que el
   personaje sabe del usuario se construye conversando (memoria/lorebook). La
   logística que la app necesite (por ejemplo, franjas de horas en que el usuario
   no puede chatear) será configurable por él, sin sembrar datos suyos.
9. **Ficción consciente.** El usuario es un adulto que sabe que la relación con
   el personaje es ficción. No añadir avisos ni sermones repetitivos sobre esto
   en el chat. Se mantienen, sin embargo, la honestidad ante una pregunta sincera
   sobre la naturaleza de IA y las rutas de bienestar si algún día la app se
   comparte con otras personas. Nunca patrones de retención que generen culpa,
   urgencia o celos.

**Dónde está cada decisión** (todas estas secciones están en `docs/HISTORIAL.md`): lorebook por personaje → "Cambio de diseño:
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
| VER-001 | Auditoría de recuperabilidad y seguridad de datos | Autorizado — ejecutado el 2026-09-23; informe en "Auditoría VER-001" (en `HISTORIAL.md`) | Solo lectura: no cambia comportamiento. Los hallazgos P0/P1 requieren contratos de corrección aparte (sin autorizar). |
| ARQ-001 | Firma estable del APK | Implementado el 2026-09-24; **la verificación falló en el CI** (build #14: la huella del APK no coincidió con la esperada); **corregido por ARQ-002** | Ver "ARQ-001" y "ARQ-002" (en `HISTORIAL.md`). Llave en `signing/`, workflow actualizado. |
| ARQ-002 | Corregir la firma del APK: firmar explícitamente con la llave fija | Autorizado — implementado el 2026-09-24 (este lote); **pendiente de verificar en el CI y en un teléfono real** | El workflow re-firma con `apksigner sign` y verifica la huella. Ver "ARQ-002". |
| DOC-002 | Registrar perfil del servidor, principios de producto y estado real de los contratos | Autorizado — ejecutado el 2026-09-24 (este lote; solo `docs/`) | Sección "Perfil del servidor y principios de producto", este Registro, pendientes de "Estado vigente" y rutas con marcadores. |
| MEM-001 v2 | Lorebook: actualizaciones aditivas compatibles con el servidor real, protección contra pérdida y gestión manual | Autorizado — **implementado el 2026-09-24** (sesión B); Paso 0 ejecutado contra el servidor real; **pendiente de probar en el teléfono** | Ver "MEM-001 v2" (en `HISTORIAL.md`). Reporta un problema de latencia que requiere decisión. Reemplaza al MEM-001 anterior. |
| FMT-001 | Preservar el formato de un solo párrafo en el modo "plantilla del modelo" y evitar respuestas vacías | Autorizado — **implementado el 2026-09-24** (sesión C); medido contra el servidor real; **pendiente de probar en el teléfono** | Ver "FMT-001" (en `HISTORIAL.md`). |
| MEM-002 | Extracción automática de memoria apagada por defecto (protección de la latencia del chat) | Autorizado (decisión del arquitecto) — **implementado el 2026-09-24** (sesión C); **pendiente de probar en el teléfono** | Ver "MEM-002" (en `HISTORIAL.md`). Campo `Settings.lorebookAuto`. |
| DOC-003 | Reducir el costo de leer la documentación: dividir NOTES.md y registrar principios y hoja de ruta | Autorizado — ejecutado el 2026-09-24 (sesión C; solo `docs/`) | Historia movida tal cual a `HISTORIAL.md`; este archivo queda como punto de partida. Añade principios 8 y 9 y la hoja de ruta. |
| BKP-001 | Importación de copias segura: confirmar, no pisar datos nuevos, todo o nada | **Autorizado; sin implementar** (sesión posterior a MEM-001 v2, solo cuando el usuario lo pida) | Punto de partida: hallazgos 2 y 10 de VER-001. |
| MEM-001 (v1) | (Anulado) versión anterior de MEM-001 | **ANULADO**, reemplazado por MEM-001 v2 | Asumía que el servidor podía devolver una lista larga con saltos de línea. |
| (previos) | `CONTRACT-LOREBOOK.md` (implementado, parcialmente superado), `CONTRACT-CHARACTER-CREATOR.md` (propuesta, no autorizada), `CONTRACT-HANDOFF.md` (briefing) | — | Ver los avisos al inicio de cada uno. |


## Resumen de contratos recientes (detalle en `HISTORIAL.md`)

- **ARQ-001 / ARQ-002 (2026-09-24), firma estable del APK.** Cada APK salía con una
  llave distinta y actualizar obligaba a desinstalar (perdiendo datos). ARQ-001
  versionó una llave fija en `signing/`, pero su verificación falló en el CI
  (build #14). ARQ-002 re-firma con `apksigner` y verifica la huella. **Pendiente
  de verificar en el CI y en un teléfono real.**
- **VER-001 (2026-09-23), auditoría de recuperabilidad y seguridad de datos.** Solo
  lectura. 20 hallazgos (P0–P3). Los más importantes: el respaldo automático NO es
  una copia completa ni restaurable con `importBackup` (1–4), `importBackup` pisa
  datos sin avisar (10, pendiente: BKP-001), no se guarda la respuesta parcial al
  pasar a segundo plano (7). Ver la tabla de hallazgos en `HISTORIAL.md`.
- **MEM-001 v2 (2026-09-24), memoria (lorebook) aditiva.** Extracción de una línea y
  hasta 3 entradas con prefill, compatible con el servidor real; hoja "Ver
  lorebook" con editar/borrar/deshacer y "Actualizar memoria ahora". Incluye el
  Paso 0 (mediciones del servidor: límite de 160 tokens, corte en `\n` por
  endpoint, caché de prompt) y el informe de latencia. **Pendiente de probar en el
  teléfono.**
- **FMT-001 (2026-09-24), un solo párrafo y sin respuestas vacías.** `stop` de
  `buildChatMessages` incluye `"\n"`; `generateReplyNonEmpty` reintenta una vez si
  la respuesta sale vacía y `chat.js` avisa si sigue vacía. Medido: estrés 10/12 →
  0/12 con salto de línea; con la card de Mia, 1/80 → 0/80; 0 vacías en 160
  respuestas (el reintento solo se probó con dobles y un servidor simulado).
  Pendiente sin contrato: `Settings.maxLen` (>160) y `Settings.temp` no tienen
  efecto real con este servidor.
- **MEM-002 (2026-09-24), memoria automática apagada por defecto.** Cada extracción
  cuesta ~20 s en la SIGUIENTE respuesta (principio nº 1: latencia). `Settings.
  lorebookAuto` (false por defecto) + casilla con aviso en "Ver lorebook"; la
  actualización manual sigue igual y avisa. Opciones 2 y 4 del informe de latencia
  (extraer sobre el prefijo del chat; espaciar/disparar al salir) siguen pendientes
  de evaluación.

## Hoja de ruta acordada (propuesta, NO autorizada)

Ninguna de estas piezas está autorizada ni tiene contrato todavía; no se
implementan sin un contrato del arquitecto. Sin datos personales del usuario.
1. **Fecha y hora reales en el prompt** y horarios "fuera de línea" configurables
   por el usuario (franjas en que no puede chatear).
2. **BKP-001** (autorizado, Sesión D): importación de copias segura (confirmar, no
   pisar datos nuevos, todo o nada).
3. **Memoria de "lo que importa del usuario"**, con opción de marcar algo como
   importante y sugerencias que se confirman en lugar de guardarse solas.
4. **Verificación de notificaciones programadas en Android** (¿llegan con la app
   cerrada y el teléfono en reposo?).
5. **"Cartas" programadas del personaje**, generadas por adelantado cuando el
   servidor está encendido, con tope diario adaptativo, pausa global y opción de
   ocultar el contenido en la pantalla de bloqueo.
6. **Modo en vivo** solo si (4) lo permite.
7. Aparte: **leer del servidor los límites de contexto** para ajustar los topes de
   la memoria sin tocar el código.

## Mapa de la historia (`docs/HISTORIAL.md`, una línea por sección)

- **Línea de tiempo resumida** — orden de lo construido y bugs reales corregidos; consúltala para situarte.
- **Adenda grande: varios chats por personaje** — modelo multi-chat (stores `chatMeta`/`chatMsgs`, escenario por chat); consúltala al tocar chats o migración.
- **Cómo verificar que todo sigue sano** — comandos de verificación; consúltala antes de dar algo por bueno.
- **Bug crítico corregido: exportar en el APK** — causa y arreglo de `saveBlob()` en Capacitor; al tocar exportación/respaldo.
- **Reorganización de Git (2026-09-22)** — cómo se rehízo el repositorio; solo si git se ve raro.
- **Ronda de feedback tras probar el APK (2026-09-22)** — primeros ajustes a partir de usar la app.
- **Segunda ronda de QoL (2026-09-23)** — respaldo automático silencioso, PIN, default `mode`; al tocar esas piezas.
- **Hub de personajes: segunda iteración visual** — diseño de las 2 columnas de tarjetas; al tocar el hub.
- **Contratos de continuidad (2026-09-23)** — por qué existen `CONTRACT-HANDOFF/LOREBOOK`.
- **Subsistema de memoria/lorebook automático** — diseño original (parcialmente superado por MEM-001 v2); lorebook por personaje.
- **Portabilidad y calidad a futuro** — lectura de ingeniería, punto C sobre firma y reinstalación; para decisiones de plataforma.
- **Skins (Nomi/Glass) y fondo de chat personalizado** — historia de los skins (superado en parte).
- **Tipografía Literata y color de asteriscos** — decisión tipográfica y color de `*acciones*`.
- **Rearquitectura del sistema de skins** — skins solo con tokens en `themes.css`; obligatoria antes de tocar temas.
- **Fondo de chat por personaje + buscador** — el fondo vive en `Character`; buscador del hub.
- **Qué NO se ha hecho todavía** — lista antigua de pendientes (ver "Estado vigente" para la vigente).
- **Propuesta: creador de personajes guiado** — propuesta NO autorizada y el patrón de la card de Mia.
- **Auditoría VER-001** — 20 hallazgos con evidencia, comprobaciones ejecutadas y respuestas a 10 preguntas; al tocar respaldo, importación o seguridad.
- **ARQ-001** y **ARQ-002** — firma del APK: diseño, fallo del CI (huellas) y corrección.
- **MEM-001 v2** — Paso 0 (mediciones del servidor real), implementación, verificación, informe de latencia, observación del tester y límites de calidad; al tocar memoria, latencia o el perfil del servidor.
- **FMT-001** — mediciones antes/después del `stop` y del reintento por respuesta vacía.
- **MEM-002** — decisión de apagar la memoria automática, cambios y limitación conocida.
