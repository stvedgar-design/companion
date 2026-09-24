# DESIGN.md — lenguaje visual de Companion

**Principios:** una sola cosa memorable (el morado en el skin Nomi); el resto
discreto. Superficies sobrias, bordes muy redondeados, mucho aire. Cuerpo del
chat a 17px; campos de formulario a 16px mínimo (evita el zoom de Android).
Todo cabe en 360px sin scroll horizontal.

**Skins**: desde 2026-09-23 la app tiene tres skins (Nomi, Glass, iMessage),
cada uno en versión clara y oscura — ver "Rearquitectura del sistema de
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
| `--color-muted-on-accent` | *asteriscos* sobre una superficie con acento (hoy: burbuja del usuario) | `rgba(255,255,255,.72)` |
| `--grad-user` | fondo de la burbuja del usuario — degradado o color plano según el skin | `linear-gradient(135deg,#7a12d6,#9b3ff0)` |
| `--grad-avatar` | fondo del avatar por defecto | `linear-gradient(135deg,#5b1fa8,#c04bd6)` |
| `--font` | familia tipográfica — varía por skin (Literata en Nomi/Glass, fuente del sistema en iMessage) | `'Literata', Georgia, 'Times New Roman', serif` |
| `--surface-blur` | blur de vidrio (`backdrop-filter`) — 0px salvo en Glass | `0px` |
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
| `.menu-item` (+ `--danger`) | opción dentro de la hoja |
| `.toast` | aviso flotante arriba, con `aria-live` |

`select` e `input[type=range]` llevan estilo propio sin necesitar clase adicional. Todo respeta `:active`, `:focus-visible` (anillo `--color-accent-2`) y `:disabled`; `prefers-reduced-motion: reduce` desactiva animaciones. Este módulo no define clases opcionales adicionales.
