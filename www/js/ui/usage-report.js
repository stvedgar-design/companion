// www/js/ui/usage-report.js
// TEL-001: pantalla "Exportar informe de uso" (Ajustes → Informe de uso). Junta el estado actual de cada
// personaje (recuerdos, relación, mensajes totales) con los eventos guardados por telemetry.js, arma el
// informe con `diagnostics/usage-report.js` (puro) y lo muestra en lenguaje llano — mismo patrón de
// "Copiar informe completo" / "Exportar como archivo" que ya usa `ui/diagnostics.js` (UI-005).

import { listCharacters, listChats, getChatMessages } from '../state.js';
import { relationshipSummary } from '../api/relationship.js';
import { listEvents } from '../telemetry.js';
import { buildUsageReport } from '../diagnostics/usage-report.js';
import { saveBlob } from '../platform.js';
import { APP_VERSION } from '../version.js';

const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

async function totalMessagesOf(characterId) {
  const chats = await listChats(characterId);
  let total = 0;
  for (const chat of chats) {
    const msgs = await getChatMessages(chat.id);
    if (Array.isArray(msgs)) total += msgs.length;
  }
  return total;
}

/** Junta lo que ya existe hoy (no viene de eventos): recuerdos actuales, relación actual, mensajes totales. */
async function gatherCharacters() {
  const characters = await listCharacters();
  return Promise.all(
    characters.map(async (c) => {
      const summary = relationshipSummary(c.lorebook || []);
      return {
        id: c.id,
        name: c.name,
        lorebookTotal: summary.total,
        lorebookAlways: (c.lorebook || []).filter((e) => e.always).length,
        relationshipLevel: summary.level,
        totalMessages: await totalMessagesOf(c.id),
      };
    })
  );
}

function reportBlob(report) {
  return new Blob([JSON.stringify(report.json, null, 2) + '\n\n' + report.text], { type: 'application/json' });
}

export async function openUsageReport(app) {
  const node = el('div', 'settings');
  node.append(el('h3', 'sheet__title', 'Informe de uso'));
  const loading = el('div', 'field__hint', 'Juntando los datos…');
  node.append(loading);
  app.openSheet(node);

  let report;
  try {
    const [events, characters] = await Promise.all([listEvents(), gatherCharacters()]);
    report = buildUsageReport({ events, characters, appVersion: APP_VERSION });
  } catch {
    loading.textContent = 'No se pudo armar el informe.';
    return;
  }
  if (!node.isConnected) return; // se cerró la hoja mientras se armaba

  loading.remove();
  const head = el('div', 'field__hint', report.head.join('\n'));
  head.style.whiteSpace = 'pre-line';
  node.append(head);

  for (const s of report.sections) {
    const sec = el('div', 'field');
    sec.append(el('label', 'field__label', s.title));
    const body = el('div', 'field__hint', s.lines.join('\n'));
    body.style.whiteSpace = 'pre-line';
    sec.append(body);
    node.append(sec);
  }

  const row = el('div', 'settings-row');
  const copy = el('button', 'btn btn--ghost btn--sm', 'Copiar informe completo');
  copy.type = 'button';
  copy.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(report.text);
      app.toast('Informe copiado.');
    } catch {
      app.toast('No se pudo copiar. Usa "Exportar como archivo".');
    }
  });
  const exp = el('button', 'btn btn--ghost btn--sm', 'Exportar como archivo');
  exp.type = 'button';
  exp.addEventListener('click', async () => {
    try {
      const d = new Date().toISOString().slice(0, 10);
      const { savedToDevice } = await saveBlob(reportBlob(report), `companion-uso-${d}.json`);
      if (savedToDevice) app.toast('Informe guardado en Documentos del teléfono.');
    } catch {
      app.toast('No se pudo exportar el informe.');
    }
  });
  row.append(copy, exp);
  node.append(row);
}
