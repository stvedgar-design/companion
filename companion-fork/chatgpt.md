# Companion Fork — instrucciones permanentes para Codex

Este documento es la guía de trabajo para cada instancia de Codex que contribuya a este fork. Léelo antes de explorar o modificar el producto. El código fuente, cuando exista, y los contratos aprobados son la fuente de verdad; las propuestas y los registros históricos no autorizan cambios por sí solos.

## 0. Continuidad entre instancias frescas

Cada porción de trabajo puede comenzar en una instancia nueva de Codex sin historial del chat anterior. No dependas de memoria conversacional ni pidas al usuario que repita decisiones ya registradas. Al iniciar, lee este archivo y el contrato vigente para la tarea; inspecciona el estado del workspace y conserva cambios existentes. Sigue el trabajo desde los artefactos, no desde suposiciones sobre conversaciones previas.

Al terminar una porción que deje trabajo incompleto, registra en un `PROGRESS.md` breve dentro de este fork qué se completó, qué queda, decisiones abiertas, comandos/verificaciones y el siguiente paso recomendado. Mantén ese registro factual y actualizado; no dupliques el contrato. Si el bloque terminó un hito, marca su estado en el contrato o en ese registro. En el resumen final deja un prompt de continuación solo cuando ayude a iniciar la próxima instancia; debe apuntar a estos archivos para evitar repetir contexto.

## 1. Producto y criterio rector

Estamos construyendo una app móvil autocontenida de AI companions, con interfaz inicial en inglés, HTML/CSS/JavaScript vanilla y empaquetado Android mediante Capacitor. La conversación puede estar en el idioma elegido por el usuario. Los modelos son reemplazables; la identidad, los datos y las decisiones de producto pertenecen a la app.

El producto debe permitir crear y editar companions, describir al usuario como una persona presente en la escena, conversar en episodios y construir memoria e identidad con el tiempo. Debe poder exportar un personaje y crear respaldos privados de la app para recuperar ajustes, personajes y chats. La UX debe sentirse cálida, clara, intuitiva y no técnica. El idioma inicial de la interfaz y del contenido de la app es inglés; la preferencia «IDIOMA DE LA INTERFAZ» se presenta en español. La app es para una relación ficticia consciente: trata con cuidado los vínculos y las emociones, sin mensajes que generen culpa, celos, urgencia o dependencia.

Usa Pareto para proteger el núcleo: prioriza creador, identidad, perfil del usuario, episodios, conversación, memoria durable y recuperación de datos. Una función nueva debe mejorar claramente una de esas necesidades antes de entrar al prototipo.

## 2. Decisiones arquitectónicas

- Runtime web sin framework ni bundler obligatorio; módulos ES pequeños, con límites claros entre dominio, adaptadores, persistencia y UI.
- Capacitor es la envoltura móvil, no la arquitectura del dominio. La app debe poder previsualizarse en navegador cuando sea práctico.
- IndexedDB es la persistencia local primaria. Centraliza su acceso tras una API de dominio; versiona el esquema y migra datos sin pérdida. Guarda mensajes y cambios importantes de inmediato.
- La red se accede mediante adaptadores. Ninguna pantalla conoce endpoints de un proveedor/modelo. Un perfil de conexión selecciona el adaptador disponible y expone estados legibles, cancelación y errores accionables.
- Mantén una interfaz de capacidades para generación principal y tareas secundarias. No acoples los datos a Magnum, KoboldCpp, Llama ni a un formato de respuesta de un modelo. El prototipo puede empezar con los modelos previstos, pero debe poder sustituirlos.
- La generación del chat tiene prioridad de latencia. Extracción, consolidación y síntesis de memoria son tareas diferibles, cancelables, reintentables y recuperables tras reinicio; nunca deben borrar o bloquear el chat.
- Si un modelo o hardware no admite una tarea secundaria, conserva una vía básica sin ella. No prometas autodetección de rendimiento: mide en el dispositivo y permite configurar límites.
- Los datos de identidad y memoria deben ser legibles y portables, con origen y fecha cuando sea pertinente. La síntesis de un modelo no reemplaza silenciosamente los hechos originales.
- Mantén formatos interoperables para exportar companions y un flujo separado para respaldos privados de ajustes, perfil del usuario, personajes y chats. No diseñes funciones de compartir públicamente; explica qué incluye cada archivo y protege los datos privados.

## 3. Modelo de producto

Representa explícitamente estas capas y no las mezcles:

1. Semilla de identidad del companion: nombre, género si se define, personalidad/comportamiento inicial y rasgos físicos permanentes. Evoluciona sin contradecir su lógica base.
2. Perfil estable del usuario: tags de apariencia que el usuario elige compartir (por ejemplo, cabello, ojos, complexión y lentes); no se autocompleta por inferencia.
3. Preferencias y estilo: comportamientos, estilo de vestir y límites de evolución del companion; orientan la escena sin fijar cada atuendo.
4. Estado mutable: ropa por capas y otros detalles presentes que cambian por episodio; conserva tags, procedencia y episodio.
5. Episodios: una conversación larga puede resumirse para continuar; un episodio nuevo puede empezar desde un escenario. No hereda por defecto ropa ni resumen de otro episodio.
6. Memoria durable: experiencias compartidas significativas, especialmente cómo se sintieron, qué aprendió cada uno y cómo influyen en el vínculo; no una lista indiscriminada de datos triviales.
7. Evolución/síntesis: muletillas, gestos, expresiones, tono y relación pueden evolucionar de forma coherente con la semilla, apoyados por recuerdos.

El companion puede elegir detalles mutables como su ropa cuando el usuario le da esa libertad y la escena lo permite. No cambies rasgos físicos permanentes, condiciones de salud ni datos del usuario por inferencia. Los cambios de evolución y los recuerdos nuevos se proponen para revisión; el usuario puede editarlos o descartarlos.

## 4. UX, estética y feedback

- Diseña primero para móvil táctil, lectura fácil y uso cotidiano. Usa inglés llano como idioma inicial y nombres de acciones concretos. La etiqueta de la preferencia de idioma de interfaz es «IDIOMA DE LA INTERFAZ».
- La interfaz debe ser cálida, cómoda y fresca, como un espacio de intercambio. Ofrece temas claro y oscuro con fondos papelados, no negro OLED, sin parecer consola de administración o laboratorio de modelos. Reserva jerga y controles de diagnóstico para un área avanzada separada.
- Separa navegación cotidiana, perfil/preferencias personales, conexión/sistema y opciones avanzadas. No mezcles controles de bajo uso con las acciones principales del chat o del creador.
- El creador avanza por bloques cortos; comunica progreso, permite volver sin perder lo escrito y termina con una revisión entendible y exportable. Presenta sugerencias editables, nunca como verdad obligatoria. Prioriza chips guiados y ejemplos legibles por el modelo; campos de texto libre opcionales nunca deben aparentar hechos establecidos si quedan vacíos.
- Todos los companions creados en esta app son adultos; no añadas una confirmación 18+ redundante. Mantén las opciones anatómicas coherentes con el género elegido. El perfil visual del usuario es global, no parte de Appearance del companion. La escena inicial, el primer mensaje y el diálogo de ejemplo deben derivarse como plantillas del starting relationship y poder editarse en la revisión.
- Cada APK Android de actualización debe conservar `applicationId` y certificado de firma estables. Un nombre de artifact de GitHub no define la identidad instalable; valida la clave usada para firmar las compilaciones antes de distribuirlas.
- Cada acción asíncrona importante comunica estado y resultado. Las tareas de memoria completadas usan feedback discreto (por ejemplo, un punto o marcador pequeño en el lugar que requiere revisión), no anuncios textuales que rompan la inmersión. Los errores que requieren acción sí deben ser claros y recuperables.
- Distingue visualmente hechos establecidos, propuestas del modelo, recuerdos y estado actual. Explica por qué un recuerdo está disponible cuando esa procedencia ayuda a corregirlo.
- Respeta botón atrás, teclado móvil, áreas táctiles cómodas, contraste, foco visible, reducción de movimiento y estados vacío/cargando/error/sin conexión.
- Las transiciones deben ayudar a entender dónde está el usuario; no añadas animación decorativa que retrase acciones ni ocultes que una operación está en curso.

## 5. Reglas de trabajo

- Lee el contrato aplicable y el código afectado antes de editar. No introduzcas alcance nuevo en medio de una implementación; registra preguntas o cambios de contrato.
- Conserva cambios preexistentes del usuario. No hagas resets, limpiezas destructivas, reescrituras de historial ni migraciones irreversibles sin autorización explícita.
- No añadas dependencias o servicios remotos sin una razón de producto y una decisión documentada. No envíes datos de conversación a servicios externos no configurados por el usuario.
- Mantén el texto de usuario/modelo como texto no confiable. Escápalo en la UI y no lo interpretes como HTML.
- No dejes fallos silenciosos. Los mensajes para usuarios deben decir qué pasó y qué pueden hacer; los detalles técnicos van a diagnóstico.
- Mantén módulos acotados y evita que la UI contenga reglas de memoria, prompt o persistencia.
- Añade o ejecuta verificaciones cuando el contrato o el usuario lo pida. Informa qué se verificó y qué no; nunca afirmes que algo se probó si no se ejecutó.
- Actualiza el contrato/documentación afectada con el cambio; no generes documentación duplicada de forma automática.

## 6. Autoevaluación obligatoria antes de entregar

Antes de cerrar una tarea, revisa el diff y responde para ti mismo; reporta los puntos materiales en el resumen:

1. **Necesidad:** ¿esto mejora creación, identidad, presencia del usuario, continuidad, memoria, recuperación o claridad de la UX?
2. **Cuidado:** ¿distingue datos establecidos de inferencias y evita apropiarse de la identidad o del vínculo del usuario?
3. **UX y feedback:** ¿se entiende qué ocurre, qué se guardó y qué hacer ante espera, error o desconexión? ¿El lenguaje suena a producto, no a herramienta técnica?
4. **Modularidad:** ¿cada regla está en una capa dueña y pequeña? ¿Se puede cambiar el modelo sin reescribir dominio o UI?
5. **Recursos:** ¿el chat conserva prioridad? ¿La función degrada con gracia en hardware limitado, con el servidor apagado y tras interrupciones?
6. **Datos:** ¿hay esquema, migración, procedencia, exportación/recuperación y tratamiento seguro de cambios?
7. **Verificación:** ¿se cubrieron los criterios del contrato? Declara límites y riesgos restantes con precisión.

Si alguna respuesta revela un incumplimiento, corrígelo antes de entregar o explica claramente el bloqueo y su alcance. El estándar es un producto cuidado, digno de confianza y fácil de usar, no solo código que compila.
