# CONTRATO-001 — Núcleo del prototipo Companion

**Estado:** MVP de creación, catálogo, chat local, conexión KoboldCpp y respaldo privado cifrado con restauración analizada; separación de episodios y resumen de continuidad v1 implementados, propuestas de estado mutable por capas y memoria v1 siguen pendientes  
**Objetivo:** establecer el primer prototipo verificable de creación, identidad, episodios y memoria, con arquitectura reemplazable por modelo y UX móvil cuidada.  
**Alcance de este documento:** define el trabajo del prototipo; no modifica ni migra la aplicación original.

## 1. Resultado de producto

Una persona puede crear un companion por pasos, definir quién es y cómo luce, describir su propia apariencia, iniciar una conversación normal o un episodio desde un escenario, y volver a conversar sin que se pierdan identidad, perfil o recuerdos importantes. Puede revisar y corregir lo que el sistema propone recordar, exportar el personaje y hacer un respaldo privado recuperable de ajustes, personajes y chats. La app informa de esperas y errores sin interrumpir la inmersión con avisos innecesarios.

El prototipo prioriza una experiencia clara sobre el número de funciones. No debe presentar modelos, tokens, prompts ni almacenamiento como conceptos cotidianos. El sistema usa modelos configurados por el usuario; el dominio y los datos no dependen de un LLM concreto.

## 2. Alcance

### Incluido

1. **Base móvil:** shell web autocontenido, responsive y compatible con el empaquetado Capacitor Android; catálogo de companions, navegación sencilla y estados de carga/error/desconexión.
2. **Creador guiado:** bloques para nombre/género, personalidad, comportamientos, preferencias relacionales, rasgos físicos permanentes y estilo de vestir. Las opciones predeterminadas ayudan, el texto libre permite personalizar y el progreso no se pierde al retroceder.
3. **Perfil del usuario:** rasgos físicos que el usuario elige compartir, incluyendo atributos concretos como lentes. El companion puede usarlos como contexto; no los altera por inferencia.
4. **Episodios:** conversación continuada con resumen de continuidad y creación de un episodio nuevo desde un escenario. Los episodios conservan su propio escenario y estado mutable, como la ropa elegida para esa escena.
5. **Identidad/memoria mínima viable:** separar semilla de identidad, tags del usuario, memoria emocional durable, resumen por episodio, evolución del companion y estado mutable. Cada recuerdo/propuesta puede revisarse y corregirse; una síntesis nunca sobreescribe silenciosamente los datos originales.
6. **Chat:** una persona puede abrir un companion guardado, enviar mensajes, ver la respuesta del modelo y retomar la conversación guardada. Un adaptador inicial conecta con KoboldCpp (`/api/v1/model`, `/api/v1/generate`); la URL, el nombre de usuario y parámetros básicos se configuran en ajustes. Los errores de red conservan el mensaje y permiten reintentar. Las tareas secundarias de memoria pueden usar el modelo pequeño local previsto, pero son aplazables y no bloquean el turno conversacional. El prototipo funciona con tareas secundarias desactivadas.
7. **Datos locales y recuperación:** persistencia local versionada, guardado incremental, exportación del personaje en formato interoperable y respaldo privado completo de ajustes, perfil, personajes y chats. El respaldo es para seguridad y recuperación personal, no para compartir en redes; su contenido se explica antes de crearlo o restaurarlo.
8. **UX y feedback:** interfaz serena y accesible, en inglés por defecto. La preferencia de idioma se rotula «IDIOMA DE LA INTERFAZ». Mantiene navegación cotidiana separada de preferencias personales y ajustes de sistema/avanzados. Informar de guardado, espera, tarea pendiente, desconexión, error y recuperación en términos claros.

### Fuera de alcance inicial

- Buzón proactivo, notificaciones, cartas programadas, presencia en segundo plano real.
- Generación de imágenes, galería y gestión de modelos de imagen.
- Sistema extenso de emociones, estados de ánimo o gamificación.
- Sincronización en nube y transmisión de datos por un servicio externo.
- Evasión de controles de red corporativos. La conectividad remota admite adaptadores/endpoints autorizados; un bloqueo de Fortinet se diagnostica y se resuelve con una vía permitida por la organización, no con ocultamiento de tráfico.

## 3. Decisiones de diseño fijadas para el prototipo

### 3.1 Identidad y estado

- **Semilla permanente:** wizard establece quién es el companion, personalidad y comportamiento inicial, y apariencia física. La evolución puede añadir muletillas, ticks, expresiones, gestos y cambios de tono, pero debe respetar la lógica de la semilla (por ejemplo, alguien calmado puede ser atrevido manteniendo su calma como base).
- **Estructura del creador CompanionF:** los bloques en inglés son Who are they? (nombre y Male/Female), Core personality (máximo tres rasgos), Temperament (máximo tres), Starting relationship, Life outside chat, Voice y Appearance. Los rasgos personalizados se guardan como chips seleccionados; no reemplazan ni omiten los valores sugeridos. Apariencia separa largo de cabello, tipo de cuerpo, tono de piel, color de ojos, color de cabello y detalles adicionales. Ropa se describe libremente como guía general y no como un atuendo fijo. Todos los companions son adultos; no se solicita una confirmación 18+ redundante y las opciones anatómicas deben ser coherentes con el género. El perfil del usuario es global, no un campo de Appearance del companion.
- **Card V2 como identidad:** cada selección alimenta campos Character Card V2 legibles y una extensión estructurada namespaced `companionf/identity-seed`, para conservar las categorías originales. La foto de perfil es presentación del companion, no un hecho de identidad; se conserva localmente y, si existe, puede acompañar una exportación PNG cuya metadata `chara` contiene la tarjeta V2. La exportación JSON no contiene bytes de imagen. El perfil visual del usuario sigue excluido.
- **Inmutabilidad física:** el companion no decide cambios permanentes de apariencia ni de salud (por ejemplo, tatuajes, piercings, alcoholismo o enfermedades). Solo el usuario puede editar esos datos.
- **Perfil del usuario:** solo tags de apariencia elegidos por el usuario; siempre legibles como recurso narrativo de bajo costo. No añadir gustos/rutina al perfil. Lo aprendido en conversación se trata como recuerdo propuesto aparte.
- **Estilo/preferencia:** incluye comportamiento y estilo de vestir, además de cuánto puede improvisar el companion. Son guía, no estado actual.
- **Ropa mutable:** se representa con tags por capas: desnudez, ropa interior, conjunto/prendas y accesorios cuando correspondan. El companion puede escoger/modificar las capas en contexto si el usuario dio esa libertad. Los tags de ropa generados se pueden inspeccionar y mantienen consistencia dentro del episodio; nunca se vuelven rasgos permanentes automáticamente.
- **Episodio:** el escenario inicia una conversación independiente. Puede implicar una elección de ropa según escena (por ejemplo, una invitación a un bar), pero no es una instrucción de vestuario por definición. Nuevo episodio recibe la semilla y solo memorias elegidas para identidad, junto al perfil visual del usuario; no hereda por defecto resumen de continuidad ni ropa del episodio anterior.
- **Relación:** el companion puede escribir en su propia voz su estado de relación basándose en memorias pertinentes. La app conserva procedencia y revisión; la redacción exacta del sistema/modelo queda por definir.

### 3.2 Memoria

Mantener cinco objetos conceptuales independientes:

1. **Recuerdo durable:** momento o patrón compartido emocionalmente significativo, con origen, fecha y estado (propuesto/confirmado/archivado). Prioriza cómo se sintió el usuario, qué hizo o aprendió el companion y cómo eso afecta la relación; un hecho aislado sin significado (p. ej., gusto por un alimento) no basta por sí solo.
2. **Resumen de continuidad:** síntesis breve de un episodio largo, con el punto hasta el que resume; no se mezcla con los recuerdos durables.
3. **Evolución/relación:** propuesta de cambio en tono, hábitos expresivos, gestos, muletillas o vínculo, derivada de recuerdos confirmados y validada contra la semilla; debe poder aceptar, editar o descartar.
4. **Estado mutable:** tags de ropa u otros detalles temporales, ligados al episodio; no se cuenta como recuerdo durable salvo acción expresa del usuario.
5. **Revisión de memoria:** el sistema agrupa evidencia y propone recuerdos editables tras un umbral de material nuevo que se determinará con medición; ofrecerá una auditoría mensual discreta para sugerir qué conservar. El umbral exacto y el momento de la auditoría se definirán durante prototipo según latencia y utilidad.

La gestión por modelo puede proponer extracción/consolidación. Debe conservar evidencia original, limitar afirmaciones no respaldadas y ser idempotente ante reintentos. Errores dejan la tarea pendiente y no alteran datos aceptados. Las tareas se procesan fuera del turno visible de chat; su finalización se indica con un marcador pequeño de revisión (punto/insignia), sin anuncio de texto. Un aviso legible se reserva para errores que requieran acción.

### 3.3 Modelos y recursos

- Definir un adaptador de generación principal y una capacidad opcional de tareas secundarias, sin acoplamiento del dominio a endpoints o formatos de un único modelo. En Android, `CapacitorHttp` envía las peticiones al endpoint configurado mediante la red nativa, sin las restricciones CORS/mixed-content del navegador.
- KoboldCpp local/Tailscale puede exponer HTTP. El APK permite HTTP hacia la dirección elegida en ajustes; la vista web conserva las restricciones del navegador y explica CORS/mixed-content cuando apliquen.
- Prioridad de recursos: respuesta del chat > persistencia segura > tareas secundarias.
- En hardware limitado, las tareas secundarias se encolan para reposo/ejecución posterior, se pueden pausar y tienen límite de tiempo/recursos configurable. Para el primer prototipo, no asumir concurrencia simultánea GPU+CPU; registrar latencia y permitir modo secuencial.
- Un modelo de mayor capacidad puede reprocesar opcionalmente registros previos para producir nuevas propuestas. Nunca altera hechos confirmados sin revisión del usuario.
- Detectar capacidades disponibles cuando sea posible, pero no afirmar que la app puede medir VRAM o predecir rendimiento de todos los runtimes. Ofrecer una selección simple de perfil: limitado, equilibrado o alto, con opción avanzada posterior.

### 3.4 Persistencia y exportación

- Persistencia local mediante IndexedDB detrás de módulos pequeños de dominio.
- Esquema con versión, validación de entrada y migraciones explícitas; guardar primero los cambios críticos de mensajes/identidad.
- Ofrecer dos acciones con propósitos claros: (a) exportar el personaje base a formato compatible de character card (V2 como objetivo inicial), y (b) crear/restaurar una copia de seguridad privada que incluya ajustes, perfil, personajes y chats. No diseñar flujos de publicación o compartir socialmente. Avisar qué contiene el respaldo; restaurar con análisis previo, elección de combinación/reemplazo y operación transaccional para evitar pérdidas.
- La copia de seguridad privada usa cifrado local AES-256-GCM con clave derivada de una contraseña (PBKDF2-SHA-256); el archivo contiene salt e IV aleatorios y no almacena la contraseña. Exige una contraseña de al menos 12 caracteres y explica que no se puede recuperar. Incluye el workspace completo (ajustes, perfil, borradores, companions/fotos, episodios/resúmenes/estado mutable, chats, memorias y tareas) y el tema local. La importación autentica y valida el archivo antes de mostrar nombres y conteos; solo después permite combinar sin sobrescribir ajustes/registros existentes o reemplazar con confirmación explícita. Guardar el workspace restaurado es una única escritura IndexedDB.
- **Estado actual de episodios v1:** `workspace.episodes[characterId]` conserva episodios independientes con escenario, mensajes, resumen con `throughMessageId`, tags mutables por episodio y cursor de memoria propio; `activeEpisodeIds` reabre la última historia elegida. El historial v3 se migra intacto al episodio `First conversation`. Un resumen se pide explícitamente desde el chat al superar 24 mensajes, se guarda junto al episodio y los mensajes originales nunca se borran; al editar/borrar mensajes cubiertos, se invalida ese resumen para impedir contexto obsoleto. Un episodio nuevo usa la semilla, el perfil visual y recuerdos confirmados, con escenario, resumen y detalles mutables vacíos.
- No se implementa sincronización remota en este contrato.

## 4. Arquitectura modular esperada

Organiza el prototipo por responsabilidades, no por pantalla gigante:

- `domain/`: entidades, validación y reglas puras para identidad, episodios y memoria.
- `storage/`: IndexedDB, versión/migraciones y exportación/importación local.
- `llm/`: interfaz neutral de generación, adaptadores de servidores elegidos y normalización de errores/streaming.
- `memory/`: selección de contexto, cola de tareas, extracción, verificación y propuestas; dependencias inyectadas.
- `ui/`: shell, navegación, creador, perfil, hub de companions, lista de episodios, chat y memoria.
- `styles/`: tokens semánticos, componentes y estilos responsive; no valores visuales dispersos en lógica.
- `platform/`: Capacitor, archivos, teclado y botón atrás mediante capacidades opcionales.

Los nombres son orientativos; antes de crear el árbol final, documentar el mapa real en el contrato de implementación. Evita un framework y una infraestructura de build si módulos ES bastan para esta escala. Los módulos de dominio deben poder probarse sin DOM ni red.

## 5. Dirección UX/visual

- Estética cálida, cómoda y fresca, como Nomi en su sentido de espacio de intercambio, sin copiar su interfaz. Temas claro y oscuro con fondos papelados y tonos cálidos (no negro OLED), tipografía legible, contraste AA y acentos moderados. El companion y la conversación son protagonistas.
- Navegación principal corta: companions, episodios/chat y perfil. Sistema/conexión y diagnóstico viven en ajustes separados; avanzados quedan plegados y explicados.
- En creación, una pregunta principal por paso, chips clickeables como guía, texto libre opcional con ejemplos concretos de cómo se interpretan, progreso visible, volver/continuar, guardado de borrador y revisión final editable en formato dashboard. En el flujo actual solo son obligatorios nombre, Male/Female y una guía general de ropa; los demás campos escritos son opcionales, y cualquier opción vacía sigue indefinida. La secuencia contiene siete bloques de identidad y un octavo bloque de revisión.
- En memoria, distinguir visualmente “la semilla”, “lo recordado”, “la propuesta” y “lo que lleva puesto en este episodio”. Mostrar tags inspectables para la ropa por capas. Acciones simples: confirmar, editar, archivar, deshacer cuando sea posible.
- Evitar paneles con telemetría, jerga o demasiados switches. Cada ajuste explica brevemente su efecto en la experiencia y su costo de recursos si corresponde.
- Feedback no modal por defecto: confirmación discreta al guardar, pequeño punto/insignia para memoria o revisión pendiente, acción para reintentar al fallar. Nada de anuncios textuales que rompan la inmersión; errores que requieren acción sí se explican claramente.
- Respeta área táctil cómoda, foco visible, tamaño de letra legible, teclado y botón atrás de Android, estados vacíos útiles y movimiento reducido.

## 6. Criterios de aceptación del prototipo

El prototipo se considera logrado cuando:

1. Una persona puede crear un companion desde cero, retroceder sin perder datos, guardarlo en el catálogo, abrir su chat y exportar una character card V2 válida. KoboldCpp consume el formato; la interfaz cotidiana presenta preguntas y ejemplos, no campos de formato técnico.
2. La semilla impide que una evolución propuesta contradiga la base; no se puede aceptar un cambio físico permanente como si fuera un simple recuerdo.
3. Puede establecer su perfil de apariencia con tags y un dato como “usa lentes” llega al prompt; no se añaden perfil biográfico ni datos inferidos.
4. Puede abrir un episodio desde un escenario; el companion inicia la escena, propone tags de ropa por capas y estos permanecen consistentes en ese episodio sin sobrescribir rasgos permanentes.
5. Un episodio nuevo carga la semilla, memorias de identidad confirmadas y perfil visual del usuario, pero no la ropa ni resumen de continuidad de otro episodio.
6. Puede continuar un episodio largo; su resumen no se confunde con recuerdos generales. Una propuesta de recuerdo emocional se puede inspeccionar, editar, confirmar o descartar.
7. El sistema ofrece una revisión mensual discreta, y también puede proponer recuerdos por un umbral de material nuevo; ambos disparadores deben ser medibles y configurables antes de cerrar implementación.
8. La memoria pendiente se indica mediante un marcador sutil sin anuncio textual. Si una operación requiere una acción por fallo, explica cómo reintentar sin perder información.
9. Puede crear un respaldo privado cifrado de ajustes, perfil, borradores, personajes/fotos, episodios/resúmenes, chats, memorias, tareas y tema; el flujo valida y analiza el contenido antes de restaurar y ofrece combinación o reemplazo con confirmación. Una contraseña incorrecta o archivo inválido no altera los datos. No se muestra como una función de compartir públicamente.
10. El chat sigue usable si la tarea secundaria se desactiva, se demora, falla o se interrumpe. El mensaje del usuario se conserva ante un fallo de generación y puede reintentarse. Ninguna propuesta fallida borra información.
11. Los temas claro y oscuro usan una paleta cálida tipo papel; la UI móvil mantiene feedback claro y separa uso cotidiano de ajustes avanzados.
12. La UI funciona en un viewport móvil de 360–430 px y con navegación de atrás; la estructura queda lista para compilarse como app Capacitor.
13. No se requiere acceso a una cuenta ni servicio comercial para arrancar, crear, guardar, exportar o leer datos locales.
14. Las direcciones del modelo principal y el modelo de memoria se configuran y prueban por separado; una dirección de memoria caída no interrumpe una respuesta de chat.
15. Una propuesta de memoria solo se guarda con IDs y citas verificables a mensajes fuente; el usuario puede editar, confirmar o descartar. El prompt de chat contiene exclusivamente recuerdos confirmados y el texto expresivo se presenta visualmente sin interpretar texto del modelo como HTML.

La implementación futura debe añadir verificaciones automatizadas para reglas de dominio, exportación, migraciones y selección de contexto, más revisión visual manual del flujo móvil. No se declara aceptación por compilación solamente.

## 7. Entregables de implementación posteriores

1. Mapa de módulos final y diagrama breve de flujos/datos.
2. Prototipo funcional conforme a los criterios de aceptación.
3. Guía corta de ejecución local, conexión de modelo y compilación Capacitor.
4. Registro de decisiones sobre formatos de tarjeta/copia, reglas de memoria y perfiles de recursos.
5. Revisión final de UX con capturas o vista previa y una autoevaluación conforme a `chatgpt.md`.

## 8. Riesgos a resolver durante el prototipo

- Rendimiento real del modelo principal y del pequeño modelo en el equipo objetivo; medir antes de fijar política automática.
- Formatos de character card y límites entre tarjeta exportada y respaldo privado completo.
- Cómo verificar recuerdos de forma útil sin crear una interfaz de moderación pesada.
- Taxonomía inicial de tags de ropa por capas y respuestas ambiguas cuando el modelo actualiza estado; toda salida debe poder corregirse.
- Acceso remoto desde redes restrictivas. La app puede probar y explicar conectividad, pero no garantiza eludir Fortinet/Tailscale bloqueados.

## 8.1 Feedback de revisión Android (2026-10-05)

Esta sección registra feedback del usuario recibido con capturas de la app. Es una dirección aprobada para la siguiente iteración del prototipo; las capturas son referencias visuales y no instrucciones externas al usuario.

1. **Actualizaciones Android:** cada APK debe conservar el mismo `applicationId` y estar firmado con una clave estable para que Android permita actualizar la instalación existente. El `appId` actual (`com.stvedgar.companionf`) ya es constante. GitHub Actions construye APKs debug en runners efímeros, por lo que su clave debug puede cambiar entre ejecuciones e impedir la actualización aunque coincida el `appId`. Definir una vía de firma persistente para distribución personal y explicar que los APKs ya instalados con otra firma pueden requerir una reinstalación única.
2. **Atrás en Android:** el botón físico/gestual debe volver a la pantalla previa dentro de la app y solo salir desde la raíz del catálogo; conservar y guardar el estado al retroceder.
3. **Creador:** todos los companions se consideran adultos; eliminar la confirmación redundante 18+. No ofrecer atributos anatómicos incompatibles con el género seleccionado (por ejemplo, tamaño de pecho para Male). Revisar accesibilidad de los campos restantes.
4. **Apariencia y alcance del wizard:** Appearance debe limitarse a apariencia permanente y guía general de vestimenta. El perfil visual del usuario es global y debe configurarse en su propio espacio. Opening scene no pertenece a Appearance; los textos repetidos entre títulos, descripciones y ayudas deben simplificarse.
5. **Relación y mensajes iniciales:** los chips de inicio de conversación, greeting/first message y example dialogue deben ser plantillas derivadas del `Starting relationship` seleccionado, visibles y editables en Companion Review. Si la relación cambia, actualizar plantillas sugeridas sin sobrescribir ediciones explícitas del usuario.
6. **Chat y preferencias:** retirar del flujo cotidiano los parámetros de longitud de respuesta, temperatura y context length mientras el script del usuario configure KoboldCpp y el servidor ignore esos valores. Mantener solo conexión y nombre de usuario donde corresponda. El menú del chat debe abrir ajustes propios del companion/chat: tema claro/oscuro y foto de perfil, con edición del companion; dejar espacio para presencia y memorias futuras. La conexión debe tener una entrada clara desde ajustes de la app.
7. **Respaldo:** sustituir el panel técnico general actual por acciones claras de exportación/importación de respaldo privado, incluyendo análisis previo y protección contra reemplazo accidental según la sección 3.4. No afirmar que opciones ignoradas por el servidor tienen efecto.
8. **Presentación visual:** eliminar el masthead persistente de página en pantallas de uso; trasladar idioma y tema a sus lugares adecuados (el tema dentro de ajustes del chat/app). Mantener el chat limpio que muestran las referencias. Un futuro fondo visual personalizable por companion queda anotado como idea, fuera de esta iteración; una foto de perfil sigue siendo el primer nivel visual.
9. **Pulido del flujo:** unificar alturas, espaciado y estructura de los pasos para que el wizard mantenga ritmo visual consistente, y evitar títulos y explicaciones que repitan la misma idea.
10. **Control de conversación:** editar o borrar mensajes, regenerar respuestas del companion y navegar entre alternativas generadas; persistir la alternativa seleccionada. Editar/borrar un turno de usuario debe retirar respuestas posteriores dependientes para no dejar contexto contradictorio. En pantallas de app no reservar espacio para un masthead o pie de sitio web.
11. **Doble modelo para memoria:** `settings.chatModel.url` y `settings.memoryModel.url` son direcciones independientes del mismo adaptador KoboldCpp. La URL antigua `settings.serverUrl` migra a chatModel sin perderse. La configuración de memoria se guarda localmente.
12. **Memoria v0:** al acumular tres intercambios completos desde el último cursor, encolar hasta tres pares por tarea (límite aproximado de 10 000 caracteres; el remanente se procesa en tareas posteriores). La CPU genera como máximo tres propuestas con tipo, redacción y citas a IDs de mensajes. La app valida que las citas existan literalmente tras normalizar espacios y mayúsculas. Sin evidencia válida no hay propuesta. Los mensajes originales quedan intactos.
13. **Revisión y contexto:** las propuestas se editan, confirman o descartan desde Memory Review. Solo `confirmed` entra al prompt principal y ocupa como máximo 1 800 caracteres; se rotula como memoria revisada y no sustituye la semilla. Las tareas pending/running/failed se recuperan o reintentan sin bloquear el chat. Errores dejan el trabajo visible y los datos preservados.
14. **Texto expresivo:** el renderizador convierte segmentos `*acción o gesto*` en bloques visuales de escena, escapando todo texto antes de insertarlo. El contenido semántico permanece como texto plano en la conversación.

### Orden sugerido de implementación

Aplicación inicial del principio de Pareto: despejar fricciones repetidas en el núcleo del uso (creador y primer intercambio), después garantizar retorno/navegación y continuidad de instalación, luego consolidar ajustes y respaldo; el fondo visual personalizado queda para más adelante. Ya se retiraron del wizard el perfil global del usuario, la escena y el gate adulto, y Review ofrece plantillas derivadas de la relación. El siguiente bloque de alto impacto es Atrás en Android. La firma de actualización requiere una clave persistente que el propietario debe custodiar/configurar fuera del repositorio; no se debe inventar ni almacenar en Git.

## 9. Regla de cierre

Antes de implementar cada bloque, cotejarlo con este contrato y `chatgpt.md`. Si cambia el alcance —en especial quién puede alterar identidades, qué se guarda en memoria o cómo se comparte información privada—, actualizar el contrato y presentar el cambio para debate antes de basarlo en código.

## Mapa de implementación actual

- `index.html` y `styles/app.css`: shell web responsive y temas cálido claro/oscuro.
- `src/domain/seed.js`: reglas puras para borrador, validación, semilla y mapeo a Character Card V2; apariencia permanente queda separada de preferencias y perfil.
- `src/domain/workspace.js`: workspace versión 4, catálogo, configuración y episodios por companion; migra la conversación anterior al episodio inicial y expone selección, consulta y creación de episodios.
- `src/storage/local-store.js`: acceso IndexedDB detrás de funciones de workspace, con versión inicial de esquema.
- `src/llm/koboldcpp.js`: adaptador KoboldCpp compartido para comprobar conexiones, generar chat/sugerencias de memoria y resúmenes de continuidad; arma el prompt principal con identidad, episodio activo, resumen e historial reciente, perfil y recuerdos confirmados.
- `src/memory/manager.js`: prepara lotes de tres intercambios completos y verifica evidencia citada de las propuestas. El workspace local conserva tareas y recuerdos por companion; solo recuerdos confirmados se pasan al adaptador principal.
- `capacitor.config.json` habilita el puente `CapacitorHttp` en plataformas nativas; `tools/allow-kobold-http.py` activa el permiso Android necesario para las direcciones HTTP configuradas.
- `src/main.js`: catálogo, wizard, revisión, ajustes, selección/creación de episodios y chat con guardado/reintento; el estado mutable editable y los resúmenes quedan ligados al episodio.
- `tools/build-web.py` and `www/`: stage only the web app files for Capacitor, keeping repository files/dependencies outside the packaged web root.
- `tools/preview.py` and `start-preview.sh`: serve the source app from localhost and open it in the default browser; direct `file://` opening leaves module startup unavailable, so `index.html` shows preview instructions as a fallback.
- `package.json` / `package-lock.json`: pinned Capacitor 6 dependency graph and local preview/build commands.
- `.github/workflows/android-apk.yml`: builds a debug APK artifact for main/manual runs and attaches it to version-tagged releases. A signed release build remains future work.
- `capacitor.config.json`: Capacitor points to the staged `www/` web output directory.
- Android `applicationId` is `com.stvedgar.companionf` and launcher label is `Companion Fork`, so this fork installs alongside the original app. CI names its APK `Companion-Fork-debug.apk`. A stable application ID alone is not sufficient for in-place updates: current GitHub Actions debug APKs use runner-generated signing keys, so durable update signing remains unresolved (see feedback section 8.1).

Esta porción cubre creación, perfil visual, catálogo, conversación básica con KoboldCpp, exportación Character Card V2 y respaldo privado cifrado. Las conversaciones anteriores se preservan como episodio inicial; nuevos episodios y resúmenes de continuidad v1 están disponibles. Siguen pendientes la propuesta automática de ropa por capas, la importación de character cards y la consolidación de memoria v1. El idioma inicial de la interfaz es inglés; el rótulo de la preferencia de idioma queda en español.
