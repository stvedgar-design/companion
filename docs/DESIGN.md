# DESIGN.md — lenguaje visual de Companion

**Principios:** una sola cosa memorable (el morado); el resto discreto. Fondo
azul-noche, superficies sobrias, bordes muy redondeados, mucho aire. Sin
sombras ni degradados fuera de `--grad-user`/`--grad-avatar`. Cuerpo del chat
a 17px; campos de formulario a 16px mínimo (evita el zoom de Android). Todo
cabe en 360px sin scroll horizontal.

## Tokens (`tokens.css`)

| Token | Uso |
|---|---|
| `--color-bg` | fondo de toda la app |
| `--color-surface` | tarjetas, filas en `:active`, campos |
| `--color-surface-2` | burbuja del personaje, hover de menu-item |
| `--color-line` | bordes y separadores |
| `--color-text` | texto principal |
| `--color-muted` | texto secundario, ayudas, placeholders |
| `--color-accent` | acento morado: botones primarios |
| `--color-accent-2` | morado claro: `:active` y anillo de foco |
| `--color-accent-soft` | fondos suaves de acento (uso opcional) |
| `--color-danger` | errores, acciones destructivas |
| `--color-ok` | estados correctos |
| `--color-overlay` | capa oscura detrás de la hoja inferior |
| `--color-muted-on-accent` | *asteriscos* sobre una superficie con acento (hoy: burbuja del usuario) |
| `--grad-user` | degradado de la burbuja del usuario |
| `--grad-avatar` | degradado del avatar por defecto |
| `--font` | familia Literata (serif) + fallback de sistema — cambiado desde Outfit el 2026-09-23, a pedido del usuario, buscando una lectura más elegante/académica en pantalla |
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
