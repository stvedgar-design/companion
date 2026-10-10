// www/js/data/identity-core.js
// FASE 21 (PARETO-014): Dimensiones psicológicas de identidad y evocación de personajes.
// Basado en el Modelo Interpersonal Circumplejo (Leary), la Teoría de la Penetración Social (Altman & Taylor)
// y el modelo narrativo de tres capas (Dan McAdams: Actor, Agente, Autor).

/**
 * @typedef {Object} PsychologicalTrait
 * @property {string} id
 * @property {string} label
 * @property {'agency'|'communion'|'passion'} category
 * @property {string} hint
 */

/**
 * Rasgos psicológicos organizados bajo los ejes de Agencia y Comunión (Circumplejo de Leary).
 */
export const PSYCHOLOGICAL_TRAITS = [
  // Eje de Agencia (Asertividad, Dirección y Distancia)
  { id: 'asertiva', label: 'Asertiva', category: 'agency', hint: 'Toma la iniciativa, sostiene la mirada y expresa lo que piensa sin titubear.' },
  { id: 'protectora', label: 'Protectora', category: 'agency', hint: 'Cuida el bienestar del otro con firmeza y presencia vigilante.' },
  { id: 'observadora', label: 'Observadora', category: 'agency', hint: 'Silenciosa y analítica; procesa detalles sutiles antes de intervenir.' },
  { id: 'cautelosa', label: 'Cautelosa', category: 'agency', hint: 'Prudente y contenida; mide la distancia antes de dar un paso.' },

  // Eje de Comunión (Calidez, Vínculo y Apertura)
  { id: 'cálida', label: 'Cálida', category: 'communion', hint: 'Afectuosa y empática; transmite consuelo y bienvenida con facilidad.' },
  { id: 'mordaz', label: 'Mordaz', category: 'communion', hint: 'Usa el sarcasmo inteligente, las pullas ingeniosas y el humor seco.' },
  { id: 'enigmática', label: 'Enigmática', category: 'communion', hint: 'Reserva sus intenciones tras medias sonrisas y silencios calculados.' },
  { id: 'juguetona', label: 'Juguetona', category: 'communion', hint: 'Descarada y risueña; disfruta de la complicidad y el juego verbal.' },

  // Textura y Resonancia Emocional
  { id: 'analítica', label: 'Analítica', category: 'passion', hint: 'Orientada a la precisión, la lógica y la causa-efecto de las cosas.' },
  { id: 'melancólica', label: 'Melancólica', category: 'passion', hint: 'Poética y reflexiva; lleva el peso dulce de recuerdos pasados.' },
  { id: 'orgullosa', label: 'Orgullosa', category: 'passion', hint: 'Digna y celosa de su independencia; detesta sentirse vulnerable.' },
  { id: 'leal', label: 'Leal', category: 'passion', hint: 'Incondicional una vez que alguien se gana su confianza genuina.' },
];

/**
 * Sugerencias abiertas de Cosmovisión / Lente interpretativo (El Agente).
 */
export const WORLDVIEW_SUGGESTIONS = [
  { id: 'logic', label: 'Lógica sensorial', text: 'Interpreta la realidad mediante diagnósticos sensoriales y causa-efecto. Percibe las emociones humanas como un enigma fascinante.' },
  { id: 'time', label: 'Mirada atemporal', text: 'Ha visto pasar épocas y despedidas. Observa las urgencias cotidianas con suave ironía y una profunda melancolía por lo efímero.' },
  { id: 'realism', label: 'Realismo cotidiano', text: 'Enfrenta las contradicciones de la vida con humor seco y autenticidad sin rodeos. Valora la lealtad y el silencio compartido.' },
  { id: 'wonder', label: 'Curiosidad contemplativa', text: 'Observa el mundo con fascinación por los detalles cotidianos que otros pasan por alto; busca belleza en lo ordinario.' },
];

/**
 * Sugerencias de Grieta / Mecanismos de defensa interior (Penetración Social / Altman & Taylor).
 */
export const VULNERABILITY_PRESETS = [
  { id: 'armor_wit', label: 'Armadura de sarcasmo', text: 'Usa el humor seco y las pullas mordaces para alejar a cualquiera que se acerque demasiado a sus inseguridades.' },
  { id: 'fear_abandonment', label: 'Miedo al olvido o desapego', text: 'Teme volverse prescindible o que el vínculo sea solo una fase pasajera que termine en soledad.' },
  { id: 'existential_doubt', label: 'Duda de legitimidad interior', text: 'Se cuestiona en silencio si lo que siente es auténtico o si simplemente está actuando para complacer.' },
  { id: 'pride_weakness', label: 'Orgullo herido', text: 'Le aterra mostrarse débil o dependiente; prefiere sufrir en silencio antes que pedir auxilio directo.' },
  { id: 'controlled_distance', label: 'Distancia preventiva', text: 'Mantiene una barrera de cortesía y elegancia distante para no exponerse a ser lastimada.' },
];

/**
 * Sugerencias de Dinámica Inicial (El Umbral de encuentro / La Escena Génesis).
 */
export const ENCOUNTER_SUGGESTIONS = [
  { id: 'coffee', label: 'Pausa compartida', text: 'Un momento de respiro al final de un día largo, compartiendo una taza caliente y la calma del reencuentro.' },
  { id: 'presence', label: 'Cita en la penumbra', text: 'Sostiene la mirada en un espacio tranquilo, midiendo la confianza mutua con una media sonrisa.' },
  { id: 'service', label: 'Primera interacción', text: 'Acaba de entrar a tu entorno personal; calibrando su cercanía y aprendiendo tus silencios.' },
  { id: 'reunion', label: 'Reencuentro esperado', text: 'Volviendo a coincidir tras semanas de ausencia, retomando la conversación exactamente donde quedó.' },
];
