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

**`para-el-arquitecto/` (DOC-004)** es una copia plana SOLO para lectura externa (la genera `node tools/para-el-arquitecto.mjs`, está en
`.gitignore`): ninguna instancia de Claude Code debe leerla ni usarla como fuente de verdad; los archivos originales mandan.

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
`settings`, `characters`, `chats` [legado], `chatMeta`, `chatMsgs`; las escrituras de `chatMeta` que leen y luego escriben se serializan por chat, MEM-007). `fetch`
solo en `www/js/api/kobold.js`. Skins = solo tokens en `www/css/themes.css`
(5 skins × claro/oscuro; tipografía Literata incluida en `www/fonts/`, sin red). Vistas: `lock` (solo al arrancar, fuera de la
navegación), `setup`, `home`, `chats`, `chat`. Versión: `APP_VERSION`
(`www/js/version.js`) y `package.json` coinciden (`1.1.0`).

**Modelo de datos actual** (fuente de verdad: typedefs de `state.js`):
- `Settings` (1 registro, clave `main`): `url`, `user`, `maxLen`, `temp`,
  `mode` (`'chat'` por defecto | `'plain'`), `ctx`, `pinSalt`, `pinHash`,
  `theme` (`nomi|glass|imessage|penumbra|penumbra-claude`), `themeMode` (`dark|light`), `glassEffect` (`full|bars|off`, UI-007), `continuityAuto` (boolean, `false` por defecto; MEM-007: resumen de continuidad automático), `lorebookAuto`
  (boolean, `false` por defecto; MEM-002: solo `true` activa la extracción
  automática de memoria), `varietyAssist` (boolean, `false` por defecto; FMT-004:
  nota de variedad al final del prompt si el personaje se repite), `formatAssist`
  (boolean, `true` por defecto; FMT-002: la respuesta arranca ya dentro de una acción `*`), `splitTypography`
  (boolean, `false` por defecto; UI-023: diálogo en sans y acción en la letra del skin, experimental).
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
  (marcador de disparo del lorebook; ya NO guarda entradas), `continuitySummary`
  `{text, coveredUntil (ts del último mensaje resumido), updated}` (MEM-007; por defecto vacío).
- `Message` (store `chatMsgs`, un array por `chatId`): `role` (`user|char`),
  `text`, `ts`, `loreUsed?` (UI-010, solo `char`: copia de los recuerdos usados; ausente = sin dato).
  `variants?`/`activeVariant?` (UI-017, solo `char` regenerado: todas las versiones; `text`/`loreUsed` siempre son los de la activa).
- `LoreEntry`: `id`, `keys[]`, `content`, `updated`, `source` (`auto|manual`), `always?`
  (MEM-004: "siempre presente"; solo se guarda `true`; implica `manual`).
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
defecto y se activa con un interruptor en esa hoja); 5 skins × claro/oscuro; fondo
de chat por personaje; CI con gate de tests; versión visible en Ajustes; resumen de continuidad por chat (MEM-007, **apagado por defecto**: cuesta ~+2-4 s por respuesta); 437
tests (`node --test tests/*.test.mjs`).

**Verificado en un teléfono real (Hecho, reportado por el tester, 2026-09-24):**
el APK nuevo se instaló ENCIMA del anterior, sin desinstalar, y los datos se
conservaron (firma estable ARQ-001/ARQ-002 verificada); MEM-001 v2 "Actualizar
memoria ahora" funcionó. Calidad de la memoria y formato: ver Pendientes.

**Pendiente:** el resto de lo anterior **sigue sin probarse en un APK real**
(FMT-001, MEM-002, respaldo automático, PIN, etc.); pantalla de respaldos; búsqueda dentro de un chat; ajustes de IA por personaje; creador de
personajes guiado (solo propuesta, no autorizado). Añadido por DOC-002
(2026-09-24), a raíz de VER-001 y de las decisiones del arquitecto:
- Respaldo automático completo: un archivo por `chatId` (hoy NO es así, ver
  VER-001 hallazgo 3), con personaje y lorebook, restaurable.
- Guardado de respuesta parcial y manejo de segundo plano
  (`visibilitychange`/`pagehide`; VER-001 hallazgo 7).
- `.gitignore` y `package-lock.json` (sin excluir `signing/`; VER-001 hallazgo 20).
- Imágenes (avatar, fondo) fuera del registro del personaje (VER-001 hallazgo 18).
- ~~Prueba de la memoria contra el servidor real~~: hecha; en el teléfono la actualización manual funcionó (el disparo automático, sin probar).
- Latencia de la memoria: cada actualización de memoria hace que la SIGUIENTE
  respuesta del chat tarde ~15–25 s más (invalida la caché de prompt del
  servidor). **Decisión (MEM-002, 2026-09-24):** la actualización automática
  queda apagada por defecto (`Settings.lorebookAuto`); la manual se conserva y
  avisa el costo. La opción "extraer sobre el prefijo del chat" ya se MIDIÓ en
  MEM-007 (0 s de penalización de caché; +14/+40/+56 s con una llamada aparte, según el
  largo del chat); la extracción del lorebook aún no la usa. Ver "MEM-007" y "MEM-002".
- **Calidad de la memoria — atendida por MEM-003, MEM-004 y MEM-005 (2026-09-24; implementados, sin probar en
  el teléfono):** hechos concretos con nombres, higiene de keys, fusión de casi-duplicados, palabra completa,
  "Limpiar recuerdos" y "siempre presentes". Detalle en `HISTORIAL.md`.
- **Pendiente (FMT-004):** medir FMT-004 con conversaciones largas (40+ turnos) antes de
  decidir si activar `varietyAssist` por defecto (la medición de 18 turnos no fue concluyente).
- **Pendiente (2026-09-26, cierre de la sesión M1):** MEM-008 (estado de la relación al prompt: IMPLEMENTADO el 2026-09-26, ver Registro; sin probar en el teléfono ni medido su efecto en las respuestas); **LAT-001** (parte (a) *frente estable* IMPLEMENTADA el 2026-09-26: la causa 1 de las pausas de ~1 min desaparece, medido; la parte (b) queda descartada porque `--smartcache` cubre la mayoría; ver "LAT-001 (a)" en `HISTORIAL.md`); MEM-007 sin verificar de punta a punta, en español, en texto simple ni en el teléfono.
- **Formato del personaje (asteriscos sueltos, narración sin cursiva): atendido por FMT-002 y FMT-003
  (2026-09-25; implementados, sin probar en el teléfono).** Ver Resumen y `HISTORIAL.md`.
- ~~El modo "plantilla del modelo" no corta en `\n`~~: **corregido por FMT-001** (`stop` con `"\n"`, reintento si vacía).

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
| ARQ-001 | Firma estable del APK | Implementado el 2026-09-24; **la verificación falló en el CI** (build #14: la huella del APK no coincidió con la esperada); **corregido por ARQ-002, verificado en un teléfono real** (ver ARQ-002) | Ver "ARQ-001" y "ARQ-002" (en `HISTORIAL.md`). Llave en `signing/`, workflow actualizado. |
| ARQ-002 | Corregir la firma del APK: firmar explícitamente con la llave fija | Autorizado — implementado el 2026-09-24 (este lote); **VERIFICADO en un teléfono real (2026-09-24): el APK nuevo se instaló encima del anterior, sin desinstalar, y los datos se conservaron** | El workflow re-firma con `apksigner sign` y verifica la huella. Ver "ARQ-002". |
| DOC-002 | Registrar perfil del servidor, principios de producto y estado real de los contratos | Autorizado — ejecutado el 2026-09-24 (este lote; solo `docs/`) | Sección "Perfil del servidor y principios de producto", este Registro, pendientes de "Estado vigente" y rutas con marcadores. |
| MEM-001 v2 | Lorebook: actualizaciones aditivas compatibles con el servidor real, protección contra pérdida y gestión manual | Autorizado — **implementado el 2026-09-24** (sesión B); Paso 0 ejecutado contra el servidor real; **en el teléfono: la actualización manual funcionó** (2 entradas casi duplicadas, ver Estado vigente); sin probar el disparo automático | Ver "MEM-001 v2" (en `HISTORIAL.md`). Reporta un problema de latencia que requiere decisión. Reemplaza al MEM-001 anterior. |
| FMT-001 | Preservar el formato de un solo párrafo en el modo "plantilla del modelo" y evitar respuestas vacías | Autorizado — **implementado el 2026-09-24** (sesión C); medido contra el servidor real; **pendiente de probar en el teléfono** | Ver "FMT-001" (en `HISTORIAL.md`). |
| MEM-002 | Extracción automática de memoria apagada por defecto (protección de la latencia del chat) | Autorizado (decisión del arquitecto) — **implementado el 2026-09-24** (sesión C); **pendiente de probar en el teléfono** | Ver "MEM-002" (en `HISTORIAL.md`). Campo `Settings.lorebookAuto`. |
| DOC-003 | Reducir el costo de leer la documentación: dividir NOTES.md y registrar principios y hoja de ruta | Autorizado — ejecutado el 2026-09-24 (sesión C; solo `docs/`) | Historia movida tal cual a `HISTORIAL.md`; este archivo queda como punto de partida. Añade principios 8 y 9 y la hoja de ruta. |
| MEM-003 | Calidad de los recuerdos: concretos, keys útiles, sin duplicados, "Limpiar recuerdos" | Autorizado — **implementado el 2026-09-24** (sesión E); probado contra el servidor real (15+15 corridas) y en el navegador; **pendiente de probar en el teléfono** | Ver "MEM-003" (en `HISTORIAL.md`). Umbral de fusión 0,6; la inyección pasó de subcadena a palabra completa. |
| MEM-004 | Recuerdos "siempre presentes" y colocación que no invalida la caché del servidor | Autorizado — **implementado el 2026-09-24** (sesión E); Paso 0 medido (bloque en la cabecera: +22 s / +40 s; al final: +1 s); **pendiente de probar en el teléfono** | Ver "MEM-004" (en `HISTORIAL.md`). El bloque "por tema" va al FINAL del prompt; "siempre presentes" en la cabecera. |
| MEM-005 | Keys que reflejan el habla del usuario; fusión de paráfrasis; primera persona | Autorizado — **implementado el 2026-09-24** (sesión E2); medido contra el servidor real (18+18 corridas); **pendiente de probar en el teléfono** | Ver "MEM-005" (en `HISTORIAL.md`). Causa del bug: "invite"/"invited" eran palabras distintas. |
| FMT-004 | Reducir el eje temático repetido del personaje | Autorizado — **implementado el 2026-09-24** (sesión E2); ayuda **apagada por defecto**; medición no concluyente | Ver "FMT-004" (en `HISTORIAL.md`). `Settings.varietyAssist`; detector en `api/variety.js`. |
| FMT-002 | Medir y reducir los fallos de asteriscos en la generación | Autorizado — **implementado el 2026-09-25** (sesión F2); medido contra el servidor real (ronda 1: 4×60, ronda 2: 4×75); `formatAssist` activa por defecto; **pendiente de probar en el teléfono** | Ver "FMT-002" (en `HISTORIAL.md`). La respuesta arranca en `*` (plantilla: mensaje assistant final). Validador en `api/formatcheck.js`. |
| FMT-003 | Renderizado tolerante de asteriscos (solo visual) | Autorizado — **implementado el 2026-09-25** (sesión F2); verificado en el navegador integrado; **pendiente de probar en el teléfono** | Ver "FMT-003" (en `HISTORIAL.md`). `formatMessage(text, {role})`; no toca lo guardado. |
| UI-011 | Quitar los deslizadores de longitud y creatividad de Ajustes | Autorizado — **implementado el 2026-09-25** (sesión Q1); **pendiente de probar en el teléfono** | Solo desaparece el control; `Settings.maxLen`/`temp` siguen en `state.js` y `kobold.js` los sigue enviando. Ver "UI-011" (en `HISTORIAL.md`). |
| UI-013 | Hub: "Continuar" abre el chat más reciente; el retrato abre la lista de chats | Autorizado — **implementado el 2026-09-25** (sesión Q1); verificado en el navegador integrado; **pendiente de probar en el teléfono** | `nav.js` (`continueTarget`, puro). Sin chats, "Continuar" sigue creando uno (vía `chats.js`). Ver "UI-013" (en `HISTORIAL.md`). |
| UI-014 | El botón "atrás" de Android navega dentro de la app | Autorizado — **implementado el 2026-09-25** (sesión Q1); probado solo con un Android simulado en el navegador; **pendiente de probar en el teléfono** | Plugin `@capacitor/app` + `backButton` en `main.js`; decisión pura en `nav.js` (`decideBack`). Ver "UI-014" (en `HISTORIAL.md`). |
| UI-010 | Indicador de memoria usada por mensaje (marcapáginas gris / de acento) | Autorizado — **implementado el 2026-09-25** (sesión Q2); verificado en el navegador (4 skins) y de punta a punta con un servidor simulado; **pendiente de probar en el teléfono** | `Message.loreUsed`; `buildLoreBlocks().used`; hoja de detalle en `chat.js`. Ver "UI-010" (en `HISTORIAL.md`). |
| UI-012 | Interruptor "Corregir formato automáticamente"; comillas como señal de diálogo en pantalla | Autorizado — **implementado el 2026-09-25** (sesión Q2); verificado en el navegador; **pendiente de probar en el teléfono** | `Settings.formatAssist` conserva su nombre. `formatMessage(text, {role, quoteDialogue})`; reglas R1–R4 en `format.js`. Ver "UI-012" (en `HISTORIAL.md`). |
| MEM-006 | "Estado de la relación" en "Ver lorebook" | Autorizado — **versión final LOCAL implementada el 2026-09-25** (sesión Q2/G): sin modelo ni servidor (el intento con el modelo inventaba datos y se descartó); verificado en el navegador; **pendiente de probar en el teléfono** | `api/relationship.js`: frase fija por cantidad de recuerdos + "siempre presentes" + fecha; sin campo nuevo ni botón. Ver "MEM-006" (en `HISTORIAL.md`). |
| UI-006 | Menú de mensaje compacto (un solo menú reutilizado) | Autorizado — **implementado el 2026-09-25** (sesión G3); verificado en el navegador con 252 mensajes; **pendiente de probar en el teléfono** | Sin botones por fila: 1 menú que se mueve al mensaje tocado; `ui/msgmenu.js` (puro). Ver "UI-006" (en `HISTORIAL.md`). |
| UI-007 | Efecto de vidrio ajustable (`Settings.glassEffect`) | Autorizado — **implementado el 2026-09-25** (sesión G3); Nomi/iMessage sin `backdrop-filter` y sin cambios de layout/color (medido); **pendiente de probar en el teléfono** | Tokens `--surface-backdrop`/`--bars-backdrop`; selector en Apariencia, solo con Glass. Sin medición de rendimiento (UI-005 no ejecutado). Ver "UI-007" (en `HISTORIAL.md`). |
| UI-008 | Tipografía incluida, contraste, compositor de una línea y botón "volver abajo" | Autorizado — **implementado el 2026-09-25** (sesión G3); verificado en el navegador (sin peticiones de fuentes externas); **pendiente de probar en el teléfono** | Literata (OFL) en `www/fonts/` (~239 KB); `ui/contrast.js` + tabla de contraste con test; tokens `--color-em`/`--color-on-user`. Ver "UI-008" (en `HISTORIAL.md`). |
| UI-009 | Dos skins nuevos: "Penumbra" y "Penumbra Claude" | Autorizado — **implementado el 2026-09-25** (sesión G4); verificados en el navegador (claro y oscuro, sin `backdrop-filter`); **pendiente de opinión del usuario en el teléfono** | Solo tokens en `themes.css` (+ `--bubble-edge`); contraste ≥4,5:1 en todos los roles, desde el diseño. Tokens en `DESIGN.md`. Ver "UI-009" (en `HISTORIAL.md`). |
| MEM-007 | Resumen de continuidad por chat (memoria en capas) | Autorizado — **implementado el 2026-09-26** (sesión M1); Paso 0 y afinación medidos contra el servidor real; **APAGADO por defecto** (impuesto de latencia); no verificado de punta a punta, en español, en texto simple ni en el teléfono | Técnica: continuación del prefijo (sin penalización de caché); al FINAL del prompt (+2-4 s por respuesta; en la cabecera ~1 min por cambio); reserva fija en la ventana; tope 800/400 car. `Chat.continuitySummary`; `api/continuity.js`. Ver "MEM-007" (en `HISTORIAL.md`). |
| MEM-008 | Estado de la relación también en la conversación | Autorizado — **implementado el 2026-09-26**; 409 tests; latencia medida contra el servidor real (cada cambio de nivel = 1 respuesta lenta, ~14 s con 2 000 tokens); **pendiente de probar en el teléfono** | `Relationship so far: Sam and Mia …` (3 frases en inglés según el nivel de `relationshipSummary()`) en la cabecera, junto a los "siempre presentes"; `formatRelationshipBlock` en `prompt.js`, sin tocar `relationship.js` ni "Ver lorebook". Ver "MEM-008" (en `HISTORIAL.md`). |
| LAT-001 | Pausas de ~1 min en chats largos: (a) frente estable (**implementado**) y (b) espacio fijo para bloques finales (**descartado por ahora**) | **(a) autorizado e implementado el 2026-09-26**; medido contra el servidor real con `--smartcache`: 8 de 8 pausas por relleno → 0 en 47 pasos (queda solo la espera en frío); pendiente de probar en el teléfono. (b) no se hace: `--smartcache` cubre la mayoría | `stableFront` en `prompt.js` (modo plantilla) + `historyStartIndex`. Ver "Hallazgo LAT-001" y "LAT-001 (a)" (en `HISTORIAL.md`). |
| UI-016 | Menú de mensaje: botones inalcanzables | Autorizado — **implementado el 2026-09-26** (sesión Q3); verificado en el navegador (375×812); 415 tests; **pendiente de probar en el teléfono** | Causa: el menú no se desplazaba a la vista al abrirse y el scroll lo cerraba; además "Regenerar" saltaba de línea. `revealDelta`/`shouldCloseOnScroll` en `msgmenu.js`. Ver "UI-016" (en `HISTORIAL.md`). |
| UI-017 | Elegir entre respuestas regeneradas | Autorizado — **implementado el 2026-09-26** (sesión Q3); verificado en el navegador contra el servidor real (3 versiones, navegar, envío con la versión 1 activa, fallo del servidor); 423 tests; **pendiente de probar en el teléfono** | `Message.variants`/`activeVariant` (`www/js/variants.js`, puro); `text` sigue siendo la activa. La copia de seguridad v2 y el log de chat exportan TODAS; importar una copia sin variantes funciona igual. Ver "UI-017" (en `HISTORIAL.md`). |
| UI-018 | Saludo del hub según la hora del día | Autorizado — **implementado el 2026-09-26** (sesión Q3); verificado en el navegador (franjas forzadas, sin conexión); 428 tests; **pendiente de probar en el teléfono** | `greeting.js` (puro): 4 franjas × 5 frases, sin repetir la anterior; el chip con el modelo pasó a ser un punto de estado discreto. Ver "UI-018" (en `HISTORIAL.md`). |
| UI-019 | Agrupar los ajustes del chat (menú ⋮) | Autorizado — **implementado el 2026-09-26** (sesión Q3); verificado en el navegador (Nomi, Glass y Penumbra claro; todas las opciones abren lo mismo); **pendiente de probar en el teléfono** | Navegación arriba (Ajustes, Volver) + grupos Apariencia / Personaje y memoria / Datos; clases `.menu-section`/`.menu-group` (en `DESIGN.md`). Ver "UI-019" (en `HISTORIAL.md`). |
| UI-020 | Esconder las métricas técnicas al usuario final ("Diagnóstico") | Autorizado — **implementado el 2026-09-26** (sesión Q3); verificado en el navegador (plegado de entrada; al abrirlo: 26 mensajes = 26 filas, contexto correcto); 428 tests; **pendiente de probar en el teléfono** | El menú ⋮ ya no muestra el conteo/contexto; están en la sección plegable "Diagnóstico" (se calculan al abrirla). Principio "esconder, no eliminar" en `DESIGN.md`. Ver "UI-020" (en `HISTORIAL.md`). |
| UI-021 | Cursiva ausente en la burbuja del usuario | Autorizado — **cerrado el 2026-09-26 sin cambios de código**: no reproducible; el mensaje reportado no tenía asteriscos escritos | Ver "UI-021" (en `HISTORIAL.md`). |
| UI-021 (ajuste) | Cursiva del usuario con color propio por skin | Autorizado — **implementado el 2026-09-26**; contraste piso 4,0:1 (decisión del usuario; 3,3–3,4 en Glass claro e iMessage oscuro); 429 tests; **pendiente de probar en el teléfono** | Solo `--color-muted-on-accent` en `themes.css`; tabla en `DESIGN.md`. Ver "UI-021 (ajuste)" (en `HISTORIAL.md`). |
| UI-022 | Pulido de hub y chat: ícono de reintentar, tarjeta completa como "Continuar" (borrar = pulsación larga), punto de estado con tono por franja, menús sin líneas | Autorizado — **implementado el 2026-09-26** (sesión Q4); verificado en el navegador (375×812) con eventos simulados; 435 tests; **pendiente de probar en el teléfono (sobre todo la pulsación larga)** | `www/js/longpress.js` (puro); punto: `data-part` + `--dot-ok` en `home.css`; sin `border-bottom` en `.menu-item`. Ver "UI-022" (en `HISTORIAL.md`) y `DESIGN.md`. |
| UI-023 | Tipografía distinta para narración y diálogo (experimental) | Autorizado — **implementado el 2026-09-26** (sesión Q4); **apagado por defecto**; verificado en el navegador (5 skins × claro/oscuro); 437 tests; **pendiente de probar en el teléfono y de la opinión del usuario (decide si algún día se enciende por defecto)** | `Settings.splitTypography`; `--font-dialogue` = pila de sistema (sin fuente nueva, +0 KB); marca `.chat-bubble--split` solo en burbujas del personaje con cursiva (Ani no se afecta). Ver "UI-023" (en `HISTORIAL.md`) y `DESIGN.md`. |
| DOC-004 | Carpeta "para-el-arquitecto": copia plana del proyecto para revisión externa | Autorizado — **implementado el 2026-09-26** (sesión 0) | `tools/para-el-arquitecto.mjs` (sin dependencias; excluye llaves, `signing/`, `node_modules/`, `android/`, binarios y >400 KB; falla si algo excluido se cuela) + `_INDICE.md` (hora, commit, versión, cambios sin commitear, tabla plano→ruta) + `.gitignore`. Se ejecuta al cerrar cada sesión. Ver "DOC-004" (en `HISTORIAL.md`). |
| VER-005 | ¿Búsqueda de memoria por significado en el hardware del usuario? | Autorizado — **informe hecho el 2026-09-25** (sesión M1; solo `docs/`, sin código de producción). **Recomendación: no construir embeddings ni la tabla de sinónimos hoy.** Parte A (hardware real) **no se probó**; Parte B medida | KoboldCpp 1.121 sí trae `--embeddingsmodel` (Hecho, `--help` del binario). Tabla de sinónimos: 8/8 en lo que su autor previó, 2/16 en un juego "ciego"; difusa: tipeos 4/4 pero falsos positivos; casos de solo significado 0/7 con todo lo barato. Hallazgo: `--smartcache`. Ver "VER-005" (en `HISTORIAL.md`). |
| BKP-001 | Importación de copias segura: confirmar, no pisar datos nuevos, todo o nada | **Autorizado; sin implementar** (sesión posterior a MEM-001 v2, solo cuando el usuario lo pida) | Punto de partida: hallazgos 2 y 10 de VER-001. |
| MEM-001 (v1) | (Anulado) versión anterior de MEM-001 | **ANULADO**, reemplazado por MEM-001 v2 | Asumía que el servidor podía devolver una lista larga con saltos de línea. |
| (previos) | `CONTRACT-LOREBOOK.md` (implementado, parcialmente superado), `CONTRACT-CHARACTER-CREATOR.md` (propuesta, no autorizada), `CONTRACT-HANDOFF.md` (briefing) | — | Ver los avisos al inicio de cada uno. |


## Resumen de contratos recientes (detalle en `HISTORIAL.md`)

- **ARQ-001 / ARQ-002 (2026-09-24), firma estable del APK.** Cada APK salía con una
  llave distinta y actualizar obligaba a desinstalar (perdiendo datos). ARQ-001
  versionó una llave fija en `signing/`, pero su verificación falló en el CI
  (build #14). ARQ-002 re-firma con `apksigner` y verifica la huella. **Verificado
  en un teléfono real (Hecho, tester): el APK se instaló encima del anterior y los
  datos se conservaron.** (Que el CI pasó la verificación es Inferencia: el APK
  salió del artifact.)
- **VER-001 (2026-09-23), auditoría de recuperabilidad.** Solo lectura; 20 hallazgos
  (P0–P3): el respaldo automático no es restaurable con `importBackup` (1–4),
  `importBackup` pisa datos sin avisar (10, BKP-001), no se guarda la respuesta parcial (7).
- **MEM-001 v2 (2026-09-24), memoria (lorebook) aditiva.** Extracción de una línea y hasta
  3 entradas con prefill; hoja "Ver lorebook"; Paso 0 con mediciones del servidor (160
  tokens, corte en `\n`, caché de prompt) e informe de latencia. En el teléfono la
  actualización manual funcionó.
- **FMT-001 (2026-09-24), un solo párrafo y sin vacías.** `stop` incluye `"\n"`;
  `generateReplyNonEmpty` reintenta una vez. Medido: estrés 10/12 → 0/12; card de Mia
  1/80 → 0/80. (`maxLen`/`temp` sin efecto: sus deslizadores se quitaron en UI-011.)
- **MEM-002 (2026-09-24), memoria automática apagada por defecto** (`Settings.lorebookAuto`):
  cada extracción cuesta ~20 s en la SIGUIENTE respuesta. La opción 2 (extraer sobre el prefijo del chat) se midió en MEM-007.
- **MEM-003 (2026-09-24), calidad de la memoria.** Prompt de hechos concretos con nombres y keys de una
  palabra; `normalizeLoreKeys` limpia (sin genéricas ni nombres, máx. 4); sin hechos con pronombre suelto; fusión de
  casi-repetidas (≥0,6 y ≥2 palabras); inyección por palabra completa; botón "Limpiar recuerdos" (deshacible).
  Medido: entradas con nombre 73 % → 100 %, keys-frase 34/70 → 0/95.
- **MEM-004 (2026-09-24), "siempre presentes" y colocación.** Medido: cambiar el bloque de
  lorebook en la CABECERA cuesta +22 s (chat de 2 440 tokens) / +40 s (4 020) en la siguiente
  respuesta; al FINAL del prompt, +1 s. Por eso el bloque "por tema" va al final (solo en el
  prompt construido; en plantilla, dentro del último mensaje del usuario) y los recuerdos
  "siempre presentes" (`LoreEntry.always`, tope 500 caracteres; suma con "por tema" ≤1200)
  van en la cabecera: son estables. Hoja con secciones, contador e interruptor. Sin entradas,
  el prompt es idéntico al anterior. Editar un "siempre presente" cuesta UNA respuesta lenta.
- **MEM-005 (2026-09-24), keys y fusión.** La fusión fallaba porque "invite"/"invited" no coincidían
  (`stemLite` mejorado; con las mismas 2+ keys basta 0,5 de solapamiento). El prompt pide una key copiada
  del usuario: keys literales en sus mensajes 88 % → 96 % (18 corridas). Se descartan hechos en primera persona.
- **FMT-004 (2026-09-24), variedad.** Detector puro (`api/variety.js`) y nota genérica al final del prompt
  (proactiva). Apagada por defecto: la medición con 18 turnos no reprodujo el problema; falta probar 40+ turnos.
- **FMT-002 (2026-09-25), fallos de formato: medición y mitigación.** Con mensajes largos y ricos en acciones el modelo (plantilla)
  falla el formato en el 64 % de las respuestas (sobre todo `**…**` y narración sin cursiva; asteriscos impares o sin narración: 15 %, y solo 2 % con mensajes cortos).
  **Arrancar la respuesta en `*` (`formatAssist`) lo lleva a 0/135, sin cambiar latencia** y quita las comillas del habla. Un
  recordatorio al final del prompt empeora y añade ~0,5–0,9 s. En "texto simple" el fallo medido es 0/40. El corte a 160 tokens casi
  nunca es la causa. Contagio del historial: sugerido, no demostrado.
- **MEM-007 (2026-09-26), resumen de continuidad por chat.** Un recuento breve (≤400 car.; total ≤800) de lo que ya no cabe en la ventana, pedido como CONTINUACIÓN del prefijo del chat (0 s de penalización de
  caché frente a +14/+40/+56 s con llamada aparte), con verificación léxica y compresión con respaldo sin modelo. Va al FINAL del prompt (cabecera: ~1 min por cada cambio); cada respuesta
  cuesta +2-4 s mientras haya resumen → **apagado por defecto**. Fidelidad (10 chats, mensajes de largo real): 0 datos inventados con la redacción final, 8/10 limpios. Hallazgos: reserva fija
  para que la ventana no se mueva, y el origen de las pausas de ~1 min en chats largos (LAT-001, propuesta).
- **LAT-001 (a) (2026-09-26), frente estable.** Tras recortar el historial, el primer mensaje enviado en modo plantilla es siempre del usuario (nunca el relleno `[Start of roleplay]` que aparecía y desaparecía). Medido con `--smartcache`: 8 de 8 pausas de ~44 s por aparición del relleno → 0 en 47 pasos (solo queda la espera en frío). La parte (b) se descartó: `--smartcache` cubre la mayoría.
- **MEM-008 (2026-09-26), relación en el prompt.** Una línea fija en inglés (`Relationship so far: …`, 3 niveles por cantidad de recuerdos) en la cabecera, junto a los "siempre presentes"; nada sin recuerdos. Cada cambio de nivel cuesta una respuesta lenta (~14 s con 2 000 tokens; 3 veces en la vida de un personaje).
- **FMT-003 (2026-09-25), asteriscos en pantalla.** `formatMessage(text, {role:'char'})` repara solo en pantalla los `*` mal emparejados
  (`**`=`*`, apertura dentro de cursiva abierta, `*` suelto oculto); usuario y datos guardados intactos.

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
8. Creador de personajes dentro de la app con exportación a JSON y PNG (deseo del
   usuario, no urgente; ver `CONTRACT-CHARACTER-CREATOR.md`).

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
- **MEM-003** — prompt de extracción, higiene de keys, fusión, palabra completa, "Limpiar recuerdos" y la medición contra el servidor real.
- **MEM-004** — Paso 0 (latencia por colocación), decisión, ejemplo de prompt, pruebas de estilo.
- **MEM-005** — causa del bug de fusión, prompt de keys final, tabla antes/después. **FMT-004** — detector, medición no concluyente, ronda detenida por memoria.
- **FMT-002** — validador V1–V4, tablas A/B/C/D (2 rondas + texto simple), decisión, opciones descartadas. **FMT-003** — reglas de normalización visual y casos.
- **VER-005** — informe de búsqueda por significado: viabilidad en KoboldCpp 1.121, tabla de sinónimos vs difusa (juego ciego), `--smartcache`. **MEM-007** — Paso 0 (3 técnicas × 3 regímenes), afinación de la instrucción, colocación cabecera/final, reserva fija. **Hallazgo LAT-001** — causas medidas de las pausas de ~1 min y propuesta de arreglo. **LAT-001 (a)** — implementación del frente estable y su medición (1 pausa en frío en 24 pasos, antes 9). **MEM-008** — frases, colocación y costo de latencia medido por cambio de nivel.
