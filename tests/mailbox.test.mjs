import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  sanitizeMailbox, defaultMailbox, unreadCount, visibleNotes, withNote, withInteraction, markAllRead, setNoteStatus, withFailedAttempt,
  lastInteractionAt, mailboxDue, elapsedPhrase, pickMailboxMemories, mailboxInstruction, buildMailboxRequest, cleanNote, createMailboxWriter,
  MAILBOX_MIN_ABSENCE_MS, MAILBOX_MIN_MEMORIES, MAILBOX_NOTES_MAX, MAILBOX_RETRY_AFTER_FAILED_MS,
} from '../www/js/api/mailbox.js';
import { verifyRecap } from '../www/js/api/continuity.js';
import { createState } from '../www/js/state.js';
import { duplicateCharacterData } from '../www/js/ui/character-sheet.js';

const H = 60 * 60 * 1000;
const card = { name: 'Mia', description: 'A shy baker.', personality: 'shy, kind', scenario: 'ESCENARIO-SECRETO', first_mes: 'SALUDO-SECRETO', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
const settings = { user: 'Sam', mode: 'chat', maxLen: 200, ctx: 4096 };
const mem = (n) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, keys: ['k' + i], content: `Sam likes thing number ${i} a lot`, updated: 100 + i, source: 'auto' }));
const GOOD = ' smiles softly.* Hey Sam, I was thinking about thing number 2 today.';

test('sanitizeMailbox: lo inválido da buzón vacío; un personaje anterior no tiene notas ni marca', () => {
  assert.deepEqual(sanitizeMailbox(undefined), defaultMailbox());
  assert.deepEqual(sanitizeMailbox({ notes: 'x', lastInteractionAt: 'y' }), defaultMailbox());
  const mb = sanitizeMailbox({ lastInteractionAt: 5, notes: [{ text: '  hola   mundo ', createdAt: 3, status: 'bogus' }, { text: '' }, null] });
  assert.equal(mb.notes.length, 1);
  assert.equal(mb.notes[0].status, 'new');
  assert.equal(mb.notes[0].text, 'hola mundo');
});

test('mailboxDue: umbral de ausencia, una por período, mínimo de recuerdos y reintento tras fallo', () => {
  const now = 100 * H;
  const char = (extra = {}) => ({ lorebook: mem(MAILBOX_MIN_MEMORIES), mailbox: {}, ...extra });
  assert.equal(mailboxDue(char(), 0, now).reason, 'never-interacted');
  assert.equal(mailboxDue(char(), now - MAILBOX_MIN_ABSENCE_MS + 1000, now).reason, 'too-soon');
  assert.equal(mailboxDue(char(), now - 3 * H, now).due, false, 'abrir la app a media tarde no dispara');
  const last = now - 9 * H;
  assert.equal(mailboxDue(char(), last, now).due, true);
  assert.equal(mailboxDue(char({ mailbox: { lastNoteFor: last } }), last, now).reason, 'already-noted');
  assert.equal(mailboxDue(char({ lorebook: mem(MAILBOX_MIN_MEMORIES - 1) }), last, now).reason, 'few-memories');
  assert.equal(mailboxDue(char({ mailbox: { attemptedAt: now - 1000 } }), last, now).reason, 'recent-failure');
  assert.equal(mailboxDue(char({ mailbox: { attemptedAt: now - MAILBOX_RETRY_AFTER_FAILED_MS - 1 } }), last, now).due, true);
  // una nueva interacción abre un período nuevo
  assert.equal(mailboxDue(char({ mailbox: { lastNoteFor: last } }), last + 1, now + 1).due, true);
});

test('lastInteractionAt: lo más reciente entre la marca y la actividad de los chats (solo fechas)', () => {
  assert.equal(lastInteractionAt({ lastInteractionAt: 10 }, [{ updated: 30 }, { updated: 20 }]), 30);
  assert.equal(lastInteractionAt({ lastInteractionAt: 50 }, [{ updated: 30 }]), 50);
  assert.equal(lastInteractionAt(undefined, []), 0);
});

test('elapsedPhrase: siempre redondeado, sin dígitos ni horas/minutos exactos', () => {
  for (const h of [8, 9.5, 19.9, 20, 30, 40, 80, 150, 300, 24 * 40]) {
    const p = elapsedPhrase(h * H);
    assert.ok(!/\d/.test(p), p);
    assert.ok(!/minute|hour(?!s have)/i.test(p.replace('several hours have passed', '')), p);
  }
  assert.equal(elapsedPhrase(9 * H), 'several hours have passed');
  assert.equal(elapsedPhrase(26 * H), 'about a day has passed');
});

test('transformaciones: nueva → leída (al abrir) → descartada/respondida; el tope se respeta y no se pierden las nuevas', () => {
  let mb = withNote(defaultMailbox(), '*waves* hi there friend', 1000, 500);
  assert.equal(unreadCount({ mailbox: mb }), 1);
  assert.equal(mb.lastNoteFor, 500);
  mb = markAllRead(mb, 2000);
  assert.equal(unreadCount({ mailbox: mb }), 0);
  assert.equal(mb.notes[0].status, 'read');
  const id = mb.notes[0].id;
  assert.equal(visibleNotes(setNoteStatus(mb, id, 'dismissed')).length, 0, 'descartada: oculta');
  assert.equal(setNoteStatus(mb, id, 'answered').notes[0].status, 'answered');
  assert.equal(setNoteStatus(mb, id, 'inventado').notes[0].status, 'read');
  let many = defaultMailbox();
  for (let i = 0; i < MAILBOX_NOTES_MAX + 4; i++) many = withNote(many, `*waves* note number ${i} here`, 1000 + i, i);
  assert.equal(many.notes.length, MAILBOX_NOTES_MAX);
  assert.ok(many.notes.some((n) => n.text.includes(`number ${MAILBOX_NOTES_MAX + 3} `)), 'la más nueva se conserva');
  assert.equal(withInteraction(many, 77).lastInteractionAt, 77);
  assert.equal(withFailedAttempt(many, 88).attemptedAt, 88);
});

test('pickMailboxMemories: siempre presentes primero, resto mezclado y dentro del presupuesto', () => {
  const list = [...mem(40), { id: 'a', keys: [], content: 'Sam is allergic to nuts', always: true, updated: 1 }];
  const sel = pickMailboxMemories(list, () => 0.3, 200);
  assert.equal(sel[0].id, 'a');
  assert.ok(sel.length < list.length);
  const again = pickMailboxMemories(list, () => 0.9, 200);
  assert.notDeepEqual(sel.map((e) => e.id), again.map((e) => e.id), 'distinta mezcla, distintas notas');
});

test('cleanNote: acepta acción + palabras; rechaza reproches, horas exactas, acciones sin cerrar y rechazos del modelo', () => {
  assert.match(cleanNote(GOOD), /^\*smiles softly\.\* Hey Sam/);
  assert.equal(cleanNote(' smiles.* You never write to me anymore, Sam.'), '');
  assert.equal(cleanNote(' smiles.* I was waiting for you all night, Sam.'), '');
  assert.equal(cleanNote(' smiles.* It has been 9 hours since we talked, Sam.'), '');
  assert.equal(cleanNote(' smiles softly and says hello to Sam'), '', 'acción sin cerrar');
  assert.equal(cleanNote(' waves.*'), '');
  assert.equal(cleanNote(' waves.* I cannot do that, sorry about it.'), '');
});

test('la instrucción y el pedido NO contienen contenido de ningún episodio, ni escenario ni saludo; el tiempo va redondeado', () => {
  const memories = mem(3);
  const instruction = mailboxInstruction({ charName: 'Mia', userName: 'Sam', personality: 'shy, kind', description: 'A shy baker.', identity: 'Over time, Mia opened up.', relationship: 'We are close.', memories, elapsed: elapsedPhrase(9 * H), timeNote: 'It is a Tuesday morning.' });
  const req = buildMailboxRequest({ character: { card }, settings, instruction });
  const sent = JSON.stringify(req);
  for (const secret of ['ESCENARIO-SECRETO', 'SALUDO-SECRETO']) assert.ok(!sent.includes(secret));
  assert.ok(sent.includes('several hours have passed'));
  assert.ok(sent.includes('Over time, Mia opened up.'));
  assert.ok(sent.includes('Do NOT refer to any specific earlier conversation'));
  assert.ok(!/\b\d+\s*(hours?|minutes?)\b/.test(sent));
  assert.equal(req.messages.at(-1).content, '*');
  const plain = buildMailboxRequest({ character: { card }, settings: { ...settings, mode: 'plain' }, instruction });
  assert.ok(plain.prompt.endsWith('\n*'));
});

function makeWriter({ character, chats = [{ updated: 0 }], reply = GOOD, failServer = false, now = 100 * H } = {}) {
  const store = { character };
  const calls = [];
  const deps = {
    loadCharacter: async () => store.character,
    loadSettings: async () => settings,
    listChatDates: async () => chats,
    complete: async (request) => {
      calls.push(request);
      if (failServer) throw new Error('down');
      return reply;
    },
    verifyText: verifyRecap,
    updateMailbox: async (id, mutator) => {
      store.character = { ...store.character, mailbox: sanitizeMailbox(mutator(store.character.mailbox)) };
      return store.character;
    },
    now: () => now,
    random: () => 0.5,
  };
  return { deps, store, calls };
}

test('escritor: tras una ausencia deja UNA nota nueva; en aperturas seguidas no se repite', async () => {
  const now = 100 * H;
  const { deps, store, calls } = makeWriter({ character: { id: 'c', card, lorebook: mem(10), mailbox: { lastInteractionAt: now - 9 * H } } });
  const writer = createMailboxWriter(deps);
  assert.equal((await writer.maybeRun('c')).kind, 'ok');
  assert.equal(unreadCount(store.character), 1);
  assert.match(store.character.mailbox.notes[0].text, /^\*smiles softly/);
  assert.equal(calls.length, 1);
  assert.equal((await writer.maybeRun('c')).kind, 'skipped');
  assert.equal((await writer.maybeRun('c')).kind, 'skipped');
  assert.equal(calls.length, 1, 'no genera notas repetidas sin una nueva interacción');
});

test('escritor: sin ausencia suficiente, o sin interacción previa, no llama al modelo', async () => {
  const a = makeWriter({ character: { id: 'c', card, lorebook: mem(10), mailbox: { lastInteractionAt: 100 * H - 2 * H } } });
  assert.equal((await createMailboxWriter(a.deps).maybeRun('c')).kind, 'skipped');
  const b = makeWriter({ character: { id: 'c', card, lorebook: mem(10) }, chats: [] });
  assert.equal((await createMailboxWriter(b.deps).maybeRun('c')).kind, 'skipped');
  assert.equal(a.calls.length + b.calls.length, 0);
});

test('escritor: la actividad de los chats (solo fechas) cuenta como interacción', async () => {
  const w = makeWriter({ character: { id: 'c', card, lorebook: mem(10) }, chats: [{ updated: 100 * H - 10 * H }] });
  assert.equal((await createMailboxWriter(w.deps).maybeRun('c')).kind, 'ok');
  assert.equal(w.store.character.mailbox.lastNoteFor, 100 * H - 10 * H);
});

test('escritor: nada de episodios llega al modelo (ni lo que el personaje "dijo" en un chat), solo identidad y recuerdos', async () => {
  const w = makeWriter({
    character: { id: 'c', card, lorebook: mem(10), identity: { text: 'Over time, Mia has become more open.', acceptedAt: 1 }, mailbox: { lastInteractionAt: 100 * H - 9 * H } },
    chats: [{ updated: 100 * H - 9 * H, last: 'ULTIMA-LINEA-DEL-CHAT', continuitySummary: { text: 'RESUMEN-DEL-EPISODIO' } }],
  });
  await createMailboxWriter(w.deps).maybeRun('c');
  const sent = JSON.stringify(w.calls[0]);
  for (const secret of ['ULTIMA-LINEA-DEL-CHAT', 'RESUMEN-DEL-EPISODIO', 'ESCENARIO-SECRETO', 'SALUDO-SECRETO']) assert.ok(!sent.includes(secret));
  assert.ok(sent.includes('Over time, Mia has become more open.'));
  assert.ok(sent.includes('Sam likes thing number'));
});

test('escritor: servidor caído → nada se anota y el siguiente chequeo reintenta', async () => {
  const base = { id: 'c', card, lorebook: mem(10), mailbox: { lastInteractionAt: 100 * H - 9 * H } };
  const down = makeWriter({ character: base, failServer: true });
  assert.equal((await createMailboxWriter(down.deps).maybeRun('c')).kind, 'error');
  assert.deepEqual(down.store.character.mailbox, base.mailbox, 'no se escribió nada');
  const up = makeWriter({ character: down.store.character });
  assert.equal((await createMailboxWriter(up.deps).maybeRun('c')).kind, 'ok');
});

test('escritor: texto con reproche o nombres inventados → sin nota, intento anotado, sin reintento inmediato', async () => {
  for (const reply of [' sighs.* You never write to me, Sam.', ' smiles.* I moved to Paris with Gustavo, Sam.']) {
    const w = makeWriter({ character: { id: 'c', card, lorebook: mem(10), mailbox: { lastInteractionAt: 100 * H - 9 * H } }, reply });
    const writer = createMailboxWriter(w.deps);
    assert.equal((await writer.maybeRun('c')).kind, 'unverified');
    assert.equal(unreadCount(w.store.character), 0);
    assert.ok(w.store.character.mailbox.attemptedAt > 0);
    const n = w.calls.length;
    assert.equal((await writer.maybeRun('c')).kind, 'skipped');
    assert.equal(w.calls.length, n);
  }
});

test('escritor: si el usuario volvió mientras se escribía, la nota no se deja', async () => {
  const base = { id: 'c', card, lorebook: mem(10), mailbox: { lastInteractionAt: 100 * H - 9 * H } };
  const w = makeWriter({ character: base });
  const inner = w.deps.complete;
  w.deps.complete = async (r) => {
    w.store.character = { ...w.store.character, mailbox: withInteraction(w.store.character.mailbox, 100 * H) };
    return inner(r);
  };
  assert.equal((await createMailboxWriter(w.deps).maybeRun('c')).kind, 'skipped');
  assert.equal(unreadCount(w.store.character), 0);
});

function memoryBackend() {
  const stores = { settings: new Map(), characters: new Map(), chats: new Map(), chatMeta: new Map(), chatMsgs: new Map() };
  return {
    async get(store, key) { return stores[store].get(key); },
    async getAll(store) { return Array.from(stores[store].values()); },
    async put(store, key, value) { stores[store].set(key, value); },
    async remove(store, key) { stores[store].delete(key); },
    async atomic(ops) { for (const op of ops) { if (op.type === 'put') stores[op.store].set(op.key, op.value); else stores[op.store].delete(op.key); } },
  };
}

test('estado: un personaje anterior carga con buzón vacío; touch está limitado y no pisa lo demás; responder = episodio NUEVO', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', { id: 'c1', name: 'Mia', avatar: '', card, created: 1, lorebook: mem(6) });
  const loaded = await state.getCharacter('c1');
  assert.deepEqual(loaded.mailbox, defaultMailbox());
  assert.equal(loaded.lorebook.length, 6);
  await state.touchCharacterInteraction('c1', 1_000_000);
  assert.equal((await state.getCharacter('c1')).mailbox.lastInteractionAt, 1_000_000);
  await state.touchCharacterInteraction('c1', 1_000_000 + 60_000); // dentro del lapso: no escribe de nuevo
  assert.equal((await state.getCharacter('c1')).mailbox.lastInteractionAt, 1_000_000);
  await state.touchCharacterInteraction('c1', 1_000_000 + 11 * 60_000);
  assert.equal((await state.getCharacter('c1')).mailbox.lastInteractionAt, 1_000_000 + 11 * 60_000);
  // escrituras cruzadas sobre el mismo personaje: nada se pierde (candado por personaje)
  await Promise.all([
    state.saveCharacterMailbox('c1', (mb) => withNote(mb, '*waves* a note for you friend', 5000, 4000)),
    state.saveCharacterLorebook('c1', mem(9)),
    state.touchCharacterInteraction('c1', 9_000_000),
  ]);
  const after = await state.getCharacter('c1');
  assert.equal(after.lorebook.length, 9);
  assert.equal(after.mailbox.notes.length, 1);
  assert.equal(after.mailbox.lastInteractionAt, 9_000_000);
  // «Responder»: un episodio nuevo con la nota como primer mensaje; los existentes no se tocan
  const old = await state.createChat('c1', {});
  await state.saveChatMessages(old.id, [{ role: 'char', text: 'viejo', ts: 1 }]);
  const fresh = await state.createChat('c1', {});
  await state.saveChatMessages(fresh.id, [{ role: 'char', text: after.mailbox.notes[0].text, ts: 2 }]);
  assert.notEqual(fresh.id, old.id);
  assert.equal((await state.getChatMessages(old.id)).length, 1);
  assert.equal((await state.getChatMessages(fresh.id))[0].text, '*waves* a note for you friend');
});

test('duplicar un personaje NO hereda el buzón', () => {
  const dup = duplicateCharacterData({ id: 'x', name: 'Mia', card, mailbox: { lastInteractionAt: 9, notes: [{ text: 'hola mundo hola', createdAt: 1 }] } });
  assert.deepEqual(dup.mailbox, defaultMailbox());
});

test('no existe ningún interruptor Disponible/Ausente ni notificaciones push en el código de la app', () => {
  const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
  const files = ['../www/index.html', '../www/js/ui/settings.js', '../www/js/ui/mailbox.js', '../www/js/api/mailbox.js', '../www/js/ui/home.js', '../www/js/ui/character-sheet.js'];
  for (const f of files) {
    const text = read(f);
    assert.ok(!/Disponible\s*\/\s*Ausente/i.test(text), f);
    assert.ok(!/Notification\.requestPermission|new Notification\(|PushNotifications|LocalNotifications/.test(text), f);
  }
});
