# DESIGN.md — lenguaje visual de Companion

**Principios:** una sola cosa memorable (el morado en el skin Nomi); el resto
discreto. Superficies sobrias, bordes muy redondeados, mucho aire. Cuerpo del
chat a 17px; campos de formulario a 16px mínimo (evita el zoom de Android).
Todo cabe en 360px sin scroll horizontal.

**Skins**: desde 2026-09-25 la app tiene cinco skins (Nomi, Glass, iMessage, Penumbra y
Penumbra Claude), cada uno en versión clara y oscura — ver "Rearquitectura del sistema de
skins" en `docs/HISTORIAL.md` para el detalle completo. Lo que sigue describe
los tokens tal cual están definidos para **Nomi Dark** (el skin y modo por
defecto, y el único que existía cuando se escribió este documento) — los
demás skins redefinen estos mismos tokens en `www/css/themes.css`, nunca
los componentes.

## Tokens (`tokens.css` + `themes.css`)

`tokens.css` define la forma (tamaños, radios, espaciado — igual en todos
los skins) y sirve de resguardo con los valores de Nomi Dark. Los colores,
la tipografía y los dos tokens de "material" (blur, fondo de `.app`) los
redefine `themes.css` por cada combinación skin+modo — la tabla siguiente
muestra el uso de cada token y su valor en Nomi Dark, no todos los valores
posibles (eso está en `themes.css` mismo, es la fuente de verdad).

| Token | Uso | Nomi Dark |
|---|---|---|
| `--color-bg` | fondo de toda la app | `#181924` |
| `--color-surface` | tarjetas, filas en `:active`, campos | `#20222f` |
| `--color-surface-2` | burbuja del personaje, hover de menu-item | `#2d2f40` |
| `--color-line` | bordes y separadores | `#383b52` |
| `--color-text` | texto principal | `#f3f3f8` |
| `--color-muted` | texto secundario, ayudas, placeholders | `#9b9eb8` |
| `--color-accent` | acento: botones primarios | `#8b1fe0` |
| `--color-accent-2` | acento claro: `:active` y anillo de foco | `#a24cf2` |
| `--color-accent-soft` | fondos suaves de acento (uso opcional) | `rgba(139,31,224,.16)` |
| `--color-danger` | errores, acciones destructivas | `#f0566a` |
| `--color-ok` | estados correctos | `#6ee7a8` |
| `--color-overlay` | capa oscura detrás de la hoja inferior | `rgba(6,6,12,.6)` |
| `--color-muted-on-accent` | *cursiva* sobre la burbuja del usuario (la regla de chat.css ya la respeta). UI-021: color SÓLIDO teñido con la identidad de cada skin (lavanda en Nomi/Glass/Penumbra, durazno en Penumbra Claude, azul en iMessage oscuro, azul marino en iMessage claro) para distinguirse del texto normal (blanco/negro puro); valores en la tabla "Cursiva del usuario" de abajo | `rgba(255,255,255,.72)` |
| `--grad-user` | fondo de la burbuja del usuario — degradado o color plano según el skin | `linear-gradient(135deg,#7a12d6,#9b3ff0)` |
| `--grad-avatar` | fondo del avatar por defecto | `linear-gradient(135deg,#5b1fa8,#c04bd6)` |
| `--font` | familia tipográfica — varía por skin (Literata en Nomi/Glass, fuente del sistema en iMessage) | `'Literata', Georgia, 'Times New Roman', serif` |
| `--color-em` | *cursiva* del PERSONAJE sobre su burbuja (UI-008); por defecto cae en `--color-muted`. Solo Nomi claro (`#6a677e`) e iMessage claro (`#69696d`) la redefinen, para llegar a 4,5:1 | *(sin definir)* |
| `--color-on-user` | texto normal sobre la burbuja del USUARIO (UI-008); por defecto cae en `--color-text`. Blanco en Nomi (claro y oscuro) y Glass claro | *(sin definir)* |
| `--surface-backdrop` | `backdrop-filter` de burbujas, botones, chips, tarjetas y hojas (UI-007) — `none` salvo en Glass (`blur(var(--glass-blur))`) | `none` |
| `--bars-backdrop` | `backdrop-filter` solo de la barra superior y el compositor — igual que arriba | `none` |
| `--sheet-surface` | fondo de la hoja inferior; por defecto `--color-surface`. Glass con "Efecto de vidrio" en *solo barras*/*desactivado* la hace casi opaca | *(sin definir)* |
| `--app-bg` | fondo de `.app` — solo Glass lo redefine (con su resplandor); el resto cae en `--color-bg` | *(sin definir)* |
| `--fs-xs..--fs-3xl` | escala tipográfica, 12 a 34px |
| `--radius-sm/md/lg/pill` | 10 / 16 / 26 / 999px |
| `--space-1..--space-6` | 4, 8, 12, 16, 24, 32px |
| `--dur-fast`, `--dur` | duraciones de transición, .12s y .18s |
| `--sat`, `--sab` | áreas seguras superior e inferior del dispositivo |

## Clases base (`base.css`)

| Clase | Uso |
|---|---|
| `.app` | contenedor raíz fijo; usa `--vt`/`--vh` de `platform.js` |
| `.view` / `.view.is-active` | una pantalla; solo la activa se muestra |
| `.topbar` / `.topbar__title` | cabecera con área segura superior |
| `.scroll` | zona con scroll vertical y barra delgada |
| `.footbar` | pie con área segura inferior |
| `.ib` | botón de icono circular 44px, `<svg>` de 24px |
| `.btn` (+ `--ghost`, `--danger`, `--sm`) | botón principal y variantes |
| `.inp` | input/select/textarea, 16px mínimo |
| `.field` (+ `__label`, `__hint`) | envoltorio de un campo con etiqueta y ayuda |
| `.chip` (+ `--ok`, `--err`) | etiqueta pequeña de estado |
| `.spinner` | indicador de carga giratorio |
| `.av` (+ `--sm/md/lg`) | avatar circular, imagen o inicial |
| `.list-row` (+ `__main/__title/__sub`) | fila de lista táctil |
| `.empty` | estado vacío centrado |
| `.status` (+ `--ok`, `--err`) | texto de estado bajo un formulario |
| `.sheet` / `.sheet__card` / `.sheet__title` | hoja inferior modal |
| `.menu-item` (+ `--danger`) | opción dentro de la hoja. UI-022: SIN línea divisoria entre opciones (el espacio en blanco y el encabezado `.menu-group` separan); área táctil ≥44 px |
| `.menu-section` + `.menu-group` | UI-019: grupo de opciones con encabezado (texto pequeño en mayúsculas, color apagado); cada grupo va envuelto en `.menu-section` para que `.menu-item:last-child` siga quitando la última línea |
| `.menu-fold` (+ `__chevron`, `__body`) | UI-020: opción que despliega su contenido al tocarla (`aria-expanded`); el cuerpo (`.menu-fold__body`) va oculto de entrada y se llena la primera vez que se abre |
| `.toast` | aviso flotante arriba, con `aria-live` |

`select` e `input[type=range]` llevan estilo propio sin necesitar clase adicional. Todo respeta `:active`, `:focus-visible` (anillo `--color-accent-2`) y `:disabled`; `prefers-reduced-motion: reduce` desactiva animaciones. Este módulo no define clases opcionales adicionales.

## Efecto de vidrio (UI-007)

`Settings.glassEffect` (`full` por defecto | `bars` | `off`) se aplica como `data-glass` en `<html>` (`shell.applyGlassEffect`). Solo actúa con el skin Glass (`[data-theme="glass"][data-glass=…]` en `themes.css`);
Nomi e iMessage no tienen ningún `backdrop-filter` (antes `blur(0px)`, ahora `none`). `bars`: blur solo en `.topbar` y `.chat-composer`. `off`: ninguno. Con `bars`/`off` la opacidad de las superficies de Glass sube
(oscuro: superficie .46→.62, superficie-2 .6→.78, hoja .94; claro: .5→.66, .68→.84, hoja .95) para que el texto se lea sin el desenfoque. El selector vive en Ajustes → Apariencia y solo se muestra con Glass activo.

## Penumbra y Penumbra Claude (UI-009)

Dos skins hermanos: misma estructura, formas, radios y tipografía (Literata incluida); solo cambia la paleta. Se definen únicamente con los tokens de `themes.css`, sin `backdrop-filter`
(burbujas opacas) y con un token nuevo `--bubble-edge` (borde fino de luz de las burbujas, aplicado como `box-shadow` en `.chat-bubble`; `none` en los demás skins). `--color-surface-2` y `--grad-user`
son degradados sutiles (solo se usan en `background`). Nombres en el selector: "Penumbra" y "Penumbra Claude" (`data-theme="penumbra"` / `"penumbra-claude"`).

| Token | Penumbra oscuro | Penumbra claro | Claude oscuro | Claude claro |
|---|---|---|---|---|
| `--color-bg` | `#140d1c` | `#f4efe8` | `#1f1c19` | `#f5f0e8` |
| `--color-surface` | `#1e1429` | `#fbf8f3` | `#292521` | `#fbf7f0` |
| `--color-surface-2` (degradado 160°) | `#2c1e3d → #251a34` | `#e9e1f4 → #e2d8f0` | `#38322c → #302b26` | `#ece3d3 → #e6dccb` |
| `--color-line` | `#3a2a4d` | `#d9cfe6` | `#4a423a` | `#d9ccb8` |
| `--color-text` | `#f1eaf6` | `#2a2233` | `#f3ece2` | `#2b2620` |
| `--color-muted` | `#a99bbd` | `#61567a` | `#b3a695` | `#665c4e` |
| `--color-accent` / `-2` | `#9146cf` / `#b47ae6` | `#7d3fc4` / `#9a63dc` | `#b3512f` / `#e08a66` | `#a94a29` / `#c8694a` |
| `--color-em` (acciones del personaje) | `#e6ad82` | `#8e4626` | `#e5a07c` | `#9a4424` |
| `--grad-user` (135°) | `#6b2fa3 → #8747c0` | `#7a3cc0 → #8e52d0` | `#a3462a → #b3522f` | `#a3462a → #b3522f` |
| `--color-on-user` / `--color-muted-on-accent` | `#fff` / `#e5d0ff` | `#fff` / `#efe3ff` | `#fff` / `#ffdfcc` | `#fff` / `#ffdfcc` |
| `--bubble-edge` | `inset 0 0 0 1px rgba(255,238,255,.09)` | `inset 0 0 0 1px rgba(255,255,255,.7), 0 1px 2px rgba(60,40,90,.1)` | `inset 0 0 0 1px rgba(255,236,220,.09)` | `inset 0 0 0 1px rgba(255,255,255,.75), 0 1px 2px rgba(80,50,30,.1)` |

Contraste logrado (WCAG, peor tramo del degradado; el test `contrast.test.mjs` los vigila): texto/personaje 10,8–13,1; cursiva/personaje 4,8–7,8; texto/usuario 4,9–5,7; cursiva/usuario 4,0–5,4 (UI-021: ver tabla de abajo); blanco sobre el acento (botón enviar) 5,1–6,2; texto secundario sobre el fondo 5,9–7,4.

### Cursiva del usuario (UI-021, decisión del usuario)

En la burbuja del usuario el texto normal ya es blanco (negro en iMessage claro), sin margen para distinguir la cursiva por brillo. Se le dio a la cursiva un color sólido teñido con la identidad del skin; el precio es contraste: **4,0:1 como piso** (el texto llega a 4,5–5,7) en vez de los 4,5 de UI-008. Todo por `--color-muted-on-accent`; la cursiva del PERSONAJE (`--color-em`) no cambió.

| Skin | Oscuro | Claro | Contraste (oscuro / claro) |
|---|---|---|---|
| Nomi | `#f1e6ff` | `#f1e6ff` | 4,0 / 4,0 |
| Glass | `#dbc4fc` | `#f4ecff` | 4,0 / **3,4** (el texto blanco ya solo llega a 3,88) |
| iMessage | `#e8f3ff` | `#082046` | **3,3** (el texto blanco ya solo llega a 3,65) / 4,0 |
| Penumbra | `#e5d0ff` | `#efe3ff` | 4,0 / 4,0 |
| Penumbra Claude | `#ffdfcc` | `#ffdfcc` | 4,0 / 4,0 |

`tests/contrast.test.mjs` vigila los pisos (4,0; 3,3 en Glass claro; 3,2 en iMessage oscuro) y que la cursiva sea de un color distinto al del texto en los 10 skins/modos.

## Pulido de hub y chat (UI-022)

- **Reintentar respuesta** (`.chat-retry`): ya no es una píldora de ancho completo sino un ícono de flecha circular (círculo de 32 px dentro de un área táctil de 44 px), alineado a la derecha bajo el último mensaje del usuario. Conserva `aria-label`/`title` "Reintentar respuesta". Misma acción de siempre (`generate()`).
- **Tarjeta del hub** (`.home-card`): toda la tarjeta es "Continuar" (chat más reciente; sin chats, crea uno, UI-013). El retrato (`.home-card__avatar`) es su propia zona y abre la lista de chats (`stopPropagation`). El botón "Continuar" sigue visible como refuerzo (y para teclado/lector de pantalla). **Borrar = pulsación larga** sobre la tarjeta (550 ms, se cancela si el dedo se mueve >10 px, o sea un scroll) con la confirmación de siempre; ya no hay papelera. Una línea de pista bajo la lista (`.home-hint`) lo explica. Lógica del gesto en `www/js/longpress.js` (pura, con test).
- **Punto de estado** (`.home-status`, `data-state` + `data-part`): el TONO cambia con la franja del día (las 4 de UI-018) y la FORMA dice el estado: conectado = disco relleno de 10 px; sin conexión = anillo hueco rojo de 14 px; comprobando = punto gris de 8 px. Tonos (oscuro / claro): madrugada `#8f9cff` / `#4a58d6`, mañana `#62d69a` / `#1a8a57`, tarde `#f0c14b` / `#9a6400`, noche `#c29cff` / `#7a3fc4`; nunca rojos (no se confunden con un error) y ≥3:1 sobre el fondo de los 10 skins/modos (vigilado por `contrast.test.mjs`). Son los únicos colores fijos fuera de `themes.css`: no dependen de la paleta del skin.
- **Menos líneas divisorias**: se quitó el `border-bottom` de `.menu-item` (menú del chat, "Diagnóstico", "Elegir saludo"…).

## Tipografía dividida (UI-023, experimental)

Ajuste en Ajustes → Apariencia (`Settings.splitTypography`, **apagado por defecto**; con él apagado no se emite ninguna regla nueva y el aspecto es idéntico al anterior). Encendido, pone `data-split-font="on"` en `<html>` (`shell.applySplitTypography`, al instante y al arrancar) y `chat.css` hace que, **solo en burbujas del personaje que contienen cursiva** (`chat.js` les pone `.chat-bubble--split`), el texto normal (diálogo) use el token `--font-dialogue` y la cursiva siga con `--font` del skin. Un personaje sin cursiva (Ani) nunca lleva la marca, así que no se afecta sin ningún caso especial.

| Token | Valor | Nota |
|---|---|---|
| `--font-dialogue` (en `tokens.css`, global; ningún skin lo redefine) | `-apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', Roboto, sans-serif` | La misma pila de sistema que iMessage: no hay archivos que incluir ni licencia que verificar (Roboto en Android). El tamaño (17 px) y los colores no cambian, así que el contraste tampoco. |

En iMessage el ajuste no se nota (su `--font` ya es esa pila). Opinión del usuario tras probarlo: **pendiente** (es quien decide si algún día queda encendido por defecto).

## Métricas técnicas: "esconder, no eliminar" (UI-020)

Principio del proyecto (decisión del usuario): los datos técnicos (conteo de mensajes, contexto usado, y toda medición futura como las de UI-001/UI-005) **se siguen calculando y siguen disponibles** para Claude Code y el arquitecto, pero **no se muestran de entrada** al usuario final, cuya experiencia es chatear. Su lugar es la sección plegable **"Diagnóstico"** del menú ⋮ del chat (`buildDiagnostics` en `www/js/ui/chat.js`; cerrada por defecto; texto de aviso "Información técnica. No hace falta entenderla para usar la app."). Contratos posteriores que midan algo deben añadirlo dentro de esa sección (o de una equivalente plegada), no en la pantalla principal. Si algún día existe `docs/PRINCIPIOS-DE-INGENIERIA.md` (DOC-005), enlazar este principio allí.
