# CONTRATO — Subsistema de memoria/lorebook automático

> ## ⚠ AVISO (DOC-001, 2026-09-23): partes de este contrato están SUPERADAS
>
> Este contrato se implementó y **después cambió de diseño**. Lo que sigue
> abajo es el encargo original, conservado como historia. Antes de aplicar
> cualquier punto, comprueba esta lista; el código, `docs/NOTES.md`
> ("Estado vigente") y `docs/HISTORIAL.md` ("Cambio de diseño: lorebook por
> personaje, no por chat") mandan.
>
> | Parte de este contrato | Estado hoy |
> |---|---|
> | §4.1 "Por chat, no por personaje… `chat.lorebook`" (marcada DECISIÓN FIJA) | **SUPERADO.** El lorebook es **por personaje**: `Character.lorebook`, compartido entre todos sus chats, por decisión explícita del usuario. `Chat` NO tiene `lorebook`. |
> | §3, §4.4, §4.6 "el lorebook de ese chat", "entradas ya existentes de ese chat", tope "por chat" | **SUPERADO.** Léase "del personaje". El tope de entradas (24) es por personaje. |
> | §4.3 `chat.lorebookMessageCount` como marcador | **VIGENTE**, pero solo es un marcador de *disparo* por chat; las entradas se guardan en el personaje. |
> | §4.4 "abortar en silencio y dejar el contador sin actualizar, o actualizarlo igual" | **RESUELTO:** si el servidor responde pero el texto no se puede parsear, el contador SÍ avanza; si falla la llamada (red/servidor), NO avanza. Ver `maybeUpdateLorebook()` en `www/js/ui/chat.js`. |
> | §5 `saveChatLorebook` / "sumar `lorebook` al `Chat` typedef y a `sanitizeChat()`" | **SUPERADO.** Hoy: `saveCharacterLorebook(characterId, lorebook)` y `markChatLorebookProgress(chatId, count)` en `state.js`; `sanitizeCharacterExtras()` sanea el lorebook del personaje. |
> | §6 "95 tests" | **SUPERADO.** Hoy son 144. |
> | §4.2 (`LoreEntry`), §4.4 (parseo robusto, `completeOnce`, temperatura baja), §4.5 (inyección por keyword con tope), nunca tocar `card.character_book` | **VIGENTES.** |
>
> Además, la auditoría VER-001 (`docs/HISTORIAL.md`, "Auditoría VER-001") documenta
> comportamientos reales de la implementación que este contrato no anticipaba
> (truncado por `maxLen`, coincidencia con la respuesta del chat). No están
> corregidos.

> Este documento es un encargo de trabajo autocontenido para una instancia
> de Claude Code que arranca **sin memoria de conversaciones anteriores**.
> Antes de escribir una línea de código, leé `docs/NOTES.md` completo (`docs/HISTORIAL.md` solo bajo demanda) (es
> el estado real del proyecto, manda sobre `docs/CONTRACTS.md` en caso de
> conflicto) y `docs/CONTRACTS.md` (arquitectura y reglas técnicas base).
> Este contrato asume que ya los leíste y no repite lo que ahí dice salvo
> para dar contexto puntual.

## 1. Tu rol en este encargo

Actuás como:
- **Ingeniero de bases de datos cliente**: vas a diseñar cómo se modela y
  persiste el lorebook generado dentro de IndexedDB (vía `state.js`), sin
  romper los datos existentes de usuarios que ya tienen chats guardados.
- **Ingeniero de software de la plataforma**: el código tiene que encajar
  con la arquitectura vanilla-JS-sin-build de este proyecto (ver §2 de
  `docs/CONTRACTS.md`): módulos ES nativos, sin npm/bundler para el
  runtime, funciones puras testeables con `node:test` donde sea posible.
- **Desarrollador de plataformas de AI companions**: el diseño de
  extracción/inyección de lore tiene que dar buenos resultados de
  roleplay con modelos locales de tamaño modesto corridos en KoboldCpp,
  no asumir un LLM de frontera con seguimiento de instrucciones perfecto.

## 2. Qué es Companion, en una frase

App de chat con character cards (formato Tavern) contra un servidor
KoboldCpp propio del usuario, 100% cliente (sin backend), pensada para
roleplay continuo: un personaje puede tener varios chats, cada uno con su
propio escenario. El usuario valora mucho la continuidad narrativa y **ya
perdió conversaciones completas tres veces** en versiones anteriores de la
app por fallos de exportación — cualquier cosa que toque persistencia debe
ser robusta y nunca puede perder datos existentes.

## 3. El problema a resolver

Hoy (ver `www/js/api/prompt.js`), cuando el historial de un chat no entra
en el contexto del modelo, `pickHistory()` simplemente descarta los
mensajes más viejos. No hay memoria de largo plazo: si algo importante se
estableció hace 200 mensajes, el modelo ya no lo "sabe".

El usuario quiere un **lorebook que se autoactualiza a partir de los logs
de la conversación**, con una regla de disparo barata en términos de
ingeniería: **cada N mensajes nuevos** (sugerido 30–50; usá una constante
configurable, no un valor mágico hardcodeado en varios lugares) se dispara
una actualización automática del lorebook de ese chat, en segundo plano,
sin interrumpir al usuario.

### Contexto importante que el usuario ya dio (no es libre interpretación)

- Tiene un **proyecto separado, todavía sin construir**, que va a generar
  algo tipo worldbook/lorebook alimentado por los logs de Companion. **No
  es tu tarea construir ese proyecto ni integrarte con él todavía** — tu
  tarea es la memoria/lorebook *dentro de Companion*, pensada de forma que
  no le cierre la puerta a ese proyecto futuro (formato de datos limpio,
  exportable, no una mezcla ilegible de texto libre).
- El presupuesto de contexto del usuario ya está ajustado (`settings.ctx`
  típicamente ronda 4096–8192 en modelos locales). Cualquier cosa que
  inyectes en el prompt final **compite por ese mismo presupuesto** con el
  historial de mensajes real. No es aceptable que el lorebook se coma una
  fracción grande del contexto.
- El usuario explícitamente NO quiere resumen automático de todo el
  historial sin un estándar claro (por el riesgo de degradar su proyecto
  futuro). Lo que pide acá es más acotado: extraer/actualizar **entradas
  de lorebook** (hechos, personajes secundarios, lugares, objetos,
  eventos importantes), no comprimir la conversación entera.

## 4. Diseño que tenés que implementar

Esto es una especificación con decisiones ya tomadas donde importan para
la coherencia del sistema, y espacio para tu criterio donde no. Marcado
`[DECISIÓN FIJA]` vs `[TU CRITERIO]`.

### 4.1 Dónde vive el lorebook generado — `[DECISIÓN FIJA, con nota]`

**Por chat, no por personaje.** Guardalo en una propiedad nueva del `Chat`
(ver `Chat` en `www/js/state.js`), por ejemplo `chat.lorebook: LoreEntry[]`.

Razón: la adenda multi-chat (`docs/HISTORIAL.md`, sección "Adenda grande:
varios chats por personaje") existe justamente porque un mismo personaje
puede protagonizar historias distintas y no relacionadas en chats
distintos. Mezclar lore entre chats de un mismo personaje contaminaría
escenarios que no tienen nada que ver entre sí.

**Nunca toques `character.card.character_book`.** Ese campo es lore
importado tal cual de la character card original (ver el `Card` typedef en
`docs/CONTRACTS.md` §4: *"lorebook crudo; hoy no se usa, pero NO se
descarta"*). Es contenido escrito por el autor original de la card; tu
sistema genera contenido nuevo y debe vivir separado, nunca pisar ni
fusionarse silenciosamente con ese campo.

Nota para vos: si después de implementarlo te parece que compartir lore
entre chats del mismo personaje tendría más sentido en algunos casos,
dejalo anotado en `docs/NOTES.md` como una alternativa considerada — no lo
decidas solo, es una llamada de producto que el usuario tiene que validar.

### 4.2 Esquema de una entrada de lorebook — `[DECISIÓN FIJA]`

Segui la forma de "world info" de Tavern (con la que `character_book` ya
es compatible), para que el día de mañana el proyecto de worldbook del
usuario pueda leer este formato sin traducciones raras:

```js
/**
 * @typedef {Object} LoreEntry
 * @property {string} id
 * @property {string[]} keys        // palabras/frases que activan esta entrada
 * @property {string} content       // el hecho en sí, en texto plano, conciso
 * @property {number} updated       // ms desde epoch
 * @property {'auto'|'manual'} source  // 'auto' = generado por este sistema
 */
```

Sin campos que no uses todavía (nada de "por si acaso"). Si más adelante
hace falta `priority`/`enabled`/etc., que lo agregue quien lo necesite.

### 4.3 Disparo de la actualización — `[DECISIÓN FIJA en el mecanismo, TU CRITERIO en el número exacto]`

- Constante `LOREBOOK_UPDATE_EVERY_MESSAGES` (sugerido 30–50; arrancá en
  40 si no tenés una razón mejor) en un solo lugar, no repetida.
- Marcador de progreso: sumá `chat.lorebookMessageCount` (number, cuántos
  mensajes tenía el chat la última vez que se actualizó el lorebook) al
  `Chat` typedef — **no reuses `chat.lastExportAt`**, ese campo es de una
  feature completamente distinta (respaldo automático, ver
  `docs/HISTORIAL.md`) y mezclar los dos conceptos va a confundir a la próxima
  persona que lea el código.
- Disparo: `messages.length - (chat.lorebookMessageCount || 0) >= LOREBOOK_UPDATE_EVERY_MESSAGES`.
- Enganchalo en el mismo lugar donde ya vive el patrón "mejor esfuerzo en
  segundo plano" de esta app: `persistChat()` en `www/js/ui/chat.js`, al
  lado de `maybeAutoBackup()` (mismo archivo, ya implementado — usalo como
  referencia de estilo: nunca bloquea la UI, nunca lanza, nunca muestra un
  error al usuario si falla, se reintenta solo la próxima vez que se
  cumpla el umbral).

### 4.4 Cómo se extraen las entradas — `[TU CRITERIO en el prompt exacto, DECISIÓN FIJA en las restricciones]`

- Es una llamada **de una sola vez, sin streaming**, al mismo servidor
  KoboldCpp que ya configuró el usuario (`settings.url`). `generateReply()`
  en `www/js/api/kobold.js` está pensada para roleplay en streaming con
  callbacks de UI — **no la reutilices tal cual**; agregá una función
  nueva de completado simple (p. ej. `completeOnce(prompt, settings,
  opts)`) en `kobold.js` o en un módulo nuevo, que hable con
  `/api/v1/generate` (no-streaming, ya existe ese endpoint — ver
  `nonStreamingGenerate` en `kobold.js` como referencia) o `/v1/chat/completions`
  sin `stream: true`.
- Usá una temperatura baja para esta llamada específica (algo como
  0.2–0.4), **independiente** de `settings.temp` del usuario — acá no
  buscás creatividad, buscás extracción confiable.
- El prompt de extracción recibe: los últimos `LOREBOOK_UPDATE_EVERY_MESSAGES`
  mensajes (o los mensajes nuevos desde el último corte) + las entradas de
  lorebook ya existentes de ese chat, y le pedís al modelo que devuelva un
  JSON con las entradas actualizadas (nuevas + las viejas que siguen
  vigentes, sin duplicar).
- **Los modelos locales chicos no son confiables generando JSON estricto.**
  Diseñá el parseo asumiendo que va a fallar seguido:
  - Intentá `JSON.parse` directo.
  - Si falla, intentá extraer el primer bloque `[...]` o `{...}` balanceado
    del texto y reintentar el parseo.
  - Si sigue fallando, **abortá esa actualización en silencio** (no rompas
    el chat, no le muestres nada al usuario) y dejá `chat.lorebookMessageCount`
    sin actualizar para que se reintente en el próximo umbral — o
    actualizalo igual para no reintentar en loop con el mismo modelo
    fallando siempre; documentá en `docs/NOTES.md` cuál de las dos
    elegiste y por qué.
  - Validá la forma de cada entrada resultante (que `keys` sea array de
    strings, que `content` sea string no vacío, etc.) y descartá lo que no
    cumpla, en vez de guardar basura.
- **Tope de tamaño obligatorio**: definí un máximo de entradas por chat
  (sugerido 20–30) y un máximo de caracteres por `content` (sugerido
  200–400). Si el modelo devuelve más, quedate con las más recientes o
  pedile prioridad al propio prompt de extracción — tu criterio, pero el
  tope tiene que existir y estar en una constante nombrada.

### 4.5 Cómo se inyecta el lorebook en el prompt real — `[DECISIÓN FIJA en el mecanismo]`

Nada de "meter todo siempre": eso es exactamente lo que va a desbordar el
contexto que el usuario ya tiene ajustado.

- Selección por palabra clave (estilo World Info de SillyTavern/Tavern):
  antes de armar el prompt, escaneá el texto de los últimos 2–3 mensajes
  (no todo el historial, sería caro) buscando coincidencias case-insensitive
  con `entry.keys`. Incluí solo las entradas que matchean.
- Tope duro de caracteres totales inyectados (sugerido 800–1200 caracteres
  ≈ 250–360 tokens con la heurística `CHARS_PER_TOKEN` que ya existe en
  `prompt.js`) — si hay más entradas que matchean de las que entran, cortá
  por las más recientes (`updated` más alto) o por orden de aparición de
  la keyword, tu criterio, pero documentalo.
- Integralo en `headBlock()` de `www/js/api/prompt.js`, al lado de donde
  hoy se arma el bloque de `Scenario:` (ver esa función, es privada del
  módulo pero ya recibe `card`, `settings`, `chatScenario` — vas a tener
  que sumarle un parámetro más, por ejemplo `loreEntries`).
- Esto implica tocar las firmas públicas documentadas en
  `docs/CONTRACTS.md` §5 (`buildPlainPrompt`, `buildChatMessages`, y
  `generateReply` que las llama desde `kobold.js`). Hacelo de punta a
  punta y consistente: actualizá también `tests/prompt.test.mjs` y
  `tests/kobold.test.mjs`, y la tabla de firmas de `docs/CONTRACTS.md` (o,
  mejor, anotá la desviación en `docs/NOTES.md` como ya se hizo con
  `chatScenario` en la adenda multi-chat — es el mismo patrón).

### 4.6 Qué NO tenés que hacer en este encargo

- No construyas el proyecto de worldbook separado del usuario — no existe
  en este repo, no sabés sus requisitos reales, no lo inventes.
- No toques el hub de personajes, el export/backup manual, el bloqueo con
  PIN, ni ningún otro feature ya implementado (ver `docs/NOTES.md` para la
  lista completa) salvo lo estrictamente necesario para integrar esto
  (p. ej. sí vas a tocar `persistChat()` en `chat.js` para enganchar el
  disparo, pero no reescribas esa función más allá de lo necesario).
- No implementes resumen del historial completo. Esto es solo extracción
  de hechos puntuales a un lorebook con tope de tamaño.
- No agregues UI nueva compleja. Con que el usuario pueda, como mínimo,
  ver las entradas actuales de lorebook de un chat (aunque sea de solo
  lectura, por ejemplo un ítem nuevo en el menú ⋮ del chat que abra una
  hoja con la lista) alcanza para este encargo. Editar/borrar entradas a
  mano es deseable pero no bloqueante — si te queda tiempo, hacelo; si no,
  dejalo anotado como pendiente en `docs/NOTES.md`.

## 5. Archivos que probablemente vas a crear o tocar

- **Nuevo** `www/js/api/lorebook.js`: lógica pura (sin DOM, sin fetch) —
  armado del prompt de extracción, parseo/validación del JSON de
  respuesta, selección de entradas por keyword para inyección, lógica de
  merge de entradas nuevas con existentes, chequeo del umbral de disparo.
  Todo esto tiene que ser testeable con `node:test` sin un navegador,
  siguiendo el mismo estilo que `www/js/api/prompt.js`.
- **Nuevo** `tests/lorebook.test.mjs`.
- **Modificar** `www/js/state.js`: sumar `lorebook` y
  `lorebookMessageCount` al `Chat` typedef y a `sanitizeChat()` (con
  valores por defecto seguros para chats ya existentes: `[]` y `0`), y una
  función para persistir el lorebook actualizado de un chat (mismo patrón
  que `renameChat`/`markChatExported`). Sumale tests en
  `tests/state.test.mjs`.
- **Modificar** `www/js/api/kobold.js`: la función nueva de completado sin
  streaming para la extracción (ver §4.4).
- **Modificar** `www/js/api/prompt.js`: inyección en `headBlock` (ver
  §4.5). Sumale tests en `tests/prompt.test.mjs`.
- **Modificar** `www/js/ui/chat.js`: enganche del disparo en `persistChat()`
  (ver §4.3), siguiendo el patrón de `maybeAutoBackup()`.
- **Modificar** `docs/CONTRACTS.md`: actualizá el `Chat` typedef en §4 y,
  si cambiaste las firmas de `buildPlainPrompt`/`buildChatMessages`, la
  tabla de §5.
- **Modificar** `docs/HISTORIAL.md` (informe completo) y `docs/NOTES.md` (registro de
  contratos y resumen corto): agregá una sección nueva (seguí el estilo
  cronológico existente: qué se hizo, por qué, qué se decidió y por qué,
  qué quedó pendiente) documentando esta feature completa, incluidas las
  decisiones que tomaste en los puntos marcados `[TU CRITERIO]`.

## 6. Cómo verificar tu trabajo antes de darlo por terminado

1. `node --check` sobre cada archivo `.js` que toques o crees.
2. `node --test tests/*.test.mjs` — tiene que seguir en verde, con los
   tests nuevos incluidos. Al momento de escribir este contrato hay 95
   tests; anotá el número nuevo en `docs/NOTES.md` como ya es costumbre en
   este proyecto.
3. Si tenés acceso a un servidor KoboldCpp real (el usuario tiene uno
   propio, pero vos probablemente no en este entorno): probá el flujo
   completo a mano. Si no tenés uno disponible, decilo explícitamente en
   tu resumen final — no afirmes que "funciona" si solo verificaste la
   lógica pura con mocks.
4. Serví `www/` con un servidor estático (`.claude/launch.json` ya tiene
   una config `companion-web` de una sesión anterior; reusala) y, si
   agregaste UI para ver el lorebook, probala en el navegador integrado
   simulando pantalla de celular (375×812), con datos de prueba sembrados
   a mano en IndexedDB si hace falta.
5. Nunca reportes un feature de persistencia/memoria como "listo" sin
   haber verificado que datos existentes (chats sin `lorebook` porque son
   de antes de este cambio) siguen cargando sin romperse — este es el
   punto más sensible dado el historial de pérdida de datos del usuario.
