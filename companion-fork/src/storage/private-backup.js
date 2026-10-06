import { normalizeWorkspace } from '../domain/workspace.js';

const FORMAT = 'companion-private-backup';
const VERSION = 1;
const ITERATIONS = 310_000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

function bytesToBase64(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value, length) {
  if (typeof value !== 'string' || value.length > 100_000_000) throw new Error('This backup file is not valid.');
  let binary;
  try { binary = atob(value); } catch { throw new Error('This backup file is not valid.'); }
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (length && bytes.length !== length) throw new Error('This backup file is not valid.');
  return bytes;
}

function requireCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) throw new Error('Secure backup is unavailable in this browser. Open the app over a secure connection or in the installed app.');
}

async function deriveKey(passphrase, salt, iterations) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export function validateBackupPassphrase(passphrase) {
  return typeof passphrase === 'string' && [...passphrase].length >= 12;
}

export async function createPrivateBackup(workspace, theme, passphrase) {
  requireCrypto();
  if (!validateBackupPassphrase(passphrase)) throw new Error('Use a backup password with at least 12 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, ITERATIONS);
  const payload = JSON.stringify({ workspace: normalizeWorkspace(workspace), theme: theme === 'dark' ? 'dark' : 'light' });
  const salt64 = bytesToBase64(salt);
  const iv64 = bytesToBase64(iv);
  const header = { format: FORMAT, version: VERSION, createdAt: new Date().toISOString(), kdf: 'PBKDF2-SHA-256', iterations: ITERATIONS, cipher: 'AES-256-GCM', salt: salt64, iv: iv64 };
  const additionalData = new TextEncoder().encode(JSON.stringify([header.format, header.version, header.createdAt, header.kdf, header.iterations, header.cipher, salt64, iv64]));
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData }, key, new TextEncoder().encode(payload));
  const output = JSON.stringify({ ...header, data: bytesToBase64(new Uint8Array(ciphertext)) }, null, 2);
  if (new Blob([output]).size > MAX_FILE_BYTES) throw new Error('This backup is larger than the supported 50 MB file size.');
  return output;
}

export async function readPrivateBackup(fileText, passphrase) {
  requireCrypto();
  if (typeof fileText !== 'string' || new Blob([fileText]).size > MAX_FILE_BYTES) throw new Error('This backup file is too large or could not be read.');
  let envelope;
  try { envelope = JSON.parse(fileText); } catch { throw new Error('This is not a readable Companion backup.'); }
  if (!envelope || envelope.format !== FORMAT || envelope.version !== VERSION || envelope.kdf !== 'PBKDF2-SHA-256' || envelope.cipher !== 'AES-256-GCM' || !Number.isInteger(envelope.iterations) || envelope.iterations < 100_000 || envelope.iterations > 1_000_000) throw new Error('This backup format is not supported.');
  const salt = base64ToBytes(envelope.salt, 16);
  const iv = base64ToBytes(envelope.iv, 12);
  const data = base64ToBytes(envelope.data);
  if (data.length < 16) throw new Error('This backup file is incomplete.');
  let cleartext;
  try {
    const key = await deriveKey(passphrase, salt, envelope.iterations);
    const additionalData = new TextEncoder().encode(JSON.stringify([envelope.format, envelope.version, envelope.createdAt ?? null, envelope.kdf, envelope.iterations, envelope.cipher, envelope.salt, envelope.iv]));
    cleartext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData }, key, data);
  } catch { throw new Error('The password did not unlock this backup, or the file has been changed.'); }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(cleartext)); } catch { throw new Error('The unlocked backup data could not be read.'); }
  if (!payload || typeof payload !== 'object' || !payload.workspace || typeof payload.workspace !== 'object') throw new Error('This backup does not contain a valid app workspace.');
  const workspace = normalizeWorkspace(payload.workspace);
  return { workspace, theme: payload.theme === 'dark' ? 'dark' : 'light', createdAt: envelope.createdAt ?? null };
}

export function backupSummary(workspace) {
  const characters = Array.isArray(workspace.characters) ? workspace.characters : [];
  const conversations = workspace.conversations ?? {};
  const episodes = Object.values(workspace.episodes ?? {}).flatMap(list => Array.isArray(list) ? list : []);
  const messages = episodes.length
    ? episodes.reduce((sum, episode) => sum + (Array.isArray(episode.messages) ? episode.messages.length : 0), 0)
    : Object.values(conversations).reduce((sum, conversation) => sum + (Array.isArray(conversation?.messages) ? conversation.messages.length : 0), 0);
  return { characterNames: characters.map(character => String(character.identity?.name || 'Unnamed companion')), characters: characters.length, conversations: episodes.length || Object.keys(conversations).length, messages };
}

export function mergeWorkspaces(current, incoming) {
  const left = normalizeWorkspace(current);
  const right = normalizeWorkspace(incoming);
  const episodes = Object.fromEntries(Object.entries(left.episodes).map(([id, list]) => [id, [...list]]));
  for (const [characterId, importedEpisodes] of Object.entries(right.episodes)) {
    const savedEpisodes = episodes[characterId] ?? (episodes[characterId] = []);
    const indexes = new Map(savedEpisodes.map((episode, index) => [episode.id, index]));
    for (const imported of importedEpisodes) {
      const index = indexes.get(imported.id);
      if (index === undefined) { indexes.set(imported.id, savedEpisodes.length); savedEpisodes.push(imported); continue; }
      const existing = savedEpisodes[index];
      const messages = [...(existing.messages ?? [])];
      const messageIds = new Set(messages.map(message => message.id));
      for (const message of imported.messages ?? []) if (!messageIds.has(message.id)) messages.push(message);
      const tags = [...(existing.mutableState?.clothingTags ?? [])];
      for (const tag of imported.mutableState?.clothingTags ?? []) if (!tags.includes(tag)) tags.push(tag);
      const importedSummary = imported.summary;
      const existingSummary = existing.summary;
      const summary = importedSummary && (!existingSummary || String(importedSummary.updatedAt || '') > String(existingSummary.updatedAt || '')) ? importedSummary : existingSummary;
      savedEpisodes[index] = { ...imported, ...existing, messages, summary, mutableState: { ...imported.mutableState, ...existing.mutableState, clothingTags: tags }, updatedAt: [existing.updatedAt, imported.updatedAt].filter(Boolean).sort().at(-1) ?? null };
    }
  }
  const characters = [...left.characters];
  const characterIndexes = new Map(characters.map((character, index) => [character.id, index]));
  for (const character of right.characters) {
    const index = characterIndexes.get(character.id);
    if (index === undefined) { characterIndexes.set(character.id, characters.length); characters.push(character); continue; }
    const existing = characters[index];
    const memories = [...(existing.memory?.memories ?? [])];
    const memoryIds = new Set(memories.map(memory => memory.id));
    for (const memory of character.memory?.memories ?? []) if (!memoryIds.has(memory.id)) memories.push(memory);
    const incomingProfile = character.userProfile ?? {};
    const existingProfile = existing.userProfile ?? {};
    const profile = { ...incomingProfile, ...existingProfile };
    for (const [key, value] of Object.entries(incomingProfile)) {
      if (Array.isArray(value)) profile[key] = [...new Set([...(value), ...(Array.isArray(existingProfile[key]) ? existingProfile[key] : [])])];
    }
    characters[index] = { ...character, ...existing, userProfile: profile, memory: { ...character.memory, ...existing.memory, memories } };
  }
  const conversations = { ...left.conversations };
  for (const [id, incomingConversation] of Object.entries(right.conversations)) {
    const existing = conversations[id];
    if (!existing) { conversations[id] = incomingConversation; continue; }
    const messages = [...(existing.messages ?? [])];
    const knownMessageIds = new Set(messages.map(message => message.id));
    for (const message of incomingConversation.messages ?? []) if (!knownMessageIds.has(message.id)) messages.push(message);
    conversations[id] = { ...existing, messages, updatedAt: [existing.updatedAt, incomingConversation.updatedAt].filter(Boolean).sort().at(-1) ?? null };
  }
  const memoryTasks = [...(left.memoryTasks ?? [])];
  const taskIds = new Set(memoryTasks.map(task => task.id));
  for (const task of right.memoryTasks ?? []) if (!taskIds.has(task.id)) memoryTasks.push(task);
  const activeEpisodeIds = { ...right.activeEpisodeIds, ...left.activeEpisodeIds };
  for (const character of characters) {
    const active = episodes[character.id]?.find(episode => episode.id === activeEpisodeIds[character.id]) ?? episodes[character.id]?.[0];
    if (active) { activeEpisodeIds[character.id] = active.id; conversations[character.id] = active; }
  }
  return normalizeWorkspace({ ...left, characters, conversations, episodes, activeEpisodeIds, memoryTasks });
}
