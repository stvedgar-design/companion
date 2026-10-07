// tests/gallery.test.mjs
// FASE 14 (PARETO-008): Pruebas de galería visual estilo Instagram y diario de ilustraciones

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createState,
  sanitizeGalleryItem,
  sanitizeGallery,
  GALLERY_CAPTION_MAX,
} from '../www/js/state.js';
import {
  duplicateCharacterData,
  characterSheetModel,
} from '../www/js/ui/character-sheet.js';
import { buildPlainPrompt, buildChatMessages } from '../www/js/prompt.js';

function createMemoryBackend() {
  const stores = {
    settings: new Map(),
    characters: new Map(),
    chats: new Map(),
    chatMeta: new Map(),
    chatMsgs: new Map(),
  };

  function applyOp(op) {
    const store = stores[op.store];
    if (op.type === 'put') store.set(op.key, op.value);
    else if (op.type === 'remove') store.delete(op.key);
  }

  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) applyOp(op); },
    _raw: stores,
  };
}

function makeCharacter(overrides = {}) {
  return {
    id: overrides.id || 'char-nora',
    name: overrides.name || 'Nora',
    avatar: '',
    card: {
      name: overrides.name || 'Nora',
      description: 'Una compañera reflexiva y cálida.',
      personality: 'Cálida, atenta y perspicaz.',
      scenario: '',
      first_mes: 'Hola.',
      mes_example: '',
      system_prompt: '',
      post_history_instructions: '',
      alternate_greetings: [],
      character_book: null,
    },
    created: Date.now(),
    updated: Date.now(),
    last: '',
    gallery: overrides.gallery || [],
    ...overrides,
  };
}

test('sanitizeGalleryItem: valida campos, auto-asigna id y createdAt, y descarta items inválidos', () => {
  assert.equal(sanitizeGalleryItem(null), null);
  assert.equal(sanitizeGalleryItem('basura'), null);
  assert.equal(sanitizeGalleryItem({}), null);
  assert.equal(sanitizeGalleryItem({ dataUrl: 'http://invalido.png' }), null);

  const validDataUrl = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/';
  const item = sanitizeGalleryItem({
    dataUrl: validDataUrl,
    caption: '  Una tarde leyendo en la ventana  ',
  });

  assert.ok(item);
  assert.ok(item.id.startsWith('gal_'));
  assert.equal(item.dataUrl, validDataUrl);
  assert.equal(item.caption, 'Una tarde leyendo en la ventana');
  assert.ok(typeof item.createdAt === 'number' && item.createdAt > 0);
});

test('sanitizeGalleryItem: recorta notas que superan GALLERY_CAPTION_MAX (500)', () => {
  const validDataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const longCaption = 'A'.repeat(600);
  const item = sanitizeGalleryItem({
    dataUrl: validDataUrl,
    caption: longCaption,
  });

  assert.equal(item.caption.length, GALLERY_CAPTION_MAX);
  assert.equal(item.caption, 'A'.repeat(GALLERY_CAPTION_MAX));
});

test('sanitizeGallery: filtra entradas corruptas y mantiene la colección limpia', () => {
  assert.deepEqual(sanitizeGallery(null), []);
  assert.deepEqual(sanitizeGallery('invalido'), []);
  assert.deepEqual(sanitizeGallery([]), []);

  const validDataUrl = 'data:image/webp;base64,UklGRiQAAABXRUJQVlA4IBgAAAAwAQCdASoBAAEAAwA0JaQAA3AA/vuUAAA=';
  const raw = [
    null,
    { dataUrl: 'not-a-data-url' },
    { id: 'item-1', dataUrl: validDataUrl, caption: 'Foto 1', createdAt: 1000 },
    { id: 'item-2', dataUrl: validDataUrl, caption: 'Foto 2', createdAt: 2000 },
  ];

  const cleaned = sanitizeGallery(raw);
  assert.equal(cleaned.length, 2);
  assert.equal(cleaned[0].id, 'item-1');
  assert.equal(cleaned[1].id, 'item-2');
});

test('almacén state.js: listCharacterGallery, saveGalleryItem, updateGalleryItemCaption y deleteGalleryItem', async () => {
  const state = createState(createMemoryBackend());
  const char = makeCharacter({ id: 'char-kuroha', name: 'Kuroha' });
  await state.saveCharacter(char);

  const initialList = await state.listCharacterGallery('char-kuroha');
  assert.deepEqual(initialList, []);

  const validImg1 = 'data:image/jpeg;base64,abc1';
  const validImg2 = 'data:image/jpeg;base64,abc2';

  // Guardar primera ilustración
  await state.saveGalleryItem('char-kuroha', {
    id: 'gal-1',
    dataUrl: validImg1,
    caption: 'Kuroha en la biblioteca',
    createdAt: 1000,
  });

  // Guardar segunda ilustración (más reciente)
  await state.saveGalleryItem('char-kuroha', {
    id: 'gal-2',
    dataUrl: validImg2,
    caption: 'Kuroha sonriendo bajo la lluvia',
    createdAt: 2000,
  });

  const list = await state.listCharacterGallery('char-kuroha');
  assert.equal(list.length, 2);
  // Orden cronológico inverso (el más reciente primero)
  assert.equal(list[0].id, 'gal-2');
  assert.equal(list[1].id, 'gal-1');

  // Actualizar nota personal de la foto 1
  await state.updateGalleryItemCaption('char-kuroha', 'gal-1', 'Nota actualizada con recuerdo íntimo');
  const updatedList = await state.listCharacterGallery('char-kuroha');
  const item1 = updatedList.find((x) => x.id === 'gal-1');
  assert.equal(item1.caption, 'Nota actualizada con recuerdo íntimo');

  // Eliminar ilustración 2
  await state.deleteGalleryItem('char-kuroha', 'gal-2');
  const afterDelete = await state.listCharacterGallery('char-kuroha');
  assert.equal(afterDelete.length, 1);
  assert.equal(afterDelete[0].id, 'gal-1');
});

test('character-sheet: duplicateCharacterData inicializa el álbum vacío y characterSheetModel cuenta ilustraciones', () => {
  const original = makeCharacter({
    id: 'char-orig',
    gallery: [
      { id: '1', dataUrl: 'data:image/jpeg;base64,123', caption: 'Nota', createdAt: 100 },
      { id: '2', dataUrl: 'data:image/jpeg;base64,456', caption: '', createdAt: 200 },
    ],
  });

  const model = characterSheetModel(original);
  assert.equal(model.galleryCount, 2);

  const duplicate = duplicateCharacterData(original);
  assert.deepEqual(duplicate.gallery, []);
  assert.notEqual(duplicate.id, original.id);

  const dupModel = characterSheetModel(duplicate);
  assert.equal(dupModel.galleryCount, 0);
});

test('aislamiento hermético: la galería y sus notas NUNCA se inyectan en los prompts del LLM', () => {
  const validImg = 'data:image/jpeg;base64,secret_image_bytes';
  const char = makeCharacter({
    id: 'char-test',
    gallery: [
      { id: 'g1', dataUrl: validImg, caption: 'ESTA_NOTA_ES_PRIVADA_NO_LLM', createdAt: Date.now() },
    ],
  });

  const history = [
    { role: 'user', text: 'Hola Nora, ¿cómo estás?' },
    { role: 'char', text: 'Hola, todo tranquilo por aquí.' },
  ];
  const settings = { url: 'http://localhost:5001', user: 'User', maxLen: 220, temp: 0.85, mode: 'plain', ctx: 4096 };

  // 1. buildPlainPrompt
  const { prompt } = buildPlainPrompt(char.card, history, settings);
  assert.equal(prompt.includes('ESTA_NOTA_ES_PRIVADA_NO_LLM'), false);
  assert.equal(prompt.includes('secret_image_bytes'), false);

  // 2. buildChatMessages
  const { messages } = buildChatMessages(char.card, history, { ...settings, mode: 'chat' });
  const serialized = JSON.stringify(messages);
  assert.equal(serialized.includes('ESTA_NOTA_ES_PRIVADA_NO_LLM'), false);
  assert.equal(serialized.includes('secret_image_bytes'), false);
});
