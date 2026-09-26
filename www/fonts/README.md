# Fuentes incluidas en la app

**Literata** (romana e itálica reales; pesos 400, 500 y 600; subconjuntos `latin` y `latin-ext`), en `woff2`.

- **Origen:** paquete npm público `@fontsource/literata` versión **5.3.0** (registro de npm), que empaqueta las fuentes de https://github.com/googlefonts/literata.
  Archivos sin modificar, tal como salen del paquete. Obtenidos el 2026-09-25.
- **Licencia:** SIL Open Font License, Versión 1.1 (`OFL-Literata.txt`, copiada del paquete). Copyright 2017 The Literata Project Authors.
  La OFL permite incluir la fuente en una app y redistribuirla junto con el software, sin venderla por separado y conservando este aviso de licencia. No declara un "Reserved Font Name".
- **Uso:** `@font-face` en `css/tokens.css`. El skin iMessage usa la fuente del sistema, no esta.
- **Peso total:** 12 archivos, ~239 KB (el aumento del APK).
- Cirílico, griego y vietnamita no están incluidos: esos caracteres caen a la fuente de respaldo (`Georgia`, serif del sistema).

| Archivo | Bytes | SHA-256 (inicio) |
|---|---|---|
| `literata-latin-400-italic.woff2` | 21148 | `1e98bfbbb4eb8177…` |
| `literata-latin-400-normal.woff2` | 20420 | `a60c193b55766b68…` |
| `literata-latin-500-italic.woff2` | 22640 | `cecd19a63bdb6252…` |
| `literata-latin-500-normal.woff2` | 21712 | `29f2713a2f91da89…` |
| `literata-latin-600-italic.woff2` | 22824 | `40f5571322fdd95c…` |
| `literata-latin-600-normal.woff2` | 21860 | `99284fd89c86b8c5…` |
| `literata-latin-ext-400-italic.woff2` | 17576 | `3c5b9d0314198a54…` |
| `literata-latin-ext-400-normal.woff2` | 17616 | `726e1239ef9ece4c…` |
| `literata-latin-ext-500-italic.woff2` | 18216 | `adfa20b53f4ab065…` |
| `literata-latin-ext-500-normal.woff2` | 18144 | `fa2ecef926a23695…` |
| `literata-latin-ext-600-italic.woff2` | 18260 | `a3082ac82225f7fb…` |
| `literata-latin-ext-600-normal.woff2` | 18260 | `8f67d8ebdfa30295…` |

## Fuentes por skin (UI-015)

Tres familias más, una por skin, para que cada uno tenga su propia voz. Todas **variables** (eje de peso 400-700: un archivo cubre los pesos 400/500/600 que usa la app), con romana e itálica REALES (no sintetizadas), subconjuntos `latin` y `latin-ext`, en `woff2`.

- **Origen:** paquetes npm públicos `@fontsource-variable/lora`, `@fontsource-variable/source-serif-4` y `@fontsource-variable/figtree`, todos versión **5.3.0** (registro de npm). Archivos sin modificar. Obtenidos el 2026-09-26.
- **Licencia:** SIL Open Font License 1.1 en los tres (`OFL-Lora.txt`, `OFL-Source-Serif-4.txt`, `OFL-Figtree.txt`, copiadas de cada paquete). Lora, Source Serif y Figtree: copyright de sus respectivos autores (ver cada archivo). Se incluyen sin modificar y sin venderse por separado.
- **Asignación:** Nomi → Literata (sin cambios) · Glass → Figtree (sans) · Penumbra → Lora · Penumbra Claude → Source Serif 4 · iMessage → fuente del sistema. `@font-face` en `css/tokens.css`; la elección por skin, en el token `--font` de `css/themes.css`.
- **Peso agregado:** 12 archivos, 370 156 bytes (~361 KB) → sube el APK en ~361 KB (Literata ya pesaba ~239 KB).

| Archivo | Bytes | SHA-256 (inicio) |
|---|---|---|
| `figtree-latin-ext-wght-italic.woff2` | 10376 | `a0cc105b3241fe95…` |
| `figtree-latin-ext-wght-normal.woff2` | 10280 | `bf7828e2c258cffc…` |
| `figtree-latin-wght-italic.woff2` | 20928 | `7242fa62d13d4617…` |
| `figtree-latin-wght-normal.woff2` | 20156 | `4ba7d3d096695818…` |
| `lora-latin-ext-wght-italic.woff2` | 21128 | `45f989df83f3a9f4…` |
| `lora-latin-ext-wght-normal.woff2` | 20088 | `2a2d9c22c9863086…` |
| `lora-latin-wght-italic.woff2` | 40772 | `d824d807d4d832d1…` |
| `lora-latin-wght-normal.woff2` | 37788 | `ddb8c66035104e23…` |
| `source-serif-4-latin-ext-wght-italic.woff2` | 44260 | `515639854d3566c4…` |
| `source-serif-4-latin-ext-wght-normal.woff2` | 42040 | `41529a5b38008d9e…` |
| `source-serif-4-latin-wght-italic.woff2` | 51516 | `663e7ef3037a56dc…` |
| `source-serif-4-latin-wght-normal.woff2` | 50824 | `c1df4596be502923…` |
