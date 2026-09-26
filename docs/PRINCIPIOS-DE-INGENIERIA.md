# Principios de ingeniería de Companion

Inspirados en cómo se construyen las apps móviles nativas (iOS/Android) y
adaptados a esta app: HTML/JS dentro de un WebView (Capacitor), 100 % en el
teléfono, hablando con un servidor local del usuario. Teléfono de referencia:
Nokia G20 (gama de entrada). Son criterios de decisión, no tareas.

1. **Medir antes de optimizar.** Presupuesto de fluidez: cuadro ≤ 16,7 ms ideal,
   ≤ 32 ms tolerable en el teléfono de referencia. Todo cambio en el chat trae
   números antes/después (ver la "Prueba de fluidez" y los tiempos por respuesta).
2. **Una sola fuente de verdad.** La pantalla se dibuja a partir del estado; se
   actualiza de forma incremental (solo lo que cambió), nunca reconstruyendo todo
   salvo necesidad real.
3. **El costo debe ser proporcional a lo visible, no al total.** Listas largas:
   ignorar lo que está fuera de pantalla (`content-visibility`, ventanas).
4. **Crear bajo demanda.** Nada de nodos, botones, imágenes o listeners que aún no
   se ven o no se usan.
5. **El hilo principal es sagrado.** El trabajo pesado se difiere o sale del hilo
   principal (`requestIdleCallback`, Web Workers para importar/exportar copias o
   cálculos grandes). Las actualizaciones visuales se agrupan por cuadro.
6. **Estados explícitos en toda pantalla:** cargando, vacío, error, sin conexión,
   siempre con un mensaje llano y una salida (reintentar, cancelar).
7. **La app puede morir en cualquier momento** (Android mata procesos). Guardar de
   forma incremental (mensaje del usuario antes de pedir respuesta; respuesta
   parcial y borradores) y reanudar sin perder nada.
8. **Datos con esquema versionado y migraciones probadas.** Nunca romper copias
   antiguas; importar de forma transaccional (todo o nada); confirmar antes de
   pisar datos.
9. **Diseño por roles semánticos** (colores y tipografías como tokens con
   significado), con pruebas de contraste automáticas (texto ≥ 4,5:1 donde sea
   posible), fuentes incluidas en la app, respeto del tamaño de texto del sistema y
   de `prefers-reduced-motion`, áreas táctiles ≥ 44 px.
10. **Módulos pequeños y puros** para todo lo que pueda probarse sin pantalla; la
    interfaz es delgada; las dependencias se inyectan (así se prueban con dobles).
11. **La red es poco fiable y el servidor puede estar apagado.** Toda petición es
    cancelable, con tiempo máximo y reintentos limitados, y nunca bloquea la
    interfaz. El mensaje del usuario nunca se pierde.
12. **Privacidad por defecto.** Nada sale del teléfono salvo hacia el servidor del
    usuario. Sin analítica, sin CDN ni fuentes externas.
13. **Tareas futuras (notificaciones, "cartas"):** programarlas localmente por
    adelantado, sin depender de que la app corra en segundo plano. Verificar en
    el teléfono real lo que Android permite antes de prometerlo.
14. **Un cambio, un contrato pequeño**, con prueba en el teléfono de referencia y
    una línea en el Registro de contratos.
