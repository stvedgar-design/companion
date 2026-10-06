# Companion Fork progress

## Respaldo privado cifrado (2026-10-05)

- Implementado en `src/storage/private-backup.js`: respaldo cifrado local AES-256-GCM con contraseña derivada por PBKDF2-SHA-256 (310 000 iteraciones), salt/IV aleatorios y autenticación de integridad. Requiere 12 caracteres como mínimo; no se conserva contraseña.
- Archivo incluye workspace completo (ajustes, perfil/tag de usuario, borrador, personajes incluidas fotos, conversaciones/mensajes, memorias/tareas) y tema local. Solo descarga un archivo cifrado `.companion-backup`.
- Ajustes muestran contenido y explican privacidad/contraseña. Importación descifra y valida primero; luego permite combinar conservando datos/ajustes actuales o reemplazar con confirmación. La escritura del workspace usa una operación IndexedDB.
- Contrato 001 actualizado con estas decisiones y alcance implementado.
- Verificación: `node --check src/main.js`, `node --check src/storage/private-backup.js` y `npm run build:web` completaron correctamente. El recorrido real de descargas, contraseña, autenticación del archivo, restauración y UI móvil sigue necesitando validación en navegador/dispositivo.

## Episodios y continuidad v1 (2026-10-05)

- Workspace versión 4 migra sin borrar ni mover mensajes fuera del registro local: el historial anterior queda como episodio “First conversation”. Cada companion conserva episodios y última selección en IndexedDB; el catálogo permite continuar el actual o abrir la lista.
- Se puede iniciar un episodio nuevo desde un escenario. Empieza sin resumen ni tags mutables heredados; el prompt conserva semilla, perfil de apariencia compartido y recuerdos confirmados. Si la conexión falta o falla, el episodio queda y puede reintentarse al volver.
- Tras 24 mensajes aparece una acción explícita para crear/actualizar un resumen con `throughMessageId`; los mensajes originales siguen guardados. El prompt usa semilla + resumen del episodio activo + mensajes posteriores, con ventana máxima de 24 mensajes. Editar/eliminar dentro del tramo resumido invalida el resumen viejo.
- Cada episodio tiene tags de detalles/ropa editables que se inyectan solo en su prompt. La propuesta automática del companion y los tags por capa siguen pendientes; este editor manual no se declara cumplimiento del criterio 4 del contrato.
- La combinación de respaldos se actualizó para conservar episodios, mensajes, resúmenes y detalles, y el análisis previo cuenta todos los episodios, no solo el activo. Se añadió aviso de hacer backup antes de reinstalar o migrar dispositivo; IndexedDB local normalmente se borra al desinstalar Android.
- Verificación: `node --check` en `main.js`, `domain/workspace.js`, `llm/koboldcpp.js`, `storage/private-backup.js` y `npm run build:web` completaron correctamente. Sin servidor KoboldCpp/dispositivo no se validó apertura/resumen reales ni recorrido móvil.

## Feedback recibido (2026-10-05)

- Registrada en `contracts/CONTRACT-001/CONTRACT.md` la revisión con capturas: firma Android estable para actualizar, back nativo, companions adultos sin gate redundante, perfil de usuario global, plantillas de inicio según relación, ajustes de chat/conexión/respaldo separados y pulido del wizard.
- Corregido el conflicto en contrato y guía permanente sobre confirmar 18+: la decisión vigente es que todos los companions son adultos.
- Primera iteración de Pareto implementada: el perfil visual global y la escena dejaron de ocupar Appearance; se quitó el gate 18+ y los campos anatómicos redundantes. La relación inicial ahora propone un primer mensaje y ejemplo de diálogo; ambos, junto con la escena opcional, se pueden editar en Review y quedan incluidos al exportar.
- Diagnóstico de APK: `capacitor.config.json` mantiene `com.stvedgar.companionf`; los artefactos de CI tienen nombre estable, pero el workflow crea APK debug en runners efímeros y no configura una clave release persistente. El certificado puede cambiar en cada build, lo que impide actualizar una instalación previa. La solución de firma persistente es el primer bloque pendiente.
- Verificación de esta iteración: `node --check src/main.js`, `node --check src/domain/seed.js` y `npm run build:web` completaron correctamente. No se hizo recorrido visual ni prueba en Android.
- La navegación interna Atrás quedó implementada en la iteración siguiente; el botón físico aún necesita verificación en APK. La firma persistente sigue pendiente porque requiere una clave custodiada fuera del repositorio.

## Iteración Pareto siguiente

- Retirados el masthead y el pie web persistentes para que el shell use el espacio de app móvil; el tema pasa al menú de opciones del chat, junto al acceso a conexión.
- El chat muestra acciones por mensaje: editar y borrar; editar/borrar un turno de usuario elimina la respuesta dependiente hasta el siguiente mensaje del usuario. Se puede regenerar la respuesta final y recorrer versiones; alternativas e índice seleccionado se guardan en el mensaje local.
- Añadido historial de navegación para volver del chat y de ajustes a la vista interna previa, incluido Atrás/Escape.
- Verificación: `node --check src/main.js`, `node --check src/domain/seed.js` y `npm run build:web` completados. Falta revisar visualmente en viewport móvil, probar generación con KoboldCpp y verificar el botón físico Atrás en un APK Android.

## Integración del LLM de memoria

- Workspace subió primero a versión 3 con compatibilidad de modelo y después a versión 4 para episodios; la dirección previa `settings.serverUrl` se conserva como `settings.chatModel.url`; se añade `settings.memoryModel.url` (compatibilidad `memoryServerUrl`) y memoria/tareas locales por companion. Historial antiguo recibe IDs sin alterar su contenido y el cursor inicial evita reprocesar todo el chat histórico.
- Se añadió un adaptador de generación de memoria KoboldCpp, prueba independiente de la conexión y campo inicial `http://localhost:5002`. En Android, si KoboldCpp corre en la PC, el usuario debe poner la IP Tailscale de esa PC con puerto 5002; localhost es el teléfono.
- Tras tres intercambios completos se procesa una tarea diferida, acotada por lote; permanece guardada/reintentable tras errores y no bloquea el turno del chat. El resultado debe ser JSON con evidencia literal verificable. Propuestas quedan en Memory Review; solo las confirmadas se incluyen en el prompt principal con límite de 1 800 caracteres.
- El texto entre asteriscos ahora se muestra como gesto/acción visual con escape de HTML.
- El respaldo privado completo se implementó en la sección de progreso superior: incluye workspace, fotos, temas y restauración con análisis previo.
- Verificación de esta iteración: sintaxis de `main.js`, `domain/workspace.js`, `memory/manager.js` y `llm/koboldcpp.js`, más `npm run build:web`, completados. La conexión real al puerto 5002, la calidad de propuestas, render móvil y recuperación desde APK requieren prueba con el servidor y dispositivo del usuario.

## Completed

- Responsive, self-contained mobile web shell, warm light/dark themes, and Capacitor configuration.
- English-first character wizard with seven identity steps plus an eighth review dashboard, autosaved draft recovery, and back navigation.
- Guided personality and temperament chips with a three-trait limit (including custom traits). The name, Male/Female selection, and general clothing-style guide are required; other details may remain undefined.
- Custom trait entry and optional scene, greeting, dialogue-example, appearance, and user-profile fields show example wording. Permanent traits are explicitly distinguished from the user's profile and from scene details.
- User appearance chips remain in the private app profile and are excluded from the character export.
- Domain mapping and JSON download for Character Card V2 (`chara_card_v2`, spec version 2.0), plus avatar PNG export with embedded `chara` metadata.
- Companion catalog with persistent character cards, plus a basic per-character conversation screen.
- KoboldCpp settings for server URL, user name, reply length, temperature, and context length. Connection test uses `/api/v1/model`; chat generation uses `/api/v1/generate`.
- Messages are saved locally before generation. A failed or interrupted generation keeps the user's message and offers a retry when the conversation is reopened.
- Workspace record migration keeps an existing saved seed from the creator-only prototype and places it into the catalog.
- Updated product guidance in `chatgpt.md` and `contracts/CONTRACT-001/CONTRACT.md` to make English the initial UI/content language and reserve the Spanish label «IDIOMA DE LA INTERFAZ» for the language preference.
- Added a visible `file://` fallback, `start-preview.sh`, and a localhost server that picks an available port from 4173–4189 and remembers it so browser storage stays on the same origin.
- Added a Capacitor package manifest, npm lockfile, web-asset staging script, and GitHub Actions workflow for a downloadable debug APK artifact on `main`/manual runs and an APK attached to `v*` releases.
- Published the project source, product contract, preview/build scripts, and Android APK workflow to the public `stvedgar-design/CompanionF` repository.
- Built and uploaded the first Android debug APK successfully with GitHub Actions (`run 18`, commit `a07eb99`). The artifact `companion-debug-apk` is available until 2026-11-04; tagged `v*` releases will also attach the APK automatically.
- Changed the Android application ID to `com.stvedgar.companionf` and launcher name to `Companion Fork` to keep this app separate from the original Companion install. The workflow now labels the APK `Companion-Fork-debug.apk`.
- Rebuilt the renamed app successfully with GitHub Actions (`run 24`, commit `e69b8fe`). The new `companion-fork-debug-apk` artifact is available until 2026-11-04; install this APK alongside the original app.
- Replaced the Android HTTP/mixed-content warning path with Capacitor's native HTTP bridge for installed apps and enabled the Android cleartext permission required by the user-configured KoboldCpp HTTP endpoint. Browser-only HTTPS pages retain an accurate browser restriction message.
- An earlier creator revision had five steps; it has since been superseded by the user-approved eight-part identity and review flow listed above.
- Rebuilt chat as a full app conversation view without the website masthead, with a character identity bar, welcome prompts, calmer message bubbles, and a dedicated composer.
- Replaced the earlier five-step character creator with the requested seven identity sections plus an eighth Companion Review dashboard: Who are they?, Core personality, Temperament, Starting relationship, Life outside chat, Voice, Appearance, and review. Gender is limited to Male/Female; core personality and temperament enforce a three-trait limit, including custom chips.
- Organized appearance into hair length, body type, skin tone, eye color, hair color, and additional details. Clothing style is a required, user-written general guide, with copy explaining that it guides model choices without locking each outfit. Optional intimate appearance details stay hidden unless the character is marked 18+.
- Mapped the selected identity cues into Character Card V2 `description`/`personality` plus the namespaced `companionf/identity-seed` extension; the same identity cues are sent to the KoboldCpp prompt. The user's appearance profile remains separate and excluded from the character card.
- Added profile photo selection in Companion Review, local square-image storage, and display in the catalog/chat. A PNG export embeds the V2 card JSON in the standard `chara` PNG text chunk; JSON export remains available separately.
- Updated CONTRACT-001 with the approved creator sequence, structured seed-to-card mapping, photo/export behavior, and adult-only appearance gate.
- Corrected the permanent product guidance so its opening summary also agrees with English-first UI.
- GitHub Actions run 26 (`2292813`) successfully built the updated APK after syncing Capacitor and applying the HTTP manifest permission. The artifact remains available until 2026-11-04 at the run's Artifacts section.
- GitHub Actions run 28 (`7908ce2`) successfully built the new identity wizard APK. Download artifact `companion-fork-debug-apk` (artifact ID `11322976175`) from [run 28](https://github.com/stvedgar-design/CompanionF/actions/runs/37255869171); it expires 2026-11-04.
- GitHub Actions run 29 (`6381c7d`) built the creator/persistence refinements; run 31 includes the final aligned eight-step progress indicator. Its APK artifact `companion-fork-debug-apk` (artifact ID `11322498753`) is available from [run 31](https://github.com/stvedgar-design/CompanionF/actions/runs/37256445460) until 2026-11-04.

## Decisions

- No framework, bundler, remote fonts, or external services. `tools/build-web.py` stages only HTML/CSS/JS in `www/`, the Capacitor web root, so Android packaging does not recursively include repo metadata or installed dependencies.
- Direct `file://` opening displays preview instructions because browser module imports and local storage require a web origin; `./start-preview.sh` starts a local-only server and opens the app.
- Character card output uses the V2 envelope and standard fields. Empty optional fields stay empty; structured creator selections are also preserved in the `companionf/identity-seed` extension. The user's appearance profile and photo bytes are not in JSON export; photo cards export as PNG with the `chara` V2 payload.
- Existing workspace changes outside this fork were preserved.

## Verification

- `node --check src/main.js`, `node --check src/domain/seed.js`, and `node --check src/storage/local-store.js` passed.
- JavaScript syntax checks passed for the workspace model and KoboldCpp adapter. Python preview/build launchers and `npm run build:web` staging completed.
- Direct Node assertions passed for name-only validation, the `chara_card_v2`/2.0 envelope, and keeping blank optional appearance/personality fields empty in export.
- Opened the updated catalog at `http://127.0.0.1:4175/` in the in-app browser and confirmed the empty companion state renders. Inspected connection settings and confirmed an empty address gives an actionable message. The current view is left open.
- A localhost server could not bind under the default sandbox. The user approved the launcher, and its browser preview loaded. The launcher must be run again in a terminal after this session ends. Mobile-width visual review and a full interactive export walkthrough remain unverified.
- `python3 -m py_compile tools/preview.py` and `sh -n start-preview.sh` passed.
- `npm install --package-lock-only --ignore-scripts --no-audit --no-fund` completed and produced the lockfile.
- `npm run build:web` and JavaScript syntax checks passed after the current chat changes.
- Latest creator implementation: `node --check src/main.js`, `node --check src/domain/seed.js`, and `node --check src/llm/koboldcpp.js` passed; `npm run build:web` staged the updated web app successfully.
- Walked the updated app in the browser at `http://127.0.0.1:4175/`: confirmed the English UI, the eight-part numbering, Male/Female-only gender, the Core personality and Temperament chip sections, and the live three-choice personality limit. Continued through Appearance and confirmed the review dashboard groups the selected seed fields and requires an explicit general clothing description. The temporary walkthrough draft was cleared afterward.
- Reloaded the cleaned preview and confirmed the first section now reads `01 / 08` and `Step 1 of 8`; the creator is left open and ready to use at `http://127.0.0.1:4175/`.
- Actual photo upload and generated PNG metadata have not yet been exercised end-to-end; the UI and export implementation are present. A generated response from the user's KoboldCpp server remains unverified because the configured `localhost:5001` endpoint was unavailable from this environment.
- `npm run build:web` completed and the current app source was staged. The live preview walkthrough confirmed the eight-part flow and the three-trait interaction limit; domain assertions verified gender/adult validation, blank optional values, identity extension fields, V2 field mapping, and that the same seed cues reach the KoboldCpp prompt.
- `python3 -m py_compile tools/allow-kobold-http.py` passed. The local build directory was staged after the creator, chat, and network changes.
- The shared test endpoint `http://localhost:5001/api/v1/model` was unavailable from this environment (connection refused); the native HTTP route and real KoboldCpp reply therefore still need an on-device test with KoboldCpp/Tailscale running. The browser warning is now limited to actual secure-page web previews; Capacitor Android uses its native HTTP bridge.

## Remaining / recommended next step

- Open the preview using `./start-preview.sh` (keep its terminal window open); visually inspect the 360–430 px flow, language control, chips, saved draft, and download behavior.
- Connect to the user's actual KoboldCpp address and verify a real generated reply; no server URL was provided, so the actual model response remains unverified.
- Add automated coverage for V2 export, persistence/migrations, KoboldCpp protocol, and domain rules.
- Next user-prioritized milestone: propose and track clothing state by layer within each episode; then complete durable-memory review/threshold policy and character-card import. Validate backup and episode flows on mobile/browser as devices and KoboldCpp become available.
- Test the APK on an Android device/emulator and verify it can reach the user's KoboldCpp server; those environments and the server address are not available from this workspace.
- Review the refreshed creator and chat screens at 360–430 px and on-device; the browser walkthrough was desktop-sized, and Android device verification is still pending.
- Exercise photo upload and inspect the exported PNG's `chara` metadata with a compatible Character Card V2 reader; then install the new APK on Android and verify its server connection and saved character data.
