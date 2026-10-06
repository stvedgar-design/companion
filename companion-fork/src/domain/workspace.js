export const DEFAULT_SETTINGS = Object.freeze({
  serverUrl: '',
  chatModel: { url: '' },
  memoryServerUrl: 'http://localhost:5002',
  memoryModel: { url: 'http://localhost:5002' },
  userName: 'You',
  maxLength: 180,
  temperature: 0.8,
  contextLength: 4096,
});

export function emptyWorkspace() {
  return {
    schemaVersion: 4,
    characters: [],
    conversations: {},
    episodes: {},
    activeEpisodeIds: {},
    memoryTasks: [],
    settings: { ...DEFAULT_SETTINGS },
    draft: null,
    step: 0,
    selectedCharacterId: null,
  };
}

// Preserve the original one-character prototype data when moving to the
// catalog/chat workspace. Migration only reshapes the saved record.
export function normalizeWorkspace(value = {}) {
  const previousVersion = Number(value.schemaVersion) || 0;
  const workspace = emptyWorkspace();
  const characters = Array.isArray(value.characters) ? [...value.characters] : [];
  if (value.seed && !characters.some(character => character.id === value.seed.id)) characters.push(value.seed);
  const { seed: _legacySeed, ...saved } = value;
  const conversations = value.conversations && typeof value.conversations === 'object' ? { ...value.conversations } : {};
  const episodes = value.episodes && typeof value.episodes === 'object' ? { ...value.episodes } : {};
  const activeEpisodeIds = value.activeEpisodeIds && typeof value.activeEpisodeIds === 'object' ? { ...value.activeEpisodeIds } : {};
  for (const character of characters) {
    const conversation = conversations[character.id] ?? { messages: [], updatedAt: null };
    conversation.messages = Array.isArray(conversation.messages) ? conversation.messages.map((message, index) => ({
      ...message,
      id: message.id || `legacy-${character.id}-${index}-${String(message.createdAt || '').replace(/\W/g, '')}`,
    })) : [];
    conversations[character.id] = conversation;
    const savedEpisodes = Array.isArray(episodes[character.id]) ? episodes[character.id] : [];
    if (!savedEpisodes.length) {
      episodes[character.id] = [{
        id: `episode-${character.id}-first`, title: 'First conversation', scenario: character.scene?.scenario ?? '',
        summary: null, mutableState: { clothingTags: [] }, memoryCursorMessageId: null,
        messages: conversation.messages, createdAt: conversation.updatedAt ?? new Date().toISOString(), updatedAt: conversation.updatedAt ?? null,
        isOpening: false,
      }];
    } else {
      episodes[character.id] = savedEpisodes.map((episode, index) => ({
        id: String(episode?.id || `episode-${character.id}-${index}`),
        title: String(episode?.title || `Episode ${index + 1}`),
        scenario: String(episode?.scenario ?? ''),
        summary: episode?.summary && typeof episode.summary.content === 'string' ? episode.summary : null,
        mutableState: { clothingTags: Array.isArray(episode?.mutableState?.clothingTags) ? episode.mutableState.clothingTags.map(String).slice(0, 30) : [] },
        memoryCursorMessageId: episode?.memoryCursorMessageId ?? null,
        messages: Array.isArray(episode?.messages) ? episode.messages.map((message, messageIndex) => ({
          ...message, id: message.id || `legacy-${character.id}-${index}-${messageIndex}-${String(message.createdAt || '').replace(/\W/g, '')}`,
        })) : [],
        createdAt: episode?.createdAt || new Date().toISOString(), updatedAt: episode?.updatedAt ?? null,
        isOpening: episode?.isOpening === true,
      }));
    }
    conversations[character.id] = episodes[character.id].find(item => item.id === activeEpisodeIds[character.id]) ?? episodes[character.id][0];
    activeEpisodeIds[character.id] = conversations[character.id].id;
    const priorMemory = character.memory ?? {};
    if (!savedEpisodes.length) episodes[character.id][0].memoryCursorMessageId = priorMemory.cursorMessageId ?? null;
    character.memory = {
      memories: Array.isArray(priorMemory.memories) ? priorMemory.memories : [],
      cursorMessageId: priorMemory.cursorMessageId ?? (previousVersion < 3 ? conversation.messages.at(-1)?.id ?? null : null),
      pendingTaskId: priorMemory.pendingTaskId ?? null,
    };
  }
  const memoryTasks = Array.isArray(value.memoryTasks) ? value.memoryTasks.map(task => {
    let episodeId = task.episodeId ?? null;
    if (!episodeId && task.characterId) {
      const sourceIds = new Set(task.sourceMessageIds ?? []);
      episodeId = episodes[task.characterId]?.find(episode => episode.messages.some(message => sourceIds.has(message.id)))?.id ?? null;
    }
    return { ...task, episodeId, status: task.status === 'running' ? 'pending' : task.status };
  }) : [];
  return {
    ...workspace,
    ...saved,
    schemaVersion: 4,
    episodes,
    activeEpisodeIds,
    characters,
    conversations,
    settings: (() => {
      const settings = value.settings ?? {};
      const chatUrl = settings.chatModel?.url || settings.serverUrl || '';
      const memoryUrl = settings.memoryModel?.url || settings.memoryServerUrl || DEFAULT_SETTINGS.memoryModel.url;
      return { ...DEFAULT_SETTINGS, ...settings, serverUrl: chatUrl, chatModel: { url: chatUrl }, memoryServerUrl: memoryUrl, memoryModel: { url: memoryUrl } };
    })(),
    memoryTasks,
    draft: value.seed ? null : (value.draft ?? null),
    step: value.seed ? 0 : (Number.isInteger(value.step) ? value.step : 0),
    selectedCharacterId: value.selectedCharacterId ?? null,
  };
}

export function conversationFor(workspace, characterId) {
  const activeEpisodeId = workspace.activeEpisodeIds?.[characterId];
  const episodes = workspace.episodes?.[characterId];
  if (Array.isArray(episodes) && episodes.length) {
    const episode = episodes.find(item => item.id === activeEpisodeId) ?? episodes[0];
    workspace.activeEpisodeIds[characterId] = episode.id;
    workspace.conversations[characterId] = episode;
    return episode;
  }
  const saved = workspace.conversations[characterId];
  if (saved && Array.isArray(saved.messages)) return saved;
  return { messages: [], updatedAt: null };
}

export function episodesFor(workspace, characterId) {
  return workspace.episodes?.[characterId] ?? [];
}

export function setActiveEpisode(workspace, characterId, episodeId) {
  const episode = episodesFor(workspace, characterId).find(item => item.id === episodeId);
  if (!episode) return null;
  workspace.activeEpisodeIds[characterId] = episode.id;
  workspace.conversations[characterId] = episode;
  return episode;
}

export function findEpisodeById(workspace, episodeId) {
  for (const episodes of Object.values(workspace.episodes ?? {})) {
    const episode = Array.isArray(episodes) ? episodes.find(item => item.id === episodeId) : null;
    if (episode) return episode;
  }
  return null;
}

export function createEpisode(workspace, character, scenario, now = new Date().toISOString(), id = `episode-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`}`) {
  const trimmedScenario = String(scenario ?? '').trim();
  if (!trimmedScenario) throw new Error('Add a starting scene for this episode.');
  const episodes = workspace.episodes[character.id] ?? (workspace.episodes[character.id] = []);
  const title = trimmedScenario.split(/[.!?\n]/)[0].trim().slice(0, 52) || 'New episode';
  const episode = { id, title, scenario: trimmedScenario, summary: null, mutableState: { clothingTags: [] }, memoryCursorMessageId: null, messages: [], createdAt: now, updatedAt: now, isOpening: true };
  episodes.push(episode);
  setActiveEpisode(workspace, character.id, id);
  return episode;
}
