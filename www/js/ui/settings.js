// www/js/ui/settings.js
// Hoja de ajustes de la app (se abre desde el engranaje del hub; UI-025: ya NO se abre desde el menú ⋮ de un chat).
// Recibe todo lo global: servidor, nombre, formato, PIN, apariencia, copia de seguridad y diagnóstico. Agrupada con los
// encabezados `.menu-group` de UI-019.
// UI-011: los deslizadores de longitud (Settings.maxLen) y creatividad (Settings.temp) se quitaron
// de la pantalla; los campos siguen en state.js y api/kobold.js los sigue enviando igual.

import { getSettings, saveSettings, exportBackup, MESSAGE_FONT_SIZES, CHAT_AVATAR_SIZES } from '../state.js';
import { connect } from '../api/kobold.js';
import { pickFiles, saveBlob } from '../platform.js';
import { createPinHash, verifyPin } from '../lock.js';
import { openAppearance } from './appearance.js';
import { applyMessageFontSize, applyChatAvatarSize } from './shell.js';
import { APP_VERSION } from '../version.js';
import { runFluencyTest, FLUENCY_SECONDS } from './fluency.js';
import { openDiagnostics } from './diagnostics.js';
import { logEvent, TEL_EVENTS } from '../telemetry.js';
import { openUsageReport } from './usage-report.js';
import { startImport } from './backup-import.js';
import { getPersistenceResult, describePersistence } from '../persist.js';

// UI-038: los dos controles de tamaño (texto y foto junto a los mensajes) usan las mismas tres etiquetas, en el orden de
// MESSAGE_FONT_SIZES (state.js: 15, 17, 19) y CHAT_AVATAR_SIZES (small, medium, large).
const SIZE_LABELS = ['Pequeño', 'Mediano', 'Grande'];

export function openSettings(app) {
  const node = document.createElement('div');
  node.className = 'settings';
  node.innerHTML = `
    <h3 class="sheet__title">Ajustes</h3>

    <div class="settings-search">
      <input class="inp" id="settings-search" type="search" inputmode="search" autocomplete="off"
             placeholder="Buscar en Ajustes" aria-label="Buscar en Ajustes">
    </div>
    <div class="field__hint" id="settings-search-empty" hidden>No encontré nada con ese nombre.</div>

    <div class="menu-group" aria-hidden="true">Conexión</div>
    <div class="field">
      <label class="field__label" for="settings-url">Servidor</label>
      <div class="settings-row">
        <input class="inp" id="settings-url" type="url" inputmode="url"
               autocapitalize="off" autocorrect="off" autocomplete="off" spellcheck="false">
        <button class="btn btn--ghost btn--sm" id="settings-test" type="button">Probar</button>
      </div>
      <div class="status" id="settings-status"></div>
    </div>

    <div class="field">
      <label class="field__label" for="settings-user">Tu nombre en el chat</label>
      <input class="inp" id="settings-user" type="text" autocomplete="off">
    </div>

    <div class="menu-group" aria-hidden="true">Conversación</div>
    <div class="field">
      <label class="field__label" for="settings-mode">Formato del prompt</label>
      <select class="inp" id="settings-mode">
        <option value="chat">Plantilla del modelo (recomendado)</option>
        <option value="plain">Texto simple</option>
      </select>
      <div class="field__hint">Plantilla del modelo suele dar mejores respuestas de roleplay. Si tu modelo responde raro con esa opción, probá con "Texto simple", que funciona igual con cualquier modelo pero sin su plantilla de chat.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-variety" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Ayuda a que las respuestas no se repitan</span>
      </label>
      <div class="field__hint">Si tu personaje empieza a repetir las mismas palabras o temas, la siguiente respuesta lleva una nota breve pidiéndole variar. No hace el chat más lento.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-human-touch" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Detalles de presencia humana</span>
      </label>
      <div class="field__hint">El personaje tiene un ánimo que cambia con la hora, el día y lo que escribes (se ve bajo su nombre, en el chat). Sus respuestas varían de largo, siempre en un solo párrafo; a veces nota que llevas días sin escribirle, que hoy escribes más corto o que es muy tarde; a veces una respuesta larga llega partida en dos mensajes, y antes de contestar hace una pausa de "escribiendo". No hace el chat más lento (salvo una pausa de uno o dos segundos cuando el servidor responde muy rápido).</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-emotion-response" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Reaccionar a cómo te sientes</span>
      </label>
      <div class="field__hint">Si estás triste, estresado, enojado, feliz, orgulloso, asustado, cansado o cariñoso, el personaje lo nota por lo que escribes y cambia de registro a su manera: te acompaña de cerca si estás mal, celebra contigo si estás bien. No hace el chat más lento. Funciona junto con "Detalles de presencia humana".</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-personality-adapts" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Personalidad que se adapta a la escena</span>
      </label>
      <div class="field__hint">La personalidad del personaje es su punto de partida, no un guion: a medida que crece la confianza y la escena avanza, se abre, toma la iniciativa o cambia de ritmo, sin dejar de ser quien es. Vale para todos tus personajes, también los que ya tenías. Si prefieres que sigan su personalidad al pie de la letra, apágalo. No hace el chat más lento.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-format" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Corregir formato automáticamente</span>
      </label>
      <div class="field__hint">Cada respuesta empieza ya dentro de una acción en cursiva, y si llega con asteriscos mal puestos pero con el diálogo entre comillas, se muestra bien (diálogo normal, el resto en cursiva). Los mensajes sin asteriscos ni comillas no se tocan. No hace el chat más lento.</div>
    </div>

    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-feelings" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Sentimientos del personaje</span>
      </label>
      <div class="field__hint">Cuando una respuesta usa 3 o más recuerdos, el personaje elige en su propia voz una palabra de una lista fija ("sintiendo nostalgia", junto a la hora). Es una llamada corta aparte, después de mostrar la respuesta: no la retrasa. Apagado por defecto.</div>
    </div>

    <div class="menu-group" aria-hidden="true">Seguridad</div>
    <div class="field">
      <label class="field__label">Bloqueo con PIN</label>
      <div id="settings-pin-body"></div>
    </div>

    <div class="menu-group" aria-hidden="true">Apariencia</div>
    <div class="field">
      <div class="field__label">Tamaño del texto de los mensajes</div>
      <div class="appearance-skins" id="settings-fontsize">
        ${MESSAGE_FONT_SIZES.map((px, i) => `<button class="appearance-skin" type="button" data-size-value="${px}">${SIZE_LABELS[i]}</button>`).join('')}
      </div>
      <div class="field__hint">Solo cambia el tamaño de la letra; el ancho de las burbujas no cambia.</div>
    </div>
    <div class="field">
      <div class="field__label">Tamaño de la foto junto a los mensajes</div>
      <div class="appearance-skins" id="settings-avatarsize">
        ${CHAT_AVATAR_SIZES.map((size, i) => `<button class="appearance-skin" type="button" data-avatar-size="${size}">${SIZE_LABELS[i]}</button>`).join('')}
      </div>
      <div class="field__hint">La foto del personaje que aparece al lado de sus mensajes. Crece o se achica junto con el tamaño del texto.</div>
    </div>
    <div class="field">
      <label class="field__label" style="display:flex;align-items:center;gap:var(--space-2, 8px)">
        <input type="checkbox" id="settings-stream" style="accent-color:var(--color-accent, #8b1fe0)">
        <span>Ver la respuesta mientras se escribe</span>
      </label>
      <div class="field__hint">Encendido: el texto va apareciendo poco a poco. Apagado: ves los puntos de "escribiendo…" y la respuesta llega completa de una vez, como en una app de mensajería. El botón de detener sigue funcionando y no cambia la velocidad.</div>
    </div>
    <div class="field">
      <label class="field__label">Aspecto de la app</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-appearance" type="button">Modo claro/oscuro y tipografía</button>
      </div>
      <div class="field__hint">El fondo del chat es por personaje: se cambia desde su ficha (toca el nombre del personaje dentro de un chat).</div>
    </div>

    <div class="menu-group" aria-hidden="true">Datos</div>
    <div class="field">
      <label class="field__label">Copia de seguridad</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-export" type="button">Exportar copia</button>
        <button class="btn btn--ghost btn--sm" id="settings-import" type="button">Importar copia</button>
      </div>
    </div>

    <div class="menu-group" aria-hidden="true">Avanzado</div>
    <div class="field__hint" id="settings-persist">${describePersistence(getPersistenceResult())}</div>
    <div class="field">
      <label class="field__label">Prueba de fluidez</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-fluency" type="button">Medir fluidez (${FLUENCY_SECONDS} s)</button>
      </div>
      <div class="field__hint">Desliza el chat solo durante unos segundos y mide qué tan fluido va. Si tienes un chat abierto lo usa; si no, uno de prueba. No se envía nada a ningún lado.</div>
      <div class="field__hint" id="settings-fluency-result" hidden style="white-space:pre-line"></div>
      <div class="settings-row" id="settings-fluency-copyrow" hidden>
        <button class="btn btn--ghost btn--sm" id="settings-fluency-copy" type="button">Copiar resultado</button>
      </div>
    </div>

    <div class="field">
      <label class="field__label">Diagnóstico y rendimiento</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-diag" type="button">Abrir diagnóstico</button>
      </div>
      <div class="field__hint">Prueba de estrés con datos inventados para medir qué tan fluida va la app en este teléfono.</div>
    </div>

    <div class="field">
      <label class="field__label">Informe de uso</label>
      <div class="settings-row">
        <button class="btn btn--ghost btn--sm" id="settings-usage-report" type="button">Exportar informe de uso</button>
      </div>
      <div class="field__hint">Cuántos recuerdos, resúmenes y mensajes hubo, y qué ajustes probaste — solo números y fechas, nunca el texto de tus chats. Registrado desde que esta función se activó, no antes. Nada sale del teléfono salvo que tú lo exportes.</div>
    </div>

    <div class="settings-version">Companion v${APP_VERSION}</div>
  `;

  const q = (sel) => node.querySelector(sel);
  const els = {
    url: q('#settings-url'),
    test: q('#settings-test'),
    status: q('#settings-status'),
    user: q('#settings-user'),
    mode: q('#settings-mode'),
    variety: q('#settings-variety'),
    humanTouch: q('#settings-human-touch'),
    emotionResponse: q('#settings-emotion-response'),
    personalityAdapts: q('#settings-personality-adapts'),
    format: q('#settings-format'),
    stream: q('#settings-stream'),
    feelings: q('#settings-feelings'),
    pinBody: q('#settings-pin-body'),
    fontSizeBtns: Array.from(node.querySelectorAll('#settings-fontsize [data-size-value]')),
    avatarSizeBtns: Array.from(node.querySelectorAll('#settings-avatarsize [data-avatar-size]')),
    appearanceBtn: q('#settings-appearance'),
    exportBtn: q('#settings-export'),
    importBtn: q('#settings-import'),
    search: q('#settings-search'),
    searchEmpty: q('#settings-search-empty'),
    diag: q('#settings-diag'),
    usageReport: q('#settings-usage-report'),
    fluency: q('#settings-fluency'),
    fluencyResult: q('#settings-fluency-result'),
    fluencyCopyRow: q('#settings-fluency-copyrow'),
    fluencyCopy: q('#settings-fluency-copy'),
  };

  getSettings().then((settings) => {
    els.url.value = settings.url;
    els.user.value = settings.user;
    els.mode.value = settings.mode;
    els.variety.checked = settings.varietyAssist === true;
    els.humanTouch.checked = settings.humanTouch !== false;
    els.emotionResponse.checked = settings.emotionResponse !== false;
    els.personalityAdapts.checked = settings.personalityAdapts !== false;
    els.format.checked = settings.formatAssist !== false;
    els.stream.checked = settings.streamReplies !== false;
    els.feelings.checked = settings.feelingsEnabled === true;
    renderPinBody(settings);
    renderFontSize(settings.messageFontSize);
    renderAvatarSize(settings.chatAvatarSize);
  });

  function renderFontSize(px) {
    els.fontSizeBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', Number(btn.dataset.sizeValue) === px);
    });
  }

  els.fontSizeBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const messageFontSize = Number(btn.dataset.sizeValue);
      renderFontSize(messageFontSize); // vista previa inmediata, antes de que termine de guardar
      applyMessageFontSize(messageFontSize);
      await saveSettings({ messageFontSize });
    });
  });

  function renderAvatarSize(size) {
    els.avatarSizeBtns.forEach((btn) => {
      btn.classList.toggle('appearance-skin--active', btn.dataset.avatarSize === size);
    });
  }

  els.avatarSizeBtns.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const chatAvatarSize = btn.dataset.avatarSize;
      renderAvatarSize(chatAvatarSize); // vista previa inmediata, antes de que termine de guardar
      applyChatAvatarSize(chatAvatarSize);
      await saveSettings({ chatAvatarSize });
    });
  });

  function renderPinBody(settings) {
    if (settings.pinHash) {
      els.pinBody.innerHTML = `
        <div class="status status--ok">Bloqueo activado: te va a pedir el PIN cada vez que abras la app.</div>
        <div class="settings-row">
          <input class="inp" id="pin-current" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN actual, para desactivar">
          <button class="btn btn--sm btn--danger" id="pin-deactivate" type="button">Desactivar</button>
        </div>
      `;
      const current = q('#pin-current');
      const deactivateBtn = q('#pin-deactivate');
      deactivateBtn.addEventListener('click', async () => {
        const ok = await verifyPin(current.value, settings.pinSalt, settings.pinHash);
        if (!ok) {
          app.toast('PIN incorrecto.');
          return;
        }
        settings = await saveSettings({ pinSalt: '', pinHash: '' });
        renderPinBody(settings);
        app.toast('Bloqueo desactivado.');
      });
    } else {
      els.pinBody.innerHTML = `
        <div class="settings-row">
          <input class="inp" id="pin-new" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN nuevo (4 o más dígitos)">
        </div>
        <div class="settings-row">
          <input class="inp" id="pin-confirm" type="password" inputmode="numeric" autocomplete="off" placeholder="Repetir PIN">
          <button class="btn btn--ghost btn--sm" id="pin-activate" type="button">Activar</button>
        </div>
        <div class="field__hint">Opcional. Si lo activás, no hay forma de recuperarlo si lo olvidás: tendrías que borrar los datos de la app (y perder los personajes/episodios) para volver a entrar.</div>
      `;
      const pinNew = q('#pin-new');
      const pinConfirm = q('#pin-confirm');
      const activateBtn = q('#pin-activate');
      activateBtn.addEventListener('click', async () => {
        const pin = pinNew.value;
        if (pin.length < 4) {
          app.toast('El PIN tiene que tener al menos 4 dígitos.');
          return;
        }
        if (pin !== pinConfirm.value) {
          app.toast('Los dos PIN no coinciden.');
          return;
        }
        activateBtn.disabled = true;
        try {
          const { salt, hash } = await createPinHash(pin);
          settings = await saveSettings({ pinSalt: salt, pinHash: hash });
          renderPinBody(settings);
          app.toast('Bloqueo activado.');
        } catch (err) {
          app.toast('No se pudo activar el bloqueo.');
        } finally {
          activateBtn.disabled = false;
        }
      });
    }
  }

  els.user.addEventListener('input', () => {
    saveSettings({ user: els.user.value.trim() });
  });

  els.mode.addEventListener('change', () => {
    saveSettings({ mode: els.mode.value });
  });

  els.variety.addEventListener('change', () => {
    saveSettings({ varietyAssist: els.variety.checked });
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'varietyAssist', enabled: els.variety.checked });
  });

  els.humanTouch.addEventListener('change', () => {
    saveSettings({ humanTouch: els.humanTouch.checked });
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'humanTouch', enabled: els.humanTouch.checked });
  });

  els.emotionResponse.addEventListener('change', () => {
    saveSettings({ emotionResponse: els.emotionResponse.checked });
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'emotionResponse', enabled: els.emotionResponse.checked });
  });

  els.personalityAdapts.addEventListener('change', () => {
    saveSettings({ personalityAdapts: els.personalityAdapts.checked });
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'personalityAdapts', enabled: els.personalityAdapts.checked });
  });

  els.stream.addEventListener('change', () => {
    saveSettings({ streamReplies: els.stream.checked });
  });

  els.format.addEventListener('change', () => {
    saveSettings({ formatAssist: els.format.checked });
    logEvent(TEL_EVENTS.EXPERIMENTAL_SETTING_CHANGED, { setting: 'formatAssist', enabled: els.format.checked });
  });

  els.feelings.addEventListener('change', () => {
    saveSettings({ feelingsEnabled: els.feelings.checked });
  });

  els.appearanceBtn.addEventListener('click', () => {
    openAppearance(app);
  });

  els.test.addEventListener('click', async () => {
    els.status.className = 'status';
    els.status.textContent = 'Conectando…';
    els.test.disabled = true;
    try {
      const { url, model, ctx } = await connect(els.url.value);
      await saveSettings({ url, ctx });
      els.status.className = 'status status--ok';
      els.status.textContent = 'Conectado: ' + model;
    } catch (err) {
      els.status.className = 'status status--err';
      els.status.textContent = err.message;
    } finally {
      els.test.disabled = false;
    }
  });

  els.diag.addEventListener('click', () => openDiagnostics(app));
  els.usageReport.addEventListener('click', () => openUsageReport(app));

  // UI-001: mide la fluidez del desplazamiento (ver ui/fluency.js). Nada sale del teléfono.
  let fluencyText = '';
  els.fluency.addEventListener('click', async () => {
    els.fluency.disabled = true;
    els.fluencyCopyRow.hidden = true;
    els.fluencyResult.hidden = false;
    els.fluencyResult.textContent = `Midiendo… no toques la pantalla durante ${FLUENCY_SECONDS} segundos.`;
    try {
      const { text } = await runFluencyTest({ host: node });
      fluencyText = text;
      els.fluencyResult.textContent = text;
      els.fluencyCopyRow.hidden = false;
    } catch (err) {
      els.fluencyResult.textContent = 'No se pudo hacer la prueba.';
    } finally {
      els.fluency.disabled = false;
    }
  });

  els.fluencyCopy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(fluencyText);
      app.toast('Resultado copiado.');
    } catch (err) {
      app.toast('No se pudo copiar. Puedes seleccionar el texto y copiarlo a mano.');
    }
  });

  els.exportBtn.addEventListener('click', async () => {
    els.exportBtn.disabled = true;
    try {
      const blob = await exportBackup();
      const date = new Date().toISOString().slice(0, 10);
      const { savedToDevice } = await saveBlob(blob, `companion-copia-${date}.json`);
      if (savedToDevice) app.toast('Copia guardada en Documentos del teléfono.');
    } catch (err) {
      app.toast(err.message || 'No se pudo exportar la copia.');
    } finally {
      els.exportBtn.disabled = false;
    }
  });

  // BKP-001: importar NUNCA escribe sin que el usuario vea qué trae la copia y elija (ver ui/backup-import.js).
  els.importBtn.addEventListener('click', async () => {
    const files = await pickFiles();
    if (!files.length) return;
    els.importBtn.disabled = true;
    try {
      await startImport(app, files[0]);
    } finally {
      els.importBtn.disabled = false;
    }
  });

  // UI-035: buscador de Ajustes. Solo cambia qué se VE (ningún control cambia de comportamiento): cada
  // hijo directo de `node` entre un ".menu-group" y el siguiente es "su" contenido (un `.field` normal,
  // o un texto suelto como `#settings-persist`); se oculta si su texto visible no matchea, sin distinguir
  // mayúsculas ni acentos. El encabezado del grupo se oculta si NINGUNO de sus controles matcheó.
  els.search.addEventListener('input', () => applySettingsFilter(els.search.value));

  function applySettingsFilter(raw) {
    const q = normalizeForSearch(raw).trim();
    const searchWrap = els.search.closest('.settings-search');
    let currentGroup = null;
    let groupMatched = false;
    let anyMatch = false;
    const finishGroup = () => {
      if (currentGroup) currentGroup.hidden = !groupMatched;
    };
    for (const child of Array.from(node.children)) {
      if (child === searchWrap || child === els.searchEmpty) continue;
      if (child.classList.contains('menu-group')) {
        finishGroup();
        currentGroup = child;
        groupMatched = false;
        continue;
      }
      if (child.classList.contains('settings-version')) {
        child.hidden = false; // pie de página, no es un control: siempre visible
        continue;
      }
      if (!currentGroup) continue; // el título "Ajustes" y el buscador van antes de cualquier grupo
      const match = !q || normalizeForSearch(child.textContent).includes(q);
      child.hidden = !match;
      if (match) {
        groupMatched = true;
        anyMatch = true;
      }
    }
    finishGroup();
    els.searchEmpty.hidden = !q || anyMatch;
  }

  app.openSheet(node);
}

/** Minúsculas y sin acentos, para que el buscador de Ajustes no distinga mayúsculas ni tildes. */
export function normalizeForSearch(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}
