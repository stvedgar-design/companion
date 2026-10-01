import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  sanitizeIdentity, defaultIdentity, identityForPrompt, acceptProposal, discardProposal, revertIdentity, withProposal,
  identityDue, selectIdentityMemories, createIdentitySynthesizer,
  IDENTITY_MIN_MEMORIES, IDENTITY_MEMORIES_STEP, IDENTITY_MIN_INTERVAL_MS, IDENTITY_HISTORY_MAX, IDENTITY_PREFILL,
} from '../www/js/api/identity-synthesis.js';
import { buildChatMessages, buildPlainPrompt, historyStartIndex } from '../www/js/api/prompt.js';
import { buildRelationshipRequest } from '../www/js/api/relationship.js';
import { cleanRecap, verifyRecap } from '../www/js/api/continuity.js';
import { duplicateCharacterData } from '../www/js/ui/character-sheet.js';
import { createState } from '../www/js/state.js';
import { memoryDashboardModel } from '../www/js/ui/character-memory.js';

const DAY = 24 * 60 * 60 * 1000;
const mem = (n, extra = {}) => Array.from({ length: n }, (_, i) => ({ id: 'm' + i, keys: ['k' + i], content: `Sam likes thing number ${i} a lot`, updated: 1000 + i, source: 'auto', ...extra }));
const card = { name: 'Mia', description: 'A shy baker.', personality: 'shy, kind', scenario: '', first_mes: '', mes_example: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], character_book: null };
const settings = { user: 'Sam', maxLen: 220, ctx: 4096, mode: 'chat' };

test('sanitizeIdentity: cualquier cosa inválida da el valor por defecto', () => {
  assert.deepEqual(sanitizeIdentity(undefined), defaultIdentity());
  assert.deepEqual(sanitizeIdentity('x'), defaultIdentity());
  assert.deepEqual(sanitizeIdentity({ text: 5, history: 'no', proposal: { text: '' } }), defaultIdentity());
  const ok = sanitizeIdentity({ text: '  Mia   grew. ', acceptedAt: 5, proposal: { text: 'new', createdAt: 9, memoryCount: 20, level: 'bogus' } });
  assert.equal(ok.text, 'Mia grew.');
  assert.equal(ok.proposal.level, 'early');
});

test('identityForPrompt: solo la ACEPTADA; una propuesta pendiente nunca viaja', () => {
  assert.equal(identityForPrompt({ identity: { proposal: { text: 'pendiente', createdAt: 1, memoryCount: 20, level: 'early' } } }), '');
  assert.equal(identityForPrompt({ identity: { text: 'aceptada', acceptedAt: 1 } }), 'aceptada');
  assert.equal(identityForPrompt({}), '');
});

test('aceptar / descartar / quitar: transformaciones puras y el historial se conserva', () => {
  let id = withProposal(defaultIdentity(), { text: 'v1', memoryCount: 15, level: 'early' }, 100);
  assert.equal(id.proposal.text, 'v1');
  const afterDiscard = discardProposal(id);
  assert.equal(afterDiscard.proposal, null);
  assert.equal(afterDiscard.text, '');
  assert.equal(afterDiscard.basis.at, 100, 'descartar no borra la base: no se vuelve a proponer al rato');
  id = acceptProposal(id, 200);
  assert.equal(id.text, 'v1');
  assert.equal(id.proposal, null);
  id = acceptProposal(withProposal(id, { text: 'v2', memoryCount: 40, level: 'growing' }, 300), 400);
  assert.equal(id.text, 'v2');
  assert.deepEqual(id.history.map((h) => h.text), ['v1']);
  assert.equal(revertIdentity(id).text, 'v1');
  assert.equal(revertIdentity(revertIdentity(id)).text, '');
  assert.equal(acceptProposal(id, 500).text, 'v2', 'sin propuesta, aceptar no cambia nada');
  let many = defaultIdentity();
  for (let i = 0; i < 9; i++) many = acceptProposal(withProposal(many, { text: 'v' + i, memoryCount: 20, level: 'early' }, i), i);
  assert.equal(many.history.length, IDENTITY_HISTORY_MAX);
});

test('identityDue: frecuencia rara y deliberada', () => {
  const now = 10 * DAY;
  const char = (n, identity) => ({ lorebook: mem(n), identity });
  assert.equal(identityDue(char(IDENTITY_MIN_MEMORIES - 1), now).due, false);
  assert.deepEqual([identityDue(char(IDENTITY_MIN_MEMORIES), now).due, identityDue(char(IDENTITY_MIN_MEMORIES), now).reason], [true, 'first']);
  const based = (count, level, at) => ({ basis: { count, level, at } });
  assert.equal(identityDue(char(40, based(20, 'early', now - IDENTITY_MIN_INTERVAL_MS + 1000)), now).reason, 'too-soon');
  assert.equal(identityDue(char(30, based(20, 'early', now - 4 * DAY)), now).reason, 'level');
  assert.equal(identityDue(char(20 + IDENTITY_MEMORIES_STEP, based(20, 'early', now - 4 * DAY)), now).due, true);
  assert.equal(identityDue(char(25, based(20, 'early', now - 4 * DAY)), now).due, false);
  assert.equal(identityDue(char(60, { ...based(20, 'early', now - 9 * DAY), proposal: { text: 'x', createdAt: 1, memoryCount: 20, level: 'early' } }), now).reason, 'pending');
  assert.equal(identityDue(char(20, { attemptedAt: now - 1000 }), now).reason, 'recent-failure');
});

test('identityDue cuenta solo recuerdos ACTIVOS (los archivados no)', () => {
  const char = { lorebook: mem(10), lorebookArchive: mem(50, { archivedAt: 1 }) };
  assert.equal(identityDue(char, 1).due, false);
});

test('selectIdentityMemories: siempre presentes primero, luego los más recientes, dentro del presupuesto', () => {
  const list = [...mem(30), { id: 'a', keys: [], content: 'Sam is allergic to nuts', always: true, updated: 1 }];
  const sel = selectIdentityMemories(list, 200);
  assert.equal(sel[0].id, 'a');
  assert.ok(sel.reduce((n, e) => n + e.content.length + 3, 0) <= 200 + sel[0].content.length);
});

test('prompt: la identidad aceptada va en la cabecera, tras la personalidad, sin tocar la personalidad; vacía = prompt idéntico', () => {
  const msgs = [{ role: 'user', text: 'Hi', ts: 1 }];
  const text = 'Over time, Mia has become more open.';
  const withId = buildChatMessages(card, msgs, settings, '', '', '', '', false, { identity: text }).messages[0].content;
  assert.ok(withId.includes("Mia's personality: shy, kind"));
  assert.ok(withId.indexOf("Mia's personality") < withId.indexOf(`Mia has grown so far: ${text}`));
  const none = buildChatMessages(card, msgs, settings, '', '', '', '', false, {});
  const empty = buildChatMessages(card, msgs, settings, '', '', '', '', false, { identity: '' });
  assert.deepEqual(none, empty);
  assert.ok(!none.messages[0].content.includes('grown so far'));
  const plain = buildPlainPrompt(card, msgs, { ...settings, mode: 'plain' }, '', '', '', '', false, { identity: text }).prompt;
  assert.ok(plain.includes(`Mia has grown so far: ${text}`));
});

test('historyStartIndex con identidad refleja la misma ventana que el prompt real', () => {
  const long = Array.from({ length: 150 }, (_, i) => ({ role: i % 2 ? 'user' : 'char', text: 'palabra '.repeat(30) + i, ts: i }));
  const text = 'Over time, Mia has become more open. '.repeat(10).trim();
  const idx = historyStartIndex(card, long, settings, '', '', 0, 0, null, null, false, text);
  const built = buildChatMessages(card, long, settings, '', '', '', '', false, { identity: text }).messages;
  const keptUser = built.filter((m) => m.role !== 'system' && m.content !== '[Start of roleplay]').length;
  assert.equal(long.length - idx, keptUser);
});

test('relationship/continuity/feeling arman la misma cabecera que el chat (continuación del prefijo): llevan la identidad', () => {
  const character = { id: 'c', card, lorebook: mem(40), identity: { text: 'Over time, Mia has become more open.', acceptedAt: 1 } };
  const req = buildRelationshipRequest({ character, chat: { scenario: '' }, messages: [{ role: 'user', text: 'Hi', ts: 1 }], settings }, 'instr');
  assert.ok(req.messages[0].content.includes('Mia has grown so far: Over time, Mia has become more open.'));
});

test('duplicar un personaje NO hereda la identidad', () => {
  const dup = duplicateCharacterData({ id: 'x', name: 'Mia', card, identity: { text: 'Over time, Mia grew.', acceptedAt: 1 } });
  assert.deepEqual(dup.identity, defaultIdentity());
});

test('memoryDashboardModel expone la propuesta y la identidad aceptada', () => {
  const m = memoryDashboardModel({ card, lorebook: mem(3), identity: { text: 'Over time, Mia grew.', acceptedAt: 5, proposal: { text: 'Over time, Mia opened up.', createdAt: 6, memoryCount: 3, level: 'early' } } }, null);
  assert.equal(m.identity.text, 'Over time, Mia grew.');
  assert.equal(m.identity.proposal.text, 'Over time, Mia opened up.');
});

/* ---------- sintetizador ---------- */

function makeDeps({ character, reply = ' Mia has become more open with Sam, who likes thing number 1 a lot.', failServer = false } = {}) {
  const store = { character };
  const calls = [];
  const deps = {
    loadCharacter: async () => store.character,
    loadSettings: async () => settings,
    complete: async (request) => {
      calls.push(request);
      if (failServer) throw new Error('down');
      return typeof reply === 'function' ? reply(calls.length) : reply;
    },
    cleanText: cleanRecap,
    verifyText: verifyRecap,
    updateIdentity: async (id, mutator) => {
      store.character = { ...store.character, identity: sanitizeIdentity(mutator(store.character.identity)) };
      return store.character;
    },
    now: () => 50 * DAY,
  };
  return { deps, store, calls };
}

test('sintetizador: genera una PROPUESTA (no la aplica) a partir de recuerdos activos y pide la continuación del prefijo "Over time,"', async () => {
  const { deps, store, calls } = makeDeps({ character: { id: 'c', card, lorebook: mem(20), lorebookArchive: [{ id: 'z', keys: [], content: 'SECRETO ARCHIVADO', archivedAt: 1 }] } });
  const result = await createIdentitySynthesizer(deps).maybeRun('c');
  assert.equal(result.kind, 'ok');
  assert.match(store.character.identity.proposal.text, /^Over time, Mia has become more open/);
  assert.equal(store.character.identity.text, '', 'sin aceptar, la identidad vigente sigue vacía');
  assert.equal(identityForPrompt(store.character), '');
  assert.equal(store.character.identity.basis.count, 20);
  const sent = JSON.stringify(calls[0]);
  assert.ok(!sent.includes('SECRETO ARCHIVADO'), 'los archivados no entran');
  assert.ok(sent.includes(IDENTITY_PREFILL));
  assert.ok(sent.includes('shy, kind'), 'la personalidad original va en el pedido');
  assert.equal(calls.length, 1);
});

test('sintetizador: los campos originales de la card no se tocan', async () => {
  const original = JSON.stringify(card);
  const { deps, store } = makeDeps({ character: { id: 'c', card: JSON.parse(original), lorebook: mem(20) } });
  await createIdentitySynthesizer(deps).maybeRun('c');
  assert.equal(JSON.stringify(store.character.card), original);
});

test('sintetizador: servidor caído → nada se anota y el siguiente chequeo reintenta', async () => {
  const down = makeDeps({ character: { id: 'c', card, lorebook: mem(20) }, failServer: true });
  assert.equal((await createIdentitySynthesizer(down.deps).maybeRun('c')).kind, 'error');
  assert.deepEqual(down.store.character.identity, undefined, 'no se escribió nada');
  const up = makeDeps({ character: down.store.character });
  assert.equal((await createIdentitySynthesizer(up.deps).maybeRun('c')).kind, 'ok');
});

test('sintetizador: texto con nombres inventados no se verifica → sin propuesta, intento anotado, sin reintento inmediato', async () => {
  const { deps, store, calls } = makeDeps({ character: { id: 'c', card, lorebook: mem(20) }, reply: ' Mia moved to Paris with Gustavo and adopted a dog.' });
  const synth = createIdentitySynthesizer(deps);
  assert.equal((await synth.maybeRun('c')).kind, 'unverified');
  assert.equal(calls.length, 2, 'dos intentos');
  assert.equal(store.character.identity.proposal, null);
  assert.ok(store.character.identity.attemptedAt > 0);
  assert.equal((await synth.maybeRun('c')).kind, 'skipped');
  assert.equal(calls.length, 2, 'no insiste');
});

test('sintetizador: sin recuerdos suficientes o con propuesta pendiente no llama al modelo', async () => {
  const few = makeDeps({ character: { id: 'c', card, lorebook: mem(5) } });
  assert.equal((await createIdentitySynthesizer(few.deps).maybeRun('c')).kind, 'skipped');
  assert.equal(few.calls.length, 0);
  const first = makeDeps({ character: { id: 'c', card, lorebook: mem(20) } });
  await createIdentitySynthesizer(first.deps).maybeRun('c');
  const again = makeDeps({ character: first.store.character });
  assert.equal((await createIdentitySynthesizer(again.deps).maybeRun('c')).kind, 'skipped');
  assert.equal(again.calls.length, 0);
});

test('sintetizador: abort() corta sin guardar nada', async () => {
  const { deps, store } = makeDeps({ character: { id: 'c', card, lorebook: mem(20) } });
  const synth = createIdentitySynthesizer({ ...deps, complete: (req, opts) => new Promise((_, reject) => { opts.signal.addEventListener('abort', () => reject(new Error('abort'))); setTimeout(() => synth.abort(), 5); }) });
  assert.equal((await synth.maybeRun('c')).kind, 'aborted');
  assert.equal(store.character.identity, undefined);
});

test('un personaje sin identidad guardada (anterior a MEM-019) se comporta como siempre', () => {
  const msgs = [{ role: 'user', text: 'Hi', ts: 1 }];
  const old = { id: 'c', card, lorebook: [] };
  const a = buildChatMessages(card, msgs, settings, '', '', '', '', false, identityForPrompt(old) ? { identity: identityForPrompt(old) } : {});
  const b = buildChatMessages(card, msgs, settings, '', '', '', '', false, {});
  assert.deepEqual(a, b);
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

test('estado: un personaje guardado ANTES de MEM-019 carga con identidad vacía y sin perder nada más', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await backend.put('characters', 'c1', { id: 'c1', name: 'Mia', avatar: '', card, created: 1, lorebook: mem(3) });
  const c = await state.getCharacter('c1');
  assert.deepEqual(c.identity, defaultIdentity());
  assert.equal(c.lorebook.length, 3);
  assert.deepEqual(c.card, card);
});

test('estado: saveCharacterIdentity aplica la transformación sobre el registro recién leído y no pisa lo demás', async () => {
  const backend = memoryBackend();
  const state = createState(backend);
  await state.saveCharacter({ id: 'c1', name: 'Mia', avatar: '', card, created: 1, lorebook: mem(20), chatBackground: 'data:x' });
  await state.saveCharacterIdentity('c1', (id) => withProposal(id, { text: 'Over time, Mia grew.', memoryCount: 20, level: 'early' }, 7));
  // Mientras tanto otra escritura cambia el lorebook (simula la extracción en segundo plano)
  const mid = await state.getCharacter('c1');
  await state.saveCharacter({ ...mid, lorebook: mem(25) });
  const accepted = await state.saveCharacterIdentity('c1', (id) => acceptProposal(id, 9));
  assert.equal(accepted.identity.text, 'Over time, Mia grew.');
  assert.equal(accepted.lorebook.length, 25, 'no se perdió el lorebook más nuevo');
  assert.equal(accepted.chatBackground, 'data:x');
  const reloaded = await state.getCharacter('c1');
  assert.equal(identityForPrompt(reloaded), 'Over time, Mia grew.');
  await assert.rejects(() => state.saveCharacterIdentity('nope', (x) => x));
});
