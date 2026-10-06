export const EMPTY_DRAFT = Object.freeze({
  name: '', gender: '', corePersonality: [], customCorePersonality: [], temperament: [], customTemperament: [],
  relationship: [], customRelationship: [], lifeOutsideChat: [], customLifeOutsideChat: [], voice: [], customVoice: [],
  hairLength: '', bodyType: '', skinTone: '', eyeColor: '', hairColor: '', appearanceExtras: [], customAppearance: [],
  clothingStyle: '', userAppearance: [],
  scenario: '', greeting: '', exampleDialogue: '', avatarDataUrl: '',
});

export const USER_TAGS = Object.freeze({
  hair: ['Short hair', 'Long hair', 'Curly hair', 'Straight hair', 'Dark hair', 'Light hair'],
  eyes: ['Dark eyes', 'Light eyes', 'Green eyes', 'Brown eyes'],
  other: ['Wears glasses', 'Beard', 'Slim build', 'Average build', 'Broad build'],
});

export const CORE_PERSONALITY = Object.freeze(['Happy', 'Adventurous', 'Cautious', 'Shy', 'Playful', 'Confident', 'Caring', 'Sarcastic', 'Curious', 'Mysterious', 'Calm', 'Energetic']);
export const TEMPERAMENT = Object.freeze(['Melancholic', 'Thoughtful', 'Reserved', 'Extroverted', 'Introverted', 'Optimistic', 'Serious', 'Spontaneous', 'Observant', 'Warm']);
export const RELATIONSHIPS = Object.freeze(['Instant connection', 'Slow burn', 'Rivalry', 'Mutual dislike', 'Friends', 'Strangers', 'Crush', 'Partners']);
export const LIFE_OUTSIDE_CHAT = Object.freeze(['Read new books', 'Go for walks', 'Browse the internet', 'Try on new clothes', 'Play video games', 'Listen to music albums', 'Cook', 'Watch movies', 'Draw', 'Exercise']);
export const VOICE = Object.freeze(['Casual', 'Formal', 'Playful and sarcastic', 'Soft-spoken', 'Direct', 'Witty', 'Warm']);
export const HAIR_LENGTH = Object.freeze(['Bald', 'Very short', 'Short', 'Shoulder-length', 'Long', 'Very long']);
export const BODY_TYPES = Object.freeze(['Slim', 'Average', 'Athletic', 'Curvy', 'Broad', 'Stocky']);
export const SKIN_TONES = Object.freeze(['Very fair', 'Fair', 'Light', 'Medium', 'Olive', 'Tan', 'Brown', 'Dark']);
export const EYE_COLORS = Object.freeze(['Brown', 'Amber', 'Hazel', 'Green', 'Blue', 'Gray']);
export const HAIR_COLORS = Object.freeze(['Black', 'Dark brown', 'Brown', 'Light brown', 'Blonde', 'Red', 'Auburn', 'Gray', 'White', 'Dyed']);
export const APPEARANCE_EXTRAS = Object.freeze(['Freckles', 'Moles', 'Scars', 'Dimples', 'Glasses', 'Piercings', 'Tattoos']);
const RELATIONSHIP_STARTERS = Object.freeze({
  'Instant connection': ['I feel like we already know each other. How has your day been?', '{{char}}: I feel like we already know each other. Tell me, what has been on your mind today?'],
  'Slow burn': ['No rush. What would you like to talk about first?', '{{char}}: We have time to get to know each other. What is something small you enjoy?'],
  Rivalry: ['Ready for another round? What are we competing over today?', '{{char}}: You are back. Should I be impressed, or are you here to finally admit I won?'],
  'Mutual dislike': ['We do not have to agree. What is your take on this?', '{{char}}: I suppose we can manage one conversation. What did you want to say?'],
  Friends: ['Hey, good to see you. How has your day been?', '{{char}}: There you are! Tell me what happened today—I want the full story.'],
  Strangers: ['Hi, I do not think we have met. What brings you here?', '{{char}}: Hello. I do not think we have met before. What should I call you?'],
  Crush: ['I was hoping we would get a moment to talk. How are you?', '{{char}}: I was trying to think of something clever to say, but… hi. I am glad you are here.'],
  Partners: ['I am glad we have a little time together. What is on your mind?', '{{char}}: Hey, love. I saved a little time just for us. How are you feeling?'],
});

export function relationshipTemplates(relationships = []) {
  const key = relationships.find(value => RELATIONSHIP_STARTERS[value]);
  const [greeting, exampleDialogue] = RELATIONSHIP_STARTERS[key] ?? RELATIONSHIP_STARTERS.Strangers;
  return { scenario: '', greeting, exampleDialogue };
}

export function validateDraft(input) {
  const draft = { ...EMPTY_DRAFT, ...input };
  const errors = {};
  if (!draft.name.trim()) errors.name = 'Add a name to continue.';
  if (draft.gender !== 'Male' && draft.gender !== 'Female') errors.gender = 'Choose Male or Female to continue.';
  if (unique([...draft.corePersonality, ...draft.customCorePersonality]).length > 3) errors.corePersonality = 'Choose up to 3 core personality traits.';
  if (unique([...draft.temperament, ...draft.customTemperament]).length > 3) errors.temperament = 'Choose up to 3 temperament traits.';
  if (!draft.clothingStyle.trim()) errors.clothingStyle = 'Describe their general clothing style to continue.';
  return { valid: Object.keys(errors).length === 0, errors, draft };
}

const unique = values => [...new Set((values ?? []).map(value => String(value).trim()).filter(Boolean))];
const listLine = (label, values) => values?.length ? `${label}: ${values.join(', ')}` : '';

export function createSeed(input, now = new Date().toISOString()) {
  const checked = validateDraft(input);
  if (!checked.valid) throw new Error(Object.values(checked.errors)[0]);
  const d = checked.draft;
  const appearanceParts = [
    listLine('Hair length', d.hairLength ? [d.hairLength] : []),
    listLine('Body type', d.bodyType ? [d.bodyType] : []),
    listLine('Skin tone', d.skinTone ? [d.skinTone] : []),
    listLine('Eye color', d.eyeColor ? [d.eyeColor] : []),
    listLine('Hair color', d.hairColor ? [d.hairColor] : []),
    listLine('Appearance details', unique([...d.appearanceExtras, ...d.customAppearance])),
  ].filter(Boolean);
  const structured = {
    corePersonality: unique([...d.corePersonality, ...d.customCorePersonality]),
    temperament: unique([...d.temperament, ...d.customTemperament]),
    startingRelationship: unique([...d.relationship, ...d.customRelationship]),
    lifeOutsideChat: unique([...d.lifeOutsideChat, ...d.customLifeOutsideChat]),
    voice: unique([...d.voice, ...d.customVoice]),
    appearance: {
      hairLength: d.hairLength, bodyType: d.bodyType, skinTone: d.skinTone,
      eyeColor: d.eyeColor, hairColor: d.hairColor,
      extras: unique([...d.appearanceExtras, ...d.customAppearance]),
    },
    clothingStyle: d.clothingStyle.trim(),
  };
  const templates = relationshipTemplates(unique([...d.relationship, ...d.customRelationship]));
  const scenario = d.scenario.trim() || templates.scenario;
  const personality = [
    listLine('Core personality', structured.corePersonality),
    listLine('Temperament', structured.temperament),
    listLine('Starting relationship', structured.startingRelationship),
    listLine('Life outside chat', structured.lifeOutsideChat),
    listLine('Voice', structured.voice),
  ].filter(Boolean).join('\n');
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `companion-${Date.now()}`,
    version: 2,
    createdAt: now,
    identity: {
      name: d.name.trim(), gender: d.gender, adult: true,
      permanentAppearance: appearanceParts.join('\n'), personality,
      initialBehaviors: [...structured.lifeOutsideChat], voiceStyle: [...structured.voice],
      corePersonality: structured.corePersonality, temperament: structured.temperament,
      startingRelationship: structured.startingRelationship, appearance: structured.appearance,
    },
    preferences: { relationshipStyle: structured.startingRelationship, boundaries: [], clothingStyle: structured.clothingStyle },
    userProfile: { appearanceTags: [...d.userAppearance] },
    scene: { scenario, greeting: d.greeting.trim() || templates.greeting, exampleDialogue: d.exampleDialogue.trim() || templates.exampleDialogue },
    presentation: { avatarDataUrl: d.avatarDataUrl || '' },
  };
}

export function toCharacterCardV2(seed) {
  const identity = seed.identity ?? {};
  const structured = {
    corePersonality: identity.corePersonality ?? [],
    temperament: identity.temperament ?? [],
    startingRelationship: identity.startingRelationship ?? seed.preferences?.relationshipStyle ?? [],
    lifeOutsideChat: identity.initialBehaviors ?? [],
    voice: identity.voiceStyle ?? [],
    appearance: identity.appearance ?? {},
    clothingStyle: seed.preferences?.clothingStyle ?? '',
  };
  const personalityLines = [
    listLine('Core personality', structured.corePersonality),
    listLine('Temperament', structured.temperament),
    listLine('Starting relationship', structured.startingRelationship),
    listLine('Life outside chat', structured.lifeOutsideChat),
    listLine('Voice', structured.voice),
    identity.personality && !structured.corePersonality.length ? identity.personality : '',
    structured.clothingStyle ? `Clothing style guidance: ${structured.clothingStyle}` : '',
  ].filter(Boolean);
  return {
    spec: 'chara_card_v2', spec_version: '2.0',
    data: {
      name: identity.name ?? '',
      description: [identity.gender ? `Gender: ${identity.gender}` : '', identity.permanentAppearance ?? ''].filter(Boolean).join('\n'),
      personality: personalityLines.join('\n'),
      scenario: seed.scene?.scenario ?? '', first_mes: seed.scene?.greeting ?? '', mes_example: seed.scene?.exampleDialogue ?? '',
      creator_notes: '', system_prompt: '', post_history_instructions: '', alternate_greetings: [], tags: [], creator: '', character_version: '1.0',
      extensions: { 'companionf/identity-seed': structured },
    },
  };
}
