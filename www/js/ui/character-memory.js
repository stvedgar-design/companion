// www/js/ui/character-memory.js
// MEM-017: "Memoria de {Nombre}" — una sola pantalla con el estado de la relación (protagonista), el resumen del
// episodio y los recuerdos como tarjetas, con acceso a los archivados. Es una FACHADA visual: no lee ni escribe
// datos, no llama al servidor y no cambia ninguna regla de memoria (MEM-013/014/016). Las acciones (editar,
// archivar, regenerar, resumir…) siguen viviendo en chat.js, que le pasa cada acción como función; así el prompt,
// la telemetría y el cálculo de la relación siguen leyendo exactamente los mismos datos de antes.
//
// Rendimiento (docs/PRINCIPIOS-DE-INGENIERIA.md, 3 y 4): las tarjetas se crean por tandas de MEMORY_PAGE_SIZE
// ("Mostrar más"), agrupadas en "Siempre presentes" y "Por tema", y cada una lleva `content-visibility: auto`.
// Un personaje con 300 recuerdos abre con 20 tarjetas, no con 300.

import { relationshipSummary, relationshipDisplayText, relationshipAgeText, RELATIONSHIP_GROWING_MIN, RELATIONSHIP_ESTABLISHED_MIN } from '../api/relationship.js';

/** Tarjetas que se dibujan de una vez por grupo; "Mostrar más" agrega otra tanda. */
export const MEMORY_PAGE_SIZE = 10;
/** Largo máximo de la vista previa del resumen dentro de la pantalla (el texto completo se abre aparte). */
export const CONTINUITY_PREVIEW_CHARS = 260;

const LEVEL_LABELS = Object.freeze({ early: 'Conociéndose', growing: 'Creciendo', established: 'Establecida' });

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * Recorta un texto a `max` caracteres sin partir una palabra, con «…» si recortó.
 * @param {string} text
 * @param {number} [max]
 */
export function continuityPreview(text, max = CONTINUITY_PREVIEW_CHARS) {
  const clean = typeof text === 'string' ? text.replace(/\s+/g, ' ').trim() : '';
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[\s.,;:!?¡¿-]+$/, '') + '…';
}

/**
 * Cuántas tarjetas mostrar ahora y cuántas quedan, para un grupo ya ordenado.
 * @template T
 * @param {T[]} list
 * @param {number} shown  cuántas ya se muestran (0 al empezar)
 * @param {number} [size]
 * @returns {{ items: T[], remaining: number }}  `items` = las que se agregan en esta tanda
 */
export function memoryPage(list, shown, size = MEMORY_PAGE_SIZE) {
  const all = Array.isArray(list) ? list : [];
  const start = Math.max(0, shown | 0);
  const items = all.slice(start, start + size);
  return { items, remaining: Math.max(0, all.length - start - items.length) };
}

/**
 * Qué muestra la pantalla, a partir del personaje y del episodio (función pura, sin DOM, para probarla).
 * Los recuerdos son los ACTIVOS (`lorebook`); los archivados solo se cuentan (viven en `lorebookArchive`, MEM-016).
 * @param {import('../state.js').Character} character
 * @param {import('../state.js').Chat|null} chat
 */
export function memoryDashboardModel(character, chat) {
  const entries = (character && Array.isArray(character.lorebook) ? character.lorebook : []).filter(
    (e) => e && typeof e.content === 'string' && e.content.trim()
  );
  const sum = relationshipSummary(entries);
  const always = entries.filter((e) => e.always === true);
  const topic = entries.filter((e) => e.always !== true).sort((a, b) => (b.updated || 0) - (a.updated || 0));
  const summaryText = chat && chat.continuitySummary && typeof chat.continuitySummary.text === 'string' ? chat.continuitySummary.text.trim() : '';
  // Avance hacia el siguiente nivel de la relación (mismos umbrales que MEM-014; no se recalcula nada aquí).
  let progress = null;
  if (sum.level === 'early') progress = { current: sum.total, target: RELATIONSHIP_GROWING_MIN };
  else if (sum.level === 'growing') progress = { current: sum.total, target: RELATIONSHIP_ESTABLISHED_MIN };
  return {
    level: sum.level,
    levelLabel: LEVEL_LABELS[sum.level],
    relationshipText: relationshipDisplayText(character),
    total: sum.total,
    lastUpdated: sum.lastUpdated,
    progress,
    always,
    topic,
    archivedCount: character && Array.isArray(character.lorebookArchive) ? character.lorebookArchive.length : 0,
    continuity: {
      text: summaryText,
      preview: continuityPreview(summaryText),
      updated: chat && chat.continuitySummary ? chat.continuitySummary.updated || 0 : 0,
    },
  };
}

/**
 * Tarjeta grande de la relación (lo primero que se ve).
 * @param {ReturnType<typeof memoryDashboardModel>} model
 * @param {{ name: string, redactedBy?: string, source?: string, updatedAt?: number }} info
 * @param {{ onEdit?: () => void, onRegenerate?: () => void, regenerateDisabled?: boolean }} hooks  sin hooks = sin botones (nivel "early", texto fijo)
 */
export function buildRelationshipHero(model, info, hooks = {}) {
  const box = el('section', 'mem-hero');
  box.dataset.role = 'relationship';
  box.dataset.level = model.level;
  box.appendChild(el('div', 'mem-hero__level', model.levelLabel));
  box.appendChild(el('div', 'mem-hero__text', model.relationshipText));
  if (model.progress) {
    const { current, target } = model.progress;
    const bar = el('div', 'mem-progress');
    bar.setAttribute('role', 'progressbar');
    bar.setAttribute('aria-valuemin', '0');
    bar.setAttribute('aria-valuemax', String(target));
    bar.setAttribute('aria-valuenow', String(Math.min(current, target)));
    bar.setAttribute('aria-label', 'Recuerdos hacia el siguiente nivel de la relación');
    const fill = el('div', 'mem-progress__fill');
    fill.style.width = `${Math.min(100, Math.round((current / target) * 100))}%`;
    bar.appendChild(fill);
    box.appendChild(bar);
    box.appendChild(el('div', 'field__hint', `${current} de ${target} recuerdos para el siguiente paso.`));
  } else {
    box.appendChild(el('div', 'field__hint', `${model.total} recuerdos. Lo que han construido juntos ya es sólido.`));
  }
  if (model.level === 'early') {
    box.appendChild(el('div', 'field__hint', 'Se están conociendo: hace falta más memoria compartida para que el personaje opine.'));
  } else {
    const age = relationshipAgeText(info.updatedAt || 0);
    box.appendChild(
      el('div', 'field__hint', `Redactado por ${info.redactedBy || info.name}` + (age ? ` · ${age}` : '') + (info.source === 'manual' ? ' · editado por ti' : ''))
    );
    if (hooks.onEdit || hooks.onRegenerate) {
      const actions = el('div', 'mem-actions');
      if (hooks.onEdit) {
        const edit = el('button', 'btn btn--sm btn--ghost', 'Editar');
        edit.type = 'button';
        edit.addEventListener('click', hooks.onEdit);
        actions.appendChild(edit);
      }
      if (hooks.onRegenerate) {
        const regen = el('button', 'btn btn--sm btn--ghost', 'Regenerar');
        regen.type = 'button';
        regen.disabled = !!hooks.regenerateDisabled;
        regen.addEventListener('click', () => {
          regen.disabled = true;
          hooks.onRegenerate();
        });
        actions.appendChild(regen);
      }
      box.appendChild(actions);
    }
  }
  return box;
}

/**
 * Resumen del episodio: vista previa + botón que abre la hoja existente de resumen (que conserva editar, borrar,
 * resumir ahora y el interruptor automático, sin cambios).
 * @param {ReturnType<typeof memoryDashboardModel>} model
 * @param {{ onOpen: () => void }} hooks
 */
export function buildContinuityCard(model, hooks) {
  const box = el('section', 'mem-continuity');
  box.dataset.role = 'continuity';
  box.appendChild(el('h4', 'mem-section__title', 'Resumen de este episodio'));
  if (model.continuity.preview) {
    box.appendChild(el('div', 'mem-continuity__text', model.continuity.preview));
    const age = relationshipAgeText(model.continuity.updated);
    if (age) box.appendChild(el('div', 'field__hint', `Actualizado ${age}.`));
  } else {
    box.appendChild(
      el('div', 'field__hint', 'Todavía no hay resumen de este episodio. Se crea cuando la conversación se hace larga, o puedes escribirlo tú.')
    );
  }
  const open = el('button', 'btn btn--sm btn--ghost', model.continuity.text ? 'Ver o editar el resumen' : 'Abrir el resumen');
  open.type = 'button';
  open.addEventListener('click', hooks.onOpen);
  box.appendChild(open);
  return box;
}

/**
 * Una tarjeta de recuerdo.
 * @param {import('../state.js').LoreEntry} entry
 * @param {{ onEdit: (id: string) => void, onArchive: (id: string) => void }} hooks
 */
export function buildMemoryCard(entry, hooks) {
  const card = el('article', 'mem-card');
  card.dataset.entryId = entry.id;
  card.appendChild(el('div', 'mem-card__text', entry.content));
  const meta = el('div', 'mem-card__meta');
  if (entry.always) meta.appendChild(el('span', 'chip', 'Siempre presente'));
  else for (const key of entry.keys || []) meta.appendChild(el('span', 'chip', key));
  card.appendChild(meta);
  card.appendChild(el('div', 'field__hint', entry.source === 'manual' ? 'Escrito o editado por ti' : 'Automático'));
  const actions = el('div', 'mem-actions');
  const edit = el('button', 'btn btn--sm btn--ghost', 'Editar');
  edit.type = 'button';
  edit.addEventListener('click', () => hooks.onEdit(entry.id));
  const archive = el('button', 'btn btn--sm btn--ghost', 'Archivar');
  archive.type = 'button';
  archive.addEventListener('click', () => hooks.onArchive(entry.id));
  actions.append(edit, archive);
  card.appendChild(actions);
  return card;
}

/**
 * Lista de tarjetas por tandas: dibuja la primera y un botón «Mostrar más (N)» que agrega la siguiente SIN rehacer
 * lo ya dibujado.
 * @param {import('../state.js').LoreEntry[]} entries  ya ordenadas
 * @param {{ onEdit: (id: string) => void, onArchive: (id: string) => void }} hooks
 */
export function buildMemoryCards(entries, hooks) {
  const wrap = el('div', 'mem-cards');
  let shown = 0;
  let moreBtn = null;
  const addBatch = () => {
    const { items, remaining } = memoryPage(entries, shown);
    shown += items.length;
    const frag = document.createDocumentFragment();
    items.forEach((entry) => frag.appendChild(buildMemoryCard(entry, hooks)));
    if (moreBtn) moreBtn.remove();
    wrap.appendChild(frag);
    if (remaining > 0) {
      moreBtn = el('button', 'btn btn--ghost', `Mostrar más (${remaining})`);
      moreBtn.type = 'button';
      moreBtn.addEventListener('click', addBatch);
      wrap.appendChild(moreBtn);
    } else {
      moreBtn = null;
    }
  };
  addBatch();
  return wrap;
}
