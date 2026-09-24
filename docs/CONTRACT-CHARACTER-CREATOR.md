# CONTRATO (PROPUESTA) — Creador de personajes guiado

> Este documento es una **propuesta de diseño para discutir con el
> usuario**, no una autorización para implementar. Se escribió el
> 2026-09-23 a pedido explícito del usuario ("escribe estas ideas en la
> documentación antes de implementarlo"), junto con la opinión profesional
> que pidió sobre el enfoque. Si arrancás este trabajo en una sesión nueva,
> **confirmá primero con el usuario que el alcance descrito acá sigue
> siendo el que quiere** — puede haber cambiado de opinión o querer ajustar
> algo antes de que se escriba código. Antes de esto, leé
> `docs/CONTRACT-HANDOFF.md` completo y `docs/NOTES.md`.

## 1. El problema y el pedido del usuario

El usuario tiene un personaje ("Mia") cuya character card fue escrita a
mano, con ayuda de una instancia vieja de Claude Code, iterando hasta que
"funciona ridículamente bien" — coherencia en chats largos (90+ mensajes en
sus logs originales, hoy perdidos por el bug de exportación de las
versiones alfa, ya arreglado) y buen comportamiento al cambiar de
escenario. El archivo de referencia completo está en
`docs/examples/mia-card-reference.json` (copiado del original que el
usuario adjuntó — ver §2 para el análisis campo por campo).

El usuario quiere que la app tenga una forma de **crear** personajes desde
cero (no solo importar PNG/JSON ya hechos), directamente en el hub, con la
opción de sumarle foto de perfil y fondo de chat en el mismo flujo. Pero
identificó él mismo el riesgo real: si el creador es texto libre sin
ninguna estructura, es fácil terminar escribiendo una card larguísima que
se come el presupuesto de contexto (su hardware es limitado, ver
`docs/CONTRACT-LOREBOOK.md` §3 para el contexto de esa restricción). Como
punto de partida más chico y seguro, propuso que el personaje se arme a
partir de **opciones pre-existentes tipo botón/pill** (coherente con el
lenguaje visual ya establecido — ver `docs/HISTORIAL.md`, secciones de
Apariencia/skins), en vez de campos de texto libre sin límite.

Pidió, en ese orden: (1) que estudie a fondo la card de Mia para entender
por qué funciona tan bien, (2) que documente la propuesta antes de tocar
código, y (3) mi opinión profesional sobre si el enfoque de pills/presets
es el correcto para arrancar, y qué implica para el roadmap a mediano plazo
ya establecido (`docs/CONTRACT-HANDOFF.md` §7).

## 2. Análisis de la card de referencia (Mia)

Card completa en `docs/examples/mia-card-reference.json`. Lo que importa no
es el contenido puntual de Mia (eso es del usuario, no una plantilla a
copiar literal) sino **la forma**: qué campos usa, cuáles deja vacíos, y
cómo arma cada uno. Esa forma es el patrón "que ya funciona" que este
encargo tiene que preservar.

- **`description`** hace doble trabajo: primero la identidad del personaje
  en prosa corta (quién es, cómo es), y después, en el mismo campo,
  separado por un párrafo en blanco, un bloque explícito de **reglas de
  estilo de escritura** ("Writing style rules: write ONE short paragraph
  per reply (2-4 sentences). Put body language and actions in *asterisks*,
  in first person. Write speech without quotation marks. Never write
  Edgar's actions, words or thoughts. Stay in character at all times.").
  Esto NO está en `system_prompt` ni en `post_history_instructions` —
  están vacíos en esta card. Es una decisión consciente y probada por
  iteración: para modelos locales chicos, meter las reglas de formato
  DENTRO del bloque de descripción (que `headBlock()` en `prompt.js` ya
  arma junto con personalidad y escenario) parece darles más peso que
  separarlas en otro campo. Esto es una observación empírica del usuario y
  la instancia anterior, no algo que este documento pueda demostrar — pero
  es el patrón que "funciona ridículamente bien", así que hay que
  preservarlo como comportamiento por defecto, no reinterpretarlo.
- **`personality`** es una lista corta de rasgos separados por coma ("shy,
  sweet, clumsy, polite, curious") — NO un párrafo. Barato en tokens, fácil
  de escanear para el modelo, y —clave para este encargo— **es
  directamente "pill-eable"**: una lista de tags elegibles mapea 1 a 1 a
  este formato.
- **`scenario` está vacío a propósito.** Coherente con la adenda multi-chat
  ya implementada (`chat.scenario`, ver `docs/HISTORIAL.md`): el escenario vive
  por chat, no por personaje, para no mezclar historias distintas del mismo
  personaje. El creador de personajes **no debe pedir un escenario** — eso
  ya tiene su lugar (la pantalla de "Nuevo chat", `chats.js`).
- **`first_mes`** arranca con una acción en *asteriscos*, en primera
  persona, seguida de diálogo sin comillas — el saludo mismo es un ejemplo
  trabajado del estilo pedido, no solo texto de bienvenida. Refuerza las
  reglas de estilo por demostración, no solo por instrucción.
- **`mes_example`** usa `<START>` (que `prompt.js` ya sabe limpiar) seguido
  de un intercambio corto de ejemplo, otra vez mostrando el formato exacto
  (turnos cortos, acciones en asteriscos, sin comillas). Es "few-shot": for
  modelos locales chicos, un ejemplo bien elegido suele pesar más que una
  instrucción abstracta.
- **`system_prompt` y `post_history_instructions` están vacíos.** Todo lo
  que podría haber ido ahí (las reglas de estilo) está en `description` en
  su lugar. No inventar una razón definitiva no verificable, pero es
  consistente en toda la card y coincide con lo que el usuario reporta que
  funciona — el creador debería replicar este patrón por defecto, no
  repartir instrucciones por los tres campos a la vez.
- **`alternate_greetings`, `creator_notes`, `tags`, `creator`**: vacíos,
  sin usar. No hace falta que el creador los pida en la v1.

## 3. Propuesta de diseño (mi recomendación, no decidida aún)

**Resumen de la recomendación:** un creador **híbrido**, no 100% pills ni
100% texto libre. La razón de por qué no puede ser una sola cosa está en
qué parte de la card hace qué trabajo:

- La parte que hace que un chat largo se mantenga coherente y no se pase de
  contexto es la **capa estructural**: las reglas de estilo de escritura y
  los rasgos de personalidad. Esa parte es un espacio de diseño chico y ya
  bien entendido (unas pocas combinaciones válidas cubren la enorme
  mayoría de los casos) — es exactamente lo que un sistema de pills/presets
  resuelve bien, y es la parte que el usuario tiene razón en querer
  restringir.
- La parte que hace que cada personaje sea *ese* personaje y no otro es la
  **capa de contenido**: nombre, quién es, cómo saluda. Esa parte es
  inherentemente abierta — restringirla a presets le sacaría la gracia a
  crear un personaje. Ahí no corresponde poner pills, corresponde texto
  libre con una guía de longitud (el mismo patrón que ya existe en
  `chats.js` para el escenario de un chat nuevo: `maxlength` + contador en
  vivo, `SCENARIO_MAX`).

Pills puras (sin nada de texto libre) serían demasiado limitantes para la
identidad del personaje. Texto libre puro (sin ninguna guía) es exactamente
el riesgo que el usuario ya identificó. El híbrido es, literalmente, "la
flexibilidad para configurar un personaje pero también la rigidez de
estructura que hizo funcionar a Mia" — la frase del usuario describe
correctamente la solución, no soy yo agregando algo nuevo.

### 3.1 Capa estructural (pills) — `[TU CRITERIO en la lista exacta]`

Dos grupos de pills, ambos de selección simple o múltiple acotada (no
texto libre en ninguno de los dos):

- **Estilo de escritura**: un puñado de paquetes prearmados (no un pill por
  eje combinable libremente — combinatoria innecesaria para una v1). Por
  ejemplo: "Un párrafo corto, acciones en *asteriscos*, primera persona,
  sin comillas" (el estilo de Mia, ofrecido como opción por defecto),
  "Párrafos más largos y descriptivos, tercera persona", etc. Cada opción
  es, en el fondo, un bloque de texto ya redactado en el mismo espíritu que
  el de Mia — el creador arma el párrafo de "Writing style rules" solo, el
  usuario nunca lo escribe a mano.
- **Rasgos de personalidad**: una lista curada de tags comunes (tímido,
  curioso, protector, sarcástico, etc.), togglables, que se unen con coma
  al guardar — mapea directo al formato de `personality` que ya usa Mia.

### 3.2 Capa de contenido (texto libre guiado)

- **Nombre**: texto simple, obligatorio.
- **Descripción/identidad**: textarea con `maxlength` + contador en vivo
  (mismo patrón que `SCENARIO_MAX` en `chats.js` — elegir un tope
  razonable, sugerido 400-600 caracteres, pensando en el presupuesto de
  contexto). El bloque de reglas de estilo elegido en 3.1 se **concatena
  automáticamente** después de este texto al armar el campo `description`
  final — el usuario nunca escribe las reglas a mano, solo elige el
  paquete de estilo.
- **Primer mensaje (`first_mes`)**: textarea guiado, con un hint que
  recuerda el formato elegido (asteriscos/primera persona, etc. según la
  pill de estilo activa).
- **`mes_example`**: `[TU CRITERIO]` — es el campo más "de experto" de
  toda la card. Dos caminos válidos: (a) opcional/saltable en la v1, o (b)
  autogenerar un intercambio mínimo de ejemplo a partir del nombre del
  personaje y el estilo elegido, editable después. Mi inclinación es (b)
  — es exactamente el tipo de campo que el usuario no debería tener que
  escribir a mano, y ya vimos que el ejemplo de Mia es una pieza clave de
  por qué funciona — pero confirmalo con el usuario antes de decidir, no es
  obvio que valga el esfuerzo de implementar un generador para esto en una
  v1.
- **`scenario`**: no se pide acá. Queda vacío en la card (ver §2). El
  usuario sigue poniendo el escenario al crear un chat nuevo, como ya
  funciona hoy.

### 3.3 Foto de perfil y fondo de chat

- **Foto de perfil**: reusar tal cual el flujo que ya existe
  (`onChangeAvatar` en `www/js/ui/chat.js`, que llama a `pickFiles()` +
  `makeAvatar()` de `cards/avatar.js`) como un paso más del creador. Es
  trivial de sumar, ya está resuelto en otro lado.
- **Fondo de chat — RESUELTO (2026-09-23), ya no es una pregunta
  abierta.** Esta sección dejaba explícita una tensión (¿el fondo debería
  ser por personaje o seguir siendo global?) para que el usuario la
  resolviera antes de tocar código. Ya la resolvió: el fondo es **por
  personaje** (`chatBackground*` vive en `Character`, no en `Settings` —
  ver `docs/HISTORIAL.md`, "Fondo de chat por personaje"), visible solo en los
  chats de ESE personaje; el resto de la app sigue el fondo del skin activo
  (`www/css/themes.css`). Esto en realidad simplifica este encargo: ahora
  el creador **sí puede** sumar un paso de "elegir fondo" sin ninguna
  ambigüedad de arquitectura — llamaría a `saveCharacterBackground()`
  (`state.js`) igual que ya hace `ui/chat-background.js` (la hoja que se
  abre desde el menú ⋮ del chat). Sigue siendo válido no incluirlo en la
  v1 del creador por simplicidad (el usuario puede configurarlo después
  desde ahí), pero ya no es una decisión de producto pendiente — es
  puramente una cuestión de cuánto abarcar en la primera versión.

## 4. Cómo tiene que salir la Card final

**Regla dura, no negociable:** el personaje creado por este flujo tiene que
terminar como un objeto `Card` con exactamente la misma forma que ya
produce `normCard()` en `www/js/cards/parse.js`, y guardarse con el mismo
patrón que ya usa `importCardFile()` en `www/js/cards/import.js` (armar el
`Character`, `makeAvatar()` si hay foto, `saveCharacter()`). **No** un
pipeline de datos paralelo. Esto es lo que garantiza que exportar, hacer
backup, y (a futuro) el puente a `character_book`/worldbook externo (ver
`docs/CONTRACT-HANDOFF.md` §7 punto 2) sigan funcionando igual sin importar
si el personaje se creó importando un archivo o con este creador.

Sugerencia de estructura de archivos (a confirmar cuando se implemente):
una función pura en algo como `www/js/cards/build.js` (nombre a definir)
que reciba las elecciones del formulario (pills + texto) y devuelva un
`Card` normalizado — testeable con `node:test` sin DOM, mismo criterio que
el resto de `cards/*`. La UI (formulario con pills, en `www/js/ui/`) queda
separada y le pasa los datos a esa función.

## 5. Qué NO hacer en este encargo

- No tocar `character.card.character_book` — sigue reservado para el
  puente al worldbook externo del usuario (`docs/CONTRACT-HANDOFF.md` §7.2).
- No pedir `scenario` en el creador (ver §3.2).
- No duplicar la lógica del fondo de chat: si se suma ese paso al
  creador, reusar `saveCharacterBackground()` (`state.js`) y las utilidades
  de `images.js`, no escribir un camino paralelo (ver §3.3 — el modelo de
  datos por personaje ya existe).
- No tocar el flujo de importar PNG/JSON que ya existe — el creador es
  aditivo, una segunda forma de llegar a un `Character`, no un reemplazo.
- No inventar campos nuevos en `Card` que Tavern V2/V3 no tenga — rompería
  compatibilidad con el import/export ya construido.

## 6. Implicaciones para el roadmap a mediano plazo

(`docs/CONTRACT-HANDOFF.md` §7 — repaso punto por punto, a pedido del
usuario)

1. **Memoria curada**: conexión natural a futuro (los rasgos elegidos por
   pill en la creación podrían sugerir entradas iniciales de memoria
   curada el día que esa feature exista), pero no es parte de este
   encargo — no construir esa conexión todavía.
2. **`character_book`/puente a worldbook**: sin cambios, sigue reservado
   (ver §5).
3. **Formato de intercambio más estricto**: reforzado, no afectado — al
   pasar todo por `normCard()`/`saveCharacter()` (ver §4), un personaje
   creado acá es indistinguible en el storage de uno importado, así que
   cualquier garantía de formato futura los cubre a los dos por igual.
4. **Durabilidad de datos**: un creador más fácil de usar significa que el
   usuario probablemente cree personajes más seguido — el respaldo
   automático y la eventual pantalla de respaldos (pendiente) importan un
   poco más, no menos.
5. **Organización a escala (buscador, tags/favoritos en el hub)**: este es
   el punto que más se acelera. Bajar la fricción para crear un personaje
   nuevo probablemente hace que el usuario llegue antes al punto en el que
   una grilla plana de personajes se queda corta. No es razón para
   adelantar ese trabajo ahora, pero sí para tenerlo más presente la
   próxima vez que el usuario tenga 5+ personajes.
6. **Portabilidad/CI**: sin relación directa.

**Conclusión de la recomendación**: el enfoque híbrido (pills para
estructura, texto libre guiado para contenido) es el punto de partida
correcto — resuelve el riesgo real que el usuario identificó (cards
larguísimas que gastan contexto) sin sacrificar lo que hace único a cada
personaje, y sin comprometer ninguno de los objetivos ya establecidos en el
roadmap. La única decisión de arquitectura que este documento había dejado
abierta a propósito (¿fondo de chat por personaje o global?, §3.3) ya la
resolvió el usuario el 2026-09-23: es por personaje, y ya está
implementado. Lo que sigue pendiente es solo confirmar el alcance de la
v1 con el usuario antes de escribir código.

## 7. Cómo verificar (cuando se implemente)

1. `node --check` en cada archivo nuevo/tocado.
2. Tests con `node:test` para la función pura que arma la `Card` a partir
   de las elecciones del formulario (casos: distintos combos de pills,
   texto en los límites de `maxlength`, campos vacíos).
3. Probar a mano en el navegador integrado (375×812): crear un personaje
   completo, confirmar que aparece en el hub igual que uno importado, que
   se puede chatear con él, exportarlo, y que un backup completo lo
   restaura bien.
4. Actualizar `docs/NOTES.md` con las decisiones tomadas en los puntos
   marcados `[TU CRITERIO]` de este documento, siguiendo el estilo ya
   establecido.
