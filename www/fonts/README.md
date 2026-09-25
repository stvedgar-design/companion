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
