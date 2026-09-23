# CONTRATO — Continuación del proyecto Companion

> Este documento existe porque la conversación de Claude Code en la que se
> escribió se estaba quedando sin espacio de contexto. Es el punto de
> partida oficial para **cualquier instancia nueva de Claude Code** que
> retome este proyecto sin memoria de las sesiones anteriores. Leelo
> completo antes de tocar código. Después, leé `docs/NOTES.md` (estado
> real y cronológico del proyecto — manda sobre todo lo demás si hay
> contradicción) y `docs/CONTRACTS.md` (arquitectura y reglas técnicas
> originales, parcialmente superadas pero aún la base).

## 1. Tu rol

Sos el ingeniero de software full-stack que continúa este proyecto. Según
la tarea que te pida el usuario en cada momento, también actuás como:
- **Arquitecto/analista de producto para plataformas de AI companions**
  (chat con personajes vía LLM, al estilo Character.AI/Nomi/SillyTavern),
  cuando la conversación sea sobre qué construir y por qué, no solo cómo.
- **Ingeniero de bases de datos cliente** cuando el trabajo toque el
  esquema de IndexedDB en `www/js/state.js` — ahí la prioridad número uno
  es nunca perder ni corromper datos existentes del usuario (ver §4).

## 2. Qué es Companion, en corto

App de chat en Android (empaquetada con Capacitor) para hablar con
personajes de roleplay (character cards formato Tavern V1/V2/V3) contra un
servidor **KoboldCpp propio del usuario**, accesible por su red privada
(Tailscale). Todo corre en el cliente — no hay backend propio, no hay
cuentas, no hay nube. El usuario **no es programador**: da feedback
probando la app real (navegador durante desarrollo, APK real instalada en
su teléfono), no leyendo código.

Stack: JavaScript vanilla, módulos ES nativos (`<script type="module">`),
**sin npm/bundler para el runtime de la app** (npm solo se usa para las
dependencias de Capacitor y como herramienta de desarrollo/testing — ver
`package.json`), IndexedDB para persistencia, `node:test` para los tests
(sin dependencias externas de testing). Reglas técnicas completas en
`docs/CONTRACTS.md` §2 — siguen vigentes salvo que `docs/NOTES.md` diga
lo contrario explícitamente.

## 3. Cómo trabajar con este usuario

- **No es programador.** Explicale las cosas en español simple, sin jerga
  sin traducir, cuando le hables en el chat (el código sí usa
  identificadores en inglés, eso no cambia — es una regla del proyecto).
  No asumas que va a leer un diff para entender qué cambiaste: contale.
- **Prueba todo en la app real.** No te conformes con "los tests pasan" en
  cambios de UI o de comportamiento del chat — levantá un servidor
  estático (`.claude/launch.json` ya tiene una config `companion-web` que
  sirve `www/` en `http://localhost:8756`) y probá en el navegador
  integrado simulando pantalla de celular (375×812 es lo que se usó hasta
  ahora). Para probar pantallas que dependen de datos (personajes, chats)
  sin cargar una character card real, se puede sembrar IndexedDB a mano
  con `javascript_tool` — ver el patrón usado en sesiones anteriores si
  hace falta reconstruirlo. **Decí explícitamente cuándo algo no se probó
  en un APK real** (Capacitor/Android nativo) — no des por sentado que el
  comportamiento en WebView de Android es igual al del navegador de
  escritorio; ya hubo al menos un bug real (exportar/descargar archivos)
  que solo se manifestaba en el WebView nativo y no en el navegador.
- **La pérdida de datos es su trauma real, no una preocupación abstracta.**
  Perdió chats completos tres veces en versiones anteriores de esta app.
  Cualquier cambio que toque `state.js`, exportación, respaldo, o el
  esquema de IndexedDB necesita cuidado extra: pensar qué pasa con los
  datos que YA existen de una sesión anterior, no solo con datos nuevos.
- **Acciones riesgosas o irreversibles se explican y se confirman antes de
  ejecutarlas**, salvo que el usuario ya haya dado autorización explícita
  para ese caso puntual en la conversación actual. Esto incluye: reescribir
  historia de git (`push --force`), borrar código o archivos existentes,
  cambios estructurales grandes al repositorio.
- Da feedback iterativo y concreto (capturas de pantalla, descripciones
  puntuales de qué está mal). Cuando pide varias cosas en un mismo
  mensaje, conviene ir resolviendo una por una y mostrando avance, no
  quedarse "pensando" mucho tiempo sin comunicar nada.

## 4. Estado del repositorio Git — leé esto con cuidado

**La carpeta del proyecto (`/home/edgar/Documentos/companion` en la
máquina donde se desarrolló hasta ahora) ES la raíz del repositorio git.**
El remoto es `https://github.com/stvedgar-design/companion.git`, rama
`main`.

### Qué pasó antes (para que no se repita)

En algún momento anterior a esta sesión, el repositorio git terminó
enraizado accidentalmente en el directorio **personal** del usuario
(`/home/edgar`) en vez de en la carpeta del proyecto — probablemente
porque algún comando de git se corrió desde el directorio equivocado.
Consecuencias reales que se encontraron y corrigieron en esta sesión:
- Un commit terminó incluyendo una copia entera del proyecto extraída de
  la Papelera de reciclaje del usuario (`~/.local/share/Trash/...`).
- Otros commits tenían los archivos del proyecto con un prefijo de ruta
  raro (`Documentos/companion/www/...` en vez de `www/...`).
- El archivo del workflow de GitHub Actions (`.github/workflows/build-apk.yml`)
  quedó fuera de control de versiones en un momento dado (seguía existiendo
  en disco, pero git no lo veía).
- El repositorio remoto en GitHub solo tenía **un commit inicial**, sin
  ninguno de los fixes/features posteriores — el historial local nunca se
  había podido sincronizar con GitHub porque las historias eran
  incompatibles (`unrelated histories`).

### Cómo se arregló

Se **eliminó por completo** el `.git` viejo (enraizado en `/home/edgar`,
con autorización explícita del usuario) y se inicializó un repositorio
**nuevo y limpio**, con root en la carpeta del proyecto, conteniendo
exactamente los archivos reales del proyecto (verificado contra el
contenido real en disco, sin prefijos raros ni basura de la Papelera). Se
hizo `push --force` sobre el remoto de GitHub para reemplazar el commit
único viejo por este historial limpio.

### Reglas para no repetir el problema

1. Antes de cualquier operación git destructiva o de un `git add -A`,
   verificá que `git rev-parse --show-toplevel` da como resultado la
   carpeta del proyecto, no el home del usuario ni ninguna otra cosa.
2. Nunca uses `git add -A` o `git add .` desde un directorio que no sea
   exactamente la raíz del proyecto.
3. Si en algún momento `git status` muestra archivos con rutas que
   empiezan con `../` o que claramente no son del proyecto (backups
   personales, `.ssh`, `.bash_history`, etc.), **pará y avisá al
   usuario** en vez de seguir — es la señal exacta de que el repo se
   enganchó a algo que no debía.
4. `push --force` es una acción irreversible sobre un remoto compartido:
   solo se hace con confirmación explícita del usuario para ese caso
   puntual, nunca por costumbre.

## 5. Qué existe hoy (resumen — el detalle real está en `docs/NOTES.md`)

No dupliques acá lo que `docs/NOTES.md` ya cuenta con precisión
cronológica. Resumen de alto nivel para orientarte rápido:

- Los 6 módulos base del contrato original (`docs/CONTRACTS.md`):
  diseño/tokens, shell/plataforma, datos (IndexedDB), motor (prompts +
  KoboldCpp), chat, inicio/setup/ajustes.
- **Adenda multi-chat**: un personaje puede tener varios chats, cada uno
  con su propio escenario (que se suma al de la card, nunca lo reemplaza).
- **Empaquetado APK** vía Capacitor + GitHub Actions (compila un APK de
  depuración en cada push).
- Varios bugs reales encontrados usando la app y corregidos (menú de
  ajustes, avatar duplicado, texto invisible, contenido mixto http/https).
- **Fix crítico de exportación**: en el APK, el método de "descarga" que
  funciona en un navegador normal (`<a download>` con un blob) no hace
  nada en el WebView de Android y fallaba en silencio — ahora usa los
  plugins nativos `Filesystem`/`Share` de Capacitor y guarda en
  `Directory.DOCUMENTS` (visible en cualquier explorador de archivos del
  teléfono), no en una carpeta privada de la app.
- **Respaldo automático silencioso** (mejor esfuerzo, sin diálogos, cada
  ~10 min de actividad real) a `Documents/Companion-backups/`.
- **Indicador de contexto + contador de mensajes** aproximado, visible en
  el menú del chat.
- **Bloqueo opcional con PIN** al abrir la app (hash SHA-256 salteado con
  Web Crypto, sin dependencias externas).
- **Hub de personajes** rediseñado dos veces siguiendo feedback visual del
  usuario: terminó en una grilla de 2 columnas con tarjetas grandes (foto
  + nombre/preview superpuestos con degradado + botón "Continuar"),
  inspirada explícitamente en el hub de Nomi AI que el usuario mostró como
  referencia — **no vuelvas a una lista de texto ni a una grilla de 3+
  columnas sin que el usuario lo pida**, ya se probaron esas opciones y
  las rechazó.
- Formato de prompt por defecto: "plantilla del modelo" (`mode: 'chat'`),
  no "texto simple" — al usuario le daba peor resultado de roleplay.
- **Subsistema de memoria/lorebook** (`docs/CONTRACT-LOREBOOK.md`):
  implementado — disparo automático cada 40 mensajes de un chat, extracción
  vía el propio KoboldCpp del usuario, inyección acotada por keyword en el
  prompt, vista de solo lectura en el menú del chat. El lorebook es **por
  personaje**, no por chat (compartido entre todos sus chats) — decisión
  del contrato original cambiada a pedido explícito del usuario, ver
  "Cambio de diseño: lorebook por personaje, no por chat" en
  `docs/NOTES.md`. Ver también la sección "Subsistema de memoria/lorebook
  automático" (más arriba en el mismo archivo) para el resto de las
  decisiones tomadas. Pendiente real que queda de esa entrega: editar
  entradas a mano (hoy es solo lectura) y la "memoria curada" del punto 1
  del roadmap más abajo.

- **Skins (Nomi/Glass/iMessage) y fondo de chat personalizado**: implementado
  — `Ajustes → Apariencia` (también accesible desde el menú ⋮ del chat).
  De la misma ronda de mejoras: gate de tests en el CI (`npm test` antes de
  compilar el APK) y versión visible al pie de Ajustes. Quedaron
  pendientes, a propósito: editar lorebook a mano y la pantalla de
  respaldos.
- **Sistema de skins rearquitecturado + skin iMessage + claro/oscuro**:
  tras un bug real (el hub de personajes no reflejaba el skin Glass activo),
  se reescribió cómo funcionan los skins — ahora `base.css`/`chat.css`/
  `home.css` solo leen tokens, nunca saben qué skin está activo, y cada
  combinación skin+modo es un bloque completo en `www/css/themes.css`
  (reemplazó a `theme-glass.css`, que se borró). Tres skins (Nomi/Glass/
  iMessage) × dos modos (oscuro/claro) = 6 combinaciones. Ver
  "Rearquitectura del sistema de skins" en `docs/NOTES.md` para el detalle
  completo — es lectura obligatoria antes de tocar cualquier CSS de la app,
  incluido el motivo por el que ya no hay que ir seleccionando a mano qué
  componentes "tocar" para un skin nuevo.

140 tests automáticos a la fecha de esta edición (`node --test tests/*.test.mjs`).

## 6. Pendientes conocidos (no son bugs, son trabajo no empezado)

- **Creador de personajes guiado** (propuesta, no autorizada todavía):
  ver `docs/CONTRACT-CHARACTER-CREATOR.md` — encargo completo, autocontenido,
  con el análisis de la card de referencia del usuario
  (`docs/examples/mia-card-reference.json`) y la recomendación de diseño
  (pills para estructura/estilo de escritura y personalidad, texto libre
  guiado para nombre/descripción/saludo). **Confirmá con el usuario antes
  de arrancar** — el documento es una propuesta que él pidió por escrito,
  no un visto bueno para construir.
- Editar/borrar a mano entradas del lorebook automático (hoy es de solo
  lectura — ver `docs/NOTES.md`, sección del lorebook).
- Pantalla para ver los respaldos automáticos existentes
  (`Documents/Companion-backups/`) — depende de `Filesystem.readdir` de
  Capacitor, no se puede verificar fuera de un APK real.
- Firma de depuración estable en el CI (para que actualizar el APK no
  exija desinstalar la versión anterior) — causa raíz y arreglo propuesto
  documentados en `docs/NOTES.md`, sección "Portabilidad y calidad a
  futuro".
- Probar en un APK real (no solo navegador): el fix de exportación a
  `Directory.DOCUMENTS`, el respaldo automático, el bloqueo con PIN, el
  disparo automático del lorebook, y ahora también los skins/fondo de chat
  (backdrop-filter y demás deberían andar en el WebView de Android, pero
  no se probó ahí en esta sesión).
- Buscador dentro de un chat largo (idea validada por el usuario como
  buena, sin implementar).
- Ajustes de IA (temperatura/longitud) por personaje o por chat en vez de
  solo globales — el usuario le dio baja prioridad por ahora, está más
  enfocado en continuidad narrativa.

## 7. Roadmap a mediano plazo

Esto no es un pedido explícito línea por línea — es una lectura del rumbo
del proyecto según cómo fue evolucionando hasta acá. Cuando el usuario
pida "qué sigue" o algo abierto, usalo como guía, pero **confirmá
prioridad con él antes de construir algo grande de esta lista sin que lo
haya pedido en esa conversación puntual**.

1. **Memoria curada más allá del lorebook automático.** Una vez que el
   lorebook por keyword esté andando (`docs/CONTRACT-LOREBOOK.md`), el
   siguiente paso natural es dejar que el usuario "fije" manualmente
   hechos clave que viajen siempre en el prompt sin depender de que una
   keyword matchee. Es más simple que resumir todo el historial y no
   choca con el proyecto de worldbook separado del usuario.
2. **`character.card.character_book` como puente hacia el proyecto de
   worldbook del usuario.** Ese campo existe desde el contrato original,
   reservado y sin usar. El lorebook automático de este proyecto (por
   personaje, ver `docs/NOTES.md`) es distinto y no debe pisarlo — pero el
   día que el proyecto de worldbook externo exista, probablemente va a
   querer tanto leer como
   escribir lore relacionado con los personajes de Companion. Pensá en
   mantener el formato de las entradas compatible con Tavern world info
   para que ese puente sea fácil el día que haga falta.
3. **Formato de intercambio más estricto.** El export de chats/backup ya
   tiene versión (`version: 2` en `state.js`). Si en algún momento el
   proyecto de worldbook externo empieza a consumir estos logs
   automáticamente, van a hacer falta garantías más fuertes de formato
   (versionado estricto, quizás metadata por mensaje) — no lo
   sobre-diseñes de antemano, pero tenelo en cuenta si tocás el formato de
   export.
4. **Durabilidad de datos más allá del respaldo local.** Ya hay export
   manual + respaldo automático silencioso a `Documents/Companion-backups/`.
   El siguiente paso natural, con el tiempo, es que ese respaldo no
   dependa solo del almacenamiento del teléfono (sync externo) o, como
   mínimo, una pantalla que muestre qué respaldos existen y de cuándo son,
   para que el usuario pueda confiar en que existen sin ir a buscarlos a
   mano en un explorador de archivos.
5. **Organización a escala.** Multi-chat por personaje + potencialmente
   muchos personajes van a hacer que las listas planas (hub de
   personajes, lista de chats) se queden cortas. Buscador dentro de un
   chat, y probablemente tags/favoritos en el hub, van a dejar de ser
   "buena idea" y pasar a ser necesarios.
6. **Creador de personajes guiado, en vez de solo importar archivos.** Ver
   `docs/CONTRACT-CHARACTER-CREATOR.md` — propuesta completa (no
   autorizada), con el análisis de por qué la card de referencia del
   usuario funciona tan bien y una recomendación de diseño híbrido
   (pills para lo estructural, texto libre guiado para el contenido).
7. **Portabilidad de hardware/plataforma y salud del pipeline de build.**
   Ver `docs/NOTES.md`, sección "Portabilidad y calidad a futuro
   (2026-09-23)" para el detalle completo: modularidad ya lograda para
   cambiar de servidor/modelo (todo el fetch vive en `kobold.js`), qué
   haría falta para portar a iOS con Capacitor, la causa raíz confirmada de
   por qué cada APK nueva exige desinstalar la anterior (keystore de
   depuración que se regenera en cada build de GitHub Actions — con el
   arreglo ya identificado, no implementado), la política de "developer
   verification" de Google para sideloading (a vigilar, cambia con el
   tiempo), y una lista de mejoras de calidad/profesionalismo sugeridas —
   de esa lista, ya implementadas: gate de tests en el CI, versión visible
   en Ajustes, y los skins/tema alternativo (ver "Skins (Nomi/Glass) y
   fondo de chat personalizado" más arriba en esta sección). Siguen
   pendientes: la firma de depuración estable, la pantalla de respaldos, y
   el diagnóstico exportable.

## 8. Reglas técnicas que siguen vigentes

Resumen de `docs/CONTRACTS.md` §2 (leelo completo, esto es solo un
recordatorio de lo más importante):
- JavaScript vanilla, módulos ES, sin frameworks/bundler para el runtime.
- Identificadores de código en inglés; comentarios y textos de interfaz en
  español neutro.
- `localStorage`/IndexedDB solo dentro de `www/js/state.js`. `fetch` a
  servidores externos solo dentro de `www/js/api/kobold.js`.
- Prohibido `alert`/`confirm`/`prompt` nativos — usar `app.confirmDialog`
  y `app.toast`, o una hoja (`app.openSheet`) con un formulario propio.
- Nunca insertar texto de usuario/modelo/card con `innerHTML` sin escapar.
- Nunca fallar en silencio de cara al usuario para acciones que él inició
  a propósito — pero las tareas de "mejor esfuerzo" en segundo plano
  (respaldo automático, y ahora el lorebook automático) sí pueden fallar
  silenciosamente *para el usuario*, mientras no rompan el resto de la
  app y se documenten como tales en el código.
- Accesibilidad mínima: `aria-label` en botones de solo ícono,
  `:focus-visible`, zonas táctiles de al menos 44px.
- Cada archivo se entrega completo al modificarlo — nada de "// resto
  igual".

## 9. Cómo verificar tu trabajo

1. `node --check archivo.js` en cada archivo que toques.
2. `node --test tests/*.test.mjs` — tiene que quedar en verde. Anotá el
   número de tests nuevo en `docs/NOTES.md` si agregaste tests (es
   costumbre en este proyecto llevar la cuenta).
3. Para cambios de UI/UX: probalos de verdad en el navegador integrado
   (ver §3), simulando pantalla de celular. No reportes un cambio visual
   como terminado solo por haber mirado el código.
4. Si el cambio toca algo que solo se comporta distinto en el APK nativo
   (Capacitor/Android — exportación de archivos, plugins nativos,
   permisos, notificaciones), decilo explícitamente: "no se pudo probar
   en un APK real en esta sesión".
5. Actualizá `docs/NOTES.md` al terminar, siguiendo el estilo ya
   establecido (cronológico, con qué se hizo, por qué, qué se decidió en
   los puntos ambiguos y por qué, qué quedó pendiente). Esa continuidad de
   documentación es lo que permite que estas sesiones se puedan retomar
   sin perder contexto — no la rompas.
