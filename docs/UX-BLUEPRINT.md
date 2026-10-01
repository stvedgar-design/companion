# UX-BLUEPRINT.md — Plano de navegación y ajustes (ARQ-003)

> **Qué es este documento.** Inventario de TODAS las pantallas y controles reales de la app (leído
> del código, con archivo y línea), más una PROPUESTA de dónde debería vivir cada cosa. Nada de lo
> propuesto aquí está implementado ni autorizado — es para que el arquitecto y el usuario decidan
> antes de tocar ninguna pantalla. No duplica `docs/DESIGN.md` (lenguaje visual, clases CSS): lo
> enlaza donde hace falta. Encargado por ARQ-003, ejecutado el 2026-09-30, solo lectura de código,
> sin cambios de comportamiento.
>
> **Cómo leer las marcas:** **Hecho** = verificado leyendo el código real, con cita. **Inferencia** =
> mi lectura de para qué sirve o qué tan seguido se usa un control (el código no lo dice). **Supuesto**
> = algo que no pude verificar. **PROPUESTA** = una idea para que decidan, no un plan en marcha.

## 0. Resumen para el usuario (sin jerga)

- **Tu idea de "la app se siente como un laboratorio" tiene una causa concreta y repetida:** controles
  técnicos (tokens, diagnóstico, interruptores experimentales) están mezclados, en el mismo menú y con
  el mismo tamaño de letra, junto a los que usas todos los días. La sección 7 propone separar eso en
  una sección "Avanzado", sin quitar nada.
- **Buena noticia sobre las fotos:** las pantallas de "cambiar avatar" y "cambiar fondo" YA usan el
  mismo selector que la importación de copias (`pickFiles()`, sin filtro de imagen) — es decir, **ya
  puedes elegir una foto guardada en Google Drive** desde ahí, sin bajarla antes al teléfono. No hace
  falta ningún arreglo (sección 1).
- **Encontré un bug real, no solo una opinión de diseño:** el botón para abrir la ficha del personaje
  dentro de un chat (tocar su nombre arriba) no tiene el estilo que se le quiso dar — le falta el
  tamaño táctil mínimo del proyecto (44 px) y la flechita "›" que sí tiene su gemelo en la lista de
  chats. Es un error de una palabra en el nombre de una clase CSS (sección 2). No lo corregí (este
  contrato es solo de documentación) pero lo dejo como el arreglo más chico y urgente de la lista.
- El resto del documento es el inventario completo y la propuesta de dónde debería ir cada opción.

---

## 1. Hallazgo prioritario: selector de imágenes — YA llega a Google Drive

**Hecho.** Existe una sola función para elegir archivos en toda la app: `pickFiles()`
([platform.js:17-70](../www/js/platform.js)). Crea un `<input type="file">` **sin** atributo
`accept`, a propósito — el comentario del propio archivo lo explica:

> "Sin atributo `accept`: en Android, un `accept` con tipos de imagen abre la galería en vez del
> explorador de archivos, y ahí no se pueden elegir archivos .json." ([platform.js:21-23](../www/js/platform.js))

Todas las pantallas que eligen una imagen usan exactamente esta misma función, sin ningún filtro
adicional:

| Pantalla | Qué elige | Dónde |
|---|---|---|
| Crear/editar personaje | Avatar | [character-editor.js:89](../www/js/ui/character-editor.js) |
| Ficha del personaje | "Cambiar foto" | [character-sheet.js:183](../www/js/ui/character-sheet.js) |
| Menú ⋮ del chat | "Cambiar avatar" | [chat.js:2115](../www/js/ui/chat.js) (función `onChangeAvatar`, línea 2113) |
| Menú ⋮ del chat | "Fondo del chat" | [chat-background.js:90](../www/js/ui/chat-background.js) |
| Ajustes | Importar copia | [settings.js:327](../www/js/ui/settings.js) |
| Hub | Importar character card | [home.js:319](../www/js/ui/home.js) |
| Menú ⋮ del chat | Importar chat | [chat.js:2192](../www/js/ui/chat.js) |

**Conclusión: no hay ningún arreglo que hacer.** El dato que aportó el usuario (el explorador de
archivos nativo de Android sí llega a Google Drive sin bajar la imagen antes) ya aplica hoy a las
SIETE pantallas de arriba, porque las siete pasan por el mismo selector sin filtro. El contrato pedía
anotar como hallazgo de alta prioridad si alguna pantalla forzaba la galería (`accept="image/*"`) —
**ninguna lo hace**. No hay nada que añadir a la lista de contratos sugeridos por este motivo.

---

## 2. Hallazgo prioritario: botón del nombre en la cabecera del chat, sin su propio estilo

> **Corregido por UI-029 (2026-09-30).** `chat.js:83` ahora usa `chat-head__name` (la regla que ya
> existía) en vez de `chat-head__namebtn`. El resto de esta sección queda como diagnóstico histórico.

**Hecho — bug real, contradice `docs/DESIGN.md`.** El botón que abre la ficha del personaje
(UI-027) existe en dos pantallas, con dos nombres de clase CSS que deberían ser equivalentes pero NO
lo son:

- En la lista de chats: `<button class="topbar__title chats-head__namebtn" …>`
  ([chats.js:27](../www/js/ui/chats.js)) — con "chat**s**", y SÍ existe una regla para esa clase:
  `.chats-head__namebtn` en [base.css:103-117](../www/css/base.css), con `min-height: 44px`, padding
  heredado del layout, y la flechita `::after { content: '›' }`.
- Dentro de un chat: `<button class="chat-head__namebtn" …>` ([chat.js:83](../www/js/ui/chat.js)) —
  con "chat" (sin la "s"). **No existe ninguna regla CSS con ese nombre exacto en todo el proyecto**
  (verificado: `grep -rn "chat-head__namebtn" www/css/` no encuentra nada). La única regla parecida es
  `.chat-head__name` (sin "btn") en [chat.css:14-36](../www/css/chat.css), que define el mismo
  `min-height: 44px` y la misma flechita — pero el botón real no tiene esa clase, tiene
  `chat-head__namebtn`.

**Efecto real:** por el reset global (`button{ padding:0; border:0 }`,
[base.css:36-44](../www/css/base.css)), ese botón cae al tamaño por defecto del navegador: la altura
de una línea de texto (con `--fs-lg`, bastante por debajo de los 44 px mínimos que exige el propio
proyecto — principio 9 de `docs/PRINCIPIOS-DE-INGENIERIA.md`), sin la flechita "›" que `DESIGN.md`
([línea 198](DESIGN.md)) dice que tiene ("con una flechita '›' como indicio discreto"). Es
decir: **la documentación describe una pantalla que el código no entrega.**

Es, con alta probabilidad, un error de tipeo al escribir UI-027/UI-028 (faltó escribir `name` en vez
de `namebtn`, o falta agregar la regla `.chat-head__namebtn` — cualquiera de las dos lo arregla). No
lo corrijo aquí porque este contrato es solo de documentación; queda como el primer ítem,
tamaño Pequeño, de la lista de contratos sugeridos (sección 9).

---

## 3. Inventario de pantallas

| Pantalla | Archivo | Cómo se entra |
|---|---|---|
| Configuración inicial | [setup.js](../www/js/ui/setup.js) | Primera vez, sin servidor guardado |
| Bloqueo con PIN | [ui/lock.js](../www/js/ui/lock.js) | Al abrir la app, si el PIN está activado |
| Hub (lista de personajes) | [home.js](../www/js/ui/home.js) | Vista raíz |
| Ajustes | [settings.js](../www/js/ui/settings.js) | Engranaje o punto de estado del hub |
| Apariencia (global) | [appearance.js](../www/js/ui/appearance.js) | Botón dentro de Ajustes |
| Diagnóstico y rendimiento | [diagnostics.js](../www/js/ui/diagnostics.js) | Botón dentro de Ajustes |
| Importar copia (flujo) | [backup-import.js](../www/js/ui/backup-import.js) | Botón "Importar copia" en Ajustes |
| Crear/editar personaje | [character-editor.js](../www/js/ui/character-editor.js) | "Crear personaje" (hub) · "Editar" (ficha) · "Ver personaje" (menú ⋮) |
| Lista de chats de un personaje | [chats.js](../www/js/ui/chats.js) | Tocar el retrato de una tarjeta en el hub |
| Chat | [chat.js](../www/js/ui/chat.js) | "Continuar" (hub) · una fila de la lista de chats |
| Menú ⋮ del chat | [chat.js:2049](../www/js/ui/chat.js) (`onMenu`) | Ícono ⋮ en la cabecera del chat |
| Ficha del personaje | [character-sheet.js](../www/js/ui/character-sheet.js) | Tocar el nombre del personaje (cabecera del chat o de la lista de chats) |
| Apariencia del personaje | [character-look.js](../www/js/ui/character-look.js) | "Apariencia del personaje" en el menú ⋮ |
| Fondo del chat | [chat-background.js](../www/js/ui/chat-background.js) | "Fondo del chat" en el menú ⋮ |
| Lorebook ("Ver lorebook") + estado de la relación | [chat.js:1357](../www/js/ui/chat.js) (`openLorebookSheet`) | "Ver lorebook" en el menú ⋮ · "N recuerdos · Ver" en la ficha |
| Resumen de este chat | [chat.js:1760](../www/js/ui/chat.js) (`openContinuitySheet`) | "Resumen de este chat" en el menú ⋮ |
| Elegir saludo | [chat.js:2245](../www/js/ui/chat.js) (`openGreetingSheet`) | "Cambiar saludo" en el menú ⋮ (solo si hay saludos alternativos y el chat sigue en el primer mensaje) |
| Menú de un mensaje | [msgmenu.js](../www/js/ui/msgmenu.js) (lógica) + [chat.js](../www/js/ui/chat.js) (pantalla) | Tocar un mensaje |

No existen hoy (verificado, no están en el código): pantalla de "Mi perfil", modo
Disponible/Ausente, buzón de mensajes proactivos, "duplicar personaje", galería de fotos, wizard del
creador con plantillas. Todas figuran como pendientes en `docs/NOTES.md` — ver sección 8.

---

## 4. Inventario de controles — Hub y lista de chats

| Texto literal | Archivo:línea | Ámbito real | Uso inferido | ¿Jerga? |
|---|---|---|---|---|
| "Buscar personaje" (lupa) | [home.js:36](../www/js/ui/home.js) | App | Cotidiano (Inferencia) | No |
| "Ajustes" (engranaje) | [home.js:37](../www/js/ui/home.js) | App | Ocasional | No |
| Punto de estado de conexión | [home.js:41](../www/js/ui/home.js) | App | Cotidiano (pasivo) | No |
| Tarjeta de personaje ("Continuar") | [home.js:198-289](../www/js/ui/home.js) | Personaje | Cotidiano | No |
| Retrato de la tarjeta (abre lista de chats) | [home.js:229-265](../www/js/ui/home.js) | Personaje | Ocasional | No |
| Pulsación larga = borrar personaje | [home.js:211-227](../www/js/ui/home.js) | Personaje | Raro | No (sin rótulo visible; solo el hint de texto lo explica) |
| "Crear personaje" | [home.js:51](../www/js/ui/home.js) | Personaje | Ocasional | No |
| Importar character card (ícono) | [home.js:52](../www/js/ui/home.js) | Personaje | Raro | "character card" no aparece en la interfaz, solo en el código/aria-label interno |
| Nombre del personaje (cabecera) | [chats.js:27](../www/js/ui/chats.js) | Personaje | Ocasional (abre la ficha) | No |
| "+ Nuevo chat en este escenario" | [chats.js:33](../www/js/ui/chats.js) | Chat/episodio | Ocasional | No |
| Renombrar / Borrar chat (lápiz/basura) | [chats.js:155-178](../www/js/ui/chats.js) | Chat/episodio | Raro | No |

---

## 5. Inventario de controles — Chat: cabecera y menú ⋮

**Cabecera** ([chat.js:79-98](../www/js/ui/chat.js)): atrás · nombre del personaje (ver sección 2) ·
menú ⋮. Sin avatar propio desde UI-028 (el avatar vive junto a las burbujas).

**Menú ⋮** ([chat.js:2049-2111](../www/js/ui/chat.js), onMenu) — grupo **"Personaje y memoria"**:

| Texto literal | Línea | Ámbito real | Uso inferido | ¿Jerga? |
|---|---|---|---|---|
| "Fondo del chat" | [2058](../www/js/ui/chat.js) | **Personaje** (no "chat": ver nota) | Ocasional | No |
| "Ver lorebook" | [2059](../www/js/ui/chat.js) | Personaje (compartido entre chats) | Ocasional/cotidiano (si usa memoria activamente) | "Lorebook" es jerga de la comunidad de IA/roleplay |
| "Resumen de este chat" | [2060](../www/js/ui/chat.js) | Chat/episodio | Raro (función apagada por defecto, MEM-007) | "Resumen" está bien; el contenido de la hoja habla de "memoria de la IA" |
| "Cambiar saludo" (condicional) | [2063](../www/js/ui/chat.js) | Chat/episodio | Raro | No |
| "Cambiar avatar" | [2066](../www/js/ui/chat.js) | **Personaje** (no "chat") | Ocasional | No |
| "Apariencia del personaje" | [2071](../www/js/ui/chat.js) | Personaje | Ocasional | No |
| "Ver personaje" | [2080](../www/js/ui/chat.js) | Personaje | Ocasional — **pero abre el EDITOR directo, no la ficha** (ver nota) | El nombre confunde con la ficha, que también se llama a veces "ver" |

Grupo **"Datos"**: "Exportar este chat" / "Importar chat" ([chat.js:2095-2104](../www/js/ui/chat.js))
— ámbito Chat/episodio, uso raro, sin jerga.

Sección plegada **"Diagnóstico"** ([chat.js:2011-2047](../www/js/ui/chat.js)), cerrada de entrada,
con la nota propia "Información técnica. No hace falta entenderla para usar la app.": contador de
mensajes y **"Contexto usado: ~X% (≈N de M tokens aprox.)"**
([chat.js:1962-1964](../www/js/ui/chat.js)) — esto es exactamente el tipo de term "contexto/tokens"
que la dirección externa pide traducir a "memoria inmediata"; y "Última respuesta: X s"
([chat.js:1972-1984](../www/js/ui/chat.js)).

**Notas importantes (el código real contradice o matiza el Contexto del encargo):**

1. **"Fondo del chat" y "Cambiar avatar" NO son del chat, son del personaje.** El propio código lo
   dice: `chat-background.js` es "por PERSONAJE … nunca desde Ajustes" ([líneas 1-5](../www/js/ui/chat-background.js))
   y se guarda en `Character.chatBackground` (compartido entre todos sus chats, ver
   `docs/NOTES.md`, "Fondo de chat por personaje" — confirma mi memoria de proyecto). **El Contexto
   de este contrato (punto 2, ámbito "Chat/episodio": "fondo, tamaño de texto rápido, resumen,
   exportar, borrar") se equivoca en este punto** al poner el fondo en el ámbito "Chat/episodio" — la
   arquitectura real y la decisión ya tomada del usuario es que es por **Personaje**. La propuesta de
   la sección 7 corrige esto.
2. **"Tamaño de texto rápido" por chat NO existe.** El tamaño de los mensajes (UI-026) es un ajuste
   GLOBAL en Ajustes → Apariencia (`Settings.messageFontSize`,
   [settings.js:83-89](../www/js/ui/settings.js)), no un control rápido por chat. Otra suposición del
   Contexto que el código no respalda; no propongo crear uno nuevo (sería "cambia comportamiento").
3. **"Ver personaje" en el menú ⋮ NO abre la ficha (UI-027), abre el editor directo**
   ([chat.js:2080-2090](../www/js/ui/chat.js), llama a `openCharacterEditor`, no a
   `openCharacterSheet`). Hoy hay DOS caminos al editor: tocar el nombre → ficha → "Editar"
   ([character-sheet.js:125-136](../www/js/ui/character-sheet.js)), o menú ⋮ → "Ver personaje"
   (directo, sin pasar por la ficha). Esto es justo la mezcla que el usuario reporta como confusa.

---

## 6. Inventario de controles — Ficha, creador/editor, apariencia del personaje

**Ficha del personaje** ([character-sheet.js](../www/js/ui/character-sheet.js), ya implementada por
UI-027): foto grande, nombre + "Editar" ([líneas 122-137](../www/js/ui/character-sheet.js)),
Relación ([140](../www/js/ui/character-sheet.js)), Rasgos (pills o texto, nunca inventados,
[143-152](../www/js/ui/character-sheet.js)), Creada (si se conoce, [154-157](../www/js/ui/character-sheet.js)),
Descripción y Apariencia ([159-168](../www/js/ui/character-sheet.js)), "N recuerdos · Ver"
([170-176](../www/js/ui/character-sheet.js)), "Cambiar foto" ([178-202](../www/js/ui/character-sheet.js)).
Todo de ámbito Personaje, lectura primero — ya alineada con la dirección externa.

**Crear/editar personaje** ([character-editor.js](../www/js/ui/character-editor.js)): avatar, nombre,
personalidad (pills o texto libre), descripción, situación actual, primer mensaje, ejemplo de diálogo,
apariencia (rasgos fijos / ropa de ahora). **No tiene** (verificado, ninguno existe en el código):
guía de ayuda por campo con ejemplo, botón "Ejemplo" por campo, plantilla `<START>`/`{{user}}`/`{{char}}`
en el ejemplo de diálogo, ni un campo "Instrucciones" — todo esto es exactamente lo que pide CCC-002,
que sigue bloqueado según el Registro de contratos (`docs/NOTES.md`). El selector de "estilo de
escritura" está oculto a propósito desde CCC-003 (no es un pendiente de este documento). El límite de
caracteres SÍ está puesto como atributo `maxlength` en cada campo
([character-editor.js:36](../www/js/ui/character-editor.js)) — si todavía se puede superar pegando
texto o con IME es exactamente lo que CCC-002 pide medir y arreglar; no lo volví a probar acá porque
es su alcance, no el de ARQ-003.

**Apariencia del personaje** (MEM-009, [character-look.js](../www/js/ui/character-look.js)): "Rasgos
fijos" y "Ropa o estado de ahora", con contador de caracteres y aviso de costo de latencia en lenguaje
llano ("la próxima respuesta puede tardar más"). Ámbito Personaje, ya sin jerga.

**Fondo del chat** ([chat-background.js](../www/js/ui/chat-background.js)): imagen, brillo (slider
20-180%), fundido a negro (on/off), ajuste llenar/estirar. Ámbito real: Personaje (ver nota de la
sección 5). Sin jerga.

---

## 7. Inventario de controles — Ajustes, Apariencia global, Diagnóstico

**Ajustes** ([settings.js](../www/js/ui/settings.js)), ya agrupado por `.menu-group` (UI-019/UI-025):

| Grupo | Controles | Línea | ¿Jerga / técnico? |
|---|---|---|---|
| Conexión | Servidor (URL) + "Probar", Tu nombre | [27-40](../www/js/ui/settings.js) | "Servidor" y la URL son necesariamente técnicos (el usuario es el propio operador de su servidor) |
| Conversación | Formato del prompt (Plantilla del modelo / Texto simple), "Ayuda a que las respuestas no se repitan", "Corregir formato automáticamente", "Sentimientos del personaje" | [43-74](../www/js/ui/settings.js) | "Formato del prompt" nombra "prompt"; el resto ya está en lenguaje llano con su explicación debajo |
| Seguridad | Bloqueo con PIN | [76-80](../www/js/ui/settings.js) | No |
| Apariencia | Tamaño del texto de los mensajes (botones 15-19 px), botón a "Modo claro/oscuro y tipografía" | [82-96](../www/js/ui/settings.js) | No |
| Datos | Exportar / Importar copia | [98-105](../www/js/ui/settings.js) | No |
| Diagnóstico | Estado del almacenamiento persistente, "Medir fluidez", "Abrir diagnóstico" | [107-127](../www/js/ui/settings.js) | "Diagnóstico y rendimiento" ya se nombra así; es la sección más técnica de Ajustes |

**Apariencia (global)** ([appearance.js](../www/js/ui/appearance.js)): Modo (Oscuro/Claro),
"Tipografía dividida" (marcada "Experimental" en su propio texto,
[appearance.js:24-29](../www/js/ui/appearance.js)). Sin jerga, ya se auto-etiqueta como experimental.

**Diagnóstico y rendimiento** ([diagnostics.js](../www/js/ui/diagnostics.js)): elegir duración de la
prueba de estrés, ejecutar, corridas anteriores, informe con comparación, prueba con el dedo. Es,
por diseño, la pantalla más técnica de la app — ya vive detrás de un botón propio ("Abrir
diagnóstico"), no mezclada con lo cotidiano. Encaja bien como estaba pensado para "Avanzado".

---

## 8. Medición de tamaño táctil (objetivo ≥ 44 px; mínimo absoluto WCAG 24 px)

Medido leyendo las reglas CSS reales (no se pudo medir con una regla física en pantalla — ver
Condiciones de parada: esto no bloquea el contrato, es un reporte, como pide el punto 4 del Contexto).

| Control | Clase CSS | Alto definido | ¿Cumple 44 px? |
|---|---|---|---|
| Atrás / Menú ⋮ / Buscar / Ajustes (ítems redondos de cabecera) | `.ib` | 44×44 px ([base.css:140-142](../www/css/base.css)) | Sí |
| Ítems de menú y hojas (Lorebook, Ajustes, etc.) | `.menu-item` | min-height 44px ([base.css:521-529](../www/css/base.css)) | Sí |
| Nombre del personaje en la lista de chats | `.chats-head__namebtn` | min-height 44px ([base.css:103-117](../www/css/base.css)) | Sí |
| **Nombre del personaje en el CHAT** | `.chat-head__namebtn` | **sin regla propia** → cae al alto por defecto del navegador (una línea de texto, bien por debajo de 44 px) | **No** — ver sección 2 |
| Editar / Borrar / Copiar / Regenerar (menú de un mensaje) | `.chat-actionbtn` | min-height 44px ([chat.css:195-198](../www/css/chat.css)) | Sí |
| Navegar entre variantes (‹ 2/3 ›) | `.chat-variants__btn` | min-height 32px ([chat.css:156-158](../www/css/chat.css)) | No (sí cumple el mínimo absoluto de 24px) |
| Marcapáginas de memoria usada | `.chat-lore` | min-height 32px ([chat.css:174-175](../www/css/chat.css)) | No (sí cumple el mínimo absoluto) |
| Botones secundarios ("Probar", "Continuar" en la tarjeta, etc.) | `.btn--sm` | min-height 40px ([base.css:199-204](../www/css/base.css)) | No, por poco (sí cumple el mínimo absoluto) |
| Botones principales (Crear personaje, Guardar, Conectar…) | `.btn` | min-height 48px ([base.css:167-178](../www/css/base.css)) | Sí |
| Campos de texto | `.inp` | min-height 48px ([base.css:199-213](../www/css/base.css), con variante `textarea.inp` 90px) | Sí |

**Resumen:** un solo control real mente por debajo del estándar del proyecto y además roto (sección
2); tres familias de controles secundarios (variantes, marcapáginas de memoria, botones `--sm`) un
poco por debajo de 44 px pero por encima del mínimo absoluto de 24 px — no los marco como urgentes,
son botones de refuerzo junto a zonas más grandes (la burbuja entera, la tarjeta entera), no el único
modo de llegar a esa acción.

---

## 9. Propuesta de estructura (PROPUESTA — no autorizada)

> **Implementado por UI-030/UI-031/UI-032 (2026-09-30):** las filas "Cambiar avatar", "Apariencia del
> personaje", "Ver personaje", "Fondo del chat", "Ver lorebook" y "Diagnóstico" (plegado) de la tabla
> de abajo ya están hechas, tal como las describe esta propuesta.

Aplicando los ámbitos del punto 2 del Contexto, corregidos por los hallazgos de la sección 5 (fondo y
avatar son de Personaje, no de Chat). Cada fila dice si el cambio sería "solo mover/renombrar" (bajo
riesgo, un contrato chico podría hacerlo) o "cambia comportamiento" (necesita autorización explícita
del usuario aparte, porque mueve dónde vive un dato o cambia una interacción).

| Dónde está hoy | Dónde iría (PROPUESTA) | Nombre propuesto | Tipo de cambio |
|---|---|---|---|
| Menú ⋮ → "Cambiar avatar" | Ficha del personaje (ya tiene "Cambiar foto") | — (unificar en uno solo) | Cambia comportamiento (quitar la entrada duplicada del menú ⋮) |
| Menú ⋮ → "Apariencia del personaje" | Ficha del personaje, junto a "Descripción"/"Apariencia" | "Editar apariencia" | Solo mover |
| Menú ⋮ → "Ver personaje" | Se reemplaza por "Editar" en la ficha (ya existe) | — | Cambia comportamiento (el menú ⋮ dejaría de tener entrada directa al editor) |
| Menú ⋮ → "Fondo del chat" | Ficha del personaje (nueva fila "Fondo de sus chats") | "Fondo de chat" | Solo mover (coherente con que ya es un dato de `Character`) |
| Menú ⋮ → "Ver lorebook" | Se mantiene en el menú ⋮ (acceso rápido diario) Y en la ficha ("N recuerdos · Ver", ya existe) | "Lo que recuerda {Nombre}" | Solo renombrar el rótulo "Lorebook" |
| Menú ⋮ → "Resumen de este chat" | Se mantiene en el menú ⋮ (es de ESE chat) | "Resumen del episodio" (si se adopta "episodio", ver sección 10) | Solo renombrar |
| Menú ⋮ → "Cambiar saludo" | Se mantiene (es del chat, condicional) | — | Sin cambio |
| Menú ⋮ → "Exportar/Importar este chat" | Se mantiene | — | Sin cambio |
| Menú ⋮ → "Diagnóstico" (plegado) | Se mantiene plegado, pero bajo el rótulo "Avanzado" en vez de "Diagnóstico" a secas, y "Contexto usado: X tokens" → "Memoria inmediata usada: X%" (sin el número de tokens, o con el número solo si se despliega un detalle técnico aparte) | "Avanzado" | Solo renombrar el texto; sacar "tokens" de la vista normal es solo texto, no dato nuevo |
| Ajustes → Conversación → "Sentimientos del personaje", lorebook/resumen automáticos (hoy en sus propias hojas, no en Ajustes) | Sin cambio de ubicación; posible rótulo de sección "Avanzado" alrededor de los interruptores experimentales | — | Solo renombrar/agrupar visualmente |
| Ajustes → Diagnóstico (prueba de fluidez, banco de estrés) | Ya está en App, correcto. PROPUESTA: subtítulo "Avanzado" | "Salud del sistema" (opcional) | Solo renombrar |
| Lista de chats de un personaje | Sin cambios de fondo; es la pantalla natural para "episodios" si se adopta esa palabra | "Episodios con {Nombre}" (opcional) | Solo renombrar el título de la pantalla |

**Qué NO propongo tocar:** Ajustes → Conexión/Seguridad/Apariencia/Datos ya están bien ubicados
(ámbito App, correcto desde UI-025). La ficha (UI-027) ya sigue el patrón "lectura primero" pedido.

---

## 10. Sección "Avanzado": qué entraría (PROPUESTA, sin pantallas ni avisos nuevos)

No es una pantalla nueva: es un **rótulo y una reorganización visual** de controles que YA EXISTEN,
agrupados bajo un encabezado "Avanzado" (reutilizando `.menu-group`/`.menu-fold`, ya usado por
"Diagnóstico" en el menú ⋮, [chat.js:2010-2047](../www/js/ui/chat.js)):

- Dentro de Ajustes: los tres interruptores experimentales que hoy viven en hojas aparte pero se
  activan desde ahí indirectamente (lorebook automático, resumen automático, "Sentimientos del
  personaje"), más "Diagnóstico y rendimiento" y "Tipografía dividida".
- Dentro del menú ⋮ del chat: la sección "Diagnóstico" ya plegada (contador de mensajes, contexto en
  tokens, última respuesta) — solo cambiaría el rótulo y el texto interno, no la ubicación.
- Dentro de "Ver lorebook": el interruptor "Actualizar automáticamente cada N mensajes" y los
  recuerdos marcados "Siempre presente" ya están agrupados ahí; no hace falta moverlos, solo
  considerar si el rótulo "Siempre presente" necesita una aclaración breve (no jerga real, pero es un
  concepto nuevo para quien no vino de SillyTavern/Nomi).

**No se agrega ningún interruptor de restricción de contenido ni aviso nuevo** — cumple el requisito
explícito de no añadir pantallas, interruptores ni avisos de restricción.

---

## 11. Ubicación tentativa de funciones pendientes (del Contexto de este contrato)

| Función pendiente | Ubicación tentativa (PROPUESTA) | Notas |
|---|---|---|
| Wizard del creador (con plantillas) | Reemplazaría la pantalla única de `character-editor.js` al CREAR (no al editar); entrada desde "Crear personaje" en el hub | Depende de que CCC-002 (guías/ejemplos) se resuelva primero o en conjunto |
| Duplicar personaje | Ficha del personaje, junto a "Editar" (acción secundaria) | No existe ningún código relacionado hoy — es 100% nuevo |
| Memoria como "historia compartida" (chats = episodios) | Renombrar la pantalla de "lista de chats" (`chats.js`) sin cambiar su lógica; "episodio" pasaría a usarse en los rótulos de exportar/resumen | Es un cambio de vocabulario primero, de estructura de datos después (si se quiere "resumen de identidad" periódico, eso sí es un contrato aparte, ya anotado como pendiente en `docs/NOTES.md`) |
| Perfil del usuario ("Mi perfil") | Ajustes → Conexión (junto a "Tu nombre en el chat"), como pantalla propia si crece (foto para el avatar del usuario, horario) | Hoy "Tu nombre" ya vive ahí; un campo de foto sería la primera pieza |
| Disponible/Ausente | Ajustes → nueva sección "Presencia" (ámbito App: es un interruptor global, no por personaje, según la decisión ya tomada en `docs/NOTES.md`) | Pendiente de diseño de cola/segundo plano, fuera de este documento |
| Buzón de mensajes proactivos | Ícono propio en la cabecera del hub (junto a Buscar/Ajustes), o una pestaña — a decidir cuando se diseñe | Hoy no hay ningún lugar reservado; necesita su propio contrato de diseño |
| Hora local en el prompt | No es una pantalla, es un dato interno (se agrega al prompt, no a la interfaz) | Sin ubicación de UI que proponer |
| **Pestaña de "Fotos" en la ficha del personaje** | Nueva sección plegada al final de la ficha (`character-sheet.js`), después de "Recuerdos" y antes de "Cambiar foto"; acciones "Usar como foto de perfil" / "Usar como fondo del chat" sobre cada imagen de la galería | Función en estudio, NO autorizada (ver `docs/NOTES.md`, hoja de ruta) — esta fila es solo el lugar tentativo en la navegación, pedido explícito del punto 4 del Requisitos |

---

## 12. Lista priorizada de contratos sugeridos

| # | Título | Tamaño | Riesgo | Depende de |
|---|---|---|---|---|
| 1 | ~~Arreglar la clase CSS del botón del nombre en la cabecera del chat~~ — **hecho, UI-029 (2026-09-30)** | Pequeño | Bajo | Ninguno — ver sección 2 |
| 2 | ~~Renombrar rótulos sin cambiar comportamiento~~ — **hecho, UI-030 (2026-09-30)** | Pequeño | Bajo | Ninguno |
| 3 | ~~Mover "Cambiar avatar" y "Apariencia del personaje" del menú ⋮ a la ficha; quitar "Ver personaje"~~ — **hecho, UI-031 (2026-09-30)** | Mediano | Medio (cambia una ruta de navegación que el usuario ya conoce) | Ninguno técnico; sí autorización explícita del usuario |
| 4 | ~~Mover "Fondo del chat" del menú ⋮ a la ficha del personaje~~ — **hecho, UI-032 (2026-09-30)** | Pequeño | Bajo | Puede ir junto con el #3 |
| 5 | CCC-002 reformulado sobre CCC-003 (guías por campo, botón "Ejemplo", plantilla `<START>`/`{{user}}`/`{{char}}`, campo "Instrucciones") | Mediano | Medio | Ya estaba escrito; solo falta que el arquitecto lo reformule sobre `main` actual (ver fila CCC-002 del Registro de contratos) |
| 6 | Wizard del creador de personajes con plantillas y ejemplos | Grande | Medio | #5 (comparten pantalla) |
| 7 | Duplicar personaje | Pequeño–Mediano | Bajo | Ninguno |
| 8 | Memoria como "historia compartida": renombrar chats → episodios en la interfaz (sin tocar datos) | Pequeño | Bajo | Decisión de vocabulario del usuario |
| 9 | Galería de fotos por personaje (pestaña "Fotos" en la ficha) | Grande | Alto (nuevo almacén de imágenes, posible migración de IndexedDB) | Depende de que exista contenido que mostrar ahí (hoy no hay generación de imágenes) |
| 10 | Buscador dentro de Ajustes | Pequeño | Bajo | Ninguno — hoy Ajustes es una sola pantalla corta, prioridad baja hasta que crezca |

---

## 13. Qué no se pudo verificar / se detuvo (Condiciones de parada, sección 10 del contrato)

- No se pudo medir el tamaño táctil con una regla física en un teléfono real (solo se leyeron las
  reglas CSS) — no bloquea el contrato porque es un reporte, no un criterio de aceptación estricto.
- No encontré ninguna contradicción que obligara a detenerme: los contratos marcados "Hecho" en
  `docs/NOTES.md` (UI-026, UI-027, UI-028, MEM-012/013/014/015, CCC-003) existen de verdad en el
  código, tal como se describen. Las únicas discrepancias reales encontradas son las de las secciones
  2 y 5 (un bug de CSS, y el ámbito real del fondo/avatar vs. el supuesto del Contexto), ninguna de
  las dos grave ni oculta.

Ver también `docs/DESIGN.md` para las clases y tokens visuales que sustentan este documento, y
`docs/NOTES.md` (Registro de contratos y hoja de ruta) para el estado de cada contrato nombrado aquí.
